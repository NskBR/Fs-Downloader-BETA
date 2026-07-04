use std::{
    collections::HashMap,
    fs, io,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
};

static REQUESTS: LazyLock<Mutex<HashMap<String, Option<String>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static RESULTS: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn register(id: String, password: Option<String>) {
    if let Ok(mut requests) = REQUESTS.lock() {
        requests.insert(id, password.filter(|value| !value.is_empty()));
    }
}

pub fn take(id: &str) -> Option<Option<String>> {
    REQUESTS.lock().ok()?.remove(id)
}

pub fn save_result(id: &str, result: String) {
    if let Ok(mut results) = RESULTS.lock() {
        results.insert(id.to_owned(), result);
    }
}

#[tauri::command]
pub fn extraction_status(id: String) -> Option<String> {
    RESULTS.lock().ok()?.get(&id).cloned()
}

pub async fn extract_archive(path: String, password: Option<String>) -> Result<PathBuf, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let archive_path = Path::new(&path);
        match archive_path
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("zip") => extract_zip_blocking(archive_path, password.as_deref()),
            Some("7z") => extract_7z_blocking(archive_path, password.as_deref()),
            _ => Err("Formato de extração não suportado.".to_string()),
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

fn extract_7z_blocking(archive_path: &Path, password: Option<&str>) -> Result<PathBuf, String> {
    use std::path::Component;

    let archive = match password {
        Some(password) => sevenz_rust2::Archive::open_with_password(
            archive_path,
            &sevenz_rust2::Password::from(password),
        ),
        None => sevenz_rust2::Archive::open(archive_path),
    }
    .map_err(|_| "Arquivo 7z inválido ou senha incorreta/ausente.".to_string())?;
    if archive.files.len() > 10_000 {
        return Err("O 7z contém arquivos demais e foi bloqueado por segurança.".to_string());
    }
    let expanded_size = archive
        .files
        .iter()
        .fold(0_u64, |total, entry| total.saturating_add(entry.size()));
    let compressed_size = archive
        .pack_sizes()
        .iter()
        .fold(0_u64, |total, size| total.saturating_add(*size));
    const MAX_EXPANDED_SIZE: u64 = 50 * 1024 * 1024 * 1024;
    if expanded_size > MAX_EXPANDED_SIZE
        || (compressed_size > 0 && expanded_size / compressed_size > 200)
    {
        return Err("O 7z parece suspeito e foi bloqueado por segurança.".to_string());
    }
    if archive.files.iter().any(|entry| {
        Path::new(entry.name())
            .components()
            .any(|component| !matches!(component, Component::Normal(_) | Component::CurDir))
    }) {
        return Err("O 7z contém um caminho inseguro.".to_string());
    }
    let destination = extraction_destination(archive_path)?;
    fs::create_dir_all(&destination).map_err(|error| error.to_string())?;
    let result = match password {
        Some(password) => sevenz_rust2::decompress_file_with_password(
            archive_path,
            &destination,
            sevenz_rust2::Password::from(password),
        ),
        None => sevenz_rust2::decompress_file(archive_path, &destination),
    };
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&destination);
        return Err(format!("Falha ao extrair 7z; verifique a senha: {error}"));
    }
    Ok(destination)
}

fn extraction_destination(archive_path: &Path) -> Result<PathBuf, String> {
    let stem = archive_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("extraido");
    let destination = archive_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(stem);
    if destination.exists() {
        return Err(format!(
            "A pasta '{}' já existe; nada foi sobrescrito.",
            destination.display()
        ));
    }
    Ok(destination)
}

fn extract_zip_blocking(archive_path: &Path, password: Option<&str>) -> Result<PathBuf, String> {
    let file = fs::File::open(archive_path).map_err(|error| error.to_string())?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|error| format!("ZIP inválido: {error}"))?;
    if archive.len() > 10_000 {
        return Err("O ZIP contém arquivos demais e foi bloqueado por segurança.".to_string());
    }

    let mut expanded_size = 0_u64;
    let mut compressed_size = 0_u64;
    for index in 0..archive.len() {
        let entry = archive
            .by_index_raw(index)
            .map_err(|error| format!("Falha ao inspecionar ZIP: {error}"))?;
        expanded_size = expanded_size.saturating_add(entry.size());
        compressed_size = compressed_size.saturating_add(entry.compressed_size());
    }
    const MAX_EXPANDED_SIZE: u64 = 50 * 1024 * 1024 * 1024;
    if expanded_size > MAX_EXPANDED_SIZE
        || (compressed_size > 0 && expanded_size / compressed_size > 200)
    {
        return Err("O ZIP parece suspeito e foi bloqueado por segurança.".to_string());
    }
    let destination = extraction_destination(archive_path)?;
    fs::create_dir_all(&destination).map_err(|error| error.to_string())?;
    for index in 0..archive.len() {
        let mut entry = match password {
            Some(password) => archive
                .by_index_decrypt(index, password.as_bytes())
                .map_err(|_| "Senha incorreta ou ausente.".to_string())?,
            None => archive
                .by_index(index)
                .map_err(|error| format!("Falha ao ler ZIP: {error}"))?,
        };
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| "O ZIP contém um caminho inseguro.".to_string())?;
        let output = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&output).map_err(|error| error.to_string())?;
            continue;
        }
        if output.exists() {
            return Err(format!(
                "O arquivo '{}' já existe; nada foi sobrescrito.",
                output.display()
            ));
        }
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut target = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&output)
            .map_err(|error| error.to_string())?;
        io::copy(&mut entry, &mut target).map_err(|error| error.to_string())?;
    }
    Ok(destination)
}

#[cfg(test)]
mod tests {
    use super::extract_7z_blocking;
    use std::fs;

    #[test]
    fn extracts_a_real_7z_archive() {
        let root = std::env::temp_dir().join(format!("sf-7z-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("conteudo.txt");
        let archive = root.join("pacote.7z");
        fs::write(&source, b"SF Downloader 7z").unwrap();
        sevenz_rust2::compress_to_path(&source, &archive).unwrap();

        let destination = extract_7z_blocking(&archive, None).unwrap();
        assert_eq!(
            fs::read(destination.join("conteudo.txt")).unwrap(),
            b"SF Downloader 7z"
        );
        let _ = fs::remove_dir_all(root);
    }
}
