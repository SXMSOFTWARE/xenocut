use std::path::Path;

use super::drive;
use super::traits::{AudioError, ProgressSink, StemPaths, StemSeparator};

/// Stub stand-in for the on-device ONNX separator.
pub struct OnnxMdxSeparator;

impl StemSeparator for OnnxMdxSeparator {
    fn name(&self) -> &'static str {
        "onnx-mdx-uvr"
    }

    fn separate(
        &self,
        input: &Path,
        output_dir: &Path,
        progress: &dyn ProgressSink,
    ) -> Result<StemPaths, AudioError> {
        if input.as_os_str().is_empty() {
            return Err(AudioError::MissingInput(input.display().to_string()));
        }

        // TODO(milestone-2): load an MDX-Net / UVR ONNX model with `ort`,
        // run it on `input`, and write real wav stems into `output_dir`.
        // The model stays on device. This stub only emits progress.
        let _engine = self.name();
        drive(
            progress,
            &[
                (0.08, "Opening source"),
                (0.24, "Loading ONNX session (stub)"),
                (0.52, "Separating vocals"),
                (0.78, "Writing instrumental stem"),
                (1.0, "Stems ready (stub, files not written)"),
            ],
        );

        Ok(StemPaths {
            vocals: output_dir.join("vocals.wav"),
            instrumental: output_dir.join("instrumental.wav"),
        })
    }
}
