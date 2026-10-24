//! Pre-rendered text layer for exports.
//!
//! Titles, subtitles and lyrics are drawn by the frontend (the same canvas code the preview
//! uses, so the export matches what the user sees). For an export the frontend walks the
//! timeline frame by frame, renders a transparent PNG only when the picture changes, and
//! sends the frames here. The list of frames with their on-screen durations becomes an
//! ffconcat file that `export.rs` overlays on top of the graded picture.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Deserialize;

static NEXT: AtomicU64 = AtomicU64::new(1);

/// Where sessions live: `<cache>/textlayer/<session>/`.
pub fn root(cache: &Path) -> PathBuf {
    cache.join("textlayer")
}

pub fn valid_session(session: &str) -> bool {
    !session.is_empty()
        && session.len() <= 40
        && session
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
}

pub fn begin(cache: &Path) -> Result<String, String> {
    let session = format!(
        "t{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    );
    std::fs::create_dir_all(root(cache).join(&session)).map_err(|e| e.to_string())?;
    Ok(session)
}

fn session_dir(cache: &Path, session: &str) -> Result<PathBuf, String> {
    if !valid_session(session) {
        return Err("bad text layer session".into());
    }
    let dir = root(cache).join(session);
    if !dir.is_dir() {
        return Err("text layer session expired".into());
    }
    Ok(dir)
}

pub fn frame_name(index: u32) -> String {
    format!("f{index:06}.png")
}

pub fn write_frame(cache: &Path, session: &str, index: u32, png: &[u8]) -> Result<(), String> {
    if png.len() < 8 || &png[1..4] != b"PNG" {
        return Err("text frame is not a PNG".into());
    }
    let dir = session_dir(cache, session)?;
    std::fs::write(dir.join(frame_name(index)), png).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
pub struct Entry {
    /// Frame file index (`write_frame`).
    pub frame: u32,
    /// Seconds on screen.
    pub duration: f64,
}

/// ffconcat text for `entries`. The last file is repeated so its duration is honoured.
pub fn concat_list(entries: &[Entry]) -> String {
    let mut out = String::from("ffconcat version 1.0\n");
    for entry in entries {
        out.push_str(&format!(
            "file '{}'\nduration {:.6}\n",
            frame_name(entry.frame),
            entry.duration.max(0.0)
        ));
    }
    if let Some(last) = entries.last() {
        out.push_str(&format!("file '{}'\n", frame_name(last.frame)));
    }
    out
}

/// Write the list; returns its path, which goes into `ExportOptions::text_overlay`.
pub fn finish(cache: &Path, session: &str, entries: &[Entry]) -> Result<String, String> {
    finish_named(cache, session, "layer", entries)
}

/// Like `finish`, with a list name (letters, digits, `-`) so one session can hold several lists.
pub fn finish_named(
    cache: &Path,
    session: &str,
    name: &str,
    entries: &[Entry],
) -> Result<String, String> {
    if !valid_session(name) {
        return Err("bad list name".into());
    }
    if entries.is_empty() {
        return Err("empty text layer".into());
    }
    let dir = session_dir(cache, session)?;
    for entry in entries {
        if !dir.join(frame_name(entry.frame)).is_file() {
            return Err(format!("text frame {} is missing", entry.frame));
        }
    }
    let list = dir.join(format!("{name}.ffconcat"));
    std::fs::write(&list, concat_list(entries)).map_err(|e| e.to_string())?;
    Ok(list.display().to_string())
}

pub fn discard(cache: &Path, session: &str) {
    if valid_session(session) {
        let _ = std::fs::remove_dir_all(root(cache).join(session));
    }
}

/// Drop leftovers from earlier runs (crash, killed export).
pub fn clear_stale(cache: &Path) {
    let _ = std::fs::remove_dir_all(root(cache));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concat_list_repeats_the_last_frame() {
        let list = concat_list(&[
            Entry {
                frame: 0,
                duration: 1.5,
            },
            Entry {
                frame: 3,
                duration: 0.033333,
            },
        ]);
        assert_eq!(
            list,
            "ffconcat version 1.0\nfile 'f000000.png'\nduration 1.500000\nfile 'f000003.png'\nduration 0.033333\nfile 'f000003.png'\n"
        );
    }

    #[test]
    fn sessions_validate_names_and_frames() {
        let cache = std::env::temp_dir().join(format!("xenocut-textlayer-{}", std::process::id()));
        let session = begin(&cache).unwrap();
        assert!(valid_session(&session));
        assert!(!valid_session("../etc"));
        assert!(write_frame(&cache, "../x", 0, b"\x89PNG\r\n\x1a\n").is_err());
        assert!(write_frame(&cache, &session, 0, b"not a png").is_err());
        write_frame(&cache, &session, 0, b"\x89PNG\r\n\x1a\n").unwrap();
        assert!(
            finish(
                &cache,
                &session,
                &[Entry {
                    frame: 1,
                    duration: 1.0
                }]
            )
            .is_err()
        );
        let list = finish(
            &cache,
            &session,
            &[Entry {
                frame: 0,
                duration: 1.0,
            }],
        )
        .unwrap();
        assert!(Path::new(&list).is_file());
        discard(&cache, &session);
        assert!(!root(&cache).join(&session).exists());
        let _ = std::fs::remove_dir_all(&cache);
    }
}
