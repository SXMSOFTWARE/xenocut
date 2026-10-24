//! Plugin packs: data-only bundles (JSON manifest + assets) that add effect presets, clip
//! animations, colour LUTs and text presets. Packs never contain code: every entry is validated
//! against the same primitives the built-ins use, so a pack can't do anything a built-in can't.
//!
//! Layout: `<app data>/plugins/<id>/manifest.json` (+ assets), `<app data>/plugins/state.json`
//! (`{"disabled": [ids]}`). Install sources: a `.xcpack` / `.zip` archive, a folder holding a
//! `manifest.json`, a bare `.cube` LUT (wrapped into a generated pack), or an https URL from the
//! catalog (downloaded with a sha256 check). Applying an entry copies its content into the
//! project (effect stacks, animation specs, LUT file path), so projects keep their look.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

pub const FORMAT: &str = "xenocut-pack/1";
const MAX_FILES: usize = 400;
const MAX_FILE_BYTES: u64 = 24 << 20;
const MAX_PACK_BYTES: u64 = 64 << 20;
const ASSET_EXTS: [&str; 8] = ["json", "cube", "png", "webp", "jpg", "jpeg", "txt", "md"];
const MAX_LUT_SIZE: usize = 65;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format: String,
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub author: String,
    /// SPDX id; required so the Library can always show it.
    pub license: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub effects: Vec<EffectPreset>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub animations: Vec<AnimPreset>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub luts: Vec<LutEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub text_presets: Vec<TextPreset>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EffectPreset {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub category: String,
    /// `[[primitive kind, amount]]` like `fx-packs.json`: 0..1, or -1..1 for brightness,
    /// contrast, saturation and temperature.
    pub stack: Vec<(String, f64)>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AnimPreset {
    pub id: String,
    pub name: String,
    /// "in" | "out" | "combo". In/out share the edge format (out plays it reversed).
    pub slot: String,
    pub spec: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LutEntry {
    pub id: String,
    pub name: String,
    pub file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TextPreset {
    pub id: String,
    pub name: String,
    /// Partial text style; the frontend merges only known keys with matching types.
    pub style: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub manifest: Manifest,
    pub enabled: bool,
    pub dir: String,
    pub bytes: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct State {
    #[serde(default)]
    disabled: Vec<String>,
}

pub fn valid_id(id: &str) -> bool {
    let b = id.as_bytes();
    (2..=64).contains(&b.len())
        && b[0].is_ascii_alphanumeric()
        && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"._-".contains(c))
}

fn entry_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 48 && id.bytes().all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
}

/// A relative asset path inside the pack: no absolute paths, `..`, or odd extensions.
fn safe_rel(path: &str) -> Option<PathBuf> {
    let p = Path::new(path);
    if path.is_empty() || path.len() > 200 || path.contains('\\') {
        return None;
    }
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::Normal(s) => out.push(s),
            Component::CurDir => {}
            _ => return None,
        }
    }
    let ext = out.extension()?.to_str()?.to_ascii_lowercase();
    (ASSET_EXTS.contains(&ext.as_str()) && out.components().count() <= 4).then_some(out)
}

/// Checks everything in a manifest; `dir` (when given) must hold the referenced files.
pub fn validate(m: &Manifest, dir: Option<&Path>) -> Result<(), String> {
    if m.format != FORMAT {
        return Err(format!("unsupported pack format \"{}\" (expected {FORMAT})", m.format));
    }
    if !valid_id(&m.id) {
        return Err(format!("invalid pack id \"{}\" (use a-z, 0-9, . _ -)", m.id));
    }
    let short = |s: &str, n: usize| !s.trim().is_empty() && s.chars().count() <= n;
    if !short(&m.name, 64) || !short(&m.version, 32) || !short(&m.license, 64) {
        return Err("name, version and license are required".into());
    }
    if m.author.chars().count() > 96 || m.description.chars().count() > 600 {
        return Err("author or description too long".into());
    }
    if let Some(h) = &m.homepage {
        if !h.starts_with("https://") || h.len() > 300 {
            return Err("homepage must be an https URL".into());
        }
    }
    let total = m.effects.len() + m.animations.len() + m.luts.len() + m.text_presets.len();
    if total == 0 {
        return Err("the pack has no entries".into());
    }
    if total > 500 {
        return Err("too many entries".into());
    }
    let mut seen = std::collections::HashSet::new();
    let mut fresh = |kind: &str, id: &str| -> Result<(), String> {
        if !entry_id(id) || !seen.insert(format!("{kind}/{id}")) {
            return Err(format!("invalid or duplicate {kind} id \"{id}\""));
        }
        Ok(())
    };
    for e in &m.effects {
        fresh("effect", &e.id)?;
        if e.stack.is_empty() || e.stack.len() > 12 {
            return Err(format!("effect {}: 1 to 12 layers", e.id));
        }
        for (kind, amount) in &e.stack {
            let signed = ["brightness", "contrast", "saturation", "temperature"].contains(&kind.as_str());
            let range = if signed { -1.0..=1.0 } else { 0.0..=1.0 };
            if !crate::effects::is_primitive(kind) || !range.contains(amount) {
                return Err(format!("effect {}: unknown kind {kind} or amount out of range", e.id));
            }
        }
    }
    for a in &m.animations {
        fresh("animation", &a.id)?;
        if !["in", "out", "combo"].contains(&a.slot.as_str()) {
            return Err(format!("animation {}: slot must be in, out or combo", a.id));
        }
        if a.duration.is_some_and(|d| !(0.1..=10.0).contains(&d)) {
            return Err(format!("animation {}: duration out of 0.1..10", a.id));
        }
        let keys: &[&str] = if a.slot == "combo" { &["terms", "fx"] } else { &["s", "tx", "ty", "rot", "alpha", "alphaSpan", "curve", "fx"] };
        if let Some(bad) = a.spec.as_object().ok_or(format!("animation {}: spec must be an object", a.id))?.keys().find(|k| !keys.contains(&k.as_str())) {
            return Err(format!("animation {}: unknown spec field {bad}", a.id));
        }
        crate::anims::validate_spec(a.slot == "combo", &a.spec).map_err(|e| format!("animation {}: {e}", a.id))?;
    }
    for l in &m.luts {
        fresh("lut", &l.id)?;
        let rel = safe_rel(&l.file).filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("cube")));
        let rel = rel.ok_or_else(|| format!("lut {}: bad file path", l.id))?;
        if let Some(dir) = dir {
            let text = std::fs::read_to_string(dir.join(&rel)).map_err(|e| format!("lut {}: {e}", l.id))?;
            parse_cube(&text).map_err(|e| format!("lut {}: {e}", l.id))?;
        }
    }
    for t in &m.text_presets {
        fresh("text", &t.id)?;
        if t.style.is_empty() || t.style.len() > 40 || t.style.values().any(|v| v.is_object() || v.is_array()) {
            return Err(format!("text preset {}: style must be a flat object", t.id));
        }
    }
    if let Some(thumb) = &m.thumbnail {
        let rel = safe_rel(thumb).ok_or("bad thumbnail path")?;
        if dir.is_some_and(|d| !d.join(&rel).is_file()) {
            return Err("thumbnail file missing".into());
        }
    }
    let names = m.effects.iter().map(|e| &e.name).chain(m.animations.iter().map(|a| &a.name));
    if names.chain(m.luts.iter().map(|l| &l.name)).chain(m.text_presets.iter().map(|t| &t.name)).any(|n| !short(n, 48)) {
        return Err("every entry needs a name (max 48 chars)".into());
    }
    Ok(())
}

/// A parsed `.cube` 3D LUT: `size`³ RGB triples, red fastest (the file order).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Cube {
    pub size: usize,
    pub domain_min: [f32; 3],
    pub domain_max: [f32; 3],
    pub data: Vec<f32>,
}

pub fn parse_cube(text: &str) -> Result<Cube, String> {
    let (mut size, mut min, mut max) = (0usize, [0.0f32; 3], [1.0f32; 3]);
    let mut data = Vec::new();
    let triple = |rest: &[&str]| -> Result<[f32; 3], String> {
        if rest.len() < 3 {
            return Err("expected three numbers".into());
        }
        let mut out = [0.0; 3];
        for (o, s) in out.iter_mut().zip(rest) {
            *o = s.parse::<f32>().map_err(|_| format!("bad number {s}"))?;
            if !o.is_finite() {
                return Err("non-finite value".into());
            }
        }
        Ok(out)
    };
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        match parts[0] {
            "TITLE" => {}
            "LUT_3D_SIZE" => {
                size = parts.get(1).and_then(|s| s.parse().ok()).ok_or("bad LUT_3D_SIZE")?;
                if !(2..=MAX_LUT_SIZE).contains(&size) {
                    return Err(format!("LUT size {size} not in 2..{MAX_LUT_SIZE}"));
                }
            }
            "LUT_1D_SIZE" => return Err("1D LUTs are not supported (use a 3D .cube)".into()),
            "DOMAIN_MIN" => min = triple(&parts[1..])?,
            "DOMAIN_MAX" => max = triple(&parts[1..])?,
            "LUT_3D_INPUT_RANGE" | "LUT_1D_INPUT_RANGE" => {}
            _ if parts[0].starts_with(|c: char| c.is_ascii_digit() || c == '-' || c == '.') => {
                if size == 0 {
                    return Err("data before LUT_3D_SIZE".into());
                }
                data.extend_from_slice(&triple(&parts)?);
            }
            other => return Err(format!("unknown keyword {other}")),
        }
    }
    if size == 0 {
        return Err("missing LUT_3D_SIZE".into());
    }
    if data.len() != size * size * size * 3 {
        return Err(format!("expected {} entries, found {}", size * size * size, data.len() / 3));
    }
    if (0..3).any(|i| max[i] <= min[i]) {
        return Err("bad DOMAIN".into());
    }
    Ok(Cube { size, domain_min: min, domain_max: max, data })
}

/// The LUT mixed with identity by `amount`, as `.cube` text (for FFmpeg's `lut3d`).
pub fn bake_cube(c: &Cube, amount: f64) -> String {
    let a = amount.clamp(0.0, 1.0) as f32;
    let n = c.size;
    let mut out = format!("LUT_3D_SIZE {n}\nDOMAIN_MIN {} {} {}\nDOMAIN_MAX {} {} {}\n", c.domain_min[0], c.domain_min[1], c.domain_min[2], c.domain_max[0], c.domain_max[1], c.domain_max[2]);
    for i in 0..n * n * n {
        let idx = [i % n, (i / n) % n, i / (n * n)];
        let v: Vec<String> = (0..3)
            .map(|ch| {
                let ident = c.domain_min[ch] + (c.domain_max[ch] - c.domain_min[ch]) * idx[ch] as f32 / (n - 1) as f32;
                format!("{:.6}", ident + (c.data[i * 3 + ch] - ident) * a)
            })
            .collect();
        out += &v.join(" ");
        out.push('\n');
    }
    out
}

/// Writes the baked LUT to a content-addressed temp file and returns the `lut3d` filter for it,
/// or None (with a reason) if the file is missing or invalid.
pub fn lut_filter(path: &str, amount: f64) -> Result<Option<String>, String> {
    if amount <= 0.001 {
        return Ok(None);
    }
    let text = std::fs::read_to_string(path).map_err(|e| format!("LUT {path}: {e}"))?;
    let cube = parse_cube(&text).map_err(|e| format!("LUT {path}: {e}"))?;
    let baked = bake_cube(&cube, amount);
    let digest: String = Sha256::digest(baked.as_bytes()).iter().take(10).map(|b| format!("{b:02x}")).collect();
    let dir = std::env::temp_dir().join("xenocut-luts");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(format!("{digest}.cube"));
    if !file.is_file() {
        std::fs::write(&file, baked).map_err(|e| e.to_string())?;
    }
    let p = file.to_string_lossy().replace('\\', "/");
    if p.contains('\'') {
        return Err("temp folder path contains a quote".into());
    }
    Ok(Some(format!("lut3d=file='{}':interp=tetrahedral", p.replace(':', "\\:"))))
}

// ---------------------------------------------------------------- store

pub struct Store {
    pub root: PathBuf,
}

impl Store {
    pub fn new(root: PathBuf) -> Self {
        Store { root }
    }

    fn state(&self) -> State {
        std::fs::read(self.root.join("state.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    fn save_state(&self, s: &State) -> Result<(), String> {
        std::fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        std::fs::write(self.root.join("state.json"), serde_json::to_vec_pretty(s).unwrap()).map_err(|e| e.to_string())
    }

    pub fn list(&self) -> Vec<Installed> {
        let disabled = self.state().disabled;
        let mut out: Vec<Installed> = std::fs::read_dir(&self.root)
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| e.path().is_dir())
            .filter_map(|e| {
                let dir = e.path();
                let m: Manifest = serde_json::from_slice(&std::fs::read(dir.join("manifest.json")).ok()?).ok()?;
                if Some(m.id.as_str()) != dir.file_name()?.to_str() || validate(&m, Some(&dir)).is_err() {
                    return None;
                }
                Some(Installed { enabled: !disabled.contains(&m.id), bytes: dir_bytes(&dir), dir: dir.to_string_lossy().into(), manifest: m })
            })
            .collect();
        out.sort_by(|a, b| a.manifest.name.to_lowercase().cmp(&b.manifest.name.to_lowercase()));
        out
    }

    /// Installs (or replaces) a pack from a staged folder that holds `manifest.json`.
    fn install_dir(&self, staged: &Path) -> Result<Installed, String> {
        let m: Manifest = serde_json::from_slice(&std::fs::read(staged.join("manifest.json")).map_err(|_| "manifest.json not found in the pack".to_string())?)
            .map_err(|e| format!("manifest.json: {e}"))?;
        validate(&m, Some(staged))?;
        let mut files = 0usize;
        let mut total = 0u64;
        walk(staged, &mut |p, len| {
            files += 1;
            total += len;
            let rel = p.strip_prefix(staged).unwrap().to_string_lossy().replace('\\', "/");
            if safe_rel(&rel).is_none() {
                return Err(format!("file type not allowed in a pack: {rel}"));
            }
            if len > MAX_FILE_BYTES || files > MAX_FILES || total > MAX_PACK_BYTES {
                return Err("the pack is too large".into());
            }
            Ok(())
        })?;
        std::fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let dest = self.root.join(&m.id);
        let tmp = self.root.join(format!(".installing-{}", m.id));
        let _ = std::fs::remove_dir_all(&tmp);
        copy_dir(staged, &tmp)?;
        let _ = std::fs::remove_dir_all(&dest);
        std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
        let mut s = self.state();
        s.disabled.retain(|d| d != &m.id);
        self.save_state(&s)?;
        Ok(Installed { enabled: true, bytes: dir_bytes(&dest), dir: dest.to_string_lossy().into(), manifest: m })
    }

    /// `.xcpack` / `.zip`, a folder with `manifest.json`, or a `.cube` file.
    pub fn install_path(&self, path: &Path) -> Result<Installed, String> {
        let staging = self.root.join(".staging");
        let _ = std::fs::remove_dir_all(&staging);
        std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
        let ext = match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase() {
            // Android pickers can hand over files without their name: look at the bytes.
            e if !matches!(e.as_str(), "cube" | "xcpack" | "zip") && path.is_file() => sniff(path).unwrap_or(e),
            e => e,
        };
        let result = if path.is_dir() {
            self.install_dir(path)
        } else if ext == "cube" {
            wrap_cube(path, &staging).and_then(|_| self.install_dir(&staging))
        } else if ext == "xcpack" || ext == "zip" {
            unzip(path, &staging).and_then(|root| self.install_dir(&root))
        } else {
            match ext.as_str() {
                "json" | "glsl" | "frag" | "ofx" | "so" | "dll" => Err("Lottie, GLSL transitions and OpenFX plugins are planned for v0.7; this version installs .xcpack, .zip and .cube".into()),
                _ => Err("choose a .xcpack, .zip, .cube or a pack folder".into()),
            }
        };
        let _ = std::fs::remove_dir_all(&staging);
        result
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        if !valid_id(id) {
            return Err("invalid id".into());
        }
        let dir = self.root.join(id);
        if dir.is_dir() {
            std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
        }
        let mut s = self.state();
        s.disabled.retain(|d| d != id);
        self.save_state(&s)
    }

    pub fn set_enabled(&self, id: &str, enabled: bool) -> Result<(), String> {
        if !valid_id(id) || !self.root.join(id).is_dir() {
            return Err("not installed".into());
        }
        let mut s = self.state();
        s.disabled.retain(|d| d != id);
        if !enabled {
            s.disabled.push(id.into());
        }
        self.save_state(&s)
    }

    /// Parsed LUT for preview; only files inside the plugins folder.
    pub fn lut(&self, path: &Path) -> Result<Cube, String> {
        let root = self.root.canonicalize().map_err(|_| "no plugins installed".to_string())?;
        let file = path.canonicalize().map_err(|_| "LUT file not found".to_string())?;
        if !file.starts_with(&root) || !file.extension().is_some_and(|e| e.eq_ignore_ascii_case("cube")) {
            return Err("not a plugin LUT".into());
        }
        parse_cube(&std::fs::read_to_string(&file).map_err(|e| e.to_string())?)
    }
}

fn walk(dir: &Path, f: &mut dyn FnMut(&Path, u64) -> Result<(), String>) -> Result<(), String> {
    for e in std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let ft = e.file_type().map_err(|e| e.to_string())?;
        if ft.is_symlink() {
            return Err("packs can't contain links".into());
        } else if ft.is_dir() {
            walk(&e.path(), f)?;
        } else {
            f(&e.path(), e.metadata().map(|m| m.len()).unwrap_or(0))?;
        }
    }
    Ok(())
}

fn dir_bytes(dir: &Path) -> u64 {
    let mut n = 0;
    let _ = walk(dir, &mut |_, len| {
        n += len;
        Ok(())
    });
    n
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    walk(from, &mut |p, _| {
        let dest = to.join(p.strip_prefix(from).unwrap());
        std::fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string())?;
        std::fs::copy(p, &dest).map(|_| ()).map_err(|e| e.to_string())
    })
}

/// Extracts a pack archive; returns the folder holding `manifest.json` (the root or a single
/// top-level folder). Rejects traversal, links, odd file types and zip bombs.
fn unzip(path: &Path, staging: &Path) -> Result<PathBuf, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("not a valid pack archive: {e}"))?;
    if zip.len() > MAX_FILES * 2 {
        return Err("the pack is too large".into());
    }
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if entry.is_dir() {
            continue;
        }
        if entry.is_symlink() {
            return Err("packs can't contain links".into());
        }
        let rel = entry.enclosed_name().and_then(|p| safe_rel(&p.to_string_lossy().replace('\\', "/")).map(|_| p));
        let rel = rel.ok_or_else(|| format!("file not allowed in a pack: {name}"))?;
        if entry.size() > MAX_FILE_BYTES {
            return Err("the pack is too large".into());
        }
        let dest = staging.join(rel);
        std::fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string())?;
        let mut out = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
        let mut limited = (&mut entry).take(MAX_FILE_BYTES + 1);
        let n = std::io::copy(&mut limited, &mut out).map_err(|e| e.to_string())?;
        total += n;
        if n > MAX_FILE_BYTES || total > MAX_PACK_BYTES {
            return Err("the pack is too large".into());
        }
    }
    if staging.join("manifest.json").is_file() {
        return Ok(staging.to_path_buf());
    }
    let dirs: Vec<PathBuf> = std::fs::read_dir(staging).map_err(|e| e.to_string())?.flatten().map(|e| e.path()).collect();
    match dirs.as_slice() {
        [only] if only.join("manifest.json").is_file() => Ok(only.clone()),
        _ => Err("manifest.json not found in the pack".into()),
    }
}

fn slug(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out = out.trim_end_matches('-').chars().take(40).collect::<String>();
    if out.len() < 2 { "lut".into() } else { out }
}

/// A bare `.cube` becomes a one-LUT pack `lut.<name>`.
fn wrap_cube(path: &Path, staging: &Path) -> Result<(), String> {
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    parse_cube(&text)?;
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("LUT");
    let title = text.lines().find_map(|l| l.trim().strip_prefix("TITLE").map(|t| t.trim().trim_matches('"').to_string())).filter(|t| !t.is_empty());
    let name: String = title.unwrap_or_else(|| stem.to_string()).chars().take(48).collect();
    let id = slug(stem);
    std::fs::write(staging.join(format!("{id}.cube")), &text).map_err(|e| e.to_string())?;
    let m = Manifest {
        format: FORMAT.into(),
        id: format!("lut.{id}"),
        name: name.clone(),
        version: "1".into(),
        author: String::new(),
        license: "unknown".into(),
        homepage: None,
        description: "Imported .cube LUT".into(),
        thumbnail: None,
        effects: vec![],
        animations: vec![],
        luts: vec![LutEntry { id: id.replace('.', "-"), name, file: format!("{id}.cube") }],
        text_presets: vec![],
    };
    std::fs::write(staging.join("manifest.json"), serde_json::to_vec_pretty(&m).unwrap()).map_err(|e| e.to_string())
}

/// The kind of an unnamed file from its first bytes: "zip" or "cube".
fn sniff(path: &Path) -> Option<String> {
    use std::io::Read;
    let mut head = vec![0u8; 64 * 1024];
    let n = std::fs::File::open(path).ok()?.read(&mut head).ok()?;
    head.truncate(n);
    if head.starts_with(b"PK\x03\x04") {
        return Some("zip".into());
    }
    let text = String::from_utf8_lossy(&head);
    text.contains("LUT_3D_SIZE").then(|| "cube".into())
}

pub const CATALOG_URL: &str = "https://raw.githubusercontent.com/sxmsoft/xenocut/main/catalog/index.json";

/// The pack catalog JSON. `XENOCUT_CATALOG` (an https URL or a local file) overrides it for tests.
pub fn fetch_catalog() -> Result<Value, String> {
    let source = std::env::var("XENOCUT_CATALOG").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| CATALOG_URL.to_string());
    let text = if source.starts_with("https://") {
        let client = reqwest::blocking::Client::builder().user_agent("xenocut").timeout(std::time::Duration::from_secs(20)).build().map_err(|e| e.to_string())?;
        let resp = client.get(&source).send().map_err(|e| format!("catalog unreachable: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("catalog returned {}", resp.status()));
        }
        resp.text().map_err(|e| e.to_string())?
    } else {
        std::fs::read_to_string(&source).map_err(|e| format!("catalog {source}: {e}"))?
    };
    if text.len() > 4 << 20 {
        return Err("catalog too large".into());
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("catalog: {e}"))?;
    if v.get("format").and_then(|f| f.as_str()) != Some("xenocut-catalog/1") {
        return Err("unexpected catalog format".into());
    }
    Ok(v)
}

/// Downloads a catalog pack (https only, sha256 required) and installs it.
pub fn install_url(store: &Store, url: &str, sha256: &str) -> Result<Installed, String> {
    // Test catalogs (XENOCUT_CATALOG pointing at a file) may list local packs.
    if !url.starts_with("https://") && std::env::var("XENOCUT_CATALOG").is_ok_and(|c| !c.starts_with("https://")) {
        let path = Path::new(url);
        let digest: String = Sha256::digest(std::fs::read(path).map_err(|e| e.to_string())?).iter().map(|b| format!("{b:02x}")).collect();
        if !digest.eq_ignore_ascii_case(sha256) {
            return Err("the download did not match the catalog checksum".into());
        }
        return store.install_path(path);
    }
    if !url.starts_with("https://") {
        return Err("catalog packs must come over https".into());
    }
    if sha256.len() != 64 || !sha256.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("catalog entry has no valid sha256".into());
    }
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("xenocut")
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client.get(url).send().map_err(|e| format!("download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download returned {}", resp.status()));
    }
    std::fs::create_dir_all(&store.root).map_err(|e| e.to_string())?;
    let tmp = store.root.join(".download.xcpack");
    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    let mut got = 0u64;
    loop {
        let n = resp.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        got += n as u64;
        if got > MAX_PACK_BYTES {
            let _ = std::fs::remove_file(&tmp);
            return Err("the pack is too large".into());
        }
        hasher.update(&buf[..n]);
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
    }
    drop(file);
    let digest: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if !digest.eq_ignore_ascii_case(sha256) {
        let _ = std::fs::remove_file(&tmp);
        return Err("the download did not match the catalog checksum".into());
    }
    let result = store.install_path(&tmp);
    let _ = std::fs::remove_file(&tmp);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("xc-plugins-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn identity_cube(n: usize) -> String {
        let mut s = format!("TITLE \"Ident\"\nLUT_3D_SIZE {n}\n");
        for b in 0..n {
            for g in 0..n {
                for r in 0..n {
                    let f = |v: usize| v as f32 / (n - 1) as f32;
                    s += &format!("{} {} {}\n", f(r), f(g), f(b));
                }
            }
        }
        s
    }

    fn manifest() -> Value {
        serde_json::json!({
            "format": FORMAT, "id": "test.pack", "name": "Test", "version": "1.0.0", "license": "CC0-1.0",
            "effects": [{"id": "dream", "name": "Dream", "category": "look", "stack": [["blur", 0.3], ["brightness", 0.2]]}],
            "animations": [{"id": "drop", "name": "Drop", "slot": "in", "spec": {"curve": "back", "alpha": true, "ty": -0.3}}],
            "luts": [{"id": "ident", "name": "Ident", "file": "luts/ident.cube"}],
            "textPresets": [{"id": "pop", "name": "Pop", "style": {"color": "#ffcc00", "stroke": 6}}]
        })
    }

    fn write_pack(dir: &Path, m: &Value) {
        std::fs::create_dir_all(dir.join("luts")).unwrap();
        std::fs::write(dir.join("manifest.json"), serde_json::to_vec(m).unwrap()).unwrap();
        std::fs::write(dir.join("luts/ident.cube"), identity_cube(2)).unwrap();
    }

    #[test]
    fn ids_and_paths() {
        assert!(valid_id("xenocut.film-luts"));
        assert!(!valid_id("Bad Id") && !valid_id("../x") && !valid_id("x"));
        assert!(safe_rel("luts/a.cube").is_some());
        for bad in ["../a.cube", "/etc/a.cube", "a.so", "a.js", "C:\\a.cube", "a/b/c/d/e.png"] {
            assert!(safe_rel(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn cube_parsing() {
        let c = parse_cube(&identity_cube(3)).unwrap();
        assert_eq!((c.size, c.data.len()), (3, 81));
        assert_eq!(&c.data[3..6], &[0.5, 0.0, 0.0]);
        assert!(parse_cube("LUT_3D_SIZE 2\n0 0 0\n").is_err());
        assert!(parse_cube("LUT_1D_SIZE 16\n").is_err());
        assert!(parse_cube("LUT_3D_SIZE 2\nfoo 1 2\n").is_err());
    }

    #[test]
    fn validation_rejects_code_and_unknown_kinds() {
        let ok: Manifest = serde_json::from_value(manifest()).unwrap();
        assert_eq!(validate(&ok, None), Ok(()));
        let mut m = manifest();
        m["effects"][0]["stack"][0][0] = "exec".into();
        assert!(validate(&serde_json::from_value(m).unwrap(), None).is_err());
        let mut m = manifest();
        m["animations"][0]["spec"]["fx"] = serde_json::json!([["shell", 1.0]]);
        assert!(validate(&serde_json::from_value(m).unwrap(), None).is_err());
        let mut m = manifest();
        m["luts"][0]["file"] = "../../x.cube".into();
        assert!(validate(&serde_json::from_value(m).unwrap(), None).is_err());
        let mut m = manifest();
        m["format"] = "other/2".into();
        assert!(validate(&serde_json::from_value(m).unwrap(), None).is_err());
        let mut m = manifest();
        m["animations"][0]["spec"]["opacity"] = true.into();
        assert!(validate(&serde_json::from_value(m).unwrap(), None).is_err());
    }

    #[test]
    fn install_list_toggle_remove() {
        let base = tmp("store");
        let src = base.join("src");
        write_pack(&src, &manifest());
        let store = Store::new(base.join("plugins"));
        let p = store.install_path(&src).unwrap();
        assert!(p.enabled && p.manifest.id == "test.pack");
        assert_eq!(store.list().len(), 1);
        store.set_enabled("test.pack", false).unwrap();
        assert!(!store.list()[0].enabled);
        let lut = store.lut(&store.root.join("test.pack/luts/ident.cube")).unwrap();
        assert_eq!(lut.size, 2);
        assert!(store.lut(&src.join("luts/ident.cube")).is_err(), "only plugin-folder LUTs");
        store.remove("test.pack").unwrap();
        assert!(store.list().is_empty());
    }

    #[test]
    fn zip_install_and_traversal() {
        let base = tmp("zip");
        let store = Store::new(base.join("plugins"));
        let make = |path: &Path, files: &[(&str, &[u8])]| {
            let mut z = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
            for (name, data) in files {
                z.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
                z.write_all(data).unwrap();
            }
            z.finish().unwrap();
        };
        let good = base.join("good.xcpack");
        let man = serde_json::to_vec(&manifest()).unwrap();
        let cube = identity_cube(2);
        make(&good, &[("pack/manifest.json", &man), ("pack/luts/ident.cube", cube.as_bytes())]);
        assert_eq!(store.install_path(&good).unwrap().manifest.id, "test.pack");
        let evil = base.join("evil.xcpack");
        make(&evil, &[("manifest.json", &man), ("../../escape.cube", cube.as_bytes())]);
        assert!(store.install_path(&evil).is_err());
        assert!(!base.join("escape.cube").exists());
        let code = base.join("code.xcpack");
        make(&code, &[("manifest.json", &man), ("luts/ident.cube", cube.as_bytes()), ("run.sh", b"rm -rf /")]);
        assert!(store.install_path(&code).is_err());
    }

    #[test]
    fn baked_lut_mixes_with_identity() {
        let mut c = parse_cube(&identity_cube(2)).unwrap();
        c.data.iter_mut().for_each(|v| *v = 1.0 - *v);
        let half = parse_cube(&bake_cube(&c, 0.5)).unwrap();
        assert!(half.data.iter().all(|v| (v - 0.5).abs() < 1e-5));
        let full = parse_cube(&bake_cube(&c, 1.0)).unwrap();
        assert_eq!(full.data, c.data);
        let base = tmp("bake");
        let f = base.join("x.cube");
        std::fs::write(&f, identity_cube(2)).unwrap();
        let filter = lut_filter(&f.to_string_lossy(), 1.0).unwrap().unwrap();
        assert!(filter.starts_with("lut3d=file='") && filter.ends_with(":interp=tetrahedral"));
        assert_eq!(lut_filter(&f.to_string_lossy(), 0.0), Ok(None));
    }

    #[test]
    fn unnamed_files_are_sniffed() {
        let base = tmp("sniff");
        let file = base.join("42");
        std::fs::write(&file, identity_cube(2)).unwrap();
        let store = Store::new(base.join("plugins"));
        assert_eq!(store.install_path(&file).unwrap().manifest.luts.len(), 1);
        let junk = base.join("43");
        std::fs::write(&junk, "hello").unwrap();
        assert!(store.install_path(&junk).is_err());
    }

    #[test]
    fn bare_cube_becomes_a_pack() {
        let base = tmp("cube");
        let file = base.join("Teal Orange.cube");
        std::fs::write(&file, identity_cube(2)).unwrap();
        let store = Store::new(base.join("plugins"));
        let p = store.install_path(&file).unwrap();
        assert_eq!(p.manifest.id, "lut.teal-orange");
        assert_eq!(p.manifest.luts[0].name, "Ident");
    }

    /// Every pack in the published catalog installs, and its index entry matches the file.
    #[test]
    fn catalog_packs_install() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../catalog");
        let index: Value = serde_json::from_str(&std::fs::read_to_string(root.join("index.json")).unwrap()).unwrap();
        let store = Store::new(tmp("catalog").join("plugins"));
        let packs = index["packs"].as_array().unwrap();
        assert!(packs.len() >= 5);
        for e in packs {
            let name = e["url"].as_str().unwrap().rsplit('/').next().unwrap();
            let file = root.join("packs").join(name);
            let data = std::fs::read(&file).unwrap();
            let digest: String = Sha256::digest(&data).iter().map(|b| format!("{b:02x}")).collect();
            assert_eq!(digest, e["sha256"].as_str().unwrap(), "{name}");
            assert_eq!(data.len() as u64, e["bytes"].as_u64().unwrap());
            let p = store.install_path(&file).unwrap_or_else(|err| panic!("{name}: {err}"));
            assert_eq!(p.manifest.id, e["id"].as_str().unwrap());
            assert_eq!(p.manifest.license, "CC0-1.0");
            for lut in &p.manifest.luts {
                let cube = store.lut(&Path::new(&p.dir).join(&lut.file)).unwrap();
                assert_eq!(cube.size, 25);
            }
        }
        assert_eq!(store.list().len(), packs.len());
    }
}
