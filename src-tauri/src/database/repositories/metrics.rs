use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

const TOTAL_BYTES: &str = "total_bytes";
const COMPLETED_BYTES: &str = "completed_bytes";
const CANCELLED_BYTES: &str = "cancelled_bytes";
const FAILED_BYTES: &str = "failed_bytes";
const EXTRACTED_BYTES: &str = "extracted_bytes";
const SSD_WRITTEN_BYTES: &str = "ssd_written_bytes";
const COMPLETED_COUNT: &str = "completed_count";
const TOTAL_DURATION_MS: &str = "total_duration_ms";

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct MetricsSnapshot {
    pub total_bytes: i64,
    pub completed_bytes: i64,
    pub cancelled_bytes: i64,
    pub failed_bytes: i64,
    pub extracted_bytes: i64,
    pub ssd_written_bytes: i64,
    pub completed_count: i64,
    pub total_duration_ms: i64,
}

fn increment(connection: &Connection, key: &str, amount: i64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    connection.execute(
        "INSERT INTO metrics(key,value) VALUES(?1,?2)
         ON CONFLICT(key) DO UPDATE SET value = value + ?2",
        params![key, amount],
    )?;
    Ok(())
}

pub fn record(
    connection: &Connection,
    network_bytes: i64,
    disk_written_bytes: i64,
    extracted_bytes: i64,
    status: &str,
    duration_ms: i64,
) -> Result<()> {
    let network = network_bytes.max(0);
    let written = disk_written_bytes.max(0);
    let extracted = extracted_bytes.max(0);
    let duration = duration_ms.max(0);
    increment(connection, TOTAL_BYTES, network)?;
    increment(connection, SSD_WRITTEN_BYTES, written)?;
    increment(connection, EXTRACTED_BYTES, extracted)?;
    match status {
        "completed" => {
            increment(connection, COMPLETED_BYTES, network)?;
            increment(connection, COMPLETED_COUNT, 1)?;
            increment(connection, TOTAL_DURATION_MS, duration)?;
        }
        "cancelled" => increment(connection, CANCELLED_BYTES, network)?,
        "failed" => increment(connection, FAILED_BYTES, network)?,
        _ => {}
    }
    Ok(())
}

pub fn snapshot(connection: &Connection) -> Result<MetricsSnapshot> {
    let value = |key: &str| -> i64 {
        connection
            .query_row(
                "SELECT COALESCE(SUM(value),0) FROM metrics WHERE key=?1",
                params![key],
                |row| row.get(0),
            )
            .unwrap_or(0)
    };
    Ok(MetricsSnapshot {
        total_bytes: value(TOTAL_BYTES),
        completed_bytes: value(COMPLETED_BYTES),
        cancelled_bytes: value(CANCELLED_BYTES),
        failed_bytes: value(FAILED_BYTES),
        extracted_bytes: value(EXTRACTED_BYTES),
        ssd_written_bytes: value(SSD_WRITTEN_BYTES),
        completed_count: value(COMPLETED_COUNT),
        total_duration_ms: value(TOTAL_DURATION_MS),
    })
}

pub fn reset(connection: &Connection) -> Result<()> {
    connection.execute("DELETE FROM metrics", [])?;
    Ok(())
}

pub fn replace(connection: &Connection, snapshot: &MetricsSnapshot) -> Result<()> {
    reset(connection)?;
    let insert = |key: &str, value: i64| -> Result<()> {
        if value != 0 {
            connection.execute(
                "INSERT INTO metrics(key,value) VALUES(?1,?2)",
                params![key, value],
            )?;
        }
        Ok(())
    };
    insert(TOTAL_BYTES, snapshot.total_bytes)?;
    insert(COMPLETED_BYTES, snapshot.completed_bytes)?;
    insert(CANCELLED_BYTES, snapshot.cancelled_bytes)?;
    insert(FAILED_BYTES, snapshot.failed_bytes)?;
    insert(EXTRACTED_BYTES, snapshot.extracted_bytes)?;
    insert(SSD_WRITTEN_BYTES, snapshot.ssd_written_bytes)?;
    insert(COMPLETED_COUNT, snapshot.completed_count)?;
    insert(TOTAL_DURATION_MS, snapshot.total_duration_ms)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations;

    #[test]
    fn accumulates_and_resets_counters() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrations::run(&mut connection).unwrap();
        record(&connection, 1000, 1100, 100, "completed", 2000).unwrap();
        record(&connection, 500, 500, 0, "cancelled", 0).unwrap();
        record(&connection, 250, 250, 0, "failed", 0).unwrap();
        let snapshot = snapshot(&connection).unwrap();
        assert_eq!(snapshot.total_bytes, 1750);
        assert_eq!(snapshot.completed_bytes, 1000);
        assert_eq!(snapshot.cancelled_bytes, 500);
        assert_eq!(snapshot.failed_bytes, 250);
        assert_eq!(snapshot.extracted_bytes, 100);
        assert_eq!(snapshot.ssd_written_bytes, 1850);
        assert_eq!(snapshot.completed_count, 1);
        assert_eq!(snapshot.total_duration_ms, 2000);
        reset(&connection).unwrap();
        let cleared = crate::database::repositories::metrics::snapshot(&connection).unwrap();
        assert_eq!(cleared.total_bytes, 0);
        assert_eq!(cleared.completed_count, 0);
    }
}
