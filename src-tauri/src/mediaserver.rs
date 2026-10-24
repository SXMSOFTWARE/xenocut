//! Loopback HTTP server for media playback.
//!
//! WebKitGTK plays `<video>`/`<audio>` through GStreamer, which needs byte-range requests to
//! probe and seek. Tauri's custom `asset://` scheme does not give it that reliably on Linux, so
//! media never reaches HAVE_METADATA. This server listens on 127.0.0.1 (random port), requires a
//! per-session random token as the first path segment, serves only files that were imported
//! (or live under the app's own cache/job folders), answers `Range` with 206, and streams in
//! chunks.
use std::collections::HashSet;
use std::fs::File;
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

const CHUNK: usize = 256 * 1024;

pub struct MediaServer {
    port: u16,
    token: String,
    allowed: Mutex<HashSet<PathBuf>>,
    roots: Mutex<Vec<PathBuf>>,
}

static SERVER: OnceLock<MediaServer> = OnceLock::new();

fn random_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut out = String::new();
    for salt in 0..4u64 {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(salt);
        h.write_u128(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
        );
        h.write_u32(std::process::id());
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

fn canonical(path: &Path) -> Option<PathBuf> {
    std::fs::canonicalize(path).ok()
}

/// Start the server once. `roots` are folders whose files are always allowed (app cache, jobs).
pub fn start(roots: Vec<PathBuf>) -> io::Result<&'static MediaServer> {
    if let Some(server) = SERVER.get() {
        return Ok(server);
    }
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    let server = MediaServer {
        port,
        token: random_token(),
        allowed: Mutex::new(HashSet::new()),
        roots: Mutex::new(
            roots
                .iter()
                .filter_map(|r| {
                    let _ = std::fs::create_dir_all(r);
                    canonical(r)
                })
                .collect(),
        ),
    };
    let server = SERVER.get_or_init(|| server);
    std::thread::Builder::new()
        .name("media-server".into())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                let _ = std::thread::Builder::new()
                    .name("media-conn".into())
                    .spawn(move || {
                        if let Some(server) = SERVER.get() {
                            let _ = server.serve(stream);
                        }
                    });
            }
        })?;
    Ok(server)
}

pub fn get() -> Option<&'static MediaServer> {
    SERVER.get()
}

/// Allow a file (imported media, a render result) to be served.
pub fn allow(path: &Path) {
    if let (Some(server), Some(path)) = (SERVER.get(), canonical(path)) {
        server.allowed.lock().unwrap().insert(path);
    }
}

pub fn allow_root(path: &Path) {
    if let Some(server) = SERVER.get() {
        let _ = std::fs::create_dir_all(path);
        if let Some(path) = canonical(path) {
            server.roots.lock().unwrap().push(path);
        }
    }
}

pub fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "3gp" => "video/3gpp",
        "mts" | "m2ts" | "ts" => "video/mp2t",
        "wmv" => "video/x-ms-wmv",
        "flv" => "video/x-flv",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        "ogg" | "opus" => "audio/ogg",
        "wma" => "audio/x-ms-wma",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        _ => "application/octet-stream",
    }
}

fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                i += 3;
            }
            b'%' => return None,
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

/// Parse a single `bytes=` range against a file length. Returns (start, end inclusive).
pub fn parse_range(header: &str, len: u64) -> Option<(u64, u64)> {
    let spec = header.trim().strip_prefix("bytes=")?;
    let first = spec.split(',').next()?.trim();
    let (a, b) = first.split_once('-')?;
    if len == 0 {
        return None;
    }
    if a.is_empty() {
        let n: u64 = b.parse().ok()?;
        if n == 0 {
            return None;
        }
        return Some((len.saturating_sub(n), len - 1));
    }
    let start: u64 = a.parse().ok()?;
    if start >= len {
        return None;
    }
    let end = if b.is_empty() {
        len - 1
    } else {
        b.parse::<u64>().ok()?.min(len - 1)
    };
    if end < start {
        return None;
    }
    Some((start, end))
}

impl MediaServer {
    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}/{}/", self.port, self.token)
    }

    fn permitted(&self, path: &Path) -> Option<PathBuf> {
        let path = canonical(path)?;
        if !path.is_file() {
            return None;
        }
        if self.allowed.lock().unwrap().contains(&path) {
            return Some(path);
        }
        if self
            .roots
            .lock()
            .unwrap()
            .iter()
            .any(|r| path.starts_with(r))
        {
            return Some(path);
        }
        None
    }

    fn serve(&self, stream: TcpStream) -> io::Result<()> {
        stream.set_read_timeout(Some(Duration::from_secs(60)))?;
        stream.set_nodelay(true)?;
        let mut writer = stream.try_clone()?;
        let mut reader = BufReader::new(stream);
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line)? == 0 {
                return Ok(());
            }
            let mut parts = line.split_whitespace();
            let method = parts.next().unwrap_or("").to_string();
            let target = parts.next().unwrap_or("").to_string();
            let mut range = None;
            let mut close = false;
            loop {
                let mut h = String::new();
                if reader.read_line(&mut h)? == 0 {
                    return Ok(());
                }
                let h = h.trim_end();
                if h.is_empty() {
                    break;
                }
                if let Some((k, v)) = h.split_once(':') {
                    let k = k.trim().to_ascii_lowercase();
                    if k == "range" {
                        range = Some(v.trim().to_string());
                    } else if k == "connection" && v.trim().eq_ignore_ascii_case("close") {
                        close = true;
                    }
                }
            }
            self.respond(&mut writer, &method, &target, range.as_deref())?;
            if close {
                return Ok(());
            }
        }
    }

    fn respond(
        &self,
        out: &mut TcpStream,
        method: &str,
        target: &str,
        range: Option<&str>,
    ) -> io::Result<()> {
        const COMMON: &str = "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Range\r\nAccess-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges\r\nCache-Control: no-store\r\n";
        let simple = |out: &mut TcpStream, status: &str| -> io::Result<()> {
            write!(
                out,
                "HTTP/1.1 {status}\r\n{COMMON}Content-Length: 0\r\n\r\n"
            )
        };
        if method == "OPTIONS" {
            return simple(out, "204 No Content");
        }
        if method != "GET" && method != "HEAD" {
            return simple(out, "405 Method Not Allowed");
        }
        let target = target.split('?').next().unwrap_or("");
        let rest = target
            .strip_prefix('/')
            .and_then(|t| t.strip_prefix(self.token.as_str()))
            .and_then(|t| t.strip_prefix('/'));
        let Some(encoded) = rest else {
            return simple(out, "403 Forbidden");
        };
        let Some(path) = percent_decode(encoded)
            .map(PathBuf::from)
            .and_then(|p| self.permitted(&p))
        else {
            return simple(out, "404 Not Found");
        };
        let mut file = match File::open(&path) {
            Ok(f) => f,
            Err(_) => return simple(out, "404 Not Found"),
        };
        let len = file.metadata()?.len();
        let ctype = content_type(&path);
        let (status, start, end) = match range {
            Some(r) => match parse_range(r, len) {
                Some((s, e)) => ("206 Partial Content", s, e),
                None => {
                    return write!(
                        out,
                        "HTTP/1.1 416 Range Not Satisfiable\r\n{COMMON}Content-Range: bytes */{len}\r\nContent-Length: 0\r\n\r\n"
                    );
                }
            },
            None => ("200 OK", 0, len.saturating_sub(1)),
        };
        let body_len = if len == 0 { 0 } else { end - start + 1 };
        let mut head = format!(
            "HTTP/1.1 {status}\r\n{COMMON}Content-Type: {ctype}\r\nAccept-Ranges: bytes\r\nContent-Length: {body_len}\r\n"
        );
        if status.starts_with("206") {
            head.push_str(&format!("Content-Range: bytes {start}-{end}/{len}\r\n"));
        }
        head.push_str("\r\n");
        out.write_all(head.as_bytes())?;
        if method == "HEAD" || body_len == 0 {
            return Ok(());
        }
        file.seek(SeekFrom::Start(start))?;
        let mut left = body_len;
        let mut buf = vec![0u8; CHUNK];
        while left > 0 {
            let want = left.min(CHUNK as u64) as usize;
            let n = file.read(&mut buf[..want])?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n])?;
            left -= n as u64;
        }
        out.flush()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-", 100), Some((0, 99)));
        assert_eq!(parse_range("bytes=10-19", 100), Some((10, 19)));
        assert_eq!(parse_range("bytes=90-200", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=-10", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=100-", 100), None);
        assert_eq!(parse_range("bytes=5-1", 100), None);
        assert_eq!(parse_range("items=0-1", 100), None);
    }

    #[test]
    fn decodes_paths() {
        assert_eq!(
            percent_decode("%2Fhome%2Fa%20b.mp4").as_deref(),
            Some("/home/a b.mp4")
        );
        assert_eq!(percent_decode("%2"), None);
    }

    #[test]
    fn serves_allowed_files_with_ranges() {
        let dir = std::env::temp_dir().join(format!("xc-ms-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("clip.mp4");
        std::fs::write(&file, (0..=255u8).cycle().take(10_000).collect::<Vec<_>>()).unwrap();
        let other = std::env::temp_dir().join(format!("xc-ms-other-{}.mp4", std::process::id()));
        std::fs::write(&other, b"secret").unwrap();
        let server = start(vec![]).unwrap();
        allow(&file);
        let url = |p: &Path| {
            let enc: String = p
                .to_str()
                .unwrap()
                .bytes()
                .map(|b| {
                    if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
                        (b as char).to_string()
                    } else {
                        format!("%{b:02X}")
                    }
                })
                .collect();
            format!("/{}/{}", server.token, enc)
        };
        let get = |path: &str, range: Option<&str>| -> (String, Vec<u8>) {
            let mut s = TcpStream::connect(("127.0.0.1", server.port)).unwrap();
            let r = range.map(|r| format!("Range: {r}\r\n")).unwrap_or_default();
            write!(
                s,
                "GET {path} HTTP/1.1\r\nHost: x\r\n{r}Connection: close\r\n\r\n"
            )
            .unwrap();
            let mut all = Vec::new();
            s.read_to_end(&mut all).unwrap();
            let split = all.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
            (
                String::from_utf8_lossy(&all[..split]).to_string(),
                all[split + 4..].to_vec(),
            )
        };
        let (h, body) = get(&url(&file), Some("bytes=100-199"));
        assert!(h.starts_with("HTTP/1.1 206"), "{h}");
        assert!(h.contains("Content-Range: bytes 100-199/10000"));
        assert!(h.contains("Content-Type: video/mp4"));
        assert_eq!(body.len(), 100);
        assert_eq!(body[0], 100);
        let (h, body) = get(&url(&file), None);
        assert!(h.starts_with("HTTP/1.1 200"));
        assert_eq!(body.len(), 10_000);
        let (h, _) = get(&url(&other), None);
        assert!(h.starts_with("HTTP/1.1 404"), "not allowlisted: {h}");
        let (h, _) = get(
            &format!("/wrongtoken/{}", &url(&file)[server.token.len() + 2..]),
            None,
        );
        assert!(h.starts_with("HTTP/1.1 403"));
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_file(&other);
    }
}
