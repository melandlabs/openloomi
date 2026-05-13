use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledBinaryInfo {
    pub version: String,
    pub installed_at: String,
    pub install_dir: String,
    pub binary_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeComponentStatus {
    pub available: bool,
    pub install_dir: Option<String>,
    pub installed: bool,
    pub downloading: bool,
    pub reason: Option<String>,
    pub error_message: Option<String>,
    pub binary_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderEngineStatus {
    pub available: bool,
    pub install_dir: Option<String>,
    pub installed: bool,
    pub downloading: bool,
    pub reason: Option<String>,
    pub error_message: Option<String>,
    pub soffice_binary_path: Option<String>,
    pub pdftoppm_binary_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledRenderEngineInfo {
    pub version: String,
    pub installed_at: String,
    pub install_dir: String,
    pub soffice_binary_path: String,
    pub pdftoppm_binary_path: String,
}

#[derive(Debug, Clone)]
pub enum ArchiveKind {
    TarGz,
    Zip,
    Conda,
}

#[derive(Debug, Clone)]
pub struct RuntimeDownloadSpec {
    pub archive_name: String,
    pub archive_kind: ArchiveKind,
    pub checksum: Option<String>,
    pub install_subdir: String,
    pub url: String,
    pub version: String,
}

pub struct ComponentState {
    pub downloading: AtomicBool,
    pub error: Mutex<Option<String>>,
}

impl ComponentState {
    pub const fn new() -> Self {
        Self {
            downloading: AtomicBool::new(false),
            error: Mutex::new(None),
        }
    }
}

pub fn set_component_error(state: &ComponentState, message: Option<String>) {
    if let Ok(mut guard) = state.error.lock() {
        *guard = message;
    }
}

pub fn get_component_error(state: &ComponentState) -> Option<String> {
    state.error.lock().ok().and_then(|guard| guard.clone())
}

pub fn is_downloading_component(state: &ComponentState) -> bool {
    state.downloading.load(Ordering::SeqCst)
}

pub fn set_downloading_component(state: &ComponentState, downloading: bool) {
    state.downloading.store(downloading, Ordering::SeqCst);
}

pub fn get_platform_dir() -> String {
    let os = if cfg!(target_os = "windows") {
        if cfg!(target_arch = "aarch64") {
            "windows-arm64"
        } else {
            "windows-x64"
        }
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "darwin-arm64"
        } else {
            "darwin-x64"
        }
    } else if cfg!(target_os = "linux") {
        if cfg!(target_arch = "x86_64") {
            "linux-x64"
        } else {
            "unknown"
        }
    } else {
        "unknown"
    };
    os.to_string()
}

pub fn get_home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE").ok().map(PathBuf::from)
    }

    #[cfg(not(windows))]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}

pub fn find_in_path(name: &str) -> Option<PathBuf> {
    // First check PATH
    let path_var = std::env::var("PATH").ok()?;
    let splitter = if cfg!(target_os = "windows") { ";" } else { ":" };
    if let Some(path) = path_var.split(splitter).find_map(|dir| {
        let candidate = PathBuf::from(dir).join(name);
        if candidate.exists() {
            return Some(candidate);
        }
        if cfg!(target_os = "windows") {
            let exe = PathBuf::from(dir).join(format!("{}.exe", name));
            if exe.exists() {
                return Some(exe);
            }
        }
        None
    }) {
        return Some(path);
    }

    // macOS: Check Homebrew common paths directly
    #[cfg(target_os = "macos")]
    {
        let homebrew_paths = ["/opt/homebrew/bin", "/usr/local/bin"];
        for base in &homebrew_paths {
            let candidate = PathBuf::from(base).join(name);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }

    None
}

pub fn chrono_like_timestamp() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

pub fn write_installed_info(installed_json: &PathBuf, info: &InstalledBinaryInfo) -> Result<(), String> {
    let parent = installed_json
        .parent()
        .ok_or("Runtime component parent directory missing")?;
    std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create component dir: {}", e))?;

    let tmp_path = installed_json.with_extension("json.tmp");
    let content =
        serde_json::to_string_pretty(info).map_err(|e| format!("Failed to serialize install info: {}", e))?;
    std::fs::write(&tmp_path, content)
        .map_err(|e| format!("Failed to write component metadata: {}", e))?;
    std::fs::rename(&tmp_path, installed_json)
        .map_err(|e| format!("Failed to finalize component metadata: {}", e))?;
    Ok(())
}

pub fn verify_sha256(path: &PathBuf, expected_hex: &str) -> Result<(), String> {
    use std::io::Read;

    let mut file = std::fs::File::open(path)
        .map_err(|e| format!("Failed to open downloaded archive: {}", e))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8192];
    loop {
        let read = file
            .read(&mut buf)
            .map_err(|e| format!("Failed to read downloaded archive: {}", e))?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    let digest = format!("{:x}", hasher.finalize());
    if digest.eq_ignore_ascii_case(expected_hex.trim()) {
        Ok(())
    } else {
        Err(format!(
            "Checksum mismatch. Expected {}, got {}",
            expected_hex, digest
        ))
    }
}

pub fn extract_archive(
    archive_path: &PathBuf,
    install_dir: &PathBuf,
    kind: &ArchiveKind,
) -> Result<(), String> {
    if install_dir.exists() {
        std::fs::remove_dir_all(install_dir)
            .map_err(|e| format!("Failed to clean previous install: {}", e))?;
    }
    std::fs::create_dir_all(install_dir)
        .map_err(|e| format!("Failed to create install dir: {}", e))?;

    match kind {
        ArchiveKind::TarGz => {
            let status = Command::new("tar")
                .args([
                    "-xzf",
                    archive_path.to_string_lossy().as_ref(),
                    "-C",
                    install_dir.to_string_lossy().as_ref(),
                    "--strip-components=1",
                ])
                .status()
                .map_err(|e| format!("Failed to run tar: {}", e))?;

            if !status.success() {
                return Err("Archive extraction failed".to_string());
            }
        }
        ArchiveKind::Zip => {
            #[cfg(target_os = "windows")]
            {
                let output = Command::new("powershell")
                    .args([
                        "-ExecutionPolicy",
                        "Bypass",
                        "-Command",
                        &format!(
                            "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
                            archive_path.to_string_lossy(),
                            install_dir.to_string_lossy()
                        ),
                    ])
                    .output()
                    .map_err(|e| format!("Failed to run PowerShell: {}", e))?;

                if !output.status.success() {
                    return Err(format!(
                        "Archive extraction failed: {}",
                        String::from_utf8_lossy(&output.stderr).trim()
                    ));
                }
            }

            #[cfg(not(target_os = "windows"))]
            {
                let status = Command::new("unzip")
                    .args([
                        "-oq",
                        archive_path.to_string_lossy().as_ref(),
                        "-d",
                        install_dir.to_string_lossy().as_ref(),
                    ])
                    .status()
                    .map_err(|e| format!("Failed to run unzip: {}", e))?;
                if !status.success() {
                    return Err("ZIP extraction failed".to_string());
                }
            }
        }
        ArchiveKind::Conda => {
            let scratch_dir = std::env::temp_dir().join(format!(
                "openloomi-pdftoppm-conda-{}",
                std::process::id()
            ));
            if scratch_dir.exists() {
                let _ = std::fs::remove_dir_all(&scratch_dir);
            }
            std::fs::create_dir_all(&scratch_dir)
                .map_err(|e| format!("Failed to create conda scratch dir: {}", e))?;

            let unzip_status = Command::new("unzip")
                .args([
                    "-oq",
                    archive_path.to_string_lossy().as_ref(),
                    "-d",
                    scratch_dir.to_string_lossy().as_ref(),
                ])
                .status()
                .map_err(|e| format!("Failed to unzip conda package: {}", e))?;
            if !unzip_status.success() {
                let _ = std::fs::remove_dir_all(&scratch_dir);
                return Err("Failed to unzip conda package".to_string());
            }

            let pkg_archive = std::fs::read_dir(&scratch_dir)
                .map_err(|e| format!("Failed to inspect conda package: {}", e))?
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .find(|path| {
                    path.file_name()
                        .and_then(|name| name.to_str())
                        .map(|name| {
                            name.starts_with("pkg-")
                                && (name.ends_with(".tar.zst")
                                    || name.ends_with(".tar.gz")
                                    || name.ends_with(".tar"))
                        })
                        .unwrap_or(false)
                })
                .ok_or("Unable to locate conda payload archive")?;

            let pkg_str = pkg_archive.to_string_lossy().to_string();
            let install_str = install_dir.to_string_lossy().to_string();
            let status = if pkg_str.ends_with(".tar.zst") {
                Command::new("sh")
                    .args([
                        "-c",
                        &format!("zstd -dc '{}' | tar -xf - -C '{}'", pkg_str, install_str),
                    ])
                    .status()
                    .map_err(|e| format!("Failed to extract .tar.zst payload: {}", e))?
            } else if pkg_str.ends_with(".tar.gz") {
                Command::new("tar")
                    .args(["-xzf", &pkg_str, "-C", &install_str])
                    .status()
                    .map_err(|e| format!("Failed to extract .tar.gz payload: {}", e))?
            } else {
                Command::new("tar")
                    .args(["-xf", &pkg_str, "-C", &install_str])
                    .status()
                    .map_err(|e| format!("Failed to extract .tar payload: {}", e))?
            };

            let _ = std::fs::remove_dir_all(&scratch_dir);
            if !status.success() {
                return Err("Conda payload extraction failed".to_string());
            }
        }
    }

    Ok(())
}

pub fn download_and_install_component(
    spec: RuntimeDownloadSpec,
    root_dir: &PathBuf,
    installed_json: &PathBuf,
    state: &'static ComponentState,
    binary_resolver: fn(&Path) -> Option<PathBuf>,
) -> Result<InstalledBinaryInfo, String> {
    let version_dir = root_dir.join(&spec.version).join(&spec.install_subdir);
    let temp_archive = std::env::temp_dir().join(&spec.archive_name);

    let client = reqwest::blocking::Client::new();
    let mut response = client
        .get(&spec.url)
        .send()
        .map_err(|e| format!("Failed to download runtime component: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download runtime component: HTTP {}",
            response.status()
        ));
    }

    let mut file = std::fs::File::create(&temp_archive)
        .map_err(|e| format!("Failed to create archive file: {}", e))?;
    std::io::copy(&mut response, &mut file)
        .map_err(|e| format!("Failed to write archive file: {}", e))?;

    if let Some(expected_sha) = spec.checksum.as_ref() {
        if let Err(error) = verify_sha256(&temp_archive, expected_sha) {
            let _ = std::fs::remove_file(&temp_archive);
            return Err(error);
        }
    }

    if let Err(error) = extract_archive(&temp_archive, &version_dir, &spec.archive_kind) {
        let _ = std::fs::remove_file(&temp_archive);
        return Err(error);
    }
    let _ = std::fs::remove_file(&temp_archive);

    let binary_path = binary_resolver(&version_dir)
        .ok_or("Runtime install completed but target binary was not found")?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&binary_path, std::fs::Permissions::from_mode(0o755));
    }

    let info = InstalledBinaryInfo {
        version: spec.version,
        installed_at: chrono_like_timestamp(),
        install_dir: version_dir.to_string_lossy().to_string(),
        binary_path: binary_path.to_string_lossy().to_string(),
    };
    write_installed_info(installed_json, &info)?;
    set_component_error(state, None);
    Ok(info)
}

pub fn spawn_component_download(
    state: &'static ComponentState,
    already_available: bool,
    action: fn() -> Result<(), String>,
) {
    if already_available || is_downloading_component(state) {
        return;
    }

    set_component_error(state, None);
    set_downloading_component(state, true);
    thread::spawn(move || {
        let result = action();
        if let Err(error) = result {
            eprintln!("❌ Runtime component download failed: {}", error);
            set_component_error(state, Some(error));
        } else {
            set_component_error(state, None);
        }
        set_downloading_component(state, false);
    });
}
