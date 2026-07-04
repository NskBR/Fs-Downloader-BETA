use rusqlite::{Connection, Result};

const MIGRATION_001: &str = r#"
CREATE TABLE IF NOT EXISTS download_tasks (
  id TEXT PRIMARY KEY NOT NULL, file_name TEXT NOT NULL, file_size INTEGER,
  original_url TEXT NOT NULL, current_url TEXT NOT NULL, save_path TEXT NOT NULL,
  temp_path TEXT NOT NULL, final_path TEXT NOT NULL, status TEXT NOT NULL,
  mime_type TEXT, extension TEXT, supports_range INTEGER NOT NULL DEFAULT 0,
  etag TEXT, last_modified TEXT, total_downloaded INTEGER NOT NULL DEFAULT 0,
  speed_current REAL NOT NULL DEFAULT 0, speed_average REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT
);
CREATE TABLE IF NOT EXISTS download_chunks (
  id TEXT PRIMARY KEY NOT NULL, download_id TEXT NOT NULL, chunk_index INTEGER NOT NULL,
  start_byte INTEGER NOT NULL, end_byte INTEGER NOT NULL, downloaded_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL, checksum TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(download_id) REFERENCES download_tasks(id) ON DELETE CASCADE,
  UNIQUE(download_id, chunk_index)
);
CREATE TABLE IF NOT EXISTS download_sources (
  id TEXT PRIMARY KEY NOT NULL, download_id TEXT NOT NULL, url TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expired INTEGER NOT NULL DEFAULT 0,
  last_error TEXT, average_speed REAL NOT NULL DEFAULT 0,
  FOREIGN KEY(download_id) REFERENCES download_tasks(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS history_items (
  id TEXT PRIMARY KEY NOT NULL, file_name TEXT NOT NULL, file_size INTEGER,
  action_type TEXT NOT NULL, status TEXT NOT NULL, source_url TEXT, path TEXT NOT NULL,
  duration_seconds INTEGER, average_speed REAL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1), root_download_folder TEXT NOT NULL DEFAULT '',
  auto_organize_enabled INTEGER NOT NULL DEFAULT 1, default_speed_value REAL NOT NULL DEFAULT 100,
  default_speed_unit TEXT NOT NULL DEFAULT 'Mbps', max_parallel_downloads INTEGER NOT NULL DEFAULT 3,
  max_connections_per_download INTEGER NOT NULL DEFAULT 8, speed_limit_download INTEGER,
  speed_limit_upload INTEGER, theme TEXT NOT NULL DEFAULT 'dark', auto_extract_enabled INTEGER NOT NULL DEFAULT 0,
  delete_archive_after_extract INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS user_profiles (
  id TEXT PRIMARY KEY NOT NULL, display_name TEXT NOT NULL, avatar_path TEXT,
  local_user_id TEXT NOT NULL UNIQUE, status TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_download_tasks_status ON download_tasks(status);
CREATE INDEX IF NOT EXISTS idx_download_chunks_download ON download_chunks(download_id);
CREATE INDEX IF NOT EXISTS idx_history_created ON history_items(created_at DESC);
INSERT OR IGNORE INTO app_settings(id) VALUES(1);
"#;

const MIGRATION_002: &str = r#"
ALTER TABLE download_tasks ADD COLUMN max_connections INTEGER NOT NULL DEFAULT 8;
"#;
const MIGRATION_003: &str = r#"
ALTER TABLE download_tasks ADD COLUMN max_parallel_downloads INTEGER NOT NULL DEFAULT 3;
ALTER TABLE download_tasks ADD COLUMN speed_limit_download INTEGER NOT NULL DEFAULT 0;
"#;

pub fn run(connection: &mut Connection) -> Result<()> {
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version < 1 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(MIGRATION_001)?;
        transaction.execute_batch("PRAGMA user_version = 1")?;
        transaction.commit()?;
    }
    if version < 2 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(MIGRATION_002)?;
        transaction.execute_batch("PRAGMA user_version = 2")?;
        transaction.commit()?;
    }
    if version < 3 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(MIGRATION_003)?;
        transaction.execute_batch("PRAGMA user_version = 3")?;
        transaction.commit()?;
    }
    Ok(())
}
