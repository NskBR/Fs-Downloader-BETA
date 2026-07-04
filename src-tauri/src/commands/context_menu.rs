use serde::Deserialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, WebviewWindow};

#[derive(Deserialize)]
pub struct ContextMenuRequest {
    pub download_id: String,
    pub status: String,
}

#[tauri::command]
pub async fn show_download_context_menu(
    app: AppHandle,
    window: WebviewWindow,
    request: ContextMenuRequest,
) -> Result<(), String> {
    let id = &request.download_id;
    let status = request.status.as_str();
    let app_ref = &app;

    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> = Vec::new();

    match status {
        "downloading" => {
            items.push(Box::new(
                MenuItem::with_id(app_ref, &format!("pause_{id}"), "Pausar download", true, None::<&str>)
                    .map_err(|e| e.to_string())?,
            ));
        }
        "paused" | "failed" | "cancelled" => {
            items.push(Box::new(
                MenuItem::with_id(app_ref, &format!("resume_{id}"), "Retomar download", true, None::<&str>)
                    .map_err(|e| e.to_string())?,
            ));
        }
        _ => {}
    }

    if matches!(status, "paused" | "failed") {
        items.push(Box::new(
            MenuItem::with_id(app_ref, &format!("newlink_{id}"), "Fornecer novo link", true, None::<&str>)
                .map_err(|e| e.to_string())?,
        ));
    }

    items.push(Box::new(
        MenuItem::with_id(app_ref, &format!("limit_{id}"), "Limitar velocidade", true, None::<&str>)
            .map_err(|e| e.to_string())?,
    ));

    if matches!(status, "pending" | "downloading" | "paused") {
        items.push(Box::new(
            MenuItem::with_id(app_ref, &format!("cancel_{id}"), "Cancelar download", true, None::<&str>)
                .map_err(|e| e.to_string())?,
        ));
    }

    items.push(Box::new(
        PredefinedMenuItem::separator(app_ref).map_err(|e| e.to_string())?,
    ));

    items.push(Box::new(
        MenuItem::with_id(app_ref, &format!("folder_{id}"), "Abrir pasta de destino", true, None::<&str>)
            .map_err(|e| e.to_string())?,
    ));

    if status == "completed" {
        items.push(Box::new(
            MenuItem::with_id(app_ref, &format!("open_{id}"), "Abrir arquivo", true, None::<&str>)
                .map_err(|e| e.to_string())?,
        ));
    }

    items.push(Box::new(
        MenuItem::with_id(app_ref, &format!("delete_{id}"), "Excluir download", true, None::<&str>)
            .map_err(|e| e.to_string())?,
    ));

    let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        items.iter().map(|item| item.as_ref()).collect();

    let menu = Menu::with_items(app_ref, &refs).map_err(|e| e.to_string())?;

    window.popup_menu(&menu).map_err(|e| e.to_string())?;

    Ok(())
}
