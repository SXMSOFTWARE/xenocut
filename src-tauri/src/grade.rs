//! Project colour grades. Mirrors `src/project/grade.ts`: every grade is a list of CSS filter
//! functions. The preview applies them as a CSS `filter`; here the same list is folded into one
//! affine colour transform (3x3 matrix + offset, as the Filter Effects spec defines each function)
//! and emitted as `colorchannelmixer` + `lutrgb`, so the export matches the preview.

#[derive(Clone, Copy)]
enum Op {
    Sepia(f64),
    Saturate(f64),
    Grayscale(f64),
    Brightness(f64),
    Contrast(f64),
    Tint(f64, f64, f64),
}

fn ops(grade: &str) -> &'static [Op] {
    use Op::*;
    match grade {
        "warm" => &[Sepia(0.22), Saturate(1.12), Brightness(1.03)],
        "cool" => &[Saturate(0.92), Tint(0.92, 1.0, 1.1), Contrast(1.04)],
        "mono" => &[Grayscale(1.0), Contrast(1.08)],
        "vivid" => &[Saturate(1.4), Contrast(1.06)],
        "fade" => &[Contrast(0.86), Brightness(1.06), Saturate(0.82)],
        "noir" => &[Grayscale(1.0), Contrast(1.38), Brightness(0.94)],
        _ => &[],
    }
}

type Mat = [[f64; 3]; 3];
#[derive(Clone, Copy, Debug)]
pub struct Affine {
    pub m: Mat,
    pub o: [f64; 3],
}

const ID: Mat = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];

fn affine(op: Op) -> Affine {
    let z = [0.0; 3];
    match op {
        Op::Grayscale(a) => {
            let a = 1.0 - a.clamp(0.0, 1.0);
            Affine {
                m: [
                    [0.2126 + 0.7874 * a, 0.7152 - 0.7152 * a, 0.0722 - 0.0722 * a],
                    [0.2126 - 0.2126 * a, 0.7152 + 0.2848 * a, 0.0722 - 0.0722 * a],
                    [0.2126 - 0.2126 * a, 0.7152 - 0.7152 * a, 0.0722 + 0.9278 * a],
                ],
                o: z,
            }
        }
        Op::Sepia(a) => {
            let a = 1.0 - a.clamp(0.0, 1.0);
            Affine {
                m: [
                    [0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a],
                    [0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a],
                    [0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a],
                ],
                o: z,
            }
        }
        Op::Saturate(s) => Affine {
            m: [
                [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
                [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
                [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
            ],
            o: z,
        },
        Op::Brightness(b) => Affine { m: [[b, 0.0, 0.0], [0.0, b, 0.0], [0.0, 0.0, b]], o: z },
        Op::Contrast(c) => Affine { m: [[c, 0.0, 0.0], [0.0, c, 0.0], [0.0, 0.0, c]], o: [0.5 - 0.5 * c; 3] },
        Op::Tint(r, g, b) => Affine { m: [[r, 0.0, 0.0], [0.0, g, 0.0], [0.0, 0.0, b]], o: z },
    }
}

/// `next ∘ prev`: apply `prev` first.
fn then(prev: Affine, next: Affine) -> Affine {
    let mut m = [[0.0; 3]; 3];
    let mut o = [0.0; 3];
    for r in 0..3 {
        for c in 0..3 {
            m[r][c] = (0..3).map(|k| next.m[r][k] * prev.m[k][c]).sum();
        }
        o[r] = (0..3).map(|k| next.m[r][k] * prev.o[k]).sum::<f64>() + next.o[r];
    }
    Affine { m, o }
}

pub fn transform(grade: &str) -> Option<Affine> {
    let list = ops(grade);
    if list.is_empty() {
        return None;
    }
    Some(list.iter().fold(Affine { m: ID, o: [0.0; 3] }, |acc, op| then(acc, affine(*op))))
}

/// ffmpeg filters (without labels) that apply `grade`, or `None` for no grade.
pub fn ffmpeg_chain(grade: &str) -> Option<String> {
    let t = transform(grade)?;
    let n = ["r", "g", "b"];
    let mut mix = Vec::new();
    for (r, row) in t.m.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            mix.push(format!("{}{}={:.5}", n[r], n[c], v));
        }
    }
    let mut chain = format!("format=rgb24,colorchannelmixer={}", mix.join(":"));
    if t.o.iter().any(|v| v.abs() > 1e-6) {
        let lut: Vec<String> = (0..3).map(|i| format!("{}='clip(val+{:.3},0,255)'", n[i], t.o[i] * 255.0)).collect();
        chain.push_str(&format!(",lutrgb={}", lut.join(":")));
    }
    Some(chain)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn none_is_empty_and_unknown_is_ignored() {
        assert!(ffmpeg_chain("none").is_none());
        assert!(ffmpeg_chain("bogus").is_none());
    }

    #[test]
    fn mono_rows_are_luma() {
        let t = transform("mono").unwrap();
        for row in t.m {
            assert!((row[0] / 1.08 - 0.2126).abs() < 1e-9);
            assert!((row[1] / 1.08 - 0.7152).abs() < 1e-9);
        }
        assert!((t.o[0] - (0.5 - 0.54)).abs() < 1e-9);
        let chain = ffmpeg_chain("mono").unwrap();
        assert!(chain.starts_with("format=rgb24,colorchannelmixer=rr=0.22961"));
        assert!(chain.contains("lutrgb=r='clip(val+-10.200,0,255)'"));
    }

    #[test]
    fn composition_order_matches_css() {
        // contrast then brightness: b*(c*x + o) = (b*c) x + b*o
        let t = transform("fade").unwrap();
        let expect_offset_before_sat = 1.06 * (0.5 - 0.43);
        // saturate rows sum to 1, so a grey offset stays grey
        for o in t.o {
            assert!((o - expect_offset_before_sat).abs() < 1e-9);
        }
    }
}
