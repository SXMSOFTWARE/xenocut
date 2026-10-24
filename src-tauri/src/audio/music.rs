use super::cancel;
use super::traits::{AudioError, MusicProvider, MusicRequest, ProgressSink};

/// Imports a song the user already downloaded. There is no network call.
pub struct LocalMusicProvider;

impl MusicProvider for LocalMusicProvider {
    fn name(&self) -> &'static str {
        "local-file"
    }

    fn import(
        &self,
        request: &MusicRequest,
        progress: &dyn ProgressSink,
    ) -> Result<std::path::PathBuf, AudioError> {
        cancel::check()?;
        let path = &request.path;
        if !path.is_file() {
            return Err(AudioError::MissingInput(path.display().to_string()));
        }
        let ext = path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(ext.as_str(), "mp3" | "wav" | "m4a") {
            return Err(AudioError::Failed(
                "Choose an mp3, wav, or m4a file. This is the song you exported from Suno.".into(),
            ));
        }
        progress.report(1.0, "Music ready");
        Ok(path.clone())
    }
}
