use super::cancel;
use super::ffmpeg;
use super::graph;
use super::traits::{AudioError, ProgressSink, RenderJob, Renderer};

pub struct FfmpegRenderer;

impl Renderer for FfmpegRenderer {
    fn name(&self) -> &'static str {
        "ffmpeg-sidecar"
    }

    fn render(
        &self,
        job: &RenderJob,
        progress: &dyn ProgressSink,
    ) -> Result<std::path::PathBuf, AudioError> {
        cancel::check()?;
        if !job.video.is_file() {
            return Err(AudioError::MissingInput(job.video.display().to_string()));
        }
        if !job.vocals.is_file() {
            return Err(AudioError::MissingInput(job.vocals.display().to_string()));
        }
        if !job.music.is_file() {
            return Err(AudioError::MissingInput(job.music.display().to_string()));
        }
        if let Some(parent) = job.output.parent() {
            std::fs::create_dir_all(parent).map_err(|err| AudioError::Failed(err.to_string()))?;
        }

        let mut job = RenderJob {
            video: job.video.clone(),
            vocals: job.vocals.clone(),
            music: job.music.clone(),
            output: job.output.clone(),
            vocal_gain: job.vocal_gain,
            music_gain: job.music_gain,
            music_offset: job.music_offset,
            loop_music: job.loop_music,
            fade_in: job.fade_in,
            fade_out: job.fade_out,
            duration: job.duration,
        };
        if job.duration <= 0.05 {
            job.duration = ffmpeg::probe_duration(&job.video)?;
        }

        progress.report(0.04, "Preparing mix");
        let mut args = graph::render_args(&job);
        let output = args
            .pop()
            .ok_or_else(|| AudioError::Failed("missing output path".into()))?;
        args.extend([
            "-progress".into(),
            "pipe:1".into(),
            "-nostats".into(),
            output,
        ]);
        ffmpeg::run(
            &args,
            Some(job.duration),
            Some(progress),
            "Mixing and writing video",
        )?;
        progress.report(1.0, "Render complete");
        Ok(job.output)
    }
}

#[cfg(test)]
mod tests {
    use super::super::traits::Renderer;
    use super::*;
    use std::time::Instant;

    struct Quiet;
    impl ProgressSink for Quiet {
        fn report(&self, _amount: f32, _message: &str) {}
    }

    #[test]
    fn renders_a_short_clip_with_the_sidecar() {
        if ffmpeg::ffmpeg_binary().is_err() {
            eprintln!("skipping mix render: ffmpeg sidecar missing");
            return;
        }
        cancel::begin();
        let dir = std::env::temp_dir().join(format!("xenocut-mix-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let video = dir.join("clip.mp4");
        let vocals = dir.join("vocals.wav");
        let music = dir.join("song.wav");
        let output = dir.join("out.mp4");

        let started = Instant::now();
        ffmpeg::run(
            &[
                "-hide_banner".into(),
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "testsrc=size=320x180:rate=24:duration=2".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "sine=frequency=220:sample_rate=44100:duration=2".into(),
                "-shortest".into(),
                "-c:v".into(),
                "libx264".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
                "-c:a".into(),
                "aac".into(),
                video.display().to_string(),
            ],
            None,
            None,
            "sample video",
        )
        .expect("sample video");

        ffmpeg::run(
            &[
                "-hide_banner".into(),
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "sine=frequency=440:sample_rate=44100:duration=2".into(),
                "-c:a".into(),
                "pcm_f32le".into(),
                vocals.display().to_string(),
            ],
            None,
            None,
            "vocals",
        )
        .expect("vocals");

        ffmpeg::run(
            &[
                "-hide_banner".into(),
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "sine=frequency=330:sample_rate=44100:duration=3".into(),
                "-c:a".into(),
                "pcm_s16le".into(),
                music.display().to_string(),
            ],
            None,
            None,
            "music",
        )
        .expect("music");

        let job = RenderJob {
            video,
            vocals,
            music,
            output: output.clone(),
            vocal_gain: 1.0,
            music_gain: 0.6,
            music_offset: 0.25,
            loop_music: false,
            fade_in: 0.1,
            fade_out: 0.2,
            duration: 0.0,
        };
        let render_started = Instant::now();
        FfmpegRenderer.render(&job, &Quiet).expect("render");
        let duration = ffmpeg::probe_duration(&output).expect("duration");
        let size = std::fs::metadata(&output).expect("stat").len();
        eprintln!(
            "mix output {} ({} bytes), duration {duration:.3}s, render {}ms, fixture+render {}ms",
            output.display(),
            size,
            render_started.elapsed().as_millis(),
            started.elapsed().as_millis()
        );
        assert!(size > 8_000, "output too small: {size}");
        assert!((duration - 2.0).abs() < 0.2, "duration {duration}");
    }
}
