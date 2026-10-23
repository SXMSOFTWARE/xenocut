pub mod app;
pub mod audio;
pub mod export;
pub mod media;
pub mod project;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            app::app_info,
            app::store_read,
            app::store_write,
            app::paths_exist,
            app::project_new_path,
            app::project_save,
            app::project_load,
            app::media_probe,
            app::media_assets,
            app::cache_info,
            app::cache_clear,
            app::export_start,
            app::export_cancel,
            app::model_status,
            app::model_download,
            app::model_delete,
            audio::commands::audio_separate_stems,
            audio::commands::audio_import_music,
            audio::commands::audio_mix_render,
            audio::commands::audio_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running XenoCut");
}
