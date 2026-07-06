pub mod migrations;
pub mod models;
pub mod repositories;

use rusqlite::Connection;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

#[derive(Clone)]
pub struct Database {
    path: PathBuf,
    recovered_ids: Arc<Vec<String>>,
}

impl Database {
    pub fn initialize(data_dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(data_dir)
            .map_err(|error| format!("Não foi possível criar o diretório de dados: {error}"))?;
        let mut database = Self {
            path: data_dir.join("sf_downloader.sqlite3"),
            recovered_ids: Arc::new(Vec::new()),
        };
        let mut connection = database.connect()?;
        connection
            .execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")
            .map_err(|error| format!("Falha ao otimizar o banco local: {error}"))?;
        migrations::run(&mut connection)
            .map_err(|error| format!("Falha ao migrar o banco: {error}"))?;
        let recovered = repositories::downloads::recover_interrupted(&connection)
            .map_err(|error| format!("Falha ao recuperar downloads interrompidos: {error}"))?;
        database.recovered_ids = Arc::new(recovered);
        Ok(database)
    }

    pub fn connect(&self) -> Result<Connection, String> {
        let connection = Connection::open(&self.path)
            .map_err(|error| format!("Falha ao abrir o banco local: {error}"))?;
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 30000; PRAGMA wal_autocheckpoint = 1000;",
            )
            .map_err(|error| format!("Falha ao configurar o banco: {error}"))?;
        Ok(connection)
    }

    pub fn recovered_ids(&self) -> &[String] {
        &self.recovered_ids
    }
}
