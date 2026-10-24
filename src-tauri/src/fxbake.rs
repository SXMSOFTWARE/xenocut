//! Export side of native effect plug-ins: every clip with OpenFX / frei0r effects is rendered
//! through the effect host into an intermediate file first (video frames piped
//! ffmpeg -> host -> ffmpeg, the clip's own audio copied alongside so nothing goes silent),
//! and the export then uses that file in place of the source.

use crate::audio::cancel;
use crate::audio::ffmpeg::ffmpeg_binary;
use crate::audio::traits::{AudioError, ProgressSink};
use crate::export::ExportOptions;
use crate::fxhost::{NativeFx, Session};
use crate::project::{Clip, MediaItem, MediaKind, Project};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Clips whose native effects need baking (enabled effects on a picture).
pub fn needs_bake(project: &Project) -> bool {
    project.clips.iter().any(|c| active(c).next().is_some())
}

fn active(clip: &Clip) -> impl Iterator<Item = &NativeFx> {
    clip.native_fx.iter().filter(|f| f.enabled)
}

/// Size of `media` fitted into the output canvas (even numbers, as x264 wants them).
pub fn fit_size(media: &MediaItem, out_w: u32, out_h: u32) -> (u32, u32) {
    let (mw, mh) = if media.width > 0 && media.height > 0 {
        (media.width as f64, media.height as f64)
    } else {
        (out_w as f64, out_h as f64)
    };
    let s = (out_w as f64 / mw).min(out_h as f64 / mh);
    let even = |v: f64| ((v.round() as u32).max(2) + 1) & !1;
    (even(mw * s), even(mh * s))
}

/// A copy of `project` whose effect clips point at baked intermediates in `work`.
/// Messages about skipped or crashed plug-ins are returned for the log.
pub fn bake(
    project: &Project,
    options: &ExportOptions,
    work: &Path,
    progress: &dyn ProgressSink,
) -> Result<(Project, Vec<String>), AudioError> {
    let mut out = project.clone();
    let mut notes = vec![];
    if !crate::fxhost::supported() {
        notes.push("native effect plug-ins are Linux-only; exported without them".into());
        return Ok((out, notes));
    }
    std::fs::create_dir_all(work).map_err(|e| AudioError::Failed(e.to_string()))?;
    let fps = options.fps.max(1) as f64;
    let jobs: Vec<usize> = (0..out.clips.len())
        .filter(|&i| active(&out.clips[i]).next().is_some())
        .collect();
    let total: f64 = jobs
        .iter()
        .map(|&i| out.clips[i].source_duration().max(1.0 / fps))
        .sum::<f64>()
        .max(1e-6);
    let mut done = 0.0;
    let mut session = Session::new();
    for (n, &i) in jobs.iter().enumerate() {
        cancel::check()?;
        let clip = out.clips[i].clone();
        let Some(media) = out.media.iter().find(|m| m.id == clip.media_id).cloned() else {
            continue;
        };
        if media.kind == MediaKind::Audio || !media.has_video && media.kind != MediaKind::Image {
            continue;
        }
        let chain: Vec<NativeFx> = active(&clip).cloned().collect();
        let (w, h) = fit_size(&media, options.width, options.height);
        let full = (w, h);
        let key = format!("ex:{}", clip.id);
        let mut baked = media.clone();
        baked.id = format!("{}~fx{n}", media.id);
        baked.width = w;
        baked.height = h;
        let report = |p: f64| {
            progress.report(((done + p) / total).clamp(0.0, 1.0) as f32, "Applying effect plug-ins")
        };
        if media.kind == MediaKind::Image {
            let path = work.join(format!("fx{n}.png"));
            let mut frame = decode_image(&media.path, w, h)?;
            notes.extend(session.render(&chain, &key, &mut frame, w, h, full, 0.0, fps));
            encode_image(&frame, w, h, &path)?;
            baked.path = path.display().to_string();
        } else {
            let path = work.join(format!("fx{n}.mkv"));
            let dur = clip.source_duration();
            let frames = pipe_video(&media, &clip, w, h, fps, &path, |frame, k| {
                let t = clip.in_point + k as f64 / fps;
                notes.extend(session.render(&chain, &key, frame, w, h, full, t, fps));
                report((k as f64 / fps).min(dur));
            })?;
            if frames == 0 {
                return Err(AudioError::Failed(format!("no frames decoded from {}", media.path)));
            }
            baked.path = path.display().to_string();
            baked.duration = dur;
            baked.fps = fps;
            let c = &mut out.clips[i];
            c.in_point = 0.0;
            c.out_point = dur;
        }
        session.drop_key(&key);
        done += clip.source_duration().max(1.0 / fps);
        let c = &mut out.clips[i];
        c.media_id = baked.id.clone();
        c.native_fx.clear();
        out.media.push(baked);
    }
    Ok((out, notes))
}

fn ffmpeg() -> Result<Command, AudioError> {
    let mut c = Command::new(ffmpeg_binary()?);
    c.args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y"]);
    Ok(c)
}

fn scale(w: u32, h: u32) -> String {
    format!("scale={w}:{h}:flags=bicubic,setsar=1,format=rgba")
}

fn decode_image(path: &str, w: u32, h: u32) -> Result<Vec<u8>, AudioError> {
    let out = ffmpeg()?
        .args(["-i", path, "-frames:v", "1", "-vf", &scale(w, h), "-f", "rawvideo", "pipe:1"])
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| AudioError::Failed(e.to_string()))?;
    let need = w as usize * h as usize * 4;
    if out.stdout.len() < need {
        return Err(AudioError::Failed(format!(
            "could not decode {path}: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        )));
    }
    Ok(out.stdout[..need].to_vec())
}

fn encode_image(frame: &[u8], w: u32, h: u32, path: &Path) -> Result<(), AudioError> {
    let mut child = ffmpeg()?
        .args(["-f", "rawvideo", "-pix_fmt", "rgba", "-s", &format!("{w}x{h}"), "-i", "pipe:0"])
        .args(["-frames:v", "1"])
        .arg(path)
        .stdin(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AudioError::Failed(e.to_string()))?;
    let _ = child.stdin.take().unwrap().write_all(frame);
    let out = child.wait_with_output().map_err(|e| AudioError::Failed(e.to_string()))?;
    if !out.status.success() {
        return Err(AudioError::Failed(String::from_utf8_lossy(&out.stderr).trim().to_string()));
    }
    Ok(())
}

/// Decode the clip's source range at `fps`, run `each` over every frame, and encode it with the
/// clip's audio (if any) into `path`. Returns the frame count.
fn pipe_video(
    media: &MediaItem,
    clip: &Clip,
    w: u32,
    h: u32,
    fps: f64,
    path: &PathBuf,
    mut each: impl FnMut(&mut [u8], u64),
) -> Result<u64, AudioError> {
    let ss = format!("{:.3}", clip.in_point);
    let t = format!("{:.3}", clip.source_duration());
    let mut dec = ffmpeg()?
        .args(["-ss", &ss, "-t", &t, "-i", &media.path, "-an"])
        .args(["-vf", &format!("fps={fps},{}", scale(w, h))])
        .args(["-f", "rawvideo", "pipe:1"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AudioError::Failed(format!("could not start ffmpeg: {e}")))?;
    let mut enc = ffmpeg()?;
    enc.args(["-f", "rawvideo", "-pix_fmt", "rgba", "-s", &format!("{w}x{h}")])
        .args(["-r", &format!("{fps}"), "-i", "pipe:0"]);
    if media.has_audio {
        enc.args(["-ss", &ss, "-t", &t, "-i", &media.path, "-map", "0:v", "-map", "1:a:0?"])
            .args(["-c:a", "pcm_s16le"]);
    }
    enc.args(["-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv420p"])
        .arg(path)
        .stdin(Stdio::piped())
        .stderr(Stdio::piped());
    let mut enc = enc
        .spawn()
        .map_err(|e| AudioError::Failed(format!("could not start ffmpeg: {e}")))?;
    let mut src = dec.stdout.take().unwrap();
    let mut sink = enc.stdin.take().unwrap();
    let mut frame = vec![0u8; w as usize * h as usize * 4];
    let mut k = 0u64;
    let mut failed = None;
    loop {
        if cancel::is_cancelled() {
            failed = Some(AudioError::Cancelled);
            break;
        }
        if read_full(&mut src, &mut frame).map_err(|e| e.to_string()).unwrap_or(false) {
            each(&mut frame, k);
            k += 1;
            if let Err(e) = sink.write_all(&frame) {
                failed = Some(AudioError::Failed(format!("encoder stopped: {e}")));
                break;
            }
        } else {
            break;
        }
    }
    drop(sink);
    drop(src);
    if failed.is_some() {
        let _ = dec.kill();
        let _ = enc.kill();
    }
    let dec_out = dec.wait_with_output().map_err(|e| AudioError::Failed(e.to_string()))?;
    let enc_out = enc.wait_with_output().map_err(|e| AudioError::Failed(e.to_string()))?;
    if let Some(e) = failed {
        return Err(e);
    }
    if !enc_out.status.success() {
        return Err(AudioError::Failed(format!(
            "effect intermediate failed: {}",
            String::from_utf8_lossy(&enc_out.stderr).trim()
        )));
    }
    if k == 0 && !dec_out.status.success() {
        return Err(AudioError::Failed(String::from_utf8_lossy(&dec_out.stderr).trim().to_string()));
    }
    Ok(k)
}

/// Fill `buf` completely; false at a clean end of stream.
fn read_full(r: &mut impl Read, buf: &mut [u8]) -> std::io::Result<bool> {
    let mut got = 0;
    while got < buf.len() {
        let n = r.read(&mut buf[got..])?;
        if n == 0 {
            return Ok(false);
        }
        got += n;
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::tests::{clip, media, project};

    #[test]
    fn fit_keeps_aspect_and_even_sizes() {
        let mut m = media("m", MediaKind::Video, "a.mp4", 5.0, true);
        m.width = 1080;
        m.height = 1920;
        assert_eq!(fit_size(&m, 1280, 720), (406, 720));
        m.width = 0;
        assert_eq!(fit_size(&m, 1280, 720), (1280, 720));
    }

    #[test]
    fn only_enabled_effects_need_baking() {
        let mut c = clip("c", "v1", "m", 0.0, 0.0, 2.0);
        let mut p = project(vec![media("m", MediaKind::Video, "a.mp4", 5.0, true)], vec![c.clone()]);
        assert!(!needs_bake(&p));
        c.native_fx.push(NativeFx {
            id: "frei0r:glow".into(),
            params: Default::default(),
            enabled: false,
        });
        p.clips = vec![c.clone()];
        assert!(!needs_bake(&p));
        c.native_fx[0].enabled = true;
        p.clips = vec![c];
        assert!(needs_bake(&p));
    }

    struct Quiet;
    impl ProgressSink for Quiet {
        fn report(&self, _: f32, _: &str) {}
    }

    /// Needs ffmpeg and frei0r plug-ins; run with --ignored.
    #[test]
    #[ignore]
    #[cfg(target_os = "linux")]
    fn bake_inverts_video_and_keeps_audio() {
        let root = std::env::temp_dir().join(format!("xc-bake-{}", std::process::id()));
        std::fs::create_dir_all(root.join("frei0r")).unwrap();
        std::os::unix::fs::symlink("/usr/lib/frei0r-1/invert0r.so", root.join("frei0r/invert0r.so")).unwrap();
        crate::fxhost::tests::test_config(&root);
        let src = root.join("src.mp4");
        let ok = std::process::Command::new(ffmpeg_binary().unwrap())
            .args(["-v", "error", "-f", "lavfi", "-i", "color=c=0x204060:s=320x180:r=30:d=2"])
            .args(["-f", "lavfi", "-i", "sine=f=440:d=2", "-shortest", "-pix_fmt", "yuv420p"])
            .arg(&src)
            .status()
            .unwrap();
        assert!(ok.success());
        let mut m = media("m", MediaKind::Video, src.to_str().unwrap(), 2.0, true);
        m.width = 320;
        m.height = 180;
        let mut c = clip("c", "v1", "m", 0.0, 0.5, 1.5);
        c.native_fx.push(NativeFx {
            id: "frei0r:invert0r".into(),
            params: Default::default(),
            enabled: true,
        });
        let p = project(vec![m], vec![c]);
        let mut opts = crate::export::tests::options();
        opts.width = 640;
        opts.height = 360;
        let (out, notes) = bake(&p, &opts, &root.join("work"), &Quiet).unwrap();
        assert!(notes.is_empty(), "{notes:?}");
        let baked = out.media.iter().find(|m| m.id == "m~fx0").unwrap();
        assert_eq!((baked.width, baked.height), (640, 360));
        assert_eq!((out.clips[0].in_point, out.clips[0].out_point), (0.0, 1.0));
        assert!(out.clips[0].native_fx.is_empty());
        assert_eq!(out.clips[0].media_id, "m~fx0");
        // Audio survived and the picture is inverted (0x204060 -> about 0xdfbf9f).
        let probe = std::process::Command::new(ffmpeg_binary().unwrap())
            .args(["-v", "error", "-i", &baked.path, "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"])
            .output()
            .unwrap();
        let px = probe.stdout;
        assert!(px.len() == 3 && px[0] > 200 && px[2] < 175 && px[2] > 130, "{px:?}");
        let info = std::process::Command::new(ffmpeg_binary().unwrap())
            .args(["-hide_banner", "-i", &baked.path])
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&info.stderr);
        assert!(text.contains("Audio: pcm_s16le"), "{text}");
        assert!(text.contains("Duration: 00:00:01.0"), "{text}");
        let _ = std::fs::remove_dir_all(root);
    }
}
