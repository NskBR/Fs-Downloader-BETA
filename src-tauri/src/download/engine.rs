use crate::database::{
    models::{CreateDownloadInput, DownloadStatus, DownloadTask, UpdateDownloadInput},
    repositories::{
        chunks, downloads,
        history::{self, CreateHistory},
    },
    Database,
};
use crate::download::runtime::TaskControl;
use futures_util::StreamExt;
use reqwest::{header, header::HeaderMap, Client, Response, Url};
use serde::Serialize;
use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicI64, AtomicUsize, Ordering},
        Arc, Mutex as StdMutex,
    },
    time::{Duration, Instant, SystemTime},
};

const MAX_CHUNK_ATTEMPTS: usize = 8;

#[derive(Clone)]
struct AdaptiveThrottle {
    permits: Arc<Semaphore>,
    concurrency: Arc<AtomicUsize>,
    cooldown_until: Arc<StdMutex<Instant>>,
}

#[derive(Clone)]
struct BandwidthLimiter {
    bytes_per_second: u64,
    transferred: Arc<AtomicI64>,
    started: Instant,
}

impl BandwidthLimiter {
    fn new(bytes_per_second: i64) -> Self {
        Self {
            bytes_per_second: bytes_per_second.max(0) as u64,
            transferred: Arc::new(AtomicI64::new(0)),
            started: Instant::now(),
        }
    }
    async fn consume(&self, bytes: usize) {
        if self.bytes_per_second == 0 {
            return;
        }
        let total = self.transferred.fetch_add(bytes as i64, Ordering::SeqCst) + bytes as i64;
        let expected = Duration::from_secs_f64(total as f64 / self.bytes_per_second as f64);
        if expected > self.started.elapsed() {
            tokio::time::sleep(expected - self.started.elapsed()).await;
        }
    }
}

impl AdaptiveThrottle {
    fn new(connections: usize) -> Self {
        let connections = connections.clamp(1, 32);
        Self {
            permits: Arc::new(Semaphore::new(connections)),
            concurrency: Arc::new(AtomicUsize::new(connections)),
            cooldown_until: Arc::new(StdMutex::new(Instant::now())),
        }
    }

    async fn wait(&self) {
        let until = self
            .cooldown_until
            .lock()
            .map(|value| *value)
            .unwrap_or_else(|_| Instant::now());
        if until > Instant::now() {
            tokio::time::sleep_until(tokio::time::Instant::from_std(until)).await;
        }
    }

    fn limit(&self, delay: Duration) {
        if let Ok(mut until) = self.cooldown_until.lock() {
            *until = (*until).max(Instant::now() + delay);
        }
        let current = self.concurrency.load(Ordering::SeqCst);
        let target = (current / 2).max(1);
        let removed = self.permits.forget_permits(current.saturating_sub(target));
        if removed > 0 {
            self.concurrency.fetch_sub(removed, Ordering::SeqCst);
        }
    }
}
use tauri::{AppHandle, Emitter};
use tokio::{
    fs::{File, OpenOptions},
    io::AsyncWriteExt,
    sync::{Mutex as AsyncMutex, Semaphore},
};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub id: String,
    pub downloaded: i64,
    pub total: Option<i64>,
    pub speed: f64,
    pub status: DownloadStatus,
    pub error: Option<String>,
}

pub struct PreparedDownload {
    pub input: CreateDownloadInput,
    pub response: Response,
}

pub async fn prepare_with_headers(
    url: &str,
    root: &str,
    auto_organize: bool,
    request_headers: HeaderMap,
    max_connections: usize,
    max_parallel_downloads: usize,
    speed_limit_download: u64,
    resume_support: bool,
) -> Result<PreparedDownload, String> {
    let parsed = Url::parse(url).map_err(|_| "A URL informada é inválida.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Apenas URLs HTTP ou HTTPS são permitidas.".into());
    }
    if root.trim().is_empty() {
        return Err("Configure uma pasta principal antes de baixar.".into());
    }
    let client = Client::builder()
        .user_agent("SF Downloader/0.1")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|error| format!("Falha ao preparar conexão: {error}"))?;
    let response = client
        .get(parsed.clone())
        .headers(request_headers.clone())
        .send()
        .await
        .map_err(|error| format!("Falha ao conectar ao servidor: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "O servidor respondeu com HTTP {}.",
            response.status()
        ));
    }
    let file_name = safe_file_name(
        response
            .headers()
            .get(header::CONTENT_DISPOSITION)
            .and_then(|value| value.to_str().ok())
            .and_then(file_name_from_disposition)
            .or_else(|| {
                parsed
                    .path_segments()
                    .and_then(|mut parts| parts.next_back())
                    .filter(|name| !name.is_empty())
            })
            .unwrap_or("download.bin"),
    );
    let extension = Path::new(&file_name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_lowercase());
    let folder = if auto_organize {
        PathBuf::from(root).join(category_for_extension(extension.as_deref()))
    } else {
        PathBuf::from(root)
    };
    tokio::fs::create_dir_all(&folder)
        .await
        .map_err(|error| format!("Não foi possível criar a pasta de destino: {error}"))?;

    // Create the hidden temporary folder inside the target folder
    let temp_folder = folder.join(".sf-temp");
    tokio::fs::create_dir_all(&temp_folder)
        .await
        .map_err(|error| format!("Não foi possível criar a pasta temporária: {error}"))?;

    let final_path = available_path(&folder, &file_name);
    let temp_path = temp_folder.join(format!("{}.part", file_name));

    let size = response
        .content_length()
        .and_then(|value| i64::try_from(value).ok());
    let mime_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let etag = response
        .headers()
        .get(header::ETAG)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let last_modified = response
        .headers()
        .get(header::LAST_MODIFIED)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let mut supports_range = response
        .headers()
        .get(header::ACCEPT_RANGES)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("bytes"));
    if !supports_range && size.is_some_and(|value| value >= 2 * 1024 * 1024) {
        supports_range = client
            .get(parsed.clone())
            .headers(request_headers.clone())
            .header(header::RANGE, "bytes=0-0")
            .send()
            .await
            .is_ok_and(|probe| probe.status() == reqwest::StatusCode::PARTIAL_CONTENT);
    }

    // Force supports_range to false if the user disabled resume support
    if !resume_support {
        supports_range = false;
    }

    Ok(PreparedDownload {
        input: CreateDownloadInput {
            file_name,
            file_size: size,
            original_url: url.to_owned(),
            save_path: folder.to_string_lossy().into_owned(),
            temp_path: temp_path.to_string_lossy().into_owned(),
            final_path: final_path.to_string_lossy().into_owned(),
            mime_type,
            extension,
            supports_range,
            max_connections: max_connections.clamp(1, 32) as i64,
            max_parallel_downloads: max_parallel_downloads.clamp(1, 50) as i64,
            speed_limit_download: speed_limit_download.min(i64::MAX as u64) as i64,
            etag,
            last_modified,
        },
        response,
    })
}

pub async fn prepare_resume(
    task: &DownloadTask,
    offset: i64,
    request_headers: HeaderMap,
) -> Result<Response, String> {
    if offset < 0 || task.file_size.is_some_and(|size| offset > size) {
        return Err("O arquivo parcial possui um tamanho incompatível.".into());
    }
    let client = Client::builder()
        .user_agent("SF Downloader/0.1")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|error| format!("Falha ao preparar conexão: {error}"))?;
    let mut request = client.get(&task.current_url).headers(request_headers);
    if offset > 0 {
        request = request.header(header::RANGE, format!("bytes={offset}-"));
        if let Some(value) = task.etag.as_ref().or(task.last_modified.as_ref()) {
            request = request.header(header::IF_RANGE, value);
        }
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("Falha ao reconectar: {error}"))?;
    if offset > 0 && response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(
            "Este servidor não aceita retomada por HTTP Range. O arquivo parcial foi preservado."
                .into(),
        );
    }
    if offset > 0 {
        validate_content_range(&response, offset, task.file_size, None)?;
    }
    if offset == 0 && !response.status().is_success() {
        return Err(format!(
            "O servidor respondeu com HTTP {}.",
            response.status()
        ));
    }
    if let (Some(expected), Some(received)) = (
        &task.etag,
        response
            .headers()
            .get(header::ETAG)
            .and_then(|value| value.to_str().ok()),
    ) {
        if expected != received {
            return Err("O ETag mudou; a retomada foi bloqueada para evitar corrupção.".into());
        }
    }
    if let (Some(expected), Some(received)) = (
        &task.last_modified,
        response
            .headers()
            .get(header::LAST_MODIFIED)
            .and_then(|value| value.to_str().ok()),
    ) {
        if expected != received {
            return Err("O arquivo remoto foi modificado; a retomada foi bloqueada.".into());
        }
    }
    Ok(response)
}

pub async fn run(
    app: AppHandle,
    database: Database,
    task: DownloadTask,
    response: Response,
    control: TaskControl,
    offset: i64,
) {
    let started = Instant::now();
    let result = transfer(&app, &database, &task, response, &control, started, offset).await;
    if let Err(error) = result {
        let progress_label = format!("download-progress-{}", task.id);
        if let Some(window) = tauri::Manager::get_webview_window(&app, &progress_label) {
            let _ = window.close();
        }
        let paused = control.was_paused();
        let cancelled = control.was_cancelled();
        let status = if paused {
            DownloadStatus::Paused
        } else if cancelled {
            DownloadStatus::Cancelled
        } else {
            DownloadStatus::Failed
        };
        let (downloaded, average) = database
            .connect()
            .ok()
            .and_then(|connection| downloads::find(&connection, &task.id).ok().flatten())
            .map(|current| (current.total_downloaded, current.speed_average))
            .unwrap_or((0, 0.0));
        update_state(
            &database,
            &task.id,
            status.clone(),
            downloaded,
            0.0,
            average,
        );
        if !paused {
            record_history(
                &database,
                &task,
                status.as_str(),
                started.elapsed(),
                average,
            );
        }
        let _ = app.emit(
            "download-progress",
            DownloadProgress {
                id: task.id,
                downloaded,
                total: task.file_size,
                speed: 0.0,
                status,
                error: if paused || cancelled {
                    None
                } else {
                    Some(error)
                },
            },
        );
    }
}

pub async fn run_segmented(
    app: AppHandle,
    database: Database,
    task: DownloadTask,
    max_connections: usize,
    control: TaskControl,
    request_headers: HeaderMap,
) {
    let started = Instant::now();
    if let Err(error) = transfer_segmented(
        &app,
        &database,
        &task,
        max_connections,
        &control,
        started,
        request_headers,
    )
    .await
    {
        let progress_label = format!("download-progress-{}", task.id);
        if let Some(window) = tauri::Manager::get_webview_window(&app, &progress_label) {
            let _ = window.close();
        }
        let paused = control.was_paused();
        let cancelled = control.was_cancelled();
        let status = if paused {
            DownloadStatus::Paused
        } else if cancelled {
            DownloadStatus::Cancelled
        } else {
            DownloadStatus::Failed
        };
        let downloaded = database
            .connect()
            .ok()
            .and_then(|connection| chunks::list(&connection, &task.id).ok())
            .map(|items| items.iter().map(|chunk| chunk.downloaded_bytes).sum())
            .unwrap_or(0);
        update_state(&database, &task.id, status.clone(), downloaded, 0.0, 0.0);
        if !paused {
            record_history(&database, &task, status.as_str(), started.elapsed(), 0.0);
        }
        let _ = app.emit(
            "download-progress",
            DownloadProgress {
                id: task.id,
                downloaded,
                total: task.file_size,
                speed: 0.0,
                status,
                error: if paused || cancelled {
                    None
                } else {
                    Some(error)
                },
            },
        );
    }
}

async fn transfer_segmented(
    app: &AppHandle,
    database: &Database,
    task: &DownloadTask,
    max_connections: usize,
    control: &TaskControl,
    started: Instant,
    request_headers: HeaderMap,
) -> Result<(), String> {
    let total = task
        .file_size
        .ok_or_else(|| "Download segmentado exige tamanho conhecido.".to_string())?;
    let mut connection = database.connect()?;
    let mut plan = chunks::list(&connection, &task.id).map_err(|error| error.to_string())?;
    if plan.is_empty() {
        let count = adaptive_chunk_count(total, max_connections);
        plan = chunks::create_plan(&mut connection, &task.id, total, count)
            .map_err(|error| error.to_string())?;
    } else {
        chunks::reset_active(&connection, &task.id).map_err(|error| error.to_string())?;
    }
    let mut initial = 0_i64;
    for chunk in &mut plan {
        let actual = tokio::fs::metadata(chunk_path(&task.temp_path, chunk.index))
            .await
            .ok()
            .and_then(|metadata| i64::try_from(metadata.len()).ok())
            .unwrap_or(0)
            .min(chunk.end_byte - chunk.start_byte + 1);
        chunk.downloaded_bytes = actual;
        initial += actual;
        chunks::update_progress(
            &connection,
            &chunk.id,
            actual,
            if actual == chunk.end_byte - chunk.start_byte + 1 {
                "done"
            } else {
                "pending"
            },
        )
        .map_err(|error| error.to_string())?;
    }
    drop(connection);
    update_state(
        database,
        &task.id,
        DownloadStatus::Downloading,
        initial,
        0.0,
        task.speed_average,
    );
    let downloaded = Arc::new(AtomicI64::new(initial));
    let client = Client::builder()
        .user_agent("SF Downloader/0.1")
        .redirect(reqwest::redirect::Policy::limited(10))
        .pool_max_idle_per_host(max_connections)
        .tcp_nodelay(true)
        .build()
        .map_err(|error| error.to_string())?;
    let mut workers = Vec::new();
    let throttle = AdaptiveThrottle::new(max_connections);
    let bandwidth = BandwidthLimiter::new(task.speed_limit_download);
    let pending: VecDeque<_> = plan
        .clone()
        .into_iter()
        .filter(|chunk| chunk.downloaded_bytes < chunk.end_byte - chunk.start_byte + 1)
        .collect();
    let worker_count = max_connections.clamp(1, 32).min(pending.len().max(1));
    let queue = Arc::new(AsyncMutex::new(pending));
    let first_error = Arc::new(StdMutex::new(None::<String>));
    for _ in 0..worker_count {
        let (
            client,
            database,
            task,
            control,
            app,
            downloaded,
            throttle,
            request_headers,
            bandwidth,
        ) = (
            client.clone(),
            database.clone(),
            task.clone(),
            control.clone(),
            app.clone(),
            downloaded.clone(),
            throttle.clone(),
            request_headers.clone(),
            bandwidth.clone(),
        );
        let queue = queue.clone();
        let first_error = first_error.clone();
        workers.push(tauri::async_runtime::spawn(async move {
            loop {
                if control.cancellation.is_cancelled() {
                    break;
                }
                let Some(chunk) = queue.lock().await.pop_front() else {
                    break;
                };
                if let Err(error) = download_piece(
                    client.clone(),
                    database.clone(),
                    task.clone(),
                    chunk,
                    control.clone(),
                    app.clone(),
                    downloaded.clone(),
                    started,
                    request_headers.clone(),
                    throttle.clone(),
                    bandwidth.clone(),
                )
                .await
                {
                    if !control.was_paused() && !control.was_cancelled() {
                        if let Ok(mut first) = first_error.lock() {
                            if first.is_none() {
                                *first = Some(error);
                            }
                        }
                        control.abort();
                    }
                    break;
                }
            }
        }));
    }
    for worker in workers {
        if let Err(error) = worker.await {
            if let Ok(mut first) = first_error.lock() {
                if first.is_none() {
                    *first = Some(format!("Worker encerrado: {error}"));
                }
            }
            control.abort();
        }
    }
    let failure = first_error.lock().ok().and_then(|mut error| error.take());
    if let Some(error) = failure {
        return Err(error);
    }
    if control.cancellation.is_cancelled() {
        return Err("Download interrompido pelo usuário.".into());
    }
    let plan = {
        let connection = database.connect()?;
        chunks::list(&connection, &task.id).map_err(|error| error.to_string())?
    };
    let mut output = File::create(&task.temp_path)
        .await
        .map_err(|error| error.to_string())?;
    for chunk in &plan {
        let mut input = File::open(chunk_path(&task.temp_path, chunk.index))
            .await
            .map_err(|error| format!("Parte {} ausente: {error}", chunk.index))?;
        let copied = tokio::io::copy(&mut input, &mut output)
            .await
            .map_err(|error| error.to_string())?;
        if copied as i64 != chunk.end_byte - chunk.start_byte + 1 {
            return Err(format!("Parte {} incompleta.", chunk.index));
        }
    }
    output.flush().await.map_err(|error| error.to_string())?;
    drop(output);
    tokio::fs::rename(&task.temp_path, &task.final_path)
        .await
        .map_err(|error| error.to_string())?;
    for chunk in &plan {
        let _ = tokio::fs::remove_file(chunk_path(&task.temp_path, chunk.index)).await;
    }
    // Attempt to remove the temporary .sf-temp folder if it's empty
    if let Some(temp_folder) = Path::new(&task.temp_path).parent() {
        let _ = tokio::fs::remove_dir(temp_folder).await;
    }
    let elapsed = started.elapsed();
    let speed = total as f64 / elapsed.as_secs_f64().max(0.001);
    update_state(
        database,
        &task.id,
        DownloadStatus::Completed,
        total,
        0.0,
        speed,
    );
    record_history(database, task, "completed", elapsed, speed);
    let _ = app.emit(
        "download-progress",
        DownloadProgress {
            id: task.id.clone(),
            downloaded: total,
            total: Some(total),
            speed: 0.0,
            status: DownloadStatus::Completed,
            error: None,
        },
    );
    let progress_label = format!("download-progress-{}", task.id);
    if let Some(window) = tauri::Manager::get_webview_window(app, &progress_label) {
        let _ = window.close();
    }
    let _ = crate::commands::transfer::open_complete_window(app.clone(), task.id.clone()).await;
    Ok(())
}

async fn download_piece(
    client: Client,
    database: Database,
    task: DownloadTask,
    mut chunk: crate::database::models::DownloadChunk,
    control: TaskControl,
    app: AppHandle,
    total_downloaded: Arc<AtomicI64>,
    started: Instant,
    request_headers: HeaderMap,
    throttle: AdaptiveThrottle,
    bandwidth: BandwidthLimiter,
) -> Result<(), String> {
    let length = chunk.end_byte - chunk.start_byte + 1;
    let path = chunk_path(&task.temp_path, chunk.index);
    for attempt in 0..MAX_CHUNK_ATTEMPTS {
        if control.cancellation.is_cancelled() {
            return Err("Download interrompido pelo usuário.".into());
        }
        let start = chunk.start_byte + chunk.downloaded_bytes;
        let mut request = client
            .get(&task.current_url)
            .headers(request_headers.clone())
            .header(header::RANGE, format!("bytes={start}-{}", chunk.end_byte));
        if let Some(value) = task.etag.as_ref().or(task.last_modified.as_ref()) {
            request = request.header(header::IF_RANGE, value);
        }
        throttle.wait().await;
        let permit = throttle
            .permits
            .acquire()
            .await
            .map_err(|error| error.to_string())?;
        let response = match request.send().await {
            Ok(response) => response,
            Err(error) => {
                drop(permit);
                if attempt + 1 == MAX_CHUNK_ATTEMPTS {
                    return Err(error.to_string());
                }
                tokio::time::sleep(retry_delay(None, attempt, chunk.index)).await;
                continue;
            }
        };
        let status = response.status();
        if matches!(status.as_u16(), 408 | 429 | 500 | 502 | 503 | 504) {
            let delay = retry_delay(Some(&response), attempt, chunk.index);
            drop(permit);
            if matches!(status.as_u16(), 429 | 503) {
                throttle.limit(delay);
            }
            if attempt + 1 == MAX_CHUNK_ATTEMPTS {
                return Err(format!(
                    "Servidor indisponível após {MAX_CHUNK_ATTEMPTS} tentativas (HTTP {status})."
                ));
            }
            tokio::time::sleep(delay).await;
            continue;
        }
        if status != reqwest::StatusCode::PARTIAL_CONTENT {
            return Err(format!("Servidor recusou HTTP Range ({status})"));
        }
        let response_length =
            validate_content_range(&response, start, task.file_size, Some(chunk.end_byte))?;
        validate_remote_identity(&response, &task)?;
        let result = async {
            let mut file = OpenOptions::new().create(true).append(true).open(&path).await.map_err(|error| error.to_string())?;
            let mut stream = response.bytes_stream(); let mut last_save = Instant::now(); let mut response_downloaded = 0_i64;
            while let Some(next) = tokio::select! { _ = control.cancellation.cancelled() => return Err("Download interrompido pelo usuário.".into()), value = stream.next() => value } {
                let data = next.map_err(|error| error.to_string())?; let remaining = (length - chunk.downloaded_bytes).min(response_length-response_downloaded).max(0) as usize;
                if data.len() > remaining { return Err("O servidor enviou mais bytes do que declarou no Content-Range.".into()); }
                let slice = &data[..];
                file.write_all(slice).await.map_err(|error| error.to_string())?; chunk.downloaded_bytes += slice.len() as i64; response_downloaded += slice.len() as i64;
                bandwidth.consume(slice.len()).await;
                let aggregate = total_downloaded.fetch_add(slice.len() as i64, Ordering::SeqCst) + slice.len() as i64; let speed = aggregate as f64 / started.elapsed().as_secs_f64().max(0.001);
                let _ = app.emit("download-progress", DownloadProgress { id: task.id.clone(), downloaded: aggregate, total: task.file_size, speed, status: DownloadStatus::Downloading, error: None });
                if last_save.elapsed() >= Duration::from_millis(500) { if let Ok(connection) = database.connect() { let _ = chunks::update_progress(&connection, &chunk.id, chunk.downloaded_bytes, "downloading"); } update_state(&database, &task.id, DownloadStatus::Downloading, aggregate, speed, speed); last_save = Instant::now(); }
                if chunk.downloaded_bytes >= length { break; }
            }
            file.flush().await.map_err(|error| error.to_string())?;
            if response_downloaded != response_length { return Err(format!("Resposta parcial incompleta: esperado {response_length}, recebido {response_downloaded}.")); }
            if chunk.downloaded_bytes != length { return Err("Resposta terminou antes do fim da faixa.".into()); }
            if let Ok(connection) = database.connect() { chunks::update_progress(&connection, &chunk.id, chunk.downloaded_bytes, "done").map_err(|error| error.to_string())?; }
            Ok(())
        }.await;
        drop(permit);
        if result.is_ok() {
            return result;
        }
        if attempt + 1 < MAX_CHUNK_ATTEMPTS {
            tokio::time::sleep(retry_delay(None, attempt, chunk.index)).await;
        } else {
            return result;
        }
    }
    unreachable!()
}

fn adaptive_chunk_count(total: i64, connections: usize) -> usize {
    const MIB: i64 = 1024 * 1024;
    let target = match total {
        value if value <= 64 * MIB => 2 * MIB,
        value if value <= 1024 * MIB => 8 * MIB,
        value if value <= 8 * 1024 * MIB => 32 * MIB,
        _ => 64 * MIB,
    };
    let connections = connections.clamp(1, 32);
    let natural = ((total + target - 1) / target) as usize;
    let maximum_by_size = ((total + MIB - 1) / MIB) as usize;
    natural
        .max(connections * 4)
        .min(connections * 16)
        .min(maximum_by_size)
        .max(2)
}

fn retry_delay(response: Option<&Response>, attempt: usize, chunk_index: i64) -> Duration {
    if let Some(value) = response
        .and_then(|response| response.headers().get(header::RETRY_AFTER))
        .and_then(|value| value.to_str().ok())
    {
        if let Ok(seconds) = value.trim().parse::<u64>() {
            return Duration::from_secs(seconds.clamp(1, 120));
        }
        if let Ok(date) = httpdate::parse_http_date(value) {
            if let Ok(delay) = date.duration_since(SystemTime::now()) {
                return delay.clamp(Duration::from_secs(1), Duration::from_secs(120));
            }
        }
    }
    let exponential = 1_u64 << attempt.min(5);
    let jitter = ((chunk_index.unsigned_abs() + attempt as u64 * 17) % 700) + 100;
    Duration::from_millis(exponential * 500 + jitter)
}

fn parse_content_range(value: &str) -> Option<(i64, i64, i64)> {
    let range = value.trim().strip_prefix("bytes ")?;
    let (bounds, total) = range.split_once('/')?;
    let (start, end) = bounds.split_once('-')?;
    let (start, end, total) = (start.parse().ok()?, end.parse().ok()?, total.parse().ok()?);
    (start >= 0 && end >= start && total > end).then_some((start, end, total))
}

fn validate_content_range(
    response: &Response,
    expected_start: i64,
    expected_total: Option<i64>,
    requested_end: Option<i64>,
) -> Result<i64, String> {
    let raw = response
        .headers()
        .get(header::CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "Resposta 206 sem Content-Range.".to_string())?;
    let (start, end, total) =
        parse_content_range(raw).ok_or_else(|| format!("Content-Range inválido: {raw}"))?;
    if start != expected_start {
        return Err(format!(
            "Faixa incorreta: solicitado início {expected_start}, servidor respondeu {start}."
        ));
    }
    if requested_end.is_some_and(|requested| end > requested) {
        return Err(format!("Faixa excedeu o limite solicitado: {end}."));
    }
    if let Some(expected) = expected_total {
        if total != expected {
            return Err(format!(
                "Tamanho remoto mudou: esperado {expected}, recebido {total}."
            ));
        }
    }
    let length = end - start + 1;
    if response
        .content_length()
        .is_some_and(|received| received != length as u64)
    {
        return Err(format!(
            "Content-Length incompatível com Content-Range: esperado {length}."
        ));
    }
    Ok(length)
}

fn validate_remote_identity(response: &Response, task: &DownloadTask) -> Result<(), String> {
    if let (Some(expected), Some(received)) = (
        &task.etag,
        response
            .headers()
            .get(header::ETAG)
            .and_then(|value| value.to_str().ok()),
    ) {
        if expected != received {
            return Err("O ETag mudou durante o download.".into());
        }
    }
    if let (Some(expected), Some(received)) = (
        &task.last_modified,
        response
            .headers()
            .get(header::LAST_MODIFIED)
            .and_then(|value| value.to_str().ok()),
    ) {
        if expected != received {
            return Err("O arquivo remoto foi modificado durante o download.".into());
        }
    }
    Ok(())
}

fn chunk_path(temp_path: &str, index: i64) -> PathBuf {
    PathBuf::from(format!("{temp_path}.chunk-{index}"))
}

async fn transfer(
    app: &AppHandle,
    database: &Database,
    task: &DownloadTask,
    response: Response,
    control: &TaskControl,
    started: Instant,
    offset: i64,
) -> Result<(), String> {
    let mut file = if offset > 0 {
        OpenOptions::new().append(true).open(&task.temp_path).await
    } else {
        File::create(&task.temp_path).await
    }
    .map_err(|error| format!("Não foi possível abrir o arquivo parcial: {error}"))?;
    let mut stream = response.bytes_stream();
    let mut downloaded = offset;
    let mut last_persist = Instant::now();
    let bandwidth = BandwidthLimiter::new(task.speed_limit_download);
    update_state(
        database,
        &task.id,
        DownloadStatus::Downloading,
        offset,
        0.0,
        task.speed_average,
    );
    loop {
        let next = tokio::select! {
            _ = control.cancellation.cancelled() => return Err("Download interrompido pelo usuário.".into()),
            next = stream.next() => next,
        };
        let Some(chunk) = next else { break };
        let bytes = chunk.map_err(|error| format!("Falha durante a transferência: {error}"))?;
        file.write_all(&bytes)
            .await
            .map_err(|error| format!("Falha ao gravar o arquivo: {error}"))?;
        bandwidth.consume(bytes.len()).await;
        downloaded += i64::try_from(bytes.len()).unwrap_or(0);
        let elapsed = started.elapsed().as_secs_f64().max(0.001);
        let speed = (downloaded - offset) as f64 / elapsed;
        if last_persist.elapsed() >= Duration::from_millis(500) {
            update_state(
                database,
                &task.id,
                DownloadStatus::Downloading,
                downloaded,
                speed,
                speed,
            );
            last_persist = Instant::now();
        }
        let _ = app.emit(
            "download-progress",
            DownloadProgress {
                id: task.id.clone(),
                downloaded,
                total: task.file_size,
                speed,
                status: DownloadStatus::Downloading,
                error: None,
            },
        );
    }
    file.flush()
        .await
        .map_err(|error| format!("Falha ao finalizar o arquivo: {error}"))?;
    drop(file);
    tokio::fs::rename(&task.temp_path, &task.final_path)
        .await
        .map_err(|error| format!("Falha ao mover o arquivo concluído: {error}"))?;
    // Attempt to remove the temporary .sf-temp folder if it's empty
    if let Some(temp_folder) = Path::new(&task.temp_path).parent() {
        let _ = tokio::fs::remove_dir(temp_folder).await;
    }
    let elapsed = started.elapsed();
    let average = (downloaded - offset) as f64 / elapsed.as_secs_f64().max(0.001);
    update_state(
        database,
        &task.id,
        DownloadStatus::Completed,
        downloaded,
        0.0,
        average,
    );
    record_history(database, task, "completed", elapsed, average);
    let _ = app.emit(
        "download-progress",
        DownloadProgress {
            id: task.id.clone(),
            downloaded,
            total: task.file_size.or(Some(downloaded)),
            speed: 0.0,
            status: DownloadStatus::Completed,
            error: None,
        },
    );
    let progress_label = format!("download-progress-{}", task.id);
    if let Some(window) = tauri::Manager::get_webview_window(app, &progress_label) {
        let _ = window.close();
    }
    let _ = crate::commands::transfer::open_complete_window(app.clone(), task.id.clone()).await;
    Ok(())
}

fn update_state(
    database: &Database,
    id: &str,
    status: DownloadStatus,
    downloaded: i64,
    current: f64,
    average: f64,
) {
    if let Ok(connection) = database.connect() {
        let _ = downloads::update(
            &connection,
            UpdateDownloadInput {
                id: id.to_owned(),
                status,
                total_downloaded: downloaded,
                speed_current: current,
                speed_average: average,
            },
        );
    }
}

fn record_history(
    database: &Database,
    task: &DownloadTask,
    status: &str,
    duration: Duration,
    average: f64,
) {
    if let Ok(connection) = database.connect() {
        let _ = history::create(
            &connection,
            CreateHistory {
                file_name: &task.file_name,
                file_size: task.file_size,
                status,
                source_url: &task.original_url,
                path: &task.final_path,
                duration_seconds: duration.as_secs() as i64,
                average_speed: average,
            },
        );
    }
}

fn file_name_from_disposition(value: &str) -> Option<&str> {
    value
        .split(';')
        .find_map(|part| part.trim().strip_prefix("filename="))
        .map(|name| name.trim_matches(['\"', '\'']))
}
fn safe_file_name(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|character| {
            if "<>:\"/\\|?*".contains(character) || character.is_control() {
                '_'
            } else {
                character
            }
        })
        .collect();
    let cleaned = cleaned.trim_matches([' ', '.']);
    if cleaned.is_empty() {
        "download.bin".into()
    } else {
        cleaned.chars().take(180).collect()
    }
}
fn category_for_extension(extension: Option<&str>) -> &'static str {
    match extension.unwrap_or("") {
        "jpg" | "jpeg" | "png" | "webp" | "gif" => "Imagens",
        "mp4" | "mkv" | "mov" | "avi" | "webm" => "Vídeos",
        "mp3" | "wav" | "flac" | "ogg" => "Áudios",
        "pdf" | "docx" | "xlsx" | "pptx" | "txt" => "Documentos",
        "zip" | "rar" | "7z" | "tar" | "gz" => "Compactados",
        "exe" | "msi" | "apk" | "bat" => "Aplicativos",
        "torrent" => "Torrents",
        _ => "Outros",
    }
}
fn available_path(folder: &Path, file_name: &str) -> PathBuf {
    let original = folder.join(file_name);
    if !original.exists() {
        return original;
    }
    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("download");
    let extension = path.extension().and_then(|value| value.to_str());
    for index in 1..10_000 {
        let candidate = match extension {
            Some(ext) => folder.join(format!("{stem} ({index}).{ext}")),
            None => folder.join(format!("{stem} ({index})")),
        };
        if !candidate.exists() {
            return candidate;
        }
    }
    folder.join(format!("{}-{}", uuid::Uuid::new_v4(), file_name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_server_file_names() {
        assert_eq!(safe_file_name("../relatorio?.pdf"), "_relatorio_.pdf");
    }

    #[test]
    fn resolves_known_categories() {
        assert_eq!(category_for_extension(Some("zip")), "Compactados");
        assert_eq!(category_for_extension(Some("unknown")), "Outros");
    }

    #[test]
    fn parses_valid_content_range() {
        assert_eq!(
            parse_content_range("bytes 1024-2047/4096"),
            Some((1024, 2047, 4096))
        );
        assert_eq!(parse_content_range("bytes 10-5/20"), None);
        assert_eq!(parse_content_range("bytes */4096"), None);
    }

    #[test]
    fn adaptive_plan_creates_work_queue_without_tiny_chunks() {
        assert_eq!(adaptive_chunk_count(2 * 1024 * 1024, 8), 2);
        let large = adaptive_chunk_count(10 * 1024 * 1024 * 1024, 8);
        assert!((32..=128).contains(&large));
    }
}
