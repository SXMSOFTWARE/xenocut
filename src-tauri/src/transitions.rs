//! Transitions between adjacent clips on a video track.
//!
//! A transition lives on the outgoing clip (`Clip::transition`) and joins it to the next clip on
//! the same track when that clip starts where this one ends (within [`ADJACENT_EPS`]). It is
//! centred on the cut: over `[cut - d/2, cut + d/2]` the outgoing clip keeps playing past its
//! out point and the incoming one starts early, both from real source frames (handles) when the
//! media has them, otherwise holding the first / last frame.
//!
//! Built-in transitions are FFmpeg `xfade` transitions (the preview runs GLSL ports of the same
//! formulas, see `src/project/transitions.ts`). Shader transitions (gl-transitions format, from
//! packs) are rendered by the frontend's WebGL into PNG frames and spliced in (`frames`); when
//! that is unavailable the export falls back to the entry's `fallback` xfade (or `fade`).

use serde::{Deserialize, Serialize};

use crate::project::Clip;

/// Clips closer than this (seconds) count as adjacent. Same value in `transitions.ts`.
pub const ADJACENT_EPS: f64 = 0.02;
pub const MIN_DURATION: f64 = 0.1;
pub const MAX_DURATION: f64 = 5.0;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClipTransition {
    pub id: String,
    pub duration: f64,
    /// Display name (kept so the project reads well when the pack is gone).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Shader transitions: the gl-transitions GLSL source, copied from the pack.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub glsl: Option<String>,
    /// Shader uniform values (opaque to the backend).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
    /// The xfade transition used when the shader can't be rendered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback: Option<String>,
}

/// The FFmpeg `xfade` transitions offered as built-ins (all in FFmpeg 7.1, the oldest build the
/// app ships). Their ids are the xfade names.
pub const XFADE: &[&str] = &[
    "fade",
    "fadeblack",
    "fadewhite",
    "fadegrays",
    "dissolve",
    "pixelize",
    "wipeleft",
    "wiperight",
    "wipeup",
    "wipedown",
    "wipetl",
    "wipetr",
    "wipebl",
    "wipebr",
    "slideleft",
    "slideright",
    "slideup",
    "slidedown",
    "coverleft",
    "coverright",
    "coverup",
    "coverdown",
    "revealleft",
    "revealright",
    "revealup",
    "revealdown",
    "smoothleft",
    "smoothright",
    "smoothup",
    "smoothdown",
    "circleopen",
    "circleclose",
    "circlecrop",
    "rectcrop",
    "vertopen",
    "vertclose",
    "horzopen",
    "horzclose",
    "radial",
    "diagtl",
    "diagtr",
    "diagbl",
    "diagbr",
    "hlslice",
    "hrslice",
    "vuslice",
    "vdslice",
    "squeezeh",
    "squeezev",
    "zoomin",
    "fadefast",
    "fadeslow",
    "hlwind",
    "hrwind",
    "vuwind",
    "vdwind",
    "hblur",
    "distance",
];

pub fn is_xfade(id: &str) -> bool {
    XFADE.contains(&id)
}

impl ClipTransition {
    /// The xfade name to export with when no shader frames are available.
    pub fn xfade(&self) -> &str {
        if is_xfade(&self.id) && self.glsl.is_none() {
            return &self.id;
        }
        match self.fallback.as_deref() {
            Some(f) if is_xfade(f) => f,
            _ => "fade",
        }
    }

    /// Needs the frontend's shader render step for an exact result.
    pub fn is_shader(&self) -> bool {
        !(is_xfade(&self.id) && self.glsl.is_none())
    }
}

/// Duration actually used between clips of lengths `a` and `b` (timeline seconds): each clip
/// gives at most half of itself to each of its two possible transitions.
pub fn effective_duration(requested: f64, a: f64, b: f64) -> f64 {
    if !requested.is_finite() {
        return 0.0;
    }
    requested.clamp(0.0, MAX_DURATION).min(a).min(b)
}

pub fn adjacent(a: &Clip, b: &Clip) -> bool {
    (b.start - a.end()).abs() < ADJACENT_EPS
}

/// A transition into the next clip: (outgoing clip index, duration) for each cut of `clips`
/// (one track, sorted by start) that has an active transition.
pub fn joins(clips: &[&Clip]) -> Vec<Option<f64>> {
    let mut out = vec![None; clips.len()];
    for i in 0..clips.len().saturating_sub(1) {
        let (a, b) = (clips[i], clips[i + 1]);
        let Some(t) = &a.transition else { continue };
        if !adjacent(a, b) {
            continue;
        }
        let d = effective_duration(t.duration, a.duration(), b.duration());
        if d >= MIN_DURATION - 1e-9 {
            out[i] = Some(d);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clip(id: &str, start: f64, len: f64, t: Option<f64>) -> Clip {
        serde_json::from_value(serde_json::json!({
            "id": id, "trackId": "v", "mediaId": "m", "start": start, "in": 0.0, "out": len,
            "transition": t.map(|d| serde_json::json!({"id": "fade", "duration": d})),
        }))
        .unwrap()
    }

    #[test]
    fn joins_need_adjacency_and_clamp() {
        let a = clip("a", 0.0, 2.0, Some(1.0));
        let b = clip("b", 2.0, 0.6, Some(3.0));
        let c = clip("c", 2.6, 4.0, Some(1.0));
        let d = clip("d", 7.0, 1.0, None);
        let j = joins(&[&a, &b, &c, &d]);
        assert_eq!(j[0], Some(0.6));
        assert_eq!(j[1], Some(0.6));
        assert_eq!(j[2], None, "gap before d");
        assert_eq!(j[3], None);
    }

    #[test]
    fn xfade_fallbacks() {
        let mut t = ClipTransition {
            id: "wipeleft".into(),
            duration: 1.0,
            ..Default::default()
        };
        assert_eq!(t.xfade(), "wipeleft");
        assert!(!t.is_shader());
        t.id = "pack.x/cube".into();
        t.glsl = Some("vec4 transition(vec2 uv){return getToColor(uv);}".into());
        assert_eq!(t.xfade(), "fade");
        t.fallback = Some("slideleft".into());
        assert_eq!(t.xfade(), "slideleft");
        assert!(t.is_shader());
    }
}
