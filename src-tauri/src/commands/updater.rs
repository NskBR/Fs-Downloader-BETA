use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Clone)]
pub struct UpdateCheckResult {
    pub available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_url: String,
    pub release_name: Option<String>,
    pub release_notes: Option<String>,
}

fn is_version_newer(latest: &str, current: &str) -> bool {
    if latest.is_empty() {
        return false;
    }
    let parse_ver = |v: &str| -> Vec<u64> {
        v.split('.')
            .map(|p| p.parse::<u64>().unwrap_or(0))
            .collect()
    };
    let l_parts = parse_ver(latest);
    let c_parts = parse_ver(current);

    l_parts > c_parts
}

#[tauri::command]
pub async fn check_for_updates(
    app: AppHandle,
    repo_override: Option<String>,
) -> Result<UpdateCheckResult, String> {
    let repo = repo_override
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "skell/sf-downloader".to_string());

    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let url = format!("https://api.github.com/repos/{}/releases/latest", repo);

    let client = reqwest::Client::builder()
        .user_agent("sf-downloader-updater")
        .build()
        .map_err(|e| format!("Erro ao criar cliente HTTP: {e}"))?;

    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => {
            println!("[UPDATER] Erro de rede ao checar atualizações: {:?}", e);
            return Ok(UpdateCheckResult {
                available: false,
                current_version: current_version.clone(),
                latest_version: current_version,
                release_url: format!("https://github.com/{}", repo),
                release_name: None,
                release_notes: None,
            });
        }
    };

    if !resp.status().is_success() {
        println!("[UPDATER] GitHub API respondeu status: {}", resp.status());
        return Ok(UpdateCheckResult {
            available: false,
            current_version: current_version.clone(),
            latest_version: current_version,
            release_url: format!("https://github.com/{}", repo),
            release_name: None,
            release_notes: None,
        });
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Falha ao ler resposta do GitHub: {e}"))?;

    let raw_tag = json["tag_name"].as_str().unwrap_or("");
    let tag_name = raw_tag.trim_start_matches('v').to_string();

    let release_url = json["html_url"]
        .as_str()
        .unwrap_or(&format!("https://github.com/{}", repo))
        .to_string();

    let release_name = json["name"].as_str().map(String::from);
    let release_notes = json["body"].as_str().map(String::from);

    let available = is_version_newer(&tag_name, &current_version);

    // Se houver atualização disponível, abrir a janela principal (sair do modo tray)
    if available {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }

    Ok(UpdateCheckResult {
        available,
        current_version,
        latest_version: if tag_name.is_empty() {
            env!("CARGO_PKG_VERSION").to_string()
        } else {
            tag_name
        },
        release_url,
        release_name,
        release_notes,
    })
}
