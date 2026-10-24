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
    let dir = app
        .path()
        .app_log_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("xenocut-logs"));
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("xenocut.log");
    // Keep the file small: start over when it passes 2 MB.
    if std::fs::metadata(&path)
        .map(|m| m.len() > 2_000_000)
        .unwrap_or(false)
    {
        let _ = std::fs::remove_file(&path);
    }
    let _ = LOG_PATH.set(path);
}

pub fn log(level: &str, message: &str) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let line = format!("{ts} [{level}] {message}\n");
    if std::env::var_os("XENOCUT_LOG_STDERR").is_some() {
        eprint!("{line}");
    }
    if let Some(path) = LOG_PATH.get() {
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
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
    /// Extra autotest knobs, `key=value,key=value` (grade, perf, secs).
    autotest_opts: Option<String>,
    /// `XENOCUT_AUDIOCHECK=<media>|<export.mp4>`: a normal (never muted) run that logs the preview audio state.
    audiocheck: Option<String>,
}

/// Test hooks come only from their env vars; a normal launch has none, so nothing is ever muted.
fn test_hooks(
    get: impl Fn(&str) -> Option<String>,
) -> (Option<String>, Option<String>, Option<String>) {
    let var = |k: &str| get(k).filter(|s| !s.is_empty());
    (
        var("XENOCUT_AUTOTEST"),
        var("XENOCUT_AUTOTEST_OPTS"),
        var("XENOCUT_AUDIOCHECK"),
    )
}

#[tauri::command]
pub fn media_transport() -> MediaTransport {
    // XENOCUT_MEDIA_TRANSPORT=asset forces the old asset:// path (used to reproduce the bug).
    let force_asset = std::env::var("XENOCUT_MEDIA_TRANSPORT")
        .map(|v| v == "asset")
        .unwrap_or(false);
    let (autotest, autotest_opts, audiocheck) = test_hooks(|k| std::env::var(k).ok());
    MediaTransport {
        base: if force_asset {
            None
        } else {
            mediaserver::get().map(|s| s.base_url())
        },
        log_path: LOG_PATH.get().map(|p| p.display().to_string()),
        autotest,
        autotest_opts,
        audiocheck,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normal_runs_have_no_test_hooks() {
        assert_eq!(test_hooks(|_| None), (None, None, None));
        // An empty var is the same as unset.
        assert_eq!(test_hooks(|_| Some(String::new())), (None, None, None));
        let only_audiocheck =
            test_hooks(|k| (k == "XENOCUT_AUDIOCHECK").then(|| "a.mp4|b.mp4".to_string()));
        assert_eq!(
            only_audiocheck.0, None,
            "the audio check must not enable the (muted) autotest"
        );
        let autotest = test_hooks(|k| (k == "XENOCUT_AUTOTEST").then(|| "a.mp4".to_string()));
        assert_eq!(autotest.0.as_deref(), Some("a.mp4"));
    }
}
