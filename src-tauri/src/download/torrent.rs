use std::path::{Path, PathBuf};
use std::sync::Arc;
use librqbit::{AddTorrent, AddTorrentOptions, ManagedTorrent, Session, SessionOptions};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentFileItem {
    pub index: usize,
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedTorrentMeta {
    pub name: String,
    pub info_hash: String,
    pub total_size: u64,
    pub files: Vec<TorrentFileItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentRuntimeStats {
    pub total_downloaded: u64,
    pub total_uploaded: u64,
    pub speed_download: f64,
    pub speed_upload: f64,
    pub seeds: u32,
    pub peers: u32,
    pub is_completed: bool,
}

pub struct TorrentEngine {
    session: Arc<RwLock<Option<Arc<Session>>>>,
}

impl TorrentEngine {
    pub fn new() -> Self {
        Self {
            session: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn get_session(&self, default_output_dir: &Path) -> Result<Arc<Session>, String> {
        let mut guard = self.session.write().await;
        if let Some(ref s) = *guard {
            return Ok(s.clone());
        }

        let opts = SessionOptions {
            disable_dht: false,
            persistence: None,
            ..Default::default()
        };

        let session = Session::new_with_opts(default_output_dir.to_path_buf(), opts)
            .await
            .map_err(|e| format!("Falha ao inicializar motor Torrent: {e}"))?;

        *guard = Some(session.clone());
        Ok(session)
    }

    pub async fn parse_torrent(&self, source: &str) -> Result<ParsedTorrentMeta, String> {
        if source.starts_with("magnet:") {
            let magnet = librqbit::Magnet::parse(source).map_err(|e| format!("Magnet Link inválido: {e}"))?;
            let name = magnet.name.clone().unwrap_or_else(|| "Torrent Magnet".into());
            let info_hash = format!("{:?}", magnet.as_id20());
            Ok(ParsedTorrentMeta {
                name,
                info_hash,
                total_size: 0,
                files: vec![],
            })
        } else {
            let path = PathBuf::from(source);
            if !path.exists() {
                return Err("Arquivo .torrent não encontrado no disco".into());
            }
            let bytes = std::fs::read(&path).map_err(|e| format!("Erro ao ler arquivo: {e}"))?;
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("Torrent").to_string();
            let total_size = bytes.len() as u64;

            Ok(ParsedTorrentMeta {
                name,
                info_hash: format!("{:?}", uuid::Uuid::new_v4()),
                total_size,
                files: vec![],
            })
        }
    }

    pub async fn start_torrent_handle(
        &self,
        session: &Arc<Session>,
        source: &str,
        output_dir: &Path,
    ) -> Result<Arc<ManagedTorrent>, String> {
        let opts = AddTorrentOptions {
            output_folder: Some(output_dir.to_string_lossy().to_string()),
            ..Default::default()
        };

        let response = if source.starts_with("magnet:") {
            session
                .add_torrent(AddTorrent::from_url(source), Some(opts))
                .await
                .map_err(|e| format!("Falha ao adicionar torrent: {e}"))?
        } else {
            let bytes = std::fs::read(source).map_err(|e| format!("Erro ao ler .torrent: {e}"))?;
            session
                .add_torrent(AddTorrent::from_bytes(bytes), Some(opts))
                .await
                .map_err(|e| format!("Falha ao adicionar torrent: {e}"))?
        };

        response.into_handle().ok_or_else(|| "Torrents em lista não suportados".to_string())
    }
}

pub async fn run_torrent(
    app: tauri::AppHandle,
    database: crate::database::Database,
    task: crate::database::models::DownloadTask,
    control: crate::download::runtime::TaskControl,
) {
    use tauri::Emitter;
    use crate::database::models::{DownloadStatus, UpdateDownloadInput};
    use crate::database::repositories::downloads;

    let connection = match database.connect() {
        Ok(c) => c,
        Err(_) => return,
    };

    let _ = downloads::update_progress(
        &connection,
        &UpdateDownloadInput {
            id: task.id.clone(),
            status: DownloadStatus::Downloading,
            total_downloaded: task.total_downloaded,
            speed_current: 0.0,
            speed_average: 0.0,
            seeds: None,
            peers: None,
            upload_speed: None,
            total_uploaded: None,
        },
    );

    let _ = app.emit(
        "download-progress",
        serde_json::json!({
            "id": task.id,
            "downloaded": task.total_downloaded,
            "total": task.file_size,
            "speed": 0.0,
            "status": "downloading",
            "error": null
        }),
    );

    let engine = TorrentEngine::new();
    let save_dir = PathBuf::from(&task.save_path);
    let session = match engine.get_session(&save_dir).await {
        Ok(s) => s,
        Err(e) => {
            let _ = downloads::update_progress(
                &connection,
                &UpdateDownloadInput {
                    id: task.id.clone(),
                    status: DownloadStatus::Failed,
                    total_downloaded: 0,
                    speed_current: 0.0,
                    speed_average: 0.0,
                    seeds: None,
                    peers: None,
                    upload_speed: None,
                    total_uploaded: None,
                },
            );
            let _ = app.emit(
                "download-progress",
                serde_json::json!({
                    "id": task.id,
                    "downloaded": 0,
                    "total": task.file_size,
                    "speed": 0.0,
                    "status": "failed",
                    "error": e
                }),
            );
            return;
        }
    };

    let handle = match engine.start_torrent_handle(&session, &task.original_url, &save_dir).await {
        Ok(h) => h,
        Err(e) => {
            let _ = downloads::update_progress(
                &connection,
                &UpdateDownloadInput {
                    id: task.id.clone(),
                    status: DownloadStatus::Failed,
                    total_downloaded: 0,
                    speed_current: 0.0,
                    speed_average: 0.0,
                    seeds: None,
                    peers: None,
                    upload_speed: None,
                    total_uploaded: None,
                },
            );
            let _ = app.emit(
                "download-progress",
                serde_json::json!({
                    "id": task.id,
                    "downloaded": 0,
                    "total": task.file_size,
                    "speed": 0.0,
                    "status": "failed",
                    "error": e
                }),
            );
            return;
        }
    };

    let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(500));
    loop {
        interval.tick().await;

        if control.was_paused() {
            let _ = downloads::update_progress(
                &connection,
                &UpdateDownloadInput {
                    id: task.id.clone(),
                    status: DownloadStatus::Paused,
                    total_downloaded: task.total_downloaded,
                    speed_current: 0.0,
                    speed_average: 0.0,
                    seeds: None,
                    peers: None,
                    upload_speed: None,
                    total_uploaded: None,
                },
            );
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
            break;
        }

        if control.was_cancelled() {
            let _ = downloads::update_progress(
                &connection,
                &UpdateDownloadInput {
                    id: task.id.clone(),
                    status: DownloadStatus::Cancelled,
                    total_downloaded: task.total_downloaded,
                    speed_current: 0.0,
                    speed_average: 0.0,
                    seeds: None,
                    peers: None,
                    upload_speed: None,
                    total_uploaded: None,
                },
            );
            let _ = app.emit(
                "download-progress",
                serde_json::json!({
                    "id": task.id,
                    "downloaded": task.total_downloaded,
                    "total": task.file_size,
                    "speed": 0.0,
                    "status": "cancelled",
                    "error": null
                }),
            );
            break;
        }

        let stats = handle.stats();
        let downloaded = stats.progress_bytes as i64;
        let total_size = if stats.total_bytes > 0 {
            Some(stats.total_bytes as i64)
        } else {
            task.file_size
        };

        let speed_bytes = stats
            .live
            .as_ref()
            .map(|l| (l.download_speed.mbps * 1024.0 * 1024.0 / 8.0) as f64)
            .unwrap_or(0.0);

        let upload_speed = stats
            .live
            .as_ref()
            .map(|l| (l.upload_speed.mbps * 1024.0 * 1024.0 / 8.0) as f64)
            .unwrap_or(0.0);

        let seeds = stats
            .live
            .as_ref()
            .map(|l| l.snapshot.peer_stats.live as i64)
            .unwrap_or(0);

        let peers = stats
            .live
            .as_ref()
            .map(|l| (l.snapshot.peer_stats.live + l.snapshot.peer_stats.connecting) as i64)
            .unwrap_or(0);

        let status = if stats.finished {
            DownloadStatus::Completed
        } else {
            DownloadStatus::Downloading
        };

        let _ = downloads::update_progress(
            &connection,
            &UpdateDownloadInput {
                id: task.id.clone(),
                status,
                total_downloaded: downloaded,
                speed_current: speed_bytes,
                speed_average: speed_bytes,
                seeds: Some(seeds),
                peers: Some(peers),
                upload_speed: Some(upload_speed),
                total_uploaded: Some(stats.uploaded_bytes as i64),
            },
        );

        let _ = app.emit(
            "download-progress",
            serde_json::json!({
                "id": task.id,
                "downloaded": downloaded,
                "total": total_size,
                "speed": speed_bytes,
                "status": if stats.finished { "completed" } else { "downloading" },
                "error": stats.error.clone()
            }),
        );

        if stats.finished {
            break;
        }
    }
}
