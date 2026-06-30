// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

//! Auto-update module — version checking, download, install, and relaunch.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::panic_guard::lock_recovered;

// ============ Types ============

/// Update check result returned to the frontend
#[derive(serde::Serialize, Clone)]
pub struct UpdateCheckResult {
    pub has_update: bool,
    pub latest_version: String,
    pub current_version: String,
    pub download_url: String,
    pub release_url: String,
    pub file_size: u64,
}

/// Download progress event payload
#[derive(serde::Serialize, Clone)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub percent: u8,
}

/// Install result returned to the frontend
#[derive(Debug, serde::Serialize)]
pub struct UpdateInstallResult {
    pub auto_installed: bool,
    pub message: String,
    pub backup_created: bool,
    pub backup_path: Option<String>,
}

/// Optional install behavior supplied by the frontend.
#[derive(serde::Deserialize, Default)]
pub struct UpdateInstallOptions {
    #[serde(default)]
    pub backup: bool,
}

#[derive(Default)]
struct UpdateBackupInfo {
    created: bool,
    path: Option<PathBuf>,
}

// ============ Global Progress State ============

/// Global download progress state — shared across command calls via Arc<Mutex>
static DOWNLOAD_PROGRESS: std::sync::OnceLock<Arc<Mutex<DownloadProgressState>>> =
    std::sync::OnceLock::new();

#[derive(Default)]
struct DownloadProgressState {
    downloaded: u64,
    total: u64,
    percent: u8,
    error: Option<String>,
    done: bool,
    download_path: Option<String>,
}

/// Get or init the global download progress state
fn get_progress_state() -> Arc<Mutex<DownloadProgressState>> {
    DOWNLOAD_PROGRESS
        .get_or_init(|| Arc::new(Mutex::new(DownloadProgressState::default())))
        .clone()
}

// ============ Version Utilities ============

/// Parse an updater semver string into (major, minor, patch).
fn parse_semver(version: &str) -> Option<(u32, u32, u32)> {
    let v = version.strip_prefix('v').unwrap_or(version);
    let parts: Vec<&str> = v.split('.').collect();
    if parts.len() >= 3 {
        let major = parts[0].parse().ok()?;
        let minor = parts[1].parse().ok()?;
        let patch = parts[2].parse().ok()?;
        Some((major, minor, patch))
    } else {
        None
    }
}

/// Compare updater versions; returns true if latest > current.
fn is_newer_version(latest: &str, current: &str) -> bool {
    match (parse_semver(latest), parse_semver(current)) {
        (Some(l), Some(c)) => l > c,
        _ => false,
    }
}

/// Get the update asset filename for the current platform/arch.
pub(crate) fn get_platform_download_filename(version: &str) -> Option<String> {
    let v = version.strip_prefix('v').unwrap_or(version);

    #[cfg(target_os = "macos")]
    {
        return if cfg!(target_arch = "aarch64") {
            Some(format!("openloomi_{}_macOS_aarch64.dmg", v))
        } else {
            Some(format!("openloomi_{}_macOS_amd64.dmg", v))
        };
    }

    #[cfg(target_os = "linux")]
    {
        return if cfg!(target_arch = "aarch64") {
            Some(format!("openloomi_{}_linux_aarch64.deb", v))
        } else {
            Some(format!("openloomi_{}_linux_amd64.deb", v))
        };
    }

    #[cfg(target_os = "windows")]
    {
        return Some(format!("openloomi_{}_windows_amd64.exe", v));
    }

    #[allow(unreachable_code)]
    None
}

// ============ Platform Installers ============

/// macOS: mount DMG → ditto → unmount
#[cfg(target_os = "macos")]
fn auto_install_platform(download_path: &std::path::Path) -> Result<(), String> {
    use std::fs;
    use std::process::Command;

    let temp_mount = std::env::temp_dir().join("openloomi_update_mount");
    let mount_str = temp_mount.to_string_lossy().to_string();
    let dmg_str = download_path.to_string_lossy().to_string();

    if temp_mount.exists() {
        let _ = Command::new("hdiutil")
            .args(["detach", &mount_str, "-quiet", "-force"])
            .status();
    }

    let mount_ok = Command::new("hdiutil")
        .args([
            "attach",
            &dmg_str,
            "-nobrowse",
            "-quiet",
            "-mountpoint",
            &mount_str,
        ])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !mount_ok {
        return Err("Failed to mount DMG".to_string());
    }

    let app_source = fs::read_dir(&temp_mount)
        .map_err(|e| format!("Failed to read mount dir: {}", e))?
        .filter_map(|e| e.ok())
        .find(|e| e.path().extension().map_or(false, |ext| ext == "app"))
        .map(|e| e.path())
        .ok_or("No .app found in DMG")?;

    let current_exe =
        std::env::current_exe().map_err(|e| format!("Failed to get current exe path: {}", e))?;
    let app_bundle = current_exe
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .ok_or("Cannot locate app bundle path")?;

    let src = app_source.to_string_lossy().to_string();
    let dst = app_bundle.to_string_lossy().to_string();

    let installed = Command::new("ditto")
        .args([&src, &dst])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
        || Command::new("osascript")
            .args([
                "-e",
                &format!(
                    "do shell script \"ditto '{}' '{}'\" with administrator privileges",
                    src, dst
                ),
            ])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

    let _ = Command::new("hdiutil")
        .args(["detach", &mount_str, "-quiet", "-force"])
        .status();
    let _ = fs::remove_file(download_path);

    if installed {
        println!("✅ macOS auto-install complete: {}", dst);
        Ok(())
    } else {
        Err("Installation failed, check disk permissions".to_string())
    }
}

/// Linux: install .deb via pkexec
#[cfg(target_os = "linux")]
fn auto_install_platform(download_path: &std::path::Path) -> Result<(), String> {
    use std::fs;

    let deb_str = download_path.to_string_lossy().to_string();
    let ok = Command::new("pkexec")
        .args(["dpkg", "-i", &deb_str])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    let _ = fs::remove_file(download_path);
    if ok {
        println!("✅ Linux auto-install complete");
        Ok(())
    } else {
        Err("dpkg install failed".to_string())
    }
}

/// Windows: silent install via /S flag
#[cfg(target_os = "windows")]
fn auto_install_platform(download_path: &std::path::Path) -> Result<(), String> {
    let exe_str = download_path.to_string_lossy().to_string();
    let ok = Command::new(&exe_str)
        .args(["/S"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if ok {
        println!("✅ Windows silent install complete");
        Ok(())
    } else {
        Err("Silent install failed".to_string())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn auto_install_platform(_download_path: &std::path::Path) -> Result<(), String> {
    Err("Unsupported platform".to_string())
}

/// Fallback: open the installer using the system default handler
fn fallback_open_installer(path: &std::path::Path) {
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open").arg(path).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("xdg-open").arg(path).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("cmd")
            .args(["/C", "start", "", &path.to_string_lossy()])
            .spawn();
    }
}

fn create_pre_update_backup() -> Result<UpdateBackupInfo, String> {
    let source = current_backup_source()?;
    let backup_dir = update_backup_dir();
    fs::create_dir_all(&backup_dir).map_err(|error| {
        format!(
            "Failed to create update backup directory {}: {}",
            backup_dir.display(),
            error
        )
    })?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("System clock error while creating backup: {}", error))?
        .as_millis();
    let destination = backup_destination_for_source(&source, &backup_dir, timestamp);

    copy_path_to_backup(&source, &destination)?;
    println!("🧰 Created pre-update backup: {}", destination.display());

    Ok(UpdateBackupInfo {
        created: true,
        path: Some(destination),
    })
}

fn current_backup_source() -> Result<PathBuf, String> {
    let exe = std::env::current_exe()
        .map_err(|error| format!("Failed to locate current executable: {}", error))?;

    #[cfg(target_os = "macos")]
    {
        // In a packaged app the executable lives at
        // OpenLoomi.app/Contents/MacOS/<binary>; backing up the bundle is the
        // useful rollback artifact, not only the tiny launcher binary.
        if let Some(app_bundle) = exe
            .ancestors()
            .find(|path| path.extension().map_or(false, |ext| ext == "app"))
        {
            return Ok(app_bundle.to_path_buf());
        }
    }

    Ok(exe)
}

fn update_backup_dir() -> PathBuf {
    crate::storage::get_data_dir()
        .join("backups")
        .join("updates")
}

fn backup_destination_for_source(source: &Path, backup_dir: &Path, timestamp: u128) -> PathBuf {
    let source_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("openloomi");
    let source_name = sanitize_backup_component(source_name);
    let filename = format!(
        "openloomi-{}-{}-{}",
        env!("CARGO_PKG_VERSION"),
        timestamp,
        source_name
    );
    backup_dir.join(filename)
}

fn sanitize_backup_component(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '-'
            }
        })
        .collect();
    let sanitized = sanitized.trim_matches('-');
    if sanitized.is_empty() {
        "openloomi".to_string()
    } else {
        sanitized.to_string()
    }
}

fn copy_path_to_backup(source: &Path, destination: &Path) -> Result<(), String> {
    if source.is_dir() {
        copy_directory_to_backup(source, destination)
    } else if source.is_file() {
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Failed to create backup parent directory {}: {}",
                    parent.display(),
                    error
                )
            })?;
        }
        fs::copy(source, destination).map_err(|error| {
            format!(
                "Failed to copy {} to {}: {}",
                source.display(),
                destination.display(),
                error
            )
        })?;
        Ok(())
    } else {
        Err(format!(
            "Cannot back up unsupported path type: {}",
            source.display()
        ))
    }
}

#[cfg(target_os = "macos")]
fn copy_directory_to_backup(source: &Path, destination: &Path) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create backup parent directory {}: {}",
                parent.display(),
                error
            )
        })?;
    }

    let status = Command::new("ditto")
        .arg(source)
        .arg(destination)
        .status()
        .map_err(|error| format!("Failed to run ditto for app backup: {}", error))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "ditto failed while copying {} to {}",
            source.display(),
            destination.display()
        ))
    }
}

#[cfg(not(target_os = "macos"))]
fn copy_directory_to_backup(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| {
        format!(
            "Failed to create backup directory {}: {}",
            destination.display(),
            error
        )
    })?;

    for entry in fs::read_dir(source)
        .map_err(|error| format!("Failed to read {}: {}", source.display(), error))?
    {
        let entry = entry
            .map_err(|error| format!("Failed to read {} entry: {}", source.display(), error))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| {
            format!(
                "Failed to inspect {} while creating backup: {}",
                source_path.display(),
                error
            )
        })?;

        if file_type.is_dir() {
            copy_directory_to_backup(&source_path, &destination_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &destination_path).map_err(|error| {
                format!(
                    "Failed to copy {} to {}: {}",
                    source_path.display(),
                    destination_path.display(),
                    error
                )
            })?;
        }
    }

    Ok(())
}

/// Get the path to relaunch the current app
fn get_app_relaunch_path() -> Option<String> {
    let exe = std::env::current_exe().ok()?;

    #[cfg(target_os = "macos")]
    {
        // exe path: .../openloomi.app/Contents/MacOS/openloomi
        // Need to go up 3 levels to reach .app bundle itself, so open command can correctly launch the app
        return exe
            .parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .map(|p| p.to_string_lossy().to_string());
    }

    #[cfg(not(target_os = "macos"))]
    {
        return Some(exe.to_string_lossy().to_string());
    }
}

// ============ Tauri Commands ============

/// Tauri command: check for a newer version via GitHub Releases
#[tauri::command]
pub async fn check_for_update() -> Result<UpdateCheckResult, String> {
    crate::panic_guard::catch_unwind_future_result("check_for_update", do_check_for_update()).await
}

/// Internal: performs the actual update check (can be called directly from Rust).
pub async fn do_check_for_update() -> Result<UpdateCheckResult, String> {
    let current_version = env!("CARGO_PKG_VERSION");

    let client = reqwest::Client::builder()
        .user_agent("openloomi-App")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let latest_version = fetch_version_from_github(&client).await?;

    let latest_tag = format!("v{}", latest_version);
    let download_filename = get_platform_download_filename(&latest_tag).unwrap_or_default();

    let has_update =
        is_newer_version(&latest_version, current_version) && !download_filename.is_empty();

    let download_url = if !download_filename.is_empty() {
        format!(
            "https://github.com/melandlabs/openloomi/releases/download/{}/{}",
            latest_tag, download_filename
        )
    } else {
        String::new()
    };

    Ok(UpdateCheckResult {
        has_update,
        latest_version,
        current_version: current_version.to_string(),
        download_url,
        release_url: format!(
            "https://github.com/melandlabs/openloomi/releases/tag/{}",
            latest_tag
        ),
        file_size: 0,
    })
}

pub async fn install_latest_update_for_cli(
    options: UpdateInstallOptions,
) -> Result<UpdateInstallResult, String> {
    let result = do_check_for_update().await?;
    if !result.has_update {
        return Ok(UpdateInstallResult {
            auto_installed: false,
            message: format!(
                "No update available. Current version {} is up to date.",
                result.current_version
            ),
            backup_created: false,
            backup_path: None,
        });
    }

    let download_path = download_update_asset_for_cli(&result).await?;
    install_downloaded_update(&download_path, options)
}

async fn download_update_asset_for_cli(result: &UpdateCheckResult) -> Result<PathBuf, String> {
    if result.download_url.trim().is_empty() {
        return Err("No update download URL available".to_string());
    }

    let filename = result
        .download_url
        .split('/')
        .last()
        .filter(|value| !value.trim().is_empty())
        .ok_or("Invalid download URL")?;
    let download_path = std::env::temp_dir().join(filename);
    let _ = tokio::fs::remove_file(&download_path).await;

    let client = reqwest::Client::builder()
        .user_agent("openloomi-ctl")
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut request = client
        .get(&result.download_url)
        .header("Accept", "application/octet-stream");
    if result.download_url.contains("github.com") {
        if let Ok(token) = std::env::var("GITHUB_TOKEN") {
            if !token.is_empty() {
                request = request.header("Authorization", format!("Bearer {}", token));
            }
        }
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Failed to download update: {}", format_err(&e)))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "Failed to download update: HTTP {} - {}",
            status, result.download_url
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read update download: {}", e))?;
    tokio::fs::write(&download_path, &bytes)
        .await
        .map_err(|e| format!("Failed to write update file: {}", e))?;

    Ok(download_path)
}

async fn fetch_version_from_github(client: &reqwest::Client) -> Result<String, String> {
    let mut req = client
        .get("https://api.github.com/repos/melandlabs/openloomi/tags")
        .header("Accept", "application/vnd.github+json");
    if let Ok(token) = std::env::var("GITHUB_TOKEN") {
        if !token.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", token));
        }
    }

    let response = req
        .send()
        .await
        .map_err(|e| format!("GitHub API request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "GitHub API error {}: {}",
            status,
            if body.len() > 200 {
                &body[..200]
            } else {
                &body
            }
        ));
    }

    let tags: Vec<serde_json::Value> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse GitHub response: {}", e))?;

    let latest_tag = tags
        .first()
        .and_then(|t| t["name"].as_str())
        .ok_or("No tags found")?
        .to_string();

    Ok(latest_tag
        .strip_prefix('v')
        .unwrap_or(&latest_tag)
        .to_string())
}

/// Tauri command: start downloading update (non-blocking, returns immediately).
#[tauri::command]
pub async fn start_update_download(download_url: String, file_size: u64) -> Result<(), String> {
    crate::panic_guard::catch_unwind_future_result(
        "start_update_download",
        start_update_download_impl(download_url, file_size),
    )
    .await
}

async fn start_update_download_impl(download_url: String, file_size: u64) -> Result<(), String> {
    // Reset global progress state
    let state = get_progress_state();
    {
        let mut s = lock_recovered(&state, "update download progress");
        *s = DownloadProgressState::default();
    }

    let filename = download_url
        .split('/')
        .last()
        .ok_or("Invalid download URL")?
        .to_string();

    // Spawn the download task in background
    let state_clone = state.clone();
    let url_clone = download_url.clone();
    let filename_clone = filename.clone();

    tokio::spawn(async move {
        let result =
            crate::panic_guard::catch_unwind_future_result("update download task", async {
                download_file(&state_clone, &url_clone, file_size, &filename_clone).await
            })
            .await;
        if let Err(e) = result {
            let mut s = lock_recovered(&state_clone, "update download progress");
            s.error = Some(e);
            s.done = true;
        }
    });

    Ok(())
}

/// Internal: performs the actual file download with progress tracking
async fn download_file(
    state: &Arc<Mutex<DownloadProgressState>>,
    url: &str,
    file_size: u64,
    filename: &str,
) -> Result<(), String> {
    let temp_dir = std::env::temp_dir();
    let download_path = temp_dir.join(filename);

    let client = reqwest::Client::builder()
        .user_agent("openloomi-app")
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // Retry with exponential backoff for transient network errors.
    let mut last_err = String::new();
    for attempt in 0..3 {
        if attempt > 0 {
            let delay = Duration::from_secs(1 << attempt); // 2s, 4s
            println!("⏳ Retry {} after {:?}...", attempt, delay);
            tokio::time::sleep(delay).await;
        }

        // Delete any partial file from a previous attempt
        let _ = tokio::fs::remove_file(&download_path).await;

        // Build request - GitHub URL may need token to avoid rate limits
        let mut req = client.get(url).header("Accept", "application/octet-stream");
        if url.contains("github.com") {
            if let Ok(token) = std::env::var("GITHUB_TOKEN") {
                if !token.is_empty() {
                    req = req.header("Authorization", format!("Bearer {}", token));
                }
            }
        }

        let mut response = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                last_err = format_err(&e);
                eprintln!("⚠️  Download attempt {} failed: {}", attempt + 1, last_err);
                continue;
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let err_msg = if status.as_u16() == 404 {
                format!("HTTP 404 Not Found - {}", url)
            } else {
                format!("HTTP {} - {}", status, url)
            };
            last_err = err_msg.clone();
            eprintln!("⚠️  Download attempt {} failed: {}", attempt + 1, err_msg);
            // Don't retry on 404 - the file doesn't exist on this source
            if status.as_u16() == 404 {
                return Err(format!("HTTP 404 Not Found: {}", url));
            }
            break;
        }

        // Use content_length if available, otherwise fall back to known file_size
        let total_size = response
            .content_length()
            .unwrap_or(file_size)
            .max(file_size);

        // Update total in progress state
        {
            let mut s = lock_recovered(&state, "update download progress");
            s.total = total_size;
        }

        let mut file = match tokio::fs::File::create(&download_path).await {
            Ok(f) => f,
            Err(e) => {
                last_err = format!("Failed to create file: {}", e);
                eprintln!("⚠️  {}", last_err);
                break;
            }
        };

        use tokio::io::AsyncWriteExt;
        let mut stream_error = false;

        loop {
            // Check if already done (aborted by frontend) - must drop guard before await
            let should_abort = {
                let s = lock_recovered(&state, "update download progress");
                s.done
            };

            if should_abort {
                eprintln!("⚠️  Download aborted by frontend");
                let _ = tokio::fs::remove_file(&download_path).await;
                return Ok(());
            }

            // Read chunk with timeout to detect connection issues
            let chunk_result =
                tokio::time::timeout(Duration::from_secs(30), response.chunk()).await;

            let chunk = match chunk_result {
                Ok(Ok(Some(c))) => c,
                Ok(Ok(None)) => break, // Stream finished normally
                Ok(Err(e)) => {
                    // Network/decode error — likely interrupted download
                    last_err = if e.is_decode() {
                        "Network error: connection interrupted (check your internet)".to_string()
                    } else {
                        format!("Failed to read chunk: {}", e)
                    };
                    eprintln!("⚠️  Stream error: {}", last_err);
                    stream_error = true;
                    break;
                }
                Err(_) => {
                    // Timeout waiting for chunk
                    last_err = "Download timeout: connection stalled (check internet)".to_string();
                    eprintln!("⚠️  Chunk read timeout");
                    stream_error = true;
                    break;
                }
            };

            let chunk = chunk;
            let downloaded = chunk.len() as u64;

            if let Err(e) = file.write_all(&chunk).await {
                last_err = format!("Failed to write chunk: {}", e);
                eprintln!("⚠️  {}", last_err);
                stream_error = true;
                break;
            }

            // Update progress
            let (new_downloaded, new_total, percent) = {
                let mut s = lock_recovered(&state, "update download progress");
                s.downloaded += downloaded;
                let total = s.total;
                let downloaded = s.downloaded;
                let percent = if total > 0 {
                    ((downloaded as f64 / total as f64) * 100.0).min(100.0) as u8
                } else {
                    0
                };
                s.percent = percent;
                (downloaded, total, percent)
            };

            // Emit progress every 5%
            if percent % 5 == 0 || percent == 100 {
                println!(
                    "📥 Download: {} / {} ({}%)",
                    new_downloaded, new_total, percent
                );
            }
        }

        if stream_error {
            continue;
        }

        if file.shutdown().await.is_err() {
            last_err = "Failed to flush file".to_string();
            continue;
        }

        // Download completed successfully
        let downloaded_size = std::fs::metadata(&download_path)
            .map(|m| m.len())
            .unwrap_or(0);
        println!(
            "✅ Download complete: {:?} ({}MB)",
            download_path,
            downloaded_size / 1024 / 1024
        );

        // Mark done and store download path
        {
            let mut s = lock_recovered(&state, "update download progress");
            s.downloaded = downloaded_size;
            s.total = downloaded_size;
            s.percent = 100;
            s.done = true;
            s.download_path = Some(download_path.to_string_lossy().to_string());
        }

        return Ok(());
    }

    Err(format!("Download failed after 3 attempts: {}", last_err))
}

/// Tauri command: poll download progress (called by frontend via setInterval)
#[derive(serde::Serialize)]
pub struct PollProgressResult {
    pub downloaded: u64,
    pub total: u64,
    pub percent: u8,
    pub done: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub fn poll_update_download_progress() -> PollProgressResult {
    crate::panic_guard::catch_unwind_str("poll_update_download_progress", || {
        let state = get_progress_state();
        let s = lock_recovered(&state, "update download progress");
        PollProgressResult {
            downloaded: s.downloaded,
            total: s.total,
            percent: s.percent,
            done: s.done,
            error: s.error.clone(),
        }
    })
    .unwrap_or_else(|error| PollProgressResult {
        downloaded: 0,
        total: 0,
        percent: 0,
        done: true,
        error: Some(error),
    })
}

/// Tauri command: finish update (install the downloaded file, called after poll shows done)
#[tauri::command]
pub async fn finish_update_download(
    options: Option<UpdateInstallOptions>,
) -> Result<UpdateInstallResult, String> {
    let options = options.unwrap_or_default();
    crate::panic_guard::catch_unwind_future_result(
        "finish_update_download",
        finish_update_download_impl(options),
    )
    .await
}

async fn finish_update_download_impl(
    options: UpdateInstallOptions,
) -> Result<UpdateInstallResult, String> {
    let state = get_progress_state();
    let (download_path, _error_msg) = {
        let s = lock_recovered(&state, "update download progress");
        (s.download_path.clone(), s.error.clone())
    };

    let path_str = download_path.ok_or("No downloaded file found")?;
    let download_path = std::path::PathBuf::from(&path_str);

    if !download_path.exists() {
        return Err(format!("Downloaded file not found: {}", path_str));
    }

    println!("📦 Installing update from: {:?}", download_path);

    install_downloaded_update(&download_path, options)
}

fn install_downloaded_update(
    download_path: &Path,
    options: UpdateInstallOptions,
) -> Result<UpdateInstallResult, String> {
    install_downloaded_update_with_hooks(
        download_path,
        options,
        create_pre_update_backup,
        auto_install_platform,
        fallback_open_installer,
    )
}

fn install_downloaded_update_with_hooks<CreateBackup, AutoInstall, FallbackOpen>(
    download_path: &Path,
    options: UpdateInstallOptions,
    create_backup: CreateBackup,
    auto_install: AutoInstall,
    fallback_open: FallbackOpen,
) -> Result<UpdateInstallResult, String>
where
    CreateBackup: FnOnce() -> Result<UpdateBackupInfo, String>,
    AutoInstall: FnOnce(&Path) -> Result<(), String>,
    FallbackOpen: FnOnce(&Path),
{
    // Backup is opt-in: normal updates preserve current behavior, while users
    // who request extra safety get a rollback artifact before installation.
    let backup = if options.backup {
        create_backup()?
    } else {
        UpdateBackupInfo::default()
    };
    let backup_path = backup.path.as_ref().map(|path| path.display().to_string());

    match auto_install(download_path) {
        Ok(()) => Ok(UpdateInstallResult {
            auto_installed: true,
            message: "Update installed, restarting...".to_string(),
            backup_created: backup.created,
            backup_path,
        }),
        Err(e) => {
            println!("⚠️  Auto-install failed: {}, falling back to manual", e);
            fallback_open(download_path);
            Ok(UpdateInstallResult {
                auto_installed: false,
                message: format!(
                    "Auto-install failed ({}). Installer opened, please install manually.",
                    e
                ),
                backup_created: backup.created,
                backup_path,
            })
        }
    }
}
fn format_err(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "Connection timed out".to_string()
    } else if e.is_connect() {
        "Failed to connect (check network/proxy)".to_string()
    } else if e.is_request() {
        "Request error (check network/proxy)".to_string()
    } else {
        e.to_string()
    }
}

/// Tauri command: clean up and restart app to apply update
#[tauri::command]
pub async fn restart_for_update(app_handle: tauri::AppHandle) -> Result<(), String> {
    crate::panic_guard::catch_unwind_future_result(
        "restart_for_update",
        restart_for_update_impl(app_handle),
    )
    .await
}

/// Tauri command: restart the application
#[tauri::command]
pub async fn restart_app(app_handle: tauri::AppHandle) -> Result<(), String> {
    crate::panic_guard::catch_unwind_future_result(
        "restart_app",
        restart_for_update_impl(app_handle),
    )
    .await
}

async fn restart_for_update_impl(app_handle: tauri::AppHandle) -> Result<(), String> {
    let relaunch_path = get_app_relaunch_path();

    // Run blocking operations in spawn_blocking to avoid tokio runtime conflict
    tokio::task::spawn_blocking(|| {
        crate::js_scheduler::stop_js_scheduler();
    })
    .await
    .map_err(|e| format!("stop_js_scheduler failed: {}", e))?;

    // Clean up Node.js child process
    #[cfg(not(debug_assertions))]
    tokio::task::spawn_blocking(|| {
        crate::node::cleanup_nodejs_process();
    })
    .await
    .map_err(|e| format!("cleanup_nodejs_process failed: {}", e))?;

    // Relaunch the app after a short delay
    if let Some(path) = relaunch_path {
        #[cfg(target_os = "macos")]
        {
            Command::new("sh")
                .args(["-c", &format!("sleep 1 && open '{}'", path)])
                .spawn()
                .ok();
        }
        #[cfg(target_os = "linux")]
        {
            Command::new("sh")
                .args(["-c", &format!("sleep 1 && '{}'", path)])
                .spawn()
                .ok();
        }
        #[cfg(target_os = "windows")]
        {
            Command::new("cmd")
                .args(["/C", "timeout /t 2 /nobreak >nul &&", &path])
                .spawn()
                .ok();
        }
    }

    app_handle.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_test_dir(name: &str) -> PathBuf {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "openloomi-update-{}-{}-{}",
            name,
            std::process::id(),
            now
        ))
    }

    #[test]
    fn parse_semver_accepts_plain_versions() {
        assert_eq!(parse_semver("1.2.3"), Some((1, 2, 3)));
    }

    #[test]
    fn parse_semver_accepts_v_prefix() {
        assert_eq!(parse_semver("v1.2.3"), Some((1, 2, 3)));
    }

    #[test]
    fn parse_semver_rejects_incomplete_versions() {
        assert_eq!(parse_semver("1.2"), None);
        assert_eq!(parse_semver(""), None);
    }

    #[test]
    fn parse_semver_rejects_non_numeric_versions() {
        assert_eq!(parse_semver("a.b.c"), None);
        assert_eq!(parse_semver("1.2.x"), None);
    }

    #[test]
    fn is_newer_version_detects_major_minor_and_patch_updates() {
        assert!(is_newer_version("2.0.0", "1.9.9"));
        assert!(is_newer_version("1.2.0", "1.1.0"));
        assert!(is_newer_version("1.1.1", "1.1.0"));
    }

    #[test]
    fn is_newer_version_rejects_equal_older_and_invalid_versions() {
        assert!(!is_newer_version("1.2.3", "1.2.3"));
        assert!(!is_newer_version("1.1.0", "1.2.0"));
        assert!(!is_newer_version("invalid", "1.0.0"));
        assert!(!is_newer_version("1.0.0", "invalid"));
    }

    #[test]
    fn get_platform_download_filename_accepts_v_prefix() {
        let result = get_platform_download_filename("v1.0.0");
        assert!(result.is_some());
        assert!(!result.unwrap().contains('v'));
    }

    #[test]
    fn get_platform_download_filename_accepts_plain_version() {
        assert!(get_platform_download_filename("1.0.0").is_some());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn get_platform_download_filename_uses_windows_asset() {
        let result = get_platform_download_filename("v1.0.0").unwrap();
        assert!(
            result.contains("openloomi_1.0.0_windows_amd64.exe"),
            "got: {}",
            result
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn get_platform_download_filename_uses_macos_asset() {
        let result = get_platform_download_filename("v1.0.0").unwrap();
        if cfg!(target_arch = "aarch64") {
            assert!(result.contains("openloomi_1.0.0_macOS_aarch64.dmg"));
        } else {
            assert!(result.contains("openloomi_1.0.0_macOS_amd64.dmg"));
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn get_platform_download_filename_uses_linux_asset() {
        let result = get_platform_download_filename("v1.0.0").unwrap();
        if cfg!(target_arch = "aarch64") {
            assert!(result.contains("openloomi_1.0.0_linux_aarch64.deb"));
        } else {
            assert!(result.contains("openloomi_1.0.0_linux_amd64.deb"));
        }
    }

    #[test]
    fn backup_destination_sanitizes_source_name_and_preserves_extension() {
        let backup_dir = Path::new("backups");
        let source = Path::new("OpenLoomi Preview.exe");

        let destination = backup_destination_for_source(source, backup_dir, 42);

        assert_eq!(
            destination.file_name().and_then(|value| value.to_str()),
            Some(concat!(
                "openloomi-",
                env!("CARGO_PKG_VERSION"),
                "-42-OpenLoomi-Preview.exe"
            ))
        );
    }

    #[test]
    fn copy_path_to_backup_copies_file_without_touching_source() {
        let root = unique_test_dir("file");
        let source = root.join("openloomi.exe");
        let backup_dir = root.join("backups");
        let destination = backup_destination_for_source(&source, &backup_dir, 99);

        fs::create_dir_all(&root).unwrap();
        fs::write(&source, b"current binary").unwrap();

        copy_path_to_backup(&source, &destination).unwrap();

        assert_eq!(fs::read(&source).unwrap(), b"current binary");
        assert_eq!(fs::read(&destination).unwrap(), b"current binary");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn default_install_does_not_create_backup() {
        let root = unique_test_dir("default-install");
        let installer = root.join("openloomi.exe");
        fs::create_dir_all(&root).unwrap();
        fs::write(&installer, b"installer").unwrap();

        let result = install_downloaded_update_with_hooks(
            &installer,
            UpdateInstallOptions::default(),
            || panic!("backup should not be created by default"),
            |_| Ok(()),
            |_| {},
        )
        .unwrap();

        assert!(!result.backup_created);
        assert_eq!(result.backup_path, None);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn explicit_backup_install_reports_backup_path() {
        let root = unique_test_dir("backup-install");
        let installer = root.join("openloomi.exe");
        let backup_path = root.join("backups").join("openloomi-backup.exe");
        fs::create_dir_all(&root).unwrap();
        fs::write(&installer, b"installer").unwrap();

        let result = install_downloaded_update_with_hooks(
            &installer,
            UpdateInstallOptions { backup: true },
            || {
                Ok(UpdateBackupInfo {
                    created: true,
                    path: Some(backup_path.clone()),
                })
            },
            |_| Ok(()),
            |_| {},
        )
        .unwrap();

        assert!(result.backup_created);
        assert_eq!(
            result.backup_path.as_deref(),
            Some(backup_path.to_string_lossy().as_ref())
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn backup_failure_aborts_install() {
        let root = unique_test_dir("backup-failure");
        let installer = root.join("openloomi.exe");
        fs::create_dir_all(&root).unwrap();
        fs::write(&installer, b"installer").unwrap();

        let result = install_downloaded_update_with_hooks(
            &installer,
            UpdateInstallOptions { backup: true },
            || Err("backup failed".to_string()),
            |_| panic!("install should not run after backup failure"),
            |_| {},
        );

        assert_eq!(result.unwrap_err(), "backup failed");

        let _ = fs::remove_dir_all(&root);
    }
}
