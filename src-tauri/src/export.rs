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
use crate::project::{Clip, MediaKind, Project, TrackKind};

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

pub fn build(project: &Project, options: &ExportOptions) -> Result<ExportPlan, String> {
    let width = even(options.width);
    let height = even(options.height);
    let fps = options.fps.clamp(1, 240);

    // Collect renderable clips in compositing order: bottom video track first.
    let mut layers: Vec<Layer> = Vec::new();
    let video_tracks: Vec<_> = project.tracks.iter().filter(|t| t.kind == TrackKind::Video).rev().collect();
    let audio_tracks: Vec<_> = project.tracks.iter().filter(|t| t.kind != TrackKind::Video).collect();
    for track in video_tracks.iter().chain(audio_tracks.iter()) {
        let mut clips: Vec<&Clip> = project.clips.iter().filter(|c| c.track_id == track.id).collect();
        clips.sort_by(|a, b| a.start.total_cmp(&b.start));
        for clip in clips {
            if clip.duration() < 0.01 {
                continue;
            }
            let media = project.media(&clip.media_id).ok_or_else(|| format!("Clip {} points at missing media", clip.id))?;
            let is_video_track = track.kind == TrackKind::Video;
            let with_video = is_video_track && !track.hidden && media.kind != MediaKind::Audio && clip.opacity > 0.001;
            let with_audio = !track.muted && media.has_audio && media.kind != MediaKind::Image && clip.volume > 0.0001;
            if !with_video && !with_audio {
                continue;
            }
            layers.push(Layer { clip, kind: media.kind, path: &media.path, with_video, with_audio });
        }
    }

    let duration = project.duration();
    if duration < 0.05 || layers.is_empty() {
        return Err("The timeline is empty. Add a clip before exporting.".into());
    }

    let mut args: Vec<String> = vec!["-hide_banner".into(), "-y".into()];
    let mut graph: Vec<String> = vec![
        format!("color=c=black:s={width}x{height}:r={fps}:d={}[base]", secs(duration)),
        format!("anullsrc=r=48000:cl=stereo,atrim=0:{}[bed]", secs(duration)),
    ];
    let mut current = "base".to_string();
    let mut audio_labels: Vec<String> = vec!["[bed]".into()];

    for (index, layer) in layers.iter().enumerate() {
        let clip = layer.clip;
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
            chain.push(format!(
                "scale={width}:{height}:force_original_aspect_ratio=decrease:out_range=tv,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black@0"
            ));
            chain.push("setsar=1".into());
            chain.push("format=yuva420p".into());
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
            let delay = (start * 1000.0).round() as i64;
            if delay > 0 {
                chain.push(format!("adelay={delay}:all=1"));
            }
            graph.push(format!("[{index}:a]{}[a{index}]", chain.join(",")));
            audio_labels.push(format!("[a{index}]"));
        }
    }

    let grade = project.settings.grade.as_deref().and_then(crate::grade::ffmpeg_chain);
    match grade {
        Some(chain) => graph.push(format!("[{current}]{chain},format=yuv420p[vout]")),
        None => graph.push(format!("[{current}]format=yuv420p[vout]")),
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
mod tests {
    use super::*;
    use crate::project::{MediaItem, ProjectSettings, Track};

    fn media(id: &str, kind: MediaKind, path: &str, duration: f64, has_audio: bool) -> MediaItem {
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

    fn clip(id: &str, track: &str, media: &str, start: f64, inp: f64, out: f64) -> Clip {
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
                Track { id: "v2".into(), kind: TrackKind::Video, name: "Video 2".into(), muted: false, hidden: false },
                Track { id: "v1".into(), kind: TrackKind::Video, name: "Video 1".into(), muted: false, hidden: false },
                Track { id: "a1".into(), kind: TrackKind::Audio, name: "Audio 1".into(), muted: false, hidden: false },
                Track { id: "m1".into(), kind: TrackKind::Music, name: "Music 1".into(), muted: false, hidden: false },
            ],
            clips,
        }
    }

    fn options() -> ExportOptions {
        ExportOptions { output_path: "out.mp4".into(), width: 1280, height: 720, fps: 30, quality: Quality::Fast }
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
        let o = ExportOptions { output_path: out.display().to_string(), width: 1280, height: 720, fps: 30, quality: Quality::Fast };
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
}
