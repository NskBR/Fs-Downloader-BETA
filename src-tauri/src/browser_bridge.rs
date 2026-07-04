use axum::{
    body::Bytes,
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, COOKIE, REFERER};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

pub const BRIDGE_PORT: u16 = 17_831;

#[derive(Clone)]
pub struct BrowserBridge {
    token: String,
    contexts: Arc<Mutex<HashMap<String, HeaderMap>>>,
    last_seen: Arc<AtomicU64>,
}

impl Default for BrowserBridge {
    fn default() -> Self {
        Self {
            token: Uuid::new_v4().to_string(),
            contexts: Arc::new(Mutex::new(HashMap::new())),
            last_seen: Arc::new(AtomicU64::new(0)),
        }
    }
}

impl BrowserBridge {
    fn now_seconds() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or(0)
    }

    pub fn mark_seen(&self) {
        self.last_seen.store(Self::now_seconds(), Ordering::SeqCst);
    }

    pub fn mark_disconnected(&self) {
        self.last_seen.store(0, Ordering::SeqCst);
    }

    pub fn is_connected(&self) -> bool {
        Self::now_seconds().saturating_sub(self.last_seen.load(Ordering::SeqCst)) <= 90
            && self.last_seen.load(Ordering::SeqCst) > 0
    }

    pub fn take_headers(&self, id: Option<&str>) -> HeaderMap {
        id.and_then(|id| self.contexts.lock().ok()?.remove(id))
            .unwrap_or_default()
    }

    pub fn persist_headers(&self, download_id: &str, headers: &HeaderMap) -> Result<(), String> {
        if headers.is_empty() {
            return Ok(());
        }
        let values: Vec<(String, String)> = headers
            .iter()
            .filter_map(|(name, value)| {
                value
                    .to_str()
                    .ok()
                    .map(|value| (name.to_string(), value.to_string()))
            })
            .collect();
        let encoded = serde_json::to_string(&values).map_err(|error| error.to_string())?;
        keyring::Entry::new("SF Downloader", download_id)
            .map_err(|error| error.to_string())?
            .set_password(&encoded)
            .map_err(|error| {
                format!("Não foi possível proteger as credenciais do download: {error}")
            })
    }

    pub fn load_headers(&self, download_id: &str) -> HeaderMap {
        let Ok(entry) = keyring::Entry::new("SF Downloader", download_id) else {
            return HeaderMap::new();
        };
        let Ok(encoded) = entry.get_password() else {
            return HeaderMap::new();
        };
        let Ok(values) = serde_json::from_str::<Vec<(String, String)>>(&encoded) else {
            return HeaderMap::new();
        };
        let mut headers = HeaderMap::new();
        for (name, value) in values {
            if let (Ok(name), Ok(value)) =
                (HeaderName::try_from(name), HeaderValue::try_from(value))
            {
                headers.append(name, value);
            }
        }
        headers
    }

    pub fn remove_headers(&self, download_id: &str) {
        if let Ok(entry) = keyring::Entry::new("SF Downloader", download_id) {
            let _ = entry.delete_credential();
        }
    }
}

#[derive(Clone)]
struct BridgeState {
    app: AppHandle,
    bridge: BrowserBridge,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncResponse {
    enabled: bool,
    token: String,
    file_exts: Vec<&'static str>,
    blocked_hosts: Vec<&'static str>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserRequest {
    token: String,
    url: String,
    filename: Option<String>,
    file_size: Option<u64>,
    mime_type: Option<String>,
    referrer: Option<String>,
    cookie: Option<String>,
    #[serde(default)]
    request_headers: HashMap<String, Vec<String>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserDownloadEvent {
    request_id: String,
    url: String,
    file_name: Option<String>,
    file_size: Option<u64>,
    mime_type: Option<String>,
}

pub fn start(app: AppHandle, bridge: BrowserBridge) {
    tauri::async_runtime::spawn(async move {
        let state = BridgeState { app, bridge };
        let router = Router::new()
            .route("/sync", get(sync).options(handle_options))
            .route("/download", post(download).options(handle_options))
            .route("/disconnect", post(disconnect).options(handle_options))
            .with_state(state);
        let address = format!("127.0.0.1:{BRIDGE_PORT}");
        match tokio::net::TcpListener::bind(&address).await {
            Ok(listener) => {
                if let Err(error) = axum::serve(listener, router).await {
                    eprintln!("Ponte do navegador encerrada: {error}");
                }
            }
            Err(error) => {
                eprintln!("Não foi possível iniciar a ponte do navegador em {address}: {error}")
            }
        }
    });
}

async fn handle_options() -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    headers.insert("access-control-allow-origin", HeaderValue::from_static("*"));
    headers.insert(
        "access-control-allow-methods",
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    headers.insert(
        "access-control-allow-headers",
        HeaderValue::from_static("content-type"),
    );
    headers.insert(
        "access-control-allow-private-network",
        HeaderValue::from_static("true"),
    );
    (StatusCode::NO_CONTENT, headers)
}

async fn disconnect(State(state): State<BridgeState>) -> impl IntoResponse {
    state.bridge.mark_disconnected();
    let _ = state.app.emit("browser-extension-status", false);
    let mut headers = HeaderMap::new();
    headers.insert("access-control-allow-origin", HeaderValue::from_static("*"));
    (headers, Json(serde_json::json!({ "ok": true })))
}

async fn sync(State(state): State<BridgeState>) -> impl IntoResponse {
    state.bridge.mark_seen();
    let _ = state.app.emit("browser-extension-status", true);
    let mut headers = HeaderMap::new();
    headers.insert("access-control-allow-origin", HeaderValue::from_static("*"));
    (
        headers,
        Json(SyncResponse {
            enabled: true,
            token: state.bridge.token.clone(),
            file_exts: vec![
                ".ZIP", ".RAR", ".7Z", ".TAR", ".GZ", ".EXE", ".MSI", ".PDF", ".DOC", ".DOCX",
                ".XLS", ".XLSX", ".MP3", ".WAV", ".FLAC", ".MP4", ".MKV", ".AVI", ".ISO", ".BIN",
            ],
            blocked_hosts: vec![],
        }),
    )
}

#[tauri::command]
pub fn browser_extension_status(bridge: tauri::State<'_, BrowserBridge>) -> bool {
    bridge.is_connected()
}

async fn download(State(state): State<BridgeState>, body: Bytes) -> impl IntoResponse {
    let mut cors_headers = HeaderMap::new();
    cors_headers.insert("access-control-allow-origin", HeaderValue::from_static("*"));

    let Ok(request) = serde_json::from_slice::<BrowserRequest>(&body) else {
        return (cors_headers, StatusCode::BAD_REQUEST);
    };
    if request.token != state.bridge.token
        || !matches!(
            reqwest::Url::parse(&request.url)
                .ok()
                .map(|u| u.scheme().to_string())
                .as_deref(),
            Some("http" | "https")
        )
    {
        return (cors_headers, StatusCode::FORBIDDEN);
    }
    let mut headers = HeaderMap::new();
    for (name, values) in request.request_headers {
        let Ok(name) = HeaderName::try_from(name) else {
            continue;
        };
        if matches!(
            name.as_str(),
            "host" | "content-length" | "connection" | "range" | "accept-encoding"
        ) {
            continue;
        }
        for value in values {
            if let Ok(value) = HeaderValue::try_from(value) {
                headers.append(name.clone(), value);
            }
        }
    }
    if let Some(cookie) = request.cookie.and_then(|v| HeaderValue::try_from(v).ok()) {
        headers.insert(COOKIE, cookie);
    }
    if let Some(referer) = request.referrer.and_then(|v| HeaderValue::try_from(v).ok()) {
        headers.insert(REFERER, referer);
    }
    let request_id = Uuid::new_v4().to_string();
    if let Ok(mut contexts) = state.bridge.contexts.lock() {
        contexts.insert(request_id.clone(), headers);
    } else {
        return (cors_headers, StatusCode::INTERNAL_SERVER_ERROR);
    }
    let event = BrowserDownloadEvent {
        request_id,
        url: request.url,
        file_name: request.filename,
        file_size: request.file_size,
        mime_type: request.mime_type,
    };
    if state.app.emit("browser-download-request", event).is_err() {
        return (cors_headers, StatusCode::INTERNAL_SERVER_ERROR);
    }
    (cors_headers, StatusCode::ACCEPTED)
}
