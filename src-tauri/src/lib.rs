const CATEGORY_FOLDERS: [&str; 8] = [
    "Imagens",
    "Vídeos",
    "Áudios",
    "Documentos",
    "Compactados",
    "Aplicativos",
    "Torrents",
    "Outros",
];

#[tauri::command]
fn create_category_folders(root_path: String) -> Result<Vec<String>, String> {
    let trimmed = root_path.trim();
    if trimmed.is_empty() {
        return Err("A pasta principal não pode ficar vazia.".into());
    }
    let root = std::path::PathBuf::from(trimmed);
    std::fs::create_dir_all(&root)
        .map_err(|error| format!("Não foi possível criar a pasta principal: {error}"))?;
    CATEGORY_FOLDERS
        .iter()
        .map(|category| {
            let path = root.join(category);
            std::fs::create_dir_all(&path)
                .map_err(|error| format!("Não foi possível criar '{}': {error}", path.display()))?;
            Ok(path.to_string_lossy().into_owned())
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }
            let data_dir = app.path().app_data_dir()?;
            let database =
                database::Database::initialize(&data_dir).map_err(std::io::Error::other)?;
            let recovered_ids = database.recovered_ids().to_vec();
            let runtime = download::runtime::DownloadRuntime::default();
            let browser_bridge = browser_bridge::BrowserBridge::default();
            app.manage(database.clone());
            app.manage(runtime.clone());
            app.manage(browser_bridge.clone());
            browser_bridge::start(app.handle().clone(), browser_bridge.clone());
            for id in recovered_ids {
                let app_handle = app.handle().clone();
                let database = database.clone();
                let runtime = runtime.clone();
                let browser_bridge = browser_bridge.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = commands::transfer::resume_owned(
                        app_handle,
                        database,
                        runtime,
                        browser_bridge,
                        id,
                    )
                    .await;
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_category_folders,
            browser_bridge::browser_extension_status,
            commands::downloads::create_download,
            commands::downloads::list_downloads,
            commands::downloads::update_download,
            commands::downloads::remove_download,
            commands::downloads::list_history,
            commands::downloads::remove_history_item,
            commands::downloads::clear_history,
            commands::downloads::reveal_in_folder,
            commands::downloads::open_file,
            commands::transfer::start_download,
            commands::transfer::inspect_download,
            commands::transfer::open_download_confirmation,
            commands::transfer::queue_download,
            commands::transfer::cancel_download,
            commands::transfer::pause_download,
            commands::transfer::resume_download,
            commands::transfer::replace_download_url,
            commands::transfer::open_progress_window,
            commands::transfer::open_complete_window,
            commands::transfer::update_speed_limit
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o SF Downloader");
}
mod browser_bridge;
mod commands;
mod database;
mod download;

use tauri::Manager;
