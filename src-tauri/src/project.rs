//! The `.xcut` project model. Mirrors `src/project/types.ts` on the frontend.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const PROJECT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettings {
    pub aspect: String,
    pub resolution: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    /// Colour grade id (see `grade.rs`); absent in older projects.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grade: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Video,
    Audio,
    Image,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
    pub id: String,
    pub path: String,
    pub name: String,
    pub kind: MediaKind,
    /// Seconds. Images report 0.
    pub duration: f64,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    #[serde(default)]
    pub fps: f64,
    #[serde(default)]
    pub has_audio: bool,
    #[serde(default)]
    pub has_video: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TrackKind {
    Video,
    Audio,
    Music,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub kind: TrackKind,
    pub name: String,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub hidden: bool,
}

fn one() -> f64 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    pub track_id: String,
    pub media_id: String,
    /// Timeline position in seconds.
    pub start: f64,
    /// Source in point, seconds.
    #[serde(rename = "in")]
    pub in_point: f64,
    /// Source out point, seconds.
    #[serde(rename = "out")]
    pub out_point: f64,
    #[serde(default = "one")]
    pub speed: f64,
    #[serde(default = "one")]
    pub volume: f64,
    #[serde(default = "one")]
    pub opacity: f64,
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
}

impl Clip {
    pub fn source_duration(&self) -> f64 {
        (self.out_point - self.in_point).max(0.0)
    }

    pub fn duration(&self) -> f64 {
        self.source_duration() / self.speed.max(0.01)
    }

    pub fn end(&self) -> f64 {
        self.start + self.duration()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub version: u32,
    pub id: String,
    pub name: String,
    pub created: String,
    pub modified: String,
    pub settings: ProjectSettings,
    pub media: Vec<MediaItem>,
    pub tracks: Vec<Track>,
    pub clips: Vec<Clip>,
}

impl Project {
    pub fn duration(&self) -> f64 {
        self.clips.iter().map(Clip::end).fold(0.0, f64::max)
    }

    pub fn media(&self, id: &str) -> Option<&MediaItem> {
        self.media.iter().find(|item| item.id == id)
    }

    pub fn track(&self, id: &str) -> Option<&Track> {
        self.tracks.iter().find(|track| track.id == id)
    }
}

pub fn save(path: &Path, project: &Project) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let text = serde_json::to_string_pretty(project).map_err(|err| err.to_string())?;
    // Write next to the target, then rename, so a crash never leaves half a project.
    let temp = path.with_extension("xcut.tmp");
    std::fs::write(&temp, text).map_err(|err| err.to_string())?;
    std::fs::rename(&temp, path).map_err(|err| err.to_string())
}

pub fn load(path: &Path) -> Result<Project, String> {
    let text = std::fs::read_to_string(path).map_err(|err| format!("{}: {err}", path.display()))?;
    let project: Project = serde_json::from_str(&text).map_err(|err| format!("Not a valid .xcut project: {err}"))?;
    if project.version > PROJECT_VERSION {
        return Err(format!(
            "This project was saved by a newer XenoCut (format {}).",
            project.version
        ));
    }
    Ok(project)
}

/// A free `<dir>/<name>.xcut` path, adding ` (2)`, ` (3)` when the name is taken.
pub fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let base = safe_file_name(name);
    let mut candidate = dir.join(format!("{base}.xcut"));
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{base} ({n}).xcut"));
        n += 1;
    }
    candidate
}

pub fn safe_file_name(name: &str) -> String {
    let cleaned: String = name
        .trim()
        .chars()
        .map(|ch| if matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || ch.is_control() { '_' } else { ch })
        .take(80)
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').to_string();
    if cleaned.is_empty() { "Untitled".into() } else { cleaned }
}

#[cfg(test)]
mod tests {
    use super::*;

    pub fn sample() -> Project {
        Project {
            version: 1,
            id: "p1".into(),
            name: "Demo".into(),
            created: "2026-10-23T00:00:00Z".into(),
            modified: "2026-10-23T00:00:00Z".into(),
            settings: ProjectSettings { aspect: "16:9".into(), resolution: "1080p".into(), width: 1920, height: 1080, fps: 30, grade: None },
            media: vec![],
            tracks: vec![Track { id: "v1".into(), kind: TrackKind::Video, name: "Video 1".into(), muted: false, hidden: false }],
            clips: vec![],
        }
    }

    #[test]
    fn round_trips_through_json_with_frontend_field_names() {
        let mut project = sample();
        project.clips.push(Clip {
            id: "c1".into(),
            track_id: "v1".into(),
            media_id: "m1".into(),
            start: 2.0,
            in_point: 1.0,
            out_point: 5.0,
            speed: 2.0,
            volume: 1.0,
            opacity: 1.0,
            fade_in: 0.0,
            fade_out: 0.0,
        });
        let text = serde_json::to_string(&project).unwrap();
        assert!(text.contains("\"trackId\":\"v1\""));
        assert!(text.contains("\"in\":1.0"));
        let back: Project = serde_json::from_str(&text).unwrap();
        assert_eq!(back, project);
        assert!((back.duration() - 4.0).abs() < 1e-9);
    }

    #[test]
    fn unique_paths_and_safe_names() {
        assert_eq!(safe_file_name("  a/b:c  "), "a_b_c");
        assert_eq!(safe_file_name("..."), "Untitled");
        let dir = std::env::temp_dir().join(format!("xenocut-unique-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let first = unique_path(&dir, "Film");
        std::fs::write(&first, "{}").unwrap();
        let second = unique_path(&dir, "Film");
        assert!(second.ends_with("Film (2).xcut"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
