use super::drive;
use super::traits::{AudioError, ProgressSink, RenderJob, Renderer};

/// Stub renderer. Builds the FFmpeg argument list the sidecar will run later
/// and does not execute it.
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
        if job.video.as_os_str().is_empty() {
            return Err(AudioError::MissingInput(job.video.display().to_string()));
        }

        let args = ffmpeg_args(job);
        if args.len() < 4 {
            return Err(AudioError::Failed("incomplete ffmpeg plan".into()));
        }

        // TODO(milestone-2): spawn the bundled ffmpeg sidecar with `args`
        // and stream its progress. Do not shell out to a system ffmpeg
        // until the sidecar is packaged for Windows, Linux, and Android.
        let _engine = self.name();
        let _planned = args.len();
        drive(
            progress,
            &[
                (0.1, "Preparing FFmpeg graph (stub, not executed)"),
                (0.38, "Mixing dialogue and music"),
                (0.7, "Encoding video"),
                (0.9, "Writing output"),
                (1.0, "Render complete (stub, file not written)"),
            ],
        );

        Ok(job.output.clone())
    }
}

/// Argument vector for the planned FFmpeg sidecar. Not executed.
pub fn ffmpeg_args(job: &RenderJob) -> Vec<String> {
    let mut args = vec![
        "-hide_banner".to_string(),
        "-y".to_string(),
        "-i".to_string(),
        job.video.display().to_string(),
    ];

    let mut next_index = 1u32;
    let vocal_index = if job.vocals.is_some() {
        let index = next_index;
        next_index += 1;
        if let Some(path) = &job.vocals {
            args.push("-i".into());
            args.push(path.display().to_string());
        }
        Some(index)
    } else {
        None
    };

    let music_index = if let Some(path) = &job.music {
        let index = next_index;
        args.push("-i".into());
        args.push(path.display().to_string());
        Some(index)
    } else {
        None
    };

    args.push("-filter_complex".into());
    args.push(mix_filter(
        vocal_index,
        music_index,
        job.vocal_gain,
        job.music_gain,
    ));
    args.extend([
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
        job.output.display().to_string(),
    ]);
    args
}

fn mix_filter(
    vocal_index: Option<u32>,
    music_index: Option<u32>,
    vocal_gain: f32,
    music_gain: f32,
) -> String {
    match (vocal_index, music_index) {
        (Some(vocal), Some(music)) => format!(
            "[{vocal}:a]volume={vocal_gain}[v];[{music}:a]volume={music_gain}[m];[v][m]amix=inputs=2:duration=longest:dropout_transition=0[a]"
        ),
        (None, Some(music)) => format!(
            "[0:a]volume={vocal_gain}[d];[{music}:a]volume={music_gain}[m];[d][m]amix=inputs=2:duration=first:dropout_transition=0[a]"
        ),
        (Some(vocal), None) => format!("[{vocal}:a]volume={vocal_gain}[a]"),
        (None, None) => format!("[0:a]volume={vocal_gain}[a]"),
    }
}
