use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DownloadStatus {
    Pending,
    Downloading,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

impl DownloadStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Downloading => "downloading",
            Self::Paused => "paused",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
    pub fn parse(value: &str) -> Self {
        match value {
            "downloading" => Self::Downloading,
            "paused" => Self::Paused,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            "cancelled" => Self::Cancelled,
            _ => Self::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTask {
    pub id: String,
    pub file_name: String,
    pub file_size: Option<i64>,
    pub original_url: String,
    pub current_url: String,
    pub save_path: String,
    pub temp_path: String,
    pub final_path: String,
    pub status: DownloadStatus,
    pub mime_type: Option<String>,
    pub extension: Option<String>,
    pub supports_range: bool,
    pub max_connections: i64,
    pub max_parallel_downloads: i64,
    pub speed_limit_download: i64,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub total_downloaded: i64,
    pub speed_current: f64,
    pub speed_average: f64,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDownloadInput {
    pub file_name: String,
    pub file_size: Option<i64>,
    pub original_url: String,
    pub save_path: String,
    pub temp_path: String,
    pub final_path: String,
    pub mime_type: Option<String>,
    pub extension: Option<String>,
    pub supports_range: bool,
    #[serde(default = "default_max_connections")]
    pub max_connections: i64,
    #[serde(default = "default_parallel_downloads")]
    pub max_parallel_downloads: i64,
    #[serde(default)]
    pub speed_limit_download: i64,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

fn default_max_connections() -> i64 {
    8
}
fn default_parallel_downloads() -> i64 {
    3
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDownloadInput {
    pub id: String,
    pub status: DownloadStatus,
    pub total_downloaded: i64,
    pub speed_current: f64,
    pub speed_average: f64,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadChunk {
    pub id: String,
    pub download_id: String,
    pub index: i64,
    pub start_byte: i64,
    pub end_byte: i64,
    pub downloaded_bytes: i64,
    pub status: String,
    pub checksum: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSource {
    pub id: String,
    pub download_id: String,
    pub url: String,
    pub added_at: String,
    pub expired: bool,
    pub last_error: Option<String>,
    pub average_speed: f64,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub id: String,
    pub file_name: String,
    pub file_size: Option<i64>,
    pub action_type: String,
    pub status: String,
    pub source_url: Option<String>,
    pub path: String,
    pub duration_seconds: Option<i64>,
    pub average_speed: Option<f64>,
    pub created_at: String,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub id: i64,
    pub root_download_folder: String,
    pub auto_organize_enabled: bool,
    pub default_speed_value: f64,
    pub default_speed_unit: String,
    pub max_parallel_downloads: i64,
    pub max_connections_per_download: i64,
    pub speed_limit_download: Option<i64>,
    pub speed_limit_upload: Option<i64>,
    pub theme: String,
    pub auto_extract_enabled: bool,
    pub delete_archive_after_extract: bool,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub id: String,
    pub display_name: String,
    pub avatar_path: Option<String>,
    pub local_user_id: String,
    pub status: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
