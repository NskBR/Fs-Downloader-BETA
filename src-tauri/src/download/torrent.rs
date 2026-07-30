use std::path::{Path, PathBuf};
use std::sync::Arc;
use librqbit::{AddTorrent, AddTorrentOptions, Session, SessionOptions};
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

    pub async fn start_torrent(
        &self,
        session: &Arc<Session>,
        source: &str,
        output_dir: &Path,
    ) -> Result<usize, String> {
        let opts = AddTorrentOptions {
            output_folder: Some(output_dir.to_string_lossy().to_string()),
            ..Default::default()
        };

        if source.starts_with("magnet:") {
            let handle = session
                .add_torrent(AddTorrent::from_url(source), Some(opts))
                .await
                .map_err(|e| format!("Falha ao adicionar torrent: {e}"))?;
            let id = match handle {
                librqbit::AddTorrentResponse::AlreadyManaged(id, _) => id,
                librqbit::AddTorrentResponse::Added(id, _) => id,
                _ => 0,
            };
            Ok(id)
        } else {
            let bytes = std::fs::read(source).map_err(|e| e.to_string())?;
            let handle = session
                .add_torrent(AddTorrent::from_bytes(bytes), Some(opts))
                .await
                .map_err(|e| format!("Falha ao adicionar torrent: {e}"))?;
            let id = match handle {
                librqbit::AddTorrentResponse::AlreadyManaged(id, _) => id,
                librqbit::AddTorrentResponse::Added(id, _) => id,
                _ => 0,
            };
            Ok(id)
        }
    }
}
