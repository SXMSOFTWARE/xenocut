/// One read window inside a padded mixture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Chunk {
    pub start: usize,
    pub end: usize,
    /// Samples of zero padding appended so the window is `chunk_size` long.
    pub pad: usize,
}

/// MDX window sizes. `segment` is `dim_t` (256 for Voc_FT).
pub fn mdx_sizes(hop: usize, segment: usize, n_fft: usize) -> (usize, usize, usize) {
    let chunk_size = hop.saturating_mul(segment.saturating_sub(1));
    let trim = n_fft / 2;
    let gen_size = chunk_size.saturating_sub(trim.saturating_mul(2));
    (chunk_size, trim, gen_size)
}

/// Tail padding used by the UVR MDX demix loop.
///
/// `pad = gen_size + trim - (n_sample % gen_size)`. A remainder of zero still
/// adds a full `gen_size`, which matches the reference implementation.
pub fn mdx_tail_pad(n_sample: usize, gen_size: usize, trim: usize) -> usize {
    if gen_size == 0 {
        return trim;
    }
    gen_size + trim - (n_sample % gen_size)
}

pub fn chunk_step(chunk_size: usize, overlap: f32) -> usize {
    if chunk_size == 0 {
        return 1;
    }
    let overlap = overlap.clamp(0.0, 1.0);
    let step = ((1.0 - overlap) * chunk_size as f32).round() as usize;
    step.clamp(1, chunk_size)
}

/// Overlapping windows that cover `total` samples. The last window is shorter
/// and reports how much zero padding the model input needs.
pub fn plan_overlapped_chunks(total: usize, chunk_size: usize, overlap: f32) -> Vec<Chunk> {
    if total == 0 || chunk_size == 0 {
        return Vec::new();
    }
    let step = chunk_step(chunk_size, overlap);
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < total {
        let end = (start + chunk_size).min(total);
        chunks.push(Chunk {
            start,
            end,
            pad: chunk_size - (end - start),
        });
        if end == total {
            break;
        }
        start += step;
    }
    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voc_ft_window_is_one_model_frame_short_of_the_fft_grid() {
        let (chunk, trim, generated) = mdx_sizes(1024, 256, 7680);
        assert_eq!(chunk, 261_120);
        assert_eq!(trim, 3_840);
        assert_eq!(generated, 253_440);
        assert_eq!(chunk - 2 * trim, generated);
    }

    #[test]
    fn tail_pad_fills_to_a_generation_boundary() {
        let (_, trim, generated) = mdx_sizes(1024, 256, 7680);
        let n = 220_500;
        let pad = mdx_tail_pad(n, generated, trim);
        let mixture = trim + n + pad;
        assert_eq!(pad, generated + trim - (n % generated));
        assert_eq!(mixture % generated, (2 * trim) % generated);
        assert!(mixture >= n);
    }

    #[test]
    fn exact_multiple_still_adds_a_generation_of_padding() {
        let pad = mdx_tail_pad(200, 100, 10);
        assert_eq!(pad, 110);
    }

    #[test]
    fn chunks_cover_the_signal_and_overlap() {
        let chunks = plan_overlapped_chunks(1_000, 400, 0.0);
        assert_eq!(
            chunks,
            vec![
                Chunk { start: 0, end: 400, pad: 0 },
                Chunk { start: 400, end: 800, pad: 0 },
                Chunk { start: 800, end: 1_000, pad: 200 },
            ]
        );

        let overlapped = plan_overlapped_chunks(1_000, 400, 0.5);
        assert_eq!(overlapped[0].start, 0);
        assert_eq!(overlapped[1].start, 200);
        assert_eq!(overlapped.last().unwrap().end, 1_000);
        assert!(overlapped.len() > chunks.len());
    }

    #[test]
    fn step_stays_inside_the_chunk() {
        assert_eq!(chunk_step(400, 0.0), 400);
        assert_eq!(chunk_step(400, 0.25), 300);
        assert_eq!(chunk_step(400, 0.99), 4);
        assert_eq!(chunk_step(400, 0.999), 1);
        assert_eq!(chunk_step(0, 0.25), 1);
    }
}
