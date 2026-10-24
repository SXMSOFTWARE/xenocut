//! Media probing and cached preview assets (poster thumbnail, filmstrip sprite, waveform).
//! Everything is produced by the FFmpeg sidecar and cached by path + size + mtime.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::audio::ffmpeg;
use crate::project::MediaKind;

pub const STRIP_FRAME_W: u32 = 96;
pub const STRIP_FRAME_H: u32 = 54;
const CACHE_VERSION: &str = "1";

const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff"];
const AUDIO_EXT: &[&str] = &["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "wma"];
pub const VIDEO_EXT: &[&str] = &[
    "mp4", "mov", "mkv", "webm", "m4v", "avi", "mts", "m2ts", "3gp", "wmv", "flv",
];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProbeInfo {
    pub path: String,
    pub name: String,
    pub kind: MediaKind,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub has_audio: bool,
    pub has_video: bool,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaAssets {
    pub thumb: Option<String>,
    pub strip: Option<String>,
    pub strip_count: u32,
    pub strip_frame_w: u32,
    pub strip_frame_h: u32,
    pub wave: Option<String>,
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

pub fn is_supported(path: &Path) -> bool {
    let ext = extension(path);
    IMAGE_EXT.contains(&ext.as_str())
        || AUDIO_EXT.contains(&ext.as_str())
        || VIDEO_EXT.contains(&ext.as_str())
}

/// Parse the stream summary FFmpeg prints for `ffmpeg -i <file>`.
pub fn parse_probe(text: &str, ext: &str) -> (MediaKind, f64, u32, u32, f64, bool, bool) {
    let duration = ffmpeg::parse_duration(text).unwrap_or(0.0);
    let mut width = 0;
    let mut height = 0;
    let mut fps = 0.0;
    let mut has_video = false;
    let mut has_audio = false;
    for line in text.lines() {
        let line = line.trim();
        if !line.starts_with("Stream #") {
            continue;
        }
        if let Some(rest) = line.split(": Video: ").nth(1) {
            if line.contains("(attached pic)") {
                continue;
            }
            if !has_video {
                has_video = true;
                for part in rest.split(',') {
                    let part = part.trim();
                    let token = part.split_whitespace().next().unwrap_or("");
                    if width == 0 {
                        if let Some((w, h)) = token.split_once('x') {
                            if let (Ok(w), Ok(h)) = (w.parse::<u32>(), h.parse::<u32>()) {
                                width = w;
                                height = h;
                                continue;
                            }
                        }
                    }
                    if let Some(value) = part.strip_suffix(" fps") {
                        fps = value.trim().parse().unwrap_or(fps);
                    } else if fps == 0.0 {
                        if let Some(value) = part.strip_suffix(" tbr") {
                            fps = value.trim().parse().unwrap_or(0.0);
                        }
                    }
                }
            }
        } else if line.contains(": Audio: ") {
            has_audio = true;
        }
    }
    if text.contains("rotation of -90")
        || text.contains("rotation of 90")
        || text.contains("rotation of 270")
    {
        std::mem::swap(&mut width, &mut height);
    }
    let kind = if IMAGE_EXT.contains(&ext) {
        MediaKind::Image
    } else if has_video {
        MediaKind::Video
    } else {
        MediaKind::Audio
    };
    let duration = if kind == MediaKind::Image {
        0.0
    } else {
        duration
    };
    (
        kind,
        duration,
        width,
        height,
        fps,
        has_audio,
        has_video && kind != MediaKind::Audio,
    )
}

pub fn probe(path: &Path) -> Result<ProbeInfo, String> {
    let meta = std::fs::metadata(path).map_err(|err| format!("{}: {err}", path.display()))?;
    if !meta.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    let bin = ffmpeg::ffmpeg_binary().map_err(|err| err.to_string())?;
    let output = Command::new(bin)
        .args(["-hide_banner", "-i"])
        .arg(path)
        .output()
        .map_err(|err| err.to_string())?;
    let text = String::from_utf8_lossy(&output.stderr);
    if text.contains("Invalid data found") || !text.contains("Stream #") {
        return Err(format!(
            "{} is not a media file FFmpeg can read",
            file_name(path)
        ));
    }
    let ext = extension(path);
    let (kind, duration, width, height, fps, has_audio, has_video) = parse_probe(&text, &ext);
    if kind != MediaKind::Image && duration <= 0.0 {
        return Err(format!(
            "Could not read the duration of {}",
            file_name(path)
        ));
    }
    if kind == MediaKind::Audio && !has_audio {
        return Err(format!("{} has no audio or video stream", file_name(path)));
    }
    Ok(ProbeInfo {
        path: path.display().to_string(),
        name: file_name(path),
        kind,
        duration,
        width,
        height,
        fps,
        has_audio,
        has_video,
        size_bytes: meta.len(),
    })
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("media")
        .to_string()
}

fn cache_key(path: &Path) -> String {
    let meta = std::fs::metadata(path).ok();
    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let mtime = meta
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut hasher = Sha256::new();
    hasher.update(CACHE_VERSION.as_bytes());
    hasher.update(path.display().to_string().as_bytes());
    hasher.update(size.to_le_bytes());
    hasher.update(mtime.to_le_bytes());
    hasher
        .finalize()
        .iter()
        .take(12)
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Number of frames in a filmstrip sprite: about one per second, 6..=60.
pub fn strip_count(duration: f64) -> u32 {
    (duration.ceil() as u32).clamp(6, 60)
}

pub fn thumb_args(input: &Path, kind: MediaKind, duration: f64, out: &Path) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-y".into(),
    ];
    if kind == MediaKind::Video {
        let at = (duration * 0.1).min(1.0);
        args.extend(["-ss".into(), format!("{at:.3}")]);
    }
    args.extend([
        "-i".into(),
        input.display().to_string(),
        "-frames:v".into(),
        "1".into(),
        "-an".into(),
        "-vf".into(),
        "scale=320:320:force_original_aspect_ratio=decrease".into(),
        "-q:v".into(),
        "4".into(),
        out.display().to_string(),
    ]);
    args
}

pub fn strip_args(input: &Path, duration: f64, count: u32, out: &Path) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-y".into(),
    ];
    // Long sources only decode keyframes, which keeps a one-hour file to a few seconds of work.
    if duration > 180.0 {
        args.extend(["-skip_frame".into(), "nokey".into()]);
    }
    let (w, h) = (STRIP_FRAME_W, STRIP_FRAME_H);
    args.extend([
        "-i".into(),
        input.display().to_string(),
        "-an".into(),
        "-vf".into(),
        format!(
            "fps=fps={count}/{duration:.3},scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,tile={count}x1"
        ),
        "-frames:v".into(),
        "1".into(),
        "-q:v".into(),
        "5".into(),
        out.display().to_string(),
    ]);
    args
}

pub fn wave_args(input: &Path, duration: f64, out: &Path) -> Vec<String> {
    let width = ((duration * 40.0) as u32).clamp(300, 6000);
    vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-y".into(),
        "-i".into(),
        input.display().to_string(),
        "-vn".into(),
        "-filter_complex".into(),
        format!("aformat=channel_layouts=mono,showwavespic=s={width}x64:colors=white:scale=sqrt"),
        "-frames:v".into(),
        "1".into(),
        out.display().to_string(),
    ]
}

/// Height of the optional low-resolution preview copy.
pub const PROXY_HEIGHT: u32 = 540;

/// Which codecs a preview proxy is written in.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProxyCodec {
    /// H.264 + AAC in MP4: the light default where the web view can decode H.264.
    H264,
    /// VP8 + Opus in WebM. Some Linux builds (e.g. the AppImage's bundled GStreamer) ship VP8/Opus
    /// decoders but no H.264/AAC ones; this is what those can always play.
    Webm,
}

impl ProxyCodec {
    fn extension(self) -> &'static str {
        match self {
            ProxyCodec::H264 => "mp4",
            ProxyCodec::Webm => "webm",
        }
    }
}

/// A light 540p copy for preview only (exports always read the original). Keyframes every
/// half second keep scrubbing cheap; MP4s get `faststart` so playback begins before the file is
/// read. Audio-only inputs (`video == false`) keep just the sound.
pub fn proxy_args(input: &Path, out: &Path, codec: ProxyCodec, video: bool) -> Vec<String> {
    let mut args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-y", "-i"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    args.push(input.display().to_string());
    let mut push = |items: &[&str]| args.extend(items.iter().map(|s| s.to_string()));
    if video {
        push(&["-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn"]);
        push(&[
            "-vf",
            &format!("scale=-2:'min({PROXY_HEIGHT},ih)',format=yuv420p"),
        ]);
        match codec {
            ProxyCodec::H264 => push(&[
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-g", "15",
            ]),
            ProxyCodec::Webm => push(&[
                "-c:v",
                "libvpx",
                "-deadline",
                "realtime",
                "-cpu-used",
                "8",
                "-b:v",
                "2500k",
                "-crf",
                "10",
                "-qmin",
                "4",
                "-qmax",
                "40",
                "-g",
                "15",
                "-auto-alt-ref",
                "0",
                "-threads",
                "4",
            ]),
        }
    } else {
        push(&["-map", "0:a:0", "-vn", "-sn", "-dn"]);
    }
    match codec {
        ProxyCodec::H264 => push(&["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"]),
        ProxyCodec::Webm => push(&["-c:a", "libopus", "-b:a", "128k", "-ar", "48000"]),
    }
    args.push(out.display().to_string());
    args
}

/// Build (or reuse) the preview proxy of `input`. Written to a temp name first so a half-written
/// file is never served.
pub fn proxy(
    cache_dir: &Path,
    input: &Path,
    codec: ProxyCodec,
    video: bool,
) -> Result<String, String> {
    let dir = cache_dir.join("media");
    let ext = codec.extension();
    let tag = if video {
        format!("proxy{PROXY_HEIGHT}")
    } else {
        "proxya".to_string()
    };
    let out = dir.join(format!("{}-{tag}.{ext}", cache_key(input)));
    if out.is_file() {
        return Ok(out.display().to_string());
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = out.with_extension(format!("part.{ext}"));
    let bin = ffmpeg::ffmpeg_binary().map_err(|e| e.to_string())?;
    let output = Command::new(bin)
        .args(proxy_args(input, &tmp, codec, video))
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let _ = std::fs::remove_file(&tmp);
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    std::fs::rename(&tmp, &out).map_err(|e| e.to_string())?;
    Ok(out.display().to_string())
}

fn ensure(out: &Path, args: Vec<String>) -> Option<String> {
    if out.is_file() {
        return Some(out.display().to_string());
    }
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent).ok()?;
    }
    let bin = ffmpeg::ffmpeg_binary().ok()?;
    let status = Command::new(bin).args(&args).output().ok()?.status;
    if !status.success() {
        let _ = std::fs::remove_file(out);
        return None;
    }
    out.is_file().then(|| out.display().to_string())
}

/// Produce (or reuse) preview assets. Failures leave the field empty rather than failing the import.
pub fn assets(
    cache_dir: &Path,
    input: &Path,
    kind: MediaKind,
    duration: f64,
    has_audio: bool,
) -> MediaAssets {
    let dir = cache_dir.join("media");
    let key = cache_key(input);
    let mut result = MediaAssets {
        strip_frame_w: STRIP_FRAME_W,
        strip_frame_h: STRIP_FRAME_H,
        ..Default::default()
    };
    if kind != MediaKind::Audio {
        let out = dir.join(format!("{key}-thumb.jpg"));
        result.thumb = ensure(&out, thumb_args(input, kind, duration, &out));
    }
    if kind == MediaKind::Video && duration > 0.0 {
        let count = strip_count(duration);
        let out = dir.join(format!("{key}-strip{count}.jpg"));
        result.strip = ensure(&out, strip_args(input, duration, count, &out));
        if result.strip.is_some() {
            result.strip_count = count;
        }
    }
    if has_audio && duration > 0.0 {
        let out = dir.join(format!("{key}-wave.png"));
        result.wave = ensure(&out, wave_args(input, duration, &out));
    }
    result
}

pub fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| {
            let p = entry.path();
            match entry.metadata() {
                Ok(meta) if meta.is_dir() => dir_size(&p),
                Ok(meta) => meta.len(),
                Err(_) => 0,
            }
        })
        .sum()
}

pub fn expand_dir(path: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    if path.is_dir() {
        if let Ok(entries) = std::fs::read_dir(path) {
            let mut items: Vec<PathBuf> = entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.is_file() && is_supported(p))
                .collect();
            items.sort();
            found.extend(items);
        }
    } else if is_supported(path) {
        found.push(path.to_path_buf());
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    const VIDEO: &str = "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mp4':
  Duration: 00:00:12.03, start: 0.000000, bitrate: 3241 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1280x720 [SAR 1:1 DAR 16:9], 3100 kb/s, 29.97 fps, 29.97 tbr, 15360 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 69 kb/s (default)";

    const SONG: &str = "Input #0, mp3, from 'song.mp3':
  Duration: 00:03:01.50, start: 0.025057, bitrate: 192 kb/s
  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, stereo, fltp, 192 kb/s
  Stream #0:1: Video: mjpeg (Baseline), yuvj420p(pc), 600x600 [SAR 1:1 DAR 1:1], 90k tbr, 90k tbn (attached pic)";

    #[test]
    fn parses_video_streams() {
        let (kind, duration, w, h, fps, audio, video) = parse_probe(VIDEO, "mp4");
        assert_eq!(kind, MediaKind::Video);
        assert!((duration - 12.03).abs() < 1e-6);
        assert_eq!((w, h), (1280, 720));
        assert!((fps - 29.97).abs() < 1e-6);
        assert!(audio && video);
    }

    #[test]
    fn cover_art_does_not_make_a_song_a_video() {
        let (kind, duration, _, _, _, audio, video) = parse_probe(SONG, "mp3");
        assert_eq!(kind, MediaKind::Audio);
        assert!((duration - 181.5).abs() < 1e-6);
        assert!(audio && !video);
    }

    #[test]
    fn portrait_phone_video_swaps_size() {
        let text = format!("{VIDEO}\n      displaymatrix: rotation of -90.00 degrees");
        let (_, _, w, h, _, _, _) = parse_probe(&text, "mp4");
        assert_eq!((w, h), (720, 1280));
    }

    #[test]
    fn strip_count_is_bounded() {
        assert_eq!(strip_count(2.0), 6);
        assert_eq!(strip_count(20.2), 21);
        assert_eq!(strip_count(3600.0), 60);
    }

    /// A WebM proxy (VP8 + Opus) of an H.264/AAC source, and an audio-only one, through the real ffmpeg.
    #[test]
    fn builds_webm_proxies() {
        let Ok(bin) = ffmpeg::ffmpeg_binary() else {
            eprintln!("skipping: ffmpeg missing");
            return;
        };
        let dir = std::env::temp_dir().join(format!("xc-proxy-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("src.mp4");
        let ok = Command::new(&bin)
            .args([
                "-y",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=1280x720:r=30:d=2",
                "-f",
                "lavfi",
                "-i",
                "sine=f=440:d=2",
            ])
            .args([
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuvj420p",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(&src)
            .status()
            .unwrap();
        assert!(ok.success());
        let out = proxy(&dir, &src, ProxyCodec::Webm, true).unwrap();
        assert!(out.ends_with(".webm"), "{out}");
        let probe = Command::new(&bin)
            .args(["-hide_banner", "-i", &out])
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&probe.stderr);
        assert!(
            text.contains("Video: vp8") && text.contains("yuv420p") && text.contains("Audio: opus"),
            "{text}"
        );
        assert!(text.contains("x540"), "{text}");
        let audio = proxy(&dir, &src, ProxyCodec::Webm, false).unwrap();
        let probe = Command::new(&bin)
            .args(["-hide_banner", "-i", &audio])
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&probe.stderr);
        assert!(
            text.contains("Audio: opus") && !text.contains("Video:"),
            "{text}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
