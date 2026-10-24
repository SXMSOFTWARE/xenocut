//! Video effects for clips and effect layers. Mirrors `src/project/effects.ts`: every constant here
//! has a twin there, so the live preview (CSS / SVG filters, overlays and transforms) matches the
//! ffmpeg export.
//!
//! Each effect may cover only part of its clip (`from` / `to`, seconds from the clip start,
//! half-open). Packs (`src/project/fx-packs.json`) expand into primitives sharing the range. At any
//! moment colour adjustments, flashes and dips stack; every other kind is "last active wins". Each
//! instance becomes its own filter gated with `enable=`, so the export follows the ranges exactly.
//!
//! Order is fixed no matter how effects are listed: flips → (scale to fit) → colour → sharpen →
//! RGB split → blur → vignette → grain → scanlines → flash → dip to black → letterbox → (pad to the
//! canvas) → zoom / shake. Effect layers run the same chain on the composited canvas.

use crate::grade::{ops_chain, Op};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Effect {
    pub kind: String,
    #[serde(default = "one")]
    pub amount: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<f64>,
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
/// Flash: white that fades linearly from `amount` to nothing over `amount * FLASH_DECAY` seconds,
/// starting at the beginning of its range (AMV cuts land on beats).
pub const FLASH_DECAY: f64 = 0.25;
/// Punch: a zoom kick of up to PUNCH_RANGE easing out over PUNCH_DECAY seconds.
pub const PUNCH_RANGE: f64 = 0.12;
pub const PUNCH_DECAY: f64 = 0.35;
/// Hit shake: shake of up to HIT_SHAKE_RANGE easing out over HIT_SHAKE_DECAY seconds.
pub const HIT_SHAKE_RANGE: f64 = 0.04;
pub const HIT_SHAKE_DECAY: f64 = 0.4;
/// Letterbox: each bar covers up to this fraction of the picture height.
pub const LETTERBOX: f64 = 0.12;
/// Scanlines: a dark line every canvas height / SCANLINE_ROWS px, half as thick.
pub const SCANLINE_ROWS: f64 = 180.0;
pub const SCANLINE_ALPHA: f64 = 0.5;

/// Shake: two sines per axis as (weight, frequency in Hz, phase).
pub const SHAKE_X: [(f64, f64, f64); 2] = [(0.6, 7.3, 0.0), (0.4, 11.1, 1.3)];
pub const SHAKE_Y: [(f64, f64, f64); 2] = [(0.6, 8.7, 0.7), (0.4, 13.3, 2.1)];

const PRIMITIVES: [&str; 24] = [
    "brightness", "contrast", "saturation", "temperature", "bw", "sepia", "invert", "sharpen", "blur", "rgbSplit", "vignette",
    "grain", "scanlines", "letterbox", "mirror", "flip", "zoomIn", "zoomOut", "shake", "flash", "punch", "hitShake", "fadeIn",
    "fadeOut",
];
const COLOR: [&str; 7] = ["brightness", "contrast", "saturation", "temperature", "bw", "sepia", "invert"];
/// Kinds that add up while active instead of the last one winning.
const STACKING: [&str; 10] = ["brightness", "contrast", "saturation", "temperature", "bw", "sepia", "invert", "flash", "fadeIn", "fadeOut"];

fn packs() -> &'static HashMap<String, Vec<(String, f64)>> {
    static PACKS: OnceLock<HashMap<String, Vec<(String, f64)>>> = OnceLock::new();
    PACKS.get_or_init(|| {
        let raw: HashMap<String, serde_json::Value> =
            serde_json::from_str(include_str!("../../src/project/fx-packs.json")).expect("fx-packs.json");
        raw.into_iter()
            .filter(|(k, _)| !k.starts_with('_'))
            .map(|(k, v)| {
                let list: Vec<(String, f64)> = serde_json::from_value(v).expect("fx pack entry");
                (k, list)
            })
            .collect()
    })
}

/// One primitive effect over [a, b) seconds of local time.
#[derive(Debug, Clone, PartialEq)]
pub struct Inst {
    pub kind: String,
    pub amount: f64,
    pub a: f64,
    pub b: f64,
}

/// Packs expanded and ranges resolved against a clip / layer `length` seconds long.
pub fn expand(effects: &[Effect], length: f64) -> Vec<Inst> {
    let mut out = Vec::new();
    for e in effects {
        let a = e.from.unwrap_or(0.0).clamp(0.0, length);
        let b = e.to.map_or(length, |to| to.clamp(a, length));
        if b <= a {
            continue;
        }
        if let Some(list) = packs().get(&e.kind) {
            for (kind, base) in list {
                out.push(Inst { kind: kind.clone(), amount: base * e.amount, a, b });
            }
        } else if PRIMITIVES.contains(&e.kind.as_str()) {
            out.push(Inst { kind: e.kind.clone(), amount: e.amount, a, b });
        }
    }
    out
}

fn n(v: f64) -> String {
    format!("{v:.4}")
}

/// When instance `i` shows, as an expression in `t` (stream time = local time + `offset`).
/// `whole`: the stream is exactly the clip (a clip chain), not a longer canvas (an effect layer).
/// `Gate::Always` needs no `enable`, `Gate::Never` is hidden by later instances for good.
enum Gate {
    Always,
    Never,
    When(String),
}

fn gate(list: &[Inst], i: usize, t: &str, offset: f64, length: f64, whole: bool) -> Gate {
    let e = &list[i];
    let span = |x: &Inst| format!("gte({t},{})*lt({t},{})", n(x.a + offset), n(x.b + offset));
    let mut parts: Vec<String> = Vec::new();
    if !whole || e.a > 1e-9 || e.b < length - 1e-9 {
        parts.push(span(e));
    }
    if !STACKING.contains(&e.kind.as_str()) {
        for later in &list[i + 1..] {
            if later.kind != e.kind || later.b <= e.a || later.a >= e.b {
                continue;
            }
            if later.a <= e.a && later.b >= e.b {
                return Gate::Never;
            }
            parts.push(format!("(1-{})", span(later)));
        }
    }
    if parts.is_empty() {
        Gate::Always
    } else {
        Gate::When(parts.join("*"))
    }
}

/// `filter` with its `enable` gate, or `None` when the instance never shows.
fn gated(filter: String, g: &Gate) -> Option<String> {
    match g {
        Gate::Always => Some(filter),
        Gate::Never => None,
        Gate::When(expr) => Some(format!("{filter}:enable='{expr}'")),
    }
}

fn color_op(e: &Inst) -> Option<Op> {
    let a = e.amount;
    Some(match e.kind.as_str() {
        "brightness" => Op::Brightness(1.0 + 0.5 * a.clamp(-1.0, 1.0)),
        "contrast" => Op::Contrast(1.0 + 0.6 * a.clamp(-1.0, 1.0)),
        "saturation" => Op::Saturate(1.0 + a.clamp(-1.0, 1.0)),
        "temperature" => {
            let a = a.clamp(-1.0, 1.0);
            Op::Tint(1.0 + 0.12 * a, 1.0, 1.0 - 0.12 * a)
        }
        "bw" => Op::Grayscale(a.clamp(0.0, 1.0)),
        "sepia" => Op::Sepia(a.clamp(0.0, 1.0)),
        "invert" => Op::Invert(a.clamp(0.0, 1.0)),
        _ => return None,
    })
}

/// Scanline period and thickness in canvas px for a canvas `height` px tall.
pub fn scanline_geometry(height: u32) -> (u32, u32) {
    let period = ((height as f64 / SCANLINE_ROWS).round() as u32).max(2);
    (period, ((period as f64 / 2.0).round() as u32).max(1))
}

/// Flips, applied before the picture is scaled. `layer`: the effect layer's start on the
/// timeline (its chain runs on the whole canvas), `None` for a clip's own chain.
pub fn pre_scale(effects: &[Effect], length: f64, layer: Option<f64>) -> Vec<String> {
    let list = expand(effects, length);
    let (offset, whole) = (layer.unwrap_or(0.0), layer.is_none());
    let mut out = Vec::new();
    for (kind, filter) in [("mirror", "hflip"), ("flip", "vflip")] {
        for (i, e) in list.iter().enumerate() {
            if e.kind == kind {
                out.extend(gated(filter.to_string(), &gate(&list, i, "t", offset, length, whole)));
            }
        }
    }
    out
}

/// Filters on the picture (the fitted clip before padding, or a layer's whole canvas). `height` is
/// the canvas height in pixels, `length` the clip / layer duration, `layer` as for [`pre_scale`].
/// Ends in an alpha-capable format so padding stays transparent.
pub fn picture(effects: &[Effect], height: u32, length: f64, layer: Option<f64>) -> Vec<String> {
    let list = expand(effects, length);
    let (offset, whole) = (layer.unwrap_or(0.0), layer.is_none());
    let h = height as f64;
    let mut out: Vec<String> = Vec::new();
    let each = |kind: &'static str| list.iter().enumerate().filter(move |(_, e)| e.kind == kind);
    let g = |i: usize| gate(&list, i, "t", offset, length, whole);

    let mut rgba = false;
    for (i, e) in list.iter().enumerate() {
        if !COLOR.contains(&e.kind.as_str()) {
            continue;
        }
        let Some(op) = color_op(e) else { continue };
        let Some(chain) = ops_chain(&[op], "rgba") else { continue };
        let filter = chain.split_once(',').map(|(_, f)| f.to_string()).unwrap_or(chain);
        if !rgba {
            out.push("format=rgba".into());
            rgba = true;
        }
        out.extend(gated(filter, &g(i)));
    }
    for (i, e) in each("sharpen") {
        let a = e.amount.clamp(0.0, 1.0);
        if a > 0.0 {
            out.extend(gated(format!("unsharp=lx=5:ly=5:la={:.3}:cx=5:cy=5:ca=0", a * SHARPEN_AMOUNT), &g(i)));
        }
    }
    for (i, e) in each("rgbSplit") {
        let split = (e.amount.clamp(0.0, 1.0) * RGB_SPLIT * h).round() as i64;
        if split > 0 {
            out.push("format=rgba".into());
            out.extend(gated(format!("rgbashift=rh=-{split}:bh={split}:edge=smear"), &g(i)));
        }
    }
    for (i, e) in each("blur") {
        let blur = e.amount.clamp(0.0, 1.0) * BLUR_SIGMA * h;
        if blur >= 0.1 {
            out.extend(gated(format!("gblur=sigma={blur:.2}"), &g(i)));
        }
    }
    for (i, e) in each("vignette") {
        let v = e.amount.clamp(0.0, 1.0) * VIGNETTE_ANGLE;
        if v > 0.0 {
            out.extend(gated(format!("vignette=angle={v:.4}"), &g(i)));
        }
    }
    for (i, e) in each("grain") {
        let grain = (e.amount.clamp(0.0, 1.0) * GRAIN_STRENGTH).round() as i64;
        if grain > 0 {
            out.push("format=yuv444p".into());
            out.extend(gated(format!("noise=c0s={grain}:c0f=t+u"), &g(i)));
        }
    }
    let (period, thick) = scanline_geometry(height);
    for (i, e) in each("scanlines") {
        let alpha = e.amount.clamp(0.0, 1.0) * SCANLINE_ALPHA;
        if alpha > 0.0 {
            // Cells one line wider than the picture: only the horizontal lines land inside it.
            out.push("format=yuva420p".into());
            out.extend(gated(
                format!("drawgrid=x=iw:y=0:w=iw+{thick}:h={period}:t={thick}:color=black@{alpha:.3}"),
                &g(i),
            ));
        }
    }
    for (i, e) in each("flash") {
        let amount = e.amount.clamp(0.0, 1.0);
        if amount <= 0.0 {
            continue;
        }
        // fade=in from white: white = 1 - (t - st) / D, so st = a - (1 - amount) * D gives
        // amount - (t - a) / D. `fade` refuses a negative start: then shift the clock instead
        // (microsecond timebase: exact) and gate in the shifted time.
        let st = e.a + offset - (1.0 - amount) * FLASH_DECAY;
        let shift = (-st).max(0.0);
        let shown = |s: f64| gate(&list, i, "t", offset + s, length, whole);
        let fade = format!("fade=t=in:st={}:d={FLASH_DECAY}:color=white", n(st + shift));
        if shift > 0.0 {
            out.push(format!("settb=AVTB,setpts=PTS+{}/TB", n(shift)));
            out.extend(gated(fade, &shown(shift)));
            out.push(format!("setpts=PTS-{}/TB", n(shift)));
        } else {
            out.extend(gated(fade, &shown(0.0)));
        }
    }
    for (i, e) in list.iter().enumerate() {
        let way = match e.kind.as_str() {
            "fadeIn" => "in",
            "fadeOut" => "out",
            _ => continue,
        };
        // A fade-out leaves black after its end: always gate it unless it runs to the end.
        let filter = format!("fade=t={way}:st={}:d={}:color=black", n(e.a + offset), n(e.b - e.a));
        out.extend(gated(filter, &g(i)));
    }
    for (i, e) in each("letterbox") {
        let f = e.amount.clamp(0.0, 1.0) * LETTERBOX;
        if f > 0.0 {
            let gate = g(i);
            out.push("format=yuva420p".into());
            out.extend(gated(format!("drawbox=x=0:y=0:w=iw:h=ih*{f:.4}:color=black:t=fill"), &gate));
            out.extend(gated(format!("drawbox=x=0:y=ih-ih*{f:.4}:w=iw:h=ih*{f:.4}:color=black:t=fill"), &gate));
        }
    }
    if !out.is_empty() {
        out.push("format=yuva420p".into());
    }
    out
}

/// Zoom / shake as one `perspective` filter on a canvas-sized layer, or `None`. `length` is the clip
/// / layer duration, `fps` the export frame rate, `layer` as for [`pre_scale`].
pub fn motion(effects: &[Effect], length: f64, fps: u32, layer: Option<f64>) -> Option<String> {
    let list = expand(effects, length);
    let (offset, whole) = (layer.unwrap_or(0.0), layer.is_none());
    let t = if offset.abs() < 1e-9 { format!("(in/{fps})") } else { format!("(in/{fps}-{})", n(offset)) };
    let kinds = ["zoomIn", "zoomOut", "shake", "punch", "hitShake"];
    if !list.iter().any(|e| kinds.contains(&e.kind.as_str()) && e.amount > 0.0) {
        return None;
    }
    // Σ weight × term over the instances of a kind (at most one weight is 1 at any time).
    let sum = |kind: &str, term: &dyn Fn(&Inst) -> String| -> Option<String> {
        let mut parts = Vec::new();
        for (i, e) in list.iter().enumerate() {
            if e.kind != kind || e.amount <= 0.0 {
                continue;
            }
            match gate(&list, i, &t, 0.0, length, whole) {
                Gate::Never => {}
                Gate::Always => parts.push(term(e)),
                Gate::When(w) => parts.push(format!("{w}*{}", term(e))),
            }
        }
        (!parts.is_empty()).then(|| parts.join("+"))
    };
    let prog = |e: &Inst| format!("clip(({t}-{})/{},0,1)", n(e.a), n((e.b - e.a).max(1e-3)));
    let ease = |e: &Inst, decay: f64| format!("pow(max(0,1-({t}-{})/{decay}),2)", n(e.a));
    let mut z = String::from("1");
    if let Some(s) = sum("zoomIn", &|e| format!("{}*{}", n(e.amount.clamp(0.0, 1.0) * ZOOM_RANGE), prog(e))) {
        z = format!("{z}*(1+{s})");
    }
    if let Some(s) = sum("zoomOut", &|e| format!("{}*(1-{})", n(e.amount.clamp(0.0, 1.0) * ZOOM_RANGE), prog(e))) {
        z = format!("{z}*(1+{s})");
    }
    if let Some(s) = sum("punch", &|e| format!("{}*{}", n(e.amount.clamp(0.0, 1.0) * PUNCH_RANGE), ease(e, PUNCH_DECAY))) {
        z = format!("{z}*(1+{s})");
    }
    // Shake amplitude: the steady shake plus hits that ease out.
    let shake = sum("shake", &|e| n(e.amount.clamp(0.0, 1.0) * SHAKE_RANGE));
    let hit = sum("hitShake", &|e| format!("{}*{}", n(e.amount.clamp(0.0, 1.0) * HIT_SHAKE_RANGE), ease(e, HIT_SHAKE_DECAY)));
    let amp = match (shake, hit) {
        (Some(s), Some(h)) => Some(format!("({s}+{h})")),
        (Some(s), None) => Some(format!("({s})")),
        (None, Some(h)) => Some(format!("({h})")),
        (None, None) => None,
    };
    let (dx, dy) = match &amp {
        Some(amp) => {
            z = format!("{z}*(1+2.2*{amp})");
            let wave = |parts: &[(f64, f64, f64); 2]| {
                let terms: Vec<String> = parts
                    .iter()
                    .map(|(w, f, ph)| format!("{w}*sin({:.5}*{t}+{ph})", 2.0 * std::f64::consts::PI * f))
                    .collect();
                format!("{amp}*({})", terms.join("+"))
            };
            (wave(&SHAKE_X), wave(&SHAKE_Y))
        }
        None => ("0".to_string(), "0".to_string()),
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
        Effect { kind: kind.into(), amount, from: None, to: None }
    }

    fn ranged(kind: &str, amount: f64, from: f64, to: f64) -> Effect {
        Effect { kind: kind.into(), amount, from: Some(from), to: Some(to) }
    }

    #[test]
    fn nothing_means_no_filters() {
        assert!(pre_scale(&[], 5.0, None).is_empty());
        assert!(picture(&[], 1080, 5.0, None).is_empty());
        assert!(motion(&[], 5.0, 30, None).is_none());
        assert!(picture(&[fx("bogus", 1.0)], 1080, 5.0, None).is_empty());
    }

    #[test]
    fn picture_effects_in_fixed_order() {
        let list = [fx("grain", 0.5), fx("letterbox", 1.0), fx("blur", 1.0), fx("bw", 1.0), fx("mirror", 1.0), fx("scanlines", 1.0)];
        let chain = picture(&list, 1080, 5.0, None).join(",");
        let color = chain.find("colorchannelmixer").unwrap();
        let blur = chain.find("gblur=sigma=16.20").unwrap();
        let grain = chain.find("noise=c0s=20").unwrap();
        let lines = chain.find("drawgrid=x=iw:y=0:w=iw+3:h=6:t=3:color=black@0.500").unwrap();
        let bars = chain.find("drawbox=x=0:y=0:w=iw:h=ih*0.1200").unwrap();
        assert!(color < blur && blur < grain && grain < lines && lines < bars, "{chain}");
        assert!(chain.ends_with("format=yuva420p"));
        assert!(!chain.contains("enable"), "whole-clip effects need no gate: {chain}");
        assert_eq!(pre_scale(&list, 5.0, None), vec!["hflip".to_string()]);
    }

    #[test]
    fn invert_is_one_minus() {
        let chain = picture(&[fx("invert", 1.0)], 720, 5.0, None).join(",");
        assert!(chain.contains("clip(-1.00000*val+255.000,0,255)"), "{chain}");
    }

    #[test]
    fn packs_expand_from_the_shared_table() {
        let list = expand(&[Effect { kind: "noir".into(), amount: 0.5, from: Some(1.0), to: Some(2.0) }], 5.0);
        assert_eq!(list[0], Inst { kind: "bw".into(), amount: 0.5, a: 1.0, b: 2.0 });
        assert!(list.iter().any(|e| e.kind == "vignette" && (e.amount - 0.3).abs() < 1e-9));
        assert!(expand(&[fx("vhs", 1.0)], 5.0).iter().any(|e| e.kind == "scanlines"));
    }

    #[test]
    fn ranges_gate_and_later_instances_win() {
        let list = [ranged("blur", 0.2, 0.0, 4.0), ranged("blur", 1.0, 1.0, 2.0)];
        let chain = picture(&list, 1000, 4.0, None).join(",");
        // The first blur hides while the second (later in the list) is active.
        assert!(chain.contains("gblur=sigma=3.00:enable='(1-gte(t,1.0000)*lt(t,2.0000))'"), "{chain}");
        assert!(chain.contains("gblur=sigma=15.00:enable='gte(t,1.0000)*lt(t,2.0000)'"), "{chain}");
        // A later instance covering it completely removes it.
        let hidden = picture(&[ranged("blur", 0.2, 1.0, 2.0), fx("blur", 1.0)], 1000, 4.0, None).join(",");
        assert_eq!(hidden.matches("gblur").count(), 1, "{hidden}");
        // Colour stacks: both stay, each with its own gate.
        let colours = picture(&[ranged("bw", 1.0, 0.0, 1.0), ranged("bw", 1.0, 0.5, 1.5)], 1000, 4.0, None).join(",");
        assert_eq!(colours.matches("colorchannelmixer").count(), 2, "{colours}");
    }

    #[test]
    fn layers_always_gate_to_their_span() {
        let chain = picture(&[fx("invert", 1.0)], 720, 2.0, Some(3.0)).join(",");
        assert!(chain.contains("enable='gte(t,3.0000)*lt(t,5.0000)'"), "{chain}");
        assert_eq!(pre_scale(&[fx("mirror", 1.0)], 2.0, Some(3.0)), vec!["hflip:enable='gte(t,3.0000)*lt(t,5.0000)'".to_string()]);
    }

    #[test]
    fn zoom_and_shake_build_one_perspective() {
        let f = motion(&[fx("zoomIn", 1.0), fx("shake", 1.0)], 4.0, 30, None).unwrap();
        assert!(f.starts_with("perspective="));
        assert!(f.contains("clip(((in/30)-0.0000)/4.0000,0,1)"), "{f}");
        assert!(f.contains("(1+2.2*(0.0250))"), "{f}"); // shake margin
        assert!(f.ends_with("eval=frame"));
        let ranged_zoom = motion(&[ranged("zoomIn", 1.0, 1.0, 3.0)], 4.0, 30, None).unwrap();
        assert!(ranged_zoom.contains("gte((in/30),1.0000)*lt((in/30),3.0000)*0.3500*clip(((in/30)-1.0000)/2.0000,0,1)"), "{ranged_zoom}");
    }

    #[test]
    fn beat_hits() {
        let f = motion(&[fx("punch", 1.0), fx("hitShake", 0.5)], 2.0, 30, None).unwrap();
        assert!(f.contains("(1+0.1200*pow(max(0,1-((in/30)-0.0000)/0.35),2))"), "{f}");
        assert!(f.contains("0.0200*pow(max(0,1-((in/30)-0.0000)/0.4),2)"), "{f}");
        let chain = picture(&[fx("flash", 0.6)], 720, 2.0, None).join(",");
        assert!(chain.contains("settb=AVTB,setpts=PTS+0.1000/TB,fade=t=in:st=0.0000:d=0.25:color=white,setpts=PTS-0.1000/TB"), "{chain}");
        // Later in the clip there is room before the hit: no clock shift, just a gate.
        let late = picture(&[ranged("flash", 0.6, 1.0, 2.0)], 720, 2.0, None).join(",");
        assert!(late.contains("fade=t=in:st=0.9000:d=0.25:color=white:enable='gte(t,1.0000)*lt(t,2.0000)'"), "{late}");
    }
}

/// Effect-browser demos: every effect on the same synthetic scene through the real export filters,
/// as small looping animated webp files in `src/assets/fx-demos/`. Regenerate after changing an
/// effect: `cargo test --lib generate_fx_demos -- --ignored`.
#[cfg(test)]
mod demos {
    use super::*;

    const KINDS: [&str; 42] = [
        "brightness", "contrast", "saturation", "temperature", "sharpen", "punchy", "bw", "sepia", "invert", "cinematic", "noir", "cold",
        "sunset", "faded", "rgbSplit", "glitch", "beatGlitch", "crt", "blur", "softFocus", "dreamy", "heavyBlur", "vhs", "vintage",
        "oldFilm", "grain", "scanlines", "fadeIn", "fadeOut", "flash", "zoomIn", "zoomOut", "vignette", "letterbox", "widescreen",
        "shake", "earthquake", "mirror", "flip", "punch", "hitShake", "amvHit",
    ];

    /// Amount and range used for a demo: hits fire twice, fades take half the loop.
    fn demo(kind: &str) -> Vec<Effect> {
        let e = |amount: f64, from: Option<f64>, to: Option<f64>| Effect { kind: kind.into(), amount, from, to };
        match kind {
            "flash" | "punch" | "hitShake" | "amvHit" | "beatGlitch" => {
                let amount = if kind == "flash" { 0.8 } else { 1.0 };
                vec![e(amount, Some(0.25), Some(1.25)), e(amount, Some(1.25), None)]
            }
            "fadeIn" => vec![e(1.0, Some(0.2), Some(1.4))],
            "fadeOut" => vec![e(1.0, Some(0.6), Some(1.8))],
            "brightness" | "contrast" | "saturation" | "temperature" => vec![e(0.7, None, None)],
            "blur" | "rgbSplit" | "grain" | "sharpen" => vec![e(0.6, None, None)],
            _ => vec![e(1.0, None, None)],
        }
    }

    #[test]
    #[ignore]
    fn generate_fx_demos() {
        let bin = crate::audio::ffmpeg::ffmpeg_binary().expect("ffmpeg");
        let out = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/assets/fx-demos");
        std::fs::create_dir_all(&out).unwrap();
        let (w, h, fps, len) = (160u32, 90u32, 15u32, 2.0f64);
        // A colourful scene with movement: drifting gradient, a bouncing disc, a sliding bar.
        let scene = format!(
            "gradients=s={w}x{h}:r={fps}:d={len}:c0=0x3a1c71:c1=0xd76d77:c2=0x1f8fb5:c3=0xffaf7b:nb_colors=4:speed=0.06:type=linear,format=rgba,\
             geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255',\
             drawbox=x='{w}*0.15+{w}*0.5*abs(sin(t*1.6))':y='{h}*0.35':w='{h}*0.3':h='{h}*0.3':color=white@0.95:t=fill,\
             drawbox=x='-{w}+mod(t*{w},2*{w})':y='{h}*0.78':w='{w}*0.4':h='{h}*0.06':color=0x101820:t=fill"
        );
        for kind in KINDS {
            let fx = demo(kind);
            let mut chain = pre_scale(&fx, len, None);
            chain.extend(picture(&fx, h, len, None));
            chain.extend(motion(&fx, len, fps, None));
            let mut graph = scene.clone();
            if !chain.is_empty() {
                graph = format!("{graph},{}", chain.join(","));
            }
            graph.push_str(",format=yuv420p");
            let file = out.join(format!("{kind}.webp"));
            let status = std::process::Command::new(&bin)
                .args(["-y", "-loglevel", "error", "-f", "lavfi", "-i", &graph, "-c:v", "libwebp_anim", "-loop", "0", "-q:v", "62", "-compression_level", "6", "-an"])
                .arg(&file)
                .status()
                .unwrap();
            assert!(status.success(), "{kind}: {graph}");
        }
    }
}
