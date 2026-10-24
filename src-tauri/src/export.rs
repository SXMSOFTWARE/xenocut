//! Timeline export: turns a `Project` into one FFmpeg invocation.
//!
//! Video clips are trimmed at the input (`-ss`/`-t`), retimed, scaled and letterboxed to the
//! project canvas, then overlaid on a black base at their timeline position, so gaps stay black.
//! Track order: the first video track in the list is drawn on top.
//! Audio from every unmuted clip (video clips carry their own sound) is delayed to its
//! position and mixed over a silent bed that fixes the output length.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::audio::traits::{AudioError, ProgressSink};
use crate::audio::{cancel, ffmpeg};
use crate::project::{Clip, MediaKind, Project, Track, TrackKind};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    Fast,
    Balanced,
    High,
}

impl Quality {
    fn x264(self) -> (&'static str, u32) {
        match self {
            Quality::Fast => ("veryfast", 23),
            Quality::Balanced => ("medium", 20),
            Quality::High => ("slow", 17),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    pub output_path: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub quality: Quality,
    /// Text layer pre-rendered by the frontend: an ffconcat list of transparent PNG frames at
    /// the output size covering the timeline (see `textlayer.rs`). Drawn above the colour grade.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_overlay: Option<String>,
}

#[derive(Debug)]
pub struct ExportPlan {
    pub args: Vec<String>,
    pub duration: f64,
}

fn even(value: u32) -> u32 {
    (value.max(2) / 2) * 2
}

fn secs(value: f64) -> String {
    format!("{:.3}", value.max(0.0))
}

/// `atempo` accepts 0.5..=2.0 per instance, so larger changes are chained.
pub fn atempo_chain(speed: f64) -> Vec<String> {
    let mut filters = Vec::new();
    let mut remaining = speed.clamp(0.0625, 16.0);
    if (remaining - 1.0).abs() < 1e-6 {
        return filters;
    }
    while remaining > 2.0 {
        filters.push("atempo=2.0".into());
        remaining /= 2.0;
    }
    while remaining < 0.5 {
        filters.push("atempo=0.5".into());
        remaining /= 0.5;
    }
    filters.push(format!("atempo={remaining:.4}"));
    filters
}

struct Layer<'a> {
    clip: &'a Clip,
    kind: MediaKind,
    path: &'a str,
    with_video: bool,
    with_audio: bool,
}

/// Renderable clips in compositing order: bottom video track first, then the sound-only tracks.
/// `video` false drops pictures (sound of video clips is kept); `music` false skips music tracks.
fn collect_layers(project: &Project, video: bool, music: bool) -> Result<Vec<Layer<'_>>, String> {
    let mut layers: Vec<Layer> = Vec::new();
    let video_tracks: Vec<_> = project.tracks.iter().filter(|t| t.kind == TrackKind::Video).rev().collect();
    let audio_tracks: Vec<_> = project
        .tracks
        .iter()
        .filter(|t| t.kind == TrackKind::Audio || (music && t.kind == TrackKind::Music))
        .collect();
    for track in video_tracks.iter().chain(audio_tracks.iter()) {
        let mut clips: Vec<&Clip> = project.clips.iter().filter(|c| c.track_id == track.id).collect();
        clips.sort_by(|a, b| a.start.total_cmp(&b.start));
        for clip in clips {
            if clip.duration() < 0.01 {
                continue;
            }
            let media = project.media(&clip.media_id).ok_or_else(|| format!("Clip {} points at missing media", clip.id))?;
            let is_video_track = track.kind == TrackKind::Video;
            let with_video = video && is_video_track && !track.hidden && media.kind != MediaKind::Audio && clip.opacity > 0.001;
            let with_audio = !track.muted && media.has_audio && media.kind != MediaKind::Image && clip.volume > 0.0001;
            if !with_video && !with_audio {
                continue;
            }
            layers.push(Layer { clip, kind: media.kind, path: &media.path, with_video, with_audio });
        }
    }
    Ok(layers)
}

/// Trim, retime, gain, fades and placement of one clip's sound, as a 48 kHz stereo chain.
fn audio_chain(clip: &Clip) -> String {
    let speed = clip.speed.clamp(0.0625, 16.0);
    let length = clip.duration();
    let fade_in = clip.fade_in.clamp(0.0, length);
    let fade_out = clip.fade_out.clamp(0.0, (length - fade_in).max(0.0));
    let mut chain = vec!["asetpts=PTS-STARTPTS".to_string()];
    chain.extend(atempo_chain(speed));
    if (clip.volume - 1.0).abs() > 1e-4 {
        chain.push(format!("volume={:.4}", clip.volume.max(0.0)));
    }
    if fade_in > 0.0 {
        chain.push(format!("afade=t=in:st=0:d={}", secs(fade_in)));
    }
    if fade_out > 0.0 {
        chain.push(format!("afade=t=out:st={}:d={}", secs(length - fade_out), secs(fade_out)));
    }
    chain.push("aresample=48000".into());
    chain.push("aformat=sample_fmts=fltp:channel_layouts=stereo".into());
    let delay = (clip.start * 1000.0).round() as i64;
    if delay > 0 {
        chain.push(format!("adelay={delay}:all=1"));
    }
    chain.join(",")
}

/// The timeline's sound (speech tracks, optionally music) mixed to 16 kHz mono float WAV, the
/// input format of speech recognition. Times in the file are timeline times.
pub fn build_speech_mix(project: &Project, output: &str, music: bool) -> Result<ExportPlan, String> {
    let layers = collect_layers(project, false, music)?;
    let duration = project.duration();
    if duration < 0.05 || layers.is_empty() {
        return Err("There is no sound on the timeline to transcribe.".into());
    }
    let mut args: Vec<String> = vec!["-hide_banner".into(), "-y".into()];
    let mut graph = vec![format!("anullsrc=r=48000:cl=stereo,atrim=0:{}[bed]", secs(duration))];
    let mut labels = vec!["[bed]".to_string()];
    for (index, layer) in layers.iter().enumerate() {
        args.extend([
            "-ss".into(),
            secs(layer.clip.in_point),
            "-t".into(),
            secs(layer.clip.source_duration()),
            "-i".into(),
            layer.path.to_string(),
        ]);
        graph.push(format!("[{index}:a]{}[a{index}]", audio_chain(layer.clip)));
        labels.push(format!("[a{index}]"));
    }
    graph.push(format!(
        "{}amix=inputs={}:normalize=0:duration=first:dropout_transition=0,pan=mono|c0=0.5*c0+0.5*c1,aresample=16000[aout]",
        labels.join(""),
        labels.len()
    ));
    args.extend([
        "-filter_complex".into(),
        graph.join(";"),
        "-map".into(),
        "[aout]".into(),
        "-c:a".into(),
        "pcm_f32le".into(),
        "-t".into(),
        secs(duration),
        output.to_string(),
    ]);
    Ok(ExportPlan { args, duration })
}

pub fn build(project: &Project, options: &ExportOptions) -> Result<ExportPlan, String> {
    let width = even(options.width);
    let height = even(options.height);
    let fps = options.fps.clamp(1, 240);

    let layers = collect_layers(project, true, true)?;

    let duration = project.duration();
    let text_overlay = options.text_overlay.as_deref().filter(|path| !path.is_empty());
    if duration < 0.05 || (layers.is_empty() && text_overlay.is_none()) {
        return Err("The timeline is empty. Add a clip before exporting.".into());
    }

    let mut args: Vec<String> = vec!["-hide_banner".into(), "-y".into()];
    let mut graph: Vec<String> = vec![
        format!("color=c=black:s={width}x{height}:r={fps}:d={}[base]", secs(duration)),
        format!("anullsrc=r=48000:cl=stereo,atrim=0:{}[bed]", secs(duration)),
    ];
    let mut current = "base".to_string();
    let mut audio_labels: Vec<String> = vec!["[bed]".into()];

    // Video and effect tracks bottom first: an effect layer runs on everything composited below it.
    let stack: Vec<&Track> =
        project.tracks.iter().filter(|t| matches!(t.kind, TrackKind::Video | TrackKind::Effect)).rev().collect();
    let position = |track_id: &str| stack.iter().position(|t| t.id == track_id).unwrap_or(usize::MAX);
    let mut next_effect = 0usize;
    let mut effect_count = 0usize;
    let mut apply_effects_below = |limit: usize, current: &mut String, graph: &mut Vec<String>| {
        while next_effect < stack.len() && next_effect < limit {
            let track = stack[next_effect];
            next_effect += 1;
            if track.kind != TrackKind::Effect || track.hidden {
                continue;
            }
            let mut clips: Vec<&Clip> = project.clips.iter().filter(|c| c.track_id == track.id && !c.effects.is_empty()).collect();
            clips.sort_by(|a, b| a.start.total_cmp(&b.start));
            for clip in clips {
                let length = clip.duration();
                if length < 0.01 {
                    continue;
                }
                let at = Some(clip.start);
                let mut chain = crate::effects::pre_scale(&clip.effects, length, at);
                chain.extend(crate::effects::picture(&clip.effects, height, length, at));
                chain.extend(crate::effects::motion(&clip.effects, length, fps, at));
                if chain.is_empty() {
                    continue;
                }
                let next = format!("fx{effect_count}");
                effect_count += 1;
                graph.push(format!("[{current}]{}[{next}]", chain.join(",")));
                *current = next;
            }
        }
    };

    for (index, layer) in layers.iter().enumerate() {
        let clip = layer.clip;
        if layer.with_video {
            apply_effects_below(position(&clip.track_id), &mut current, &mut graph);
        }
        let speed = clip.speed.clamp(0.0625, 16.0);
        let length = clip.duration();
        if layer.kind == MediaKind::Image {
            args.extend([
                "-loop".into(),
                "1".into(),
                "-framerate".into(),
                fps.to_string(),
                "-t".into(),
                secs(length),
                "-i".into(),
                layer.path.to_string(),
            ]);
        } else {
            args.extend([
                "-ss".into(),
                secs(clip.in_point),
                "-t".into(),
                secs(clip.source_duration()),
                "-i".into(),
                layer.path.to_string(),
            ]);
        }

        let start = clip.start;
        let fade_in = clip.fade_in.clamp(0.0, length);
        let fade_out = clip.fade_out.clamp(0.0, (length - fade_in).max(0.0));

        if layer.with_video {
            let mut chain = vec![if layer.kind == MediaKind::Image || (speed - 1.0).abs() < 1e-6 {
                "setpts=PTS-STARTPTS".to_string()
            } else {
                format!("setpts=(PTS-STARTPTS)/{speed:.4}")
            }];
            chain.push(format!("fps={fps}"));
            let mut all_effects = clip.effects.clone();
            if let Some(anim) = &clip.anim {
                all_effects.extend(crate::anims::effects(anim, length));
            }
            let effects = &all_effects;
            chain.extend(crate::effects::pre_scale(effects, length, None));
            chain.push(format!("scale={width}:{height}:force_original_aspect_ratio=decrease:out_range=tv"));
            if let Some(lut) = &clip.lut {
                match crate::plugins::lut_filter(&lut.path, lut.amount) {
                    Ok(Some(filter)) => chain.push(filter),
                    Ok(None) => {}
                    Err(err) => crate::diag::log("warn", &format!("export: skipping LUT: {err}")),
                }
            }
            chain.extend(crate::effects::picture(effects, height, length, None));
            chain.push(format!("pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black@0"));
            chain.push("setsar=1".into());
            chain.push("format=yuva420p".into());
            if let Some(motion) = crate::effects::motion(effects, length, fps, None) {
                chain.push(motion);
            }
            if let Some(anim) = &clip.anim {
                chain.extend(crate::anims::chain(anim, length, fps));
            }
            if clip.opacity < 0.999 {
                chain.push(format!("colorchannelmixer=aa={:.3}", clip.opacity.clamp(0.0, 1.0)));
            }
            if fade_in > 0.0 {
                chain.push(format!("fade=t=in:st=0:d={}:alpha=1", secs(fade_in)));
            }
            if fade_out > 0.0 {
                chain.push(format!("fade=t=out:st={}:d={}:alpha=1", secs(length - fade_out), secs(fade_out)));
            }
            chain.push(format!("setpts=PTS+{}/TB", secs(start)));
            graph.push(format!("[{index}:v]{}[v{index}]", chain.join(",")));
            let next = format!("o{index}");
            graph.push(format!(
                "[{current}][v{index}]overlay=eof_action=pass:enable='between(t,{},{})'[{next}]",
                secs(start),
                secs(start + length)
            ));
            current = next;
        }

        if layer.with_audio {
            graph.push(format!("[{index}:a]{}[a{index}]", audio_chain(clip)));
            audio_labels.push(format!("[a{index}]"));
        }
    }

    apply_effects_below(usize::MAX, &mut current, &mut graph);

    let grade = project.settings.grade.as_deref().and_then(crate::grade::ffmpeg_chain);
    let graded = match grade {
        Some(chain) => format!("{chain},"),
        None => String::new(),
    };
    match text_overlay {
        Some(list) => {
            let index = layers.len();
            args.extend(["-f".into(), "concat".into(), "-safe".into(), "0".into(), "-i".into(), list.to_string()]);
            graph.push(format!("[{current}]{graded}format=yuv420p[graded]"));
            graph.push(format!("[{index}:v]fps={fps},format=rgba,setsar=1[text]"));
            graph.push("[graded][text]overlay=eof_action=pass:format=auto,format=yuv420p[vout]".into());
        }
        None => graph.push(format!("[{current}]{graded}format=yuv420p[vout]")),
    }
    graph.push(format!(
        "{}amix=inputs={}:normalize=0:duration=first:dropout_transition=0[aout]",
        audio_labels.join(""),
        audio_labels.len()
    ));

    let (preset, crf) = options.quality.x264();
    args.extend([
        "-filter_complex".into(),
        graph.join(";"),
        "-map".into(),
        "[vout]".into(),
        "-map".into(),
        "[aout]".into(),
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        preset.into(),
        "-crf".into(),
        crf.to_string(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-r".into(),
        fps.to_string(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "192k".into(),
        "-color_range".into(),
        "tv".into(),
        // Inputs may carry chapters/timecode tracks; the output is just picture + sound.
        "-map_metadata".into(),
        "-1".into(),
        "-map_chapters".into(),
        "-1".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-t".into(),
        secs(duration),
        options.output_path.clone(),
    ]);
    Ok(ExportPlan { args, duration })
}

/// Build and run an export. Progress is 0..1 of the timeline length.
pub fn run(project: &Project, options: &ExportOptions, progress: &dyn ProgressSink) -> Result<PathBuf, AudioError> {
    cancel::check()?;
    for media in &project.media {
        if project.clips.iter().any(|c| c.media_id == media.id) && !Path::new(&media.path).is_file() {
            return Err(AudioError::MissingInput(media.path.clone()));
        }
    }
    let output = PathBuf::from(&options.output_path);
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|err| AudioError::Failed(err.to_string()))?;
    }
    let plan = build(project, options).map_err(AudioError::Failed)?;
    let mut args = plan.args;
    let out = args.pop().unwrap_or_default();
    args.extend(["-progress".into(), "pipe:1".into(), "-nostats".into(), out]);
    progress.report(0.0, "Rendering");
    let result = ffmpeg::run(&args, Some(plan.duration), Some(progress), "Rendering");
    if result.is_err() {
        let _ = std::fs::remove_file(&output);
    }
    result?;
    progress.report(1.0, "Done");
    Ok(output)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::project::{MediaItem, ProjectSettings};

    pub fn media(id: &str, kind: MediaKind, path: &str, duration: f64, has_audio: bool) -> MediaItem {
        MediaItem {
            id: id.into(),
            path: path.into(),
            name: path.into(),
            kind,
            duration,
            width: 1280,
            height: 720,
            fps: 30.0,
            has_audio,
            has_video: kind != MediaKind::Audio,
        }
    }

    pub fn clip(id: &str, track: &str, media: &str, start: f64, inp: f64, out: f64) -> Clip {
        Clip {
            id: id.into(),
            track_id: track.into(),
            media_id: media.into(),
            start,
            in_point: inp,
            out_point: out,
            speed: 1.0,
            volume: 1.0,
            opacity: 1.0,
            fade_in: 0.0,
            fade_out: 0.0,
            text: None,
            effects: vec![],
            anim: None,
            lut: None,
        }
    }

    pub fn project(media: Vec<MediaItem>, clips: Vec<Clip>) -> Project {
        Project {
            version: 1,
            id: "p".into(),
            name: "Test".into(),
            created: String::new(),
            modified: String::new(),
            settings: ProjectSettings { aspect: "16:9".into(), resolution: "720p".into(), width: 1280, height: 720, fps: 30, grade: None },
            media,
            tracks: vec![
                Track { id: "v2".into(), kind: TrackKind::Video, name: "Video 2".into(), muted: false, hidden: false, role: None },
                Track { id: "v1".into(), kind: TrackKind::Video, name: "Video 1".into(), muted: false, hidden: false, role: None },
                Track { id: "a1".into(), kind: TrackKind::Audio, name: "Audio 1".into(), muted: false, hidden: false, role: None },
                Track { id: "m1".into(), kind: TrackKind::Music, name: "Music 1".into(), muted: false, hidden: false, role: None },
            ],
            clips,
        }
    }

    fn options() -> ExportOptions {
        ExportOptions { output_path: "out.mp4".into(), width: 1280, height: 720, fps: 30, quality: Quality::Fast, text_overlay: None }
    }

    fn filter(plan: &ExportPlan) -> String {
        let at = plan.args.iter().position(|a| a == "-filter_complex").unwrap();
        plan.args[at + 1].clone()
    }

    #[test]
    fn empty_timeline_is_rejected() {
        let err = build(&project(vec![], vec![]), &options()).unwrap_err();
        assert!(err.contains("empty"));
    }

    #[test]
    fn clips_are_trimmed_at_input_and_placed_with_gaps() {
        let p = project(
            vec![media("m", MediaKind::Video, "a.mp4", 20.0, true)],
            vec![clip("c1", "v1", "m", 0.0, 2.0, 5.0), clip("c2", "v1", "m", 6.0, 10.0, 12.0)],
        );
        let plan = build(&p, &options()).unwrap();
        assert!((plan.duration - 8.0).abs() < 1e-9);
        let args = plan.args.join(" ");
        assert!(args.contains("-ss 2.000 -t 3.000 -i a.mp4"));
        assert!(args.contains("-ss 10.000 -t 2.000 -i a.mp4"));
        let f = filter(&plan);
        assert!(f.starts_with("color=c=black:s=1280x720:r=30:d=8.000[base]"));
        assert!(f.contains("[1:v]setpts=PTS-STARTPTS,fps=30,scale=1280:720"));
        assert!(f.contains("setpts=PTS+6.000/TB[v1]"));
        assert!(f.contains("[o0][v1]overlay=eof_action=pass:enable='between(t,6.000,8.000)'[o1]"));
        assert!(f.contains("[1:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=6000:all=1[a1]"));
        assert!(f.contains("[bed][a0][a1]amix=inputs=3:normalize=0:duration=first"));
        assert!(f.contains("[o1]format=yuv420p[vout]"));
        assert_eq!(plan.args.last().unwrap(), "out.mp4");
        assert!(plan.args.windows(2).any(|w| w[0] == "-t" && w[1] == "8.000"));
    }

    #[test]
    fn upper_video_track_is_composited_last() {
        let p = project(
            vec![media("m", MediaKind::Video, "a.mp4", 20.0, false), media("i", MediaKind::Image, "logo.png", 0.0, false)],
            vec![clip("top", "v2", "i", 1.0, 0.0, 3.0), clip("bottom", "v1", "m", 0.0, 0.0, 5.0)],
        );
        let plan = build(&p, &options()).unwrap();
        let args = plan.args.join(" ");
        // Bottom track (v1) is input 0, the image on v2 is input 1 and loops.
        assert!(args.contains("-ss 0.000 -t 5.000 -i a.mp4 -loop 1 -framerate 30 -t 3.000 -i logo.png"));
        let f = filter(&plan);
        assert!(f.contains("[base][v0]overlay"));
        assert!(f.contains("[o0][v1]overlay"));
        // Silent video and still image add no audio, only the bed.
        assert!(f.contains("[bed]amix=inputs=1"));
    }

    #[test]
    fn speed_volume_opacity_and_fades() {
        let mut c = clip("c", "v1", "m", 1.0, 0.0, 8.0);
        c.speed = 4.0;
        c.volume = 0.5;
        c.opacity = 0.6;
        c.fade_in = 0.5;
        c.fade_out = 1.0;
        let p = project(vec![media("m", MediaKind::Video, "a.mp4", 20.0, true)], vec![c]);
        let plan = build(&p, &options()).unwrap();
        let f = filter(&plan);
        assert!(f.contains("setpts=(PTS-STARTPTS)/4.0000"));
        assert!(f.contains("colorchannelmixer=aa=0.600"));
        assert!(f.contains("fade=t=in:st=0:d=0.500:alpha=1"));
        assert!(f.contains("fade=t=out:st=1.000:d=1.000:alpha=1"));
        assert!(f.contains("atempo=2.0,atempo=2.0000"));
        assert!(f.contains("volume=0.5000"));
        assert!(f.contains("afade=t=out:st=1.000:d=1.000"));
        assert!(f.contains("adelay=1000:all=1"));
        assert!((plan.duration - 3.0).abs() < 1e-9);
    }

    #[test]
    fn muted_and_hidden_tracks_are_skipped() {
        let mut p = project(
            vec![media("m", MediaKind::Video, "a.mp4", 20.0, true), media("s", MediaKind::Audio, "song.mp3", 60.0, true)],
            vec![clip("v", "v1", "m", 0.0, 0.0, 4.0), clip("s", "m1", "s", 0.0, 0.0, 4.0)],
        );
        p.tracks[1].hidden = true;
        p.tracks[3].muted = true;
        let plan = build(&p, &options()).unwrap();
        let f = filter(&plan);
        assert!(!f.contains("[0:v]"));
        assert!(f.contains("[0:a]"));
        assert!(!f.contains("[1:a]"));
        assert!(!plan.args.iter().any(|a| a == "song.mp3"));
    }

    #[test]
    fn output_size_is_forced_even_and_quality_maps_to_x264() {
        let p = project(vec![media("m", MediaKind::Video, "a.mp4", 20.0, false)], vec![clip("v", "v1", "m", 0.0, 0.0, 2.0)]);
        let mut o = options();
        o.width = 721;
        o.height = 405;
        o.quality = Quality::High;
        let plan = build(&p, &o).unwrap();
        assert!(filter(&plan).contains("s=720x404"));
        assert!(plan.args.windows(2).any(|w| w[0] == "-preset" && w[1] == "slow"));
        assert!(plan.args.windows(2).any(|w| w[0] == "-crf" && w[1] == "17"));
    }

    #[test]
    fn atempo_chains_cover_the_range() {
        assert!(atempo_chain(1.0).is_empty());
        assert_eq!(atempo_chain(0.25), vec!["atempo=0.5", "atempo=0.5000"]);
        assert_eq!(atempo_chain(1.5), vec!["atempo=1.5000"]);
    }

    struct Quiet;
    impl ProgressSink for Quiet {
        fn report(&self, _amount: f32, _message: &str) {}
    }

    fn make(args: &[&str]) -> bool {
        let Ok(bin) = ffmpeg::ffmpeg_binary() else { return false };
        std::process::Command::new(bin).args(args).output().map(|o| o.status.success()).unwrap_or(false)
    }

    /// End to end: three clips on three tracks, rendered by the real sidecar.
    #[test]
    fn exports_a_three_clip_timeline() {
        if ffmpeg::ffmpeg_binary().is_err() {
            eprintln!("skipping export: ffmpeg missing");
            return;
        }
        let dir = std::env::temp_dir().join(format!("xenocut-export-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a.mp4");
        let b = dir.join("b.mp4");
        let song = dir.join("song.wav");
        let out = dir.join("out.mp4");
        let ok = make(&["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=4", "-f", "lavfi", "-i", "sine=f=440:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", a.to_str().unwrap()])
            && make(&["-y", "-loglevel", "error", "-f", "lavfi", "-i", "smptebars=s=360x640:r=25:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", b.to_str().unwrap()])
            && make(&["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=f=220:d=10", song.to_str().unwrap()]);
        assert!(ok, "could not make test media");

        let mut c3 = clip("c3", "m1", "s", 0.5, 0.0, 5.5);
        c3.volume = 0.6;
        c3.fade_out = 1.0;
        let p = project(
            vec![
                media("a", MediaKind::Video, a.to_str().unwrap(), 4.0, true),
                media("b", MediaKind::Video, b.to_str().unwrap(), 3.0, false),
                media("s", MediaKind::Audio, song.to_str().unwrap(), 10.0, true),
            ],
            vec![clip("c1", "v1", "a", 0.0, 1.0, 4.0), clip("c2", "v1", "b", 3.5, 0.0, 2.5), c3],
        );
        cancel::begin();
        let o = ExportOptions { output_path: out.display().to_string(), width: 1280, height: 720, fps: 30, quality: Quality::Fast, text_overlay: None };
        let started = std::time::Instant::now();
        run(&p, &o, &Quiet).unwrap();
        let elapsed = started.elapsed();
        let probed = crate::media::probe(&out).unwrap();
        let size = std::fs::metadata(&out).unwrap().len();
        eprintln!("export e2e: duration {:.3}s, {}x{}, {} bytes, took {:?}", probed.duration, probed.width, probed.height, size, elapsed);
        assert!((probed.duration - 6.0).abs() < 0.1, "duration was {}", probed.duration);
        assert_eq!((probed.width, probed.height), (1280, 720));
        assert!(probed.has_audio);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn text_overlay_is_drawn_after_the_grade() {
        let mut p = project(vec![media("m", MediaKind::Video, "a.mp4", 20.0, false)], vec![clip("v", "v1", "m", 0.0, 0.0, 2.0)]);
        p.settings.grade = Some("mono".into());
        let mut o = options();
        o.text_overlay = Some("/tmp/layer.ffconcat".into());
        let plan = build(&p, &o).unwrap();
        let f = filter(&plan);
        assert!(plan.args.windows(2).any(|w| w[0] == "concat" && w[1] == "-safe"));
        assert!(f.contains("[1:v]fps=30,format=rgba"));
        let graded = f.find("[graded]").unwrap();
        assert!(f.find("[graded][text]overlay").unwrap() > graded);
    }

    #[test]
    fn speech_mix_keeps_sound_drops_pictures_and_music_on_request() {
        let p = project(
            vec![media("v", MediaKind::Video, "/v.mp4", 10.0, true), media("m", MediaKind::Audio, "/m.mp3", 60.0, true)],
            vec![clip("c1", "v1", "v", 2.0, 1.0, 5.0), clip("c2", "m1", "m", 0.0, 0.0, 8.0)],
        );
        let plan = build_speech_mix(&p, "/tmp/s.wav", false).unwrap();
        let graph = filter(&plan);
        assert!(!graph.contains(":v]"), "{graph}");
        assert!(graph.contains("[0:a]") && !graph.contains("[1:a]"), "{graph}");
        assert!(graph.contains("adelay=2000:all=1"));
        assert!(graph.contains("aresample=16000[aout]"));
        assert!(plan.args.iter().any(|a| a == "pcm_f32le"));
        let with_music = build_speech_mix(&p, "/tmp/s.wav", true).unwrap();
        assert!(filter(&with_music).contains("[1:a]"));
        let silent = project(vec![media("i", MediaKind::Image, "/i.png", 0.0, false)], vec![clip("c", "v1", "i", 0.0, 0.0, 3.0)]);
        assert!(build_speech_mix(&silent, "/tmp/s.wav", true).is_err());
    }

    #[test]
    fn text_only_timelines_export() {
        let mut p = project(vec![], vec![]);
        let mut c = clip("t", "v1", "", 0.0, 0.0, 3.0);
        c.text = Some(serde_json::json!({"content": "Hi"}));
        p.tracks.push(Track { id: "x1".into(), kind: TrackKind::Text, name: "Text 1".into(), muted: false, hidden: false, role: None });
        c.track_id = "x1".into();
        p.clips.push(c);
        assert!(build(&p, &options()).is_err());
        let mut o = options();
        o.text_overlay = Some("/tmp/layer.ffconcat".into());
        let plan = build(&p, &o).unwrap();
        assert!(filter(&plan).contains("[0:v]fps=30"));
        assert!((plan.duration - 3.0).abs() < 1e-9);
    }

    /// End to end: a red title frame over a blue clip, through the real concat demuxer.
    #[test]
    fn exports_a_pre_rendered_text_layer() {
        if ffmpeg::ffmpeg_binary().is_err() {
            eprintln!("skipping text export: ffmpeg missing");
            return;
        }
        let dir = std::env::temp_dir().join(format!("xenocut-textexport-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let blue = dir.join("blue.mp4");
        let out = dir.join("out.mp4");
        assert!(make(&["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=30:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", blue.to_str().unwrap()]));
        // Frame 0: fully transparent. Frame 1: opaque red square in the middle.
        assert!(make(&["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black@0:s=320x180,format=rgba", "-frames:v", "1", dir.join("f000000.png").to_str().unwrap()]));
        assert!(make(&["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=100x60,format=rgba,pad=320:180:110:60:color=black@0", "-frames:v", "1", dir.join("f000001.png").to_str().unwrap()]));
        let list = dir.join("layer.ffconcat");
        std::fs::write(&list, crate::textlayer::concat_list(&[
            crate::textlayer::Entry { frame: 0, duration: 1.0 },
            crate::textlayer::Entry { frame: 1, duration: 1.0 },
        ]))
        .unwrap();
        let p = project(vec![media("b", MediaKind::Video, blue.to_str().unwrap(), 2.0, false)], vec![clip("c", "v1", "b", 0.0, 0.0, 2.0)]);
        cancel::begin();
        let o = ExportOptions {
            output_path: out.display().to_string(),
            width: 320,
            height: 180,
            fps: 30,
            quality: Quality::Fast,
            text_overlay: Some(list.display().to_string()),
        };
        run(&p, &o, &Quiet).unwrap();
        let pixel = |at: &str| -> Vec<u8> {
            let bin = ffmpeg::ffmpeg_binary().unwrap();
            let o = std::process::Command::new(bin)
                .args(["-loglevel", "error", "-ss", at, "-i", out.to_str().unwrap(), "-frames:v", "1", "-vf", "crop=10:10:155:85,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
                .output()
                .unwrap();
            o.stdout
        };
        let early = pixel("0.5");
        let late = pixel("1.5");
        assert!(early[2] > 150 && early[0] < 80, "expected blue before the title, got {early:?}");
        assert!(late[0] > 150 && late[2] < 80, "expected the red title, got {late:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// End to end: every effect at once goes through the real ffmpeg, and invert turns blue yellow.
    #[test]
    fn exports_every_effect() {
        if ffmpeg::ffmpeg_binary().is_err() {
            eprintln!("skipping effects export: ffmpeg missing");
            return;
        }
        let dir = std::env::temp_dir().join(format!("xenocut-fxexport-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let blue = dir.join("blue.mp4");
        let out = dir.join("out.mp4");
        assert!(make(&["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=30:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", blue.to_str().unwrap()]));
        let mut c = clip("c", "v1", "b", 0.0, 0.0, 2.0);
        c.effects = ["mirror", "flip", "invert", "sharpen", "rgbSplit", "blur", "vignette", "grain", "scanlines", "letterbox", "zoomIn", "shake", "punch", "hitShake", "vhs"]
            .iter()
            .map(|k| crate::effects::Effect { kind: (*k).into(), amount: if *k == "grain" || *k == "vignette" { 0.1 } else { 1.0 }, from: None, to: None })
            .collect();
        let p = project(vec![media("b", MediaKind::Video, blue.to_str().unwrap(), 2.0, false)], vec![c]);
        cancel::begin();
        let o = ExportOptions {
            output_path: out.display().to_string(),
            width: 320,
            height: 180,
            fps: 30,
            quality: Quality::Fast,
            text_overlay: None,
        };
        run(&p, &o, &Quiet).unwrap();
        let bin = ffmpeg::ffmpeg_binary().unwrap();
        let px = std::process::Command::new(bin)
            .args(["-loglevel", "error", "-ss", "1", "-i", out.to_str().unwrap(), "-frames:v", "1", "-vf", "crop=10:10:155:85,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
            .output()
            .unwrap()
            .stdout;
        assert!(px[0] > 150 && px[1] > 150 && px[2] < 90, "expected inverted blue (yellow), got {px:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn fx(kind: &str, amount: f64, from: Option<f64>, to: Option<f64>) -> crate::effects::Effect {
        crate::effects::Effect { kind: kind.into(), amount, from, to }
    }

    /// Centre pixel (rgb) of `out` at `at` seconds.
    fn centre(out: &Path, at: &str) -> Vec<u8> {
        let bin = ffmpeg::ffmpeg_binary().unwrap();
        std::process::Command::new(bin)
            .args(["-loglevel", "error", "-ss", at, "-i", out.to_str().unwrap(), "-frames:v", "1", "-vf", "crop=10:10:155:85,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
            .output()
            .unwrap()
            .stdout
    }

    #[test]
    fn effect_ranges_are_gated_in_clip_time() {
        let mut c = clip("c", "v1", "b", 4.0, 0.0, 3.0);
        c.effects = vec![fx("invert", 1.0, Some(1.0), Some(2.0)), fx("flash", 1.0, Some(0.5), None)];
        let p = project(vec![media("b", MediaKind::Video, "/b.mp4", 9.0, false)], vec![c]);
        let f = filter(&build(&p, &options()).unwrap());
        // Clip-local time: the clip starts at 4 s on the timeline but its chain starts at 0.
        assert!(f.contains("lutrgb=r='clip(-1.00000*val+255.000,0,255)'"), "{f}");
        assert!(f.contains(":enable='gte(t,1.0000)*lt(t,2.0000)'"), "{f}");
        assert!(f.contains("fade=t=in:st=0.5000:d=0.25:color=white:enable='gte(t,0.5000)*lt(t,3.0000)'"), "{f}");
    }

    #[test]
    fn effect_layer_runs_on_the_canvas_below_it() {
        let mut p = project(
            vec![media("b", MediaKind::Video, "/b.mp4", 9.0, false)],
            vec![clip("c", "v1", "b", 0.0, 0.0, 4.0)],
        );
        p.tracks.insert(0, Track { id: "fx".into(), kind: TrackKind::Effect, name: "FX".into(), muted: false, hidden: false, role: None });
        let mut layer = clip("l", "fx", "", 1.0, 0.0, 2.0);
        layer.effects = vec![fx("bw", 1.0, None, None), fx("zoomIn", 1.0, None, None)];
        p.clips.push(layer);
        let f = filter(&build(&p, &options()).unwrap());
        let overlay = f.find("[base][v0]overlay").unwrap();
        let layer_at = f.find("[o0]format=rgba,colorchannelmixer").expect(&f);
        assert!(layer_at > overlay, "{f}");
        // Timeline time on the canvas: gated to the layer's span, motion clock offset by its start.
        assert!(f.contains("enable='gte(t,1.0000)*lt(t,3.0000)'"), "{f}");
        assert!(f.contains("clip(((in/30-1.0000)-0.0000)/2.0000,0,1)"), "{f}");
        assert!(f.contains("[fx0]format=yuv420p[vout]"), "{f}");
    }

    /// End to end: a ranged effect on a clip and an effect layer over it, through the real ffmpeg.
    #[test]
    fn exports_ranges_and_layers() {
        if ffmpeg::ffmpeg_binary().is_err() {
            eprintln!("skipping: ffmpeg missing");
            return;
        }
        let dir = std::env::temp_dir().join(format!("xenocut-fxrange-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let blue = dir.join("blue.mp4");
        let out = dir.join("out.mp4");
        assert!(make(&["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=30:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", blue.to_str().unwrap()]));
        let mut c = clip("c", "v1", "b", 0.0, 0.0, 4.0);
        // Invert only for [1, 2): blue → yellow → blue.
        c.effects = vec![fx("invert", 1.0, Some(1.0), Some(2.0))];
        let mut p = project(vec![media("b", MediaKind::Video, blue.to_str().unwrap(), 4.0, false)], vec![c]);
        p.tracks.insert(0, Track { id: "fx".into(), kind: TrackKind::Effect, name: "FX".into(), muted: false, hidden: false, role: None });
        // Layer [3, 4): fade out to black over its span.
        let mut layer = clip("l", "fx", "", 3.0, 0.0, 1.0);
        layer.effects = vec![fx("fadeOut", 1.0, None, None)];
        p.clips.push(layer);
        cancel::begin();
        let o = ExportOptions { output_path: out.display().to_string(), width: 320, height: 180, fps: 30, quality: Quality::Fast, text_overlay: None };
        run(&p, &o, &Quiet).unwrap();
        let blueish = |px: &[u8]| px[2] > 150 && px[0] < 80 && px[1] < 80;
        let a = centre(&out, "0.5");
        let b = centre(&out, "1.5");
        let c = centre(&out, "2.5");
        let d = centre(&out, "3.9");
        assert!(blueish(&a), "before the range: {a:?}");
        assert!(b[0] > 150 && b[1] > 150 && b[2] < 90, "inside the range: {b:?}");
        assert!(blueish(&c), "after the range: {c:?}");
        assert!(d[2] < 60, "end of the fade-out layer: {d:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
