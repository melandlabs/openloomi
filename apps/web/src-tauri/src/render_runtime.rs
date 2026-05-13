use crate::runtime_components::{
    download_and_install_component, find_in_path, get_component_error, get_home_dir,
    get_platform_dir, is_downloading_component, spawn_component_download, ArchiveKind,
    ComponentState, InstalledRenderEngineInfo, RenderEngineStatus, RuntimeDownloadSpec,
};
use serde::Deserialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

static RENDER_ENGINE_STATE: ComponentState = ComponentState::new();

const DEFAULT_RENDER_ENGINE_VERSION: &str = "2026.04.30.1";

#[derive(Debug, Deserialize)]
struct RenderEngineManifest {
    version: String,
    platforms: std::collections::HashMap<String, RenderEnginePlatformSpec>,
}

#[derive(Debug, Deserialize)]
struct RenderEnginePlatformSpec {
    #[serde(rename = "archiveName")]
    archive_name: Option<String>,
    url: String,
    sha256: Option<String>,
}

fn get_render_engine_root_dir() -> Option<PathBuf> {
    Some(
        get_home_dir()?
            .join(".openloomi")
            .join("render-components")
            .join("render-engine"),
    )
}

fn get_installed_json_path() -> Option<PathBuf> {
    Some(get_render_engine_root_dir()?.join("installed.json"))
}

fn get_packaged_resource_base_dir() -> PathBuf {
    let resource_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));

    if resource_dir.ends_with("MacOS") {
        resource_dir
            .parent()
            .map(|p| p.join("Resources"))
            .unwrap_or(resource_dir)
    } else {
        resource_dir
    }
}

fn get_resource_layout_roots() -> Vec<PathBuf> {
    let base = get_packaged_resource_base_dir();
    vec![base.join("resources"), base]
}

fn get_first_existing_resource_path(relative_path: &str) -> Option<PathBuf> {
    get_resource_layout_roots()
        .into_iter()
        .map(|root| root.join(relative_path))
        .find(|path| path.exists())
}

fn get_manifest_path() -> Option<PathBuf> {
    get_first_existing_resource_path("render-engine-manifest.json")
}

fn load_render_engine_manifest() -> Option<RenderEngineManifest> {
    let manifest_path = get_manifest_path()?;
    let content = std::fs::read_to_string(manifest_path).ok()?;
    serde_json::from_str(&content).ok()
}

fn get_download_spec() -> Option<RuntimeDownloadSpec> {
    let platform_dir = get_platform_dir();
    if platform_dir == "unknown" {
        return None;
    }

    let manifest = load_render_engine_manifest()?;
    let platform_spec = manifest.platforms.get(&platform_dir)?;
    let archive_name = platform_spec.archive_name.clone().unwrap_or_else(|| {
        if cfg!(target_os = "windows") {
            format!("render-engine-{}.zip", platform_dir)
        } else {
            format!("render-engine-{}.tar.gz", platform_dir)
        }
    });

    Some(RuntimeDownloadSpec {
        archive_name,
        archive_kind: if cfg!(target_os = "windows") {
            ArchiveKind::Zip
        } else {
            ArchiveKind::TarGz
        },
        checksum: platform_spec.sha256.clone(),
        install_subdir: platform_dir,
        url: platform_spec.url.clone(),
        version: manifest.version,
    })
}

fn find_soffice_binary(root: &Path) -> Option<PathBuf> {
    [
        root.join("soffice"),
        root.join("LibreOffice.app").join("Contents").join("MacOS").join("soffice"),
        root.join("program").join("soffice"),
        root.join("libreoffice-msi").join("program").join("soffice.exe"),
        root.join("program").join("soffice.exe"),
        root.join("soffice.exe"),
    ]
    .into_iter()
    .find(|path| path.exists())
}

fn find_pdftoppm_binary(root: &Path) -> Option<PathBuf> {
    [
        root.join("pdftoppm"),
        root.join("bin").join("pdftoppm"),
        root.join("pdftoppm.exe"),
        root.join("bin").join("pdftoppm.exe"),
        root.join("Library").join("bin").join("pdftoppm.exe"),
    ]
    .into_iter()
    .find(|path| path.exists())
}

fn find_render_engine_binaries(root: &Path) -> Option<(PathBuf, PathBuf)> {
    let soffice = find_soffice_binary(root)?;
    let pdftoppm = find_pdftoppm_binary(root)?;
    Some((soffice, pdftoppm))
}

fn parse_installed_info() -> Option<InstalledRenderEngineInfo> {
    let installed_json = get_installed_json_path()?;
    if !installed_json.exists() {
        return None;
    }

    let content = std::fs::read_to_string(&installed_json).ok()?;
    serde_json::from_str(&content).ok().or_else(|| {
        let value: Value = serde_json::from_str(&content).ok()?;
        Some(InstalledRenderEngineInfo {
            version: value
                .get("version")
                .and_then(|v| v.as_str())
                .unwrap_or(DEFAULT_RENDER_ENGINE_VERSION)
                .to_string(),
            installed_at: value
                .get("installed_at")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            install_dir: value
                .get("install_dir")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            soffice_binary_path: value
                .get("soffice_binary_path")
                .or_else(|| value.get("binary_path"))
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            pdftoppm_binary_path: value
                .get("pdftoppm_binary_path")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
        })
    })
}

fn load_installed_info() -> Option<InstalledRenderEngineInfo> {
    let info = parse_installed_info()?;
    if PathBuf::from(&info.soffice_binary_path).exists()
        && PathBuf::from(&info.pdftoppm_binary_path).exists()
    {
        Some(info)
    } else {
        None
    }
}

fn get_bundled_render_engine_root() -> PathBuf {
    get_first_existing_resource_path(&format!("render-engine/{}", get_platform_dir())).unwrap_or_else(
        || get_packaged_resource_base_dir().join("render-engine").join(get_platform_dir()),
    )
}

fn get_system_render_engine_paths() -> Option<(PathBuf, PathBuf)> {
    let soffice = if cfg!(target_os = "windows") {
        find_in_path("soffice.exe")
    } else {
        find_in_path("soffice")
    }?;
    let pdftoppm = if cfg!(target_os = "windows") {
        find_in_path("pdftoppm.exe")
    } else {
        find_in_path("pdftoppm")
    }?;
    Some((soffice, pdftoppm))
}

pub fn get_installed_render_runtime_paths() -> (Option<String>, Option<String>) {
    if let Some(info) = load_installed_info() {
        return (
            Some(info.soffice_binary_path),
            Some(info.pdftoppm_binary_path),
        );
    }

    let bundled_root = get_bundled_render_engine_root();
    if let Some((soffice, pdftoppm)) = find_render_engine_binaries(&bundled_root) {
        return (
            Some(soffice.to_string_lossy().to_string()),
            Some(pdftoppm.to_string_lossy().to_string()),
        );
    }

    if let Some((soffice, pdftoppm)) = get_system_render_engine_paths() {
        return (
            Some(soffice.to_string_lossy().to_string()),
            Some(pdftoppm.to_string_lossy().to_string()),
        );
    }

    (None, None)
}

fn downloaded_status(info: InstalledRenderEngineInfo) -> RenderEngineStatus {
    RenderEngineStatus {
        available: true,
        install_dir: Some(info.install_dir),
        installed: true,
        downloading: false,
        reason: Some("Using downloaded render engine".to_string()),
        error_message: None,
        soffice_binary_path: Some(info.soffice_binary_path),
        pdftoppm_binary_path: Some(info.pdftoppm_binary_path),
    }
}

fn bundled_status() -> Option<RenderEngineStatus> {
    let engine_dir = get_bundled_render_engine_root();
    let (soffice, pdftoppm) = find_render_engine_binaries(&engine_dir)?;
    Some(RenderEngineStatus {
        available: true,
        install_dir: Some(engine_dir.to_string_lossy().to_string()),
        installed: true,
        downloading: false,
        reason: Some("Using bundled render engine".to_string()),
        error_message: None,
        soffice_binary_path: Some(soffice.to_string_lossy().to_string()),
        pdftoppm_binary_path: Some(pdftoppm.to_string_lossy().to_string()),
            })
}

fn system_status() -> Option<RenderEngineStatus> {
    let soffice = if cfg!(target_os = "windows") {
        find_in_path("soffice.exe")
    } else {
        find_in_path("soffice")
    };
    let pdftoppm = if cfg!(target_os = "windows") {
        find_in_path("pdftoppm.exe")
    } else {
        find_in_path("pdftoppm")
    };
    let (soffice, pdftoppm) = (soffice?, pdftoppm?);
    Some(RenderEngineStatus {
        available: true,
        install_dir: Some("PATH".to_string()),
        installed: true,
        downloading: false,
        reason: Some("Using system render engine".to_string()),
        error_message: None,
        soffice_binary_path: Some(soffice.to_string_lossy().to_string()),
        pdftoppm_binary_path: Some(pdftoppm.to_string_lossy().to_string()),
            })
}

pub fn get_render_engine_status() -> RenderEngineStatus {
    if let Some(info) = load_installed_info() {
        return downloaded_status(info);
    }

    if let Some(status) = bundled_status() {
        return status;
    }

    if let Some(status) = system_status() {
        return status;
    }

    if is_downloading_component(&RENDER_ENGINE_STATE) {
        return RenderEngineStatus {
            available: false,
            install_dir: get_render_engine_root_dir().map(|p| p.to_string_lossy().to_string()),
            installed: false,
            downloading: true,
            reason: Some("Render engine is downloading in the background".to_string()),
            error_message: get_component_error(&RENDER_ENGINE_STATE),
            soffice_binary_path: None,
            pdftoppm_binary_path: None,
        };
    }

    RenderEngineStatus {
        available: false,
        install_dir: None,
        installed: false,
        downloading: false,
        reason: Some("Render engine is not available".to_string()),
        error_message: get_component_error(&RENDER_ENGINE_STATE),
        soffice_binary_path: None,
        pdftoppm_binary_path: None,
    }
}

fn download_and_install_render_engine() -> Result<(), String> {
    let spec = get_download_spec().ok_or("Unsupported platform for render engine download")?;
    let root_dir = get_render_engine_root_dir().ok_or("Unable to resolve render engine dir")?;
    let installed_json =
        get_installed_json_path().ok_or("Unable to resolve render engine metadata path")?;
    let info = download_and_install_component(
        spec,
        &root_dir,
        &installed_json,
        &RENDER_ENGINE_STATE,
        |root| find_soffice_binary(root),
    )?;

    let install_dir = PathBuf::from(&info.install_dir);
    let (soffice, pdftoppm) = find_render_engine_binaries(&install_dir)
        .ok_or("Render engine install completed but required binaries were not found")?;

    let full_info = InstalledRenderEngineInfo {
        version: info.version,
        installed_at: info.installed_at,
        install_dir: info.install_dir,
        soffice_binary_path: soffice.to_string_lossy().to_string(),
        pdftoppm_binary_path: pdftoppm.to_string_lossy().to_string(),
    };

    let content = serde_json::to_string_pretty(&full_info)
        .map_err(|e| format!("Failed to serialize render engine metadata: {}", e))?;
    std::fs::write(&installed_json, content)
        .map_err(|e| format!("Failed to write render engine metadata: {}", e))?;

    Ok(())
}

pub fn ensure_render_engine_download_started() {
    let status = get_render_engine_status();
    spawn_component_download(
        &RENDER_ENGINE_STATE,
        status.available,
        download_and_install_render_engine,
    );
}

#[tauri::command]
pub fn get_render_engine_status_cmd() -> RenderEngineStatus {
    get_render_engine_status()
}

#[tauri::command]
pub fn ensure_render_engine_download_started_cmd() -> RenderEngineStatus {
    ensure_render_engine_download_started();
    get_render_engine_status()
}
