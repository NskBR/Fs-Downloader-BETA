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

fn valid_category_name(name: &str) -> bool {
    let trimmed = name.trim();
    !trimmed.is_empty()
        && trimmed != "."
        && trimmed != ".."
        && !trimmed.chars().any(|character| {
            matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            ) || character.is_control()
        })
}

#[tauri::command]
fn create_category_folders(
    root_path: String,
    custom_categories: Vec<String>,
) -> Result<Vec<String>, String> {
    let trimmed = root_path.trim();
    if trimmed.is_empty() {
        return Err("A pasta principal não pode ficar vazia.".into());
    }
    let root = std::path::PathBuf::from(trimmed);
    std::fs::create_dir_all(&root)
        .map_err(|error| format!("Não foi possível criar a pasta principal: {error}"))?;
    let categories = CATEGORY_FOLDERS
        .iter()
        .map(|category| (*category).to_string())
        .chain(custom_categories)
        .collect::<Vec<_>>();
    categories
        .iter()
        .map(|category| {
            if !valid_category_name(category) {
                return Err(format!("Nome de categoria inválido: {category}"));
            }
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
            show_main_window(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let open_item =
                MenuItem::with_id(app, "tray-open", "Abrir SF Downloader", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "tray-quit", "Sair", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&open_item, &quit_item])?;
            let mut tray = TrayIconBuilder::with_id("main-tray")
                .tooltip("SF Downloader")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "tray-open" => show_main_window(app),
                    "tray-quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } | TrayIconEvent::DoubleClick {
                            button: MouseButton::Left,
                            ..
                        }
                    ) {
                        show_main_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

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
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .on_menu_event(|app, event| {
            let id_str = event.id().as_ref().to_string();
            if id_str.starts_with("tray-") {
                return;
            }
            if let Some((action, download_id)) = id_str.split_once('_') {
                let _ = app.emit(
                    "context-menu-action",
                    serde_json::json!({
                        "action": action,
                        "downloadId": download_id
                    }),
                );
            }
        })
        .invoke_handler(tauri::generate_handler![
            create_category_folders,
            browser_bridge::browser_extension_status,
            commands::context_menu::show_download_context_menu,
            commands::downloads::create_download,
            commands::downloads::list_downloads,
            commands::downloads::update_download,
            commands::downloads::remove_download,
            commands::downloads::list_history,
            commands::downloads::remove_history_item,
            commands::downloads::clear_history,
            commands::profile::profile_statistics,
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
            commands::transfer::show_ready_window,
            commands::transfer::update_speed_limit,
            commands::transfer::open_browser_integration_window,
            commands::transfer::get_extension_dir,
            commands::transfer::open_folder,
            download::extraction::extraction_status
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o SF Downloader");
}
mod browser_bridge;
mod commands;
mod database;
mod download;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod category_tests {
    use super::valid_category_name;

    #[test]
    fn category_names_cannot_escape_the_download_root() {
        assert!(valid_category_name("Jogos antigos"));
        assert!(!valid_category_name("../Documentos"));
        assert!(!valid_category_name("Jogos\\PC"));
        assert!(!valid_category_name("."));
    }
}
