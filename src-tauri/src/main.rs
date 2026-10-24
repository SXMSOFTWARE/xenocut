#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `xenocut --fxhost`: the isolated effect plug-in host (see fxhost.rs).
    #[cfg(target_os = "linux")]
    if std::env::args().nth(1).as_deref() == Some("--fxhost") {
        std::process::exit(xenocut_lib::fxhost::helper_main());
    }
    xenocut_lib::run()
}
