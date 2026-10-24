//! Tauri commands for automatic subtitles and subtitle files.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::{lrc, srt};
use super::whisper::{self, Cue, ModelSize, Recognizer, Transcript};
use crate::app::{cache_root, model_dir, ExportSink};
use crate::audio::cancel;
use crate::audio::ffmpeg;
use crate::audio::traits::{AudioError, ProgressSink};
use crate::export;
use crate::project::Project;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleModel {
    size: ModelSize,
    installed: bool,
    download_bytes: u64,
}

#[tauri::command]
pub fn subtitle_models(app: AppHandle) -> Vec<SubtitleModel> {
    let root = model_dir(&app);
    [ModelSize::Tiny, ModelSize::Base, ModelSize::Small]
        .into_iter()
        .map(|size| SubtitleModel { size, installed: whisper::is_installed(&root, size), download_bytes: size.download_bytes() })
        .collect()
}

#[tauri::command]
pub fn subtitle_model_delete(app: AppHandle, size: ModelSize) -> Result<(), String> {
    let dir = whisper::model_dir(&model_dir(&app), size);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeOptions {
    model: ModelSize,
    /// ISO 639-1 code, or None to detect.
    #[serde(default)]
    language: Option<String>,
    /// Also listen to music tracks (lyrics). Off by default: music confuses speech recognition.
    #[serde(default)]
    include_music: bool,
    /// Longest on-screen cue, in characters.
    #[serde(default = "default_chars")]
    max_chars: usize,
}

fn default_chars() -> usize {
    42
}

/// Progress in 0..1 with a stage key (`download`, `mix`, `load`, `recognize`) for the UI to translate.
struct Stage<'a> {
    sink: &'a dyn ProgressSink,
    from: f32,
    span: f32,
    key: &'static str,
}

impl ProgressSink for Stage<'_> {
    fn report(&self, amount: f32, _message: &str) {
        self.sink.report(self.from + self.span * amount.clamp(0.0, 1.0), self.key);
    }
}

/// Download the model if needed, mix the timeline's sound and run Whisper over it.
/// Cue times are timeline seconds.
pub fn transcribe(project: &Project, options: &TranscribeOptions, models: &std::path::Path, scratch: &std::path::Path, sink: &dyn ProgressSink) -> Result<Transcript, AudioError> {
    let installed = whisper::is_installed(models, options.model);
    let (download, mix) = if installed { (0.0, 0.05) } else { (0.35, 0.05) };
    let dir = whisper::ensure_model(models, options.model, &Stage { sink, from: 0.0, span: 1.0, key: "download" }, download)?;
    cancel::check()?;

    std::fs::create_dir_all(scratch).map_err(|e| AudioError::Failed(e.to_string()))?;
    let wav = scratch.join(format!("speech-{}.wav", std::process::id()));
    let plan = export::build_speech_mix(project, &wav.display().to_string(), options.include_music).map_err(AudioError::Failed)?;
    let mut args = plan.args;
    let out = args.pop().unwrap_or_default();
    args.extend(["-progress".into(), "pipe:1".into(), "-nostats".into(), out]);
    let stage = Stage { sink, from: download, span: mix, key: "mix" };
    let mixed = ffmpeg::run(&args, Some(plan.duration), Some(&stage), "mix");
    let pcm = mixed.and_then(|_| whisper::read_pcm(&wav, 0.0, None));
    let _ = std::fs::remove_file(&wav);
    let pcm = pcm?;
    cancel::check()?;

    let from = download + mix;
    sink.report(from, "load");
    let mut recognizer = Recognizer::load(&dir)?;
    let language = options.language.as_deref().filter(|l| !l.is_empty() && *l != "auto");
    let span = 1.0 - from;
    let mut transcript = recognizer.transcribe(&pcm, language, &|p| sink.report(from + span * p, "recognize"))?;
    let end = plan.duration;
    transcript.cues.retain(|c| c.start < end && !c.text.trim().is_empty());
    for cue in &mut transcript.cues {
        cue.end = cue.end.min(end);
    }
    srt::snap_to_speech(&mut transcript.cues, &pcm);
    transcript.cues = srt::reflow(&transcript.cues, options.max_chars);
    sink.report(1.0, "recognize");
    Ok(transcript)
}

#[tauri::command]
pub async fn subtitle_transcribe(app: AppHandle, project: Project, options: TranscribeOptions) -> Result<Transcript, String> {
    cancel::begin();
    let models = model_dir(&app);
    let scratch = cache_root(&app).join("subtitles");
    tauri::async_runtime::spawn_blocking(move || {
        let sink = ExportSink { app, event: "subtitle-progress" };
        transcribe(&project, &options, &models, &scratch, &sink).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn subtitle_cancel() {
    cancel::request();
}

#[tauri::command]
pub fn subtitle_read(path: String) -> Result<Vec<Cue>, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&bytes);
    let is_lrc = path.to_lowercase().ends_with(".lrc") || (!text.contains("-->") && lrc::looks_like_lrc(&text));
    let cues = if is_lrc { lrc::parse(&text) } else { srt::parse(&text) };
    if cues.is_empty() {
        return Err("No subtitles found in this file.".into());
    }
    Ok(cues)
}

#[tauri::command]
pub fn subtitle_write(path: String, cues: Vec<Cue>) -> Result<String, String> {
    let mut path = PathBuf::from(path);
    if path.extension().is_none() {
        path.set_extension("srt");
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let is_lrc = path.extension().is_some_and(|e| e.eq_ignore_ascii_case("lrc"));
    std::fs::write(&path, if is_lrc { lrc::write(&cues) } else { whisper::to_srt(&cues) }).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::tests::{clip, media, project};
    use crate::project::MediaKind;

    struct Quiet;
    impl ProgressSink for Quiet {
        fn report(&self, _amount: f32, _message: &str) {}
    }

    /// Timeline to subtitles with a real model: the speech sits 3 s into the timeline, so the
    /// cues must too. `XENOCUT_WHISPER_DIR=<dir with whisper-base> XENOCUT_WHISPER_WAV=jfk.wav`.
    #[test]
    #[ignore]
    fn transcribes_the_timeline_at_timeline_times() {
        let root = PathBuf::from(std::env::var("XENOCUT_WHISPER_DIR").unwrap());
        let wav = std::env::var("XENOCUT_WHISPER_WAV").unwrap();
        let p = project(vec![media("s", MediaKind::Audio, &wav, 11.0, true)], vec![clip("c", "a1", "s", 3.0, 0.0, 11.0)]);
        let options = TranscribeOptions { model: ModelSize::Base, language: Some("en".into()), include_music: false, max_chars: 32 };
        let scratch = std::env::temp_dir().join("xenocut-subtitle-test");
        let out = transcribe(&p, &options, &root, &scratch, &Quiet).unwrap();
        eprintln!("{}", whisper::to_srt(&out.cues));
        assert!(out.cues.len() >= 2);
        assert!(out.cues[0].start >= 2.9, "{:?}", out.cues[0]);
        assert!(out.cues.iter().all(|c| c.text.chars().count() <= 32 && c.end <= 14.0 + 1e-6));
        let all = out.cues.iter().map(|c| c.text.as_str()).collect::<Vec<_>>().join(" ").to_lowercase();
        assert!(all.contains("country"), "{all}");
    }
}
