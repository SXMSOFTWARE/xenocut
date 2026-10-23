use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;

use super::cancel;
use super::traits::{AudioError, ProgressSink};

pub fn ffmpeg_binary() -> Result<PathBuf, AudioError> {
    if cfg!(target_os = "android") {
        return android_ffmpeg();
    }

    if let Ok(path) = std::env::var("XENOCUT_FFMPEG") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
        return Err(AudioError::MissingInput(path.display().to_string()));
    }

    let name = sidecar_name();
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(&name));
            candidates.push(dir.join("ffmpeg"));
        }
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join(&name);
    candidates.push(manifest);

    for candidate in candidates {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    if Command::new("ffmpeg").arg("-version").output().is_ok() {
        return Ok(PathBuf::from("ffmpeg"));
    }

    Err(AudioError::Failed(format!(
        "FFmpeg sidecar {name} was not found. Run scripts/fetch-ffmpeg.sh, or set XENOCUT_FFMPEG."
    )))
}

/// On Android the FFmpeg executable ships as `jniLibs/arm64-v8a/libffmpeg.so`. The package manager
/// extracts it next to our own library into the app's nativeLibraryDir, the only app-owned
/// location Android lets us exec from. We find that directory through /proc/self/maps.
fn android_ffmpeg() -> Result<PathBuf, AudioError> {
    let maps = std::fs::read_to_string("/proc/self/maps").unwrap_or_default();
    for line in maps.lines() {
        if let Some(idx) = line.find('/') {
            let path = Path::new(line[idx..].trim());
            if path.file_name().is_some_and(|name| name == "libxenocut_lib.so") {
                if let Some(dir) = path.parent() {
                    let candidate = dir.join("libffmpeg.so");
                    if candidate.is_file() {
                        return Ok(candidate);
                    }
                }
            }
        }
    }
    Err(AudioError::Failed("FFmpeg is not bundled in this Android build.".into()))
}

fn sidecar_name() -> String {
    let triple = match (std::env::consts::ARCH, std::env::consts::OS) {
        ("x86_64", "linux") => "x86_64-unknown-linux-gnu",
        ("aarch64", "linux") => "aarch64-unknown-linux-gnu",
        ("x86_64", "windows") => "x86_64-pc-windows-msvc",
        ("aarch64", "windows") => "aarch64-pc-windows-msvc",
        ("x86_64", "macos") => "x86_64-apple-darwin",
        ("aarch64", "macos") => "aarch64-apple-darwin",
        (arch, os) => return format!("ffmpeg-{arch}-{os}"),
    };
    if cfg!(windows) {
        format!("ffmpeg-{triple}.exe")
    } else {
        format!("ffmpeg-{triple}")
    }
}

pub fn parse_duration(text: &str) -> Option<f64> {
    let rest = text.split("Duration:").nth(1)?;
    let stamp = rest.trim().split([',', ' ']).next()?.trim();
    parse_hms(stamp)
}

pub fn parse_hms(stamp: &str) -> Option<f64> {
    let mut parts = stamp.split(':');
    let hours: f64 = parts.next()?.parse().ok()?;
    let minutes: f64 = parts.next()?.parse().ok()?;
    let seconds: f64 = parts.next()?.parse().ok()?;
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

/// Turn one `-progress` line into a 0..1 fraction. `out_time_ms` is microseconds in FFmpeg.
pub fn progress_from_line(line: &str, duration_secs: f64) -> Option<f32> {
    if duration_secs <= 0.0 {
        return None;
    }
    let line = line.trim();
    let fraction = if let Some(value) = line.strip_prefix("out_time_us=") {
        value.parse::<f64>().ok()? / 1_000_000.0 / duration_secs
    } else if let Some(value) = line.strip_prefix("out_time_ms=") {
        value.parse::<f64>().ok()? / 1_000_000.0 / duration_secs
    } else if let Some(value) = line.strip_prefix("out_time=") {
        parse_hms(value)? / duration_secs
    } else {
        return None;
    };
    Some(fraction.clamp(0.0, 1.0) as f32)
}

pub fn probe_duration(input: &Path) -> Result<f64, AudioError> {
    let ffmpeg = ffmpeg_binary()?;
    let output = Command::new(&ffmpeg)
        .args(["-hide_banner", "-i"])
        .arg(input)
        .output()
        .map_err(|err| AudioError::Failed(err.to_string()))?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_duration(&stderr).ok_or_else(|| AudioError::Failed(format!("could not read duration of {}", input.display())))
}

pub fn run(
    args: &[String],
    duration: Option<f64>,
    progress: Option<&dyn ProgressSink>,
    running_message: &str,
) -> Result<(), AudioError> {
    let ffmpeg = ffmpeg_binary()?;
    let mut child = Command::new(&ffmpeg)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| AudioError::Failed(format!("could not start ffmpeg: {err}")))?;

    let stderr = child.stderr.take();
    let stderr_thread = thread::spawn(move || {
        stderr
            .map(|pipe| {
                let mut text = String::new();
                let _ = std::io::Read::read_to_string(&mut std::io::BufReader::new(pipe), &mut text);
                text
            })
            .unwrap_or_default()
    });

    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines() {
            if cancel::is_cancelled() {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stderr_thread.join();
                return Err(AudioError::Cancelled);
            }
            let line = line.unwrap_or_default();
            if let (Some(duration), Some(progress)) = (duration, progress) {
                if let Some(amount) = progress_from_line(&line, duration) {
                    progress.report(amount, running_message);
                }
            }
        }
    }

    let status = child.wait().map_err(|err| AudioError::Failed(err.to_string()))?;
    let stderr = stderr_thread.join().unwrap_or_default();
    if cancel::is_cancelled() {
        return Err(AudioError::Cancelled);
    }
    if !status.success() {
        let tail = stderr.chars().rev().take(700).collect::<String>().chars().rev().collect::<String>();
        return Err(AudioError::Failed(format!("ffmpeg failed: {tail}")));
    }
    Ok(())
}

pub fn extract_wav(input: &Path, output: &Path) -> Result<(), AudioError> {
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|err| AudioError::Failed(err.to_string()))?;
    }
    let args = vec![
        "-hide_banner".into(),
        "-y".into(),
        "-i".into(),
        input.display().to_string(),
        "-vn".into(),
        "-ac".into(),
        "2".into(),
        "-ar".into(),
        "44100".into(),
        "-c:a".into(),
        "pcm_f32le".into(),
        output.display().to_string(),
    ];
    run(&args, None, None, "Extracting audio")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duration_and_progress_lines_parse() {
        assert_eq!(parse_duration("Duration: 00:01:02.50, start: 0.000000"), Some(62.5));
        assert!((progress_from_line("out_time_us=2000000", 4.0).unwrap() - 0.5).abs() < 1e-4);
        assert!((progress_from_line("out_time_ms=2000000", 4.0).unwrap() - 0.5).abs() < 1e-4);
        assert!((progress_from_line("out_time=00:00:02.000000", 4.0).unwrap() - 0.5).abs() < 1e-4);
        assert!(progress_from_line("progress=continue", 4.0).is_none());
    }
}
