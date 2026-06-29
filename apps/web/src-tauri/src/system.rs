// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

//! System module — file operations, path utilities, and platform-specific commands.

use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{RecvTimeoutError, SyncSender};
use std::thread::JoinHandle;
use std::time::Duration;
use tauri::{Emitter, Manager};

use crate::panic_guard::{
    catch_unwind_result, catch_unwind_str, flatten_spawn_result, lock_recovered,
};

// ============ Global Shortcut ============

use device_query::{DeviceQuery, DeviceState, Keycode};
use std::str::FromStr;
use std::sync::Mutex;

/// Global shortcut state
static REGISTERED_SHORTCUTS: std::sync::LazyLock<Mutex<Vec<String>>> =
    std::sync::LazyLock::new(|| Mutex::new(Vec::new()));
static ENTER_LISTENER_RUNNING: std::sync::LazyLock<AtomicBool> =
    std::sync::LazyLock::new(|| AtomicBool::new(false));
static ENTER_LISTENER_HANDLE: std::sync::LazyLock<Mutex<Option<JoinHandle<()>>>> =
    std::sync::LazyLock::new(|| Mutex::new(None));
static LAST_ENTER_TRIGGER_MS: std::sync::LazyLock<AtomicU64> =
    std::sync::LazyLock::new(|| AtomicU64::new(0));
const ENTER_TRIGGER_DEBOUNCE_MS: u64 = 5000;

/// Event payload for screen capture shortcut
#[derive(Clone, serde::Serialize)]
struct ScreenCaptureEvent {
    shortcut: String,
    state: String,
}

const ACCESSIBILITY_REQUIRED_MSG: &str = "Accessibility permission is required for the global capture shortcut. Enable openloomi under System Settings → Privacy & Security → Accessibility.";
const LISTENER_READY_TIMEOUT: Duration = Duration::from_secs(2);

fn stop_screen_capture_listener() {
    ENTER_LISTENER_RUNNING.store(false, Ordering::SeqCst);
    LAST_ENTER_TRIGGER_MS.store(0, Ordering::SeqCst);
    if let Some(handle) =
        lock_recovered(&ENTER_LISTENER_HANDLE, "stop screen capture listener").take()
    {
        if handle.join().is_err() {
            log::warn!("[ScreenCaptureShortcut] Listener thread panicked on join");
        }
    }
    let mut stored = lock_recovered(&REGISTERED_SHORTCUTS, "clear shortcut registry");
    stored.clear();
}

/// Background poll loop for Chronicle global capture shortcut (`device_query`).
fn run_screen_capture_listener<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    shortcut: String,
    keycode: Keycode,
    ready: SyncSender<Result<(), String>>,
) {
    let device_state = match catch_unwind_str("DeviceState::new", DeviceState::new) {
        Ok(ds) => ds,
        Err(err) => {
            let _ = ready.send(Err(err));
            ENTER_LISTENER_RUNNING.store(false, Ordering::SeqCst);
            return;
        }
    };

    if ready.send(Ok(())).is_err() {
        ENTER_LISTENER_RUNNING.store(false, Ordering::SeqCst);
        return;
    }

    let mut was_trigger_pressed = false;

    while ENTER_LISTENER_RUNNING.load(Ordering::SeqCst) {
        let tick = catch_unwind_str("DeviceState::get_keys", || {
            let keys = device_state.get_keys();
            let is_trigger_pressed = keys.contains(&keycode);
            let mut event: Option<ScreenCaptureEvent> = None;

            if is_trigger_pressed && !was_trigger_pressed {
                let now_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                let last_ms = LAST_ENTER_TRIGGER_MS.load(Ordering::SeqCst);

                if now_ms.saturating_sub(last_ms) >= ENTER_TRIGGER_DEBOUNCE_MS {
                    LAST_ENTER_TRIGGER_MS.store(now_ms, Ordering::SeqCst);
                    event = Some(ScreenCaptureEvent {
                        shortcut: shortcut.clone(),
                        state: "Pressed".to_string(),
                    });
                }
            }

            (is_trigger_pressed, event)
        });

        match tick {
            Ok((is_trigger_pressed, event)) => {
                was_trigger_pressed = is_trigger_pressed;
                if let Some(event_data) = event {
                    if let Err(e) = app.emit("screen-capture-shortcut", event_data) {
                        log::error!("[ScreenCaptureShortcut] Failed to emit event: {}", e);
                    }
                }
            }
            Err(err) => {
                log::error!("[ScreenCaptureShortcut] Stopping listener after poll failure: {err}");
                break;
            }
        }

        std::thread::sleep(Duration::from_millis(25));
    }

    ENTER_LISTENER_RUNNING.store(false, Ordering::SeqCst);
}

/// Tauri command: register a global shortcut for screen capture
#[tauri::command]
pub fn register_screen_capture_shortcut<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    shortcut: String,
) -> Result<String, String> {
    catch_unwind_result("register_screen_capture_shortcut", || {
        register_screen_capture_shortcut_impl(app, shortcut)
    })
}

fn register_screen_capture_shortcut_impl<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    shortcut: String,
) -> Result<String, String> {
    let keycode = Keycode::from_str(shortcut.trim()).map_err(|_| {
        format!(
            "Unsupported chronicle capture key {:?}. Use a device_query Keycode name (e.g. Enter, F9).",
            shortcut.trim()
        )
    })?;

    if !crate::permissions::is_accessibility_granted() {
        return Err(ACCESSIBILITY_REQUIRED_MSG.to_string());
    }

    if ENTER_LISTENER_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(shortcut);
    }

    let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
    let app_clone = app.clone();
    let shortcut_clone = shortcut.clone();
    let ready_error_tx = ready_tx.clone();
    let handle = std::thread::spawn(move || {
        if let Err(error) = catch_unwind_str("screen capture listener thread", || {
            run_screen_capture_listener(app_clone, shortcut_clone, keycode, ready_tx);
        }) {
            log::error!("[ScreenCaptureShortcut] Listener panicked: {error}");
            ENTER_LISTENER_RUNNING.store(false, Ordering::SeqCst);
            let _ = ready_error_tx.send(Err(error));
        }
    });

    let ready = match ready_rx.recv_timeout(LISTENER_READY_TIMEOUT) {
        Ok(Ok(())) => true,
        Ok(Err(err)) => {
            log::error!("[ScreenCaptureShortcut] Listener init failed: {err}");
            false
        }
        Err(RecvTimeoutError::Timeout) => {
            log::error!("[ScreenCaptureShortcut] Listener init timed out");
            false
        }
        Err(RecvTimeoutError::Disconnected) => {
            log::error!("[ScreenCaptureShortcut] Listener exited before ready");
            false
        }
    };

    if !ready {
        ENTER_LISTENER_RUNNING.store(false, Ordering::SeqCst);
        if handle.join().is_err() {
            log::warn!("[ScreenCaptureShortcut] Listener thread panicked during init");
        }
        return Err(ACCESSIBILITY_REQUIRED_MSG.to_string());
    }

    let mut listener_handle = lock_recovered(
        &ENTER_LISTENER_HANDLE,
        "register screen capture listener handle",
    );
    *listener_handle = Some(handle);

    let mut stored = lock_recovered(&REGISTERED_SHORTCUTS, "register shortcut");
    stored.push(shortcut.clone());

    Ok(shortcut)
}

/// Tauri command: unregister the screen capture shortcut
#[tauri::command]
pub fn unregister_screen_capture_shortcut<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
) -> Result<(), String> {
    catch_unwind_result("unregister_screen_capture_shortcut", || {
        stop_screen_capture_listener();
        Ok(())
    })
}

// ============ Voice Input Shortcut ============

static VOICE_INPUT_REGISTERED_SHORTCUTS: std::sync::LazyLock<Mutex<Vec<String>>> =
    std::sync::LazyLock::new(|| Mutex::new(Vec::new()));
static VOICE_INPUT_LISTENER_RUNNING: std::sync::LazyLock<AtomicBool> =
    std::sync::LazyLock::new(|| AtomicBool::new(false));
static VOICE_INPUT_LISTENER_HANDLE: std::sync::LazyLock<Mutex<Option<JoinHandle<()>>>> =
    std::sync::LazyLock::new(|| Mutex::new(None));

/// Parsed modifier+key binding for voice input (e.g. "Shift+V").
#[derive(Clone, Debug)]
struct VoiceShortcutBinding {
    require_ctrl: bool,
    require_shift: bool,
    require_alt: bool,
    require_meta: bool,
    main_key: Keycode,
}

const VOICE_MODIFIER_NAMES: &[&str] = &[
    "Ctrl", "Control", "LControl", "RControl", "Shift", "LShift", "RShift", "Alt", "LAlt", "RAlt",
    "Cmd", "Meta", "Command", "LMeta", "RMeta",
];

fn is_voice_modifier_name(part: &str) -> bool {
    VOICE_MODIFIER_NAMES.iter().any(|name| *name == part)
}

fn parse_voice_main_key(part: &str) -> Result<Keycode, String> {
    let trimmed = part.trim();
    if trimmed.is_empty() {
        return Err("Voice input shortcut must include a non-modifier key".to_string());
    }
    if let Ok(keycode) = Keycode::from_str(trimmed) {
        return Ok(keycode);
    }
    if trimmed.len() == 1 {
        let ch = trimmed.chars().next().unwrap();
        if ch.is_ascii_alphanumeric() {
            let key_name = if ch.is_ascii_digit() {
                format!("Key{ch}")
            } else {
                format!("Key{}", ch.to_ascii_uppercase())
            };
            if let Ok(keycode) = Keycode::from_str(&key_name) {
                return Ok(keycode);
            }
        }
    }
    Err(format!(
        "Unsupported voice input key {:?}. Use a modifier+key combo (e.g. Shift+V).",
        trimmed
    ))
}

fn parse_voice_shortcut(shortcut: &str) -> Result<VoiceShortcutBinding, String> {
    let parts: Vec<&str> = shortcut
        .split('+')
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .collect();

    if parts.len() < 2 {
        return Err(
            "Voice input shortcut must include at least one modifier and one key (e.g. Shift+V)."
                .to_string(),
        );
    }

    let mut require_ctrl = false;
    let mut require_shift = false;
    let mut require_alt = false;
    let mut require_meta = false;
    let mut main_key: Option<Keycode> = None;

    for part in parts {
        match part {
            "Ctrl" | "Control" | "LControl" | "RControl" => require_ctrl = true,
            "Shift" | "LShift" | "RShift" => require_shift = true,
            "Alt" | "LAlt" | "RAlt" => require_alt = true,
            "Cmd" | "Meta" | "Command" | "LMeta" | "RMeta" => require_meta = true,
            key if !is_voice_modifier_name(key) => {
                main_key = Some(parse_voice_main_key(key)?);
            }
            _ => {}
        }
    }

    let main_key = main_key.ok_or_else(|| {
        "Voice input shortcut must include a non-modifier key (e.g. Shift+V).".to_string()
    })?;

    if !(require_ctrl || require_shift || require_alt || require_meta) {
        return Err(
            "Voice input shortcut must include a modifier (Ctrl/Shift/Alt/Cmd).".to_string(),
        );
    }

    Ok(VoiceShortcutBinding {
        require_ctrl,
        require_shift,
        require_alt,
        require_meta,
        main_key,
    })
}

fn is_ctrl_pressed(keys: &[Keycode]) -> bool {
    keys.iter()
        .any(|k| matches!(k, Keycode::LControl | Keycode::RControl))
}

fn is_shift_pressed(keys: &[Keycode]) -> bool {
    keys.iter()
        .any(|k| matches!(k, Keycode::LShift | Keycode::RShift))
}

fn is_alt_pressed(keys: &[Keycode]) -> bool {
    keys.iter()
        .any(|k| matches!(k, Keycode::LAlt | Keycode::RAlt))
}

fn is_meta_pressed(keys: &[Keycode]) -> bool {
    keys.iter()
        .any(|k| matches!(k, Keycode::LMeta | Keycode::RMeta))
}

fn is_voice_combo_pressed(keys: &[Keycode], binding: &VoiceShortcutBinding) -> bool {
    if binding.require_ctrl && !is_ctrl_pressed(keys) {
        return false;
    }
    if binding.require_shift && !is_shift_pressed(keys) {
        return false;
    }
    if binding.require_alt && !is_alt_pressed(keys) {
        return false;
    }
    if binding.require_meta && !is_meta_pressed(keys) {
        return false;
    }
    keys.contains(&binding.main_key)
}

/// Event payload for voice input shortcut
#[derive(Clone, serde::Serialize)]
struct VoiceInputEvent {
    shortcut: String,
    state: String,
}

fn stop_voice_input_listener() {
    VOICE_INPUT_LISTENER_RUNNING.store(false, Ordering::SeqCst);
    if let Some(handle) =
        lock_recovered(&VOICE_INPUT_LISTENER_HANDLE, "stop voice input listener").take()
    {
        if handle.join().is_err() {
            log::warn!("[VoiceInputShortcut] Listener thread panicked on join");
        }
    }
    let mut stored = lock_recovered(
        &VOICE_INPUT_REGISTERED_SHORTCUTS,
        "clear voice input shortcut registry",
    );
    stored.clear();
}

/// Background poll loop for Voice Input global shortcut (`device_query`).
fn run_voice_input_listener<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    shortcut: String,
    binding: VoiceShortcutBinding,
    ready: SyncSender<Result<(), String>>,
) {
    let device_state = match catch_unwind_str("DeviceState::new", DeviceState::new) {
        Ok(ds) => ds,
        Err(err) => {
            let _ = ready.send(Err(err));
            VOICE_INPUT_LISTENER_RUNNING.store(false, Ordering::SeqCst);
            return;
        }
    };

    if ready.send(Ok(())).is_err() {
        VOICE_INPUT_LISTENER_RUNNING.store(false, Ordering::SeqCst);
        return;
    }

    let mut was_trigger_pressed = false;

    while VOICE_INPUT_LISTENER_RUNNING.load(Ordering::SeqCst) {
        let tick = catch_unwind_str("DeviceState::get_keys", || {
            let keys = device_state.get_keys();
            let is_trigger_pressed = is_voice_combo_pressed(&keys, &binding);
            let mut event: Option<VoiceInputEvent> = None;

            if is_trigger_pressed && !was_trigger_pressed {
                event = Some(VoiceInputEvent {
                    shortcut: shortcut.clone(),
                    state: "Pressed".to_string(),
                });
            } else if !is_trigger_pressed && was_trigger_pressed {
                event = Some(VoiceInputEvent {
                    shortcut: shortcut.clone(),
                    state: "Released".to_string(),
                });
            }

            (is_trigger_pressed, event)
        });

        match tick {
            Ok((is_trigger_pressed, event)) => {
                was_trigger_pressed = is_trigger_pressed;
                if let Some(event_data) = event {
                    if let Err(e) = app.emit("voice-input-shortcut", event_data) {
                        log::error!("[VoiceInputShortcut] Failed to emit event: {}", e);
                    }
                }
            }
            Err(err) => {
                log::error!("[VoiceInputShortcut] Stopping listener after poll failure: {err}");
                break;
            }
        }

        std::thread::sleep(Duration::from_millis(25));
    }

    VOICE_INPUT_LISTENER_RUNNING.store(false, Ordering::SeqCst);
}

fn register_voice_input_shortcut_impl<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    shortcut: String,
) -> Result<String, String> {
    let binding = parse_voice_shortcut(shortcut.trim())?;

    if !crate::permissions::is_accessibility_granted() {
        return Err(ACCESSIBILITY_REQUIRED_MSG.to_string());
    }

    if VOICE_INPUT_LISTENER_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(shortcut);
    }

    let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
    let app_clone = app.clone();
    let shortcut_clone = shortcut.clone();
    let ready_error_tx = ready_tx.clone();
    let handle = std::thread::spawn(move || {
        if let Err(error) = catch_unwind_str("voice input listener thread", || {
            run_voice_input_listener(app_clone, shortcut_clone, binding, ready_tx);
        }) {
            log::error!("[VoiceInputShortcut] Listener panicked: {error}");
            VOICE_INPUT_LISTENER_RUNNING.store(false, Ordering::SeqCst);
            let _ = ready_error_tx.send(Err(error));
        }
    });

    let ready = match ready_rx.recv_timeout(LISTENER_READY_TIMEOUT) {
        Ok(Ok(())) => true,
        Ok(Err(err)) => {
            log::error!("[VoiceInputShortcut] Listener init failed: {err}");
            false
        }
        Err(RecvTimeoutError::Timeout) => {
            log::error!("[VoiceInputShortcut] Listener init timed out");
            false
        }
        Err(RecvTimeoutError::Disconnected) => {
            log::error!("[VoiceInputShortcut] Listener exited before ready");
            false
        }
    };

    if !ready {
        VOICE_INPUT_LISTENER_RUNNING.store(false, Ordering::SeqCst);
        if handle.join().is_err() {
            log::warn!("[VoiceInputShortcut] Listener thread panicked during init");
        }
        return Err(ACCESSIBILITY_REQUIRED_MSG.to_string());
    }

    let mut listener_handle = lock_recovered(
        &VOICE_INPUT_LISTENER_HANDLE,
        "register voice input listener handle",
    );
    *listener_handle = Some(handle);

    let mut stored = lock_recovered(
        &VOICE_INPUT_REGISTERED_SHORTCUTS,
        "register voice input shortcut",
    );
    stored.push(shortcut.clone());

    Ok(shortcut)
}

/// Tauri command: register a global shortcut for voice input
#[tauri::command]
pub fn register_voice_input_shortcut<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    shortcut: String,
) -> Result<String, String> {
    catch_unwind_result("register_voice_input_shortcut", || {
        register_voice_input_shortcut_impl(app, shortcut)
    })
}

/// Tauri command: unregister the voice input shortcut
#[tauri::command]
pub fn unregister_voice_input_shortcut<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
) -> Result<(), String> {
    catch_unwind_result("unregister_voice_input_shortcut", || {
        stop_voice_input_listener();
        Ok(())
    })
}

// ============ File Operations ============

/// Tauri command: open a URL via system handler (bypasses opener plugin ACL)
#[tauri::command]
pub fn open_url_custom(url: String) -> Result<(), String> {
    catch_unwind_result("open_url_custom", || open_url_custom_impl(url))
}

fn open_url_custom_impl(url: String) -> Result<(), String> {
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
    catch_unwind_result("read_file_custom", || read_file_custom_impl(path))
}

fn read_file_custom_impl(path: String) -> Result<Vec<u8>, String> {
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
    catch_unwind_result("file_stat_custom", || {
        let metadata =
            std::fs::metadata(&path).map_err(|e| format!("Failed to stat file: {}", e))?;

        Ok(serde_json::json!({
            "size": metadata.len(),
            "is_file": metadata.is_file(),
            "is_dir": metadata.is_dir(),
        }))
    })
}

/// Tauri command: check if file exists
#[tauri::command]
pub fn file_exists_custom(path: String) -> Result<bool, String> {
    catch_unwind_result("file_exists_custom", || {
        Ok(std::path::Path::new(&path).exists())
    })
}

/// Tauri command: create directory
#[tauri::command]
pub fn mkdir_custom(dir_path: String) -> Result<(), String> {
    catch_unwind_result("mkdir_custom", || {
        std::fs::create_dir_all(&dir_path).map_err(|e| format!("Failed to create directory: {}", e))
    })
}

/// Tauri command: write text file
#[tauri::command]
pub fn write_text_file_custom(file_path: String, content: String) -> Result<(), String> {
    catch_unwind_result("write_text_file_custom", || {
        if let Some(parent) = std::path::Path::new(&file_path).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }
        std::fs::write(&file_path, content).map_err(|e| format!("Failed to write file: {}", e))
    })
}

/// Tauri command: read text file
#[tauri::command]
pub fn read_text_file_custom(file_path: String) -> Result<String, String> {
    catch_unwind_result("read_text_file_custom", || {
        std::fs::read_to_string(&file_path).map_err(|e| format!("Failed to read file: {}", e))
    })
}

/// Tauri command: delete file
#[tauri::command]
pub fn remove_file_custom(file_path: String) -> Result<(), String> {
    catch_unwind_result("remove_file_custom", || {
        std::fs::remove_file(&file_path).map_err(|e| format!("Failed to remove file: {}", e))
    })
}

/// Tauri command: open folder picker dialog
#[tauri::command]
pub async fn pick_folder_dialog(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    crate::panic_guard::catch_unwind_future_result("pick_folder_dialog", async move {
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
    })
    .await
}

/// Tauri command: open a file or path (bypasses opener plugin ACL)
#[tauri::command]
pub fn open_path_custom(path: String) -> Result<(), String> {
    catch_unwind_result("open_path_custom", || open_path_custom_impl(path))
}

fn open_path_custom_impl(path: String) -> Result<(), String> {
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
    catch_unwind_result("reveal_item_in_dir_custom", || {
        reveal_item_in_dir_custom_impl(path)
    })
}

fn reveal_item_in_dir_custom_impl(path: String) -> Result<(), String> {
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

/// Tauri command: copy a file to the system clipboard as a native file reference.
///
/// On macOS this writes a `public.file-url` UTI to the pasteboard via
/// AppleScript (`set the clipboard to (POSIX file "...")`), producing
/// the exact same clipboard state as Finder's ⌘C.  Any application that
/// accepts pasted files (Finder, Mail, Slack, PowerPoint, etc.) will
/// recognise the reference.
///
/// Linux and Windows are stubbed out with an "unsupported" error so they
/// can be filled in later without changing the command signature.
#[tauri::command]
pub fn copy_file_to_clipboard(path: String) -> Result<(), String> {
    catch_unwind_result("copy_file_to_clipboard", || {
        copy_file_to_clipboard_impl(path)
    })
}

fn copy_file_to_clipboard_impl(path: String) -> Result<(), String> {
    let file_path = std::path::Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }
    if !file_path.is_file() {
        return Err(format!("Path is not a file: {}", path));
    }
    #[cfg(target_os = "macos")]
    {
        use std::io::Write;

        // Resolve symlinks and canonicalize to produce a clean absolute path.
        let resolved =
            std::fs::canonicalize(&path).map_err(|e| format!("Failed to resolve path: {}", e))?;
        let resolved_str = resolved.to_string_lossy().to_string();

        // Pass the file path via stdin to avoid embedding user-controlled data
        // inside the AppleScript string (which would require fragile escaping
        // for quotes, backslashes, newlines, tabs, etc.).
        let script = "on run argv\n\
                       \tset fp to item 1 of argv\n\
                       \tset the clipboard to (POSIX file fp)\n\
                       end run";
        let mut child = Command::new("osascript")
            .arg("-")
            .arg(&resolved_str)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to run osascript: {}", e))?;

        if let Some(ref mut stdin) = child.stdin {
            let _ = stdin.write_all(script.as_bytes());
        }

        let output = child
            .wait_with_output()
            .map_err(|e| format!("Failed to wait for osascript: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "Failed to copy file to clipboard: {}",
                stderr.trim()
            ));
        }
    }
    #[cfg(target_os = "linux")]
    {
        return Err("Copy file to clipboard is not yet supported on Linux".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        return Err("Copy file to clipboard is not yet supported on Windows".to_string());
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
    catch_unwind_result("home_dir_custom", || {
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
    })
}

/// Tauri command: get the operating system's UI locale (e.g. "en-US", "zh-CN").
///
/// Reads the OS-level language rather than the webview's `navigator.language`,
/// which can differ from the user's actual system language (notably on Windows
/// WebView2 and non-localized macOS apps).
#[tauri::command]
pub fn get_system_locale() -> Result<String, String> {
    sys_locale::get_locale().ok_or_else(|| "Failed to detect system locale".to_string())
}

/// Tauri command: get memory directory (app data/memory)
#[tauri::command]
pub fn get_memory_directory(app_handle: tauri::AppHandle) -> Result<String, String> {
    catch_unwind_result("get_memory_directory", || {
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
    })
}

/// Tauri command: get data directory path
#[tauri::command]
pub fn get_data_directory(app_handle: tauri::AppHandle) -> Result<String, String> {
    catch_unwind_result("get_data_directory", || {
        let data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get data dir: {}", e))?;

        Ok(data_dir.to_string_lossy().to_string())
    })
}

/// Tauri command: get storage directory path
#[tauri::command]
pub fn get_storage_directory(app_handle: tauri::AppHandle) -> Result<String, String> {
    catch_unwind_result("get_storage_directory", || {
        let data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get data dir: {}", e))?;
        let storage_dir = data_dir.join("storage");
        Ok(storage_dir.to_string_lossy().to_string())
    })
}

/// Tauri command: get the bundled skills directory path.
///
/// Platform-specific paths:
/// - macOS:   Contents/Resources/_up_/_up_/_up_/skills   (exe in Contents/MacOS/)
/// - Windows: _up_/_up_/_up_/skills relative to exe      (resources at exe level)
/// - Linux:   _up_/_up_/_up_/skills relative to resource dir (e.g. /usr/lib/openloomi/_up_/_up_/_up_/skills)
#[tauri::command]
pub fn get_bundled_skills_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    catch_unwind_result("get_bundled_skills_dir", || {
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
    })
}

/// Tauri command: test if global shortcut plugin is working
#[tauri::command]
pub fn test_global_shortcut() -> Result<String, String> {
    catch_unwind_result("test_global_shortcut", || {
        log::info!("[GlobalShortcut] Test command called");
        Ok("Global shortcut plugin is loaded".to_string())
    })
}

/// Tauri command: get app info
#[tauri::command]
pub fn get_app_info() -> Result<serde_json::Value, String> {
    catch_unwind_result("get_app_info", || {
        Ok(serde_json::json!({
            "name": "openloomi",
            "version": env!("CARGO_PKG_VERSION"),
            "description": env!("CARGO_PKG_DESCRIPTION"),
        }))
    })
}

/// Tauri command: get host operating system identifier.
///
/// Returns one of `"macos"`, `"windows"`, `"linux"`, or `"other"`. The
/// frontend uses this to decide which platform-specific window-chrome
/// affordances (e.g. macOS traffic-light slot) to render.
#[tauri::command]
pub fn get_host_os() -> Result<String, String> {
    catch_unwind_result("get_host_os", || {
        let os = if cfg!(target_os = "macos") {
            "macos"
        } else if cfg!(target_os = "windows") {
            "windows"
        } else if cfg!(target_os = "linux") {
            "linux"
        } else {
            "other"
        };
        Ok(os.to_string())
    })
}

// ============ Screen Capture (Chronicle) ============

#[cfg(target_os = "macos")]
/// Capture the currently focused (frontmost) window and return its PNG bytes.
///
/// Strategy:
/// 1. Enumerate all windows via xcap.
/// 2. Prefer the window where `is_focused() == true` — this is whatever the
///    user is actually looking at right now, including openloomi itself when
///    it's frontmost (per product decision: do not exclude our own window).
/// 3. Otherwise pick the top-most non-minimized window by smallest `z`
///    (frontmost in stacking order).
/// 4. If the resulting image is suspiciously small (longest edge ≤ 256px),
///    treat it as an icon placeholder (a known macOS CGWindowList failure
///    mode for GPU-rendered / off-screen windows) and fall back to that
///    window's monitor.
/// 5. If no window was selected at all, fall back to the primary monitor.
///
/// This replaces the previous per-platform shell-out implementations
/// (`screencapture` / `gnome-screenshot` / PowerShell + AppleScript) with
/// native APIs through xcap:
///   - macOS: CGWindowList
///   - Windows: Win32 GDI / DWM
///   - Linux X11: xcb + XRandR
///   - Linux Wayland: pipewire / wayshot
fn capture_screen_impl() -> Result<Vec<u8>, String> {
    use image::ImageFormat;
    use xcap::{Monitor, Window};

    let mut windows = Window::all().map_err(|e| format!("Failed to enumerate windows: {e}"))?;

    // First pass: explicit focused flag.
    let focused = windows
        .iter()
        .find(|w| w.is_focused().unwrap_or(false))
        .cloned();

    let target = match focused {
        Some(t) => Some(t),
        None => {
            // Fallback: smallest z = top-most in stacking order. Skip
            // minimized windows since they can't be captured.
            windows.sort_by_key(|w| w.z().unwrap_or(i32::MAX));
            windows
                .into_iter()
                .find(|w| !w.is_minimized().unwrap_or(true))
        }
    };

    let rgba = match target {
        Some(window) => {
            log::info!(
                "[Chronicle] Capturing window: app={:?} title={:?}",
                window.app_name().ok(),
                window.title().ok()
            );
            let img = window
                .capture_image()
                .map_err(|e| format!("Failed to capture window: {e}"))?;

            // Heuristic (H1): on macOS, CGWindowList sometimes returns an
            // icon-sized placeholder for GPU-accelerated / off-screen /
            // backgrounded windows (Chrome, Electron, etc.) instead of the
            // real contents. Detect by size and fall back to capturing the
            // monitor the window lives on.
            let longest_edge = img.width().max(img.height());
            if longest_edge <= 256 {
                log::warn!(
                    "[Chronicle] Window capture looks like an icon placeholder \
                     ({}x{}); falling back to its monitor",
                    img.width(),
                    img.height()
                );
                let monitor = window
                    .current_monitor()
                    .map_err(|e| format!("Failed to resolve window's monitor: {e}"))?;
                monitor
                    .capture_image()
                    .map_err(|e| format!("Failed to capture monitor: {e}"))?
            } else {
                img
            }
        }
        None => {
            // Ultimate fallback (B2): primary monitor full screen.
            log::warn!("[Chronicle] No suitable window found; falling back to primary monitor");
            let monitors =
                Monitor::all().map_err(|e| format!("Failed to enumerate monitors: {e}"))?;
            let primary = monitors
                .into_iter()
                .find(|m| m.is_primary().unwrap_or(false))
                .or_else(|| Monitor::from_point(0, 0).ok())
                .ok_or_else(|| "No monitor available for fallback capture".to_string())?;
            primary
                .capture_image()
                .map_err(|e| format!("Failed to capture monitor: {e}"))?
        }
    };

    // Encode as PNG.
    let mut buf = Vec::new();
    rgba.write_to(&mut std::io::Cursor::new(&mut buf), ImageFormat::Png)
        .map_err(|e| format!("Failed to encode PNG: {e}"))?;

    Ok(buf)
}

/// Capture the frontmost window (or monitor fallback) as PNG bytes.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn capture_screen() -> Result<Vec<u8>, String> {
    flatten_spawn_result(
        tauri::async_runtime::spawn_blocking(|| {
            catch_unwind_result("capture_screen", capture_screen_impl)
        })
        .await,
        "capture_screen",
    )
}
