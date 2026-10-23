mod audio;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            audio::commands::audio_separate_stems,
            audio::commands::audio_import_music,
            audio::commands::audio_mix_render,
        ])
        .run(tauri::generate_context!())
        .expect("error while running XenoCut");
}
