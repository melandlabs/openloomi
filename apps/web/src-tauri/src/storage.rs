// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

//! Storage module — data directories, token management, and data migration.

use base64::Engine;
use std::path::PathBuf;

/// Initialize data subdirectories (storage, logs, memory)
pub fn init_data_dirs() -> Result<(), String> {
    let data_dir = get_data_dir();
    let subdirs = vec!["storage", "logs", "memory"];

    for subdir in subdirs {
        let dir = data_dir.join(subdir);
        if !dir.exists() {
            std::fs::create_dir_all(&dir)
                .map_err(|e| format!("Failed to create directory {:?}: {}", dir, e))?;
            println!("Created directory: {:?}", dir);
        }
    }

    Ok(())
}

/// Get the application data directory path
pub fn get_data_dir() -> PathBuf {
    #[cfg(debug_assertions)]
    {
        #[cfg(target_os = "macos")]
        {
            if let Ok(home) = std::env::var("HOME") {
                return PathBuf::from(home)
                    .join("Library")
                    .join("Application Support")
                    .join("openloomi");
            }
        }
        #[cfg(target_os = "linux")]
        {
            if let Ok(home) = std::env::var("HOME") {
                return PathBuf::from(home).join(".config").join("openloomi");
            }
        }
        #[cfg(target_os = "windows")]
        {
            if let Ok(appdata) = std::env::var("APPDATA") {
                return PathBuf::from(appdata).join("openloomi");
            }
            if let Ok(home) = std::env::var("USERPROFILE") {
                return PathBuf::from(home).join(".openloomi");
            }
        }
    }

    #[cfg(not(debug_assertions))]
    {
        #[cfg(unix)]
        {
            if let Ok(home) = std::env::var("HOME") {
                return PathBuf::from(home).join(".openloomi").join("data");
            }
        }
        #[cfg(windows)]
        {
            if let Ok(home) = std::env::var("USERPROFILE") {
                return PathBuf::from(home).join(".openloomi").join("data");
            }
            if let Ok(appdata) = std::env::var("APPDATA") {
                return PathBuf::from(appdata).join("openloomi").join("data");
            }
            if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
                return PathBuf::from(localappdata).join("openloomi").join("data");
            }
        }
    }

    PathBuf::from(".openloomi_data")
}

/// Token file path: ~/.openloomi/token
pub fn get_token_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from(home).join(".openloomi").join("token")
}

/// Tauri command: save token (base64-encoded to file)
#[tauri::command]
pub fn save_token(token: String) -> Result<(), String> {
    let path = get_token_path();
    let dir = path.parent().unwrap();
    std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create dir: {}", e))?;

    let encoded = base64::engine::general_purpose::STANDARD.encode(&token);
    std::fs::write(&path, &encoded).map_err(|e| format!("Failed to write token: {}", e))?;

    // Set file permissions to 600 on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        let _ = std::fs::set_permissions(&path, perms);
    }

    println!("[TokenFile] Token saved to {}", path.display());
    Ok(())
}

/// Tauri command: load token (base64-decoded)
#[tauri::command]
pub fn load_token() -> Result<Option<String>, String> {
    let path = get_token_path();
    if !path.exists() {
        return Ok(None);
    }
    let encoded =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read token: {}", e))?;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .map_err(|e| format!("Failed to decode token: {}", e))?;
    let token = String::from_utf8(decoded).map_err(|e| format!("Invalid token: {}", e))?;
    Ok(Some(token))
}

/// Tauri command: delete token
#[tauri::command]
pub fn delete_token() -> Result<(), String> {
    let path = get_token_path();
    let _ = std::fs::remove_file(&path);
    println!("[TokenFile] Token deleted");
    Ok(())
}
