use std::path::{Path, PathBuf};

/// Progress reported by a long audio job. `amount` is 0.0 through 1.0.
pub trait ProgressSink {
    fn report(&self, amount: f32, message: &str);
}

#[derive(Debug)]
pub enum AudioError {
    MissingInput(String),
    Cancelled,
    Failed(String),
}

impl std::fmt::Display for AudioError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingInput(path) => write!(f, "input not found: {path}"),
            Self::Cancelled => write!(f, "Cancelled"),
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
/// `OnnxMdxSeparator` runs UVR's MDX-Net Voc_FT model through ONNX Runtime.
/// The weights download on first use and stay in the app data directory.
pub trait StemSeparator: Send + Sync {
    #[allow(dead_code)]
    fn name(&self) -> &'static str;

    fn separate(
        &self,
        input: &Path,
        output_dir: &Path,
        progress: &dyn ProgressSink,
    ) -> Result<StemPaths, AudioError>;
}

/// A song the user already exported from Suno (or any other tool) as a local file.
/// XenoCut does not call Suno.
pub struct MusicRequest {
    pub path: PathBuf,
}

pub trait MusicProvider: Send + Sync {
    #[allow(dead_code)]
    fn name(&self) -> &'static str;

    fn import(
        &self,
        request: &MusicRequest,
        progress: &dyn ProgressSink,
    ) -> Result<PathBuf, AudioError>;
}

pub struct RenderJob {
    pub video: PathBuf,
    pub vocals: PathBuf,
    pub music: PathBuf,
    pub output: PathBuf,
    pub vocal_gain: f32,
    pub music_gain: f32,
    /// Seconds from the start of the video before the music begins.
    pub music_offset: f32,
    pub loop_music: bool,
    pub fade_in: f32,
    pub fade_out: f32,
    pub duration: f64,
}

/// Mix stems and write a finished video with the original video stream copied.
pub trait Renderer: Send + Sync {
    #[allow(dead_code)]
    fn name(&self) -> &'static str;

    fn render(&self, job: &RenderJob, progress: &dyn ProgressSink) -> Result<PathBuf, AudioError>;
}
