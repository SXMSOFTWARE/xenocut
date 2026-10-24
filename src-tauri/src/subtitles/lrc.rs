//! LRC lyrics: `[mm:ss.xx] line` files, including several stamps per line, `[offset:±ms]`,
//! metadata tags and enhanced `<mm:ss.xx>` word stamps (stripped; lines are timed as a whole).

use super::whisper::Cue;

/// The longest a line stays on screen when the next stamp is far away (instrumental breaks).
const MAX_LINE: f64 = 8.0;
/// Shown for this long after its start when a line is the last one.
const LAST_LINE: f64 = 4.0;

/// True when the text looks like LRC (at least one `[mm:ss` time stamp starting a line).
pub fn looks_like_lrc(text: &str) -> bool {
    text.lines().any(|l| {
        let l = l.trim_start_matches('\u{feff}').trim();
        l.starts_with('[')
            && l[1..]
                .split(']')
                .next()
                .is_some_and(|s| parse_stamp(s).is_some())
    })
}

pub fn parse(text: &str) -> Vec<Cue> {
    let mut offset = 0.0;
    // (start, text); empty text marks the end of the previous line.
    let mut stamped: Vec<(f64, String)> = Vec::new();
    for raw in text.trim_start_matches('\u{feff}').lines() {
        let mut rest = raw.trim();
        let mut stamps = Vec::new();
        while let Some(inner) = rest.strip_prefix('[') {
            let Some(close) = inner.find(']') else { break };
            let tag = &inner[..close];
            if let Some(t) = parse_stamp(tag) {
                stamps.push(t);
            } else if let Some(v) = tag.strip_prefix("offset:") {
                // Positive offsets make lyrics appear sooner (LRC convention).
                offset = v.trim().parse::<f64>().unwrap_or(0.0) / 1000.0;
            }
            rest = inner[close + 1..].trim_start();
        }
        if stamps.is_empty() {
            continue;
        }
        let line = strip_word_stamps(rest);
        for t in stamps {
            stamped.push((t, line.clone()));
        }
    }
    stamped.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut cues = Vec::new();
    for (i, (start, line)) in stamped.iter().enumerate() {
        if line.is_empty() {
            continue;
        }
        let start = (start - offset).max(0.0);
        let next = stamped.get(i + 1).map(|(t, _)| (t - offset).max(0.0));
        let end = match next {
            Some(n) => n.min(start + MAX_LINE),
            None => start + LAST_LINE,
        };
        if end > start {
            cues.push(Cue {
                start,
                end,
                text: line.clone(),
            });
        }
    }
    cues
}

/// LRC text for `cues`; a blank stamp closes a line when a gap follows it.
pub fn write(cues: &[Cue]) -> String {
    let mut out = String::from("[re:XenoCut]\n");
    for (i, cue) in cues.iter().enumerate() {
        out.push_str(&format!(
            "[{}]{}\n",
            stamp(cue.start),
            cue.text.split_whitespace().collect::<Vec<_>>().join(" ")
        ));
        let gap = cues.get(i + 1).map_or(f64::INFINITY, |n| n.start - cue.end);
        if gap > 0.05 {
            out.push_str(&format!("[{}]\n", stamp(cue.end)));
        }
    }
    out
}

fn stamp(t: f64) -> String {
    let cs = (t.max(0.0) * 100.0).round() as u64;
    format!("{:02}:{:02}.{:02}", cs / 6000, cs / 100 % 60, cs % 100)
}

/// `mm:ss`, `mm:ss.xx`, `mm:ss.xxx` or `mm:ss:xx`.
fn parse_stamp(s: &str) -> Option<f64> {
    let (m, rest) = s.split_once(':')?;
    let m: u32 = m.trim().parse().ok()?;
    let (sec, frac) = match rest.split_once(['.', ':']) {
        Some((a, b)) => (a, Some(b)),
        None => (rest, None),
    };
    if sec.len() != 2 || !sec.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let sec: f64 = sec.parse().ok()?;
    let frac = match frac {
        Some(f) if !f.is_empty() && f.bytes().all(|b| b.is_ascii_digit()) => {
            f.parse::<f64>().ok()? / 10f64.powi(f.len() as i32)
        }
        Some(_) => return None,
        None => 0.0,
    };
    Some(m as f64 * 60.0 + sec + frac)
}

fn strip_word_stamps(line: &str) -> String {
    let mut out = String::new();
    let mut rest = line;
    while let Some(open) = rest.find('<') {
        let Some(close) = rest[open..].find('>') else {
            break;
        };
        if parse_stamp(&rest[open + 1..open + close]).is_none() {
            out.push_str(&rest[..open + close + 1]);
        } else {
            out.push_str(&rest[..open]);
        }
        rest = &rest[open + close + 1..];
    }
    out.push_str(rest);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_lines_tags_and_repeats() {
        let text = "\u{feff}[ti:Song]\n[ar:Someone]\n[00:01.50]First line\n[00:04.00][00:20.00]Chorus <00:04.50>word\n[00:07.25]\n[00:10.000]Third\n";
        let cues = parse(text);
        let got: Vec<_> = cues
            .iter()
            .map(|c| (c.start, c.end, c.text.as_str()))
            .collect();
        assert_eq!(
            got,
            vec![
                (1.5, 4.0, "First line"),
                (4.0, 7.25, "Chorus word"),
                (10.0, 18.0, "Third"),
                (20.0, 24.0, "Chorus word")
            ]
        );
        assert!(looks_like_lrc(text));
        assert!(!looks_like_lrc("1\n00:00:01,000 --> 00:00:02,000\nhi\n"));
    }

    #[test]
    fn applies_offset() {
        let cues = parse("[offset:+500]\n[00:02.00]a\n[00:03.00]b\n");
        assert_eq!((cues[0].start, cues[0].end, cues[1].start), (1.5, 2.5, 2.5));
    }

    #[test]
    fn round_trips() {
        let cues = vec![
            Cue {
                start: 1.0,
                end: 3.0,
                text: "one".into(),
            },
            Cue {
                start: 3.0,
                end: 5.5,
                text: "two  words".into(),
            },
            Cue {
                start: 65.25,
                end: 68.0,
                text: "three".into(),
            },
        ];
        let text = write(&cues);
        assert!(text.contains("[01:05.25]three"));
        let back = parse(&text);
        let got: Vec<_> = back
            .iter()
            .map(|c| (c.start, c.end, c.text.as_str()))
            .collect();
        assert_eq!(
            got,
            vec![
                (1.0, 3.0, "one"),
                (3.0, 5.5, "two words"),
                (65.25, 68.0, "three")
            ]
        );
    }
}
