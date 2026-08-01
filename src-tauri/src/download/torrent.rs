use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use librqbit::{AddTorrent, AddTorrentOptions, ManagedTorrent, Session, SessionOptions};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TorrentFileItem {
    pub index: usize,
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum TorrentMetadataResponse {
    #[serde(rename = "ready")]
    Ready {
        info_hash: String,
        name: String,
        total_size: u64,
        files: Vec<TorrentFileItem>,
    },
    #[serde(rename = "fetchingMetadata")]
    FetchingMetadata {
        info_hash: String,
        name: Option<String>,
    },
}

impl TorrentMetadataResponse {
    pub fn name(&self) -> Option<&str> {
        match self {
            Self::Ready { name, .. } => Some(name),
            Self::FetchingMetadata { name, .. } => name.as_deref(),
        }
    }

    pub fn info_hash(&self) -> &str {
        match self {
            Self::Ready { info_hash, .. } => info_hash,
            Self::FetchingMetadata { info_hash, .. } => info_hash,
        }
    }

    pub fn total_size(&self) -> Option<u64> {
        match self {
            Self::Ready { total_size, .. } => Some(*total_size),
            Self::FetchingMetadata { .. } => None,
        }
    }

    pub fn files(&self) -> Option<&[TorrentFileItem]> {
        match self {
            Self::Ready { files, .. } => Some(files.as_slice()),
            Self::FetchingMetadata { .. } => None,
        }
    }
}

#[derive(Debug, Clone)]
pub enum BencodeValue {
    Int(i64),
    Bytes(Vec<u8>),
    List(Vec<BencodeValue>),
    Dict(BTreeMap<Vec<u8>, BencodeValue>),
}

pub fn parse_bencode(bytes: &[u8]) -> Result<BencodeValue, String> {
    let mut pos = 0;
    let val = parse_bencode_value(bytes, &mut pos)?;
    if pos != bytes.len() {
        // Warning if extra bytes exist, but return parsed root value
    }
    Ok(val)
}

fn parse_bencode_value(bytes: &[u8], pos: &mut usize) -> Result<BencodeValue, String> {
    if *pos >= bytes.len() {
        return Err("Não foi possível ler os metadados deste torrent.".into());
    }
    match bytes[*pos] {
        b'i' => {
            *pos += 1;
            let start = *pos;
            while *pos < bytes.len() && bytes[*pos] != b'e' {
                *pos += 1;
            }
            if *pos >= bytes.len() {
                return Err("Não foi possível ler os metadados deste torrent.".into());
            }
            let s = std::str::from_utf8(&bytes[start..*pos])
                .map_err(|_| "Não foi possível ler os metadados deste torrent.".to_string())?;
            let val = s
                .parse::<i64>()
                .map_err(|_| "Não foi possível ler os metadados deste torrent.".to_string())?;
            *pos += 1; // skip 'e'
            Ok(BencodeValue::Int(val))
        }
        b'l' => {
            *pos += 1;
            let mut list = Vec::new();
            while *pos < bytes.len() && bytes[*pos] != b'e' {
                list.push(parse_bencode_value(bytes, pos)?);
            }
            if *pos >= bytes.len() {
                return Err("Não foi possível ler os metadados deste torrent.".into());
            }
            *pos += 1; // skip 'e'
            Ok(BencodeValue::List(list))
        }
        b'd' => {
            *pos += 1;
            let mut dict = BTreeMap::new();
            while *pos < bytes.len() && bytes[*pos] != b'e' {
                let key_val = parse_bencode_value(bytes, pos)?;
                let key = match key_val {
                    BencodeValue::Bytes(b) => b,
                    _ => return Err("Não foi possível ler os metadados deste torrent.".into()),
                };
                let val = parse_bencode_value(bytes, pos)?;
                dict.insert(key, val);
            }
            if *pos >= bytes.len() {
                return Err("Não foi possível ler os metadados deste torrent.".into());
            }
            *pos += 1; // skip 'e'
            Ok(BencodeValue::Dict(dict))
        }
        b'0'..=b'9' => {
            let start = *pos;
            while *pos < bytes.len() && bytes[*pos] != b':' {
                *pos += 1;
            }
            if *pos >= bytes.len() {
                return Err("Não foi possível ler os metadados deste torrent.".into());
            }
            let len_str = std::str::from_utf8(&bytes[start..*pos])
                .map_err(|_| "Não foi possível ler os metadados deste torrent.".to_string())?;
            let len = len_str
                .parse::<usize>()
                .map_err(|_| "Não foi possível ler os metadados deste torrent.".to_string())?;
            *pos += 1; // skip ':'
            if *pos + len > bytes.len() {
                return Err("Não foi possível ler os metadados deste torrent.".into());
            }
            let data = bytes[*pos..*pos + len].to_vec();
            *pos += len;
            Ok(BencodeValue::Bytes(data))
        }
        _ => Err("Não foi possível ler os metadados deste torrent.".into()),
    }
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

    pub async fn parse_torrent(&self, source: &str) -> Result<TorrentMetadataResponse, String> {
        self.parse_torrent_with_app(None, None, source).await
    }

    pub async fn parse_torrent_with_app(
        &self,
        app: Option<tauri::AppHandle>,
        token: Option<&str>,
        source: &str,
    ) -> Result<TorrentMetadataResponse, String> {
        println!("[TORRENT_LOG][BACKEND_RECEIVE] Argumento recebido: '{}'", source);

        if source.starts_with("magnet:") {
            println!("[MAGNET_RECEIVED] Magnet link recebido: {}", source);
            let magnet = librqbit::Magnet::parse(source)
                .map_err(|_| "Não foi possível ler os metadados deste torrent.".to_string())?;
            let info_hash = format!("{:?}", magnet.as_id20());
            let name = magnet.name.clone();

            println!("[MAGNET_PARSED] Magnet parsed: info_hash={}, name={:?}", info_hash, name);

            // Iniciar busca de metadados em background
            if let Some(app_handle) = app {
                let token_str = token.unwrap_or("").to_string();
                let source_str = source.to_string();
                let info_hash_str = info_hash.clone();
                let name_str = name.clone();

                tokio::spawn(async move {
                    use tauri::Emitter;
                    println!("[MAGNET_WAITING_METADATA] Aguardando metadados dos peers P2P para info_hash={}...", info_hash_str);
                    let temp_dir = std::env::temp_dir();
                    let engine = TorrentEngine::new();
                    if let Ok(session) = engine.get_session(&temp_dir).await {
                        println!("[MAGNET_ADDED_TO_SESSION] Adicionado à sessão P2P temporária para busca de metadados.");
                        if let Ok(handle) = engine.start_torrent_handle(&session, &source_str, &temp_dir).await {
                            // Tentar buscar metadados por até 25 segundos
                            for _ in 0..50 {
                                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                                let stats = handle.stats();
                                if stats.total_bytes > 0 {
                                    let meta_name = handle.name().unwrap_or_else(|| name_str.clone().unwrap_or_else(|| "Torrent".into()));
                                    let total_size = stats.total_bytes as u64;
                                    let files = vec![TorrentFileItem {
                                        index: 0,
                                        path: meta_name.clone(),
                                        size: total_size,
                                    }];

                                    println!("[MAGNET_METADATA_RECEIVED] Metadados recebidos do swarm P2P!");
                                    println!(
                                        "[MAGNET_METADATA_RECEIVED] info_hash={}, nome='{}', total_size={} bytes, files.len()={}",
                                        info_hash_str, meta_name, total_size, files.len()
                                    );
                                    for f in &files {
                                        println!(
                                            "[MAGNET_METADATA_RECEIVED] File: index={}, path='{}', size={} bytes",
                                            f.index, f.path, f.size
                                        );
                                    }

                                    let ready_response = TorrentMetadataResponse::Ready {
                                        info_hash: info_hash_str.clone(),
                                        name: meta_name,
                                        total_size,
                                        files,
                                    };

                                    let event_name = format!("torrent-metadata-ready-{}", token_str);
                                    let _ = app_handle.emit(&event_name, ready_response);
                                    break;
                                }
                            }
                        }
                    }
                });
            }

            let response = TorrentMetadataResponse::FetchingMetadata {
                info_hash,
                name,
            };
            let json_str = serde_json::to_string(&response)
                .map_err(|_| "Não foi possível ler os metadados deste torrent.".to_string())?;
            println!("[TORRENT_LOG][BACKEND_RETURN_JSON] JSON enviado ao frontend:\n{}", json_str);
            return Ok(response);
        }

        let path = PathBuf::from(source);
        println!(
            "[TORRENT_LOG][BACKEND_RECEIVE] Verificando arquivo no disco: path='{}', existe={}",
            path.display(),
            path.exists()
        );

        if !path.exists() {
            return Err("Não foi possível ler os metadados deste torrent.".into());
        }

        let metadata_fs = std::fs::metadata(&path)
            .map_err(|_| "Não foi possível ler os metadados deste torrent.".to_string())?;
        println!("[TORRENT_LOG][BACKEND_RECEIVE] Tamanho físico no disco: {} bytes", metadata_fs.len());

        if metadata_fs.len() == 0 {
            return Err("Não foi possível ler os metadados deste torrent.".into());
        }

        let bytes = std::fs::read(&path)
            .map_err(|_| "Não foi possível ler os metadados deste torrent.".to_string())?;
        println!("[TORRENT_LOG][BACKEND_RECEIVE] Quantidade real de bytes lidos: {} bytes", bytes.len());

        let root_val = parse_bencode(&bytes)?;
        let root_dict = match root_val {
            BencodeValue::Dict(d) => d,
            _ => return Err("Não foi possível ler os metadados deste torrent.".into()),
        };

        let info_dict = match root_dict.get(b"info".as_slice()) {
            Some(BencodeValue::Dict(d)) => d,
            _ => return Err("Não foi possível ler os metadados deste torrent.".into()),
        };

        let name = match info_dict.get(b"name".as_slice()) {
            Some(BencodeValue::Bytes(b)) => String::from_utf8_lossy(b).trim().to_string(),
            _ => return Err("Não foi possível ler os metadados deste torrent.".into()),
        };

        if name.is_empty() {
            return Err("Não foi possível ler os metadados deste torrent.".into());
        }

        let mut files = Vec::new();
        let mut total_size: u64 = 0;

        if let Some(BencodeValue::List(file_list)) = info_dict.get(b"files".as_slice()) {
            // Múltiplos arquivos
            if file_list.is_empty() {
                return Err("Não foi possível ler os metadados deste torrent.".into());
            }

            for (idx, item) in file_list.iter().enumerate() {
                let file_dict = match item {
                    BencodeValue::Dict(d) => d,
                    _ => return Err("Não foi possível ler os metadados deste torrent.".into()),
                };

                let file_size = match file_dict.get(b"length".as_slice()) {
                    Some(BencodeValue::Int(l)) if *l > 0 => *l as u64,
                    _ => return Err("Não foi possível ler os metadados deste torrent.".into()),
                };

                let path_list = match file_dict.get(b"path".as_slice()) {
                    Some(BencodeValue::List(pl)) if !pl.is_empty() => pl,
                    _ => return Err("Não foi possível ler os metadados deste torrent.".into()),
                };

                let mut path_parts = Vec::new();
                for part in path_list {
                    if let BencodeValue::Bytes(pb) = part {
                        let s = String::from_utf8_lossy(pb).to_string();
                        if !s.is_empty() {
                            path_parts.push(s);
                        }
                    }
                }

                if path_parts.is_empty() {
                    return Err("Não foi possível ler os metadados deste torrent.".into());
                }

                let rel_path = path_parts.join("/");

                total_size = total_size
                    .checked_add(file_size)
                    .ok_or_else(|| "Não foi possível ler os metadados deste torrent.".to_string())?;

                files.push(TorrentFileItem {
                    index: idx,
                    path: rel_path,
                    size: file_size,
                });
            }
        } else if let Some(BencodeValue::Int(single_len)) = info_dict.get(b"length".as_slice()) {
            // Arquivo único
            if *single_len <= 0 {
                return Err("Não foi possível ler os metadados deste torrent.".into());
            }
            let file_size = *single_len as u64;
            total_size = file_size;
            files.push(TorrentFileItem {
                index: 0,
                path: name.clone(),
                size: file_size,
            });
        } else {
            return Err("Não foi possível ler os metadados deste torrent.".into());
        }

        if total_size == 0 || files.is_empty() {
            return Err("Não foi possível ler os metadados deste torrent.".into());
        }

        let meta = TorrentMetadataResponse::Ready {
            name: name.clone(),
            info_hash: format!("{:?}", uuid::Uuid::new_v4()),
            total_size,
            files: files.clone(),
        };

        println!(
            "[TORRENT_LOG][BACKEND_PARSED] Nome interno: '{}', Tipo: '{}', Total de arquivos: {}, Total Size: {} bytes",
            name,
            if files.len() > 1 { "Múltiplos arquivos" } else { "Arquivo único" },
            files.len(),
            total_size
        );
        for f in &files {
            println!(
                "[TORRENT_LOG][BACKEND_FILE] index: {}, path: '{}', size: {} bytes",
                f.index, f.path, f.size
            );
        }

        let json_str = serde_json::to_string(&meta)
            .map_err(|_| "Não foi possível ler os metadados deste torrent.".to_string())?;
        println!("[TORRENT_LOG][BACKEND_RETURN_JSON] JSON enviado ao frontend:\n{}", json_str);

        Ok(meta)
    }

    pub async fn start_torrent_handle(
        &self,
        session: &Arc<Session>,
        source: &str,
        output_dir: &Path,
    ) -> Result<Arc<ManagedTorrent>, String> {
        let opts = AddTorrentOptions {
            output_folder: Some(output_dir.to_string_lossy().to_string()),
            overwrite: true,
            ..Default::default()
        };

        let response = if source.starts_with("magnet:") {
            session
                .add_torrent(AddTorrent::from_url(source), Some(opts))
                .await
                .map_err(|e| format!("Falha ao adicionar torrent: {e}"))?
        } else {
            let bytes = std::fs::read(source)
                .map_err(|_| "Não foi possível ler os metadados deste torrent.".to_string())?;
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
            println!("[TORRENT_LOG][BACKEND_REMOVAL] Cancelando e removendo torrent da sessão: {}", task.id);
            let id_num = handle.id();
            let _ = session.delete(librqbit::api::TorrentIdOrHash::Id(id_num), false).await;

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
            .map(|l| (l.download_speed.mbps * 1_000_000.0 / 8.0) as f64)
            .unwrap_or(0.0);

        let upload_speed = stats
            .live
            .as_ref()
            .map(|l| (l.upload_speed.mbps * 1_000_000.0 / 8.0) as f64)
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

        println!(
            "[TORRENT_LOG][BACKEND_STATUS] progress={} bytes, speed={} B/s, peers={}",
            downloaded, speed_bytes, peers
        );

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

#[cfg(test)]
mod tests {
    use super::*;

    fn create_bencode_string(s: &str) -> Vec<u8> {
        format!("{}:{}", s.len(), s).into_bytes()
    }

    fn create_bencode_int(i: i64) -> Vec<u8> {
        format!("i{}e", i).into_bytes()
    }

    fn create_bencode_dict(items: &[(&[u8], Vec<u8>)]) -> Vec<u8> {
        let mut out = vec![b'd'];
        for (k, v) in items {
            out.extend(format!("{}:", k.len()).bytes());
            out.extend(*k);
            out.extend(v);
        }
        out.push(b'e');
        out
    }

    #[tokio::test]
    async fn test_tauri_command_parse_torrent_single_file() {
        let dir = std::env::temp_dir();
        let file_path = dir.join(format!("test_single_{}.torrent", uuid::Uuid::new_v4()));

        let info_dict = create_bencode_dict(&[
            (b"name", create_bencode_string("example.iso")),
            (b"length", create_bencode_int(1048576)),
        ]);
        let root_dict = create_bencode_dict(&[(b"info", info_dict)]);

        std::fs::write(&file_path, &root_dict).unwrap();

        let engine = TorrentEngine::new();
        let meta = engine.parse_torrent(&file_path.to_string_lossy()).await.unwrap();

        assert_eq!(meta.name().unwrap(), "example.iso");
        assert_eq!(meta.total_size().unwrap(), 1048576);
        let files = meta.files().unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "example.iso");
        assert_eq!(files[0].size, 1048576);
        assert!(meta.total_size().unwrap() > 0);
        assert!(!files.is_empty());
        assert!(files.iter().all(|file| file.size > 0));

        let json = serde_json::to_string(&meta).unwrap();
        assert!(json.contains("example.iso"));
        assert!(json.contains("1048576"));
        assert!(json.contains("totalSize"));
        assert!(json.contains("files"));

        let deserialized: TorrentMetadataResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, meta);

        let _ = std::fs::remove_file(file_path);
    }

    fn create_bencode_list(items: &[Vec<u8>]) -> Vec<u8> {
        let mut out = vec![b'l'];
        for item in items {
            out.extend(item);
        }
        out.push(b'e');
        out
    }

    #[tokio::test]
    async fn test_tauri_command_parse_torrent_multi_file() {
        let dir = std::env::temp_dir();
        let file_path = dir.join(format!("test_multi_{}.torrent", uuid::Uuid::new_v4()));

        let path1 = create_bencode_list(&[
            create_bencode_string("Season 01"),
            create_bencode_string("Episode 01.mkv"),
        ]);
        let file1_dict = create_bencode_dict(&[
            (b"length", create_bencode_int(2048)),
            (b"path", path1),
        ]);

        let path2 = create_bencode_list(&[
            create_bencode_string("Season 01"),
            create_bencode_string("Episode 02.mkv"),
        ]);
        let file2_dict = create_bencode_dict(&[
            (b"length", create_bencode_int(4096)),
            (b"path", path2),
        ]);

        let files_list = create_bencode_list(&[file1_dict, file2_dict]);

        let info_dict = create_bencode_dict(&[
            (b"files", files_list),
            (b"name", create_bencode_string("Example Pack")),
        ]);
        let root_dict = create_bencode_dict(&[(b"info", info_dict)]);

        std::fs::write(&file_path, &root_dict).unwrap();

        let engine = TorrentEngine::new();
        let meta = engine.parse_torrent(&file_path.to_string_lossy()).await.unwrap();

        assert_eq!(meta.name().unwrap(), "Example Pack");
        assert_eq!(meta.total_size().unwrap(), 6144);
        let files = meta.files().unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "Season 01/Episode 01.mkv");
        assert_eq!(files[0].size, 2048);
        assert_eq!(files[1].path, "Season 01/Episode 02.mkv");
        assert_eq!(files[1].size, 4096);

        assert!(meta.total_size().unwrap() > 0);
        assert!(!files.is_empty());
        assert!(files.iter().all(|file| file.size > 0));

        let json = serde_json::to_string(&meta).unwrap();
        let deserialized: TorrentMetadataResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, meta);

        let _ = std::fs::remove_file(file_path);
    }

    #[tokio::test]
    async fn test_torrent_errors_no_fallback() {
        let engine = TorrentEngine::new();

        // 1. Arquivo inexistente
        let err1 = engine.parse_torrent("non_existent_file.torrent").await;
        assert_eq!(err1.unwrap_err(), "Não foi possível ler os metadados deste torrent.");

        // 2. Arquivo vazio
        let dir = std::env::temp_dir();
        let empty_file = dir.join(format!("empty_{}.torrent", uuid::Uuid::new_v4()));
        std::fs::write(&empty_file, []).unwrap();
        let err2 = engine.parse_torrent(&empty_file.to_string_lossy()).await;
        assert_eq!(err2.unwrap_err(), "Não foi possível ler os metadados deste torrent.");
        let _ = std::fs::remove_file(empty_file);

        // 3. Bencode inválido
        let invalid_file = dir.join(format!("invalid_{}.torrent", uuid::Uuid::new_v4()));
        std::fs::write(&invalid_file, b"not a bencode file").unwrap();
        let err3 = engine.parse_torrent(&invalid_file.to_string_lossy()).await;
        assert_eq!(err3.unwrap_err(), "Não foi possível ler os metadados deste torrent.");
        let _ = std::fs::remove_file(invalid_file);

        // 4. Ausência de dicionário info
        let no_info_file = dir.join(format!("no_info_{}.torrent", uuid::Uuid::new_v4()));
        let root_no_info = create_bencode_dict(&[(b"announce", create_bencode_string("http://tracker.com"))]);
        std::fs::write(&no_info_file, &root_no_info).unwrap();
        let err4 = engine.parse_torrent(&no_info_file.to_string_lossy()).await;
        assert_eq!(err4.unwrap_err(), "Não foi possível ler os metadados deste torrent.");
        let _ = std::fs::remove_file(no_info_file);

        // 5. Torrent sem length e sem files
        let no_len_file = dir.join(format!("no_len_{}.torrent", uuid::Uuid::new_v4()));
        let info_no_len = create_bencode_dict(&[(b"name", create_bencode_string("invalid.iso"))]);
        let root_no_len = create_bencode_dict(&[(b"info", info_no_len)]);
        std::fs::write(&no_len_file, &root_no_len).unwrap();
        let err5 = engine.parse_torrent(&no_len_file.to_string_lossy()).await;
        assert_eq!(err5.unwrap_err(), "Não foi possível ler os metadados deste torrent.");
        let _ = std::fs::remove_file(no_len_file);
    }
}
