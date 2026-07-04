use crate::database::models::HistoryItem;
use rusqlite::{params, Connection, Result};
use uuid::Uuid;

pub struct CreateHistory<'a> {
    pub file_name: &'a str,
    pub file_size: Option<i64>,
    pub status: &'a str,
    pub source_url: &'a str,
    pub path: &'a str,
    pub duration_seconds: i64,
    pub average_speed: f64,
}

pub fn create(connection: &Connection, item: CreateHistory<'_>) -> Result<()> {
    connection.execute(
        "INSERT INTO history_items(id,file_name,file_size,action_type,status,source_url,path,duration_seconds,average_speed) VALUES(?1,?2,?3,'download',?4,?5,?6,?7,?8)",
        params![Uuid::new_v4().to_string(), item.file_name, item.file_size, item.status, item.source_url, item.path, item.duration_seconds, item.average_speed],
    )?;
    Ok(())
}

pub fn list(connection: &Connection) -> Result<Vec<HistoryItem>> {
    let mut statement = connection.prepare("SELECT id,file_name,file_size,action_type,status,source_url,path,duration_seconds,average_speed,created_at FROM history_items ORDER BY created_at DESC")?;
    let items = statement
        .query_map([], |row| {
            Ok(HistoryItem {
                id: row.get(0)?,
                file_name: row.get(1)?,
                file_size: row.get(2)?,
                action_type: row.get(3)?,
                status: row.get(4)?,
                source_url: row.get(5)?,
                path: row.get(6)?,
                duration_seconds: row.get(7)?,
                average_speed: row.get(8)?,
                created_at: row.get(9)?,
            })
        })?
        .collect();
    items
}

pub fn remove(connection: &Connection, id: &str) -> Result<bool> {
    Ok(connection.execute("DELETE FROM history_items WHERE id=?1", [id])? > 0)
}

pub fn clear(connection: &Connection, status: Option<&str>) -> Result<usize> {
    match status {
        Some(value) => connection.execute("DELETE FROM history_items WHERE status=?1", [value]),
        None => connection.execute("DELETE FROM history_items", []),
    }
}
