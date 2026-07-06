use crate::database::{repositories::statistics, Database};
use tauri::State;

#[tauri::command]
pub fn profile_statistics(
    database: State<'_, Database>,
) -> Result<statistics::ProfileStatistics, String> {
    statistics::profile(&database.connect()?)
        .map_err(|error| format!("Falha ao calcular estatísticas: {error}"))
}
