//! Tauri commands for projects, media, export, settings and housekeeping.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::audio::traits::ProgressSink;
use crate::audio::{cancel, model};
use crate::export::{self, ExportOptions};
use crate::media::{self, MediaAssets, ProbeInfo};
use crate::project::{self, Project};
use crate::textlayer;

fn data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("xenocut-data"))
}

fn cache_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("xenocut-cache"))
}

pub fn cache_root(app: &AppHandle) -> PathBuf {
    cache_dir(app)
}

/// Working folder of the audio tools (stems and mixes). Kept where the earlier build put it.
pub fn audio_root(app: &AppHandle) -> PathBuf {
    data_dir(app).join("xenocut")
}

/// Installed plugin packs (see `plugins.rs`); served by the media server for thumbnails.
pub fn plugins_root(app: &AppHandle) -> PathBuf {
    let root = data_dir(app).join("plugins");
    let _ = std::fs::create_dir_all(&root);
    root
}

pub(crate) fn model_dir(app: &AppHandle) -> PathBuf {
    audio_root(app).join("models")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    os: &'static str,
    version: String,
    default_output_dir: String,
    default_project_dir: String,
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    let home = app
        .path()
        .home_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let videos = app
        .path()
        .video_dir()
        .unwrap_or_else(|_| home.join("Videos"));
    let docs = app
        .path()
        .document_dir()
        .unwrap_or_else(|_| home.join("Documents"));
    let mut output = videos.join("XenoCut");
    if cfg!(target_os = "android") {
        // Android 11+ lets apps add their own files to the shared Movies collection without a
        // permission, so exports show up in the gallery. Fall back to app storage otherwise.
        let shared = PathBuf::from("/storage/emulated/0/Movies/XenoCut");
        output = if std::fs::create_dir_all(&shared).is_ok() {
            shared
        } else {
            data_dir(&app).join("exports")
        };
    }
    AppInfo {
        os: std::env::consts::OS,
        version: app.package_info().version.to_string(),
        default_output_dir: output.display().to_string(),
        default_project_dir: docs.join("XenoCut").display().to_string(),
    }
}

// ---------- small JSON stores (settings, recent projects) ----------

fn store_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    match name {
        "settings" | "recent" => Ok(data_dir(app).join(format!("{name}.json"))),
        _ => Err(format!("unknown store {name}")),
    }
}

#[tauri::command]
pub fn store_read(app: AppHandle, name: String) -> Result<Option<serde_json::Value>, String> {
    let path = store_path(&app, &name)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(serde_json::from_str(&text).ok()),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn store_write(app: AppHandle, name: String, value: serde_json::Value) -> Result<(), String> {
    let path = store_path(&app, &name)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(
        &tmp,
        serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn paths_exist(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| Path::new(p).exists()).collect()
}

// ---------- projects ----------

#[tauri::command]
pub fn project_new_path(dir: String, name: String) -> Result<String, String> {
    let dir = PathBuf::from(dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    Ok(project::unique_path(&dir, &name).display().to_string())
}

#[tauri::command]
pub async fn project_save(path: String, project: Project) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || project::save(Path::new(&path), &project))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn project_load(path: String) -> Result<Project, String> {
    let project = tauri::async_runtime::spawn_blocking(move || project::load(Path::new(&path)))
        .await
        .map_err(|e| e.to_string())??;
    for item in &project.media {
        crate::mediaserver::allow(Path::new(&item.path));
    }
    Ok(project)
}

// ---------- media ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeOutcome {
    items: Vec<ProbeInfo>,
    errors: Vec<String>,
}

/// Probe files (folders are expanded one level). Unreadable files are reported, not fatal.
#[tauri::command]
pub async fn media_probe(paths: Vec<String>) -> Result<ProbeOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut items = Vec::new();
        let mut errors = Vec::new();
        for raw in paths {
            let expanded = media::expand_dir(Path::new(&raw));
            if expanded.is_empty() {
                errors.push(format!("{raw}: unsupported file type"));
            }
            for path in expanded {
                match media::probe(&path) {
                    Ok(info) => {
                        crate::mediaserver::allow(&path);
                        items.push(info)
                    }
                    Err(err) => errors.push(err),
                }
            }
        }
        ProbeOutcome { items, errors }
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn media_assets(
    app: AppHandle,
    path: String,
    kind: project::MediaKind,
    duration: f64,
    has_audio: bool,
) -> Result<MediaAssets, String> {
    let cache = cache_dir(&app);
    tauri::async_runtime::spawn_blocking(move || {
        media::assets(&cache, Path::new(&path), kind, duration, has_audio)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn media_proxy(
    app: AppHandle,
    path: String,
    codec: Option<media::ProxyCodec>,
    video: Option<bool>,
) -> Result<String, String> {
    let cache = cache_dir(&app);
    let codec = codec.unwrap_or(media::ProxyCodec::H264);
    let video = video.unwrap_or(true);
    tauri::async_runtime::spawn_blocking(move || {
        media::proxy(&cache, Path::new(&path), codec, video)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheInfo {
    bytes: u64,
    path: String,
}

fn cache_dirs(app: &AppHandle) -> Vec<PathBuf> {
    vec![cache_dir(app).join("media"), audio_root(app).join("jobs")]
}

#[tauri::command]
pub async fn cache_info(app: AppHandle) -> Result<CacheInfo, String> {
    let dirs = cache_dirs(&app);
    let path = cache_dir(&app).display().to_string();
    tauri::async_runtime::spawn_blocking(move || CacheInfo {
        bytes: dirs.iter().map(|d| media::dir_size(d)).sum(),
        path,
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cache_clear(app: AppHandle) -> Result<(), String> {
    let dirs = cache_dirs(&app);
    tauri::async_runtime::spawn_blocking(move || {
        for dir in dirs {
            if dir.exists() {
                std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- export ----------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportProgress {
    progress: f32,
    message: String,
}

pub(crate) struct ExportSink {
    pub(crate) app: AppHandle,
    pub(crate) event: &'static str,
}

impl ProgressSink for ExportSink {
    fn report(&self, amount: f32, message: &str) {
        let _ = self.app.emit(
            self.event,
            ExportProgress {
                progress: amount.clamp(0.0, 1.0),
                message: message.into(),
            },
        );
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    path: String,
    bytes: u64,
}

#[tauri::command]
pub async fn export_start(
    app: AppHandle,
    project: Project,
    options: ExportOptions,
) -> Result<ExportResult, String> {
    cancel::begin();
    tauri::async_runtime::spawn_blocking(move || {
        let sink = ExportSink {
            app,
            event: "export-progress",
        };
        export::run(&project, &options, &sink)
            .map(|p| ExportResult {
                bytes: std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0),
                path: p.display().to_string(),
            })
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn export_cancel() {
    cancel::request();
}

// ---------- text layer (pre-rendered titles for exports) ----------

#[tauri::command]
pub fn text_layer_begin(app: AppHandle) -> Result<String, String> {
    textlayer::begin(&cache_root(&app))
}

/// Raw PNG body; headers `x-session` and `x-frame`.
#[tauri::command]
pub fn text_layer_frame(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
    };
    let session = header("x-session").ok_or("missing x-session")?;
    let frame: u32 = header("x-frame")
        .and_then(|v| v.parse().ok())
        .ok_or("missing x-frame")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("text frame must be sent as raw bytes".into());
    };
    textlayer::write_frame(&cache_root(&app), &session, frame, bytes)
}

#[tauri::command]
pub fn text_layer_finish(
    app: AppHandle,
    session: String,
    entries: Vec<textlayer::Entry>,
    name: Option<String>,
) -> Result<String, String> {
    let name = name.unwrap_or_else(|| "layer".into());
    textlayer::finish_named(&cache_root(&app), &session, &name, &entries)
}

/// Render the two sides of every shader transition into the frame session `session`
/// (`<session>/src/tN/from_*.png`, `to_*.png`); the frontend blends them with the GLSL.
#[tauri::command]
pub async fn transition_sources(
    app: AppHandle,
    project: Project,
    session: String,
    width: u32,
    height: u32,
    fps: u32,
) -> Result<Vec<export::TransitionSource>, String> {
    if !textlayer::valid_session(&session) {
        return Err("bad session".into());
    }
    let dir = textlayer::root(&cache_root(&app)).join(&session);
    if !dir.is_dir() {
        return Err("session expired".into());
    }
    cancel::begin();
    tauri::async_runtime::spawn_blocking(move || {
        export::transition_sources(&project, width, height, fps, &dir.join("src"))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// One source frame of a shader transition as PNG bytes (no file URLs: works with any transport).
#[tauri::command]
pub fn transition_source_frame(
    app: AppHandle,
    session: String,
    transition: u32,
    side: String,
    frame: u32,
) -> Result<tauri::ipc::Response, String> {
    textlayer::read_source_frame(&cache_root(&app), &session, transition, &side, frame)
        .map(tauri::ipc::Response::new)
}

#[tauri::command]
pub fn text_layer_discard(app: AppHandle, session: String) {
    textlayer::discard(&cache_root(&app), &session);
}

// ---------- stem model ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    installed: bool,
    bytes: u64,
    path: String,
    name: &'static str,
}

#[tauri::command]
pub fn model_status(app: AppHandle) -> ModelStatus {
    let path = model::model_path(&model_dir(&app));
    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    ModelStatus {
        installed: bytes > 0,
        bytes,
        path: path.display().to_string(),
        name: model::MODEL_FILE,
    }
}

#[tauri::command]
pub async fn model_download(app: AppHandle) -> Result<(), String> {
    cancel::begin();
    let dir = model_dir(&app);
    tauri::async_runtime::spawn_blocking(move || {
        let sink = ExportSink {
            app,
            event: "model-progress",
        };
        model::ensure_model(&dir, &sink)
            .map(|_| ())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn model_delete(app: AppHandle) -> Result<(), String> {
    let path = model::model_path(&model_dir(&app));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn plugin_store(app: &AppHandle) -> crate::plugins::Store {
    crate::plugins::Store::new(plugins_root(app))
}

#[tauri::command]
pub fn plugin_list(app: AppHandle) -> Vec<crate::plugins::Installed> {
    plugin_store(&app).list()
}

#[tauri::command]
pub async fn plugin_install(
    app: AppHandle,
    path: String,
) -> Result<crate::plugins::Installed, String> {
    let store = plugin_store(&app);
    tauri::async_runtime::spawn_blocking(move || store.install_path(std::path::Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn plugin_install_url(
    app: AppHandle,
    url: String,
    sha256: String,
) -> Result<crate::plugins::Installed, String> {
    let store = plugin_store(&app);
    tauri::async_runtime::spawn_blocking(move || crate::plugins::install_url(&store, &url, &sha256))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn plugin_export(manifest: crate::plugins::Manifest, path: String) -> Result<(), String> {
    crate::plugins::export_pack(&manifest, std::path::Path::new(&path))
}

#[tauri::command]
pub fn plugin_remove(app: AppHandle, id: String) -> Result<(), String> {
    plugin_store(&app).remove(&id)
}

#[tauri::command]
pub fn plugin_set_enabled(app: AppHandle, id: String, enabled: bool) -> Result<(), String> {
    plugin_store(&app).set_enabled(&id, enabled)
}

#[tauri::command]
pub fn plugin_lut(app: AppHandle, path: String) -> Result<crate::plugins::Cube, String> {
    plugin_store(&app).lut(std::path::Path::new(&path))
}

#[tauri::command]
pub fn plugin_asset(app: AppHandle, path: String) -> Result<String, String> {
    plugin_store(&app).asset_text(std::path::Path::new(&path))
}

#[tauri::command]
pub async fn plugin_catalog() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(crate::plugins::fetch_catalog)
        .await
        .map_err(|e| e.to_string())?
}
