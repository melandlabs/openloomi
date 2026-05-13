// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

use crate::telegram::types::TelegramDesktopInfo;
use std::path::PathBuf;

/// Get Telegram Desktop data directory path
pub fn get_telegram_data_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            // First check the official version path
            let official_path = PathBuf::from(&home)
                .join("Library")
                .join("Application Support")
                .join("Telegram Desktop");
            if official_path.exists() {
                return Some(official_path);
            }

            // Check if App Store version exists (for user notification)
            let app_store_path = PathBuf::from(&home)
                .join("Library")
                .join("Group Containers")
                .join("6N38VWS5BX.ru.keepcoder.Telegram");
            if app_store_path.exists() {
                println!(
                    "⚠️  Found App Store version of Telegram at: {:?}",
                    app_store_path
                );
                // Return special marker to detect App Store version
                return Some(app_store_path);
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let path = PathBuf::from(home)
                .join(".local")
                .join("share")
                .join("TelegramDesktop");
            if path.exists() {
                return Some(path);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let path = PathBuf::from(appdata).join("Telegram Desktop");
            if path.exists() {
                return Some(path);
            }
        }
    }

    None
}

/// Detect if Telegram Desktop is installed and has a session
#[tauri::command]
pub fn detect_telegram_desktop() -> Result<TelegramDesktopInfo, String> {
    println!("🔍 Detecting Telegram Desktop...");

    let data_dir = get_telegram_data_dir();

    if data_dir.is_none() {
        println!("❌ Telegram Desktop data directory not found");
        return Ok(TelegramDesktopInfo {
            installed: false,
            has_session: false,
            accounts: vec![],
            data_path: None,
            is_app_store_version: None,
        });
    }

    let data_dir = data_dir.unwrap();
    println!("✅ Found Telegram at: {:?}", data_dir);

    // Check if it's macOS native version (does not support quick login)
    #[cfg(target_os = "macos")]
    {
        let path_str = data_dir.to_string_lossy();
        if path_str.contains("Group Containers") || path_str.contains("ru.keepcoder.Telegram") {
            println!("⚠️  Detected Telegram for macOS (native version)");
            return Ok(TelegramDesktopInfo {
                installed: false,
                has_session: false,
                accounts: vec![],
                data_path: Some(format!(
                    "Detected Telegram for macOS (native version)\n\nQuick login is only supported on Telegram Desktop (cross-platform version)\n\n• Telegram for macOS: Native app, different data format, cannot read\n• Telegram Desktop: Qt-based cross-platform version, supports session reading\n\nPlease download Telegram Desktop from desktop.telegram.org and log in"
                )),
                is_app_store_version: Some(true),
            });
        }
    }

    // Check for key_datas file (indicates session exists)
    let key_datas_path = data_dir.join("tdata").join("key_datas");
    let has_session = key_datas_path.exists();

    if has_session {
        println!("✅ Found existing session");
    } else {
        println!("⚠️  No session found");
    }

    // TODO: Parse key_datas and other files to get account info
    // Return a placeholder here, actual implementation needs more complex parsing logic
    Ok(TelegramDesktopInfo {
        installed: true,
        has_session,
        accounts: vec![], // Return empty for now, need to implement parsing later
        data_path: Some(data_dir.to_string_lossy().to_string()),
        is_app_store_version: Some(false),
    })
}

/// Detect Telegram Desktop at specified path
#[tauri::command]
pub fn check_custom_telegram_path(path: String) -> Result<TelegramDesktopInfo, String> {
    println!("🔍 Checking custom Telegram Desktop path: {}", path);

    // Expand tilde ~ to actual home directory
    let expanded_path = if path.starts_with("~/") {
        if let Some(home) = std::env::var("HOME").ok() {
            path.replacen("~", &home, 1)
        } else {
            path.clone()
        }
    } else {
        path.clone()
    };

    // Check if it's macOS .app path
    if path.ends_with(".app") || expanded_path.ends_with(".app") {
        println!("🍎 Detected macOS .app bundle, checking data directory");
        // For .app paths, check data directory directly
        if let Some(home) = std::env::var("HOME").ok() {
            let data_dir = PathBuf::from(home).join("Library/Application Support/Telegram Desktop");

            if !data_dir.exists() {
                println!("❌ Data directory not found: {:?}", data_dir);
                return Ok(TelegramDesktopInfo {
                    installed: false,
                    has_session: false,
                    accounts: vec![],
                    data_path: Some(format!(
                        "{}\nData directory does not exist: {}\nPlease make sure you have downloaded and logged into Telegram Desktop from desktop.telegram.org",
                        path, data_dir.display()
                    )),
                    is_app_store_version: Some(false),
                });
            }

            let tdata_path = data_dir.join("tdata");
            let has_session = tdata_path.join("key_datas").exists();

            if has_session {
                println!("✅ Found session at: {:?}", tdata_path);
            } else {
                println!("⚠️  Data directory exists but no session found");
            }

            return Ok(TelegramDesktopInfo {
                installed: true,
                has_session,
                accounts: vec![],
                data_path: Some(data_dir.to_string_lossy().to_string()),
                is_app_store_version: Some(false),
            });
        }

        return Ok(TelegramDesktopInfo {
            installed: false,
            has_session: false,
            accounts: vec![],
            data_path: Some("Cannot determine home directory path".to_string()),
            is_app_store_version: None,
        });
    }

    let data_dir = PathBuf::from(&expanded_path);

    // Check if path exists
    if !data_dir.exists() {
        println!("❌ Path does not exist: {:?}", data_dir);
        return Ok(TelegramDesktopInfo {
            installed: false,
            has_session: false,
            accounts: vec![],
            data_path: Some(format!(
                "{}\nPath does not exist, please check if the path is correct",
                path
            )),
            is_app_store_version: None,
        });
    }

    // Check if it's a directory
    if !data_dir.is_dir() {
        println!("❌ Path is not a directory: {:?}", data_dir);
        return Ok(TelegramDesktopInfo {
            installed: false,
            has_session: false,
            accounts: vec![],
            data_path: Some(format!("{} (not a directory)", path)),
            is_app_store_version: None,
        });
    }

    // Check for tdata directory
    let tdata_path = data_dir.join("tdata");
    if !tdata_path.exists() {
        println!("❌ tdata directory not found at: {:?}", tdata_path);

        // Check if it's Telegram Desktop in Applications folder
        if expanded_path.contains("Applications") && expanded_path.contains("Telegram") {
            println!("💡 Hint: Found in Applications folder, auto-locating data directory");
            // Auto-locate to data directory
            if let Some(home) = std::env::var("HOME").ok() {
                let auto_data_path =
                    PathBuf::from(home).join("Library/Application Support/Telegram Desktop");

                if auto_data_path.exists() {
                    let has_session = auto_data_path.join("tdata/key_datas").exists();
                    return Ok(TelegramDesktopInfo {
                        installed: true,
                        has_session,
                        accounts: vec![],
                        data_path: Some(auto_data_path.to_string_lossy().to_string()),
                        is_app_store_version: Some(false),
                    });
                }
            }

            return Ok(TelegramDesktopInfo {
                installed: true,
                has_session: false,
                accounts: vec![],
                data_path: Some(format!(
                    "{} (data directory should be at: ~/Library/Application Support/Telegram Desktop/)",
                    path
                )),
                is_app_store_version: Some(false),
            });
        }

        return Ok(TelegramDesktopInfo {
            installed: false,
            has_session: false,
            accounts: vec![],
            data_path: Some(format!(
                "{} (tdata directory not found, this is not a Telegram Desktop data directory)",
                path
            )),
            is_app_store_version: None,
        });
    }

    println!("✅ Valid Telegram Desktop directory at: {:?}", data_dir);

    // Check for key_datas file (indicates session exists)
    let key_datas_path = tdata_path.join("key_datas");
    let has_session = key_datas_path.exists();

    if has_session {
        println!("✅ Found existing session");
    } else {
        println!("⚠️  No session found");
    }

    Ok(TelegramDesktopInfo {
        installed: true,
        has_session,
        accounts: vec![],
        data_path: Some(expanded_path),
        is_app_store_version: Some(false),
    })
}
