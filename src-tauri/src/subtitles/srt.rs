//! SubRip (`.srt`) and WebVTT reading, and cue reflow for on-screen subtitles.

use super::whisper::Cue;

/// Parses SRT or WebVTT text. Cue numbers, VTT headers, styling tags and positioning are ignored.
pub fn parse(text: &str) -> Vec<Cue> {
    let text = text.trim_start_matches('\u{feff}').replace("\r\n", "\n").replace('\r', "\n");
    let mut cues = Vec::new();
    for block in text.split("\n\n") {
        let mut lines = block.lines().map(str::trim_end).filter(|l| !l.trim().is_empty()).peekable();
        let mut timing = None;
        while let Some(line) = lines.next() {
            if let Some(t) = parse_timing(line) {
                timing = Some(t);
                break;
            }
        }
        let Some((start, end)) = timing else { continue };
        let body: Vec<String> = lines.map(strip_tags).filter(|l| !l.is_empty()).collect();
        if body.is_empty() || end <= start {
            continue;
        }
        cues.push(Cue { start, end, text: body.join("\n") });
    }
    cues.sort_by(|a, b| a.start.total_cmp(&b.start));
    cues
}

fn parse_timing(line: &str) -> Option<(f64, f64)> {
    let (a, b) = line.split_once("-->")?;
    let b = b.trim().split_whitespace().next()?;
    Some((parse_stamp(a.trim())?, parse_stamp(b)?))
}

/// `HH:MM:SS,mmm`, `HH:MM:SS.mmm` or `MM:SS.mmm`.
fn parse_stamp(s: &str) -> Option<f64> {
    let s = s.replace(',', ".");
    let parts: Vec<&str> = s.split(':').collect();
    let (h, m, sec) = match parts.as_slice() {
        [h, m, s] => (h.parse::<f64>().ok()?, m.parse::<f64>().ok()?, s.parse::<f64>().ok()?),
        [m, s] => (0.0, m.parse::<f64>().ok()?, s.parse::<f64>().ok()?),
        _ => return None,
    };
    Some(h * 3600.0 + m * 60.0 + sec)
}

fn strip_tags(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut depth = 0;
    for c in line.chars() {
        match c {
            '<' | '{' => depth += 1,
            '>' | '}' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out.trim().to_string()
}

/// Splits long cues at word boundaries so each fits `max_chars`, sharing the cue's time in
/// proportion to the characters of each piece. Short cues pass through unchanged.
pub fn reflow(cues: &[Cue], max_chars: usize) -> Vec<Cue> {
    let max_chars = max_chars.max(8);
    let mut out = Vec::new();
    for cue in cues {
        let text = cue.text.split_whitespace().collect::<Vec<_>>().join(" ");
        if text.is_empty() {
            continue;
        }
        if text.chars().count() <= max_chars {
            out.push(Cue { start: cue.start, end: cue.end, text });
            continue;
        }
        let mut pieces: Vec<String> = Vec::new();
        let mut current = String::new();
        for word in text.split(' ') {
            let len = current.chars().count() + word.chars().count() + usize::from(!current.is_empty());
            if !current.is_empty() && len > max_chars {
                pieces.push(std::mem::take(&mut current));
            }
            if !current.is_empty() {
                current.push(' ');
            }
            current.push_str(word);
        }
        if !current.is_empty() {
            pieces.push(current);
        }
        // Balance the last two pieces so a cue never ends on a single orphan word.
        if pieces.len() >= 2 {
            let n = pieces.len();
            let joined = format!("{} {}", pieces[n - 2], pieces[n - 1]);
            let words: Vec<&str> = joined.split(' ').collect();
            let total = joined.chars().count();
            let mut best = (usize::MAX, 1);
            for cut in 1..words.len() {
                let left = words[..cut].join(" ").chars().count();
                let right = total - left - 1;
                if left <= max_chars && right <= max_chars {
                    best = best.min((left.abs_diff(right), cut));
                }
            }
            if best.0 != usize::MAX {
                pieces[n - 2] = words[..best.1].join(" ");
                pieces[n - 1] = words[best.1..].join(" ");
            }
        }
        let weights: Vec<f64> = pieces.iter().map(|p| p.chars().count() as f64 + 1.0).collect();
        let sum: f64 = weights.iter().sum();
        let span = (cue.end - cue.start).max(0.0);
        let mut t = cue.start;
        for (piece, w) in pieces.into_iter().zip(weights) {
            let end = (t + span * w / sum).min(cue.end);
            out.push(Cue { start: t, end, text: piece });
            t = end;
        }
    }
    out
}

/// Whisper's segment timestamps are coarse: the first one of a window is often 0.00 even when
/// speech starts seconds later. Pull each cue's start forward and its end back to where the
/// sound actually is (20 ms RMS frames over 16 kHz mono PCM), keeping a short lead and tail.
pub fn snap_to_speech(cues: &mut [Cue], pcm: &[f32]) {
    const RATE: f64 = 16_000.0;
    const FRAME: usize = 320;
    let rms: Vec<f32> = pcm.chunks(FRAME).map(|c| (c.iter().map(|x| x * x).sum::<f32>() / c.len() as f32).sqrt()).collect();
    if rms.is_empty() {
        return;
    }
    let mut sorted = rms.clone();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let floor = sorted[sorted.len() / 10];
    let loud = sorted[sorted.len() * 95 / 100];
    if loud <= 1e-4 {
        return;
    }
    let threshold = (floor * 3.0).max(loud * 0.08).max(1e-4);
    let frame_secs = FRAME as f64 / RATE;
    let at = |t: f64| ((t / frame_secs).floor().max(0.0) as usize).min(rms.len());
    for cue in cues.iter_mut() {
        let (a, b) = (at(cue.start), at(cue.end).max(at(cue.start)));
        let Some(first) = (a..b).find(|&i| rms[i] > threshold) else { continue };
        let last = (a..b).rev().find(|&i| rms[i] > threshold).unwrap_or(first);
        let start = (first as f64 * frame_secs - 0.08).max(cue.start);
        let end = ((last + 1) as f64 * frame_secs + 0.2).min(cue.end);
        if end - start >= 0.3 {
            cue.start = start;
            cue.end = end;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::subtitles::whisper::to_srt;

    #[test]
    fn snaps_cues_to_the_sound() {
        // 2 s silence, 1.5 s tone, 1.5 s silence.
        let mut pcm = vec![0.0f32; 32_000];
        pcm.extend((0..24_000).map(|i| (i as f32 * 0.05).sin() * 0.3));
        pcm.extend(vec![0.0f32; 24_000]);
        let mut cues = vec![Cue { start: 0.0, end: 5.0, text: "hi".into() }];
        snap_to_speech(&mut cues, &pcm);
        assert!((cues[0].start - 1.92).abs() < 0.05, "{:?}", cues[0]);
        assert!((cues[0].end - 3.7).abs() < 0.05, "{:?}", cues[0]);
        let mut quiet = vec![Cue { start: 0.0, end: 1.0, text: "x".into() }];
        snap_to_speech(&mut quiet, &vec![0.0; 16_000]);
        assert_eq!(quiet[0].start, 0.0);
    }

    #[test]
    fn srt_round_trips() {
        let cues = vec![
            Cue { start: 0.5, end: 2.25, text: "Merhaba dünya".into() },
            Cue { start: 3661.001, end: 3662.0, text: "two\nlines".into() },
        ];
        let back = parse(&to_srt(&cues));
        assert_eq!(back.len(), 2);
        assert!((back[0].start - 0.5).abs() < 1e-6 && (back[0].end - 2.25).abs() < 1e-6);
        assert_eq!(back[0].text, "Merhaba dünya");
        assert!((back[1].start - 3661.001).abs() < 1e-6);
        assert_eq!(back[1].text, "two\nlines");
    }

    #[test]
    fn reads_webvtt_with_tags_and_crlf() {
        let vtt = "\u{feff}WEBVTT\r\n\r\nintro\r\n00:01.000 --> 00:02.500 align:start\r\n<v Bob><i>Hi</i> there</v>\r\n\r\n00:00:03.000 --> 00:00:04.000\r\n{\\an8}Top\r\n";
        let cues = parse(vtt);
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].text, "Hi there");
        assert!((cues[0].start - 1.0).abs() < 1e-9 && (cues[0].end - 2.5).abs() < 1e-9);
        assert_eq!(cues[1].text, "Top");
    }

    #[test]
    fn reflow_splits_long_cues_in_order_and_keeps_the_span() {
        let cue = Cue { start: 10.0, end: 16.0, text: "And so my fellow Americans ask not what your country can do for you".into() };
        let out = reflow(&[cue], 32);
        assert!(out.len() >= 2);
        assert!(out.iter().all(|c| c.text.chars().count() <= 32), "{out:?}");
        assert!((out[0].start - 10.0).abs() < 1e-9);
        assert!((out.last().unwrap().end - 16.0).abs() < 1e-6);
        assert!(out.windows(2).all(|w| (w[0].end - w[1].start).abs() < 1e-9));
        let words: Vec<String> = out.iter().map(|c| c.text.clone()).collect();
        assert_eq!(words.join(" "), "And so my fellow Americans ask not what your country can do for you");
        assert!(out.last().unwrap().text.contains(' '), "no orphan word: {out:?}");
    }
}
