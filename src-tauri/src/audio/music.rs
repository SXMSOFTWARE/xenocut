use std::path::Path;

use super::drive;
use super::traits::{AudioError, MusicProvider, MusicRequest, ProgressSink};

/// Stub music provider.
///
/// TODO(milestone-2): `MusicRequest::Suno` should call a third-party
/// Suno-compatible endpoint with the user's own API key. Suno does not
/// publish an official public API. `MusicRequest::LocalFile` should copy
/// the chosen file into the project.
pub struct ThirdPartyMusicProvider;

impl MusicProvider for ThirdPartyMusicProvider {
    fn name(&self) -> &'static str {
        "suno-or-local"
    }

    fn import(
        &self,
        request: &MusicRequest,
        output_dir: &Path,
        progress: &dyn ProgressSink,
    ) -> Result<std::path::PathBuf, AudioError> {
        let label = match request {
            MusicRequest::Suno { prompt } => {
                let trimmed = prompt.trim();
                if trimmed.is_empty() {
                    "untitled prompt".to_string()
                } else {
                    trimmed.to_string()
                }
            }
            MusicRequest::LocalFile { path } => {
                if path.as_os_str().is_empty() {
                    return Err(AudioError::MissingInput(path.display().to_string()));
                }
                path.display().to_string()
            }
        };

        let opening = format!("Contacting {} for {label} (stub)", self.name());
        drive(
            progress,
            &[
                (0.16, opening.as_str()),
                (0.48, "Fetching arrangement"),
                (0.8, "Downloading preview"),
                (1.0, "Music imported (stub, file not written)"),
            ],
        );

        Ok(output_dir.join("music.wav"))
    }
}
