//! Headless harness around the real backend, used for verification without a window.
//!
//!   cargo run --example harness -- assets <cache_dir> <manifest.json> <files...>
//!       probes files and builds thumbnails/filmstrips/waveforms (same code as the app)
//!   cargo run --example harness -- export <project.xcut> <out.mp4> [width height fps]
//!       renders a project exactly like the Export dialog does
//!
//! Set XENOCUT_FFMPEG to the ffmpeg binary (e.g. binaries/ffmpeg-x86_64-unknown-linux-gnu).
use std::path::{Path, PathBuf};
use std::time::Instant;

use xenocut_lib::audio::traits::ProgressSink;
use xenocut_lib::export::{self, ExportOptions};
use xenocut_lib::media;
use xenocut_lib::project::Project;

struct Print;
impl ProgressSink for Print {
    fn report(&self, amount: f32, message: &str) {
        eprint!("\r{message}: {:>3.0}%   ", amount * 100.0);
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("assets") if args.len() >= 4 => assets(Path::new(&args[1]), Path::new(&args[2]), &args[3..]),
        Some("export") if args.len() >= 3 => run_export(&args[1], &args[2], &args[3..]),
        _ => {
            eprintln!("usage: harness assets <cache_dir> <manifest.json> <files...> | export <project.xcut> <out.mp4> [w h fps]");
            std::process::exit(2);
        }
    }
}

fn assets(cache: &Path, manifest: &Path, files: &[String]) {
    std::fs::create_dir_all(cache).expect("cache dir");
    let mut items = Vec::new();
    let mut assets = serde_json::Map::new();
    for file in files {
        let path = PathBuf::from(file).canonicalize().expect("file exists");
        let info = media::probe(&path).expect("probe");
        let a = media::assets(cache, &path, info.kind, info.duration, info.has_audio);
        eprintln!("{} -> {:?} {:.2}s strip={:?} wave={:?}", info.name, info.kind, info.duration, a.strip.is_some(), a.wave.is_some());
        assets.insert(info.path.clone(), serde_json::to_value(&a).unwrap());
        items.push(serde_json::to_value(&info).unwrap());
    }
    let json = serde_json::json!({ "items": items, "assets": assets });
    std::fs::write(manifest, serde_json::to_string_pretty(&json).unwrap()).expect("write manifest");
    println!("{}", manifest.display());
}

fn run_export(project: &str, out: &str, rest: &[String]) {
    let text = std::fs::read_to_string(project).expect("read project");
    let project: Project = serde_json::from_str(&text).expect("parse project");
    let num = |i: usize, d: u32| rest.get(i).and_then(|s| s.parse().ok()).unwrap_or(d);
    let options = ExportOptions {
        output_path: out.to_string(),
        width: num(0, project.settings.width),
        height: num(1, project.settings.height),
        fps: num(2, project.settings.fps),
        quality: export::Quality::Balanced,
    };
    let start = Instant::now();
    let path = export::run(&project, &options, &Print).expect("export");
    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    eprintln!();
    println!("{} {} bytes in {:.1}s", path.display(), bytes, start.elapsed().as_secs_f64());
}
