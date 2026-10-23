//! Diagnostics: a plain log file in the app log dir, media transport info for the UI and the
//! hidden `XENOCUT_AUTOTEST` hook used to verify playback on a headless box.
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::mediaserver;

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

pub fn init_log(app: &AppHandle) {
    let dir = app.path().app_log_dir().unwrap_or_else(|_| std::env::temp_dir().join("xenocut-logs"));
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("xenocut.log");
    // Keep the file small: start over when it passes 2 MB.
    if std::fs::metadata(&path).map(|m| m.len() > 2_000_000).unwrap_or(false) {
        let _ = std::fs::remove_file(&path);
    }
    let _ = LOG_PATH.set(path);
}

pub fn log(level: &str, message: &str) {
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let line = format!("{ts} [{level}] {message}\n");
    if std::env::var_os("XENOCUT_LOG_STDERR").is_some() {
        eprint!("{line}");
    }
    if let Some(path) = LOG_PATH.get() {
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = f.write_all(line.as_bytes());
        }
    }
}

#[tauri::command]
pub fn client_log(level: String, message: String) {
    log(&level, &message);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTransport {
    /// Base URL ending in `/`; append the percent-encoded absolute path. `None` = use asset://.
    base: Option<String>,
    log_path: Option<String>,
    autotest: Option<String>,
}

#[tauri::command]
pub fn media_transport() -> MediaTransport {
    // XENOCUT_MEDIA_TRANSPORT=asset forces the old asset:// path (used to reproduce the bug).
    let force_asset = std::env::var("XENOCUT_MEDIA_TRANSPORT").map(|v| v == "asset").unwrap_or(false);
    MediaTransport {
        base: if force_asset { None } else { mediaserver::get().map(|s| s.base_url()) },
        log_path: LOG_PATH.get().map(|p| p.display().to_string()),
        autotest: std::env::var("XENOCUT_AUTOTEST").ok().filter(|s| !s.is_empty()),
    }
}

/// Allow extra files (e.g. a finished render) to be played back.
#[tauri::command]
pub fn media_allow(paths: Vec<String>) {
    for p in paths {
        mediaserver::allow(std::path::Path::new(&p));
    }
}

/// Used by the autotest hook to end the run.
#[tauri::command]
pub fn autotest_exit(app: AppHandle, code: i32) {
    log("autotest", &format!("exit {code}"));
    app.exit(code);
}
