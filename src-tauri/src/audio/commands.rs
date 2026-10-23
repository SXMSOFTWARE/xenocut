use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager};

use super::cancel;
use super::music::LocalMusicProvider;
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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeparateResult {
    vocals_path: String,
    instrumental_path: String,
    message: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicResult {
    music_path: String,
    message: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderResult {
    output_path: String,
    message: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderRequest {
    pub video_path: String,
    pub vocals_path: String,
    pub music_path: String,
    pub vocal_gain: f32,
    pub music_gain: f32,
    pub music_offset: f32,
    pub loop_music: bool,
    pub fade_in: f32,
    pub fade_out: f32,
    pub video_duration: f64,
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

fn root_dir(app: &AppHandle) -> PathBuf {
    let base = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir());
    base.join("xenocut")
}

fn job_dir(root: &std::path::Path, video: &std::path::Path) -> PathBuf {
    let stem = video
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("clip");
    let safe: String = stem
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .take(48)
        .collect();
    let name = if safe.is_empty() { "clip".to_string() } else { safe };
    root.join("jobs").join(name)
}

#[tauri::command]
pub fn audio_cancel() {
    cancel::request();
}

#[tauri::command]
pub async fn audio_separate_stems(app: AppHandle, input_path: String) -> Result<SeparateResult, String> {
    let input = PathBuf::from(input_path.trim());
    if input.as_os_str().is_empty() {
        return Err("Choose a video before separating stems.".into());
    }
    cancel::begin();
    let root = root_dir(&app);
    let model_dir = root.join("models");
    let output_dir = job_dir(&root, &input);

    tauri::async_runtime::spawn_blocking(move || {
        let separator = OnnxMdxSeparator { model_dir };
        let sink = EmitProgress { app, step: 2 };
        separator
            .separate(&input, &output_dir, &sink)
            .map(|stems| SeparateResult {
                message: "Stems ready".into(),
                vocals_path: stems.vocals.display().to_string(),
                instrumental_path: stems.instrumental.display().to_string(),
            })
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn audio_import_music(app: AppHandle, local_path: String) -> Result<MusicResult, String> {
    let path = PathBuf::from(local_path.trim());
    cancel::begin();
    tauri::async_runtime::spawn_blocking(move || {
        let provider = LocalMusicProvider;
        let sink = EmitProgress { app, step: 3 };
        provider
            .import(&MusicRequest { path }, &sink)
            .map(|path| MusicResult {
                message: "Music ready".into(),
                music_path: path.display().to_string(),
            })
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn audio_mix_render(app: AppHandle, request: RenderRequest) -> Result<RenderResult, String> {
    let video = PathBuf::from(request.video_path.trim());
    if video.as_os_str().is_empty() {
        return Err("Choose a video before rendering.".into());
    }
    cancel::begin();
    let output = job_dir(&root_dir(&app), &video).join("xenocut-mix.mp4");
    tauri::async_runtime::spawn_blocking(move || {
        let job = RenderJob {
            video,
            vocals: PathBuf::from(request.vocals_path),
            music: PathBuf::from(request.music_path),
            output: output.clone(),
            vocal_gain: request.vocal_gain,
            music_gain: request.music_gain,
            music_offset: request.music_offset,
            loop_music: request.loop_music,
            fade_in: request.fade_in,
            fade_out: request.fade_out,
            duration: request.video_duration,
        };
        let renderer = FfmpegRenderer;
        let sink = EmitProgress { app, step: 4 };
        renderer
            .render(&job, &sink)
            .map(|path| RenderResult {
                message: "Render complete".into(),
                output_path: path.display().to_string(),
            })
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}
