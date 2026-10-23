//! Android build: ONNX Runtime is not linked, so vocal separation reports that it is coming soon.
use std::path::Path;

use super::traits::{AudioError, ProgressSink, StemPaths, StemSeparator};

pub struct OnnxMdxSeparator {
    #[allow(dead_code)]
    pub model_dir: std::path::PathBuf,
}

impl StemSeparator for OnnxMdxSeparator {
    fn name(&self) -> &'static str {
        "unavailable-android"
    }

    fn separate(&self, _input: &Path, _output_dir: &Path, _progress: &dyn ProgressSink) -> Result<StemPaths, AudioError> {
        Err(AudioError::Failed("Vocal separation is not available on Android yet.".into()))
    }
}
