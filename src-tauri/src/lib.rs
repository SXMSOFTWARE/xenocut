pub mod app;
pub mod audio;
pub mod content_import;
pub mod diag;
pub mod effects;
pub mod grade;
pub mod export;
pub mod media;
pub mod mediaserver;
pub mod project;
pub mod subtitles;
pub mod textlayer;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let handle = app.handle();
            diag::init_log(handle);
            textlayer::clear_stale(&app::cache_root(handle));
            let roots = vec![app::cache_root(handle), app::audio_root(handle)];
            match mediaserver::start(roots) {
                Ok(server) => diag::log("info", &format!("media server on {}", server.base_url().split('/').take(3).collect::<Vec<_>>().join("/"))),
                Err(err) => diag::log("error", &format!("media server failed: {err}")),
            }
            diag::log("info", &format!("XenoCut {} started on {}", handle.package_info().version, std::env::consts::OS));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app::app_info,
            content_import::import_content_uris,
            diag::client_log,
            diag::media_transport,
            diag::media_allow,
            diag::autotest_exit,
            app::store_read,
            app::store_write,
            app::paths_exist,
            app::project_new_path,
            app::project_save,
            app::project_load,
            app::media_probe,
            app::media_assets,
            app::media_proxy,
            app::cache_info,
            app::cache_clear,
            app::export_start,
            app::export_cancel,
            app::text_layer_begin,
            app::text_layer_frame,
            app::text_layer_finish,
            app::text_layer_discard,
            app::model_status,
            app::model_download,
            app::model_delete,
            audio::commands::audio_separate_stems,
            audio::commands::audio_import_music,
            audio::commands::audio_mix_render,
            audio::commands::audio_cancel,
            subtitles::commands::subtitle_models,
            subtitles::commands::subtitle_model_delete,
            subtitles::commands::subtitle_transcribe,
            subtitles::commands::subtitle_cancel,
            subtitles::commands::subtitle_read,
            subtitles::commands::subtitle_write,
        ])
        .run(tauri::generate_context!())
        .expect("error while running XenoCut");
}
