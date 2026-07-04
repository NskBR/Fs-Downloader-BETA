use crate::database::models::{
    CreateDownloadInput, DownloadStatus, DownloadTask, UpdateDownloadInput,
};
use rusqlite::{params, Connection, OptionalExtension, Result};
use uuid::Uuid;

const COLUMNS: &str = "id,file_name,file_size,original_url,current_url,save_path,temp_path,final_path,status,mime_type,extension,supports_range,max_connections,max_parallel_downloads,speed_limit_download,etag,last_modified,total_downloaded,speed_current,speed_average,created_at,updated_at,completed_at";

fn map_task(row: &rusqlite::Row<'_>) -> Result<DownloadTask> {
    Ok(DownloadTask {
        id: row.get(0)?,
        file_name: row.get(1)?,
        file_size: row.get(2)?,
        original_url: row.get(3)?,
        current_url: row.get(4)?,
        save_path: row.get(5)?,
        temp_path: row.get(6)?,
        final_path: row.get(7)?,
        status: DownloadStatus::parse(&row.get::<_, String>(8)?),
        mime_type: row.get(9)?,
        extension: row.get(10)?,
        supports_range: row.get::<_, i64>(11)? != 0,
        max_connections: row.get(12)?,
        max_parallel_downloads: row.get(13)?,
        speed_limit_download: row.get(14)?,
        etag: row.get(15)?,
        last_modified: row.get(16)?,
        total_downloaded: row.get(17)?,
        speed_current: row.get(18)?,
        speed_average: row.get(19)?,
        created_at: row.get(20)?,
        updated_at: row.get(21)?,
        completed_at: row.get(22)?,
    })
}

pub fn create(connection: &Connection, input: CreateDownloadInput) -> Result<DownloadTask> {
    let id = Uuid::new_v4().to_string();
    connection.execute(
        "INSERT INTO download_tasks(id,file_name,file_size,original_url,current_url,save_path,temp_path,final_path,status,mime_type,extension,supports_range,max_connections,max_parallel_downloads,speed_limit_download,etag,last_modified) VALUES(?1,?2,?3,?4,?4,?5,?6,?7,'pending',?8,?9,?10,?11,?12,?13,?14,?15)",
        params![id, input.file_name, input.file_size, input.original_url, input.save_path, input.temp_path, input.final_path, input.mime_type, input.extension, input.supports_range, input.max_connections, input.max_parallel_downloads, input.speed_limit_download, input.etag, input.last_modified],
    )?;
    find(connection, &id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
}

pub fn find(connection: &Connection, id: &str) -> Result<Option<DownloadTask>> {
    connection
        .query_row(
            &format!("SELECT {COLUMNS} FROM download_tasks WHERE id=?1"),
            [id],
            map_task,
        )
        .optional()
}

pub fn list(connection: &Connection) -> Result<Vec<DownloadTask>> {
    let mut statement = connection.prepare(&format!(
        "SELECT {COLUMNS} FROM download_tasks ORDER BY created_at DESC"
    ))?;
    let tasks = statement.query_map([], map_task)?.collect();
    tasks
}

pub fn update(connection: &Connection, input: UpdateDownloadInput) -> Result<DownloadTask> {
    let completed = matches!(input.status, DownloadStatus::Completed);
    let affected = connection.execute(
        "UPDATE download_tasks SET status=?2,total_downloaded=?3,speed_current=?4,speed_average=?5,updated_at=CURRENT_TIMESTAMP,completed_at=CASE WHEN ?6 THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE id=?1",
        params![input.id, input.status.as_str(), input.total_downloaded, input.speed_current, input.speed_average, completed],
    )?;
    if affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    find(connection, &input.id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
}

pub fn remove(connection: &Connection, id: &str) -> Result<bool> {
    Ok(connection.execute("DELETE FROM download_tasks WHERE id=?1", [id])? > 0)
}

pub fn replace_url(connection: &Connection, id: &str, url: &str) -> Result<()> {
    connection.execute(
        "UPDATE download_tasks SET current_url=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1",
        params![id, url],
    )?;
    connection.execute(
        "INSERT INTO download_sources(id,download_id,url) VALUES(?1,?2,?3)",
        params![Uuid::new_v4().to_string(), id, url],
    )?;
    Ok(())
}

pub fn recover_interrupted(connection: &Connection) -> Result<Vec<String>> {
    let mut statement = connection.prepare("SELECT id,temp_path,total_downloaded FROM download_tasks WHERE status IN ('pending','checking_files','downloading','assembling','extracting')")?;
    let interrupted: Vec<(String, String, i64)> = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<Result<_>>()?;
    drop(statement);
    for (id, temp_path, recorded) in &interrupted {
        let (chunk_total, chunk_count): (i64, i64) = connection.query_row(
            "SELECT COALESCE(SUM(downloaded_bytes),0),COUNT(*) FROM download_chunks WHERE download_id=?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let actual = if chunk_count > 0 {
            chunk_total
        } else {
            std::fs::metadata(temp_path)
                .ok()
                .and_then(|metadata| i64::try_from(metadata.len()).ok())
                .unwrap_or(*recorded)
        };
        connection.execute("UPDATE download_tasks SET status='paused',total_downloaded=?2,speed_current=0,updated_at=CURRENT_TIMESTAMP WHERE id=?1", params![id,actual])?;
    }
    Ok(interrupted.into_iter().map(|(id, _, _)| id).collect())
}
pub fn update_speed_limit(connection: &Connection, id: &str, speed_limit: i64) -> Result<()> {
    connection.execute(
        "UPDATE download_tasks SET speed_limit_download=?2, updated_at=CURRENT_TIMESTAMP WHERE id=?1",
        params![id, speed_limit],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations;

    fn input() -> CreateDownloadInput {
        CreateDownloadInput {
            file_name: "arquivo.zip".into(),
            file_size: Some(1024),
            original_url: "https://example.com/arquivo.zip".into(),
            save_path: "C:/Downloads".into(),
            temp_path: "C:/Downloads/arquivo.zip.part".into(),
            final_path: "C:/Downloads/arquivo.zip".into(),
            mime_type: Some("application/zip".into()),
            extension: Some("zip".into()),
            supports_range: true,
            max_connections: 8,
            max_parallel_downloads: 3,
            speed_limit_download: 0,
            etag: None,
            last_modified: None,
        }
    }

    #[test]
    fn download_crud_cycle() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrations::run(&mut connection).unwrap();
        let created = create(&connection, input()).unwrap();
        assert_eq!(list(&connection).unwrap().len(), 1);
        let updated = update(
            &connection,
            UpdateDownloadInput {
                id: created.id.clone(),
                status: DownloadStatus::Paused,
                total_downloaded: 512,
                speed_current: 0.0,
                speed_average: 20.0,
            },
        )
        .unwrap();
        assert_eq!(updated.status, DownloadStatus::Paused);
        assert_eq!(updated.total_downloaded, 512);
        assert!(remove(&connection, &created.id).unwrap());
        assert!(list(&connection).unwrap().is_empty());
    }

    #[test]
    fn interrupted_download_becomes_paused_with_actual_file_size() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrations::run(&mut connection).unwrap();
        let temp_path = std::env::temp_dir().join(format!("sf-downloader-{}.part", Uuid::new_v4()));
        std::fs::write(&temp_path, [1_u8, 2, 3, 4]).unwrap();
        let mut new_download = input();
        new_download.temp_path = temp_path.to_string_lossy().into_owned();
        let created = create(&connection, new_download).unwrap();
        update(
            &connection,
            UpdateDownloadInput {
                id: created.id.clone(),
                status: DownloadStatus::Downloading,
                total_downloaded: 2,
                speed_current: 10.0,
                speed_average: 10.0,
            },
        )
        .unwrap();
        assert_eq!(recover_interrupted(&connection).unwrap().len(), 1);
        let recovered = find(&connection, &created.id).unwrap().unwrap();
        assert_eq!(recovered.status, DownloadStatus::Paused);
        assert_eq!(recovered.total_downloaded, 4);
        let _ = std::fs::remove_file(temp_path);
    }

    #[test]
    fn preallocated_segmented_file_recovers_from_chunk_progress() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrations::run(&mut connection).unwrap();
        let temp_path = std::env::temp_dir().join(format!("sf-downloader-{}.part", Uuid::new_v4()));
        let file = std::fs::File::create(&temp_path).unwrap();
        file.set_len(1024).unwrap();
        let mut new_download = input();
        new_download.temp_path = temp_path.to_string_lossy().into_owned();
        let created = create(&connection, new_download).unwrap();
        connection.execute(
            "INSERT INTO download_chunks(id,download_id,chunk_index,start_byte,end_byte,downloaded_bytes,status) VALUES('c',?1,0,0,1023,256,'downloading')",
            [&created.id],
        ).unwrap();
        update(
            &connection,
            UpdateDownloadInput {
                id: created.id.clone(),
                status: DownloadStatus::Downloading,
                total_downloaded: 128,
                speed_current: 10.0,
                speed_average: 10.0,
            },
        )
        .unwrap();
        recover_interrupted(&connection).unwrap();
        let recovered = find(&connection, &created.id).unwrap().unwrap();
        assert_eq!(recovered.total_downloaded, 256);
        let _ = std::fs::remove_file(temp_path);
    }
}
