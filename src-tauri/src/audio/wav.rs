use std::path::Path;

use hound::{SampleFormat, WavReader, WavSpec, WavWriter};

use super::traits::AudioError;

pub fn read_stereo(path: &Path) -> Result<(u32, Vec<f32>, Vec<f32>), AudioError> {
    let mut reader = WavReader::open(path)
        .map_err(|err| AudioError::Failed(format!("could not read wav: {err}")))?;
    let spec = reader.spec();
    if spec.channels == 0 {
        return Err(AudioError::Failed("wav has no channels".into()));
    }
    let interleaved = match spec.sample_format {
        SampleFormat::Float => reader
            .samples::<f32>()
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| AudioError::Failed(err.to_string()))?,
        SampleFormat::Int => {
            let scale = (1i64 << (spec.bits_per_sample.saturating_sub(1))) as f32;
            reader
                .samples::<i32>()
                .map(|sample| sample.map(|value| value as f32 / scale))
                .collect::<Result<Vec<_>, _>>()
                .map_err(|err| AudioError::Failed(err.to_string()))?
        }
    };
    let channels = spec.channels as usize;
    let mut left = Vec::with_capacity(interleaved.len() / channels);
    let mut right = Vec::with_capacity(interleaved.len() / channels);
    for frame in interleaved.chunks(channels) {
        left.push(frame[0]);
        right.push(*frame.get(1).unwrap_or(&frame[0]));
    }
    Ok((spec.sample_rate, left, right))
}

pub fn write_stereo(path: &Path, rate: u32, left: &[f32], right: &[f32]) -> Result<(), AudioError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| AudioError::Failed(err.to_string()))?;
    }
    let spec = WavSpec {
        channels: 2,
        sample_rate: rate,
        bits_per_sample: 32,
        sample_format: SampleFormat::Float,
    };
    let mut writer =
        WavWriter::create(path, spec).map_err(|err| AudioError::Failed(err.to_string()))?;
    let length = left.len().min(right.len());
    for index in 0..length {
        writer
            .write_sample(left[index])
            .map_err(|err| AudioError::Failed(err.to_string()))?;
        writer
            .write_sample(right[index])
            .map_err(|err| AudioError::Failed(err.to_string()))?;
    }
    writer
        .finalize()
        .map_err(|err| AudioError::Failed(err.to_string()))
}
