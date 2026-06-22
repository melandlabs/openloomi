// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

//! Auto-update module — version checking, download, install, and relaunch.

use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;

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
#[derive(serde::Serialize)]
pub struct UpdateInstallResult {
    pub auto_installed: bool,
    pub message: String,
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

/// Parse semver into (major, minor, patch)
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

/// Compare versions; returns true if latest > current
fn is_newer_version(latest: &str, current: &str) -> bool {
    match (parse_semver(latest), parse_semver(current)) {
        (Some(l), Some(c)) => l > c,
        _ => false,
    }
}

/// Get download filename for the current platform/arch
pub(crate) fn get_platform_download_filename(version: &str) -> Option<String> {
    let v = version.strip_prefix('v').unwrap_or(version);

    #[cfg(target_os = "macos")]
    {
        return if cfg!(target_arch = "aarch64") {
            Some(format!("openloomi_{}_macOS_aarch64.dmg", v))
        } else {
            Some(format!("openloomi_{}_macOS_x64.dmg", v))
        };
    }

    #[cfg(target_os = "linux")]
    {
        return if cfg!(target_arch = "aarch64") {
            Some(format!("openloomi_{}_linux_arm64.deb", v))
        } else {
            Some(format!("openloomi_{}_linux_amd64.deb", v))
        };
    }

    #[cfg(target_os = "windows")]
    {
        return Some(format!("openloomi_{}_windows_x64-setup.exe", v));
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

/// Tauri command: check for a newer version via R2
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

    // Try R2 first, then fallback to GitHub
    let latest_version = match fetch_version_from_r2(&client).await {
        Ok(v) => {
            eprintln!("📦 Got version from R2: {}", v);
            v
        }
        Err(e) => {
            eprintln!("⚠️  R2 failed ({}), trying GitHub...", e);
            fetch_version_from_github(&client).await?
        }
    };

    let latest_tag = format!("v{}", latest_version);
    let download_filename = get_platform_download_filename(&latest_tag).unwrap_or_default();

    let has_update =
        is_newer_version(&latest_version, current_version) && !download_filename.is_empty();

    // Try R2 first for download, then fallback to GitHub
    let download_url = if !download_filename.is_empty() {
        let github_url = format!(
            "https://github.com/melandlabs/release/releases/download/{}/{}",
            latest_tag, download_filename
        );
        let r2_url = format!(
            "https://pub-7f8ad94cb1444cbebae6bfd55ec52f5d.r2.dev/{}",
            download_filename
        );

        // Try R2 first
        match client.head(&r2_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                eprintln!("📦 R2 has file, using: {}", r2_url);
                r2_url
            }
            _ => {
                eprintln!("📦 R2 not available, using GitHub: {}", github_url);
                github_url
            }
        }
    } else {
        String::new()
    };

    Ok(UpdateCheckResult {
        has_update,
        latest_version,
        current_version: current_version.to_string(),
        download_url,
        release_url: format!(
            "https://github.com/melandlabs/release/releases/tag/{}",
            latest_tag
        ),
        file_size: 0,
    })
}

async fn fetch_version_from_r2(client: &reqwest::Client) -> Result<String, String> {
    let r2_url = "https://pub-7f8ad94cb1444cbebae6bfd55ec52f5d.r2.dev/latest.json";
    let response = client
        .get(r2_url)
        .send()
        .await
        .map_err(|e| format!("R2 request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse latest.json: {}", e))?;

    json["version"]
        .as_str()
        .ok_or("Invalid latest.json: missing 'version' field".to_string())
        .map(|s| s.to_string())
}

async fn fetch_version_from_github(client: &reqwest::Client) -> Result<String, String> {
    let mut req = client
        .get("https://api.github.com/repos/melandlabs/release/tags")
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
pub async fn finish_update_download() -> Result<UpdateInstallResult, String> {
    crate::panic_guard::catch_unwind_future_result(
        "finish_update_download",
        finish_update_download_impl(),
    )
    .await
}

async fn finish_update_download_impl() -> Result<UpdateInstallResult, String> {
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

    match auto_install_platform(&download_path) {
        Ok(()) => Ok(UpdateInstallResult {
            auto_installed: true,
            message: "Update installed, restarting...".to_string(),
        }),
        Err(e) => {
            println!("⚠️  Auto-install failed: {}, falling back to manual", e);
            fallback_open_installer(&download_path);
            Ok(UpdateInstallResult {
                auto_installed: false,
                message: format!(
                    "Auto-install failed ({}). Installer opened, please install manually.",
                    e
                ),
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
