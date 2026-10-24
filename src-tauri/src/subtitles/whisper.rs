//! On-device speech recognition with OpenAI Whisper, run through candle (pure Rust, CPU).
//!
//! The weights are not bundled: `ensure_model` downloads `config.json`, `tokenizer.json` and
//! `model.safetensors` from the pinned Hugging Face revision of `openai/whisper-<size>` on first use.
//! Decoding is greedy with Whisper's timestamp rules, so every 30 s window yields timed segments.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use candle_core::{DType, Device, IndexOp, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::whisper::{self as m, Config, audio, model::Whisper};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::audio::cancel;
use crate::audio::ffmpeg;
use crate::audio::traits::{AudioError, ProgressSink};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModelSize {
    Tiny,
    Base,
    Small,
}

struct ModelSpec {
    repo: &'static str,
    revision: &'static str,
    weights_sha256: &'static str,
    weights_bytes: u64,
}

impl ModelSize {
    fn spec(self) -> ModelSpec {
        match self {
            ModelSize::Tiny => ModelSpec {
                repo: "openai/whisper-tiny",
                revision: "169d4a4341b33bc18d8881c4b69c2e104e1cc0af",
                weights_sha256: "7ebd0e69e78190ffe1438491fa05cc1f5c1aa3a4c4db3bc1723adbb551ea2395",
                weights_bytes: 151_061_672,
            },
            ModelSize::Base => ModelSpec {
                repo: "openai/whisper-base",
                revision: "e37978b90ca9030d5170a5c07aadb050351a65bb",
                weights_sha256: "07cadb9f25677c8d50df603e66a98fbd842cce45047139baeb16e6219a1e807b",
                weights_bytes: 290_403_936,
            },
            ModelSize::Small => ModelSpec {
                repo: "openai/whisper-small",
                revision: "973afd24965f72e36ca33b3055d56a652f456b4d",
                weights_sha256: "1d7734884874f1a1513ed9aa760a4f8e97aaa02fd6d93a3a85d27b2ae9ca596b",
                weights_bytes: 966_995_080,
            },
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            ModelSize::Tiny => "tiny",
            ModelSize::Base => "base",
            ModelSize::Small => "small",
        }
    }

    pub fn download_bytes(self) -> u64 {
        self.spec().weights_bytes
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Cue {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub language: String,
    pub cues: Vec<Cue>,
}

pub fn model_dir(root: &Path, size: ModelSize) -> PathBuf {
    root.join(format!("whisper-{}", size.id()))
}

pub fn is_installed(root: &Path, size: ModelSize) -> bool {
    let dir = model_dir(root, size);
    ["config.json", "tokenizer.json"]
        .iter()
        .all(|f| dir.join(f).is_file())
        && std::fs::metadata(dir.join("model.safetensors"))
            .map(|m| m.len() == size.download_bytes())
            .unwrap_or(false)
}

/// Download (once) and verify the model files. Reports progress in 0..`span`.
pub fn ensure_model(
    root: &Path,
    size: ModelSize,
    progress: &dyn ProgressSink,
    span: f32,
) -> Result<PathBuf, AudioError> {
    let dir = model_dir(root, size);
    std::fs::create_dir_all(&dir).map_err(fail)?;
    let spec = size.spec();
    for name in ["config.json", "tokenizer.json"] {
        let path = dir.join(name);
        if !path.is_file() {
            download(&url(&spec, name), &path, None, progress, 0.0)?;
        }
    }
    let weights = dir.join("model.safetensors");
    let ok = std::fs::metadata(&weights)
        .map(|m| m.len() == spec.weights_bytes)
        .unwrap_or(false);
    if !ok {
        download(
            &url(&spec, "model.safetensors"),
            &weights,
            Some(spec.weights_sha256),
            progress,
            span,
        )?;
    }
    Ok(dir)
}

fn url(spec: &ModelSpec, name: &str) -> String {
    format!(
        "https://huggingface.co/{}/resolve/{}/{}",
        spec.repo, spec.revision, name
    )
}

fn fail<E: std::fmt::Display>(err: E) -> AudioError {
    AudioError::Failed(err.to_string())
}

fn download(
    url: &str,
    path: &Path,
    sha256: Option<&str>,
    progress: &dyn ProgressSink,
    span: f32,
) -> Result<(), AudioError> {
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(8))
        .user_agent("xenocut")
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .map_err(fail)?;
    let mut response = client
        .get(url)
        .send()
        .map_err(|e| AudioError::Failed(format!("could not download the speech model: {e}")))?;
    if !response.status().is_success() {
        return Err(AudioError::Failed(format!(
            "speech model download returned {}",
            response.status()
        )));
    }
    let total = response.content_length().unwrap_or(0);
    let partial = path.with_extension("partial");
    let mut file = File::create(&partial).map_err(fail)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 256 * 1024];
    let mut got = 0u64;
    loop {
        if let Err(err) = cancel::check() {
            drop(file);
            let _ = std::fs::remove_file(&partial);
            return Err(err);
        }
        let read = response.read(&mut buffer).map_err(fail)?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read]).map_err(fail)?;
        hasher.update(&buffer[..read]);
        got += read as u64;
        if total > 0 && span > 0.0 {
            progress.report(span * got as f32 / total as f32, "Downloading speech model");
        }
    }
    file.flush().map_err(fail)?;
    drop(file);
    if let Some(expected) = sha256 {
        let digest: String = hasher
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        if digest != expected {
            let _ = std::fs::remove_file(&partial);
            return Err(AudioError::Failed(
                "The speech model download did not match the expected checksum.".into(),
            ));
        }
    }
    std::fs::rename(&partial, path).map_err(fail)?;
    Ok(())
}

/// Mel filter bank identical to `librosa.filters.mel(sr=16000, n_fft=400, n_mels, htk=False, norm="slaney")`,
/// which is what Whisper was trained with. Row-major `[n_mels][n_fft/2 + 1]`.
pub fn mel_filters(n_mels: usize) -> Vec<f32> {
    let sr = m::SAMPLE_RATE as f64;
    let bins = m::N_FFT / 2 + 1;
    let f_sp = 200.0 / 3.0;
    let min_log_hz = 1000.0;
    let min_log_mel = min_log_hz / f_sp;
    let logstep = (6.4f64).ln() / 27.0;
    let hz_to_mel = |hz: f64| {
        if hz >= min_log_hz {
            min_log_mel + (hz / min_log_hz).ln() / logstep
        } else {
            hz / f_sp
        }
    };
    let mel_to_hz = |mel: f64| {
        if mel >= min_log_mel {
            min_log_hz * (logstep * (mel - min_log_mel)).exp()
        } else {
            f_sp * mel
        }
    };
    let (lo, hi) = (hz_to_mel(0.0), hz_to_mel(sr / 2.0));
    let points: Vec<f64> = (0..n_mels + 2)
        .map(|i| mel_to_hz(lo + (hi - lo) * i as f64 / (n_mels + 1) as f64))
        .collect();
    let freqs: Vec<f64> = (0..bins)
        .map(|i| sr / 2.0 * i as f64 / (bins - 1) as f64)
        .collect();
    let mut out = vec![0f32; n_mels * bins];
    for i in 0..n_mels {
        let enorm = 2.0 / (points[i + 2] - points[i]);
        for (j, &f) in freqs.iter().enumerate() {
            let lower = (f - points[i]) / (points[i + 1] - points[i]);
            let upper = (points[i + 2] - f) / (points[i + 2] - points[i + 1]);
            out[i * bins + j] = (lower.min(upper).max(0.0) * enorm) as f32;
        }
    }
    out
}

/// Byte-level BPE decoding for Whisper's GPT-2 style vocabulary. Encoding is never needed:
/// prompts are made of special tokens only.
pub struct Tokens {
    id_to_token: Vec<String>,
    by_name: HashMap<String, u32>,
    byte_of: HashMap<char, u8>,
}

impl Tokens {
    pub fn load(path: &Path) -> Result<Self, AudioError> {
        #[derive(Deserialize)]
        struct Added {
            id: u32,
            content: String,
        }
        #[derive(Deserialize)]
        struct Model {
            vocab: HashMap<String, u32>,
        }
        #[derive(Deserialize)]
        struct File {
            model: Model,
            added_tokens: Vec<Added>,
        }
        let text = std::fs::read_to_string(path).map_err(fail)?;
        let file: File = serde_json::from_str(&text).map_err(fail)?;
        let mut by_name = file.model.vocab;
        for added in file.added_tokens {
            by_name.insert(added.content, added.id);
        }
        let max = by_name.values().copied().max().unwrap_or(0) as usize;
        let mut id_to_token = vec![String::new(); max + 1];
        for (name, &id) in &by_name {
            id_to_token[id as usize] = name.clone();
        }
        Ok(Self {
            id_to_token,
            by_name,
            byte_of: unicode_to_bytes(),
        })
    }

    pub fn id(&self, name: &str) -> Result<u32, AudioError> {
        self.by_name.get(name).copied().ok_or_else(|| {
            AudioError::Failed(format!("token {name} missing from the speech model"))
        })
    }

    /// Text of ordinary tokens; special tokens (`<|...|>`) are dropped.
    pub fn decode(&self, ids: &[u32]) -> String {
        let mut bytes = Vec::new();
        for &id in ids {
            let Some(token) = self.id_to_token.get(id as usize) else {
                continue;
            };
            if token.starts_with("<|") && token.ends_with("|>") {
                continue;
            }
            for ch in token.chars() {
                if let Some(&b) = self.byte_of.get(&ch) {
                    bytes.push(b);
                }
            }
        }
        String::from_utf8_lossy(&bytes).into_owned()
    }

    /// `(id, code)` of every language token, e.g. `(50259, "en")`.
    pub fn languages(&self, sot: u32, translate: u32) -> Vec<(u32, String)> {
        let mut out: Vec<(u32, String)> = self
            .by_name
            .iter()
            .filter(|(_, id)| **id > sot && **id < translate)
            .filter_map(|(name, &id)| {
                let code = name.strip_prefix("<|")?.strip_suffix("|>")?;
                (code.len() <= 3 && code.chars().all(|c| c.is_ascii_lowercase()))
                    .then(|| (id, code.to_string()))
            })
            .collect();
        out.sort();
        out
    }
}

/// GPT-2's reversible byte to printable-unicode mapping, inverted.
fn unicode_to_bytes() -> HashMap<char, u8> {
    let mut printable: Vec<u32> = (b'!' as u32..=b'~' as u32)
        .chain(0xA1..=0xAC)
        .chain(0xAE..=0xFF)
        .collect();
    let mut chars = printable.clone();
    let mut n = 0;
    for b in 0..256u32 {
        if !printable.contains(&b) {
            printable.push(b);
            chars.push(256 + n);
            n += 1;
        }
    }
    printable
        .into_iter()
        .zip(chars)
        .map(|(b, c)| (char::from_u32(c).unwrap(), b as u8))
        .collect()
}

/// 16 kHz mono float PCM of the input's first audio stream, through the FFmpeg sidecar.
pub fn read_pcm(input: &Path, start: f64, duration: Option<f64>) -> Result<Vec<f32>, AudioError> {
    let bin = ffmpeg::ffmpeg_binary()?;
    let mut cmd = Command::new(bin);
    cmd.args(["-hide_banner", "-loglevel", "error", "-nostdin"]);
    if start > 0.0 {
        cmd.args(["-ss", &format!("{start:.3}")]);
    }
    if let Some(d) = duration {
        cmd.args(["-t", &format!("{d:.3}")]);
    }
    cmd.arg("-i").arg(input).args([
        "-vn", "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1",
    ]);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().map_err(fail)?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(AudioError::Failed(format!(
            "could not read the audio: {}",
            err.trim()
        )));
    }
    Ok(out
        .stdout
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect())
}

pub struct Recognizer {
    model: Whisper,
    config: Config,
    tokens: Tokens,
    filters: Vec<f32>,
    device: Device,
    suppress: Tensor,
    sot: u32,
    transcribe: u32,
    eot: u32,
    no_timestamps: u32,
    no_speech: u32,
    languages: Vec<(u32, String)>,
}

const SAMPLE_LEN: usize = 224;

impl Recognizer {
    pub fn load(dir: &Path) -> Result<Self, AudioError> {
        let device = Device::Cpu;
        let config: Config =
            serde_json::from_str(&std::fs::read_to_string(dir.join("config.json")).map_err(fail)?)
                .map_err(fail)?;
        let tokens = Tokens::load(&dir.join("tokenizer.json"))?;
        let vb = unsafe {
            VarBuilder::from_mmaped_safetensors(&[dir.join("model.safetensors")], m::DTYPE, &device)
                .map_err(fail)?
        };
        let model = Whisper::load(&vb, config.clone()).map_err(fail)?;
        let sot = tokens.id(m::SOT_TOKEN)?;
        let transcribe = tokens.id(m::TRANSCRIBE_TOKEN)?;
        let translate = tokens.id(m::TRANSLATE_TOKEN)?;
        let eot = tokens.id(m::EOT_TOKEN)?;
        let no_timestamps = tokens.id(m::NO_TIMESTAMPS_TOKEN)?;
        let no_speech = m::NO_SPEECH_TOKENS
            .iter()
            .find_map(|t| tokens.id(t).ok())
            .ok_or_else(|| AudioError::Failed("no-speech token missing".into()))?;
        let suppress: Vec<f32> = (0..config.vocab_size as u32)
            .map(|i| {
                if config.suppress_tokens.contains(&i) || i == no_timestamps {
                    f32::NEG_INFINITY
                } else {
                    0.0
                }
            })
            .collect();
        let suppress = Tensor::new(suppress.as_slice(), &device).map_err(fail)?;
        let languages = tokens.languages(sot, translate);
        let filters = mel_filters(config.num_mel_bins);
        Ok(Self {
            model,
            config,
            tokens,
            filters,
            device,
            suppress,
            sot,
            transcribe,
            eot,
            no_timestamps,
            no_speech,
            languages,
        })
    }

    fn mel(&self, pcm: &[f32]) -> Result<Tensor, AudioError> {
        let mel = audio::pcm_to_mel(&self.config, pcm, &self.filters);
        let n = self.config.num_mel_bins;
        let frames = mel.len() / n;
        Tensor::from_vec(mel, (1, n, frames), &self.device).map_err(fail)
    }

    fn detect_language(&mut self, features: &Tensor) -> Result<(u32, String), AudioError> {
        let tokens = Tensor::new(&[[self.sot]], &self.device).map_err(fail)?;
        let ys = self
            .model
            .decoder
            .forward(&tokens, features, true)
            .map_err(fail)?;
        let logits = self
            .model
            .decoder
            .final_linear(&ys.i((..1, 0..1)).map_err(fail)?)
            .map_err(fail)?
            .i(0)
            .map_err(fail)?
            .i(0)
            .map_err(fail)?;
        let logits: Vec<f32> = logits.to_vec1().map_err(fail)?;
        self.languages
            .iter()
            .max_by(|a, b| logits[a.0 as usize].total_cmp(&logits[b.0 as usize]))
            .cloned()
            .ok_or_else(|| AudioError::Failed("speech model has no language tokens".into()))
    }

    /// One greedy pass over a 30 s window. Returns the sampled tokens and the no-speech probability.
    fn decode_window(
        &mut self,
        features: &Tensor,
        language: u32,
    ) -> Result<(Vec<u32>, f64, f64), AudioError> {
        let prompt = vec![self.sot, language, self.transcribe];
        let mut tokens = prompt.clone();
        let mut no_speech_prob = 0.0;
        let mut sum_logprob = 0.0;
        let ts_begin = self.no_timestamps + 1;
        let vocab = self.config.vocab_size;
        for i in 0..SAMPLE_LEN {
            cancel::check()?;
            let input = Tensor::new(tokens.as_slice(), &self.device)
                .and_then(|t| t.unsqueeze(0))
                .map_err(fail)?;
            let ys = self
                .model
                .decoder
                .forward(&input, features, i == 0)
                .map_err(fail)?;
            if i == 0 {
                let first = self
                    .model
                    .decoder
                    .final_linear(&ys.i(..1).map_err(fail)?)
                    .map_err(fail)?
                    .i(0)
                    .map_err(fail)?
                    .i(0)
                    .map_err(fail)?;
                let probs: Vec<f32> = candle_nn::ops::softmax(&first, 0)
                    .and_then(|p| p.to_vec1())
                    .map_err(fail)?;
                no_speech_prob = probs[self.no_speech as usize] as f64;
            }
            let (_, seq, _) = ys.dims3().map_err(fail)?;
            let logits = self
                .model
                .decoder
                .final_linear(&ys.i((..1, seq - 1..)).map_err(fail)?)
                .map_err(fail)?
                .i(0)
                .map_err(fail)?
                .i(0)
                .map_err(fail)?;
            let logits = logits.broadcast_add(&self.suppress).map_err(fail)?;
            let mut v: Vec<f32> = logits.to_vec1().map_err(fail)?;
            apply_timestamp_rules(
                &mut v,
                &tokens[prompt.len()..],
                ts_begin,
                self.eot,
                vocab,
                i == 0,
            );
            let log_probs = log_softmax(&v);
            let next = argmax(&v);
            tokens.push(next);
            if next == self.eot || tokens.len() > self.config.max_target_positions {
                break;
            }
            sum_logprob += log_probs[next as usize] as f64;
            if repeats(&tokens[prompt.len()..]) {
                tokens.push(self.eot);
                break;
            }
        }
        let sampled = tokens[prompt.len()..].to_vec();
        let avg = sum_logprob / sampled.len().max(1) as f64;
        Ok((sampled, no_speech_prob, avg))
    }

    /// Transcribe 16 kHz mono PCM. `language` is an ISO code or `None` for auto-detect.
    pub fn transcribe(
        &mut self,
        pcm: &[f32],
        language: Option<&str>,
        progress: &dyn Fn(f32),
    ) -> Result<Transcript, AudioError> {
        let content_frames = pcm.len() / m::HOP_LENGTH;
        // Pad with 30 s of silence so every window, including the last, is a full 3000 frames.
        let mut padded = pcm.to_vec();
        padded.extend(std::iter::repeat_n(0.0f32, m::N_SAMPLES));
        let mel = self.mel(&padded)?;
        let total_frames = mel.dims3().map_err(fail)?.2;
        let mut lang: Option<(u32, String)> = match language {
            Some(code) => self.languages.iter().find(|(_, c)| c == code).cloned(),
            None => None,
        };
        let ts_begin = self.no_timestamps + 1;
        let mut cues = Vec::new();
        let mut seek = 0usize;
        while seek < content_frames {
            cancel::check()?;
            progress(seek as f32 / content_frames.max(1) as f32);
            let window = m::N_FRAMES.min(total_frames - seek);
            let segment = mel.narrow(2, seek, window).map_err(fail)?;
            let features = self.model.encoder.forward(&segment, true).map_err(fail)?;
            if lang.is_none() {
                lang = Some(self.detect_language(&features)?);
            }
            let language_token = lang.as_ref().map(|l| l.0).unwrap_or(self.transcribe);
            let (tokens, no_speech, avg_logprob) = self.decode_window(&features, language_token)?;
            let offset = seek as f64 * m::HOP_LENGTH as f64 / m::SAMPLE_RATE as f64;
            let window_secs = (content_frames - seek).min(m::N_FRAMES) as f64 * 0.01;
            if no_speech > m::NO_SPEECH_THRESHOLD && avg_logprob < m::LOGPROB_THRESHOLD {
                seek += m::N_FRAMES;
                continue;
            }
            let (found, last_ts) = segments(&self.tokens, &tokens, ts_begin, self.eot);
            for (start, end, text) in found {
                let text = text.trim().to_string();
                let (start, end) = (offset + start, offset + end.min(window_secs));
                if !text.is_empty() && end > start {
                    cues.push(Cue { start, end, text });
                }
            }
            // Continue from the last complete timestamp so words cut at the window edge are redone.
            let ended_single = tokens.len() >= 2
                && tokens[tokens.len() - 2] >= ts_begin
                && tokens.len() >= 3
                && tokens[tokens.len() - 3] < ts_begin;
            match last_ts {
                Some(ts) if !ended_single && ts > 1.0 => seek += (ts * 100.0) as usize,
                _ => seek += m::N_FRAMES,
            }
        }
        progress(1.0);
        Ok(Transcript {
            language: lang.map(|l| l.1).unwrap_or_default(),
            cues,
        })
    }
}

/// Split `<|t0|> text <|t1|>` runs into `(start, end, text)`, seconds relative to the window.
fn segments(
    tokens: &Tokens,
    sampled: &[u32],
    ts_begin: u32,
    eot: u32,
) -> (Vec<(f64, f64, String)>, Option<f64>) {
    let mut out = Vec::new();
    let mut start: Option<f64> = None;
    let mut text: Vec<u32> = Vec::new();
    let mut last_ts = None;
    for &tok in sampled {
        if tok == eot {
            break;
        }
        if tok >= ts_begin {
            let t = (tok - ts_begin) as f64 * 0.02;
            match start {
                Some(s) if !text.is_empty() => {
                    out.push((s, t, tokens.decode(&text)));
                    text.clear();
                    start = None;
                    last_ts = Some(t);
                }
                _ => start = Some(t),
            }
        } else {
            text.push(tok);
        }
    }
    (out, last_ts)
}

fn argmax(v: &[f32]) -> u32 {
    v.iter()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(b.1))
        .map(|(i, _)| i as u32)
        .unwrap_or(0)
}

fn log_softmax(v: &[f32]) -> Vec<f32> {
    let max = v.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let sum: f32 = v.iter().map(|x| (x - max).exp()).sum();
    let lse = max + sum.ln();
    v.iter().map(|x| x - lse).collect()
}

/// Whisper's ApplyTimestampRules on a plain logits vector.
fn apply_timestamp_rules(
    logits: &mut [f32],
    sampled: &[u32],
    ts_begin: u32,
    eot: u32,
    vocab: usize,
    first: bool,
) {
    let ts_begin = ts_begin as usize;
    let mask = |logits: &mut [f32], range: std::ops::Range<usize>| {
        for x in &mut logits[range] {
            *x = f32::NEG_INFINITY;
        }
    };
    let last_ts = sampled.last().is_some_and(|&t| t as usize >= ts_begin);
    let penultimate_ts = sampled.len() < 2 || sampled[sampled.len() - 2] as usize >= ts_begin;
    if last_ts {
        if penultimate_ts {
            mask(logits, ts_begin..vocab);
        } else {
            mask(logits, 0..eot as usize);
        }
    }
    if let Some(&prev) = sampled.iter().rev().find(|&&t| t as usize >= ts_begin) {
        let floor = if last_ts && !penultimate_ts {
            prev as usize
        } else {
            prev as usize + 1
        };
        mask(logits, ts_begin..floor.min(vocab));
    }
    if first {
        mask(logits, 0..ts_begin);
        // max_initial_timestamp = 1.0 s
        mask(logits, (ts_begin + 51).min(vocab)..vocab);
    }
    let lp = log_softmax(logits);
    let ts_max = lp[ts_begin..]
        .iter()
        .copied()
        .fold(f32::NEG_INFINITY, f32::max);
    let ts_sum = ts_max
        + lp[ts_begin..]
            .iter()
            .map(|x| (x - ts_max).exp())
            .sum::<f32>()
            .ln();
    let text_max = lp[..ts_begin]
        .iter()
        .copied()
        .fold(f32::NEG_INFINITY, f32::max);
    if ts_sum > text_max {
        mask(logits, 0..ts_begin);
    }
}

/// True when the tail is a short phrase looping (a common greedy-decoding failure).
fn repeats(tokens: &[u32]) -> bool {
    for n in 1..=8 {
        let reps = if n <= 2 { 12 } else { 4 };
        if tokens.len() < n * reps {
            continue;
        }
        let tail = &tokens[tokens.len() - n * reps..];
        if tail.chunks(n).all(|c| c == &tail[..n]) {
            return true;
        }
    }
    false
}

/// SRT text for cues.
pub fn to_srt(cues: &[Cue]) -> String {
    let stamp = |t: f64| {
        let ms = (t.max(0.0) * 1000.0).round() as u64;
        format!(
            "{:02}:{:02}:{:02},{:03}",
            ms / 3_600_000,
            ms / 60_000 % 60,
            ms / 1000 % 60,
            ms % 1000
        )
    };
    cues.iter()
        .enumerate()
        .map(|(i, c)| {
            format!(
                "{}\n{} --> {}\n{}\n",
                i + 1,
                stamp(c.start),
                stamp(c.end),
                c.text
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[allow(dead_code)]
fn _dtype_check() -> DType {
    m::DTYPE
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mel_filters_match_librosa_shape_and_norm() {
        let f = mel_filters(80);
        assert_eq!(f.len(), 80 * 201);
        // librosa.filters.mel(sr=16000, n_fft=400, n_mels=80)[0][1] == 0.02486259
        assert!((f[1] - 0.024_862_59).abs() < 1e-5, "{}", f[1]);
        assert!(f[0].abs() < 1e-9);
        assert!(f.iter().all(|x| *x >= 0.0));
    }

    #[test]
    fn byte_decoder_round_trips_gpt2_space() {
        let map = unicode_to_bytes();
        assert_eq!(map.len(), 256);
        assert_eq!(map[&'Ġ'], b' ');
        assert_eq!(map[&'a'], b'a');
    }

    #[test]
    fn repetition_guard() {
        assert!(repeats(&[5; 12]));
        assert!(!repeats(&[1, 2, 3, 4, 5, 6]));
        assert!(repeats(&[1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3]));
    }

    #[test]
    fn srt_format() {
        let s = to_srt(&[Cue {
            start: 1.5,
            end: 62.25,
            text: "Merhaba".into(),
        }]);
        assert_eq!(s, "1\n00:00:01,500 --> 00:01:02,250\nMerhaba\n");
    }
}

#[cfg(test)]
mod model_tests {
    use super::*;

    /// Compares against candle's reference `melfilters.bytes` when present.
    #[test]
    fn mel_filters_equal_reference_file() {
        let Ok(path) = std::env::var("XENOCUT_MELFILTERS") else {
            return;
        };
        let bytes = std::fs::read(path).unwrap();
        let reference: Vec<f32> = bytes
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect();
        let ours = mel_filters(80);
        let worst = ours
            .iter()
            .zip(&reference)
            .map(|(a, b)| (a - b).abs())
            .fold(0f32, f32::max);
        assert!(worst < 1e-6, "max diff {worst}");
    }

    /// End to end with a real model: `XENOCUT_WHISPER_DIR=<dir with whisper-base> XENOCUT_WHISPER_WAV=jfk.wav`.
    #[test]
    #[ignore]
    fn transcribes_speech() {
        let root = PathBuf::from(std::env::var("XENOCUT_WHISPER_DIR").unwrap());
        let wav = PathBuf::from(std::env::var("XENOCUT_WHISPER_WAV").unwrap());
        let pcm = read_pcm(&wav, 0.0, None).unwrap();
        let t0 = std::time::Instant::now();
        let mut r = Recognizer::load(&model_dir(&root, ModelSize::Base)).unwrap();
        let load = t0.elapsed();
        let out = r.transcribe(&pcm, None, &|_| {}).unwrap();
        eprintln!(
            "load {load:?} total {:?} audio {:.1}s lang {}",
            t0.elapsed(),
            pcm.len() as f64 / 16000.0,
            out.language
        );
        eprintln!("{}", to_srt(&out.cues));
        let all: String = out
            .cues
            .iter()
            .map(|c| c.text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        assert!(all.contains("country"), "{all}");
    }
}
