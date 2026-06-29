#![allow(dead_code)]
#![allow(unused)]
// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

//! Node.js management module — handles discovery, download, and Next.js server lifecycle.

use crate::panic_guard::{catch_unwind_str, lock_recovered};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(unix)]
use std::os::unix::process::CommandExt;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// CREATE_NO_WINDOW flag — prevents a console window from appearing when spawning
/// a child process on Windows.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
use std::sync::LazyLock;
use std::sync::Mutex;
use std::sync::TryLockError;
use std::thread;
use std::time::Duration;
use tauri::Emitter;

// Base64 decode (standard alphabet) for double-base64 encoded secrets
pub fn base64_decode(input: &str) -> Result<Vec<u8>, &'static str> {
    const BASE64_TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let input = input.trim_end_matches('=');
    let mut output = Vec::with_capacity(input.len() * 3 / 4);

    let mut buffer: u32 = 0;
    let mut bits_collected = 0;

    for c in input.bytes() {
        let value = BASE64_TABLE
            .iter()
            .position(|&x| x == c)
            .ok_or("Invalid base64 character")? as u32;
        buffer = (buffer << 6) | value;
        bits_collected += 6;

        if bits_collected >= 8 {
            bits_collected -= 8;
            output.push((buffer >> bits_collected) as u8);
            buffer &= (1 << bits_collected) - 1;
        }
    }

    Ok(output)
}

/// Global Node.js process handle (Arc so both monitor thread and wait loop can access)
pub static NODEJS_PROCESS: LazyLock<std::sync::Arc<std::sync::Mutex<Option<std::process::Child>>>> =
    LazyLock::new(|| std::sync::Arc::new(Mutex::new(None)));

/// Captured stderr from the last failed Node.js spawn
pub static NODEJS_STDERR: Mutex<Option<String>> = Mutex::new(None);

/// Captured exit code from the last failed Node.js spawn
pub static NODEJS_EXIT_CODE: Mutex<Option<i32>> = Mutex::new(None);

/// Flag to prevent duplicate cleanup
pub static IS_CLEANING: AtomicBool = AtomicBool::new(false);

struct CleanupFlagGuard;

impl CleanupFlagGuard {
    fn try_enter(skip_message: &str) -> Option<Self> {
        if IS_CLEANING
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::Relaxed)
            .is_err()
        {
            println!("{}", skip_message);
            return None;
        }

        Some(Self)
    }
}

impl Drop for CleanupFlagGuard {
    fn drop(&mut self) {
        IS_CLEANING.store(false, Ordering::SeqCst);
    }
}

/// Flag indicating whether Next.js server started successfully
pub static NEXTJS_STARTED: AtomicBool = AtomicBool::new(false);

/// Flag to prevent concurrent startup attempts
static STARTUP_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

/// Last reported server status (for get_server_status polling fallback)
static LAST_SERVER_STATUS: LazyLock<Mutex<String>> =
    LazyLock::new(|| Mutex::new("starting".to_string()));

/// Global AppHandle for emitting events from background threads
pub static APP_HANDLE: Mutex<Option<tauri::AppHandle>> = Mutex::new(None);

/// One-shot channel receiver for the background thread to receive AppHandle
/// Uses std::sync::mpsc::Receiver which is Sync, so it can be stored in a global static
pub static APP_HANDLE_RX: Mutex<Option<std::sync::mpsc::Receiver<tauri::AppHandle>>> =
    Mutex::new(None);

/// One-shot channel sender — stored globally so setup can send AppHandle to the background thread
pub static APP_HANDLE_TX: Mutex<Option<std::sync::mpsc::Sender<tauri::AppHandle>>> =
    Mutex::new(None);

/// Startup error message
pub static STARTUP_ERROR: Mutex<Option<String>> = Mutex::new(None);

/// Flag indicating whether Node.js is being downloaded
pub static DOWNLOADING_NODE: AtomicBool = AtomicBool::new(false);

/// Set startup error message
#[allow(dead_code)]
pub fn set_startup_error(error: String) {
    let mut guard = lock_recovered(&STARTUP_ERROR, "set startup error");
    *guard = Some(error);
    drop(guard);
    emit_server_status_event("error");
}

/// Set download state
#[allow(dead_code)]
pub fn set_downloading_node(downloading: bool) {
    DOWNLOADING_NODE.store(downloading, Ordering::SeqCst);
    if downloading {
        emit_server_status_event("downloading");
    }
}

/// Get download state
#[allow(dead_code)]
pub fn is_downloading_node() -> bool {
    DOWNLOADING_NODE.load(Ordering::SeqCst)
}

/// Get startup error message
#[allow(dead_code)]
pub fn get_startup_error() -> Option<String> {
    lock_recovered(&STARTUP_ERROR, "get startup error").clone()
}

/// Emit server status event to the frontend via AppHandle
fn emit_server_status_event(status: &str) {
    // Record status for polling fallback
    let mut status_guard = lock_recovered(&LAST_SERVER_STATUS, "record server status");
    *status_guard = status.to_string();
    drop(status_guard);

    // First try to get from direct global
    let app_handle = lock_recovered(&APP_HANDLE, "read app handle").clone();
    if let Some(ref app_handle) = app_handle {
        do_emit(app_handle, status);
        return;
    }

    // Try to receive from the channel if available
    let rx_guard = lock_recovered(&APP_HANDLE_RX, "read app handle receiver");
    if let Some(ref rx) = *rx_guard {
        if let Ok(handle) = rx.recv_timeout(Duration::from_secs(1)) {
            let mut app_guard = lock_recovered(&APP_HANDLE, "store app handle");
            *app_guard = Some(handle.clone());
            drop(app_guard);
            do_emit(&handle, status);
        }
    }
}

fn do_emit(app_handle: &tauri::AppHandle, status: &str) {
    let payload = ServerStatus {
        running: status == "running",
        status: status.to_string(),
        error_message: get_startup_error(),
        node_version: get_node_version(),
    };
    if let Err(e) = app_handle.emit("server-status", payload) {
        eprintln!("⚠️  Failed to emit server-status event: {}", e);
    }
}

/// Emit a crash event with a custom error message (used by watchdog and monitor thread)
fn emit_crash_event(message: &str) {
    // Record crashed status for polling fallback
    let mut status_guard = lock_recovered(&LAST_SERVER_STATUS, "record crash status");
    *status_guard = "crashed".to_string();
    drop(status_guard);

    let app_handle_opt = lock_recovered(&APP_HANDLE, "read app handle for crash event").clone();

    if let Some(ref app_handle) = app_handle_opt {
        let payload = ServerStatus {
            running: false,
            status: "crashed".to_string(),
            error_message: Some(message.to_string()),
            node_version: None,
        };
        if let Err(e) = app_handle.emit("server-status", payload) {
            eprintln!("⚠️  Failed to emit crash event: {}", e);
        }
    }
}

/// Spawn a watchdog thread that monitors the Node.js process and auto-restarts on crash
#[cfg(not(debug_assertions))]
fn spawn_watchdog_thread() {
    let watchdog_node_process = NODEJS_PROCESS.clone();

    thread::spawn(move || {
        if let Err(error) = catch_unwind_str("node watchdog thread", || {
            loop {
                thread::sleep(Duration::from_secs(30));

                // Try to check if the child process is still alive
                let is_alive = {
                    let mut guard = lock_recovered(
                        watchdog_node_process.as_ref(),
                        "watchdog node process handle",
                    );
                    if let Some(ref mut child) = *guard {
                        match child.try_wait() {
                            Ok(Some(_)) => false,
                            Ok(None) => true,
                            Err(error) => {
                                eprintln!("⚠️  Watchdog failed to poll Node.js: {}", error);
                                false
                            }
                        }
                    } else {
                        break; // No child process, exit watchdog
                    }
                };

                if !is_alive {
                    eprintln!("⚠️  Watchdog detected Node.js process is dead");

                    // Clear running state
                    NEXTJS_STARTED.store(false, Ordering::SeqCst);

                    // Notify frontend of crash
                    emit_crash_event("Server process died unexpectedly. Restarting...");

                    // Wait before restarting to let frontend show the crash state
                    eprintln!("🔄 Auto-restarting in 5 seconds...");
                    thread::sleep(Duration::from_secs(5));

                    // Clean up and restart
                    cleanup_nodejs_process();

                    // Reset startup in-progress flag so restart can proceed
                    let _ = STARTUP_IN_PROGRESS.swap(false, Ordering::SeqCst);

                    start_nextjs_server();

                    // Exit this watchdog loop — new start_nextjs_server will spawn a fresh one
                    break;
                }
            }
        }) {
            eprintln!("⚠️  Node.js watchdog stopped unexpectedly: {}", error);
        }
    });
}

/// Get Node.js version
#[allow(dead_code)]
pub fn get_node_version() -> Option<String> {
    let output = Command::new("node").arg("--version").output().ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

/// Check if Node.js version meets v22 requirement
#[allow(dead_code)]
pub fn is_node_version_valid(node_path: &str) -> bool {
    // Reject shell wrapper scripts (fnm/nvm often install .sh files as the "node" binary).
    // On macOS GUI apps, these scripts cannot be executed directly by std::process::Command.
    if let Ok(metadata) = std::fs::metadata(node_path) {
        if metadata.is_file() {
            if let Ok(mut file) = std::fs::File::open(node_path) {
                use std::io::Read;
                let mut header = [0u8; 2];
                if file.read_exact(&mut header).is_ok() {
                    if header == [b'#', b'!'] {
                        println!(
                            "⚠️  Node.js at {} is a shell wrapper script, not a binary executable",
                            node_path
                        );
                        return false;
                    }
                }
            }
        }
    }

    let output = Command::new(node_path).arg("--version").output();
    if let Ok(output) = output {
        if output.status.success() {
            let version_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if let Some(v_str) = version_str.strip_prefix('v') {
                if let Some(major) = v_str.split('.').next() {
                    if let Ok(major_version) = major.parse::<u32>() {
                        if major_version != 22 {
                            println!(
                                "⚠️  Node.js at {} is v{}.{}, requires v22 — invalid",
                                node_path, major_version, v_str
                            );
                            return false;
                        }
                        // Version check passed — also verify node_modules are accessible
                        // (a corrupted/broken Node.js binary may still report the right version
                        // but fail when actually requiring core modules)
                        let check_output = Command::new(node_path)
                            .args(["-e", "require('path')"])
                            .output()
                            .ok();
                        if !check_output
                            .as_ref()
                            .map(|o| o.status.success())
                            .unwrap_or(false)
                        {
                            println!(
                                "⚠️  Node.js at {} reports v22 but require('path') failed — binary may be corrupted or missing native modules",
                                node_path
                            );
                            return false;
                        }
                        return true;
                    }
                }
            }
        }
    }
    false
}

/// Find system Node.js path (Unix)
#[cfg(all(not(debug_assertions), unix))]
pub fn find_system_node(home: &str) -> Option<String> {
    // macOS GUI apps (launchd) have a minimal PATH that doesn't include user shell
    // modifications from .zshrc/.zprofile. Use login shell to get the user's full PATH.
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string());
    let shell_name = std::path::Path::new(&shell)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("bash");

    let which_output = if shell_name == "zsh" {
        std::process::Command::new(&shell)
            .args(["-l", "-c", "which node 2>/dev/null || echo ''"])
            .output()
    } else {
        std::process::Command::new(&shell)
            .args(["-l", "-c", "which node 2>/dev/null || echo ''"])
            .output()
    };

    if let Ok(output) = which_output {
        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout);
            if let Some(first_line) = path_str.lines().next() {
                let raw_path = first_line.trim();
                if !raw_path.is_empty() {
                    // Resolve to real path (follow symlinks) so we get the actual binary,
                    // not a shell wrapper script that fnm/nvm may use.
                    if let Ok(real_path) = std::fs::canonicalize(raw_path) {
                        let node_path = real_path.to_string_lossy();
                        if std::path::Path::new(&*node_path).exists()
                            && is_node_version_valid(&node_path)
                        {
                            println!("✅ Found system Node.js at: {}", node_path);
                            println!(
                                "   └─ Symlink resolved from {} — v22 binary, native modules OK",
                                raw_path
                            );
                            return Some(node_path.into_owned());
                        } else {
                            println!(
                                "⚠️  System Node.js at {} failed validation, will download new version...",
                                node_path
                            );
                        }
                    } else {
                        // symlink target doesn't exist — treat as broken
                        println!(
                            "⚠️  System Node.js at {} is a broken symlink (target not found), will download new version...",
                            raw_path
                        );
                    }
                }
            }
        }
    }

    let env_home = home.to_string();
    let fixed_paths: Vec<String> = vec![
        format!("{}/.openloomi/node/bin/node", env_home),
        "/usr/local/bin/node".to_string(),
        "/opt/homebrew/bin/node".to_string(),
        format!("{}/.nvm/versions/node/v22.17.0/bin/node", env_home),
        // fnm (Fast Node Manager) — try specific version and default alias
        format!(
            "{}/.local/share/fnm/node-versions/v22.17.0/installation/bin/node",
            env_home
        ),
        format!("{}/.local/share/fnm/aliases/default/bin/node", env_home),
    ];

    for path in &fixed_paths {
        if std::path::Path::new(path).exists() {
            if is_node_version_valid(path) {
                println!("✅ Found valid Node.js at fixed path: {}", path);
                println!("   └─ v22 binary, native modules OK");
                return Some(path.clone());
            } else {
                println!(
                    "⚠️  Fixed path Node.js at {} failed validation, will download new version...",
                    path
                );
            }
        }
    }

    None
}

/// Find system Node.js path (Windows)
#[cfg(all(not(debug_assertions), windows))]
pub fn find_system_node(home: &str) -> Option<String> {
    let env_home = home.to_string();

    // First check fixed paths (including .openloomi downloaded node)
    let fixed_paths: Vec<String> = vec![
        format!(r"{}\.openloomi\node\node.exe", env_home),
        format!(r"{}\AppData\Roaming\nvm\v22.17.0\node.exe", env_home),
        format!(r"{}\.nvm\versions\node\v22.17.0\node.exe", env_home),
        r"C:\Program Files\nodejs\node.exe".to_string(),
        r"C:\Program Files (x86)\nodejs\node.exe".to_string(),
        // Scoop shims directory (node often installed here)
        format!(r"{}\scoop\shims\node.exe", env_home),
        // npm global binaries (node may be shimmed here)
        format!(r"{}\AppData\Roaming\npm\node.exe", env_home),
    ];

    for path in &fixed_paths {
        if std::path::Path::new(path).exists() {
            if is_node_version_valid(path) {
                println!("✅ Found Node.js at fixed path: {}", path);
                return Some(path.clone());
            } else {
                println!("⚠️  Fixed path Node.js version is below v22, will try another...");
            }
        }
    }

    // Search using PowerShell Get-Command first — it resolves node via both PATH
    // and App Paths registry (e.g. HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths),
    // which is how the shell resolves "node" even when it's not in PATH.
    println!("🔍 Searching PATH and App Paths for node.exe...");
    if let Ok(output) = std::process::Command::new("powershell")
        .args([
            "-Command",
            "(Get-Command node -ErrorAction SilentlyContinue).Source",
        ])
        .output()
    {
        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path_str.is_empty() && std::path::Path::new(&path_str).exists() {
                if !path_str.contains(".openloomi") && is_node_version_valid(&path_str) {
                    println!("✅ Found valid Node.js: {}", path_str);
                    return Some(path_str);
                } else if path_str.contains(".openloomi") {
                    println!("⚠️  .openloomi Node.js is below v22, will download new version...");
                } else {
                    println!("⚠️  Found Node.js version below v22: {}", path_str);
                }
            }
        }
    }

    // Fallback: try `where` via cmd shell — this searches PATH directories directly.
    // Some node installs (e.g. Scoop shims) may be in PATH but not resolved by Get-Command.
    println!("🔍 Searching system PATH for node.exe via where...");
    if let Ok(output) = std::process::Command::new("cmd")
        .args(["/c", "where", "node"])
        .output()
    {
        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout);
            for line in path_str.lines().take(5) {
                let node_path = line.trim();
                if node_path.is_empty() || node_path.contains(".openloomi") {
                    continue;
                }
                if std::path::Path::new(node_path).exists() {
                    if is_node_version_valid(node_path) {
                        println!("✅ Found valid Node.js in PATH: {}", node_path);
                        return Some(node_path.to_string());
                    } else {
                        println!("⚠️  PATH Node.js version below v22: {}", node_path);
                    }
                }
            }
        }
    }

    // Also try calling node directly as a last resort — this resolves via App Paths
    // even when `where` can't find it (e.g., when node is registered via installer
    // but not in system PATH, which is common with Scoop/Choco/npm global shims)
    println!("🔍 Trying direct invocation of node...");
    if let Ok(output) = std::process::Command::new("node").arg("--version").output() {
        if output.status.success() {
            // Get-Command found it via App Paths, use PowerShell to resolve the actual path
            if let Ok(which_output) = std::process::Command::new("powershell")
                .args([
                    "-Command",
                    "(Get-Command node -ErrorAction SilentlyContinue).Source",
                ])
                .output()
            {
                if which_output.status.success() {
                    let path_str = String::from_utf8_lossy(&which_output.stdout)
                        .trim()
                        .to_string();
                    if !path_str.is_empty() && std::path::Path::new(&path_str).exists() {
                        if is_node_version_valid(&path_str) {
                            println!("✅ Found valid Node.js via direct invocation: {}", path_str);
                            return Some(path_str);
                        }
                    }
                }
            }
        }
    }

    println!("⚠️  No valid system Node.js found");
    None
}

/// Download and install Node.js (macOS)
#[cfg(all(not(debug_assertions), target_os = "macos"))]
pub fn download_and_install_node(home: &str) -> Option<String> {
    use std::fs;

    set_downloading_node(true);

    let env_home = home.to_string();
    let install_dir = PathBuf::from(&env_home).join(".openloomi").join("node");
    let node_exe = install_dir.join("bin").join("node");

    if node_exe.exists() {
        set_downloading_node(false);
        return Some(node_exe.to_string_lossy().to_string());
    }

    if let Err(e) = fs::create_dir_all(install_dir.join("bin")) {
        eprintln!("❌ Failed to create node install directory: {}", e);
        set_downloading_node(false);
        return None;
    }

    let (url, archive_name) = if cfg!(target_arch = "aarch64") {
        (
            "https://nodejs.org/dist/v22.17.0/node-v22.17.0-darwin-arm64.tar.gz",
            "node-v22.17.0-darwin-arm64.tar.gz",
        )
    } else {
        (
            "https://nodejs.org/dist/v22.17.0/node-v22.17.0-darwin-x64.tar.gz",
            "node-v22.17.0-darwin-x64.tar.gz",
        )
    };

    println!("📥 Downloading Node.js from {}", url);

    let temp_dir = std::env::temp_dir();
    let archive_path = temp_dir.join(archive_name);

    let client = reqwest::blocking::Client::new();
    let response = client.get(url).send();

    match response {
        Ok(mut resp) => {
            let mut file = match fs::File::create(&archive_path) {
                Ok(f) => f,
                Err(e) => {
                    let msg = format!("Failed to create archive file: {}", e);
                    eprintln!("❌ {}", msg);
                    set_startup_error(msg);
                    set_downloading_node(false);
                    return None;
                }
            };
            if let Err(e) = std::io::copy(&mut resp, &mut file) {
                let msg = format!("Failed to write downloaded file: {}", e);
                eprintln!("❌ {}", msg);
                let _ = fs::remove_file(&archive_path);
                set_startup_error(msg);
                set_downloading_node(false);
                return None;
            }
        }
        Err(e) => {
            let msg = format!(
                "Failed to download Node.js: {}. \
                Possible causes: network unreachable, proxy blocked, SSL/TLS error, or disk full. \
                Please check your internet connection and try again.",
                e
            );
            eprintln!("❌ {}", msg);
            set_startup_error(msg);
            set_downloading_node(false);
            return None;
        }
    }

    println!("📦 Extracting Node.js...");
    let extract_result = Command::new("tar")
        .args([
            "-xzf",
            archive_path.to_string_lossy().as_ref(),
            "-C",
            install_dir.to_string_lossy().as_ref(),
            "--strip-components=1",
        ])
        .status();

    let _ = fs::remove_file(&archive_path);

    match extract_result {
        Ok(status) if status.success() => {
            println!("✅ Node.js installed successfully");
            set_downloading_node(false);
            Some(node_exe.to_string_lossy().to_string())
        }
        _ => {
            let msg = "Failed to extract Node.js archive. Please check disk space and permissions."
                .to_string();
            eprintln!("❌ {}", msg);
            set_startup_error(msg);
            set_downloading_node(false);
            None
        }
    }
}

/// Download and install Node.js (Linux)
#[cfg(all(not(debug_assertions), target_os = "linux"))]
pub fn download_and_install_node(home: &str) -> Option<String> {
    use std::fs;

    set_downloading_node(true);

    let env_home = home.to_string();
    let install_dir = PathBuf::from(&env_home).join(".openloomi").join("node");
    let node_exe = install_dir.join("bin").join("node");

    if node_exe.exists() {
        set_downloading_node(false);
        return Some(node_exe.to_string_lossy().to_string());
    }

    if let Err(e) = fs::create_dir_all(install_dir.join("bin")) {
        eprintln!("❌ Failed to create node install directory: {}", e);
        set_downloading_node(false);
        return None;
    }

    let (url, archive_name) = if cfg!(target_arch = "aarch64") {
        (
            "https://nodejs.org/dist/v22.17.0/node-v22.17.0-linux-arm64.tar.gz",
            "node-v22.17.0-linux-arm64.tar.gz",
        )
    } else {
        (
            "https://nodejs.org/dist/v22.17.0/node-v22.17.0-linux-x64.tar.gz",
            "node-v22.17.0-linux-x64.tar.gz",
        )
    };

    println!("📥 Downloading Node.js from {}", url);

    let temp_dir = std::env::temp_dir();
    let archive_path = temp_dir.join(archive_name);

    let client = reqwest::blocking::Client::new();
    let response = client.get(url).send();

    match response {
        Ok(mut resp) => {
            let mut file = match fs::File::create(&archive_path) {
                Ok(f) => f,
                Err(e) => {
                    let msg = format!("Failed to create archive file: {}", e);
                    eprintln!("❌ {}", msg);
                    set_startup_error(msg);
                    set_downloading_node(false);
                    return None;
                }
            };
            if let Err(e) = std::io::copy(&mut resp, &mut file) {
                let msg = format!("Failed to write downloaded file: {}", e);
                eprintln!("❌ {}", msg);
                let _ = fs::remove_file(&archive_path);
                set_startup_error(msg);
                set_downloading_node(false);
                return None;
            }
        }
        Err(e) => {
            let msg = format!(
                "Failed to download Node.js: {}. \
                Possible causes: network unreachable, proxy blocked, SSL/TLS error, or disk full. \
                Please check your internet connection and try again.",
                e
            );
            eprintln!("❌ {}", msg);
            set_startup_error(msg);
            set_downloading_node(false);
            return None;
        }
    }

    println!("📦 Extracting Node.js...");
    let extract_result = Command::new("tar")
        .args([
            "-xzf",
            archive_path.to_string_lossy().as_ref(),
            "-C",
            install_dir.to_string_lossy().as_ref(),
            "--strip-components=1",
        ])
        .status();

    let _ = fs::remove_file(&archive_path);

    match extract_result {
        Ok(status) if status.success() => {
            println!("✅ Node.js installed successfully");
            set_downloading_node(false);
            Some(node_exe.to_string_lossy().to_string())
        }
        _ => {
            let msg = "Failed to extract Node.js archive. Please check disk space and permissions."
                .to_string();
            eprintln!("❌ {}", msg);
            set_startup_error(msg);
            set_downloading_node(false);
            None
        }
    }
}

/// Download and install Node.js (Windows)
#[cfg(all(not(debug_assertions), target_os = "windows"))]
pub fn download_and_install_node(home: &str) -> Option<String> {
    use std::fs;

    set_downloading_node(true);

    let env_home = home.to_string();
    let install_dir = PathBuf::from(&env_home).join(".openloomi").join("node");
    let node_exe = install_dir.join("node.exe");

    if node_exe.exists() {
        set_downloading_node(false);
        return Some(node_exe.to_string_lossy().to_string());
    }

    if let Err(e) = fs::create_dir_all(&install_dir) {
        eprintln!("❌ Failed to create node install directory: {}", e);
        set_downloading_node(false);
        return None;
    }

    let url = "https://nodejs.org/dist/v22.17.0/node-v22.17.0-win-x64.zip";
    let archive_name = "node-v22.17.0-win-x64.zip";

    println!("📥 Downloading Node.js from {}", url);

    let temp_dir = std::env::temp_dir();
    let archive_path = temp_dir.join(archive_name);

    let client = reqwest::blocking::Client::new();
    let response = client.get(url).send();

    match response {
        Ok(mut resp) => {
            let mut file = match fs::File::create(&archive_path) {
                Ok(f) => f,
                Err(e) => {
                    let msg = format!("Failed to create archive file: {}", e);
                    eprintln!("❌ {}", msg);
                    set_startup_error(msg);
                    set_downloading_node(false);
                    return None;
                }
            };
            if let Err(e) = std::io::copy(&mut resp, &mut file) {
                let msg = format!("Failed to write downloaded file: {}", e);
                eprintln!("❌ {}", msg);
                let _ = fs::remove_file(&archive_path);
                set_startup_error(msg);
                set_downloading_node(false);
                return None;
            }
        }
        Err(e) => {
            let msg = format!(
                "Failed to download Node.js: {}. Possible causes: network unreachable, proxy blocked, or SSL/TLS error.",
                e
            );
            eprintln!("❌ {}", msg);
            set_startup_error(msg);
            set_downloading_node(false);
            return None;
        }
    }

    println!("📦 Extracting Node.js...");

    // Extract to install_dir (creates node-v22.17.0-win-x64/ subfolder)
    // Use -ExecutionPolicy Bypass to avoid PowerShell execution policy restrictions
    let extract_result = Command::new("powershell")
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
        .output();

    let _ = fs::remove_file(&archive_path);

    match extract_result {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let msg = format!(
                    "PowerShell extraction failed (exit {}). Try: Open PowerShell as Admin > Set-ExecutionPolicy RemoteSigned. Details: {}",
                    output.status, stderr.trim()
                );
                eprintln!("❌ {}", msg);
                set_startup_error(msg);
                set_downloading_node(false);
                return None;
            }
            // After extraction: install_dir/node-v22.17.0-win-x64/node.exe
            let extracted_dir = install_dir.join("node-v22.17.0-win-x64");
            let extracted_node = extracted_dir.join("node.exe");
            if extracted_node.exists() {
                // Move node.exe up to install_dir
                if let Err(e) = fs::rename(&extracted_node, &node_exe) {
                    eprintln!("⚠️  Move failed ({}), trying copy fallback", e);
                    if let Err(e2) = fs::copy(&extracted_node, &node_exe) {
                        let msg = format!("Failed to copy node.exe: {}", e2);
                        eprintln!("❌ {}", msg);
                        set_startup_error(msg);
                        set_downloading_node(false);
                        return None;
                    }
                    let _ = fs::remove_file(&extracted_node);
                }
                // Clean up empty subfolder
                let _ = fs::remove_dir(&extracted_dir);
                println!("✅ Node.js installed successfully");
                set_downloading_node(false);
                Some(node_exe.to_string_lossy().to_string())
            } else {
                let msg = "node.exe not found after extraction. The zip structure may be different from expected.".to_string();
                eprintln!("❌ {}", msg);
                set_startup_error(msg);
                set_downloading_node(false);
                None
            }
        }
        Err(e) => {
            let msg = format!(
                "Failed to run PowerShell: {}. Try running PowerShell as Administrator.",
                e
            );
            eprintln!("❌ {}", msg);
            set_startup_error(msg);
            set_downloading_node(false);
            return None;
        }
    }
}

/// Get render engine paths (soffice and pdftoppm)
/// Returns (soffice_path, pdftoppm_path) tuple if found
fn get_packaged_render_engine_paths(
    resource_dir: &std::path::Path,
) -> (Option<String>, Option<String>) {
    let (downloaded_soffice, downloaded_pdftoppm) =
        crate::render_runtime::get_installed_render_runtime_paths();
    if downloaded_soffice.is_some() || downloaded_pdftoppm.is_some() {
        return (downloaded_soffice, downloaded_pdftoppm);
    }

    let platform_dir = crate::runtime_components::get_platform_dir();
    let engine_dir = [
        resource_dir
            .join("resources")
            .join("render-engine")
            .join(&platform_dir),
        resource_dir.join("render-engine").join(&platform_dir),
    ]
    .into_iter()
    .find(|path| path.exists())
    .unwrap_or_else(|| resource_dir.join("render-engine").join(&platform_dir));

    // Find soffice
    let soffice_path = [
        engine_dir.join("soffice"),
        engine_dir
            .join("LibreOffice.app")
            .join("Contents")
            .join("MacOS")
            .join("soffice"),
        engine_dir.join("program").join("soffice"),
        engine_dir.join("program").join("soffice.exe"),
        engine_dir
            .join("libreoffice-msi")
            .join("program")
            .join("soffice.exe"),
        engine_dir.join("soffice.exe"),
    ]
    .into_iter()
    .find(|path| path.exists())
    .map(|path| path.to_string_lossy().to_string());

    // Find pdftoppm
    let pdftoppm_path = [
        engine_dir.join("pdftoppm"),
        engine_dir.join("bin").join("pdftoppm"),
        engine_dir.join("pdftoppm.exe"),
        engine_dir.join("bin").join("pdftoppm.exe"),
    ]
    .into_iter()
    .find(|path| path.exists())
    .map(|path| path.to_string_lossy().to_string());

    (soffice_path, pdftoppm_path)
}

/// Attempt to start Next.js server with the given Node.js binary
#[cfg(not(debug_assertions))]
pub fn try_start_nextjs(
    node_cmd: &str,
    server_script: &std::path::Path,
    work_dir: &std::path::Path,
    db_path: &str,
    env_home: &str,
    env_path: &str,
    env_user: &str,
    env_shell: &str,
    code_tmpdir: &str,
    packaged_soffice_bin: Option<&str>,
    packaged_pdftoppm_bin: Option<&str>,
) -> Result<(), String> {
    use std::fs;
    use std::io::Write;
    use std::process::Stdio;

    // Initialize database before starting Next.js
    let init_db_script = work_dir
        .join("apps")
        .join("web")
        .join("scripts")
        .join("init-db.cjs");
    let migrations_dir = work_dir
        .join("apps")
        .join("web")
        .join("lib")
        .join("db")
        .join("migrations-sqlite");

    if init_db_script.exists() {
        println!("🔄 Initializing database...");
        let mut cmd = Command::new(node_cmd);
        cmd.arg(&init_db_script)
            .env("TAURI_DB_PATH", db_path)
            .env(
                "TAURI_MIGRATIONS_DIR",
                migrations_dir.to_string_lossy().to_string(),
            )
            .env("HOME", env_home)
            .current_dir(work_dir.join("apps").join("web"))
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let db_init_result = cmd.status();

        match db_init_result {
            Ok(status) => {
                if status.success() {
                    println!("✅ Database initialized successfully");
                } else {
                    eprintln!("⚠️  Database initialization failed with status: {}", status);
                }
            }
            Err(e) => {
                eprintln!("⚠️  Failed to run database initialization: {}", e);
            }
        }
    }

    // If node_cmd contains .openloomi, prepend its directory to PATH
    let effective_path = if node_cmd.contains(".openloomi") {
        if let Some(node_dir) = std::path::Path::new(node_cmd).parent() {
            let node_dir_str = node_dir.to_string_lossy().to_string();
            // Use semicolon on Windows, colon on Unix
            if cfg!(windows) {
                format!("{};{}", node_dir_str, env_path)
            } else {
                format!("{}:{}", node_dir_str, env_path)
            }
        } else {
            env_path.to_string()
        }
    } else {
        env_path.to_string()
    };

    // Double-base64 encoded secrets (format: base64(base64(value)))
    let encoded_secrets: Vec<(&str, &str)> = vec![
        (
            "AUTH_SECRET",
            "V1ZONU5ISnFaMnc1SzFaNllYWmlWRkp4UmxSU1lscGtOR0ZOYld4eWVIb3dXbXhVUmtaQ2VGSnFVVDA9",
        ),
        (
            "ENCRYPTION_KEY",
            "V1ZONU5ISnFaMnc1SzFaNllYWmlWRkp4UmxSU1lscGtOR0ZOYld4eWVIb3dXbXhVUmtaQ2VGSnFVVDA9",
        ),
    ];

    let decode_double_base64 = |encoded: &str| -> Option<String> {
        let first = base64_decode(encoded).ok()?;
        String::from_utf8(first)
            .ok()
            .and_then(|s| base64_decode(&s).ok())
            .and_then(|b| String::from_utf8(b).ok())
    };

    let secrets: std::collections::HashMap<String, String> = encoded_secrets
        .iter()
        .filter_map(|(key, encoded)| {
            decode_double_base64(encoded).map(|value| (key.to_string(), value))
        })
        .collect();

    let secrets_json = serde_json::to_string(&secrets).unwrap_or_default();

    let boot_script = work_dir
        .join("apps")
        .join("web")
        .join("scripts")
        .join("boot-with-secrets.js");

    let mut binding = Command::new(node_cmd);
    #[cfg(target_os = "windows")]
    let cmd = binding.creation_flags(CREATE_NO_WINDOW);
    #[cfg(not(target_os = "windows"))]
    let mut cmd = binding;
    let cmd = cmd
        .arg(&boot_script)
        .arg(server_script)
        .current_dir(work_dir)
        .env("PATH", effective_path)
        .env("HOME", env_home)
        .env("USER", env_user)
        .env("SHELL", env_shell)
        .env("NODE_ENV", "production")
        // Force single-worker mode so whatsappClientRegistry and activeAdapters are shared
        // across all API requests (module-level singletons are not shared across cluster workers).
        .env("WORKERS", "1")
        .env("PORT", "3414")
        .env("IS_TAURI", "true")
        .env("TAURI_MODE", "1")
        .env("DEPLOYMENT_MODE", "tauri")
        .env("TAURI_DB_PATH", db_path)
        .env("NEXTAUTH_URL", "http://localhost:3414")
        .env("NEXT_PUBLIC_APP_URL", "http://localhost:3414")
        .env("LLM_BASE_URL", "https://openrouter.ai/api/v1")
        .env("LLM_MODEL", "google/gemini-3-flash-preview")
        .env("LLM_VISION_LANGUAGE_MODEL", "google/gemini-3-flash-preview")
        .env("LLM_IMAGE_MODEL", "openai/gpt-5-image")
        .env("LLM_EMBEDDING_MODEL", "qwen/qwen3-embedding-4b")
        .env("LLM_EMBEDDING_BASE_URL", "https://openrouter.ai/api/v1")
        .env("API_TIMEOUT_MS", "3000000")
        .env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1")
        .env("CLAUDE_CODE_TMPDIR", code_tmpdir)
        .env("CLAUDE_DISABLE_URL_SAFETY_CHECK", "true")
        .stdin(Stdio::piped())
        .stdout(Stdio::inherit())
        .stderr(Stdio::piped());

    // Set high-fidelity runtime paths if available
    let cmd = if let Some(soffice_bin) = packaged_soffice_bin {
        if let Some(pdftoppm_bin) = packaged_pdftoppm_bin {
            println!("📂 Using render engine: soffice={}", soffice_bin);
            println!("📂 Using render engine: pdftoppm={}", pdftoppm_bin);
            cmd.env("SOFFICE_BIN", soffice_bin)
                .env("PDFTOPPM_BIN", pdftoppm_bin)
        } else {
            cmd
        }
    } else {
        cmd
    };
    #[cfg(unix)]
    cmd.process_group(0);

    // Capture stderr to a temp file so we can read error output on failure
    let stderr_path = std::env::temp_dir().join("openloomi_node_stderr.log");
    let stderr_file = match fs::File::create(&stderr_path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("❌ Failed to create stderr capture file: {}", e);
            return Err(format!("Failed to create stderr file: {}", e));
        }
    };

    match cmd.stderr(Stdio::from(stderr_file)).spawn() {
        Ok(mut child) => {
            let node_pid = child.id();

            // Write secrets to stdin
            if let Some(mut stdin) = child.stdin.take() {
                if let Err(e) = stdin.write_all(secrets_json.as_bytes()) {
                    eprintln!("❌ Failed to write secrets to stdin: {}", e);
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("Failed to write stdin: {}", e));
                }
                // Dropping stdin sends EOF so boot-with-secrets.js can start server.js.
            }

            // Store child globally so we can clean it up later
            let mut guard = lock_recovered(NODEJS_PROCESS.as_ref(), "store node process handle");
            *guard = Some(child);
            drop(guard);

            println!("✅ Node.js process spawned with secrets via stdin");
            println!("📄 Capturing stderr to: {:?}", stderr_path);

            // Spawn a background thread to monitor child exit and capture stderr
            let stderr_path_clone = stderr_path.clone();
            let node_process = NODEJS_PROCESS.clone();
            thread::spawn(move || {
                if let Err(error) = catch_unwind_str("node process monitor thread", || {
                    let status = loop {
                        thread::sleep(Duration::from_secs(1));

                        let poll_result = {
                            let mut guard = lock_recovered(
                                node_process.as_ref(),
                                "monitor node process handle",
                            );
                            let Some(child) = guard.as_mut() else {
                                let _ = fs::remove_file(&stderr_path_clone);
                                return;
                            };
                            if child.id() != node_pid {
                                let _ = fs::remove_file(&stderr_path_clone);
                                return;
                            };
                            child.try_wait()
                        };

                        match poll_result {
                            Ok(Some(status)) => break status,
                            Ok(None) => continue,
                            Err(e) => {
                                eprintln!("⚠️  Failed to poll Node.js process: {}", e);
                                let _ = fs::remove_file(&stderr_path_clone);
                                return;
                            }
                        }
                    };

                    let exit_code: Option<i32> = status.code();
                    println!("⚠️  Node.js process exited with status: {:?}", exit_code);

                    // If the server was running (NEXTJS_STARTED was true), emit crash event
                    if NEXTJS_STARTED.load(Ordering::SeqCst) {
                        NEXTJS_STARTED.store(false, Ordering::SeqCst);
                        let msg = if let Some(code) = exit_code {
                            format!("Server crashed with exit code: {}", code)
                        } else {
                            "Server process exited unexpectedly".to_string()
                        };
                        emit_crash_event(&msg);
                    }

                    // Read captured stderr
                    let stderr_content = if let Ok(content) = fs::read_to_string(&stderr_path_clone)
                    {
                        content.trim().to_string()
                    } else {
                        String::new()
                    };

                    // Store for later retrieval
                    let mut exit_guard = lock_recovered(&NODEJS_EXIT_CODE, "store node exit code");
                    *exit_guard = exit_code;
                    drop(exit_guard);
                    let stderr_is_empty = stderr_content.is_empty();
                    // Log the exit details (must happen before moving stderr_content)
                    if !stderr_is_empty {
                        eprintln!("═══ Node.js stderr ═══");
                        for line in stderr_content.lines().take(20) {
                            eprintln!("  {}", line);
                        }
                        eprintln!("═════════════════════");
                    }

                    // Store for later retrieval
                    let mut stderr_guard = lock_recovered(&NODEJS_STDERR, "store node stderr");
                    *stderr_guard = if stderr_is_empty {
                        None
                    } else {
                        Some(stderr_content)
                    };
                    drop(stderr_guard);
                    if let Some(code) = exit_code {
                        eprintln!("Exit code: {}", code);
                    }

                    // Clean up stderr temp file
                    let _ = fs::remove_file(&stderr_path_clone);
                }) {
                    eprintln!(
                        "⚠️  Node.js process monitor stopped unexpectedly: {}",
                        error
                    );
                }
            });

            Ok(())
        }
        Err(e) => {
            eprintln!("❌ Failed to spawn Node.js process: {}", e);
            let _ = fs::remove_file(&stderr_path);
            Err(e.to_string())
        }
    }
}

/// Start Next.js server in production mode (spawns a background thread)
#[cfg(not(debug_assertions))]
pub fn start_nextjs_server() {
    // Prevent concurrent startup attempts
    if STARTUP_IN_PROGRESS
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::Relaxed)
        .is_err()
    {
        println!("⚠️  Startup already in progress, skipping");
        return;
    }

    println!("🚀 Starting Next.js server in production mode...");

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
    .unwrap_or(resource_dir.clone());

    println!("📂 Resource directory: {:?}", resource_dir);

    // standalone dir: Resources/_up_/.next/standalone/apps/web/server.js
    let standalone_dir = resource_dir.join("_up_").join(".next").join("standalone");
    let server_script = standalone_dir.join("apps").join("web").join("server.js");

    if !server_script.exists() {
        let msg = format!(
            "Next.js server not found at: {:?}. \
            This may happen if the app was moved after installation. \
            Please reinstall openloomi from openloomi.ai",
            server_script
        );
        eprintln!("❌ {}", msg);
        set_startup_error(msg);
        NEXTJS_STARTED.store(false, Ordering::SeqCst);
        STARTUP_IN_PROGRESS.store(false, Ordering::SeqCst);
        return;
    }

    println!("📦 Found Next.js server at: {:?}", server_script);

    let work_dir = standalone_dir;
    println!("📂 Working directory: {:?}", work_dir);
    let packaged_render_engine = get_packaged_render_engine_paths(&resource_dir);
    if let (Some(ref soffice_bin), Some(ref pdftoppm_bin)) = packaged_render_engine {
        println!("📦 Using bundled high-fidelity runtime");
        println!("   soffice: {}", soffice_bin);
        println!("   pdftoppm: {}", pdftoppm_bin);
    } else {
        println!("⚠️  No bundled high-fidelity runtime found in app resources");
    }

    let mut env_path = std::env::var("PATH").unwrap_or_default();

    #[cfg(unix)]
    let env_home = std::env::var("HOME").unwrap_or_default();
    #[cfg(windows)]
    let env_home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("APPDATA").map(|s| s))
        .unwrap_or_default();

    #[cfg(unix)]
    {
        let pnpm_path = format!("{}/Library/pnpm", env_home);
        let nvm_path = format!("{}/.nvm/versions/node/v22.17.0/bin", env_home);
        let local_bin = format!("{}/.local/bin", env_home);
        let openloomi_node_path = format!("{}/.openloomi/node/bin", env_home);
        let fnm_shims = format!("{}/.local/share/fnm/shims", env_home);
        let fnm_installation_bin = format!(
            "{}/.local/share/fnm/node-versions/v22.17.0/installation/bin",
            env_home
        );

        let extra_paths = vec![
            pnpm_path,
            nvm_path,
            local_bin,
            openloomi_node_path,
            fnm_shims,
            fnm_installation_bin,
        ];
        let extra_path_str: String = extra_paths
            .iter()
            .filter(|p| std::path::Path::new(p).exists())
            .map(|p| p.as_str())
            .collect::<Vec<_>>()
            .join(":");

        if !extra_path_str.is_empty() {
            env_path = format!("{}:{}", extra_path_str, env_path);
        }
    }

    #[cfg(windows)]
    {
        let openloomi_node_dir = format!(r"{}\.openloomi\node", env_home);
        let nvm_dir = format!(r"{}\AppData\Roaming\nvm\v22.17.0", env_home);
        let scoop_shims = format!(r"{}\scoop\shims", env_home);
        let npm_global = format!(r"{}\AppData\Roaming\npm", env_home);
        let prog_files = r"C:\Program Files\nodejs".to_string();
        let prog_files_x86 = r"C:\Program Files (x86)\nodejs".to_string();

        let extra_paths = vec![
            openloomi_node_dir,
            nvm_dir,
            scoop_shims,
            npm_global,
            prog_files,
            prog_files_x86,
        ];
        let extra_path_str: String = extra_paths
            .iter()
            .filter(|p| std::path::Path::new(p).exists())
            .map(|p| p.as_str())
            .collect::<Vec<_>>()
            .join(";");

        if !extra_path_str.is_empty() {
            env_path = format!("{};{}", extra_path_str, env_path);
        }
    }

    let env_user = std::env::var("USER").unwrap_or_default();
    let env_shell = std::env::var("SHELL").unwrap_or_default();
    let data_dir = crate::storage::get_data_dir();
    let db_path = data_dir.join("data.db");
    let env_home_path = PathBuf::from(&env_home);
    let code_tmpdir = env_home_path.join(".cache").join("openloomi-tmp");

    let db_path_str = db_path.to_string_lossy().to_string();
    let code_tmpdir_str = code_tmpdir.to_string_lossy().to_string();

    // Get render engine paths for soffice and pdftoppm
    let (soffice_path, pdftoppm_path) = get_packaged_render_engine_paths(&resource_dir);
    if soffice_path.is_some() || pdftoppm_path.is_some() {
        println!(
            "📂 Render engine found: soffice={:?}, pdftoppm={:?}",
            soffice_path, pdftoppm_path
        );
    } else {
        println!("📂 No render engine found, PPTX preview will use client-side rendering");
    }

    println!("📍 Environment variables being passed to Node.js:");

    thread::spawn(move || {
        if let Err(error) = catch_unwind_str("start_nextjs_server thread", || {
            println!("⏳ Spawning Node.js process...");

            let mut node_candidates: Vec<(&str, String)> = Vec::new();

            println!("🔍 Searching for system Node.js...");
            #[cfg(all(not(debug_assertions), unix))]
            if let Some(system_node) = find_system_node(&env_home) {
                println!("✅ Found system Node.js at: {}", system_node);
                node_candidates.push(("system", system_node));
            } else {
                println!("⚠️  No system Node.js found in PATH, will try downloaded...");
            }
            #[cfg(all(not(debug_assertions), windows))]
            if let Some(system_node) = find_system_node(&env_home) {
                println!("✅ Found system Node.js at: {}", system_node);
                node_candidates.push(("system", system_node));
            } else {
                println!("⚠️  No system Node.js found in PATH, will try downloaded...");
            }

            // Always attempt downloaded Node.js as fallback — even if a system node was found,
            // it may be broken (shell wrapper, broken symlink). The loop over node_candidates
            // will try system first, then downloaded.
            #[cfg(all(
                not(debug_assertions),
                any(target_os = "macos", target_os = "linux", target_os = "windows")
            ))]
            if let Some(downloaded) = download_and_install_node(&env_home) {
                println!("📦 Downloaded Node.js at: {}", downloaded);
                node_candidates.push(("downloaded", downloaded));
            }

            if node_candidates.is_empty() {
                eprintln!("❌ No Node.js available!");
                set_startup_error(
                    "No Node.js available. Please install Node.js v22.17.0 or higher. Download: https://nodejs.org".to_string(),
                );
                NEXTJS_STARTED.store(false, Ordering::SeqCst);
                STARTUP_IN_PROGRESS.store(false, Ordering::SeqCst);
                return;
            }

            let mut last_error = String::new();
            let mut success = false;

            for (node_type, node_path) in &node_candidates {
                println!("🔄 Trying {} Node.js at: {}", node_type, node_path);

                cleanup_port(3414);

                match try_start_nextjs(
                    node_path,
                    &server_script,
                    &work_dir,
                    &db_path_str,
                    &env_home,
                    &env_path,
                    &env_user,
                    &env_shell,
                    &code_tmpdir_str,
                    soffice_path.as_deref(),
                    pdftoppm_path.as_deref(),
                ) {
                    Ok(_) => {
                        println!("⏳ Waiting for server to be ready...");
                        let mut server_ready = false;
                        let mut crashed = false;
                        let mut crash_stderr = String::new();
                        let mut crash_exit_code: Option<i32> = None;

                        for i in 0..5 {
                            thread::sleep(Duration::from_secs(2));

                            // Check if the child process is still running
                            let child_died = {
                                let mut guard =
                                    lock_recovered(NODEJS_PROCESS.as_ref(), "check node process");
                                if let Some(ref mut child) = *guard {
                                    match child.try_wait() {
                                        Ok(Some(_)) => true,
                                        Ok(None) => false,
                                        Err(error) => {
                                            eprintln!(
                                                "⚠️  Failed to poll Node.js during startup: {}",
                                                error
                                            );
                                            false
                                        }
                                    }
                                } else {
                                    false
                                }
                            };

                            if child_died {
                                println!("⚠️  Node.js process crashed during startup!");
                                crashed = true;
                                // Read captured stderr and exit code
                                crash_stderr =
                                    lock_recovered(&NODEJS_STDERR, "read startup node stderr")
                                        .clone()
                                        .unwrap_or_default();
                                crash_exit_code = *lock_recovered(
                                    &NODEJS_EXIT_CODE,
                                    "read startup node exit code",
                                );
                                break;
                            }

                            use std::net::TcpStream;
                            if TcpStream::connect("127.0.0.1:3414").is_ok() {
                                println!("✅ Server is ready on port 3414!");
                                server_ready = true;
                                break;
                            }
                            println!("⏳ Waiting for server... ({}s)", (i + 1) * 2);
                        }

                        if server_ready {
                            println!("✅ Server started successfully with {} Node.js!", node_type);
                            success = true;
                            break;
                        } else if crashed {
                            // Node.js crashed — surface the detailed error
                            let stderr_snippet = if crash_stderr.is_empty() {
                                String::new()
                            } else {
                                let lines: Vec<&str> = crash_stderr.lines().take(10).collect();
                                let snippet = lines.join("; ");
                                format!(" stderr: {}", snippet)
                            };
                            let exit_info = crash_exit_code
                                .map(|c| format!(" (exit code: {})", c))
                                .unwrap_or_default();
                            last_error = format!(
                                "{} Node.js crashed during startup{}: {}{}",
                                node_type,
                                exit_info,
                                crash_stderr
                                    .lines()
                                    .next()
                                    .unwrap_or("unknown error")
                                    .trim(),
                                if crash_stderr.lines().count() > 1 {
                                    " [see logs]"
                                } else {
                                    ""
                                }
                            );
                            eprintln!("⚠️  {}", last_error);
                            cleanup_port(3414);
                            continue;
                        } else {
                            last_error =
                                format!("{} Node.js started but server not listening", node_type);
                            eprintln!("⚠️  Server not responding on port 3414");
                            cleanup_port(3414);
                            continue;
                        }
                    }
                    Err(e) => {
                        last_error = format!("{} Node.js failed: {}", node_type, e);
                        eprintln!("⚠️  {} Node.js failed to start: {}", node_type, e);
                        cleanup_port(3414);
                        continue;
                    }
                }
            }

            if success {
                NEXTJS_STARTED.store(true, Ordering::SeqCst);
                STARTUP_IN_PROGRESS.store(false, Ordering::SeqCst);
                emit_server_status_event("running");

                // Spawn watchdog thread to monitor process health
                spawn_watchdog_thread();
            } else {
                NEXTJS_STARTED.store(false, Ordering::SeqCst);
                STARTUP_IN_PROGRESS.store(false, Ordering::SeqCst);
                eprintln!(
                    "❌ All Node.js candidates failed. Last error: {}",
                    last_error
                );
                // Build a detailed error message for the frontend
                let mut frontend_error = last_error.clone();

                // Append captured stderr if available
                let stderr_guard = lock_recovered(&NODEJS_STDERR, "read final startup node stderr");
                if let Some(ref stderr) = *stderr_guard {
                    if !stderr.is_empty() {
                        let lines: Vec<&str> = stderr.lines().take(5).collect();
                        let snippet = lines.join(" | ");
                        frontend_error = format!(
                            "{} | Node.js error: {}",
                            frontend_error.trim_end_matches(|c| c == '.' || c == ' '),
                            snippet
                        );
                    }
                }
                drop(stderr_guard);

                // Append exit code if available
                let exit_code =
                    *lock_recovered(&NODEJS_EXIT_CODE, "read final startup node exit code");
                if let Some(code) = exit_code {
                    frontend_error = format!("{} (exit code: {})", frontend_error, code);
                }

                set_startup_error(format!(
                    "{} | Download Node.js: https://nodejs.org",
                    frontend_error
                ));
            }
        }) {
            eprintln!("❌ Node.js startup stopped unexpectedly: {}", error);
            NEXTJS_STARTED.store(false, Ordering::SeqCst);
            STARTUP_IN_PROGRESS.store(false, Ordering::SeqCst);
            cleanup_nodejs_process();
            set_startup_error(error);
        }
    });
}

/// Kill any process occupying the given port
pub fn cleanup_port(port: u16) {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let output = Command::new("lsof")
            .args(["-ti", &format!(":{}", port)])
            .output();

        if let Ok(output) = output {
            if !output.stdout.is_empty() {
                let pids = String::from_utf8_lossy(&output.stdout);
                for pid in pids.lines().filter(|l| !l.is_empty()) {
                    let pid = pid.trim();
                    let _ = std::process::Command::new("/bin/kill")
                        .arg("-15")
                        .arg(pid)
                        .spawn();

                    thread::sleep(Duration::from_millis(500));

                    let check_output = Command::new("lsof")
                        .args(["-ti", &format!(":{}", port)])
                        .output();
                    if let Ok(check_output) = check_output {
                        if !check_output.stdout.is_empty() {
                            let still_running = String::from_utf8_lossy(&check_output.stdout);
                            if still_running.lines().any(|l| l.trim() == pid) {
                                println!("🔨 Force killing process {} on port {}", pid, port);
                                let _ = Command::new("kill").args(["-9", pid]).status();
                            }
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        let _ = Command::new("fuser")
            .args(["-k", &format!("{}/tcp", port)])
            .status();
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        if let Ok(output) = Command::new("netstat").args(["-ano", "-p", "TCP"]).output() {
            let output_str = String::from_utf8_lossy(&output.stdout);
            for line in output_str.lines() {
                if line.contains("LISTENING") && line.contains(&format!(":{}", port)) {
                    if let Some(pid) = line.split_whitespace().last() {
                        println!("🔨 Killing process {} on port {}", pid, port);
                        let _ = Command::new("taskkill").args(["/F", "/PID", pid]).status();
                    }
                }
            }
        }
    }
}

/// Clean up the Node.js child process
pub fn cleanup_nodejs_process() {
    let Some(_cleanup_guard) =
        CleanupFlagGuard::try_enter("🧹 Cleanup already in progress, skipping...")
    else {
        return;
    };

    println!("🧹 Cleaning up Node.js process...");

    let child = {
        let mut guard = lock_recovered(NODEJS_PROCESS.as_ref(), "cleanup node process handle");
        guard.take()
    };

    if let Some(mut child) = child {
        terminate_node_child(&mut child);
    }

    cleanup_port(3414);

    println!("✅ Cleanup completed");
}

fn terminate_node_pid(pid: u32) {
    println!("🔨 Terminating Node.js process via PID ({:?})...", pid);
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-15", &format!("-{}", pid)])
            .status();
        let _ = Command::new("kill")
            .args(["-15", &pid.to_string()])
            .status();
        thread::sleep(Duration::from_millis(500));
        let _ = Command::new("kill")
            .args(["-9", &format!("-{}", pid)])
            .status();
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &format!("{}", pid)])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
}

fn terminate_node_child(child: &mut Child) {
    let pid = child.id();
    println!(
        "🔨 Terminating Node.js process via handle (PID: {:?})...",
        pid
    );
    match child.try_wait() {
        Ok(Some(_)) => return,
        Ok(None) => {}
        Err(error) => {
            eprintln!("⚠️  Skipping Node.js PID termination after wait check failed: {error}");
            return;
        }
    }
    // Only signal a PID while it is still backed by this Child handle.
    terminate_node_pid(pid);
    let _ = child.kill();
    let _ = child.wait();
}

fn terminate_node_pid_from_panic_hook(pid: u32) {
    #[cfg(unix)]
    {
        let pid = pid as libc::pid_t;
        unsafe {
            // SAFETY: kill only reads the pid/signal values. Errors are ignored
            // because this panic-hook path is best-effort and must not block.
            let _ = libc::kill(-pid, libc::SIGKILL);
            let _ = libc::kill(pid, libc::SIGKILL);
        }
    }

    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &format!("{}", pid)])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }

    #[cfg(not(any(unix, target_os = "windows")))]
    {
        let _ = pid;
    }
}

fn terminate_node_child_from_panic_hook(child: &mut Child) {
    let pid = child.id();
    println!(
        "🔨 Terminating Node.js process from panic hook (PID: {:?})...",
        pid
    );
    match child.try_wait() {
        Ok(Some(_)) => return,
        Ok(None) => {}
        Err(error) => {
            eprintln!(
                "⚠️  Skipping panic-hook Node.js PID termination after wait check failed: {error}"
            );
            return;
        }
    }
    // Avoid a global PID fallback here; a reaped PID can be reused.
    terminate_node_pid_from_panic_hook(pid);
    let _ = child.kill();
}

fn take_node_child_from_panic_hook() -> Option<Child> {
    const MAX_ATTEMPTS: usize = 50;

    for attempt in 0..MAX_ATTEMPTS {
        match NODEJS_PROCESS.as_ref().try_lock() {
            Ok(mut guard) => return guard.take(),
            Err(TryLockError::Poisoned(poisoned)) => {
                let mut guard = poisoned.into_inner();
                return guard.take();
            }
            Err(TryLockError::WouldBlock) => {
                if attempt + 1 == MAX_ATTEMPTS {
                    eprintln!(
                        "⚠️  Skipping Node.js handle cleanup during panic; handle lock stayed busy"
                    );
                    return None;
                }
                thread::sleep(Duration::from_millis(1));
            }
        }
    }

    None
}

/// Best-effort cleanup from the panic hook.
///
/// The panic hook can run while the panicking thread still holds
/// `NODEJS_PROCESS`, so only wait briefly for transient monitor contention and
/// avoid unbounded mutex waits, child waits, or port scans.
pub fn cleanup_nodejs_process_from_panic_hook() {
    let Some(_cleanup_guard) = CleanupFlagGuard::try_enter(
        "🧹 Cleanup already in progress, skipping panic-hook cleanup...",
    ) else {
        return;
    };

    println!("🧹 Cleaning up Node.js process from panic hook...");

    if let Some(mut child) = take_node_child_from_panic_hook() {
        terminate_node_child_from_panic_hook(&mut child);
    }

    println!("✅ Panic-hook cleanup completed");
}

/// Clean up any residual processes before starting
pub fn cleanup_before_start() {
    println!("🔍 Checking for existing processes on port 3414...");
    cleanup_port(3414);
}

/// Server status returned to the frontend
#[derive(serde::Serialize, Clone)]
pub struct ServerStatus {
    pub running: bool,
    pub status: String,
    pub error_message: Option<String>,
    pub node_version: Option<String>,
}

/// Get current server status
#[tauri::command]
pub fn get_server_status() -> ServerStatus {
    catch_unwind_str("get_server_status", || {
        #[cfg(not(debug_assertions))]
        {
            let running = NEXTJS_STARTED.load(Ordering::SeqCst);
            let error_message = get_startup_error();
            let downloading = is_downloading_node();

            let status = if running {
                "running".to_string()
            } else if downloading {
                "downloading".to_string()
            } else if error_message.is_some() {
                "error".to_string()
            } else {
                // Use last recorded status (may be "crashed" or "starting")
                lock_recovered(&LAST_SERVER_STATUS, "read last server status").clone()
            };

            ServerStatus {
                running,
                status,
                error_message,
                node_version: get_node_version(),
            }
        }

        #[cfg(debug_assertions)]
        {
            ServerStatus {
                running: true,
                status: "running".to_string(),
                error_message: None,
                node_version: None,
            }
        }
    })
    .unwrap_or_else(|error| ServerStatus {
        running: false,
        status: "error".to_string(),
        error_message: Some(error),
        node_version: None,
    })
}

/// Restart the Next.js server
#[tauri::command]
#[cfg(not(debug_assertions))]
pub fn restart_server() -> Result<(), String> {
    crate::panic_guard::catch_unwind_result("restart_server", || {
        println!("🔄 Restarting Next.js server...");

        // Reset error state
        let mut guard = lock_recovered(&STARTUP_ERROR, "clear startup error");
        *guard = None;
        drop(guard);

        // Reset the started flag
        NEXTJS_STARTED.store(false, Ordering::SeqCst);

        // Emit starting status
        emit_server_status_event("starting");

        // Clean up existing process
        cleanup_nodejs_process();

        // Restart the server (start_nextjs_server has its own STARTUP_IN_PROGRESS guard)
        start_nextjs_server();

        Ok(())
    })
}

#[cfg(debug_assertions)]
#[tauri::command]
pub fn restart_server() -> Result<(), String> {
    crate::panic_guard::catch_unwind_result("restart_server", || Ok(()))
}
