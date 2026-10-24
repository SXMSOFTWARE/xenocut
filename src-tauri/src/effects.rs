//! Per-clip video effects. Mirrors `src/project/effects.ts`: every constant here has a twin there,
//! so the live preview (CSS / SVG filters and transforms) matches the ffmpeg export.
//!
//! Effects run in a fixed order no matter how they are listed on the clip:
//! flips → (scale to fit) → colour → sharpen → RGB split → blur → vignette → grain → (pad to the
//! canvas) → zoom / shake. Colour, blur and friends work on the picture itself; zoom and shake move
//! the whole canvas-sized layer, exactly like the preview transforms the stage layer.

use crate::grade::{ops_chain, Op};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Effect {
    pub kind: String,
    #[serde(default = "one")]
    pub amount: f64,
}

fn one() -> f64 {
    1.0
}

pub const ZOOM_RANGE: f64 = 0.35;
pub const SHAKE_RANGE: f64 = 0.025;
pub const BLUR_SIGMA: f64 = 0.015;
pub const RGB_SPLIT: f64 = 0.01;
pub const VIGNETTE_ANGLE: f64 = 1.3;
pub const GRAIN_STRENGTH: f64 = 40.0;
pub const SHARPEN_AMOUNT: f64 = 2.0;
/// Beat hits play at the start of a clip (AMV cuts land on beats). Flash: white that fades
/// linearly from `amount` to nothing over `amount * FLASH_DECAY` seconds.
pub const FLASH_DECAY: f64 = 0.25;
/// Punch: a zoom kick of up to PUNCH_RANGE easing out over PUNCH_DECAY seconds.
pub const PUNCH_RANGE: f64 = 0.12;
pub const PUNCH_DECAY: f64 = 0.35;
/// Hit shake: shake of up to HIT_SHAKE_RANGE easing out over HIT_SHAKE_DECAY seconds.
pub const HIT_SHAKE_RANGE: f64 = 0.04;
pub const HIT_SHAKE_DECAY: f64 = 0.4;

/// Shake: two sines per axis as (weight, frequency in Hz, phase).
pub const SHAKE_X: [(f64, f64, f64); 2] = [(0.6, 7.3, 0.0), (0.4, 11.1, 1.3)];
pub const SHAKE_Y: [(f64, f64, f64); 2] = [(0.6, 8.7, 0.7), (0.4, 13.3, 2.1)];

fn amount(effects: &[Effect], kind: &str) -> f64 {
    effects.iter().filter(|e| e.kind == kind).map(|e| e.amount).last().unwrap_or(0.0)
}

fn has(effects: &[Effect], kind: &str) -> bool {
    effects.iter().any(|e| e.kind == kind)
}

/// Colour ops for the clip, in the order they are listed (the preview builds the same matrix).
pub fn color_ops(effects: &[Effect]) -> Vec<Op> {
    let mut ops = Vec::new();
    for e in effects {
        let a = e.amount;
        match e.kind.as_str() {
            "brightness" => ops.push(Op::Brightness(1.0 + 0.5 * a.clamp(-1.0, 1.0))),
            "contrast" => ops.push(Op::Contrast(1.0 + 0.6 * a.clamp(-1.0, 1.0))),
            "saturation" => ops.push(Op::Saturate(1.0 + a.clamp(-1.0, 1.0))),
            "temperature" => {
                let a = a.clamp(-1.0, 1.0);
                ops.push(Op::Tint(1.0 + 0.12 * a, 1.0, 1.0 - 0.12 * a))
            }
            "bw" => ops.push(Op::Grayscale(a.clamp(0.0, 1.0))),
            "sepia" => ops.push(Op::Sepia(a.clamp(0.0, 1.0))),
            "invert" => ops.push(Op::Invert(a.clamp(0.0, 1.0))),
            _ => {}
        }
    }
    ops
}

/// Filters applied to the source before it is scaled to fit the canvas.
pub fn pre_scale(effects: &[Effect]) -> Vec<String> {
    let mut out = Vec::new();
    if has(effects, "mirror") {
        out.push("hflip".to_string());
    }
    if has(effects, "flip") {
        out.push("vflip".to_string());
    }
    out
}

/// Filters on the fitted picture (before padding). `height` is the canvas height in pixels.
/// Ends in an alpha-capable format so the padding stays transparent.
pub fn picture(effects: &[Effect], height: u32) -> Vec<String> {
    let h = height as f64;
    let mut out = Vec::new();
    if let Some(chain) = ops_chain(&color_ops(effects), "rgba") {
        out.push(chain);
    }
    let sharpen = amount(effects, "sharpen").clamp(0.0, 1.0);
    if sharpen > 0.0 {
        out.push(format!("unsharp=lx=5:ly=5:la={:.3}:cx=5:cy=5:ca=0", sharpen * SHARPEN_AMOUNT));
    }
    let split = (amount(effects, "rgbSplit").clamp(0.0, 1.0) * RGB_SPLIT * h).round() as i64;
    if split > 0 {
        out.push(format!("format=rgba,rgbashift=rh=-{split}:bh={split}:edge=smear"));
    }
    let blur = amount(effects, "blur").clamp(0.0, 1.0) * BLUR_SIGMA * h;
    if blur >= 0.1 {
        out.push(format!("gblur=sigma={blur:.2}"));
    }
    let vignette = amount(effects, "vignette").clamp(0.0, 1.0) * VIGNETTE_ANGLE;
    if vignette > 0.0 {
        out.push(format!("vignette=angle={vignette:.4}"));
    }
    let grain = (amount(effects, "grain").clamp(0.0, 1.0) * GRAIN_STRENGTH).round() as i64;
    if grain > 0 {
        out.push(format!("format=yuv444p,noise=c0s={grain}:c0f=t+u"));
    }
    let flash = amount(effects, "flash").clamp(0.0, 1.0);
    if flash > 0.0 {
        // fade=in from white, started (1 - amount) of the way through: white = amount - t / FLASH_DECAY.
        // `fade` refuses a negative start, so shift the clock instead (microsecond timebase: exact).
        let k = (1.0 - flash) * FLASH_DECAY;
        out.push(format!("settb=AVTB,setpts=PTS+{k:.4}/TB,fade=t=in:st=0:d={FLASH_DECAY}:color=white,setpts=PTS-{k:.4}/TB"));
    }
    if !out.is_empty() {
        out.push("format=yuva420p".into());
    }
    out
}

/// Zoom / shake as one `perspective` filter on the canvas-sized layer, or `None`.
/// `length` is the clip's timeline duration, `fps` the export frame rate.
pub fn motion(effects: &[Effect], length: f64, fps: u32) -> Option<String> {
    let zin = amount(effects, "zoomIn").clamp(0.0, 1.0) * ZOOM_RANGE;
    let zout = amount(effects, "zoomOut").clamp(0.0, 1.0) * ZOOM_RANGE;
    let shake = amount(effects, "shake").clamp(0.0, 1.0) * SHAKE_RANGE;
    let punch = amount(effects, "punch").clamp(0.0, 1.0) * PUNCH_RANGE;
    let hit = amount(effects, "hitShake").clamp(0.0, 1.0) * HIT_SHAKE_RANGE;
    if zin <= 0.0 && zout <= 0.0 && shake <= 0.0 && punch <= 0.0 && hit <= 0.0 {
        return None;
    }
    let t = format!("(in/{fps})");
    let p = format!("clip({t}/{:.4},0,1)", length.max(1e-3));
    let mut z = String::from("1");
    if zin > 0.0 {
        z = format!("{z}*(1+{zin:.4}*{p})");
    }
    if zout > 0.0 {
        z = format!("{z}*(1+{zout:.4}*(1-{p}))");
    }
    let ease = |decay: f64| format!("pow(max(0,1-{t}/{decay}),2)");
    if punch > 0.0 {
        z = format!("{z}*(1+{punch:.4}*{})", ease(PUNCH_DECAY));
    }
    // Shake amplitude: the steady shake plus the hit that eases out.
    let amp = match (shake > 0.0, hit > 0.0) {
        (true, true) => format!("({shake:.4}+{hit:.4}*{})", ease(HIT_SHAKE_DECAY)),
        (true, false) => format!("{shake:.4}"),
        (false, true) => format!("{hit:.4}*{}", ease(HIT_SHAKE_DECAY)),
        _ => String::new(),
    };
    let wave = |parts: &[(f64, f64, f64); 2]| {
        let terms: Vec<String> = parts
            .iter()
            .map(|(w, f, ph)| format!("{w}*sin({:.5}*{t}+{ph})", 2.0 * std::f64::consts::PI * f))
            .collect();
        format!("{amp}*({})", terms.join("+"))
    };
    let (dx, dy) = if !amp.is_empty() {
        z = format!("{z}*(1+2.2*{amp})");
        (wave(&SHAKE_X), wave(&SHAKE_Y))
    } else {
        ("0".to_string(), "0".to_string())
    };
    let left = format!("(W/2+({dx})*W-W/(2*{z}))");
    let top = format!("(H/2+({dy})*H-H/(2*{z}))");
    let right = format!("({left}+W/({z}))");
    let bottom = format!("({top}+H/({z}))");
    Some(format!(
        "perspective=x0='{left}':y0='{top}':x1='{right}':y1='{top}':x2='{left}':y2='{bottom}':x3='{right}':y3='{bottom}':interpolation=linear:eval=frame"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fx(kind: &str, amount: f64) -> Effect {
        Effect { kind: kind.into(), amount }
    }

    #[test]
    fn nothing_means_no_filters() {
        assert!(pre_scale(&[]).is_empty());
        assert!(picture(&[], 1080).is_empty());
        assert!(motion(&[], 5.0, 30).is_none());
        assert!(picture(&[fx("bogus", 1.0)], 1080).is_empty());
    }

    #[test]
    fn picture_effects_in_fixed_order() {
        let list = [fx("grain", 0.5), fx("blur", 1.0), fx("bw", 1.0), fx("mirror", 1.0)];
        let chain = picture(&list, 1080).join(",");
        let color = chain.find("colorchannelmixer").unwrap();
        let blur = chain.find("gblur=sigma=16.20").unwrap();
        let grain = chain.find("noise=c0s=20").unwrap();
        assert!(color < blur && blur < grain);
        assert!(chain.ends_with("format=yuva420p"));
        assert_eq!(pre_scale(&list), vec!["hflip".to_string()]);
    }

    #[test]
    fn invert_is_one_minus() {
        let chain = picture(&[fx("invert", 1.0)], 720).join(",");
        assert!(chain.contains("clip(-1.00000*val+255.000,0,255)"), "{chain}");
    }

    #[test]
    fn zoom_and_shake_build_one_perspective() {
        let f = motion(&[fx("zoomIn", 1.0), fx("shake", 1.0)], 4.0, 30).unwrap();
        assert!(f.starts_with("perspective="));
        assert!(f.contains("clip((in/30)/4.0000,0,1)"));
        assert!(f.contains("(1+2.2*0.0250)")); // shake margin
        assert!(f.ends_with("eval=frame"));
    }

    #[test]
    fn beat_hits() {
        let f = motion(&[fx("punch", 1.0), fx("hitShake", 0.5)], 2.0, 30).unwrap();
        assert!(f.contains("(1+0.1200*pow(max(0,1-(in/30)/0.35),2))"), "{f}");
        assert!(f.contains("0.0200*pow(max(0,1-(in/30)/0.4),2)"), "{f}");
        let chain = picture(&[fx("flash", 0.6)], 720).join(",");
        assert!(chain.contains("setpts=PTS+0.1000/TB,fade=t=in:st=0:d=0.25:color=white,setpts=PTS-0.1000/TB"), "{chain}");
    }
}
