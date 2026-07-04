use crate::database::models::DownloadChunk;
use rusqlite::{params, Connection, Result};
use uuid::Uuid;

pub fn create_plan(
    connection: &mut Connection,
    download_id: &str,
    total: i64,
    count: usize,
) -> Result<Vec<DownloadChunk>> {
    connection.execute(
        "DELETE FROM download_chunks WHERE download_id=?1",
        [download_id],
    )?;
    let tx = connection.transaction()?;
    let base = total / count as i64;
    let mut start = 0;
    let mut chunks = Vec::with_capacity(count);
    for index in 0..count {
        let end = if index + 1 == count {
            total - 1
        } else {
            start + base - 1
        };
        let id = Uuid::new_v4().to_string();
        tx.execute("INSERT INTO download_chunks(id,download_id,chunk_index,start_byte,end_byte,downloaded_bytes,status) VALUES(?1,?2,?3,?4,?5,0,'pending')",params![id,download_id,index as i64,start,end])?;
        chunks.push(DownloadChunk {
            id,
            download_id: download_id.into(),
            index: index as i64,
            start_byte: start,
            end_byte: end,
            downloaded_bytes: 0,
            status: "pending".into(),
            checksum: None,
            created_at: String::new(),
            updated_at: String::new(),
        });
        start = end + 1;
    }
    tx.commit()?;
    Ok(chunks)
}

pub fn list(connection: &Connection, download_id: &str) -> Result<Vec<DownloadChunk>> {
    let mut statement=connection.prepare("SELECT id,download_id,chunk_index,start_byte,end_byte,downloaded_bytes,status,checksum,created_at,updated_at FROM download_chunks WHERE download_id=?1 ORDER BY chunk_index")?;
    let chunks = statement
        .query_map([download_id], |row| {
            Ok(DownloadChunk {
                id: row.get(0)?,
                download_id: row.get(1)?,
                index: row.get(2)?,
                start_byte: row.get(3)?,
                end_byte: row.get(4)?,
                downloaded_bytes: row.get(5)?,
                status: row.get(6)?,
                checksum: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })?
        .collect();
    chunks
}

pub fn update_progress(
    connection: &Connection,
    id: &str,
    downloaded: i64,
    status: &str,
) -> Result<()> {
    connection.execute("UPDATE download_chunks SET downloaded_bytes=?2,status=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?1",params![id,downloaded,status])?;
    Ok(())
}

pub fn reset_active(connection: &Connection, download_id: &str) -> Result<()> {
    connection.execute(
        "UPDATE download_chunks SET status='pending' WHERE download_id=?1 AND status='downloading'",
        [download_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations;

    #[test]
    fn plan_covers_file_without_gaps_or_overlap() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrations::run(&mut connection).unwrap();
        connection.execute("INSERT INTO download_tasks(id,file_name,original_url,current_url,save_path,temp_path,final_path,status) VALUES('d','f','u','u','s','t','f','pending')", []).unwrap();
        let plan = create_plan(&mut connection, "d", 10, 3).unwrap();
        assert_eq!((plan[0].start_byte, plan[0].end_byte), (0, 2));
        assert_eq!((plan[1].start_byte, plan[1].end_byte), (3, 5));
        assert_eq!((plan[2].start_byte, plan[2].end_byte), (6, 9));
    }
}
