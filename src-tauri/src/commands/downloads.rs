use crate::database::{
    models::{CreateDownloadInput, DownloadTask, UpdateDownloadInput},
    repositories::{downloads, history},
    Database,
};
use tauri::State;

#[tauri::command]
pub fn create_download(
    database: State<'_, Database>,
    input: CreateDownloadInput,
) -> Result<DownloadTask, String> {
    let connection = database.connect()?;
    downloads::create(&connection, input)
        .map_err(|error| format!("Falha ao criar download: {error}"))
}

#[tauri::command]
pub fn list_history(
    database: State<'_, Database>,
) -> Result<Vec<crate::database::models::HistoryItem>, String> {
    history::list(&database.connect()?)
        .map_err(|error| format!("Falha ao listar histórico: {error}"))
}

#[tauri::command]
pub fn remove_history_item(database: State<'_, Database>, id: String) -> Result<bool, String> {
    history::remove(&database.connect()?, &id)
        .map_err(|error| format!("Falha ao remover item: {error}"))
}

#[tauri::command]
pub fn clear_history(
    database: State<'_, Database>,
    status: Option<String>,
) -> Result<usize, String> {
    history::clear(&database.connect()?, status.as_deref())
        .map_err(|error| format!("Falha ao limpar histórico: {error}"))
}

#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("Caminho do arquivo indisponível.".into());
    }
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer.exe")
        .arg(format!("/select,{path}"))
        .spawn()
        .map_err(|error| format!("Não foi possível abrir a pasta: {error}"))?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(
            std::path::Path::new(&path)
                .parent()
                .unwrap_or(std::path::Path::new(&path)),
        )
        .spawn()
        .map_err(|error| format!("Não foi possível abrir a pasta: {error}"))?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .args(["-R", &path])
        .spawn()
        .map_err(|error| format!("Não foi possível abrir a pasta: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn open_file(path: String) -> Result<(), String> {
    if !std::path::Path::new(&path).exists() {
        return Err("O arquivo não existe mais neste local.".into());
    }
    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &path])
        .spawn()
        .map_err(|error| format!("Não foi possível abrir o arquivo: {error}"))?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|error| format!("Não foi possível abrir o arquivo: {error}"))?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|error| format!("Não foi possível abrir o arquivo: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn list_downloads(database: State<'_, Database>) -> Result<Vec<DownloadTask>, String> {
    let connection = database.connect()?;
    downloads::list(&connection).map_err(|error| format!("Falha ao listar downloads: {error}"))
}

#[tauri::command]
pub fn update_download(
    database: State<'_, Database>,
    input: UpdateDownloadInput,
) -> Result<DownloadTask, String> {
    let connection = database.connect()?;
    downloads::update(&connection, input)
        .map_err(|error| format!("Falha ao atualizar download: {error}"))
}

#[tauri::command]
pub fn remove_download(database: State<'_, Database>, id: String) -> Result<bool, String> {
    let connection = database.connect()?;
    downloads::remove(&connection, &id)
        .map_err(|error| format!("Falha ao remover download: {error}"))
}
