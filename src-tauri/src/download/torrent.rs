use librqbit::{
    AddTorrent, AddTorrentOptions, ManagedTorrent, Session, SessionOptions,
    SessionPersistenceConfig,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};
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

    #[allow(dead_code)]
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

pub fn sanitize_info_hash(raw: &str) -> String {
    let mut s = raw.trim();
    if let Some(inner) = s.strip_prefix("Some(").and_then(|i| i.strip_suffix(")")) {
        s = inner;
    }
    if let Some(inner) = s
        .strip_prefix("Id20(\"")
        .and_then(|i| i.strip_suffix("\")"))
    {
        s = inner;
    } else if let Some(inner) = s.strip_prefix("Id20(").and_then(|i| i.strip_suffix(")")) {
        s = inner;
    }
    let cleaned: String = s
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if cleaned.is_empty() {
        "torrent_hash".to_string()
    } else {
        cleaned
    }
}

pub struct TorrentEntry {
    pub info_hash: String,
    pub source: String,
    pub handle: Arc<ManagedTorrent>,
    pub metadata_ready: bool,
    pub confirmed: bool,
    pub name: String,
    pub total_size: u64,
    pub files: Vec<TorrentFileItem>,
    pub selected_file_indexes: Vec<usize>,
    pub save_path: String,
}

pub struct TorrentManager {
    session: Arc<RwLock<Option<Arc<Session>>>>,
    entries: Arc<RwLock<BTreeMap<String, TorrentEntry>>>,
}

static TORRENT_MANAGER: LazyLock<TorrentManager> = LazyLock::new(TorrentManager::new);

pub fn get_torrent_manager() -> &'static TorrentManager {
    &TORRENT_MANAGER
}

impl TorrentManager {
    pub fn new() -> Self {
        Self {
            session: Arc::new(RwLock::new(None)),
            entries: Arc::new(RwLock::new(BTreeMap::new())),
        }
    }

    pub fn entries(&self) -> &Arc<RwLock<BTreeMap<String, TorrentEntry>>> {
        &self.entries
    }

    pub fn session(&self) -> &Arc<RwLock<Option<Arc<Session>>>> {
        &self.session
    }
    pub async fn get_session(&self, default_output_dir: &Path) -> Result<Arc<Session>, String> {
        let mut guard = self.session.write().await;
        if let Some(ref s) = *guard {
            return Ok(s.clone());
        }

        let persistence_root = std::env::var_os("LOCALAPPDATA")
            .or_else(|| std::env::var_os("APPDATA"))
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
            .join("SF Downloader")
            .join("torrent-session");
        let opts = SessionOptions {
            disable_dht: false,
            persistence: Some(SessionPersistenceConfig::Json {
                folder: Some(persistence_root),
            }),
            fastresume: true,
            ..Default::default()
        };

        let session = Session::new_with_opts(default_output_dir.to_path_buf(), opts)
            .await
            .map_err(|e| format!("Falha ao inicializar motor Torrent: {e}"))?;

        *guard = Some(session.clone());
        Ok(session)
    }

    pub async fn start_torrent_handle(
        &self,
        session: &Arc<Session>,
        source: &str,
        output_dir: &Path,
    ) -> Result<Arc<ManagedTorrent>, String> {
        self.start_torrent_handle_configured(session, source, output_dir, false, None)
            .await
    }

    async fn start_torrent_handle_configured(
        &self,
        session: &Arc<Session>,
        source: &str,
        output_dir: &Path,
        paused: bool,
        only_files: Option<Vec<usize>>,
    ) -> Result<Arc<ManagedTorrent>, String> {
        let opts = AddTorrentOptions {
            output_folder: Some(output_dir.to_string_lossy().to_string()),
            overwrite: true,
            paused,
            only_files,
            ..Default::default()
        };

        let response = if source.starts_with("magnet:") {
            session
                .add_torrent(AddTorrent::from_url(source), Some(opts))
                .await
                .map_err(|e| {
                    println!(
                        "[ADD_TORRENT_ALERT] error_code=failed_to_add info_hash=magnet error={:?}",
                        e
                    );
                    format!("Falha ao adicionar torrent: {e}")
                })?
        } else {
            let bytes = std::fs::read(source)
                .map_err(|_| "Não foi possível ler os metadados deste torrent.".to_string())?;
            session
                .add_torrent(AddTorrent::from_bytes(bytes), Some(opts))
                .await
                .map_err(|e| {
                    println!(
                        "[ADD_TORRENT_ALERT] error_code=failed_to_add_file error={:?}",
                        e
                    );
                    format!("Falha ao adicionar torrent: {e}")
                })?
        };

        response
            .into_handle()
            .ok_or_else(|| "Torrents em lista não suportados".to_string())
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
        println!(
            "[TORRENT_LOG][BACKEND_RECEIVE] Argumento recebido: '{}'",
            source
        );

        if source.starts_with("magnet:") {
            println!("[MAGNET_RECEIVED] Magnet link recebido: {}", source);
            let magnet = librqbit::Magnet::parse(source)
                .map_err(|_| "Não foi possível ler os metadados deste torrent.".to_string())?;
            let info_hash = sanitize_info_hash(&format!("{:?}", magnet.as_id20()));
            let name = magnet.name.clone();

            println!(
                "[MAGNET_PARSED] Magnet parsed: info_hash={}, name={:?}",
                info_hash, name
            );

            // Verificar se handle persistente já existe no TorrentManager
            {
                let read_guard = self.entries.read().await;
                if let Some(existing) = read_guard.get(&info_hash) {
                    if existing.metadata_ready {
                        println!("[TORRENT_HANDLE_FOUND] Handle persistente existente encontrado com metadados prontos! info_hash={}", info_hash);
                        return Ok(TorrentMetadataResponse::Ready {
                            info_hash: existing.info_hash.clone(),
                            name: existing.name.clone(),
                            total_size: existing.total_size,
                            files: existing.files.clone(),
                        });
                    }
                }
            }

            // Adicionar handle persistente na sessão global
            let temp_dir = std::env::temp_dir();
            let session = self.get_session(&temp_dir).await?;
            let handle = self
                .start_torrent_handle_configured(&session, source, &temp_dir, true, None)
                .await?;
            println!("[MAGNET_ADDED_TO_SESSION] Handle persistente adicionado à sessão global. handle_id={}", handle.id());

            // Guardar handle persistente no TorrentManager
            {
                let mut write_guard = self.entries.write().await;
                write_guard.insert(
                    info_hash.clone(),
                    TorrentEntry {
                        info_hash: info_hash.clone(),
                        source: source.to_string(),
                        handle: handle.clone(),
                        metadata_ready: false,
                        confirmed: false,
                        name: name.clone().unwrap_or_else(|| "Torrent Magnet".into()),
                        total_size: 0,
                        files: vec![],
                        selected_file_indexes: vec![],
                        save_path: temp_dir.to_string_lossy().to_string(),
                    },
                );
            }

            // Iniciar observador de metadados em background
            if let Some(app_handle) = app {
                let token_str = token.unwrap_or("").to_string();
                let info_hash_str = info_hash.clone();
                let name_str = name.clone();
                let entries_ref = self.entries.clone();

                tokio::spawn(async move {
                    use tauri::Emitter;
                    println!("[MAGNET_WAITING_METADATA] Aguardando metadados dos peers P2P para info_hash={}...", info_hash_str);

                    for _ in 0..60 {
                        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                        let stats = handle.stats();
                        if stats.total_bytes > 0 {
                            let meta_name = handle.name().unwrap_or_else(|| {
                                name_str.clone().unwrap_or_else(|| "Torrent".into())
                            });
                            let total_size = stats.total_bytes as u64;

                            // Extrair lista real de arquivos do torrent via handle.with_metadata()
                            let files: Vec<TorrentFileItem> = match handle.with_metadata(|m| {
                                m.file_infos
                                    .iter()
                                    .enumerate()
                                    .map(|(idx, fi)| TorrentFileItem {
                                        index: idx,
                                        path: fi
                                            .relative_filename
                                            .to_string_lossy()
                                            .replace('\\', "/"),
                                        size: fi.len,
                                    })
                                    .collect::<Vec<TorrentFileItem>>()
                            }) {
                                Ok(files) if !files.is_empty() => files,
                                _ => vec![TorrentFileItem {
                                    index: 0,
                                    path: meta_name.clone(),
                                    size: total_size,
                                }],
                            };

                            println!(
                                "[MAGNET_METADATA_RECEIVED] Metadados recebidos do swarm P2P!"
                            );
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

                            // Atualizar entrada persistente no TorrentManager
                            {
                                let mut guard = entries_ref.write().await;
                                if let Some(entry) = guard.get_mut(&info_hash_str) {
                                    entry.metadata_ready = true;
                                    entry.name = meta_name.clone();
                                    entry.total_size = total_size;
                                    entry.files = files.clone();
                                }
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
                });
            }

            let response = TorrentMetadataResponse::FetchingMetadata { info_hash, name };
            let json_str = serde_json::to_string(&response)
                .map_err(|_| "Não foi possível ler os metadados deste torrent.".to_string())?;
            println!(
                "[TORRENT_LOG][BACKEND_RETURN_JSON] JSON enviado ao frontend:\n{}",
                json_str
            );
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
        println!(
            "[TORRENT_LOG][BACKEND_RECEIVE] Tamanho físico no disco: {} bytes",
            metadata_fs.len()
        );

        if metadata_fs.len() == 0 {
            return Err("Não foi possível ler os metadados deste torrent.".into());
        }

        let bytes = std::fs::read(&path)
            .map_err(|_| "Não foi possível ler os metadados deste torrent.".to_string())?;
        println!(
            "[TORRENT_LOG][BACKEND_RECEIVE] Quantidade real de bytes lidos: {} bytes",
            bytes.len()
        );

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

                total_size = total_size.checked_add(file_size).ok_or_else(|| {
                    "Não foi possível ler os metadados deste torrent.".to_string()
                })?;

                files.push(TorrentFileItem {
                    index: idx,
                    path: rel_path,
                    size: file_size,
                });
            }
        } else if let Some(BencodeValue::Int(single_len)) = info_dict.get(b"length".as_slice()) {
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

        let temp_dir = std::env::temp_dir();
        let session = self.get_session(&temp_dir).await?;
        let handle = self
            .start_torrent_handle_configured(&session, source, &temp_dir, true, None)
            .await?;
        let info_hash = sanitize_info_hash(&format!("{:?}", handle.info_hash()));

        {
            let mut guard = self.entries.write().await;
            guard.insert(
                info_hash.clone(),
                TorrentEntry {
                    info_hash: info_hash.clone(),
                    source: source.to_string(),
                    handle,
                    metadata_ready: true,
                    confirmed: false,
                    name: name.clone(),
                    total_size,
                    files: files.clone(),
                    selected_file_indexes: vec![],
                    save_path: temp_dir.to_string_lossy().to_string(),
                },
            );
        }

        let meta = TorrentMetadataResponse::Ready {
            name: name.clone(),
            info_hash,
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
        println!(
            "[TORRENT_LOG][BACKEND_RETURN_JSON] JSON enviado ao frontend:\n{}",
            json_str
        );

        Ok(meta)
    }

    pub async fn confirm_torrent(
        &self,
        app: &tauri::AppHandle,
        database: &crate::database::Database,
        runtime: &crate::download::runtime::DownloadRuntime,
        info_hash: &str,
        save_path: &str,
        selected_file_indexes: &[usize],
        start_immediately: bool,
    ) -> Result<crate::database::models::DownloadTask, String> {
        println!(
            "[CONFIRM_TORRENT_REQUEST] info_hash='{}', save_path='{}', selected_files={:?}, start_immediately={}",
            info_hash, save_path, selected_file_indexes, start_immediately
        );

        let mut guard = self.entries.write().await;
        let entry = guard.get_mut(info_hash).ok_or_else(|| {
            println!(
                "[ADD_TORRENT_ALERT] error_code=handle_not_found info_hash={}",
                info_hash
            );
            format!(
                "Handle do torrent não encontrado para info_hash: {}",
                info_hash
            )
        })?;

        if !entry.metadata_ready {
            println!(
                "[ADD_TORRENT_ALERT] error_code=metadata_not_ready info_hash={}",
                info_hash
            );
            return Err("Metadados do torrent ainda não foram baixados.".into());
        }

        let _stats = entry.handle.stats();
        println!(
            "[TORRENT_HANDLE_FOUND] handle_id={}, metadata_ready=true, estado_atual='{:?}', total_size={} bytes",
            entry.handle.id(),
            _stats,
            entry.total_size
        );

        // Testar validade do diretório e teste de escrita
        let save_dir = PathBuf::from(save_path);
        std::fs::create_dir_all(&save_dir).map_err(|e| {
            println!(
                "[TORRENT_ERROR] error_code=failed_to_create_dir save_path='{}' error={:?}",
                save_path, e
            );
            format!("Não foi possível criar pasta de destino: {e}")
        })?;

        let test_file = save_dir.join(format!(".sf_test_{}.tmp", uuid::Uuid::new_v4()));
        if let Err(e) = std::fs::write(&test_file, b"test") {
            println!(
                "[TORRENT_ERROR] error_code=permission_denied save_path='{}' error={:?}",
                save_path, e
            );
            return Err(format!("Sem permissão de escrita em {}: {e}", save_path));
        } else {
            let _ = std::fs::remove_file(test_file);
        }

        println!(
            "[TORRENT_DESTINATION] caminho_absoluto='{}', existe=true, e_diretorio=true, teste_escrita=ok",
            save_dir.display()
        );

        println!(
            "[TORRENT_PRIORITIES] Prioridades de arquivos aplicadas para índices: {:?}",
            selected_file_indexes
        );

        // Aplicar seleção de arquivos (update_only_files) na sessão do librqbit
        if !selected_file_indexes.is_empty() && selected_file_indexes.len() < entry.files.len() {
            let selected_set: std::collections::HashSet<usize> =
                selected_file_indexes.iter().copied().collect();
            if let Some(ref session) = *self.session.read().await {
                if let Err(e) = session
                    .update_only_files(&entry.handle, &selected_set)
                    .await
                {
                    println!(
                        "[TORRENT_ERROR] Falha ao aplicar update_only_files na sessão: {:?}",
                        e
                    );
                } else {
                    println!("[TORRENT_PRIORITIES] update_only_files aplicado com sucesso via sessão: {:?}", selected_set);
                }
            }
        }

        let selected_total_size: u64 = if !selected_file_indexes.is_empty()
            && selected_file_indexes.len() < entry.files.len()
        {
            selected_file_indexes
                .iter()
                .map(|&idx| entry.files.get(idx).map(|f| f.size).unwrap_or(0))
                .sum()
        } else {
            entry.total_size
        };

        let old_handle_id = entry.handle.id();
        let source = entry.source.clone();
        let only_files = if !selected_file_indexes.is_empty()
            && selected_file_indexes.len() < entry.files.len()
        {
            Some(selected_file_indexes.to_vec())
        } else {
            None
        };
        let session = self
            .session
            .read()
            .await
            .clone()
            .ok_or_else(|| "Sessão Torrent não disponível.".to_string())?;
        session
            .delete(librqbit::api::TorrentIdOrHash::Id(old_handle_id), false)
            .await
            .map_err(|e| format!("Falha ao preparar destino do torrent: {e}"))?;
        let final_handle = self
            .start_torrent_handle_configured(
                &session,
                &source,
                &save_dir,
                !start_immediately,
                only_files,
            )
            .await?;

        entry.handle = final_handle;
        entry.confirmed = true;
        entry.save_path = save_path.to_string();
        entry.selected_file_indexes = selected_file_indexes.to_vec();

        // Remover do disco arquivos desmarcados que a inicialização de armazenamento do librqbit cria automaticamente
        if !selected_file_indexes.is_empty() && selected_file_indexes.len() < entry.files.len() {
            let selected_set: std::collections::HashSet<usize> =
                selected_file_indexes.iter().copied().collect();
            for file in &entry.files {
                if !selected_set.contains(&file.index) {
                    let unselected_path = save_dir.join(&file.path);
                    if unselected_path.exists() {
                        let _ = std::fs::remove_file(&unselected_path);
                        println!(
                            "[TORRENT_CLEANUP] Removido arquivo desmarcado criado no init do librqbit: {:?}",
                            unselected_path
                        );
                    }
                }
            }
        }

        let conn = database.connect().map_err(|e| e.to_string())?;

        let final_path = if entry.files.len() == 1 {
            save_dir
                .join(&entry.files[0].path)
                .to_string_lossy()
                .into_owned()
        } else {
            save_dir.to_string_lossy().into_owned()
        };

        let input = crate::database::models::CreateDownloadInput {
            file_name: entry.name.clone(),
            file_size: if selected_total_size > 0 {
                Some(selected_total_size as i64)
            } else {
                None
            },
            original_url: entry.source.clone(),
            save_path: save_path.to_string(),
            temp_path: save_path.to_string(),
            final_path,
            mime_type: Some("application/x-bittorrent".into()),
            extension: Some("torrent".into()),
            supports_range: false,
            max_connections: 1,
            max_parallel_downloads: 5,
            speed_limit_download: 0,
            etag: None,
            last_modified: None,
            delete_archive_after_extract: false,
            download_type: "torrent".into(),
            info_hash: Some(info_hash.to_string()),
        };

        let task = crate::database::repositories::downloads::create(&conn, input)
            .map_err(|e| format!("Erro ao criar registro no banco: {e}"))?;

        println!(
            "[TORRENT_RESUME] Motor retomado/iniciado com sucesso para info_hash={}",
            info_hash
        );

        if start_immediately {
            let control = crate::download::runtime::TaskControl::new();
            runtime.register(task.id.clone(), control.clone())?;
            let database_clone = database.clone();
            let spawned_task = task.clone();
            let app_handle = app.clone();
            let runtime_clone = runtime.clone();
            let task_id = task.id.clone();

            tokio::spawn(async move {
                run_torrent(app_handle, database_clone, spawned_task, control).await;
                runtime_clone.remove(&task_id);
            });
        }

        Ok(task)
    }

    pub async fn cancel_torrent(
        &self,
        app: &tauri::AppHandle,
        database: &crate::database::Database,
        info_hash: &str,
        delete_files: bool,
    ) -> Result<(), String> {
        println!(
            "[MAGNET_CANCELLED] Cancelando torrent com info_hash={}, delete_files={}",
            info_hash, delete_files
        );

        let mut actual_info_hash = info_hash.to_string();
        let mut db_task_id = info_hash.to_string();

        if let Ok(conn) = database.connect() {
            if let Ok(Some(task)) =
                crate::database::repositories::downloads::find_by_info_hash(&conn, info_hash)
            {
                db_task_id = task.id.clone();
                if let Some(h) = task.info_hash {
                    actual_info_hash = h;
                }

                // A remoção dos arquivos pertence ao librqbit, que conhece exatamente
                // o conteúdo do torrent. Nunca apagar recursivamente a pasta de destino.
            }
        }

        let mut guard = self.entries.write().await;
        if let Some(entry) = guard
            .remove(&actual_info_hash)
            .or_else(|| guard.remove(info_hash))
        {
            let id_num = entry.handle.id();
            if let Some(ref session) = *self.session.read().await {
                let _ = session
                    .delete(librqbit::api::TorrentIdOrHash::Id(id_num), delete_files)
                    .await;
            }
        }

        if let Ok(conn) = database.connect() {
            let _ = conn.execute(
                "UPDATE download_tasks SET status='cancelled', speed_current=0.0, updated_at=CURRENT_TIMESTAMP WHERE id=?1 OR info_hash=?2",
                rusqlite::params![db_task_id, actual_info_hash],
            );
        }

        use tauri::Emitter;
        let payload = serde_json::json!({
            "id": db_task_id,
            "downloaded": 0,
            "total": null,
            "speed": 0.0,
            "status": "cancelled",
            "error": null
        });
        let _ = app.emit("download-progress", payload.clone());
        let _ = app.emit("download-updated", db_task_id);

        if actual_info_hash != info_hash {
            let payload_hash = serde_json::json!({
                "id": info_hash,
                "downloaded": 0,
                "total": null,
                "speed": 0.0,
                "status": "cancelled",
                "error": null
            });
            let _ = app.emit("download-progress", payload_hash);
            let _ = app.emit("download-updated", info_hash);
        }

        Ok(())
    }
}

pub async fn run_torrent(
    app: tauri::AppHandle,
    database: crate::database::Database,
    task: crate::database::models::DownloadTask,
    control: crate::download::runtime::TaskControl,
) {
    use crate::database::models::{DownloadStatus, UpdateDownloadInput};
    use crate::database::repositories::downloads;
    use tauri::Emitter;

    let connection = match database.connect() {
        Ok(c) => c,
        Err(_) => return,
    };

    let manager = get_torrent_manager();
    let info_hash = task.info_hash.clone().unwrap_or_default();

    let mut current_downloaded = task.total_downloaded;
    let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(500));
    loop {
        interval.tick().await;

        if control.was_paused() {
            let _ = downloads::update_progress(
                &connection,
                &UpdateDownloadInput {
                    id: task.id.clone(),
                    status: DownloadStatus::Paused,
                    total_downloaded: current_downloaded,
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
                    "downloaded": current_downloaded,
                    "total": task.file_size,
                    "speed": 0.0,
                    "status": "paused",
                    "error": null
                }),
            );
            break;
        }

        if control.was_cancelled() {
            let _ = manager
                .cancel_torrent(&app, &database, &info_hash, false)
                .await;
            break;
        }

        // Buscar handle no TorrentManager
        let guard = manager.entries.read().await;
        if let Some(entry) = guard.get(&info_hash) {
            let stats = entry.handle.stats();

            let has_selected_subset = !entry.selected_file_indexes.is_empty()
                && entry.selected_file_indexes.len() < entry.files.len();

            let logical_total_size = if has_selected_subset {
                entry
                    .selected_file_indexes
                    .iter()
                    .map(|&idx| entry.files.get(idx).map(|f| f.size).unwrap_or(0))
                    .sum::<u64>() as i64
            } else {
                task.file_size.unwrap_or(entry.total_size as i64)
            };

            let total_size = logical_total_size;

            let downloaded = if has_selected_subset {
                entry
                    .selected_file_indexes
                    .iter()
                    .map(|&idx| stats.file_progress.get(idx).copied().unwrap_or(0))
                    .sum::<u64>() as i64
            } else if stats.finished {
                total_size
            } else {
                stats.progress_bytes as i64
            };

            // Garantir que baixado nunca ultrapasse o total_size da seleção ou do torrent
            let downloaded = if total_size > 0 {
                downloaded.min(total_size)
            } else {
                downloaded
            };

            let is_finished = if total_size > 0 {
                downloaded >= total_size
            } else {
                stats.finished
            };

            let speed_bytes = stats
                .live
                .as_ref()
                .map(|l| l.download_speed.mbps * 1024.0 * 1024.0)
                .unwrap_or(0.0);

            let upload_speed = stats
                .live
                .as_ref()
                .map(|l| l.upload_speed.mbps * 1024.0 * 1024.0)
                .unwrap_or(0.0);

            let peers = stats
                .live
                .as_ref()
                .map(|l| (l.snapshot.peer_stats.live + l.snapshot.peer_stats.connecting) as i64)
                .unwrap_or(0);
            let seeds = 0;

            // Mapear estado real do librqbit para DownloadStatus
            use librqbit::TorrentStatsState;
            let is_initializing = matches!(stats.state, TorrentStatsState::Initializing);
            let real_downloaded = if is_initializing { 0_i64 } else { downloaded };
            current_downloaded = real_downloaded;

            let (db_status, ui_status) = if stats.error.is_some() {
                (DownloadStatus::Failed, "failed")
            } else if is_finished {
                (DownloadStatus::Completed, "completed")
            } else {
                match stats.state {
                    TorrentStatsState::Initializing => {
                        (DownloadStatus::Downloading, "checking_files")
                    }
                    TorrentStatsState::Live => {
                        // Exibir "Baixando" APENAS quando já baixou algum byte real (> 0)
                        // E a velocidade real de download for >= 1.0 KB/s.
                        // Caso contrário, exibir "Conectando P2P" (Conectando-se aos pares).
                        if real_downloaded > 0 && speed_bytes >= 1024.0 {
                            (DownloadStatus::Downloading, "downloading")
                        } else {
                            (DownloadStatus::Downloading, "connecting")
                        }
                    }
                    TorrentStatsState::Paused => (DownloadStatus::Paused, "paused"),
                    TorrentStatsState::Error => (DownloadStatus::Failed, "failed"),
                }
            };

            // Durante Initializing, progress_bytes = peças verificadas no disco (não bytes baixados)
            // Só registrar progresso real quando estado for Live e houver velocidade
            let real_downloaded = if is_initializing { 0_i64 } else { downloaded };

            println!(
                "[TORRENT_LOG][BACKEND_STATUS] info_hash={} state={:?} verified={}/{} bytes, real_dl={} bytes, speed={:.0} B/s, peers={} seeds={}",
                info_hash, stats.state, downloaded, total_size, real_downloaded, speed_bytes, peers, seeds
            );

            let _ = downloads::update_progress(
                &connection,
                &UpdateDownloadInput {
                    id: task.id.clone(),
                    status: db_status,
                    total_downloaded: real_downloaded,
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
                    // downloaded = bytes REALMENTE baixados (0 durante verificação)
                    "downloaded": real_downloaded,
                    // verifiedBytes = bytes verificados no disco (só durante checking_files)
                    "verifiedBytes": if is_initializing { downloaded } else { 0_i64 },
                    "total": total_size,
                    "speed": speed_bytes,
                    "uploadSpeed": upload_speed,
                    "seeds": seeds,
                    "peers": peers,
                    "status": ui_status,
                    "error": stats.error.clone()
                }),
            );

            if is_finished && has_selected_subset {
                let selected: std::collections::HashSet<usize> =
                    entry.selected_file_indexes.iter().copied().collect();
                for file in entry.files.iter().filter(|file| !selected.contains(&file.index)) {
                    let relative = Path::new(&file.path);
                    let safe_relative = relative.components().all(|component| {
                        matches!(
                            component,
                            std::path::Component::Normal(_) | std::path::Component::CurDir
                        )
                    });
                    if !safe_relative {
                        continue;
                    }
                    let candidate = Path::new(&entry.save_path).join(relative);
                    if std::fs::metadata(&candidate)
                        .map(|metadata| metadata.is_file() && metadata.len() == 0)
                        .unwrap_or(false)
                    {
                        let _ = std::fs::remove_file(candidate);
                    }
                }
            }

            if is_finished || stats.error.is_some() {
                break;
            }
        } else {
            println!("[TORRENT_LOG][BACKEND_STATUS] info_hash={} handle not found in TorrentManager — encerrando loop", info_hash);
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

        let manager = TorrentManager::new();
        let meta = manager
            .parse_torrent(&file_path.to_string_lossy())
            .await
            .unwrap();

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
        let file1_dict =
            create_bencode_dict(&[(b"length", create_bencode_int(2048)), (b"path", path1)]);

        let path2 = create_bencode_list(&[
            create_bencode_string("Season 01"),
            create_bencode_string("Episode 02.mkv"),
        ]);
        let file2_dict =
            create_bencode_dict(&[(b"length", create_bencode_int(4096)), (b"path", path2)]);

        let files_list = create_bencode_list(&[file1_dict, file2_dict]);

        let info_dict = create_bencode_dict(&[
            (b"files", files_list),
            (b"name", create_bencode_string("Example Pack")),
        ]);
        let root_dict = create_bencode_dict(&[(b"info", info_dict)]);

        std::fs::write(&file_path, &root_dict).unwrap();

        let manager = TorrentManager::new();
        let meta = manager
            .parse_torrent(&file_path.to_string_lossy())
            .await
            .unwrap();

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
        let manager = TorrentManager::new();

        let err1 = manager.parse_torrent("non_existent_file.torrent").await;
        assert_eq!(
            err1.unwrap_err(),
            "Não foi possível ler os metadados deste torrent."
        );

        let dir = std::env::temp_dir();
        let empty_file = dir.join(format!("empty_{}.torrent", uuid::Uuid::new_v4()));
        std::fs::write(&empty_file, []).unwrap();
        let err2 = manager.parse_torrent(&empty_file.to_string_lossy()).await;
        assert_eq!(
            err2.unwrap_err(),
            "Não foi possível ler os metadados deste torrent."
        );
        let _ = std::fs::remove_file(empty_file);

        let invalid_file = dir.join(format!("invalid_{}.torrent", uuid::Uuid::new_v4()));
        std::fs::write(&invalid_file, b"not a bencode file").unwrap();
        let err3 = manager.parse_torrent(&invalid_file.to_string_lossy()).await;
        assert_eq!(
            err3.unwrap_err(),
            "Não foi possível ler os metadados deste torrent."
        );
        let _ = std::fs::remove_file(invalid_file);
    }

    #[tokio::test]
    async fn test_torrent_manager_confirm_and_cancel() {
        let manager = TorrentManager::new();
        let dir = std::env::temp_dir();
        let info_dict = create_bencode_dict(&[
            (b"name", create_bencode_string("test_game.iso")),
            (b"length", create_bencode_int(1048576)),
        ]);
        let root_dict = create_bencode_dict(&[(b"info", info_dict)]);
        let file_path = dir.join(format!("test_manager_{}.torrent", uuid::Uuid::new_v4()));
        std::fs::write(&file_path, &root_dict).unwrap();

        let session = manager.get_session(&dir).await.unwrap();
        let handle = manager
            .start_torrent_handle(&session, &file_path.to_string_lossy(), &dir)
            .await
            .unwrap();
        let info_hash = "test_info_hash_123".to_string();

        {
            let mut guard = manager.entries.write().await;
            guard.insert(
                info_hash.clone(),
                TorrentEntry {
                    info_hash: info_hash.clone(),
                    source: file_path.to_string_lossy().to_string(),
                    handle: handle.clone(),
                    metadata_ready: true,
                    confirmed: false,
                    name: "test_game.iso".into(),
                    total_size: 1048576,
                    files: vec![TorrentFileItem {
                        index: 0,
                        path: "test_game.iso".into(),
                        size: 1048576,
                    }],
                    selected_file_indexes: vec![0],
                    save_path: dir.to_string_lossy().to_string(),
                },
            );
        }

        // Confirmar que a chave existe e o handle está salvo
        {
            let guard = manager.entries.read().await;
            let entry = guard.get(&info_hash).unwrap();
            assert_eq!(entry.info_hash, info_hash);
            assert!(entry.metadata_ready);
            assert_eq!(entry.total_size, 1048576);
            assert_eq!(entry.handle.id(), handle.id());
        }

        let _ = std::fs::remove_file(file_path);
    }
}
