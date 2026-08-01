use crate::{
    browser_bridge::BrowserBridge,
    database::{
        models::{CreateDownloadInput, DownloadStatus, DownloadTask},
        repositories::{downloads, statistics},
        Database,
    },
    download::{
        engine,
        runtime::{DownloadRuntime, TaskControl},
    },
};
use reqwest::{header, Url};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tokio::io::AsyncReadExt;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDownloadInput {
    pub url: String,
    pub root_folder: String,
    pub auto_organize: bool,
    pub selected_category: Option<String>,
    #[serde(default = "default_connections")]
    pub max_connections: usize,
    #[serde(default = "default_parallel_downloads")]
    pub max_parallel_downloads: usize,
    #[serde(default)]
    pub speed_limit_download: u64,
    pub browser_request_id: Option<String>,
    #[serde(default = "default_resume_support")]
    pub resume_support: bool,
    #[serde(default)]
    pub auto_extract: bool,
    #[serde(default)]
    pub delete_archive_after_extract: bool,
    pub archive_password: Option<String>,
    #[serde(default)]
    pub force: bool,
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

fn reject_duplicate(database: &Database, candidate: &CreateDownloadInput) -> Result<(), String> {
    let connection = database.connect()?;
    let duplicate = downloads::list(&connection)
        .map_err(|error| format!("Falha ao verificar downloads existentes: {error}"))?
        .into_iter()
        .find(|task| {
            let same_url = task.original_url == candidate.original_url
                || task.current_url == candidate.original_url;
            let same_file = task.file_name.eq_ignore_ascii_case(&candidate.file_name)
                && task.file_size.is_some()
                && task.file_size == candidate.file_size;
            (same_url || same_file)
                && !matches!(
                    task.status,
                    DownloadStatus::Failed | DownloadStatus::Cancelled
                )
        });
    if let Some(task) = duplicate {
        let state = if task.status == DownloadStatus::Completed {
            "já foi baixado"
        } else {
            "já está em andamento ou pausado"
        };
        return Err(format!("{}: este arquivo {state}.", task.file_name));
    }
    Ok(())
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

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};
use std::time::Instant;

static CREATING_WINDOWS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

// Dedupe por URL para impedir janelas de confirmação duplicadas da MESMA URL
// disparadas em sequência por caminhos diferentes (paste, Enter, deep link,
// extensão). URLs diferentes continuam abrindo janelas independentes.
static RECENT_CONFIRMATIONS: LazyLock<Mutex<HashMap<String, Instant>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn confirmation_recently_opened(url: &str) -> bool {
    if url.is_empty() {
        return false;
    }
    let mut map = match RECENT_CONFIRMATIONS.lock() {
        Ok(map) => map,
        Err(_) => return false,
    };
    let now = Instant::now();
    map.retain(|_, time| now.duration_since(*time).as_secs() < 10);
    if let Some(last) = map.get(url) {
        if now.duration_since(*last).as_millis() < 2500 {
            return true;
        }
    }
    map.insert(url.to_string(), now);
    false
}

#[tauri::command]
pub fn show_ready_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn open_download_confirmation(
    app: AppHandle,
    token: String,
    url: String,
) -> Result<(), String> {
    let is_torrent = url.starts_with("magnet:") || url.to_lowercase().ends_with(".torrent");
    let label = if is_torrent {
        format!("download-torrent-confirm-{}", token)
    } else {
        format!("download-confirm-{}", token)
    };
    if let Some(window) = app.get_webview_window(&label) {
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    // Bloqueia janela duplicada da mesma URL (dispara em sequência por caminhos
    // diferentes). URLs diferentes seguem abrindo normalmente.
    if confirmation_recently_opened(&url) {
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
    let confirmation_url = app
        .config()
        .build
        .dev_url
        .clone()
        .map(WebviewUrl::External)
        .unwrap_or_else(|| WebviewUrl::App("index.html".into()));
    #[cfg(not(debug_assertions))]
    let confirmation_url = WebviewUrl::App("index.html".into());

    let builder = WebviewWindowBuilder::new(&app, &label, confirmation_url)
        .title(if is_torrent { "Adicionar Torrent" } else { "Confirmar download" })
        .decorations(false)
        .shadow(false)
        .visible(false)
        .transparent(true)
        .center();

    let build_result = if is_torrent {
        builder
            .inner_size(740.0, 520.0)
            .min_inner_size(660.0, 480.0)
            .resizable(true)
            .build()
    } else {
        builder
            .inner_size(600.0, 295.0)
            .resizable(false)
            .build()
    };

    {
      if let Ok(mut creating) = CREATING_WINDOWS.lock() {
        creating.remove(&label);
      }
    }

    build_result.map_err(|error| format!("Falha ao abrir confirmação: {error}"))?;
    Ok(())
  }

  #[tauri::command]
  pub async fn open_progress_window(app: AppHandle, id: String) -> Result<(), String> {
    let is_torrent = app
        .state::<Database>()
        .connect()
        .ok()
        .and_then(|c| downloads::find(&c, &id).ok().flatten())
        .map(|t| t.download_type == "torrent" || t.original_url.starts_with("magnet:") || t.file_name.to_lowercase().ends_with(".torrent"))
        .unwrap_or(false);

    let label = if is_torrent {
        format!("download-torrent-live-{}", id)
    } else {
        format!("download-{}", id)
    };
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

    let builder = WebviewWindowBuilder::new(&app, &label, url)
      .title(if is_torrent { "SF Downloader - Torrent" } else { "SF Downloader - Download" })
      .decorations(false)
      .shadow(false)
      .visible(false)
      .transparent(true)
      .center();

    let build_result = if is_torrent {
        builder
            .inner_size(540.0, 290.0)
            .min_inner_size(460.0, 240.0)
            .resizable(true)
            .build()
    } else {
        builder
            .inner_size(450.0, 205.0)
            .resizable(false)
            .build()
    };

    {
      if let Ok(mut creating) = CREATING_WINDOWS.lock() {
        creating.remove(&label);
      }
    }

    build_result.map_err(|error| format!("Falha ao abrir progresso: {error}"))?;
    Ok(())
}

  #[tauri::command]
  pub async fn open_torrent_progress_window(
      app: AppHandle,
      info_hash: String,
      task_id: String,
  ) -> Result<(), String> {
      let clean_hash = crate::download::torrent::sanitize_info_hash(&info_hash);
      let label = format!("torrent-progress-{}", clean_hash);
      println!(
          "[PROGRESS_WINDOW_OPEN] label='{}', info_hash='{}', task_id='{}'",
          label, clean_hash, task_id
      );

      if let Some(window) = app.get_webview_window(&label) {
          println!("[PROGRESS_WINDOW_OPEN] Janela existente encontrada, executando show() e set_focus()");
          let _ = window.show();
          let _ = window.set_focus();
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
      let window_url = app
          .config()
          .build
          .dev_url
          .clone()
          .map(WebviewUrl::External)
          .unwrap_or_else(|| WebviewUrl::App("index.html".into()));
      #[cfg(not(debug_assertions))]
      let window_url = WebviewUrl::App("index.html".into());

      let build_result = WebviewWindowBuilder::new(&app, &label, window_url)
          .title("SF Downloader - Torrent")
          .inner_size(540.0, 290.0)
          .min_inner_size(460.0, 240.0)
          .resizable(true)
          .decorations(false)
          .shadow(false)
          .visible(true)
          .transparent(true)
          .center()
          .build();

      {
          if let Ok(mut creating) = CREATING_WINDOWS.lock() {
              creating.remove(&label);
          }
      }

      build_result.map_err(|error| format!("Falha ao abrir janela de progresso torrent: {error}"))?;
      Ok(())
  }

#[tauri::command]
pub async fn open_complete_window(app: AppHandle, id: String) -> Result<(), String> {
    let label = format!("download-{}", id);
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
        .title("SF Downloader - Download")
        .inner_size(450.0, 205.0)
        .resizable(false)
        .decorations(false)
        .shadow(false)
        .visible(false)
        .transparent(true)
        .center()
        .build();

    {
      if let Ok(mut creating) = CREATING_WINDOWS.lock() {
        creating.remove(&label);
      }
    }

    build_result.map_err(|error| format!("Falha ao abrir conclusão: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn inspect_download(url: String) -> Result<DownloadPreview, String> {
    if url.starts_with("magnet:") || url.to_lowercase().ends_with(".torrent") {
        let manager = crate::download::torrent::get_torrent_manager();
        let meta = manager.parse_torrent(&url).await.ok();
        let file_name = meta
            .as_ref()
            .and_then(|m| m.name())
            .unwrap_or("Torrent Download")
            .to_string();
        let extension = Path::new(&file_name)
            .extension()
            .and_then(|v| v.to_str())
            .map(|v| v.to_lowercase())
            .or_else(|| Some("torrent".into()));
        let total_size = meta.as_ref().and_then(|m| m.total_size());
        return Ok(DownloadPreview {
            url,
            file_name,
            file_size: total_size,
            mime_type: Some("application/x-bittorrent".into()),
            extension,
        });
    }

    let parsed = Url::parse(&url).map_err(|_| "A URL informada é inválida.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Apenas URLs HTTP, HTTPS ou Magnet Links são permitidas.".into());
    }
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
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
        input.selected_category.as_deref(),
        headers.clone(),
        input.max_connections,
        input.max_parallel_downloads,
        input.speed_limit_download,
        input.resume_support,
        input.delete_archive_after_extract,
    )
    .await?;
    if !input.force {
        reject_duplicate(&database, &prepared.input)?;
    }
    let connection = database.connect()?;
    let task = downloads::create(&connection, prepared.input)
        .map_err(|error| format!("Falha ao persistir o download: {error}"))?;
    browser_bridge.persist_headers(&task.id, &headers)?;
    if input.auto_extract
        && matches!(
            task.extension.as_deref(),
            Some("zip" | "7z" | "rar" | "tar" | "gz" | "tgz")
        )
    {
        crate::download::extraction::register(task.id.clone(), input.archive_password.clone());
    }
    downloads::update(
        &connection,
        crate::database::models::UpdateDownloadInput {
            id: task.id,
            status: crate::database::models::DownloadStatus::Paused,
            total_downloaded: 0,
            speed_current: 0.0,
            speed_average: 0.0,
            seeds: None,
            peers: None,
            upload_speed: None,
            total_uploaded: None,
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
        input.selected_category.as_deref(),
        headers.clone(),
        input.max_connections,
        input.max_parallel_downloads,
        input.speed_limit_download,
        input.resume_support,
        input.delete_archive_after_extract,
    )
    .await?;
    if !input.force {
        reject_duplicate(&database, &prepared.input)?;
    }
    let connection = database.connect()?;
    let task = downloads::create(&connection, prepared.input)
        .map_err(|error| format!("Falha ao persistir o download: {error}"))?;
    browser_bridge.persist_headers(&task.id, &headers)?;
    if input.auto_extract
        && matches!(
            task.extension.as_deref(),
            Some("zip" | "7z" | "rar" | "tar" | "gz" | "tgz")
        )
    {
        crate::download::extraction::register(task.id.clone(), input.archive_password.clone());
    }
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
                        seeds: None,
                        peers: None,
                        upload_speed: None,
                        total_uploaded: None,
                    },
                );
            }
            runtime.remove(&id);
            return;
        };
        if spawned_task.download_type == "torrent" {
            crate::download::torrent::run_torrent(app, database.clone(), spawned_task, control).await;
        } else if segmented {
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
        } else if let Some(resp) = prepared.response {
            engine::run(
                app,
                database.clone(),
                spawned_task,
                resp,
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
pub async fn cancel_download(
    app: AppHandle,
    runtime: State<'_, DownloadRuntime>,
    database: State<'_, Database>,
    id: String,
    delete_files: bool,
) -> Result<bool, String> {
    let connection = database.connect()?;
    let task_opt = downloads::find(&connection, &id).map_err(|e| e.to_string())?;

    if let Some(ref task) = task_opt {
        if task.download_type == "torrent" || task.original_url.starts_with("magnet:") {
            let info_hash = task.info_hash.clone().unwrap_or_else(|| id.clone());
            let manager = crate::download::torrent::get_torrent_manager();
            let _ = manager.cancel_torrent(&app, database.inner(), &info_hash, delete_files).await;
        }
    }

    if runtime.has(&id) {
        let _ = runtime.cancel(&id, delete_files);
    }

    let Some(task) = task_opt else {
        return Ok(false);
    };

    if task.status == crate::database::models::DownloadStatus::Completed {
        return Ok(false);
    }

    let observed_downloaded = task.total_downloaded.max(0);
    if delete_files {
        let _ = std::fs::remove_file(&task.temp_path);
        let _ = std::fs::remove_file(&task.final_path);
        if let Ok(plan) = crate::database::repositories::chunks::list(&connection, &task.id) {
            for chunk in plan {
                let _ = std::fs::remove_file(format!("{}.chunk-{}", task.temp_path, chunk.index));
            }
        }
    }

    downloads::update(
        &connection,
        crate::database::models::UpdateDownloadInput {
            id: id.clone(),
            status: crate::database::models::DownloadStatus::Cancelled,
            total_downloaded: if delete_files { 0 } else { task.total_downloaded },
            speed_current: 0.0,
            speed_average: task.speed_average,
            seeds: None,
            peers: None,
            upload_speed: None,
            total_uploaded: None,
        },
    )
    .map_err(|error| format!("Falha ao cancelar o download: {error}"))?;

    if observed_downloaded > 0 {
        let mut connection = database.connect()?;
        let _ = statistics::record_snapshot(
            &mut connection,
            &task.id,
            &task.file_name,
            observed_downloaded,
            0,
            observed_downloaded,
            task.speed_average,
            "cancelled",
        );
    }

    use tauri::Emitter;
    let _ = app.emit(
        "download-progress",
        serde_json::json!({
            "id": id,
            "downloaded": 0,
            "total": null,
            "speed": 0.0,
            "status": "cancelled",
            "error": null
        }),
    );
    let _ = app.emit("download-updated", id);

    Ok(true)
}

#[tauri::command]
pub async fn pause_download(
    app: AppHandle,
    database: State<'_, Database>,
    runtime: State<'_, DownloadRuntime>,
    id: String,
) -> Result<bool, String> {
    if let Ok(conn) = database.connect() {
        if let Ok(Some(task)) = downloads::find(&conn, &id) {
            if task.download_type == "torrent" || task.original_url.starts_with("magnet:") {
                let info_hash = task.info_hash.clone().unwrap_or_default();
                if info_hash.is_empty() {
                    return Err("Torrent sem info_hash registrado.".into());
                }
                println!("[TORRENT_PAUSE] info_hash='{}', estado_antes='{:?}', estado_depois='paused'", info_hash, task.status);

                // Pausar via librqbit session diretamente no handle (async — sem block_on)
                let manager = crate::download::torrent::get_torrent_manager();
                {
                    let guard = manager.entries().read().await;
                    if let Some(entry) = guard.get(&info_hash) {
                        let session_guard = manager.session().read().await;
                        if let Some(ref session) = *session_guard {
                            if let Err(e) = session.pause(&entry.handle).await {
                                println!("[TORRENT_PAUSE] Erro ao pausar via session: {:?}", e);
                            } else {
                                println!("[TORRENT_PAUSE] librqbit session.pause() chamado com sucesso para info_hash={}", info_hash);
                            }
                        } else {
                            println!("[TORRENT_PAUSE] Sessão librqbit não disponível — apenas marcando DB como paused");
                        }
                    } else {
                        println!("[TORRENT_PAUSE] Handle não encontrado no TorrentManager para info_hash={} — apenas marcando DB como paused", info_hash);
                    }
                }

                let _ = downloads::update_progress(
                    &conn,
                    &crate::database::models::UpdateDownloadInput {
                        id: id.clone(),
                        status: crate::database::models::DownloadStatus::Paused,
                        total_downloaded: task.total_downloaded,
                        speed_current: 0.0,
                        speed_average: task.speed_average,
                        seeds: None,
                        peers: None,
                        upload_speed: None,
                        total_uploaded: None,
                    },
                );
                use tauri::Emitter;
                let _ = app.emit(
                    "download-progress",
                    serde_json::json!({
                        "id": task.id,
                        "downloaded": task.total_downloaded,
                        "total": task.file_size,
                        "speed": 0.0,
                        "status": "paused",
                        "error": null
                    }),
                );
                return Ok(true);
            }
        }
    }
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
    if new_url.starts_with("magnet:") {
        println!("[MAGNET_ROUTED_TO_HTTP_ERROR] Tentativa de enviar magnet link para replace_download_url! url='{}'", new_url);
        return Err("Magnet links não podem ser utilizados como URL HTTP.".into());
    }

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

    if task.download_type == "torrent" || task.original_url.starts_with("magnet:") {
        let info_hash = task.info_hash.clone().unwrap_or_default();
        let magnet = task.original_url.clone();

        println!(
            "[TORRENT_RESUME] info_hash='{}', handle_valido=true, estado_antes='{:?}', estado_depois='downloading'",
            info_hash, task.status
        );

        let manager = crate::download::torrent::get_torrent_manager();

        // Se o handle não existe no TorrentManager (ex: após restart do app),
        // re-adicionar o torrent à sessão via magnet link
        let needs_readd = {
            let guard = manager.entries().read().await;
            !guard.contains_key(&info_hash)
        };

        if needs_readd {
            println!("[TORRENT_RESUME] Handle ausente após restart — re-adicionando magnet à sessão: info_hash={}", info_hash);
            let save_path = std::path::Path::new(&task.save_path);
            match manager.get_session(save_path).await {
                Ok(session) => {
                    match manager.start_torrent_handle(&session, &magnet, save_path).await {
                        Ok(_handle) => {
                            println!("[TORRENT_RESUME] Handle re-adicionado com sucesso para info_hash={}", info_hash);
                        }
                        Err(e) => {
                            println!("[TORRENT_RESUME] Falha ao re-adicionar magnet: {:?}", e);
                        }
                    }
                }
                Err(e) => {
                    println!("[TORRENT_RESUME] Falha ao obter sessão librqbit: {:?}", e);
                }
            }
        } else {
            // Handle existe — usar session.unpause() para retomar
            let guard = manager.entries().read().await;
            if let Some(entry) = guard.get(&info_hash) {
                let session_guard = manager.session().read().await;
                if let Some(ref session) = *session_guard {
                    if let Err(e) = session.unpause(&entry.handle).await {
                        println!("[TORRENT_RESUME] Erro ao retomar via session.unpause: {:?}", e);
                    } else {
                        println!("[TORRENT_RESUME] librqbit session.unpause() chamado com sucesso para info_hash={}", info_hash);
                    }
                }
            }
        }

        let control = TaskControl::new();
        control.set_speed_limit(task.speed_limit_download).await;
        runtime.register(task.id.clone(), control.clone())?;

        let connection = database.connect()?;
        let _ = downloads::update_progress(
            &connection,
            &crate::database::models::UpdateDownloadInput {
                id: task.id.clone(),
                status: crate::database::models::DownloadStatus::Downloading,
                total_downloaded: task.total_downloaded,
                speed_current: 0.0,
                speed_average: task.speed_average,
                seeds: None,
                peers: None,
                upload_speed: None,
                total_uploaded: None,
            },
        );

        let database_clone = database.clone();
        let spawned_task = task.clone();
        let app_handle = app.clone();
        let runtime_clone = runtime.clone();
        let task_id = task.id.clone();

        tauri::async_runtime::spawn(async move {
            crate::download::torrent::run_torrent(app_handle, database_clone, spawned_task, control).await;
            runtime_clone.remove(&task_id);
        });

        let _ = open_torrent_progress_window(app.clone(), info_hash, task.id.clone()).await;
        return Ok(task);
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
                seeds: None,
                peers: None,
                upload_speed: None,
                total_uploaded: None,
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

#[tauri::command]
pub async fn open_browser_integration_window(app: AppHandle) -> Result<(), String> {
    let label = "browser-integration";
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
    let url = app
        .config()
        .build
        .dev_url
        .clone()
        .map(WebviewUrl::External)
        .unwrap_or_else(|| WebviewUrl::App("index.html".into()));
    #[cfg(not(debug_assertions))]
    let url = WebviewUrl::App("index.html".into());

    let build_result = WebviewWindowBuilder::new(&app, label, url)
        .title("Integração do Navegador")
        .inner_size(700.0, 465.0)
        .min_inner_size(700.0, 465.0)
        .resizable(false)
        .decorations(false)
        .visible(false)
        .transparent(true)
        .center()
        .build();

    {
      if let Ok(mut creating) = CREATING_WINDOWS.lock() {
        creating.remove(label);
      }
    }

    build_result.map_err(|error| format!("Falha ao abrir integração: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_extension_dir(app: AppHandle, browser: String) -> Result<String, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let ext_dir = app_data.join("extension").join(&browser);
    
    std::fs::create_dir_all(&ext_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(ext_dir.join("icons")).map_err(|e| e.to_string())?;

    let project_dist = app_data
        .join("..")
        .join("..")
        .join("browser-extension")
        .join("dist")
        .join(&browser);

    if browser == "chromium" {
        let files = ["manifest.json", "background.js", "content.js", "popup.html", "popup.css", "popup.js", "icons/sf-small.png", "icons/sf-large.png"];
        for file in files {
            let src_file = project_dist.join(file);
            let dest_file = ext_dir.join(file);
            if let Ok(bytes) = std::fs::read(&src_file) {
                let _ = std::fs::write(&dest_file, bytes);
            } else {
                let embedded_bytes: &[u8] = match file {
                    "manifest.json" => include_bytes!("../../../browser-extension/dist/chromium/manifest.json"),
                    "background.js" => include_bytes!("../../../browser-extension/dist/chromium/background.js"),
                    "content.js" => include_bytes!("../../../browser-extension/dist/chromium/content.js"),
                    "popup.html" => include_bytes!("../../../browser-extension/dist/chromium/popup.html"),
                    "popup.css" => include_bytes!("../../../browser-extension/dist/chromium/popup.css"),
                    "popup.js" => include_bytes!("../../../browser-extension/dist/chromium/popup.js"),
                    "icons/sf-small.png" => include_bytes!("../../../browser-extension/dist/chromium/icons/sf-small.png"),
                    "icons/sf-large.png" => include_bytes!("../../../browser-extension/dist/chromium/icons/sf-large.png"),
                    _ => &[],
                };
                if !embedded_bytes.is_empty() {
                    let _ = std::fs::write(&dest_file, embedded_bytes);
                }
            }
        }
    } else if browser == "firefox" {
        let files = ["manifest.json", "background.js", "content.js", "popup.html", "popup.css", "popup.js", "icons/sf-small.png", "icons/sf-large.png"];
        for file in files {
            let src_file = project_dist.join(file);
            let dest_file = ext_dir.join(file);
            if let Ok(bytes) = std::fs::read(&src_file) {
                let _ = std::fs::write(&dest_file, bytes);
            } else {
                let embedded_bytes: &[u8] = match file {
                    "manifest.json" => include_bytes!("../../../browser-extension/dist/firefox/manifest.json"),
                    "background.js" => include_bytes!("../../../browser-extension/dist/firefox/background.js"),
                    "content.js" => include_bytes!("../../../browser-extension/dist/firefox/content.js"),
                    "popup.html" => include_bytes!("../../../browser-extension/dist/firefox/popup.html"),
                    "popup.css" => include_bytes!("../../../browser-extension/dist/firefox/popup.css"),
                    "popup.js" => include_bytes!("../../../browser-extension/dist/firefox/popup.js"),
                    "icons/sf-small.png" => include_bytes!("../../../browser-extension/dist/firefox/icons/sf-small.png"),
                    "icons/sf-large.png" => include_bytes!("../../../browser-extension/dist/firefox/icons/sf-large.png"),
                    _ => &[],
                };
                if !embedded_bytes.is_empty() {
                    let _ = std::fs::write(&dest_file, embedded_bytes);
                }
            }
        }
        
        // Copia o arquivo XPI para instalação direta ou manual.
        let release_dir = app_data
            .join("..")
            .join("..")
            .join("browser-extension")
            .join("release");
        let xpi_bytes = find_latest_xpi(&release_dir)
            .and_then(|path| std::fs::read(&path).ok())
            .unwrap_or_else(|| include_bytes!("../../../browser-extension/release/firefox-extension.xpi").to_vec());
        std::fs::write(ext_dir.join("integration.xpi"), xpi_bytes).map_err(|e| e.to_string())?;
    }

    Ok(ext_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let parsed = Url::parse(&url)
        .map_err(|e| format!("URL inválida: {e}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Apenas links http(s) são suportados".into());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn start_drag_folder(window: tauri::WebviewWindow, path: String) -> Result<(), String> {
    let folder_path = std::path::PathBuf::from(path);
    if !folder_path.exists() {
        return Err("Diretório da extensão não encontrado".into());
    }

    let drag_item = drag::DragItem::Files(vec![folder_path.clone()]);
    
    // Icon de preview da extensão
    let app_data = window.path().app_data_dir().map_err(|e| e.to_string())?;
    let icon_path = app_data.join("extension").join("chromium").join("icons").join("sf-small.png");
    
    let preview_icon = if icon_path.exists() {
        drag::Image::File(icon_path)
    } else {
        drag::Image::File(std::path::PathBuf::new())
    };

    drag::start_drag(
        &window,
        drag_item,
        preview_icon,
        |result, _cursor| {
            println!("Drag terminado: {:?}", result);
        },
        drag::Options::default(),
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn parse_torrent_info(
    app: tauri::AppHandle,
    token: Option<String>,
    source: String,
) -> Result<crate::download::torrent::TorrentMetadataResponse, String> {
    let manager = crate::download::torrent::get_torrent_manager();
    manager.parse_torrent_with_app(Some(app), token.as_deref(), &source).await
}

#[tauri::command]
pub async fn confirm_torrent(
    app: tauri::AppHandle,
    database: tauri::State<'_, crate::database::Database>,
    info_hash: String,
    save_path: String,
    selected_file_indexes: Vec<usize>,
    start_immediately: bool,
) -> Result<crate::database::models::DownloadTask, String> {
    let manager = crate::download::torrent::get_torrent_manager();
    manager
        .confirm_torrent(&app, &database, &info_hash, &save_path, &selected_file_indexes, start_immediately)
        .await
}

#[tauri::command]
pub async fn cancel_torrent(
    app: tauri::AppHandle,
    database: tauri::State<'_, crate::database::Database>,
    info_hash: String,
    delete_files: Option<bool>,
) -> Result<(), String> {
    let manager = crate::download::torrent::get_torrent_manager();
    manager
        .cancel_torrent(&app, &database, &info_hash, delete_files.unwrap_or(false))
        .await
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

// Retorna o primeiro arquivo .xpi encontrado na pasta. A pasta release/ deve
// conter apenas o XPI da versão atual, então não há necessidade de comparar
// versões por nome de arquivo.
pub(crate) fn find_latest_xpi(dir: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("xpi"))
        .max_by_key(|path| {
            std::fs::metadata(path)
                .and_then(|m| m.modified())
                .ok()
        })
}
