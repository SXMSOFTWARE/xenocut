use super::traits::RenderJob;

/// FFmpeg arguments for a vocals + music mix. The video stream is copied.
pub fn render_args(job: &RenderJob) -> Vec<String> {
    let duration = job.duration.max(0.05);
    let offset = (job.music_offset as f64).clamp(0.0, duration - 0.01);
    let target = (duration - offset).max(0.05);
    let (fade_in, fade_out) = scaled_fades(target, job.fade_in, job.fade_out);
    let vocal = format!("{:.4}", job.vocal_gain.clamp(0.0, 4.0));
    let music = format!("{:.4}", job.music_gain.clamp(0.0, 4.0));

    let mut music_chain = format!(
        "[2:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,atrim=0:{target:.3},asetpts=PTS-STARTPTS"
    );
    if fade_in >= 0.01 {
        music_chain.push_str(&format!(",afade=t=in:st=0:d={fade_in:.3}"));
    }
    if fade_out >= 0.01 {
        let start = (target - fade_out).max(0.0);
        music_chain.push_str(&format!(",afade=t=out:st={start:.3}:d={fade_out:.3}"));
    }
    let delay_ms = (offset * 1000.0).round() as i64;
    if delay_ms > 0 {
        music_chain.push_str(&format!(",adelay={delay_ms}|{delay_ms}"));
    }
    music_chain.push_str(&format!(
        ",volume={music},apad=whole_dur={duration:.3},atrim=0:{duration:.3}[m]"
    ));

    let filter = format!(
        "[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,apad=whole_dur={duration:.3},atrim=0:{duration:.3},volume={vocal}[v];{music_chain};[v][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]"
    );

    let mut args = vec![
        "-hide_banner".to_string(),
        "-y".to_string(),
        "-i".to_string(),
        job.video.display().to_string(),
        "-i".to_string(),
        job.vocals.display().to_string(),
    ];
    if job.loop_music {
        args.push("-stream_loop".into());
        args.push("-1".into());
    }
    args.extend([
        "-i".into(),
        job.music.display().to_string(),
        "-filter_complex".into(),
        filter,
        "-map".into(),
        "0:v:0".into(),
        "-map".into(),
        "[a]".into(),
        "-c:v".into(),
        "copy".into(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "192k".into(),
        "-movflags".into(),
        "+faststart".into(),
        job.output.display().to_string(),
    ]);
    args
}

fn scaled_fades(target: f64, fade_in: f32, fade_out: f32) -> (f64, f64) {
    let mut inn = (fade_in.max(0.0) as f64).min(target);
    let mut out = (fade_out.max(0.0) as f64).min(target);
    if inn + out > target && target > 0.0 {
        let scale = target / (inn + out);
        inn *= scale;
        out *= scale;
    }
    (inn, out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn job(loop_music: bool) -> RenderJob {
        RenderJob {
            video: PathBuf::from("in.mp4"),
            vocals: PathBuf::from("vocals.wav"),
            music: PathBuf::from("song.mp3"),
            output: PathBuf::from("out.mp4"),
            vocal_gain: 1.0,
            music_gain: 0.8,
            music_offset: 1.5,
            loop_music,
            fade_in: 0.4,
            fade_out: 0.8,
            duration: 12.0,
        }
    }

    #[test]
    fn graph_copies_video_and_mixes_with_the_requested_controls() {
        let args = render_args(&job(false));
        let filter = args
            .iter()
            .find(|arg| arg.contains("amix"))
            .cloned()
            .unwrap();
        assert!(filter.contains("volume=1.0000"));
        assert!(filter.contains("volume=0.8000"));
        assert!(filter.contains("adelay=1500|1500"));
        assert!(filter.contains("afade=t=in:st=0:d=0.400"));
        assert!(filter.contains("afade=t=out"));
        assert!(filter.contains("atrim=0:10.500"));
        assert!(filter.contains("normalize=0"));
        assert!(
            args.windows(2)
                .any(|pair| pair[0] == "-c:v" && pair[1] == "copy")
        );
        assert!(
            args.windows(2)
                .any(|pair| pair[0] == "-map" && pair[1] == "0:v:0")
        );
        assert!(!args.iter().any(|arg| arg == "-stream_loop"));
        assert_eq!(args.last().unwrap(), "out.mp4");
    }

    #[test]
    fn looping_repeats_the_music_input() {
        let args = render_args(&job(true));
        let loop_at = args.iter().position(|arg| arg == "-stream_loop").unwrap();
        assert_eq!(args[loop_at + 1], "-1");
        assert_eq!(args[loop_at + 2], "-i");
        assert_eq!(args[loop_at + 3], "song.mp3");
    }

    #[test]
    fn oversized_fades_are_scaled_to_the_music_span() {
        let (inn, out) = scaled_fades(1.0, 2.0, 2.0);
        assert!((inn + out - 1.0).abs() < 1e-6);
        assert!((inn - out).abs() < 1e-6);
    }
}
