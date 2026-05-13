// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

//! Render engine management module — handles bundled LibreOffice and poppler binaries
//! for high-fidelity PPTX preview rendering.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Render engine status returned to the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderEngineStatus {
    /// Whether the render engine is available and usable
    pub available: bool,
    /// Directory where the render engine binaries are installed
    pub install_dir: Option<String>,
    /// Whether the engine was found and validated
    pub installed: bool,
    /// Human-readable reason for the status
    pub reason: Option<String>,
    /// Error message if not available
    pub error_message: Option<String>,
}

/// Get the platform-specific render engine directory name
fn get_platform_dir() -> String {
    let os = if cfg!(target_os = "windows") {
        "windows-x64"
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "darwin-arm64"
        } else {
            "darwin-x64"
        }
    } else if cfg!(target_os = "linux") {
        "linux-x64"
    } else {
        "unknown"
    };
    os.to_string()
}

/// Find binary in PATH
fn find_in_path(name: &str) -> Option<PathBuf> {
    std::env::var("PATH").ok().and_then(|path| {
        path.split(if cfg!(target_os = "windows") { ";" } else { ":" })
            .filter_map(|dir| {
                let full_path = PathBuf::from(dir).join(name);
                if full_path.exists() {
                    Some(full_path)
                } else {
                    None
                }
            })
            .next()
    })
}

/// Check if the bundled render engine is available
/// This checks both the legacy path (~/.openloomi/render-engines/office/installed.json)
/// and the bundled path (resources/render-engine/{platform}/)
pub fn get_render_engine_status() -> RenderEngineStatus {
    // First, check the legacy installed.json path
    if let Some(status) = check_legacy_install() {
        return status;
    }

    // Then, check the bundled resources path
    let bundled = check_bundled_engine();
    if bundled.available {
        return bundled;
    }

    // Fallback: check PATH
    check_path_engine()
}

/// Check the legacy install location (~/.openloomi/render-engines/office/installed.json)
fn check_legacy_install() -> Option<RenderEngineStatus> {
    let home = std::env::var("HOME").ok()?;
    let installed_json = PathBuf::from(&home)
        .join(".openloomi")
        .join("render-engines")
        .join("office")
        .join("installed.json");

    if !installed_json.exists() {
        return None;
    }

    let content = std::fs::read_to_string(&installed_json).ok()?;
    let info: serde_json::Value = serde_json::from_str(&content).ok()?;

    let soffice_path = info.get("soffice_path")?.as_str()?.to_string();
    let pdftoppm_path = info.get("pdftoppm_path")?.as_str()?.to_string();

    // Validate paths exist
    let soffice_exists = PathBuf::from(&soffice_path).exists();
    let pdftoppm_exists = PathBuf::from(&pdftoppm_path).exists();

    if soffice_exists && pdftoppm_exists {
        Some(RenderEngineStatus {
            available: true,
            install_dir: Some(
                installed_json
                    .parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default(),
            ),
            installed: true,
            reason: Some("Using legacy render engine installation".to_string()),
            error_message: None,
        })
    } else {
        Some(RenderEngineStatus {
            available: false,
            install_dir: Some(
                installed_json
                    .parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default(),
            ),
            installed: false,
            reason: Some("Legacy install found but binaries missing".to_string()),
            error_message: if !soffice_exists {
                Some(format!("soffice not found at: {}", soffice_path))
            } else {
                Some(format!("pdftoppm not found at: {}", pdftoppm_path))
            },
        })
    }
}

/// Check the bundled render engine in resources
fn check_bundled_engine() -> RenderEngineStatus {
    // Get the resource directory (where the tauri app is installed)
    let resource_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));

    let resource_dir = if resource_dir.ends_with("MacOS") {
        resource_dir
            .parent()
            .and_then(|p| p.join("Resources").canonicalize().ok())
    } else {
        Some(resource_dir.clone())
    }
    .unwrap_or(resource_dir);

    let platform_dir = get_platform_dir();
    let engine_dir = resource_dir.join("render-engine").join(&platform_dir);

    let soffice_path = find_soffice_binary(&engine_dir);
    let pdftoppm_path = find_pdftoppm_binary(&engine_dir);

    let soffice_exists = soffice_path.is_some();
    let pdftoppm_exists = pdftoppm_path.is_some();

    if soffice_exists && pdftoppm_exists {
        RenderEngineStatus {
            available: true,
            install_dir: Some(engine_dir.to_string_lossy().to_string()),
            installed: true,
            reason: Some("Using bundled render engine".to_string()),
            error_message: None,
        }
    } else {
        let missing = if !soffice_exists && !pdftoppm_exists {
            "both soffice and pdftoppm"
        } else if !soffice_exists {
            "soffice"
        } else {
            "pdftoppm"
        };

        RenderEngineStatus {
            available: false,
            install_dir: Some(engine_dir.to_string_lossy().to_string()),
            installed: false,
            reason: Some(format!("Bundled engine incomplete - missing {}", missing)),
            error_message: Some(format!(
                "Expected soffice at: {}/soffice or {}/LibreOffice.app/Contents/MacOS/soffice, \
                 Expected pdftoppm at: {}/pdftoppm",
                engine_dir.display(),
                engine_dir.display(),
                engine_dir.display()
            )),
        }
    }
}

/// Find the soffice binary in the engine directory
fn find_soffice_binary(engine_dir: &PathBuf) -> Option<PathBuf> {
    // Check for direct soffice binary
    let direct = engine_dir.join("soffice");
    if direct.exists() {
        return Some(direct);
    }

    // Check for LibreOffice.app on macOS
    #[cfg(target_os = "macos")]
    {
        let libreoffice_app = engine_dir
            .join("LibreOffice.app")
            .join("Contents")
            .join("MacOS")
            .join("soffice");
        if libreoffice_app.exists() {
            return Some(libreoffice_app);
        }
    }

    None
}

/// Find the pdftoppm binary in the engine directory
fn find_pdftoppm_binary(engine_dir: &PathBuf) -> Option<PathBuf> {
    let pdftoppm = engine_dir.join("pdftoppm");
    if pdftoppm.exists() {
        return Some(pdftoppm);
    }

    // Also check in a bin subdirectory
    let pdftoppm_bin = engine_dir.join("bin").join("pdftoppm");
    if pdftoppm_bin.exists() {
        return Some(pdftoppm_bin);
    }

    None
}

/// Check for engines available in PATH
fn check_path_engine() -> RenderEngineStatus {
    let soffice_path = find_in_path("soffice");
    let pdftoppm_path = find_in_path("pdftoppm");

    if soffice_path.is_some() && pdftoppm_path.is_some() {
        RenderEngineStatus {
            available: true,
            install_dir: Some("PATH".to_string()),
            installed: true,
            reason: Some("Using system PATH render engine".to_string()),
            error_message: None,
        }
    } else {
        RenderEngineStatus {
            available: false,
            install_dir: None,
            installed: false,
            reason: Some("No render engine found in bundled resources or PATH".to_string()),
            error_message: Some(
                "soffice and pdftoppm not found. Install LibreOffice and poppler-utils, or add them to PATH."
                    .to_string(),
            ),
        }
    }
}

/// Tauri command to get render engine status
#[tauri::command]
pub fn get_render_engine_status_cmd() -> RenderEngineStatus {
    get_render_engine_status()
}
