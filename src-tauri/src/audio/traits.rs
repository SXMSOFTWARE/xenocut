use std::path::{Path, PathBuf};

/// Progress reported by a long audio job. `amount` is 0.0 through 1.0.
pub trait ProgressSink {
    fn report(&self, amount: f32, message: &str);
}

#[derive(Debug)]
pub enum AudioError {
    MissingInput(String),
    Failed(String),
}

impl std::fmt::Display for AudioError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingInput(path) => write!(f, "input not found: {path}"),
            Self::Failed(message) => write!(f, "{message}"),
        }
    }
}

#[derive(Debug)]
pub struct StemPaths {
    pub vocals: PathBuf,
    pub instrumental: PathBuf,
}

/// On-device vocal / instrumental separation.
///
/// Planned implementation: an ONNX MDX-Net or UVR model loaded with the `ort`
/// crate, running locally so source audio never leaves the machine.
pub trait StemSeparator: Send + Sync {
    fn name(&self) -> &'static str;

    fn separate(
        &self,
        input: &Path,
        output_dir: &Path,
        progress: &dyn ProgressSink,
    ) -> Result<StemPaths, AudioError>;
}

/// Where a music bed comes from.
///
/// Suno has no official public API. `Suno` is the planned third-party provider
/// that will use a key the user supplies. `LocalFile` imports audio the user
/// already has.
pub enum MusicRequest {
    Suno { prompt: String },
    LocalFile { path: PathBuf },
}

pub trait MusicProvider: Send + Sync {
    fn name(&self) -> &'static str;

    fn import(
        &self,
        request: &MusicRequest,
        output_dir: &Path,
        progress: &dyn ProgressSink,
    ) -> Result<PathBuf, AudioError>;
}

pub struct RenderJob {
    pub video: PathBuf,
    pub vocals: Option<PathBuf>,
    pub music: Option<PathBuf>,
    pub output: PathBuf,
    pub vocal_gain: f32,
    pub music_gain: f32,
}

/// Mix stems and write a finished video.
///
/// Planned implementation: a bundled FFmpeg sidecar. See `ffmpeg_args`.
pub trait Renderer: Send + Sync {
    fn name(&self) -> &'static str;

    fn render(&self, job: &RenderJob, progress: &dyn ProgressSink) -> Result<PathBuf, AudioError>;
}
