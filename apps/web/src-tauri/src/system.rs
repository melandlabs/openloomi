// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

//! System module — file operations, path utilities, and platform-specific commands.

use std::process::Command;
use tauri::Manager;

// ============ File Operations ============

/// Tauri command: open a URL via system handler (bypasses opener plugin ACL)
#[tauri::command]
pub fn open_url_custom(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        // Capture stderr to check if no browser is available
        let output = Command::new("xdg-open")
            .arg(&url)
            .stderr(std::process::Stdio::piped())
            .output();

        match output {
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                // Check if xdg-open reported "no method available"
                if stderr.contains("no method available") {
                    return Err("No web browser found. Please install a browser (e.g., Firefox, Chrome) to open links.".to_string());
                }
            }
            Err(e) => {
                return Err(format!("Failed to open URL: {}", e));
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        // Try PowerShell first (most reliable, no special char escaping issues)
        let ps_result = Command::new("powershell")
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .args([
                "-NoProfile",
                "-Command",
                &format!("Start-Process '{}'", &url.replace("'", "''")),
            ])
            .spawn();

        if ps_result.is_ok() {
            return Ok(());
        }

        // Fallback to cmd with proper quoting
        Command::new("cmd")
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .args(["/c", "start", "\"\"", &url])
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        return Err("Unsupported platform".to_string());
    }
    Ok(())
}

/// Tauri command: read file content (bypasses fs plugin ACL)
#[tauri::command]
pub fn read_file_custom(path: String) -> Result<Vec<u8>, String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("cat")
            .arg(&path)
            .output()
            .map_err(|e| format!("Failed to read file: {}", e))?;
        Ok(output.stdout)
    }
    #[cfg(not(target_os = "macos"))]
    {
        std::fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))
    }
}

/// Tauri command: get file metadata (size, type)
#[tauri::command]
pub fn file_stat_custom(path: String) -> Result<serde_json::Value, String> {
    let metadata = std::fs::metadata(&path).map_err(|e| format!("Failed to stat file: {}", e))?;

    Ok(serde_json::json!({
        "size": metadata.len(),
        "is_file": metadata.is_file(),
        "is_dir": metadata.is_dir(),
    }))
}

/// Tauri command: check if file exists
#[tauri::command]
pub fn file_exists_custom(path: String) -> Result<bool, String> {
    Ok(std::path::Path::new(&path).exists())
}

/// Tauri command: create directory
#[tauri::command]
pub fn mkdir_custom(dir_path: String) -> Result<(), String> {
    std::fs::create_dir_all(&dir_path).map_err(|e| format!("Failed to create directory: {}", e))
}

/// Tauri command: write text file
#[tauri::command]
pub fn write_text_file_custom(file_path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&file_path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    std::fs::write(&file_path, content).map_err(|e| format!("Failed to write file: {}", e))
}

/// Tauri command: read text file
#[tauri::command]
pub fn read_text_file_custom(file_path: String) -> Result<String, String> {
    std::fs::read_to_string(&file_path).map_err(|e| format!("Failed to read file: {}", e))
}

/// Tauri command: delete file
#[tauri::command]
pub fn remove_file_custom(file_path: String) -> Result<(), String> {
    std::fs::remove_file(&file_path).map_err(|e| format!("Failed to remove file: {}", e))
}

/// Tauri command: open folder picker dialog
#[tauri::command]
pub async fn pick_folder_dialog(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;

    let (tx, rx) = oneshot::channel();

    app_handle.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder);
    });

    match rx.await {
        Ok(Some(p)) => Ok(Some(p.to_string())),
        Ok(None) => Ok(None),
        Err(_) => Err("Failed to receive folder selection".to_string()),
    }
}

/// Tauri command: open a file or path (bypasses opener plugin ACL)
#[tauri::command]
pub fn open_path_custom(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open path: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        let output = Command::new("xdg-open")
            .arg(&path)
            .stderr(std::process::Stdio::piped())
            .output();

        match output {
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                if stderr.contains("no method available") {
                    return Err("No application found to open this file.".to_string());
                }
            }
            Err(e) => {
                return Err(format!("Failed to open path: {}", e));
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        Command::new("cmd")
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .args(["/c", "start", "", &path])
            .spawn()
            .map_err(|e| format!("Failed to open path: {}", e))?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        return Err("Unsupported platform".to_string());
    }
    Ok(())
}

/// Tauri command: reveal item in its parent directory (Finder/Explorer)
#[tauri::command]
pub fn reveal_item_in_dir_custom(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to reveal item: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        let dir_path = std::path::Path::new(&path)
            .parent()
            .unwrap_or_else(|| std::path::Path::new("/"))
            .display();

        let output = Command::new("xdg-open")
            .arg(dir_path.to_string())
            .stderr(std::process::Stdio::piped())
            .output();

        match output {
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                if stderr.contains("no method available") {
                    return Err("No file manager found to reveal this item.".to_string());
                }
            }
            Err(e) => {
                return Err(format!("Failed to reveal item: {}", e));
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        // Normalize path: convert forward slashes to backslashes for Windows Explorer
        let normalized = path.replace('/', "\\");
        Command::new("explorer.exe")
            .arg(format!("/select,{}", normalized))
            .spawn()
            .map_err(|e| format!("Failed to reveal item: {}", e))?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        return Err("Unsupported platform".to_string());
    }
    Ok(())
}

// ============ Path Utilities ============

/// Tauri command: get home directory
#[tauri::command]
pub fn home_dir_custom() -> Result<String, String> {
    #[cfg(unix)]
    {
        if let Ok(home) = std::env::var("HOME") {
            return Ok(home);
        }
        return Err("HOME environment variable not set".to_string());
    }
    #[cfg(windows)]
    {
        if let Ok(home) = std::env::var("USERPROFILE") {
            return Ok(home);
        }
        return Err("USERPROFILE environment variable not set".to_string());
    }
    #[cfg(not(any(unix, windows)))]
    {
        return Err("Unsupported platform".to_string());
    }
}

/// Tauri command: get memory directory (app data/memory)
#[tauri::command]
pub fn get_memory_directory(app_handle: tauri::AppHandle) -> Result<String, String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get data dir: {}", e))?;

    let memory_dir = data_dir.join("memory");
    if !memory_dir.exists() {
        std::fs::create_dir_all(&memory_dir)
            .map_err(|e| format!("Failed to create memory directory: {}", e))?;
    }

    Ok(memory_dir.to_string_lossy().to_string())
}

/// Tauri command: get data directory path
#[tauri::command]
pub fn get_data_directory(app_handle: tauri::AppHandle) -> Result<String, String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get data dir: {}", e))?;

    Ok(data_dir.to_string_lossy().to_string())
}

/// Tauri command: get storage directory path
#[tauri::command]
pub fn get_storage_directory(app_handle: tauri::AppHandle) -> Result<String, String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get data dir: {}", e))?;
    let storage_dir = data_dir.join("storage");
    Ok(storage_dir.to_string_lossy().to_string())
}

/// Tauri command: get the bundled skills directory path.
///
/// Platform-specific paths:
/// - macOS:   Contents/Resources/_up_/_up_/_up_/skills   (exe in Contents/MacOS/)
/// - Windows: _up_/_up_/_up_/skills relative to exe      (resources at exe level)
/// - Linux:   _up_/_up_/_up_/skills relative to resource dir (e.g. /usr/lib/openloomi/_up_/_up_/_up_/skills)
#[tauri::command]
pub fn get_bundled_skills_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    use std::path::PathBuf;

    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));

    let skills_dir = if cfg!(target_os = "macos") {
        // macOS: exe is at Contents/MacOS/openloomi, resources at Contents/Resources/
        exe_dir
            .join("..")
            .join("Resources")
            .join("_up_")
            .join("_up_")
            .join("_up_")
            .join("skills")
    } else if cfg!(target_os = "windows") {
        // Windows: resources directly alongside the .exe
        exe_dir
            .join("_up_")
            .join("_up_")
            .join("_up_")
            .join("skills")
    } else {
        // Linux: resource_dir/_up_/_up_/_up_/skills
        let resource_dir = app_handle
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource dir: {}", e))?;
        resource_dir
            .join("_up_")
            .join("_up_")
            .join("_up_")
            .join("skills")
    };

    if skills_dir.exists() {
        Ok(skills_dir.to_string_lossy().to_string())
    } else {
        // Fallback: return the raw resource directory
        let fallback = app_handle
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource dir: {}", e))?;
        Ok(fallback.to_string_lossy().to_string())
    }
}

/// Tauri command: get app info
#[tauri::command]
pub fn get_app_info() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "name": "openloomi",
        "version": env!("CARGO_PKG_VERSION"),
        "description": env!("CARGO_PKG_DESCRIPTION"),
    }))
}
