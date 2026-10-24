//! Android file pickers hand out `content://` URIs that neither FFmpeg nor the media server can
//! open. We copy each picked document into app storage once and work with the copy from then on.
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::str::FromStr;

use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};

use crate::{app, diag, mediaserver};

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&text[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Best-effort readable name from the URI, e.g. `primary%3AMovies%2Fclip.mp4` -> `clip.mp4`.
pub fn name_hint(uri: &str) -> Option<String> {
    let decoded = percent_decode(uri.rsplit('/').next()?);
    let name = decoded.rsplit(['/', ':']).next()?.trim().to_string();
    let sane: String = name
        .chars()
        .filter(|c| !matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    (!sane.is_empty()).then_some(sane)
}

/// File type from the first bytes, so pickers that hide the extension still classify correctly.
pub fn sniff_ext(head: &[u8]) -> Option<&'static str> {
    let at = |o: usize, s: &[u8]| head.len() >= o + s.len() && &head[o..o + s.len()] == s;
    if at(4, b"ftyp") {
        return Some(if at(8, b"M4A ") || at(8, b"M4B ") {
            "m4a"
        } else if at(8, b"qt  ") {
            "mov"
        } else if at(8, b"3gp") {
            "3gp"
        } else {
            "mp4"
        });
    }
    if at(0, &[0x1A, 0x45, 0xDF, 0xA3]) {
        return Some(if head.windows(4).any(|w| w == b"webm") {
            "webm"
        } else {
            "mkv"
        });
    }
    if at(0, b"RIFF") && at(8, b"WAVE") {
        return Some("wav");
    }
    if at(0, b"RIFF") && at(8, b"WEBP") {
        return Some("webp");
    }
    if at(0, b"RIFF") && at(8, b"AVI ") {
        return Some("avi");
    }
    if at(0, b"ID3")
        || (head.len() > 1 && head[0] == 0xFF && head[1] & 0xE0 == 0xE0 && head[1] & 0x06 != 0)
    {
        return Some(if head.len() > 1 && head[1] & 0x06 == 0 {
            "aac"
        } else {
            "mp3"
        });
    }
    if head.len() > 1 && head[0] == 0xFF && (head[1] & 0xF6) == 0xF0 {
        return Some("aac");
    }
    if at(0, b"fLaC") {
        return Some("flac");
    }
    if at(0, b"OggS") {
        return Some(if head.windows(4).any(|w| w == b"Opus") {
            "opus"
        } else {
            "ogg"
        });
    }
    if at(0, &[0x89, b'P', b'N', b'G']) {
        return Some("png");
    }
    if at(0, &[0xFF, 0xD8, 0xFF]) {
        return Some("jpg");
    }
    if at(0, b"GIF8") {
        return Some("gif");
    }
    if at(0, b"BM") {
        return Some("bmp");
    }
    None
}

fn import_one(app: &AppHandle, uri: &str, dir: &Path) -> Result<PathBuf, String> {
    let path = FilePath::from_str(uri).map_err(|e| e.to_string())?;
    let mut opts = OpenOptions::new();
    opts.read(true);
    let mut file = app
        .fs()
        .open(path, opts)
        .map_err(|e| format!("open {uri}: {e}"))?;
    let mut head = vec![0u8; 64];
    let mut got = 0;
    while got < head.len() {
        let n = file.read(&mut head[got..]).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        got += n;
    }
    head.truncate(got);

    let hint = name_hint(uri).unwrap_or_else(|| "media".into());
    let has_ext = Path::new(&hint).extension().is_some();
    let stem = Path::new(&hint)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "media".into());
    let ext = if has_ext {
        Path::new(&hint)
            .extension()
            .unwrap()
            .to_string_lossy()
            .to_lowercase()
    } else {
        sniff_ext(&head).unwrap_or("bin").to_string()
    };
    let tag = hex(&Sha256::digest(uri.as_bytes())[..4]);
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let target = dir.join(format!("{stem}-{tag}.{ext}"));
    if target.is_file() {
        return Ok(target);
    }
    let partial = target.with_extension(format!("{ext}.part"));
    let mut out = std::fs::File::create(&partial).map_err(|e| e.to_string())?;
    out.write_all(&head).map_err(|e| e.to_string())?;
    std::io::copy(&mut file, &mut out).map_err(|e| e.to_string())?;
    out.flush().map_err(|e| e.to_string())?;
    drop(out);
    std::fs::rename(&partial, &target).map_err(|e| e.to_string())?;
    Ok(target)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Copies picked `content://` documents into app storage and returns plain file paths.
/// Plain paths pass through untouched.
#[tauri::command]
pub async fn import_content_uris(app: AppHandle, uris: Vec<String>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = app::audio_root(&app).join("imports");
        let mut out = Vec::new();
        for uri in uris {
            if !uri.starts_with("content://") {
                out.push(uri);
                continue;
            }
            match import_one(&app, &uri, &dir) {
                Ok(path) => {
                    mediaserver::allow(&path);
                    diag::log("info", &format!("imported {uri} -> {}", path.display()));
                    out.push(path.to_string_lossy().into_owned());
                }
                Err(err) => {
                    diag::log("error", &format!("import failed: {err}"));
                    return Err(err);
                }
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_and_sniffing() {
        assert_eq!(name_hint("content://com.android.externalstorage.documents/document/primary%3AMovies%2Fclip.mp4").as_deref(), Some("clip.mp4"));
        assert_eq!(
            name_hint("content://media/external/video/media/42").as_deref(),
            Some("42")
        );
        assert_eq!(sniff_ext(b"\0\0\0\x20ftypisom\0\0"), Some("mp4"));
        assert_eq!(sniff_ext(b"\0\0\0\x20ftypM4A \0\0"), Some("m4a"));
        assert_eq!(sniff_ext(b"ID3\x04"), Some("mp3"));
        assert_eq!(sniff_ext(b"RIFF\0\0\0\0WAVEfmt "), Some("wav"));
        assert_eq!(sniff_ext(&[0x89, b'P', b'N', b'G', 0x0D]), Some("png"));
    }
}
