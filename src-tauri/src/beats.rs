//! Beat tracking for the AMV tools: an onset-strength envelope (log spectral flux), a tempo
//! estimate from its autocorrelation, then dynamic-programming beat tracking (D. Ellis, "Beat
//! Tracking by Dynamic Programming", 2007 — the method librosa's `beat_track` uses).

use std::path::Path;
use std::process::{Command, Stdio};

use rustfft::{num_complex::Complex32, FftPlanner};
use serde::Serialize;

use crate::audio::ffmpeg;

pub const RATE: u32 = 22_050;
const N_FFT: usize = 2048;
const HOP: usize = 512;
const MIN_BPM: f64 = 60.0;
const MAX_BPM: f64 = 200.0;
/// Tempo prior: log-normal around 120 BPM, one octave wide.
const PRIOR_BPM: f64 = 120.0;
/// How strongly beats keep to the tempo (librosa's `tightness`).
const TIGHTNESS: f64 = 100.0;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BeatInfo {
    pub bpm: f64,
    /// Beat times in seconds from the start of the analysed audio.
    pub beats: Vec<f64>,
    /// Onset strength at each beat, 0..1.
    pub strength: Vec<f32>,
    /// Index (0..3) of the first downbeat, assuming four beats to the bar.
    pub downbeat: usize,
    pub duration: f64,
}

const fn frame_secs() -> f64 {
    HOP as f64 / RATE as f64
}

/// Mono float PCM at [`RATE`] of the input's first audio stream.
pub fn read_pcm(input: &Path, start: f64, duration: Option<f64>) -> Result<Vec<f32>, String> {
    let bin = ffmpeg::ffmpeg_binary().map_err(|e| e.to_string())?;
    let mut cmd = Command::new(bin);
    cmd.args(["-hide_banner", "-loglevel", "error", "-nostdin"]);
    if start > 0.0 {
        cmd.args(["-ss", &format!("{start:.3}")]);
    }
    if let Some(d) = duration {
        cmd.args(["-t", &format!("{d:.3}")]);
    }
    let rate = RATE.to_string();
    cmd.arg("-i").arg(input).args(["-vn", "-map", "0:a:0", "-ac", "1", "-ar", &rate, "-f", "f32le", "pipe:1"]);
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("could not read the audio: {}", err.trim()));
    }
    Ok(out.stdout.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect())
}

/// Onset strength per hop: positive change of log magnitude summed over frequency, with the
/// slow trend removed and scaled to unit deviation.
pub fn onset_envelope(samples: &[f32]) -> Vec<f32> {
    if samples.len() < N_FFT {
        return Vec::new();
    }
    let frames = (samples.len() - N_FFT) / HOP + 1;
    let window: Vec<f32> = (0..N_FFT).map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / N_FFT as f32).cos()).collect();
    let fft = FftPlanner::<f32>::new().plan_fft_forward(N_FFT);
    let bins = N_FFT / 2 + 1;
    // Ignore the rumble below ~30 Hz and the hiss above ~8 kHz.
    let lo = (30.0 * N_FFT as f32 / RATE as f32) as usize;
    let hi = ((8000.0 * N_FFT as f32 / RATE as f32) as usize).min(bins);
    let mut prev = vec![0f32; bins];
    let mut buf = vec![Complex32::new(0.0, 0.0); N_FFT];
    let mut env = Vec::with_capacity(frames);
    for f in 0..frames {
        let s = &samples[f * HOP..f * HOP + N_FFT];
        for i in 0..N_FFT {
            buf[i] = Complex32::new(s[i] * window[i], 0.0);
        }
        fft.process(&mut buf);
        let mut flux = 0f32;
        for b in lo..hi {
            let m = (1.0 + 1000.0 * buf[b].norm()).ln();
            if f > 0 {
                flux += (m - prev[b]).max(0.0);
            }
            prev[b] = m;
        }
        env.push(flux);
    }
    // Remove the local mean (~1 s) so loud passages do not swamp the quiet ones.
    let half = (0.5 / frame_secs()) as usize;
    let mut prefix = vec![0f64; env.len() + 1];
    for (i, v) in env.iter().enumerate() {
        prefix[i + 1] = prefix[i] + *v as f64;
    }
    let detrended: Vec<f32> = (0..env.len())
        .map(|i| {
            let a = i.saturating_sub(half);
            let b = (i + half + 1).min(env.len());
            let mean = (prefix[b] - prefix[a]) / (b - a) as f64;
            (env[i] as f64 - mean).max(0.0) as f32
        })
        .collect();
    let n = detrended.len().max(1) as f32;
    let mean = detrended.iter().sum::<f32>() / n;
    let std = (detrended.iter().map(|v| (v - mean).powi(2)).sum::<f32>() / n).sqrt().max(1e-6);
    detrended.iter().map(|v| v / std).collect()
}

/// Beat period in frames (fractional) from the envelope's autocorrelation, weighted by the prior.
pub fn estimate_period(env: &[f32]) -> f64 {
    let fs = 1.0 / frame_secs();
    let min_lag = (60.0 / MAX_BPM * fs).floor() as usize;
    let max_lag = ((60.0 / MIN_BPM * fs).ceil() as usize).min(env.len().saturating_sub(1));
    if max_lag <= min_lag + 2 {
        return 60.0 / PRIOR_BPM * fs;
    }
    let ac = |lag: usize| -> f64 { env[lag..].iter().zip(env).map(|(a, b)| (*a as f64) * (*b as f64)).sum::<f64>() / (env.len() - lag) as f64 };
    let raw: Vec<f64> = (0..=max_lag + 1).map(|l| if l >= min_lag.saturating_sub(1) { ac(l) } else { 0.0 }).collect();
    let score = |lag: f64| -> f64 {
        let bpm = 60.0 * fs / lag;
        (-0.5 * ((bpm / PRIOR_BPM).log2()).powi(2)).exp()
    };
    // A lag also scores its double, which favours the beat level over sub-beats.
    let total = |l: usize| -> f64 {
        let mut v = raw[l];
        if 2 * l <= max_lag + 1 && 2 * l < raw.len() {
            v += 0.5 * raw[2 * l];
        }
        v * score(l as f64)
    };
    let best = (min_lag..=max_lag).max_by(|a, b| total(*a).partial_cmp(&total(*b)).unwrap()).unwrap();
    // Parabolic refinement around the peak.
    if best > min_lag && best < max_lag {
        let (a, b, c) = (total(best - 1), total(best), total(best + 1));
        let d = a - 2.0 * b + c;
        if d.abs() > 1e-12 {
            return best as f64 + (0.5 * (a - c) / d).clamp(-0.5, 0.5);
        }
    }
    best as f64
}

/// Beat frames: maximise onset strength at the beats minus a penalty for straying from the period.
pub fn track(env: &[f32], period: f64) -> Vec<usize> {
    let n = env.len();
    if n == 0 || period < 1.0 {
        return Vec::new();
    }
    // Smooth the envelope a little with a Gaussian ~ period / 32 wide, as librosa does.
    let sigma = (period / 32.0).max(0.5);
    let k = (sigma * 3.0).ceil() as isize;
    let kernel: Vec<f64> = (-k..=k).map(|i| (-0.5 * (i as f64 / sigma).powi(2)).exp()).collect();
    let local: Vec<f64> = (0..n as isize)
        .map(|i| (-k..=k).map(|j| env.get((i + j).max(0) as usize).copied().unwrap_or(0.0) as f64 * kernel[(j + k) as usize]).sum())
        .collect();
    let mut score = vec![0f64; n];
    let mut back = vec![usize::MAX; n];
    let lo = (period / 2.0).round() as usize;
    let hi = (period * 2.0).round() as usize;
    for t in 0..n {
        let mut best = f64::NEG_INFINITY;
        let mut arg = usize::MAX;
        if t >= lo {
            for p in t.saturating_sub(hi)..=t - lo {
                let gap = (t - p) as f64;
                let v = score[p] - TIGHTNESS * (gap / period).ln().powi(2);
                if v > best {
                    best = v;
                    arg = p;
                }
            }
        }
        if arg != usize::MAX && best > 0.0 {
            score[t] = local[t] + best;
            back[t] = arg;
        } else {
            score[t] = local[t];
        }
    }
    // The last beat: the best-scoring local maximum near the end.
    let tail = n.saturating_sub(period.ceil() as usize * 2);
    let maxima: Vec<usize> = (1..n.saturating_sub(1)).filter(|&t| score[t] >= score[t - 1] && score[t] >= score[t + 1]).collect();
    let median = {
        let mut v: Vec<f64> = maxima.iter().map(|&t| score[t]).collect();
        v.sort_by(|a, b| a.partial_cmp(b).unwrap());
        v.get(v.len() / 2).copied().unwrap_or(0.0)
    };
    let last = (tail..n).filter(|&t| maxima.binary_search(&t).is_ok() && score[t] >= 0.5 * median).max_by(|a, b| score[*a].partial_cmp(&score[*b]).unwrap());
    let Some(mut t) = last.or_else(|| (tail..n).max_by(|a, b| score[*a].partial_cmp(&score[*b]).unwrap())) else {
        return Vec::new();
    };
    let mut beats = vec![t];
    while back[t] != usize::MAX {
        t = back[t];
        beats.push(t);
    }
    beats.reverse();
    // Drop leading / trailing beats in silence (weak onsets before the music starts or after it ends).
    let rms = (local.iter().map(|v| v * v).sum::<f64>() / n as f64).sqrt();
    let strong = |b: &usize| local[*b] >= 0.5 * rms;
    let first = beats.iter().position(strong).unwrap_or(0);
    let last = beats.iter().rposition(strong).map(|i| i + 1).unwrap_or(beats.len());
    beats[first..last].to_vec()
}

/// The beat (0..3) that starts the bar: the phase whose beats are loudest on average.
fn downbeat_phase(strength: &[f32]) -> usize {
    (0..4)
        .max_by(|a, b| {
            let avg = |p: usize| {
                let v: Vec<f32> = strength.iter().skip(p).step_by(4).copied().collect();
                v.iter().sum::<f32>() / v.len().max(1) as f32
            };
            avg(*a).partial_cmp(&avg(*b)).unwrap()
        })
        .unwrap_or(0)
}

pub fn analyze(samples: &[f32]) -> BeatInfo {
    let duration = samples.len() as f64 / RATE as f64;
    let env = onset_envelope(samples);
    if env.len() < 16 {
        return BeatInfo { bpm: 0.0, beats: Vec::new(), strength: Vec::new(), downbeat: 0, duration };
    }
    let period = estimate_period(&env);
    let frames = track(&env, period);
    // Frame f covers samples [f * HOP, f * HOP + N_FFT): its flux marks the change at the centre.
    let offset = (N_FFT / 2) as f64 / RATE as f64;
    let beats: Vec<f64> = frames.iter().map(|&f| f as f64 * frame_secs() + offset).collect();
    let peak = frames.iter().map(|&f| env[f]).fold(0f32, f32::max).max(1e-6);
    let strength: Vec<f32> = frames.iter().map(|&f| (env[f] / peak).clamp(0.0, 1.0)).collect();
    // Tempo from the tracked beats where possible (more precise than the autocorrelation peak).
    let bpm = if beats.len() >= 4 {
        // Least-squares slope of beat time over beat index: averages out the hop quantisation.
        let n = beats.len() as f64;
        let mx = (n - 1.0) / 2.0;
        let my = beats.iter().sum::<f64>() / n;
        let (sxy, sxx) = beats.iter().enumerate().fold((0.0, 0.0), |(sxy, sxx), (i, y)| (sxy + (i as f64 - mx) * (y - my), sxx + (i as f64 - mx).powi(2)));
        60.0 / (sxy / sxx)
    } else {
        60.0 / (period * frame_secs())
    };
    let downbeat = downbeat_phase(&strength);
    BeatInfo { bpm: (bpm * 10.0).round() / 10.0, beats, strength, downbeat, duration }
}

#[tauri::command]
pub async fn beat_detect(path: String, start: Option<f64>, duration: Option<f64>) -> Result<BeatInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let pcm = read_pcm(Path::new(&path), start.unwrap_or(0.0), duration)?;
        if pcm.is_empty() {
            return Err("This file has no audio.".to_string());
        }
        Ok(analyze(&pcm))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Kick-like clicks at `bpm` (accent every fourth) over quiet noise, starting at `first` s.
    fn click_track(bpm: f64, secs: f64, first: f64) -> Vec<f32> {
        let n = (secs * RATE as f64) as usize;
        let mut seed = 12345u32;
        let mut out: Vec<f32> = (0..n)
            .map(|_| {
                seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12345);
                ((seed >> 16) as f32 / 32768.0 - 1.0) * 0.02
            })
            .collect();
        let period = 60.0 / bpm;
        let mut k = 0;
        let mut t = first;
        while t < secs {
            let s = (t * RATE as f64) as usize;
            let amp = if k % 4 == 0 { 0.9 } else { 0.5 };
            for i in 0..(0.08 * RATE as f64) as usize {
                if s + i >= n {
                    break;
                }
                let tt = i as f32 / RATE as f32;
                out[s + i] += amp * (-tt * 40.0).exp() * (2.0 * std::f32::consts::PI * (60.0 + 200.0 * (-tt * 30.0).exp()) * tt).sin();
                out[s + i] += amp * 0.3 * (-tt * 200.0).exp() * if i % 2 == 0 { 1.0 } else { -1.0 };
            }
            k += 1;
            t = first + k as f64 * period;
        }
        out
    }

    #[test]
    fn finds_tempo_and_beats() {
        for bpm in [92.0, 128.0, 150.0] {
            let info = analyze(&click_track(bpm, 20.0, 0.5));
            assert!((info.bpm - bpm).abs() < 2.0, "bpm {bpm}: got {}", info.bpm);
            let period = 60.0 / bpm;
            // Every detected beat sits on a click (within 35 ms).
            for b in &info.beats {
                let k = ((b - 0.5) / period).round();
                assert!((b - (0.5 + k * period)).abs() < 0.035, "bpm {bpm}: beat {b} off the grid");
            }
            assert!(info.beats.len() as f64 >= 0.9 * 19.5 / period, "bpm {bpm}: only {} beats", info.beats.len());
        }
    }

    #[test]
    fn finds_the_accented_downbeat() {
        let info = analyze(&click_track(120.0, 16.0, 0.5));
        let first = info.beats[info.downbeat];
        let k = ((first - 0.5) / 0.5).round() as i64;
        assert_eq!(k % 4, 0, "downbeat at {first}");
    }

    #[test]
    fn silence_has_no_beats() {
        let info = analyze(&vec![0.0; RATE as usize * 4]);
        assert!(info.beats.len() <= 1, "{:?}", info.beats);
    }
}

#[cfg(test)]
mod real {
    /// `XENOCUT_BEATS_FILE=song.mp3 cargo test --lib beats::real -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_file() {
        let path = std::env::var("XENOCUT_BEATS_FILE").expect("XENOCUT_BEATS_FILE");
        let t0 = std::time::Instant::now();
        let pcm = super::read_pcm(std::path::Path::new(&path), 0.0, None).unwrap();
        let info = super::analyze(&pcm);
        println!("{:.1}s audio in {:?}: bpm {} beats {} downbeat {}", info.duration, t0.elapsed(), info.bpm, info.beats.len(), info.downbeat);
        println!("{:?}", &info.beats.iter().take(16).map(|b| (b * 100.0).round() / 100.0).collect::<Vec<_>>());
    }
}
