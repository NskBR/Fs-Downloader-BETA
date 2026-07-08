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
const MIGRATION_004: &str = r#"
CREATE TABLE IF NOT EXISTS usage_downloads (
  download_id TEXT PRIMARY KEY NOT NULL,
  file_name TEXT NOT NULL,
  network_bytes INTEGER NOT NULL DEFAULT 0,
  disk_read_bytes INTEGER NOT NULL DEFAULT 0,
  disk_written_bytes INTEGER NOT NULL DEFAULT 0,
  average_speed REAL NOT NULL DEFAULT 0,
  io_measured INTEGER NOT NULL DEFAULT 1,
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_usage_downloads_completed ON usage_downloads(completed_at DESC);
INSERT OR IGNORE INTO usage_downloads(
  download_id,file_name,network_bytes,disk_read_bytes,disk_written_bytes,
  average_speed,io_measured,completed_at
)
SELECT 'history:' || id,file_name,MAX(COALESCE(file_size,0),0),0,
       MAX(COALESCE(file_size,0),0),COALESCE(average_speed,0),0,created_at
FROM history_items
WHERE action_type='download' AND status='completed';
"#;
const MIGRATION_005: &str = r#"
ALTER TABLE usage_downloads ADD COLUMN status TEXT NOT NULL DEFAULT 'completed';
"#;
const MIGRATION_006: &str = r#"
CREATE TABLE IF NOT EXISTS metrics (
  key TEXT PRIMARY KEY NOT NULL,
  value INTEGER NOT NULL DEFAULT 0
);
"#;
const MIGRATION_007: &str = r#"
ALTER TABLE download_tasks ADD COLUMN delete_archive_after_extract INTEGER NOT NULL DEFAULT 0;
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
    if version < 4 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(MIGRATION_004)?;
        transaction.execute_batch("PRAGMA user_version = 4")?;
        transaction.commit()?;
    }
    if version < 5 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(MIGRATION_005)?;
        transaction.execute_batch("PRAGMA user_version = 5")?;
        transaction.commit()?;
    }
    if version < 6 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(MIGRATION_006)?;
        transaction.execute_batch("PRAGMA user_version = 6")?;
        transaction.commit()?;
    }
    if version < 7 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(MIGRATION_007)?;
        transaction.execute_batch("PRAGMA user_version = 7")?;
        transaction.commit()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_four_backfills_completed_history() {
        let mut connection = Connection::open_in_memory().unwrap();
        run(&mut connection).unwrap();
        connection.execute("INSERT INTO history_items(id,file_name,file_size,action_type,status,path,created_at) VALUES('old','archive.zip',512,'download','completed','x','2026-07-05 12:00:00')", []).unwrap();
        connection
            .execute_batch("DROP TABLE usage_downloads; PRAGMA user_version = 3;")
            .unwrap();
        run(&mut connection).unwrap();
        let values: (i64, i64, i64) = connection.query_row(
            "SELECT network_bytes,disk_written_bytes,io_measured FROM usage_downloads WHERE download_id='history:old'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).unwrap();
        assert_eq!(values, (512, 512, 0));
    }
}
