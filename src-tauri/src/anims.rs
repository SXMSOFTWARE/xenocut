//! Clip animations (In / Out / Combo). The tables live in `src/project/clip-anims.json`, shared
//! with `src/project/anims.ts`, so the export follows the same curves as the preview.
//!
//! The export applies them to the clip's canvas-sized RGBA picture: `rotate` (about the centre),
//! then a `perspective` warp for the scale and offset (over a transparent border, so whatever is
//! uncovered stays transparent), then `fade` on the alpha. Blur, RGB split, shakes and flashes are
//! added as ranged effects (`effects`), which the effect chain already renders.

use crate::effects::Effect;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AnimSlot {
    pub kind: String,
    pub duration: f64,
    /// A plugin animation carries its own definition (same shape as a table entry), so the project
    /// renders the same even where the plugin is not installed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spec: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ClipAnim {
    #[serde(default, rename = "in", skip_serializing_if = "Option::is_none")]
    pub in_anim: Option<AnimSlot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub out: Option<AnimSlot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub combo: Option<AnimSlot>,
}

type Fx = (String, f64, f64, f64);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeDef {
    #[serde(default = "one")]
    s: f64,
    #[serde(default)]
    tx: f64,
    #[serde(default)]
    ty: f64,
    #[serde(default)]
    rot: f64,
    #[serde(default)]
    alpha: bool,
    #[serde(default = "one")]
    alpha_span: f64,
    curve: String,
    #[serde(default)]
    fx: Vec<Fx>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ComboDef {
    terms: Vec<(String, f64, String)>,
    #[serde(default)]
    fx: Vec<Fx>,
}

#[derive(Debug, Deserialize)]
struct Table {
    #[serde(rename = "in")]
    edges: HashMap<String, EdgeDef>,
    combo: HashMap<String, ComboDef>,
}

fn one() -> f64 {
    1.0
}

fn table() -> &'static Table {
    static T: OnceLock<Table> = OnceLock::new();
    T.get_or_init(|| {
        serde_json::from_str(include_str!("../../src/project/clip-anims.json"))
            .expect("clip-anims.json")
    })
}

/// The In/Out definition of a slot: its inline plugin spec, else the built-in table entry.
fn edge_def(slot: Option<&AnimSlot>) -> Option<EdgeDef> {
    let slot = slot?;
    match &slot.spec {
        Some(v) => serde_json::from_value(v.clone()).ok(),
        None => table().edges.get(&slot.kind).cloned(),
    }
}

fn combo_def(slot: Option<&AnimSlot>) -> Option<ComboDef> {
    let slot = slot?;
    match &slot.spec {
        Some(v) => serde_json::from_value(v.clone()).ok(),
        None => table().combo.get(&slot.kind).cloned(),
    }
}

/// Checks a plugin's animation definition (used when a pack is installed).
pub fn validate_spec(combo: bool, spec: &serde_json::Value) -> Result<(), String> {
    let fx = if combo {
        let d: ComboDef = serde_json::from_value(spec.clone()).map_err(|e| e.to_string())?;
        for (param, _, wave) in &d.terms {
            if !["s", "tx", "ty", "rot"].contains(&param.as_str())
                || !["sin", "bump", "beat", "turn", "ramp", "ramp1"].contains(&wave.as_str())
            {
                return Err(format!("unknown term {param}/{wave}"));
            }
        }
        d.fx
    } else {
        let d: EdgeDef = serde_json::from_value(spec.clone()).map_err(|e| e.to_string())?;
        if !["ease", "back", "bounce", "linear"].contains(&d.curve.as_str()) {
            return Err(format!("unknown curve {}", d.curve));
        }
        d.fx
    };
    for (kind, ..) in fx {
        if !crate::effects::is_known_kind(&kind) {
            return Err(format!("unknown effect {kind}"));
        }
    }
    Ok(())
}

fn n(v: f64) -> String {
    format!("{v:.5}")
}

/// In and Out windows fitted into the clip (In first, Out gets what is left).
pub fn windows(anim: &ClipAnim, length: f64) -> (f64, f64) {
    let din = match &anim.in_anim {
        Some(s) if edge_def(Some(s)).is_some() => s.duration.max(0.05).min(length),
        _ => 0.0,
    };
    let dout = match &anim.out {
        Some(s) if edge_def(Some(s)).is_some() => s.duration.max(0.05).min((length - din).max(0.0)),
        _ => 0.0,
    };
    (din, dout)
}

/// Hidden share of the window at progress `p` (an expression), as in `anims.ts`.
fn hidden(curve: &str, p: &str) -> String {
    match curve {
        "linear" => format!("(1-{p})"),
        "back" => format!("(-(2.70158*pow({p}-1,3)+1.70158*pow({p}-1,2)))"),
        "bounce" => format!("(abs(cos(7.853982*{p}))*pow(1-{p},2))"),
        _ => format!("pow(1-{p},3)"),
    }
}

struct Exprs {
    s: Vec<String>,
    tx: Vec<String>,
    ty: Vec<String>,
    rot: Vec<String>,
}

/// Scale / offset / rotation expressions with `t` standing for local time.
fn exprs(anim: &ClipAnim, length: f64, t: &str) -> Exprs {
    let (din, dout) = windows(anim, length);
    let mut e = Exprs {
        s: vec![],
        tx: vec![],
        ty: vec![],
        rot: vec![],
    };
    let mut edge = |def: &EdgeDef, p: String| {
        let f = hidden(&def.curve, &p);
        if (def.s - 1.0).abs() > 1e-9 {
            e.s.push(format!("(1+{}*{f})", n(def.s - 1.0)));
        }
        if def.tx != 0.0 {
            e.tx.push(format!("{}*{f}", n(def.tx)));
        }
        if def.ty != 0.0 {
            e.ty.push(format!("{}*{f}", n(def.ty)));
        }
        if def.rot != 0.0 {
            e.rot.push(format!("{}*{f}", n(def.rot)));
        }
    };
    if din > 0.0 {
        let def = edge_def(anim.in_anim.as_ref()).unwrap();
        edge(&def, format!("clip({t}/{},0,1)", n(din)));
    }
    if dout > 0.0 {
        let def = edge_def(anim.out.as_ref()).unwrap();
        edge(&def, format!("clip(({}-{t})/{},0,1)", n(length), n(dout)));
    }
    if let Some(slot) = &anim.combo {
        if let Some(def) = combo_def(Some(slot)) {
            let period = n(slot.duration.max(0.05));
            let mut s = Vec::new();
            for (param, amp, wave) in &def.terms {
                let w = match wave.as_str() {
                    "sin" => format!("sin(2*PI*{t}/{period})"),
                    "bump" => format!("(0.5-0.5*cos(2*PI*{t}/{period}))"),
                    "beat" => format!("pow(abs(sin(PI*{t}/{period})),12)"),
                    "turn" => format!("({t}/{period})"),
                    "ramp" => format!("clip({t}/{},0,1)", n(length.max(1e-3))),
                    "ramp1" => format!("(1-clip({t}/{},0,1))", n(length.max(1e-3))),
                    _ => continue,
                };
                let term = format!("{}*{w}", n(*amp));
                match param.as_str() {
                    "s" => s.push(term),
                    "tx" => e.tx.push(term),
                    "ty" => e.ty.push(term),
                    "rot" => e.rot.push(term),
                    _ => {}
                }
            }
            if !s.is_empty() {
                e.s.push(format!("(1+{})", s.join("+")));
            }
        }
    }
    e
}

/// Filters for the clip's canvas-sized `yuva420p` picture; empty when there is no animation.
pub fn chain(anim: &ClipAnim, length: f64, fps: u32) -> Vec<String> {
    chain_shifted(anim, length, fps, 0.0)
}

/// [`chain`] over a stream that starts `shift` seconds before the clip (transition handles).
pub fn chain_shifted(anim: &ClipAnim, length: f64, fps: u32, shift: f64) -> Vec<String> {
    let mut out = Vec::new();
    let shifted = shift.abs() > 1e-9;
    let t_expr = if shifted {
        format!("(t-{})", n(shift))
    } else {
        "t".to_string()
    };
    let rot = exprs(anim, length, &t_expr).rot;
    if !rot.is_empty() {
        out.push(format!(
            "rotate=a='({})*PI/180':ow=iw:oh=ih:fillcolor=none",
            rot.join("+")
        ));
    }
    let in_expr = if shifted {
        format!("(in/{fps}-{})", n(shift))
    } else {
        format!("(in/{fps})")
    };
    let e = exprs(anim, length, &in_expr);
    if !(e.s.is_empty() && e.tx.is_empty() && e.ty.is_empty()) {
        let join = |v: &Vec<String>, op: &str, empty: &str| {
            if v.is_empty() {
                empty.to_string()
            } else {
                format!("({})", v.join(op))
            }
        };
        let s = join(&e.s, "*", "1");
        let tx = join(&e.tx, "+", "0");
        let ty = join(&e.ty, "+", "0");
        // A 2 px transparent border: perspective repeats edge pixels, so uncovered areas stay clear.
        let cx = format!("(W/2+{tx}*(W-4))");
        let cy = format!("(H/2+{ty}*(H-4))");
        let (l, r) = (format!("({cx}-W/2*{s})"), format!("({cx}+W/2*{s})"));
        let (top, b) = (format!("({cy}-H/2*{s})"), format!("({cy}+H/2*{s})"));
        out.push("pad=iw+4:ih+4:2:2:color=black@0".into());
        out.push(format!(
            "perspective=x0='{l}':y0='{top}':x1='{r}':y1='{top}':x2='{l}':y2='{b}':x3='{r}':y3='{b}':sense=destination:interpolation=linear:eval=frame"
        ));
        out.push("crop=iw-4:ih-4:2:2".into());
    }
    let (din, dout) = windows(anim, length);
    if din > 0.0 {
        let def = edge_def(anim.in_anim.as_ref()).unwrap();
        if def.alpha {
            out.push(format!(
                "fade=t=in:st={}:d={}:alpha=1",
                n(shift),
                n(din * def.alpha_span.clamp(0.01, 1.0))
            ));
        }
    }
    if dout > 0.0 {
        let def = edge_def(anim.out.as_ref()).unwrap();
        if def.alpha {
            let d = dout * def.alpha_span.clamp(0.01, 1.0);
            out.push(format!(
                "fade=t=out:st={}:d={}:alpha=1",
                n(shift + length - d),
                n(d)
            ));
        }
    }
    out
}

/// The extra effects the animations add (blur, RGB split, shakes, flashes), as ranged effects.
pub fn effects(anim: &ClipAnim, length: f64) -> Vec<Effect> {
    let (din, dout) = windows(anim, length);
    let clamp = |v: f64| v.clamp(0.0, length);
    let mut out = Vec::new();
    let mut push = |kind: &str, amount: f64, a: f64, b: f64| {
        if b - a > 1e-3 {
            out.push(Effect {
                kind: kind.into(),
                amount,
                from: Some(a),
                to: Some(b),
            });
        }
    };
    if din > 0.0 {
        for (kind, amount, a, b) in &edge_def(anim.in_anim.as_ref()).unwrap().fx {
            push(kind, *amount, clamp(a * din), clamp(b * din));
        }
    }
    if dout > 0.0 {
        for (kind, amount, a, b) in &edge_def(anim.out.as_ref()).unwrap().fx {
            push(
                kind,
                *amount,
                clamp(length - b * dout),
                clamp(length - a * dout),
            );
        }
    }
    if let Some(def) = combo_def(anim.combo.as_ref()) {
        for (kind, amount, a, b) in &def.fx {
            push(kind, *amount, clamp(a * length), clamp(b * length));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slot(kind: &str, duration: f64) -> Option<AnimSlot> {
        Some(AnimSlot {
            kind: kind.into(),
            duration,
            spec: None,
        })
    }

    #[test]
    fn inline_plugin_specs_render() {
        let spec = serde_json::json!({ "s": 0.2, "rot": -30, "alpha": true, "curve": "back", "fx": [["blur", 0.5, 0, 0.5]] });
        validate_spec(false, &spec).unwrap();
        let a = ClipAnim {
            in_anim: Some(AnimSlot {
                kind: "plug.twirl".into(),
                duration: 0.6,
                spec: Some(spec),
            }),
            ..Default::default()
        };
        let c = chain(&a, 2.0, 30).join(",");
        assert!(
            c.contains("rotate=") && c.contains("perspective=") && c.contains("fade=t=in"),
            "{c}"
        );
        assert_eq!(effects(&a, 2.0).len(), 1);
        assert!(validate_spec(false, &serde_json::json!({ "curve": "wild" })).is_err());
        assert!(
            validate_spec(
                true,
                &serde_json::json!({ "terms": [["s", 0.1, "sin"]], "fx": [["nope", 1, 0, 1]] })
            )
            .is_err()
        );
        validate_spec(
            true,
            &serde_json::json!({ "terms": [["s", 0.1, "sin"], ["rot", 5, "bump"]] }),
        )
        .unwrap();
    }

    #[test]
    fn table_parses_and_every_kind_builds() {
        let t = table();
        assert!(t.edges.len() >= 14 && t.combo.len() >= 8);
        for k in t.edges.keys() {
            let a = ClipAnim {
                in_anim: slot(k, 0.5),
                out: slot(k, 0.5),
                combo: None,
            };
            let _ = chain(&a, 3.0, 30);
            let _ = effects(&a, 3.0);
        }
        for k in t.combo.keys() {
            let a = ClipAnim {
                combo: slot(k, 1.0),
                ..Default::default()
            };
            let _ = chain(&a, 3.0, 30);
        }
    }

    #[test]
    fn windows_fit_the_clip() {
        let a = ClipAnim {
            in_anim: slot("fade", 2.0),
            out: slot("fade", 2.0),
            combo: None,
        };
        assert_eq!(windows(&a, 3.0), (2.0, 1.0));
        let unknown = ClipAnim {
            in_anim: slot("nope", 1.0),
            ..Default::default()
        };
        assert_eq!(windows(&unknown, 3.0), (0.0, 0.0));
        assert!(chain(&unknown, 3.0, 30).is_empty());
    }

    #[test]
    fn slide_and_fade_filters() {
        let a = ClipAnim {
            in_anim: slot("slideLeft", 0.5),
            out: slot("fade", 0.4),
            combo: None,
        };
        let c = chain(&a, 2.0, 30).join(",");
        assert!(
            c.contains("perspective=") && c.contains("sense=destination"),
            "{c}"
        );
        assert!(c.contains("fade=t=out:st=1.60000:d=0.40000:alpha=1"), "{c}");
        assert!(!c.contains("rotate="));
        let fx = effects(
            &ClipAnim {
                in_anim: slot("blurIn", 1.0),
                ..Default::default()
            },
            2.0,
        );
        assert_eq!(fx.len(), 2);
        assert_eq!((fx[0].from, fx[0].to), (Some(0.0), Some(0.5)));
    }

    #[test]
    fn serde_shape_matches_the_frontend() {
        let a: ClipAnim = serde_json::from_str(
            r#"{"in":{"kind":"pop","duration":0.4},"combo":{"kind":"pulse","duration":1}}"#,
        )
        .unwrap();
        assert_eq!(a.in_anim.as_ref().unwrap().kind, "pop");
        assert!(a.out.is_none());
        assert!(serde_json::to_string(&a).unwrap().contains(r#""in":"#));
    }

    /// Every animation's filter chain runs in the real FFmpeg (skipped when it is not installed).
    #[test]
    fn chains_run_in_ffmpeg() {
        if std::process::Command::new("ffmpeg")
            .arg("-version")
            .output()
            .is_err()
        {
            return;
        }
        let t = table();
        let mut cases: Vec<ClipAnim> = t
            .edges
            .keys()
            .map(|k| ClipAnim {
                in_anim: slot(k, 0.4),
                out: slot(k, 0.3),
                combo: None,
            })
            .collect();
        cases.extend(t.combo.keys().map(|k| ClipAnim {
            combo: slot(k, 0.5),
            ..Default::default()
        }));
        for a in cases {
            let mut c = vec!["format=yuva420p".to_string()];
            c.extend(chain(&a, 1.0, 15));
            let out = std::process::Command::new("ffmpeg")
                .args([
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc2=s=160x90:r=15:d=1",
                    "-vf",
                    &c.join(","),
                    "-f",
                    "null",
                    "-",
                ])
                .output()
                .unwrap();
            assert!(
                out.status.success(),
                "{a:?}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        }
    }
}
