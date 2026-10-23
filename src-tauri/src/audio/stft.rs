use std::f32::consts::PI;

use rustfft::num_complex::Complex;
use rustfft::{Fft, FftPlanner};

type C = Complex<f32>;

pub struct Stft {
    n_fft: usize,
    hop: usize,
    dim_f: usize,
    window: Vec<f32>,
    fft: std::sync::Arc<dyn Fft<f32>>,
    ifft: std::sync::Arc<dyn Fft<f32>>,
}

impl Stft {
    pub fn new(n_fft: usize, hop: usize, dim_f: usize) -> Self {
        let mut planner = FftPlanner::<f32>::new();
        let window = (0..n_fft)
            .map(|n| 0.5 * (1.0 - (2.0 * PI * n as f32 / n_fft as f32).cos()))
            .collect();
        Self {
            n_fft,
            hop,
            dim_f,
            window,
            fft: planner.plan_fft_forward(n_fft),
            ifft: planner.plan_fft_inverse(n_fft),
        }
    }

    pub fn frame_count(&self, samples: usize) -> usize {
        let padded = samples + self.n_fft;
        if padded < self.n_fft {
            return 0;
        }
        1 + (padded - self.n_fft) / self.hop
    }

    /// Forward STFT cropped to `dim_f` bins. Each frame is `[bin]`.
    pub fn forward(&self, samples: &[f32]) -> Vec<Vec<C>> {
        let full = self.forward_bins(samples, self.n_fft / 2 + 1);
        full.into_iter()
            .map(|frame| {
                let mut cropped = frame;
                cropped.truncate(self.dim_f);
                cropped
            })
            .collect()
    }

    fn forward_bins(&self, samples: &[f32], bins: usize) -> Vec<Vec<C>> {
        let padded = reflect_pad(samples, self.n_fft / 2);
        let n_frames = self.frame_count(samples.len());
        let mut frames = Vec::with_capacity(n_frames);
        let mut buf = vec![C::new(0.0, 0.0); self.n_fft];
        for index in 0..n_frames {
            let start = index * self.hop;
            for (bin, sample) in buf.iter_mut().enumerate() {
                *sample = C::new(padded[start + bin] * self.window[bin], 0.0);
            }
            self.fft.process(&mut buf);
            frames.push(buf[..bins].to_vec());
        }
        frames
    }

    /// Inverse STFT. `frames` may be `dim_f` bins; missing high bins are silence.
    pub fn inverse(&self, frames: &[Vec<C>], output_len: usize) -> Vec<f32> {
        let n_bins = self.n_fft / 2 + 1;
        let n_frames = frames.len().max(1);
        let padded_len = self.n_fft + self.hop * (n_frames - 1);
        let mut acc = vec![0.0f32; padded_len];
        let mut weight = vec![0.0f32; padded_len];
        let mut buf = vec![C::new(0.0, 0.0); self.n_fft];
        let scale = 1.0 / self.n_fft as f32;

        for (index, frame) in frames.iter().enumerate() {
            buf.fill(C::new(0.0, 0.0));
            let copy = frame.len().min(n_bins);
            buf[..copy].copy_from_slice(&frame[..copy]);
            buf[n_bins - 1] = C::new(buf[n_bins - 1].re, 0.0);
            for bin in 1..n_bins - 1 {
                buf[self.n_fft - bin] = buf[bin].conj();
            }
            self.ifft.process(&mut buf);
            let start = index * self.hop;
            for (offset, value) in buf.iter().enumerate() {
                let window = self.window[offset];
                acc[start + offset] += value.re * scale * window;
                weight[start + offset] += window * window;
            }
        }

        for (sample, window) in acc.iter_mut().zip(weight.iter()) {
            if *window > 1e-8 {
                *sample /= *window;
            }
        }

        let trim = self.n_fft / 2;
        let mut out = vec![0.0; output_len];
        if trim < acc.len() {
            let available = (acc.len() - trim).min(output_len);
            out[..available].copy_from_slice(&acc[trim..trim + available]);
        }
        out
    }
}

/// Reflect pad that does not repeat the edge sample. Matches `torch.nn.functional.pad(..., mode="reflect")`.
pub fn reflect_pad(input: &[f32], pad: usize) -> Vec<f32> {
    if input.is_empty() {
        return vec![0.0; pad * 2];
    }
    if input.len() == 1 {
        return vec![input[0]; input.len() + pad * 2];
    }
    let mut out = vec![0.0; input.len() + pad * 2];
    for (index, sample) in out.iter_mut().enumerate() {
        *sample = reflect_at(input, index as isize - pad as isize);
    }
    out
}

fn reflect_at(input: &[f32], index: isize) -> f32 {
    let n = input.len() as isize;
    let period = 2 * (n - 1);
    let mut mapped = index.rem_euclid(period);
    if mapped >= n {
        mapped = period - mapped;
    }
    input[mapped as usize]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reflect_pad_matches_the_torch_example() {
        let padded = reflect_pad(&[1.0, 2.0, 3.0, 4.0], 2);
        assert_eq!(padded, vec![3.0, 2.0, 1.0, 2.0, 3.0, 4.0, 3.0, 2.0]);
    }

    #[test]
    fn voc_ft_chunk_has_dim_t_frames() {
        let stft = Stft::new(7680, 1024, 3072);
        assert_eq!(stft.frame_count(261_120), 256);
    }

    #[test]
    fn stft_roundtrip_keeps_a_sine() {
        let stft = Stft::new(64, 16, 33);
        let samples: Vec<f32> = (0..160)
            .map(|n| (2.0 * PI * 4.0 * n as f32 / 64.0).sin() * 0.5)
            .collect();
        let frames = stft.forward_bins(&samples, 33);
        let back = stft.inverse(&frames, samples.len());
        let error = samples
            .iter()
            .zip(back.iter())
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        assert!(error < 0.02, "max error {error}");
    }
}
