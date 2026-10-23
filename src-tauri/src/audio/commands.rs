use std::path::PathBuf;

use tauri::{AppHandle, Emitter};

use super::music::ThirdPartyMusicProvider;
use super::renderer::FfmpegRenderer;
use super::separator::OnnxMdxSeparator;
use super::traits::{MusicProvider, MusicRequest, ProgressSink, RenderJob, Renderer, StemSeparator};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    step: u8,
    progress: f32,
    message: String,
    done: bool,
}

struct EmitProgress {
    app: AppHandle,
    step: u8,
}

impl ProgressSink for EmitProgress {
    fn report(&self, amount: f32, message: &str) {
        let _ = self.app.emit(
            "audio-progress",
            ProgressEvent {
                step: self.step,
                progress: amount.clamp(0.0, 1.0),
                message: message.to_string(),
                done: amount >= 1.0,
            },
        );
    }
}

fn output_dir() -> PathBuf {
    std::env::temp_dir().join("xenocut")
}

#[tauri::command]
pub async fn audio_separate_stems(app: AppHandle, input_path: String) -> Result<String, String> {
    if input_path.trim().is_empty() {
        return Err("Import a video before separating stems.".into());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let separator = OnnxMdxSeparator;
        let sink = EmitProgress { app, step: 2 };
        separator
            .separate(PathBuf::from(&input_path).as_path(), &output_dir(), &sink)
            .map(|stems| {
                format!(
                    "Stub stems: {} + {}",
                    stems.vocals.display(),
                    stems.instrumental.display()
                )
            })
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn audio_import_music(
    app: AppHandle,
    prompt: String,
    local_path: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let request = match local_path {
            Some(path) if !path.trim().is_empty() => MusicRequest::LocalFile {
                path: PathBuf::from(path),
            },
            _ => MusicRequest::Suno { prompt },
        };
        let provider = ThirdPartyMusicProvider;
        let sink = EmitProgress { app, step: 3 };
        provider
            .import(&request, &output_dir(), &sink)
            .map(|path| format!("Stub music: {}", path.display()))
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn audio_mix_render(
    app: AppHandle,
    video_path: String,
    vocal_gain: f32,
    music_gain: f32,
) -> Result<String, String> {
    if video_path.trim().is_empty() {
        return Err("Import a video before rendering.".into());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let dir = output_dir();
        let job = RenderJob {
            video: PathBuf::from(&video_path),
            vocals: Some(dir.join("vocals.wav")),
            music: Some(dir.join("music.wav")),
            output: dir.join("xenocut-mix.mp4"),
            vocal_gain,
            music_gain,
        };
        let renderer = FfmpegRenderer;
        let sink = EmitProgress { app, step: 4 };
        renderer
            .render(&job, &sink)
            .map(|path| format!("Stub render: {}", path.display()))
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}
