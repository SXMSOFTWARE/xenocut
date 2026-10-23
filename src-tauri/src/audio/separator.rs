use std::path::Path;
use std::sync::OnceLock;

use ndarray::Array4;
use ort::session::{RunOptions, Session};
use ort::value::TensorRef;
use rustfft::num_complex::Complex;

use super::cancel;
use super::chunk::{mdx_sizes, mdx_tail_pad, plan_overlapped_chunks};
use super::ffmpeg;
use super::model::{self, MdxConfig};
use super::stft::Stft;
use super::traits::{AudioError, ProgressSink, StemPaths, StemSeparator};
use super::wav;

type C = Complex<f32>;

pub struct OnnxMdxSeparator {
    pub model_dir: std::path::PathBuf,
}

impl StemSeparator for OnnxMdxSeparator {
    fn name(&self) -> &'static str {
        "onnx-mdx-voc-ft"
    }

    fn separate(
        &self,
        input: &Path,
        output_dir: &Path,
        progress: &dyn ProgressSink,
    ) -> Result<StemPaths, AudioError> {
        if !input.is_file() {
            return Err(AudioError::MissingInput(input.display().to_string()));
        }
        cancel::check()?;
        std::fs::create_dir_all(output_dir).map_err(|err| AudioError::Failed(err.to_string()))?;

        progress.report(0.02, "Extracting audio");
        let extracted = output_dir.join("source.wav");
        ffmpeg::extract_wav(input, &extracted)?;
        cancel::check()?;

        let model_path = model::ensure_model(&self.model_dir, progress)?;
        progress.report(0.38, "Loading vocal model");
        let env = onnx_env()?;
        let mut builder = Session::builder(env)
            .map_err(|err| AudioError::Failed(err.to_string()))?
            .with_intra_threads(2)
            .map_err(|err| AudioError::Failed(err.to_string()))?;
        let mut session = builder
            .commit_from_file(&model_path)
            .map_err(|err| AudioError::Failed(format!("could not load the vocal model: {err}")))?;

        let config = MdxConfig::voc_ft();
        let (rate, left, right) = wav::read_stereo(&extracted)?;
        if rate != config.sample_rate {
            return Err(AudioError::Failed(format!(
                "expected {} Hz audio, got {rate}",
                config.sample_rate
            )));
        }
        let (vocals_l, vocals_r) = separate_channels(&mut session, &left, &right, &config, progress)?;
        if vocals_l.iter().chain(vocals_r.iter()).any(|sample| !sample.is_finite()) {
            return Err(AudioError::Failed("Separation produced invalid audio.".into()));
        }

        let compensate = config.compensate;
        let inst_l: Vec<f32> = left
            .iter()
            .zip(vocals_l.iter())
            .map(|(mix, vocal)| mix - vocal * compensate)
            .collect();
        let inst_r: Vec<f32> = right
            .iter()
            .zip(vocals_r.iter())
            .map(|(mix, vocal)| mix - vocal * compensate)
            .collect();

        progress.report(0.94, "Writing stems");
        let vocals = output_dir.join("vocals.wav");
        let instrumental = output_dir.join("instrumental.wav");
        wav::write_stereo(&vocals, rate, &vocals_l, &vocals_r)?;
        wav::write_stereo(&instrumental, rate, &inst_l, &inst_r)?;
        let _ = std::fs::remove_file(&extracted);
        progress.report(1.0, "Stems ready");
        Ok(StemPaths { vocals, instrumental })
    }
}

fn onnx_env() -> Result<&'static ort::environment::Environment, AudioError> {
    static ENV: OnceLock<ort::environment::Environment> = OnceLock::new();
    if let Some(env) = ENV.get() {
        return Ok(env);
    }
    let env = ort::init()
        .with_name("xenocut")
        .with_telemetry(false)
        .build()
        .map_err(|err| AudioError::Failed(err.to_string()))?;
    let _ = ENV.set(env);
    ENV.get().ok_or_else(|| AudioError::Failed("ONNX Runtime did not start".into()))
}

fn separate_channels(
    session: &mut Session,
    left: &[f32],
    right: &[f32],
    config: &MdxConfig,
    progress: &dyn ProgressSink,
) -> Result<(Vec<f32>, Vec<f32>), AudioError> {
    let n = left.len().min(right.len());
    let left = &left[..n];
    let right = &right[..n];
    let peak = left
        .iter()
        .chain(right.iter())
        .map(|sample| sample.abs())
        .fold(0.0f32, f32::max);
    let norm = if peak > 1e-8 { peak } else { 1.0 };
    let left_n: Vec<f32> = left.iter().map(|sample| sample / norm).collect();
    let right_n: Vec<f32> = right.iter().map(|sample| sample / norm).collect();

    let (chunk_size, trim, gen_size) = mdx_sizes(config.hop, config.dim_t, config.n_fft);
    let pad = mdx_tail_pad(n, gen_size, trim);
    let mut mix_l = vec![0.0f32; trim + n + pad];
    let mut mix_r = vec![0.0f32; trim + n + pad];
    mix_l[trim..trim + n].copy_from_slice(&left_n);
    mix_r[trim..trim + n].copy_from_slice(&right_n);

    let chunks = plan_overlapped_chunks(mix_l.len(), chunk_size, config.overlap);
    let total_chunks = chunks.len().max(1);
    let mut acc_l = vec![0.0f32; mix_l.len()];
    let mut acc_r = vec![0.0f32; mix_r.len()];
    let mut divider = vec![0.0f32; mix_l.len()];
    let stft = Stft::new(config.n_fft, config.hop, config.dim_f);

    for (index, chunk) in chunks.iter().enumerate() {
        cancel::check()?;
        let len = chunk.end - chunk.start;
        let mut part_l = vec![0.0f32; chunk_size];
        let mut part_r = vec![0.0f32; chunk_size];
        part_l[..len].copy_from_slice(&mix_l[chunk.start..chunk.end]);
        part_r[..len].copy_from_slice(&mix_r[chunk.start..chunk.end]);
        let (out_l, out_r) = infer_chunk(session, &stft, &part_l, &part_r, config)?;
        let window = hanning(len);
        for offset in 0..len {
            let weight = if config.overlap > 0.0 { window[offset] } else { 1.0 };
            acc_l[chunk.start + offset] += out_l[offset] * weight;
            acc_r[chunk.start + offset] += out_r[offset] * weight;
            divider[chunk.start + offset] += weight;
        }
        let fraction = 0.42 + 0.50 * ((index + 1) as f32 / total_chunks as f32);
        progress.report(fraction, "Separating vocals");
    }

    let mut vocals_l = vec![0.0f32; n];
    let mut vocals_r = vec![0.0f32; n];
    for index in 0..n {
        let at = trim + index;
        let scale = if divider[at] > 1e-6 { norm / divider[at] } else { 0.0 };
        vocals_l[index] = acc_l[at] * scale;
        vocals_r[index] = acc_r[at] * scale;
    }
    Ok((vocals_l, vocals_r))
}

fn infer_chunk(
    session: &mut Session,
    stft: &Stft,
    left: &[f32],
    right: &[f32],
    config: &MdxConfig,
) -> Result<(Vec<f32>, Vec<f32>), AudioError> {
    let spec_l = stft.forward(left);
    let spec_r = stft.forward(right);
    let frames = spec_l.len().min(spec_r.len());
    if frames == 0 {
        return Ok((vec![0.0; left.len()], vec![0.0; right.len()]));
    }
    let mut input = Array4::<f32>::zeros((1, 4, config.dim_f, frames));
    for time in 0..frames {
        for bin in 0..config.dim_f.min(spec_l[time].len()) {
            input[[0, 0, bin, time]] = spec_l[time][bin].re;
            input[[0, 1, bin, time]] = spec_l[time][bin].im;
            input[[0, 2, bin, time]] = spec_r[time][bin].re;
            input[[0, 3, bin, time]] = spec_r[time][bin].im;
        }
    }
    for channel in 0..4 {
        for bin in 0..3.min(config.dim_f) {
            for time in 0..frames {
                input[[0, channel, bin, time]] = 0.0;
            }
        }
    }

    let tensor = TensorRef::from_array_view(&input).map_err(|err| AudioError::Failed(err.to_string()))?;
    let options = RunOptions::new().map_err(|err| AudioError::Failed(err.to_string()))?;
    let outputs = session
        .run_with_options(ort::inputs!["input" => tensor], &options)
        .map_err(|err| AudioError::Failed(format!("vocal model failed: {err}")))?;
    let view = outputs[0]
        .try_extract_array::<f32>()
        .map_err(|err| AudioError::Failed(err.to_string()))?;
    if view.ndim() != 4 {
        return Err(AudioError::Failed(format!(
            "vocal model returned rank {}, expected 4",
            view.ndim()
        )));
    }
    let out_frames = view.shape()[3];
    let out_bins = view.shape()[2].min(config.dim_f);
    let mut pred_l = vec![Vec::with_capacity(out_bins); out_frames];
    let mut pred_r = vec![Vec::with_capacity(out_bins); out_frames];
    for time in 0..out_frames {
        for bin in 0..out_bins {
            pred_l[time].push(C::new(view[[0, 0, bin, time]], view[[0, 1, bin, time]]));
            pred_r[time].push(C::new(view[[0, 2, bin, time]], view[[0, 3, bin, time]]));
        }
    }
    Ok((stft.inverse(&pred_l, left.len()), stft.inverse(&pred_r, right.len())))
}

#[cfg(test)]
mod e2e {
    use super::super::renderer::FfmpegRenderer;
    use super::super::traits::{RenderJob, Renderer, StemSeparator};
    use super::{cancel, ffmpeg, model, wav, OnnxMdxSeparator, ProgressSink};
    use std::os::unix::fs::symlink;
    use std::path::Path;
    use std::time::Instant;

    struct Quiet;
    impl ProgressSink for Quiet {
        fn report(&self, amount: f32, message: &str) {
            eprintln!("separate {amount:.2} {message}");
        }
    }

    /// Full on-device pass: extract a short clip, run Voc_FT, mix onto the video.
    /// Not part of the default suite. Needs the cached model and the ffmpeg sidecar.
    #[test]
    #[ignore = "loads the 64MB UVR model; run with --ignored and XENOCUT_MODEL"]
    fn separates_and_mixes_a_short_clip() {
        let model = std::env::var("XENOCUT_MODEL").expect("set XENOCUT_MODEL to UVR-MDX-NET-Voc_FT.onnx");
        assert!(Path::new(&model).is_file(), "model missing at {model}");
        ffmpeg::ffmpeg_binary().expect("ffmpeg sidecar");
        cancel::begin();

        let dir = std::env::temp_dir().join(format!("xenocut-e2e-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let video = dir.join("clip.mp4");
        let music = dir.join("song.wav");
        let output = dir.join("xenocut-mix.mp4");
        let model_dir = dir.join("models");
        std::fs::create_dir_all(&model_dir).unwrap();
        symlink(&model, model_dir.join(model::MODEL_FILE)).unwrap();

        ffmpeg::run(
            &[
                "-hide_banner".into(),
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "testsrc=size=320x180:rate=24:duration=3".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "sine=frequency=196:sample_rate=44100:duration=3".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "sine=frequency=784:sample_rate=44100:duration=3".into(),
                "-filter_complex".into(),
                "[1:a][2:a]amix=inputs=2:normalize=0[a]".into(),
                "-map".into(),
                "0:v".into(),
                "-map".into(),
                "[a]".into(),
                "-shortest".into(),
                "-c:v".into(),
                "libx264".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
                "-c:a".into(),
                "aac".into(),
                video.display().to_string(),
            ],
            None,
            None,
            "sample",
        )
        .expect("sample video");

        ffmpeg::run(
            &[
                "-hide_banner".into(),
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "sine=frequency=523:sample_rate=44100:duration=4".into(),
                "-c:a".into(),
                "pcm_s16le".into(),
                music.display().to_string(),
            ],
            None,
            None,
            "music",
        )
        .expect("music");

        let separator = OnnxMdxSeparator { model_dir };
        let started = Instant::now();
        let stems = separator
            .separate(&video, &dir.join("stems"), &Quiet)
            .expect("separate");
        let separate_ms = started.elapsed().as_millis();
        let (_, vocals_l, vocals_r) = wav::read_stereo(&stems.vocals).unwrap();
        let peak = vocals_l
            .iter()
            .chain(vocals_r.iter())
            .map(|sample| sample.abs())
            .fold(0.0f32, f32::max);
        let (_, inst_l, inst_r) = wav::read_stereo(&stems.instrumental).unwrap();
        let inst_peak = inst_l
            .iter()
            .chain(inst_r.iter())
            .map(|sample| sample.abs())
            .fold(0.0f32, f32::max);
        assert!(peak.is_finite() && inst_peak.is_finite(), "non-finite stem");
        // The fixture is two sine tones, not a voice, so the vocal stem should stay quiet.
        assert!(inst_peak > peak * 20.0, "instrumental {inst_peak} vocals {peak}");

        let render_started = Instant::now();
        let job = RenderJob {
            video: video.clone(),
            vocals: stems.vocals.clone(),
            music,
            output: output.clone(),
            vocal_gain: 1.0,
            music_gain: 0.45,
            music_offset: 0.2,
            loop_music: true,
            fade_in: 0.15,
            fade_out: 0.3,
            duration: 0.0,
        };
        FfmpegRenderer.render(&job, &Quiet).expect("render");
        let duration = ffmpeg::probe_duration(&output).unwrap();
        let size = std::fs::metadata(&output).unwrap().len();
        eprintln!(
            "e2e separate {separate_ms}ms, render {}ms, output {} ({} bytes), duration {duration:.3}s, vocal peak {peak:.4}, vocals {}",
            render_started.elapsed().as_millis(),
            output.display(),
            size,
            stems.vocals.display()
        );
        eprintln!("e2e instrumental peak {inst_peak:.4}");
        assert!(size > 8_000);
        assert!((duration - 3.0).abs() < 0.25, "duration {duration}");
    }
}

fn hanning(len: usize) -> Vec<f32> {
    if len <= 1 {
        return vec![1.0; len];
    }
    (0..len)
        .map(|n| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * n as f32 / (len - 1) as f32).cos())
        .collect()
}
