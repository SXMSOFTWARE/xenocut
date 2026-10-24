//! Native effect plug-ins: OpenFX bundles and frei0r libraries (desktop Linux).
//!
//! Plug-ins are third-party machine code, so they never run inside the editor. The same binary
//! started as `xenocut --fxhost` loads them (the C++ host in `src-tauri/fxhost/`) and answers
//! line-delimited JSON on stdin/stdout; frames travel through a file in /dev/shm. This module
//! supervises that helper: it restarts it after a crash or a hang, blames the plug-in that was
//! running, and blocks a plug-in after its second crash. Blocks are saved, so a broken library
//! can't take the scan down at every start.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, VecDeque};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

/// One native effect on a clip, applied before the built-in effects.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeFx {
    /// `ofx:<plug-in identifier>` or `frei0r:<library name>`.
    pub id: String,
    /// Values by parameter name: number arrays (bool, int, double, choice, colour, 2D) or text.
    #[serde(default)]
    pub params: serde_json::Map<String, Value>,
    #[serde(default = "yes")]
    pub enabled: bool,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub id: String,
    /// "ofx" or "frei0r".
    pub kind: String,
    pub label: String,
    pub group: String,
    pub description: String,
    /// Bundle folder or library file.
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    /// False where the host isn't built (Windows, macOS, Android).
    pub available: bool,
    pub plugins: Vec<PluginInfo>,
    /// Blocked plug-ins and files with the reason.
    pub blocked: BTreeMap<String, String>,
    /// Folders searched, in order.
    pub dirs: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Entry point of `xenocut --fxhost` (never returns on Linux: the host ends the process).
#[cfg(target_os = "linux")]
pub fn helper_main() -> i32 {
    unsafe extern "C" {
        fn xc_fxhost_main() -> i32;
    }
    unsafe { xc_fxhost_main() }
}

pub fn supported() -> bool {
    cfg!(target_os = "linux")
}

// ---------- configuration and the saved block list ----------

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct Blocklist {
    /// Plug-in id or file path -> reason.
    #[serde(default)]
    blocked: BTreeMap<String, String>,
    /// Crash count per plug-in id.
    #[serde(default)]
    crashes: BTreeMap<String, u32>,
}

#[derive(Debug, Clone)]
struct Config {
    command: Vec<String>,
    env: Vec<(String, String)>,
    /// App-owned folder with `ofx/` and `frei0r/` for user-installed plug-ins.
    user_root: Option<PathBuf>,
    state_file: Option<PathBuf>,
    system_dirs: bool,
}

struct Shared {
    config: Option<Config>,
    block: Blocklist,
}

static SHARED: Mutex<Shared> = Mutex::new(Shared {
    config: None,
    block: Blocklist {
        blocked: BTreeMap::new(),
        crashes: BTreeMap::new(),
    },
});

/// Called once at start-up: plug-in folders under `user_root`, blocks saved in `state_file`.
pub fn configure(user_root: &Path, state_file: &Path) {
    let exe = std::env::current_exe()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| "xenocut".into());
    let block = std::fs::read_to_string(state_file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let mut shared = SHARED.lock().unwrap();
    shared.config = Some(Config {
        command: vec![exe, "--fxhost".into()],
        env: vec![],
        user_root: Some(user_root.to_path_buf()),
        state_file: Some(state_file.to_path_buf()),
        system_dirs: true,
    });
    shared.block = block;
}

fn config() -> Option<Config> {
    SHARED.lock().unwrap().config.clone()
}

fn blocklist() -> Blocklist {
    SHARED.lock().unwrap().block.clone()
}

fn save_block(shared: &Shared) {
    if let Some(path) = shared.config.as_ref().and_then(|c| c.state_file.clone()) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(text) = serde_json::to_string_pretty(&shared.block) {
            let _ = std::fs::write(path, text);
        }
    }
}

fn block(key: &str, reason: &str) {
    let mut shared = SHARED.lock().unwrap();
    crate::diag::log("warn", &format!("fxhost: blocking {key}: {reason}"));
    shared.block.blocked.insert(key.into(), reason.into());
    save_block(&shared);
}

/// Count a crash; returns true when the plug-in is now blocked.
fn record_crash(id: &str, reason: &str) -> bool {
    let mut shared = SHARED.lock().unwrap();
    let n = {
        let n = shared.block.crashes.entry(id.into()).or_insert(0);
        *n += 1;
        *n
    };
    if n >= 2 {
        shared
            .block
            .blocked
            .insert(id.into(), format!("crashed {n} times ({reason})"));
    }
    save_block(&shared);
    n >= 2
}

/// Forget every block and crash count (the user asked to try again).
pub fn unblock_all() {
    let mut shared = SHARED.lock().unwrap();
    shared.block = Blocklist::default();
    save_block(&shared);
}

fn split_env(name: &str) -> Vec<PathBuf> {
    std::env::var_os(name)
        .map(|v| std::env::split_paths(&v).collect())
        .unwrap_or_default()
}

fn ofx_dirs(cfg: &Config) -> Vec<PathBuf> {
    let mut dirs = split_env("OFX_PLUGIN_PATH");
    if let Some(root) = &cfg.user_root {
        dirs.push(root.join("ofx"));
    }
    if cfg.system_dirs {
        dirs.push("/usr/OFX/Plugins".into());
        dirs.push("/usr/local/OFX/Plugins".into());
    }
    dirs
}

fn frei0r_dirs(cfg: &Config) -> Vec<PathBuf> {
    let mut dirs = split_env("FREI0R_PATH");
    if let Some(root) = &cfg.user_root {
        dirs.push(root.join("frei0r"));
    }
    if cfg.system_dirs {
        if let Some(home) = std::env::var_os("HOME") {
            dirs.push(PathBuf::from(home).join(".frei0r-1/lib"));
        }
        for d in [
            "/usr/local/lib/frei0r-1",
            "/usr/lib/frei0r-1",
            "/usr/lib64/frei0r-1",
            "/usr/lib/x86_64-linux-gnu/frei0r-1",
            "/usr/lib/aarch64-linux-gnu/frei0r-1",
        ] {
            dirs.push(d.into());
        }
    }
    dirs
}

/// Entries of `dirs` whose name ends in `suffix`; the first folder wins on a name clash.
fn collect(dirs: &[PathBuf], suffix: &str, want_dir: bool) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = vec![];
    for dir in dirs {
        let Ok(rd) = std::fs::read_dir(dir) else {
            continue;
        };
        let mut names: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
        names.sort();
        for path in names {
            let Some(name) = path.file_name().and_then(|n| n.to_str()).map(str::to_string) else {
                continue;
            };
            if !name.ends_with(suffix) || path.is_dir() != want_dir || !seen.insert(name) {
                continue;
            }
            out.push(path.display().to_string());
        }
    }
    out
}

// ---------- the helper process ----------

enum CallError {
    /// The helper died or hung; carries the reason and its last stderr lines.
    Crashed(String),
    /// The helper answered with an error.
    Failed(String),
}

impl CallError {
    fn text(&self) -> String {
        match self {
            CallError::Crashed(s) | CallError::Failed(s) => s.clone(),
        }
    }
}

struct Shm {
    path: PathBuf,
    file: std::fs::File,
    len: u64,
}

struct Helper {
    child: Child,
    stdin: ChildStdin,
    lines: mpsc::Receiver<String>,
    tail: Arc<Mutex<VecDeque<String>>>,
    shm: Option<Shm>,
    seq: u64,
}

static SHM_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

impl Helper {
    fn spawn(cfg: &Config) -> Result<Helper, String> {
        let mut cmd = Command::new(&cfg.command[0]);
        cmd.args(&cfg.command[1..])
            .envs(cfg.env.iter().map(|(k, v)| (k, v)))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("could not start the effect host: {e}"))?;
        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stderr = child.stderr.take().ok_or("no stderr")?;
        let (tx, lines) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        let tail = Arc::new(Mutex::new(VecDeque::new()));
        let t = tail.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines() {
                let Ok(line) = line else { break };
                if std::env::var_os("XENOCUT_FX_DEBUG").is_some() {
                    eprintln!("{line}");
                }
                let mut t = t.lock().unwrap();
                if t.len() >= 64 {
                    t.pop_front();
                }
                t.push_back(line);
            }
        });
        Ok(Helper {
            child,
            stdin,
            lines,
            tail,
            shm: None,
            seq: 0,
        })
    }

    fn tail(&self) -> Vec<String> {
        // Give the stderr reader a moment to drain after a crash.
        std::thread::sleep(Duration::from_millis(30));
        self.tail.lock().unwrap().iter().cloned().collect()
    }

    /// The library the helper was loading when it died, from its "[fxhost] loading" lines.
    fn blamed_file(&self) -> Option<String> {
        self.tail()
            .iter()
            .rev()
            .find_map(|l| l.strip_prefix("[fxhost] loading ").map(str::to_string))
    }

    fn call(&mut self, mut req: Value, timeout: Duration) -> Result<Value, CallError> {
        self.seq += 1;
        req["seq"] = json!(self.seq);
        let line = format!("{req}\n");
        if self.stdin.write_all(line.as_bytes()).and_then(|_| self.stdin.flush()).is_err() {
            return Err(self.died("the effect host is gone"));
        }
        let deadline = Instant::now() + timeout;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match self.lines.recv_timeout(left) {
                Ok(line) => {
                    // Anything that isn't our JSON (a plug-in writing to stdout before the
                    // helper redirected it) is skipped.
                    let at = line.find('{').unwrap_or(0);
                    let Ok(v) = serde_json::from_str::<Value>(&line[at..]) else {
                        continue;
                    };
                    if v["seq"].as_u64() != Some(self.seq) {
                        continue;
                    }
                    return if v["ok"].as_bool() == Some(true) {
                        Ok(v)
                    } else {
                        Err(CallError::Failed(
                            v["error"].as_str().unwrap_or("effect failed").to_string(),
                        ))
                    };
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    let _ = self.child.kill();
                    let _ = self.child.wait();
                    return Err(CallError::Crashed(format!(
                        "no answer in {}s",
                        timeout.as_secs()
                    )));
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err(self.died("the effect host stopped"));
                }
            }
        }
    }

    fn died(&mut self, what: &str) -> CallError {
        let status = self.child.wait().map(|s| s.to_string()).unwrap_or_default();
        let tail = self.tail();
        let last = tail.last().cloned().unwrap_or_default();
        CallError::Crashed(format!("{what} ({status}) {last}").trim().to_string())
    }

    /// A shared frame buffer of at least `bytes` (input then output).
    fn shm(&mut self, bytes: usize) -> Result<&mut Shm, String> {
        let need = bytes as u64 * 2;
        if self.shm.as_ref().is_none_or(|s| s.len < need) {
            if let Some(old) = self.shm.take() {
                let _ = std::fs::remove_file(&old.path);
            }
            let n = SHM_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let path = PathBuf::from(format!("/dev/shm/xenocut-fx-{}-{n}", std::process::id()));
            let file = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(true)
                .open(&path)
                .map_err(|e| format!("frame buffer: {e}"))?;
            file.set_len(need).map_err(|e| format!("frame buffer: {e}"))?;
            self.shm = Some(Shm {
                path,
                file,
                len: need,
            });
        }
        Ok(self.shm.as_mut().unwrap())
    }
}

impl Drop for Helper {
    fn drop(&mut self) {
        let _ = self.stdin.write_all(b"{\"op\":\"quit\"}\n");
        let _ = self.stdin.flush();
        let until = Instant::now() + Duration::from_millis(800);
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if Instant::now() < until => std::thread::sleep(Duration::from_millis(10)),
                _ => {
                    let _ = self.child.kill();
                    let _ = self.child.wait();
                    break;
                }
            }
        }
        if let Some(shm) = self.shm.take() {
            let _ = std::fs::remove_file(shm.path);
        }
    }
}

// ---------- a session: one helper, restarted on demand ----------

const SCAN_TIMEOUT: Duration = Duration::from_secs(90);
const CALL_TIMEOUT: Duration = Duration::from_secs(20);

/// A supervised helper. The preview keeps one; every export starts its own.
#[derive(Default)]
pub struct Session {
    helper: Option<Helper>,
    catalog: Option<Catalog>,
    warned: std::collections::HashSet<String>,
}

impl Session {
    pub fn new() -> Self {
        Self::default()
    }

    /// The plug-ins on this machine (scanning on first use or when `rescan`).
    pub fn catalog(&mut self, rescan: bool) -> Catalog {
        if rescan {
            self.helper = None;
            self.catalog = None;
        }
        if let Err(e) = self.start() {
            let mut c = self.catalog.clone().unwrap_or_default();
            c.available = supported();
            c.error = Some(e);
            c.blocked = blocklist().blocked;
            return c;
        }
        let mut c = self.catalog.clone().unwrap_or_default();
        c.blocked = blocklist().blocked;
        c
    }

    fn start(&mut self) -> Result<(), String> {
        if self.helper.is_some() {
            return Ok(());
        }
        if !supported() {
            return Err("Native effect plug-ins are available on Linux".into());
        }
        let cfg = config().ok_or("effect host not configured")?;
        let (ofx_d, f0r_d) = (ofx_dirs(&cfg), frei0r_dirs(&cfg));
        // A crash while loading blames one file; drop it and try again. If nothing was blamed
        // (an OpenFX bundle), scan the bundles one by one to find the culprit.
        for _attempt in 0..6 {
            let blocked = blocklist().blocked;
            let ofx: Vec<String> = collect(&ofx_d, ".ofx.bundle", true)
                .into_iter()
                .filter(|p| !blocked.contains_key(p))
                .collect();
            let f0r: Vec<String> = collect(&f0r_d, ".so", false)
                .into_iter()
                .filter(|p| !blocked.contains_key(p))
                .collect();
            let mut helper = Helper::spawn(&cfg)?;
            match helper.call(json!({"op": "scan", "ofx": ofx, "frei0r": f0r}), SCAN_TIMEOUT) {
                Ok(reply) => {
                    self.catalog = Some(make_catalog(&reply, &blocked, &ofx_d, &f0r_d));
                    self.helper = Some(helper);
                    return Ok(());
                }
                Err(CallError::Failed(e)) => return Err(e),
                Err(CallError::Crashed(why)) => {
                    if let Some(file) = helper.blamed_file().filter(|f| f0r.contains(f)) {
                        drop(helper);
                        block(&file, &format!("crashed while loading: {why}"));
                        continue;
                    }
                    drop(helper);
                    let mut found = false;
                    for one in ofx.iter().chain(f0r.iter()) {
                        let (o, f): (Vec<&String>, Vec<&String>) = if one.ends_with(".ofx.bundle") {
                            (vec![one], vec![])
                        } else {
                            (vec![], vec![one])
                        };
                        let mut h = Helper::spawn(&cfg)?;
                        if let Err(CallError::Crashed(w)) =
                            h.call(json!({"op": "scan", "ofx": o, "frei0r": f}), SCAN_TIMEOUT)
                        {
                            block(one, &format!("crashed while loading: {w}"));
                            found = true;
                        }
                    }
                    if !found {
                        return Err(format!("the plug-in scan failed: {why}"));
                    }
                }
            }
        }
        Err("too many plug-ins crashed while loading".into())
    }

    fn label(&self, id: &str) -> String {
        self.catalog
            .as_ref()
            .and_then(|c| c.plugins.iter().find(|p| p.id == id))
            .map(|p| p.label.clone())
            .unwrap_or_else(|| id.to_string())
    }

    fn known(&self, id: &str) -> bool {
        self.catalog
            .as_ref()
            .is_some_and(|c| c.plugins.iter().any(|p| p.id == id))
    }

    /// Parameters and clips of one plug-in, as the helper reports them.
    pub fn describe(&mut self, id: &str) -> Result<Value, String> {
        self.start()?;
        if !self.known(id) {
            return Err(format!("{id} is not installed"));
        }
        let helper = self.helper.as_mut().unwrap();
        match helper.call(json!({"op": "describe", "id": id}), CALL_TIMEOUT) {
            Ok(v) => Ok(v),
            Err(e) => {
                if let CallError::Crashed(why) = &e {
                    self.helper = None;
                    record_crash(id, why);
                }
                Err(e.text())
            }
        }
    }

    /// Run `chain` over one RGBA frame (`w`×`h`, top row first) in place. A plug-in that
    /// fails or crashes is skipped (the frame passes through); the messages come back once
    /// per plug-in and session so the caller can tell the user.
    #[allow(clippy::too_many_arguments)]
    pub fn render(
        &mut self,
        chain: &[NativeFx],
        key: &str,
        frame: &mut [u8],
        w: u32,
        h: u32,
        full: (u32, u32),
        time: f64,
        fps: f64,
    ) -> Vec<String> {
        let mut notes = vec![];
        let bytes = w as usize * h as usize * 4;
        if frame.len() != bytes || bytes == 0 {
            return vec!["bad frame size".into()];
        }
        for (i, fx) in chain.iter().enumerate() {
            if !fx.enabled {
                continue;
            }
            if let Some(why) = blocklist().blocked.get(&fx.id) {
                self.note(&mut notes, &format!("blocked:{}", fx.id), format!("{} is blocked: {why}", fx.id));
                continue;
            }
            if let Err(e) = self.start() {
                self.note(&mut notes, "start", e);
                return notes;
            }
            if !self.known(&fx.id) {
                self.note(&mut notes, &fx.id, format!("{} is not installed", fx.id));
                continue;
            }
            let label = self.label(&fx.id);
            let helper = self.helper.as_mut().unwrap();
            let shm_path = match helper.shm(bytes) {
                Ok(shm) => {
                    let ok = shm.file.seek(SeekFrom::Start(0)).and_then(|_| shm.file.write_all(frame));
                    if let Err(e) = ok {
                        self.note(&mut notes, "shm", format!("frame buffer: {e}"));
                        return notes;
                    }
                    shm.path.display().to_string()
                }
                Err(e) => {
                    self.note(&mut notes, "shm", e);
                    return notes;
                }
            };
            let req = json!({
                "op": "render", "id": fx.id, "key": format!("{key}#{i}"), "params": fx.params,
                "shm": shm_path, "w": w, "h": h, "fullW": full.0.max(1), "fullH": full.1.max(1),
                "time": time, "fps": fps,
            });
            match helper.call(req, CALL_TIMEOUT) {
                Ok(_) => {
                    let shm = helper.shm.as_mut().unwrap();
                    let ok = shm
                        .file
                        .seek(SeekFrom::Start(bytes as u64))
                        .and_then(|_| shm.file.read_exact(frame));
                    if let Err(e) = ok {
                        self.note(&mut notes, "shm", format!("frame buffer: {e}"));
                        return notes;
                    }
                    // Video has no alpha: plug-ins that touch it must not punch holes.
                    for px in frame.chunks_exact_mut(4) {
                        px[3] = 255;
                    }
                }
                Err(CallError::Failed(e)) => {
                    self.note(&mut notes, &fx.id, format!("{label}: {e}"));
                }
                Err(CallError::Crashed(why)) => {
                    self.helper = None;
                    let blocked = record_crash(&fx.id, &why);
                    let msg = if blocked {
                        format!("{label} crashed again and was turned off ({why})")
                    } else {
                        format!("{label} crashed; the effect host was restarted ({why})")
                    };
                    // A crash is always worth telling, even a second one.
                    self.warned.remove(&fx.id);
                    self.note(&mut notes, &fx.id, msg);
                }
            }
        }
        notes
    }

    fn note(&mut self, notes: &mut Vec<String>, key: &str, msg: String) {
        if self.warned.insert(key.to_string()) {
            crate::diag::log("warn", &format!("fxhost: {msg}"));
            notes.push(msg);
        }
    }

    /// Release the plug-in instances under `key` (a clip that went away).
    pub fn drop_key(&mut self, key: &str) {
        if let Some(h) = self.helper.as_mut() {
            let _ = h.call(json!({"op": "drop", "key": key}), CALL_TIMEOUT);
        }
    }
}

fn make_catalog(
    reply: &Value,
    blocked: &BTreeMap<String, String>,
    ofx_d: &[PathBuf],
    f0r_d: &[PathBuf],
) -> Catalog {
    let mut plugins = vec![];
    let text = |v: &Value, k: &str| v[k].as_str().unwrap_or("").trim().to_string();
    for p in reply["ofx"]["plugins"].as_array().into_iter().flatten() {
        let id = format!("ofx:{}", text(p, "id"));
        if blocked.contains_key(&id) {
            continue;
        }
        plugins.push(PluginInfo {
            label: text(p, "label"),
            group: text(p, "group"),
            description: text(p, "description"),
            source: text(p, "bundle"),
            kind: "ofx".into(),
            id,
        });
    }
    for p in reply["frei0r"]["plugins"].as_array().into_iter().flatten() {
        let id = format!("frei0r:{}", text(p, "id"));
        if blocked.contains_key(&id) {
            continue;
        }
        let author = text(p, "author");
        plugins.push(PluginInfo {
            label: text(p, "label"),
            group: "frei0r".into(),
            description: if author.is_empty() {
                text(p, "description")
            } else {
                format!("{} ({author})", text(p, "description"))
            },
            source: text(p, "file"),
            kind: "frei0r".into(),
            id,
        });
    }
    plugins.sort_by(|a, b| {
        (a.group.to_lowercase(), a.label.to_lowercase()).cmp(&(b.group.to_lowercase(), b.label.to_lowercase()))
    });
    Catalog {
        available: true,
        plugins,
        blocked: BTreeMap::new(),
        dirs: ofx_d.iter().chain(f0r_d).map(|d| d.display().to_string()).collect(),
        error: None,
    }
}

// ---------- the preview session ----------

static PREVIEW: Mutex<Option<Session>> = Mutex::new(None);

pub fn with_preview<T>(f: impl FnOnce(&mut Session) -> T) -> T {
    let mut guard = PREVIEW.lock().unwrap_or_else(|e| e.into_inner());
    f(guard.get_or_insert_with(Session::new))
}

/// Preview frame request: `[u32 LE header length][JSON header][RGBA pixels]`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewHeader {
    pub key: String,
    pub chain: Vec<NativeFx>,
    pub w: u32,
    pub h: u32,
    pub full_w: u32,
    pub full_h: u32,
    pub time: f64,
    pub fps: f64,
}

pub fn split_preview(body: &[u8]) -> Result<(PreviewHeader, Vec<u8>), String> {
    if body.len() < 4 {
        return Err("short frame".into());
    }
    let n = u32::from_le_bytes([body[0], body[1], body[2], body[3]]) as usize;
    let head = body.get(4..4 + n).ok_or("short frame header")?;
    let header: PreviewHeader = serde_json::from_slice(head).map_err(|e| e.to_string())?;
    let pixels = body[4 + n..].to_vec();
    if pixels.len() != header.w as usize * header.h as usize * 4 {
        return Err("frame size does not match".into());
    }
    Ok((header, pixels))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// The test binary doubles as the helper: run with XENOCUT_FXHOST_CHILD=1 and this test
    /// selected, it enters the host loop instead of testing.
    #[test]
    fn fxhost_child_entry() {
        if std::env::var_os("XENOCUT_FXHOST_CHILD").is_some() {
            #[cfg(target_os = "linux")]
            helper_main();
        }
    }

    pub(crate) fn test_config(user_root: &Path) {
        let exe = std::env::current_exe().unwrap().display().to_string();
        let mut shared = SHARED.lock().unwrap();
        let env = vec![("XENOCUT_FXHOST_CHILD".to_string(), "1".to_string())];
        shared.config = Some(Config {
            command: vec![
                exe,
                "fxhost::tests::fxhost_child_entry".into(),
                "--exact".into(),
                "--nocapture".into(),
                "--test-threads=1".into(),
            ],
            env,
            user_root: Some(user_root.to_path_buf()),
            state_file: Some(user_root.join("fxhost.json")),
            system_dirs: false,
        });
        shared.block = Blocklist::default();
    }

    #[test]
    fn preview_body_round_trip() {
        let head = br#"{"key":"c","chain":[{"id":"frei0r:glow","params":{"Blur":[0.5]}}],"w":2,"h":1,"fullW":4,"fullH":2,"time":1.5,"fps":30}"#;
        let mut body = (head.len() as u32).to_le_bytes().to_vec();
        body.extend_from_slice(head);
        body.extend_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8]);
        let (h, px) = split_preview(&body).unwrap();
        assert_eq!((h.w, h.h, h.full_w, h.chain.len()), (2, 1, 4, 1));
        assert!(h.chain[0].enabled);
        assert_eq!(px.len(), 8);
        body.pop();
        assert!(split_preview(&body).is_err());
    }

    #[test]
    fn collect_prefers_the_first_folder() {
        let root = std::env::temp_dir().join(format!("xc-fx-collect-{}", std::process::id()));
        let (a, b) = (root.join("a"), root.join("b"));
        std::fs::create_dir_all(a.join("X.ofx.bundle")).unwrap();
        std::fs::create_dir_all(b.join("X.ofx.bundle")).unwrap();
        std::fs::write(b.join("glow.so"), b"").unwrap();
        std::fs::write(b.join("notes.txt"), b"").unwrap();
        let ofx = collect(&[a.clone(), b.clone()], ".ofx.bundle", true);
        assert_eq!(ofx, vec![a.join("X.ofx.bundle").display().to_string()]);
        assert_eq!(collect(&[a, b.clone()], ".so", false), vec![b.join("glow.so").display().to_string()]);
        let _ = std::fs::remove_dir_all(root);
    }

    /// Needs frei0r plug-ins (Debian: frei0r-plugins) and a Linux build; run with --ignored.
    /// One test so the shared configuration isn't raced.
    #[test]
    #[ignore]
    #[cfg(target_os = "linux")]
    fn helper_renders_and_survives_crashes() {
        let sys = Path::new("/usr/lib/frei0r-1");
        assert!(sys.is_dir(), "frei0r plug-ins not installed");
        let root = std::env::temp_dir().join(format!("xc-fx-test-{}", std::process::id()));
        let lib = root.join("frei0r");
        std::fs::create_dir_all(&lib).unwrap();
        for f in ["invert0r.so", "glow.so"] {
            std::os::unix::fs::symlink(sys.join(f), lib.join(f)).unwrap();
        }
        // A "plug-in" that crashes on load, and one that isn't a library at all.
        std::fs::write(lib.join("broken.so"), b"not an elf").unwrap();
        test_config(&root);
        let mut s = Session::new();
        let cat = s.catalog(false);
        assert_eq!(cat.error, None);
        let ids: Vec<&str> = cat.plugins.iter().map(|p| p.id.as_str()).collect();
        assert!(ids.contains(&"frei0r:invert0r") && ids.contains(&"frei0r:glow"), "{ids:?}");

        let d = s.describe("frei0r:glow").unwrap();
        assert_eq!(d["params"][0]["name"], "Blur");

        let (w, h) = (17u32, 9u32);
        let mut frame: Vec<u8> = (0..w * h).flat_map(|i| [i as u8, 100, 200, 255]).collect();
        let fx = NativeFx {
            id: "frei0r:invert0r".into(),
            params: Default::default(),
            enabled: true,
        };
        let notes = s.render(&[fx.clone()], "t", &mut frame, w, h, (w, h), 0.0, 30.0);
        assert!(notes.is_empty(), "{notes:?}");
        assert_eq!(&frame[4..8], &[254, 155, 55, 255]);

        // Kill the helper behind the session's back: the next render reports it, restarts, and
        // a second crash blocks the plug-in.
        for round in 0..2 {
            let pid = s.helper.as_ref().unwrap().child.id();
            unsafe { libc_kill(pid as i32, 9) };
            std::thread::sleep(Duration::from_millis(50));
            let notes = s.render(&[fx.clone()], "t", &mut frame, w, h, (w, h), 0.0, 30.0);
            assert_eq!(notes.len(), 1, "{notes:?}");
            assert!(notes[0].contains(if round == 0 { "restarted" } else { "turned off" }), "{notes:?}");
            if round == 0 {
                // After a restart it works again.
                let before = frame.clone();
                assert!(s.render(&[fx.clone()], "t", &mut frame, w, h, (w, h), 0.0, 30.0).is_empty());
                assert_ne!(before, frame);
            }
        }
        assert!(blocklist().blocked.contains_key("frei0r:invert0r"));
        let saved = std::fs::read_to_string(root.join("fxhost.json")).unwrap();
        assert!(saved.contains("frei0r:invert0r"));
        // Blocked: passes through untouched.
        let before = frame.clone();
        let notes = s.render(&[fx], "t", &mut frame, w, h, (w, h), 0.0, 30.0);
        assert!(notes[0].contains("blocked"));
        assert_eq!(before, frame);
        unblock_all();
        drop(s);
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    unsafe extern "C" {
        #[link_name = "kill"]
        fn libc_kill(pid: i32, sig: i32) -> i32;
    }
}
