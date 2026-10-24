use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use super::cancel;
use super::traits::{AudioError, ProgressSink};

/// UVR-MDX-NET-Voc_FT. Public weights from the UVR model repo.
/// Not bundled. Downloaded on first separation into the app data directory.
pub const MODEL_URL: &str = "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Voc_FT.onnx";
pub const MODEL_FILE: &str = "UVR-MDX-NET-Voc_FT.onnx";
pub const MODEL_SHA256: &str = "534b2070fcc7df514b13ef660dc8cbb328679c2374d04354a5c42bb14ecce111";

/// Parameters for hash `77d07b2667ddf05b9e3175941b4454a0` in UVR `model_data.json`
/// (MD5 of the last 10,000 × 1024 bytes). Primary stem is vocals.
pub struct MdxConfig {
    pub n_fft: usize,
    pub hop: usize,
    pub dim_f: usize,
    pub dim_t: usize,
    pub compensate: f32,
    pub overlap: f32,
    pub sample_rate: u32,
}

impl MdxConfig {
    pub fn voc_ft() -> Self {
        Self {
            n_fft: 7680,
            hop: 1024,
            dim_f: 3072,
            dim_t: 256,
            compensate: 1.021,
            overlap: 0.25,
            sample_rate: 44_100,
        }
    }
}

pub fn model_path(model_dir: &Path) -> PathBuf {
    model_dir.join(MODEL_FILE)
}

pub fn ensure_model(model_dir: &Path, progress: &dyn ProgressSink) -> Result<PathBuf, AudioError> {
    std::fs::create_dir_all(model_dir).map_err(|err| AudioError::Failed(err.to_string()))?;
    let path = model_path(model_dir);
    if path.is_file() && hash_matches(&path)? {
        progress.report(0.34, "Vocal model ready");
        return Ok(path);
    }
    if let Ok(from_env) = std::env::var("XENOCUT_MODEL") {
        let source = PathBuf::from(from_env);
        if source.is_file() && hash_matches(&source)? {
            std::fs::copy(&source, &path).map_err(|err| AudioError::Failed(err.to_string()))?;
            progress.report(0.34, "Vocal model ready");
            return Ok(path);
        }
    }
    download(&path, progress)?;
    if !hash_matches(&path)? {
        let _ = std::fs::remove_file(&path);
        return Err(AudioError::Failed(
            "The vocal model download did not match the expected checksum.".into(),
        ));
    }
    Ok(path)
}

fn download(path: &Path, progress: &dyn ProgressSink) -> Result<(), AudioError> {
    progress.report(0.08, "Downloading vocal model");
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(8))
        .user_agent("xenocut")
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|err| AudioError::Failed(err.to_string()))?;
    let mut response = client
        .get(MODEL_URL)
        .send()
        .map_err(|err| AudioError::Failed(format!("could not download the vocal model: {err}")))?;
    if !response.status().is_success() {
        return Err(AudioError::Failed(format!(
            "vocal model download returned {}",
            response.status()
        )));
    }
    let total = response.content_length().unwrap_or(0);
    let partial = path.with_extension("onnx.partial");
    let mut file = File::create(&partial).map_err(|err| AudioError::Failed(err.to_string()))?;
    let mut buffer = [0u8; 64 * 1024];
    let mut got = 0u64;
    loop {
        cancel::check()?;
        let read = response
            .read(&mut buffer)
            .map_err(|err| AudioError::Failed(err.to_string()))?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read])
            .map_err(|err| AudioError::Failed(err.to_string()))?;
        got += read as u64;
        if total > 0 {
            let fraction = 0.08 + 0.26 * (got as f32 / total as f32);
            progress.report(fraction, "Downloading vocal model");
        }
    }
    file.flush().ok();
    drop(file);
    std::fs::rename(&partial, path).map_err(|err| AudioError::Failed(err.to_string()))?;
    progress.report(0.34, "Vocal model downloaded");
    Ok(())
}

fn hash_matches(path: &Path) -> Result<bool, AudioError> {
    let mut file = File::open(path).map_err(|err| AudioError::Failed(err.to_string()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|err| AudioError::Failed(err.to_string()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let digest = hasher.finalize();
    let encoded = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(encoded == MODEL_SHA256)
}
