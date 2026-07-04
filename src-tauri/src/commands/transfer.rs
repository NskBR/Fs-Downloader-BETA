use crate::{
    browser_bridge::BrowserBridge,
    database::{models::DownloadTask, repositories::downloads, Database},
    download::{
        engine,
        runtime::{DownloadRuntime, TaskControl},
    },
};
use reqwest::{header, Url};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tokio::io::AsyncReadExt;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDownloadInput {
    pub url: String,
    pub root_folder: String,
    pub auto_organize: bool,
    #[serde(default = "default_connections")]
    pub max_connections: usize,
    #[serde(default = "default_parallel_downloads")]
    pub max_parallel_downloads: usize,
    #[serde(default)]
    pub speed_limit_download: u64,
    pub browser_request_id: Option<String>,
    #[serde(default = "default_resume_support")]
    pub resume_support: bool,
}

fn default_resume_support() -> bool {
    true
}

fn default_connections() -> usize {
    8
}
fn default_parallel_downloads() -> usize {
    3
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadPreview {
    pub url: String,
    pub file_name: String,
    pub file_size: Option<u64>,
    pub mime_type: Option<String>,
    pub extension: Option<String>,
}

use std::collections::HashSet;
use std::sync::{LazyLock, Mutex};

static CREATING_WINDOWS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

#[tauri::command]
pub async fn open_download_confirmation(app: AppHandle) -> Result<(), String> {
    let label = "download-confirm";
    if let Some(window) = app.get_webview_window(label) {
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    {
        let mut creating = CREATING_WINDOWS.lock().map_err(|error| error.to_string())?;
        if creating.contains(label) {
            return Ok(());
        }
        creating.insert(label.to_string());
    }

    #[cfg(debug_assertions)]
    let confirmation_url = app
        .config()
        .build
        .dev_url
        .clone()
        .map(WebviewUrl::External)
        .unwrap_or_else(|| WebviewUrl::App("index.html".into()));
    #[cfg(not(debug_assertions))]
    let confirmation_url = WebviewUrl::App("index.html".into());

    let build_result = WebviewWindowBuilder::new(&app, label, confirmation_url)
        .title("Confirmar download")
        .inner_size(540.0, 390.0)
        .min_inner_size(500.0, 370.0)
        .resizable(false)
        .decorations(false)
        .background_color(tauri::webview::Color(26, 29, 36, 255))
        .center()
        .build();

    {
        if let Ok(mut creating) = CREATING_WINDOWS.lock() {
            creating.remove(label);
        }
    }

    let window = build_result.map_err(|error| format!("Falha ao abrir confirmação: {error}"))?;
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
pub async fn open_progress_window(app: AppHandle, id: String) -> Result<(), String> {
    let label = format!("download-progress-{}", id);
    if let Some(window) = app.get_webview_window(&label) {
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    {
        let mut creating = CREATING_WINDOWS.lock().map_err(|error| error.to_string())?;
        if creating.contains(&label) {
            return Ok(());
        }
        creating.insert(label.clone());
    }

    #[cfg(debug_assertions)]
    let url = app
        .config()
        .build
        .dev_url
        .clone()
        .map(WebviewUrl::External)
        .unwrap_or_else(|| WebviewUrl::App("index.html".into()));
    #[cfg(not(debug_assertions))]
    let url = WebviewUrl::App("index.html".into());

    let build_result = WebviewWindowBuilder::new(&app, &label, url)
        .title("SF Downloader - Progresso")
        .inner_size(480.0, 320.0)
        .resizable(false)
        .decorations(false)
        .background_color(tauri::webview::Color(26, 29, 36, 255))
        .center()
        .build();

    {
        if let Ok(mut creating) = CREATING_WINDOWS.lock() {
            creating.remove(&label);
        }
    }

    let window = build_result.map_err(|error| format!("Falha ao abrir progresso: {error}"))?;
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
pub async fn open_complete_window(app: AppHandle, id: String) -> Result<(), String> {
    let label = format!("download-complete-{}", id);
    if let Some(window) = app.get_webview_window(&label) {
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    {
        let mut creating = CREATING_WINDOWS.lock().map_err(|error| error.to_string())?;
        if creating.contains(&label) {
            return Ok(());
        }
        creating.insert(label.clone());
    }

    #[cfg(debug_assertions)]
    let url = app
        .config()
        .build
        .dev_url
        .clone()
        .map(WebviewUrl::External)
        .unwrap_or_else(|| WebviewUrl::App("index.html".into()));
    #[cfg(not(debug_assertions))]
    let url = WebviewUrl::App("index.html".into());

    let build_result = WebviewWindowBuilder::new(&app, &label, url)
        .title("SF Downloader - Concluído")
        .inner_size(480.0, 250.0)
        .resizable(false)
        .decorations(false)
        .background_color(tauri::webview::Color(26, 29, 36, 255))
        .center()
        .build();

    {
        if let Ok(mut creating) = CREATING_WINDOWS.lock() {
            creating.remove(&label);
        }
    }

    let window = build_result.map_err(|error| format!("Falha ao abrir conclusão: {error}"))?;
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
pub async fn inspect_download(url: String) -> Result<DownloadPreview, String> {
    let parsed = Url::parse(&url).map_err(|_| "A URL informada é inválida.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Apenas URLs HTTP ou HTTPS são permitidas.".into());
    }
    let client = reqwest::Client::builder()
        .user_agent("SF Downloader/0.1")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;
    // Some download hosts close HEAD connections without a TLS close_notify
    // (ash-speed.hetzner.com is one example). In that case, probe one byte with
    // GET instead. Besides being more compatible, this also proves Range support.
    let head_result = client.head(parsed.clone()).send().await;
    let partial_request = || {
        client
            .get(parsed.clone())
            .header(header::RANGE, "bytes=0-0")
            .header(header::ACCEPT_ENCODING, "identity")
    };
    let response = match head_result {
        Ok(head) if head.status().is_success() && response_size(&head).is_some() => head,
        Ok(head) if head.status().is_success() => match partial_request().send().await {
            Ok(partial) if partial.status().is_success() => partial,
            _ => head,
        },
        Ok(head) => partial_request().send().await.map_err(|get_error| {
            format!(
                "Falha ao consultar o arquivo. HEAD retornou {}; GET parcial: {get_error}",
                head.status()
            )
        })?,
        Err(head_error) => partial_request().send().await.map_err(|get_error| {
            format!("Falha ao consultar o arquivo. HEAD: {head_error}; GET parcial: {get_error}")
        })?,
    };
    if !response.status().is_success() {
        return Err(format!(
            "O servidor respondeu com HTTP {}.",
            response.status()
        ));
    }
    let file_name = response
        .headers()
        .get(header::CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| {
            v.split(';')
                .find_map(|p| p.trim().strip_prefix("filename="))
                .map(|n| n.trim_matches(['\"', '\'']).to_string())
        })
        .or_else(|| {
            parsed
                .path_segments()
                .and_then(|mut p| p.next_back())
                .filter(|n| !n.is_empty())
                .map(str::to_owned)
        })
        .unwrap_or_else(|| "download.bin".into());
    let extension = Path::new(&file_name)
        .extension()
        .and_then(|v| v.to_str())
        .map(|v| v.to_lowercase());
    let file_size = response_size(&response);
    Ok(DownloadPreview {
        url,
        file_name,
        file_size,
        mime_type: response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned),
        extension,
    })
}

fn content_range_total(value: &str) -> Option<u64> {
    value.rsplit_once('/')?.1.trim().parse().ok()
}

fn response_size(response: &reqwest::Response) -> Option<u64> {
    response
        .headers()
        .get(header::CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(content_range_total)
        .or_else(|| response.content_length())
}

#[tauri::command]
pub async fn queue_download(
    database: State<'_, Database>,
    browser_bridge: State<'_, BrowserBridge>,
    input: StartDownloadInput,
) -> Result<DownloadTask, String> {
    let headers = browser_bridge.take_headers(input.browser_request_id.as_deref());
    let taken_paths = {
        let connection = database.connect()?;
        downloads::list(&connection)
            .map(|list| list.into_iter().map(|t| t.final_path).collect::<Vec<_>>())
            .unwrap_or_default()
    };
    let prepared = engine::prepare_with_headers(
        taken_paths,
        &input.url,
        &input.root_folder,
        input.auto_organize,
        headers.clone(),
        input.max_connections,
        input.max_parallel_downloads,
        input.speed_limit_download,
        input.resume_support,
    )
    .await?;
    let connection = database.connect()?;
    let task = downloads::create(&connection, prepared.input)
        .map_err(|error| format!("Falha ao persistir o download: {error}"))?;
    browser_bridge.persist_headers(&task.id, &headers)?;
    downloads::update(
        &connection,
        crate::database::models::UpdateDownloadInput {
            id: task.id,
            status: crate::database::models::DownloadStatus::Paused,
            total_downloaded: 0,
            speed_current: 0.0,
            speed_average: 0.0,
        },
    )
    .map_err(|error| format!("Falha ao agendar o download: {error}"))
}

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    database: State<'_, Database>,
    runtime: State<'_, DownloadRuntime>,
    browser_bridge: State<'_, BrowserBridge>,
    input: StartDownloadInput,
) -> Result<DownloadTask, String> {
    let headers = browser_bridge.take_headers(input.browser_request_id.as_deref());
    let taken_paths = {
        let connection = database.connect()?;
        downloads::list(&connection)
            .map(|list| list.into_iter().map(|t| t.final_path).collect::<Vec<_>>())
            .unwrap_or_default()
    };
    let prepared = engine::prepare_with_headers(
        taken_paths,
        &input.url,
        &input.root_folder,
        input.auto_organize,
        headers.clone(),
        input.max_connections,
        input.max_parallel_downloads,
        input.speed_limit_download,
        input.resume_support,
    )
    .await?;
    let connection = database.connect()?;
    let task = downloads::create(&connection, prepared.input)
        .map_err(|error| format!("Falha ao persistir o download: {error}"))?;
    browser_bridge.persist_headers(&task.id, &headers)?;
    let _ = open_progress_window(app.clone(), task.id.clone()).await;
    let control = TaskControl::new();
    control.set_speed_limit(task.speed_limit_download).await;
    runtime.register(task.id.clone(), control.clone())?;
    let database = database.inner().clone();
    let runtime = runtime.inner().clone();
    let browser_bridge = browser_bridge.inner().clone();
    let spawned_task = task.clone();
    let segmented = task.supports_range
        && task.file_size.is_some_and(|size| size >= 2 * 1024 * 1024)
        && input.max_connections > 1;
    let max_connections = input.max_connections;
    tauri::async_runtime::spawn(async move {
        let id = spawned_task.id.clone();
        let Ok(_queue_permit) = runtime
            .acquire(spawned_task.max_parallel_downloads as usize, &control)
            .await
        else {
            if let Ok(connection) = database.connect() {
                let status = if control.was_paused() {
                    crate::database::models::DownloadStatus::Paused
                } else {
                    crate::database::models::DownloadStatus::Cancelled
                };
                let _ = downloads::update(
                    &connection,
                    crate::database::models::UpdateDownloadInput {
                        id: id.clone(),
                        status,
                        total_downloaded: 0,
                        speed_current: 0.0,
                        speed_average: 0.0,
                    },
                );
            }
            runtime.remove(&id);
            return;
        };
        if segmented {
            drop(prepared.response);
            engine::run_segmented(
                app,
                database.clone(),
                spawned_task,
                max_connections,
                control,
                headers,
            )
            .await;
        } else {
            engine::run(
                app,
                database.clone(),
                spawned_task,
                prepared.response,
                control,
                0,
            )
            .await;
        }
        runtime.remove(&id);
        if let Ok(connection) = database.connect() {
            if let Ok(Some(current)) = downloads::find(&connection, &id) {
                if matches!(
                    current.status,
                    crate::database::models::DownloadStatus::Completed
                        | crate::database::models::DownloadStatus::Cancelled
                ) {
                    browser_bridge.remove_headers(&id);
                }
            }
        }
    });
    Ok(task)
}

#[tauri::command]
pub fn cancel_download(
    runtime: State<'_, DownloadRuntime>,
    database: State<'_, Database>,
    id: String,
) -> Result<bool, String> {
    if runtime.cancel(&id)? {
        return Ok(true);
    }
    let connection = database.connect()?;
    let Some(task) = downloads::find(&connection, &id)
        .map_err(|error| format!("Falha ao localizar o download: {error}"))?
    else {
        return Ok(false);
    };
    if task.status == crate::database::models::DownloadStatus::Completed {
        return Ok(false);
    }
    downloads::update(
        &connection,
        crate::database::models::UpdateDownloadInput {
            id,
            status: crate::database::models::DownloadStatus::Cancelled,
            total_downloaded: task.total_downloaded,
            speed_current: 0.0,
            speed_average: task.speed_average,
        },
    )
    .map_err(|error| format!("Falha ao cancelar o download: {error}"))?;
    Ok(true)
}

#[tauri::command]
pub fn pause_download(runtime: State<'_, DownloadRuntime>, id: String) -> Result<bool, String> {
    runtime.pause(&id)
}

#[tauri::command]
pub async fn resume_download(
    app: AppHandle,
    database: State<'_, Database>,
    runtime: State<'_, DownloadRuntime>,
    browser_bridge: State<'_, BrowserBridge>,
    id: String,
) -> Result<DownloadTask, String> {
    resume_owned(
        app,
        database.inner().clone(),
        runtime.inner().clone(),
        browser_bridge.inner().clone(),
        id,
    )
    .await
}

#[tauri::command]
pub async fn replace_download_url(
    database: State<'_, Database>,
    id: String,
    new_url: String,
) -> Result<DownloadTask, String> {
    let task = downloads::find(&database.connect()?, &id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Download não encontrado.".to_string())?;
    let parsed = Url::parse(&new_url).map_err(|_| "A nova URL é inválida.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Apenas URLs HTTP ou HTTPS são permitidas.".into());
    }
    let response = reqwest::Client::builder()
        .user_agent("SF Downloader/0.1")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|error| error.to_string())?
        .get(parsed)
        .header(header::RANGE, "bytes=0-4095")
        .header(header::ACCEPT_ENCODING, "identity")
        .send()
        .await
        .map_err(|error| format!("Falha ao validar a nova URL: {error}"))?;
    if response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!(
            "A nova URL não suporta retomada por Range (HTTP {}).",
            response.status()
        ));
    }
    let headers = response.headers().clone();
    let total = headers
        .get(header::CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(content_range_total)
        .ok_or_else(|| "A nova URL não informou o tamanho total.".to_string())?;
    if task
        .file_size
        .is_some_and(|expected| expected as u64 != total)
    {
        return Err(format!(
            "Arquivo incompatível: tamanho esperado {}, recebido {total}.",
            task.file_size.unwrap()
        ));
    }
    if let (Some(expected), Some(received)) = (
        &task.etag,
        headers
            .get(header::ETAG)
            .and_then(|value| value.to_str().ok()),
    ) {
        if expected != received {
            println!("Aviso de substituição: ETag mudou (esperado: {expected}, recebido: {received}). Prosseguindo.");
        }
    }
    if let (Some(expected), Some(received)) = (
        &task.last_modified,
        headers
            .get(header::LAST_MODIFIED)
            .and_then(|value| value.to_str().ok()),
    ) {
        if expected != received {
            println!("Aviso de substituição: Last-Modified mudou (esperado: {expected}, recebido: {received}). Prosseguindo.");
        }
    }
    let remote = response.bytes().await.map_err(|error| error.to_string())?;
    let chunk_zero = format!("{}.chunk-0", task.temp_path);
    let local_path = if Path::new(&chunk_zero).exists() {
        chunk_zero
    } else {
        task.temp_path.clone()
    };
    if let Ok(mut file) = tokio::fs::File::open(local_path).await {
        let mut local = vec![0_u8; remote.len()];
        let read = file
            .read(&mut local)
            .await
            .map_err(|error| error.to_string())?;
        if read > 0 && local[..read] != remote[..read] {
            return Err("Arquivo incompatível: a amostra inicial de bytes é diferente.".into());
        }
    }
    let connection = database.connect()?;
    downloads::replace_url(&connection, &id, &new_url).map_err(|error| error.to_string())?;
    downloads::find(&connection, &id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Download não encontrado após atualizar a URL.".into())
}

pub async fn resume_owned(
    app: AppHandle,
    database: Database,
    runtime: DownloadRuntime,
    browser_bridge: BrowserBridge,
    id: String,
) -> Result<DownloadTask, String> {
    let task = {
        let connection = database.connect()?;
        downloads::find(&connection, &id)
            .map_err(|error| format!("Falha ao localizar o download: {error}"))?
            .ok_or_else(|| "Download não encontrado.".to_string())?
    };
    if task.status == crate::database::models::DownloadStatus::Completed {
        return Err("Este download já foi concluído.".into());
    }
    if runtime.has(&task.id) {
        for _ in 0..50 {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            if !runtime.has(&task.id) {
                break;
            }
        }
        if runtime.has(&task.id) {
            return Err(
                "A pausa ainda está sendo salva. Tente retomar novamente em um instante.".into(),
            );
        }
    }
    let _ = open_progress_window(app.clone(), task.id.clone()).await;
    let mut saved_headers = browser_bridge.load_headers(&task.id);
    saved_headers.remove(header::HOST);
    saved_headers.remove(header::CONTENT_LENGTH);
    saved_headers.remove(header::RANGE);
    saved_headers.remove(header::IF_RANGE);
    let existing_chunks = {
        let connection = database.connect()?;
        crate::database::repositories::chunks::list(&connection, &task.id)
            .map_err(|error| error.to_string())?
    };
    if !existing_chunks.is_empty() {
        let control = TaskControl::new();
        control.set_speed_limit(task.speed_limit_download).await;
        runtime.register(task.id.clone(), control.clone())?;
        let runtime_clone = runtime.clone();
        let database_clone = database.clone();
        let spawned_task = task.clone();
        let connections = task.max_connections.clamp(1, 32) as usize;
        tauri::async_runtime::spawn(async move {
            let id = spawned_task.id.clone();
            let Ok(_permit) = runtime_clone
                .acquire(spawned_task.max_parallel_downloads as usize, &control)
                .await
            else {
                runtime_clone.remove(&id);
                return;
            };
            engine::run_segmented(
                app,
                database_clone,
                spawned_task,
                connections,
                control,
                saved_headers,
            )
            .await;
            runtime_clone.remove(&id);
        });
        return Ok(task);
    }
    let offset = if task.supports_range {
        tokio::fs::metadata(&task.temp_path)
            .await
            .ok()
            .and_then(|metadata| i64::try_from(metadata.len()).ok())
            .unwrap_or(0)
    } else {
        0
    };
    if task.file_size.is_some_and(|size| size == offset) && offset > 0 {
        tokio::fs::rename(&task.temp_path, &task.final_path)
            .await
            .map_err(|error| format!("Falha ao finalizar o arquivo parcial completo: {error}"))?;
        let connection = database.connect()?;
        return downloads::update(
            &connection,
            crate::database::models::UpdateDownloadInput {
                id,
                status: crate::database::models::DownloadStatus::Completed,
                total_downloaded: offset,
                speed_current: 0.0,
                speed_average: task.speed_average,
            },
        )
        .map_err(|error| format!("Falha ao finalizar o download: {error}"));
    }
    let (response, actual_offset) = engine::prepare_resume(&task, offset, saved_headers).await?;
    let control = TaskControl::new();
    control.set_speed_limit(task.speed_limit_download).await;
    runtime.register(task.id.clone(), control.clone())?;
    let database = database.clone();
    let runtime = runtime.clone();
    let spawned_task = task.clone();
    let credential_store = browser_bridge.clone();
    tauri::async_runtime::spawn(async move {
        let id = spawned_task.id.clone();
        let Ok(_queue_permit) = runtime
            .acquire(spawned_task.max_parallel_downloads as usize, &control)
            .await
        else {
            runtime.remove(&id);
            return;
        };
        engine::run(
            app,
            database.clone(),
            spawned_task,
            response,
            control,
            actual_offset,
        )
        .await;
        runtime.remove(&id);
        if let Ok(connection) = database.connect() {
            if let Ok(Some(current)) = downloads::find(&connection, &id) {
                if matches!(
                    current.status,
                    crate::database::models::DownloadStatus::Completed
                        | crate::database::models::DownloadStatus::Cancelled
                ) {
                    credential_store.remove_headers(&id);
                }
            }
        }
    });
    Ok(task)
}

#[tauri::command]
pub async fn update_speed_limit(
    database: State<'_, Database>,
    runtime: State<'_, DownloadRuntime>,
    id: String,
    speed_limit: i64,
) -> Result<(), String> {
    let connection = database.connect()?;
    downloads::update_speed_limit(&connection, &id, speed_limit)
        .map_err(|error| format!("Erro ao salvar limite: {error}"))?;

    if let Some(control) = runtime.control(&id)? {
        control.set_speed_limit(speed_limit).await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::content_range_total;

    #[test]
    fn reads_total_size_from_partial_head_response() {
        assert_eq!(content_range_total("bytes 0-0/104857600"), Some(104857600));
        assert_eq!(content_range_total("bytes */*"), None);
    }
}
