// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.
#![allow(unused)]
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri::{Emitter, Listener};

mod audio_capture;
mod close_behavior;
mod constants;
mod js_scheduler;
mod lifecycle;
mod menu;
mod node;
mod notify;
mod panic_guard;
mod render_runtime;
mod runtime_components;
mod storage;
mod system;
mod tray;
mod update;
mod workspace_artifacts;

mod permissions;
mod telegram;

#[cfg(not(debug_assertions))]
fn resolve_resource_file(
    app: &tauri::AppHandle,
    relative_path: &str,
) -> Result<std::path::PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;
    let candidates = [
        resource_dir.join("resources").join(relative_path),
        resource_dir.join(relative_path),
    ];
    candidates
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| format!("Resource not found: {}", relative_path))
}

/// Polls NEXTJS_STARTED until ready, then navigates to the Next.js app.
/// Runs on a background thread so setup() returns immediately and the window
/// can render the loading HTML right away.
#[cfg(not(debug_assertions))]
fn wait_and_navigate(app: tauri::AppHandle) {
    // Copy loading HTML from resources to temp dir so WebView can both
    // load it and execute JS to update the status text dynamically.
    let temp_path = std::env::temp_dir().join("openloomi_loading.html");
    let resource_path = resolve_resource_file(&app, "loading.html");

    if let Ok(resource_path) = resource_path {
        println!("📄 Resource path: {:?}", resource_path);
        println!("📄 Resource exists: {}", resource_path.exists());
        if resource_path.exists() {
            if let Err(e) = std::fs::copy(&resource_path, &temp_path) {
                eprintln!("⚠️  Failed to copy loading.html: {}", e);
            } else {
                println!("✅ Copied loading.html to {:?}", temp_path);
            }
        }
    } else {
        eprintln!("⚠️  Failed to get resource dir");
    }

    // Navigate to the loading HTML immediately so it shows right away.
    // Retry for up to 5 seconds since the window may not be fully initialized yet.
    let window = {
        let start = std::time::Instant::now();
        loop {
            if let Some(w) = app.get_webview_window("main") {
                break Some(w);
            }
            if start.elapsed().as_secs() >= 5 {
                break None;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    };

    if temp_path.exists() {
        println!("🚀 Navigating to loading page...");
        if let Some(window) = window {
            if let Ok(url) = url::Url::from_file_path(&temp_path) {
                println!("📍 Loading URL: {}", url);
                match window.navigate(url.clone()) {
                    Ok(_) => println!("✅ Navigate OK"),
                    Err(e) => eprintln!("❌ Navigate failed: {}", e),
                }
            }
        } else {
            eprintln!("⚠️  Window 'main' not available within 5 seconds, skipping navigation");
        }
    } else {
        eprintln!("⚠️  Temp loading.html not found at {:?}", temp_path);
    }

    // Background thread: update status message while waiting
    let app2 = app.clone();
    std::thread::spawn(move || {
        if let Err(error) = panic_guard::catch_unwind_str("loading status thread", || {
            let states = [
                "Starting up...",
                "Setting up Agent Runtime...",
                "Almost ready...",
                "This may take a few minutes on first run...",
            ];
            for (i, msg) in states.iter().enumerate() {
                if node::NEXTJS_STARTED.load(std::sync::atomic::Ordering::SeqCst) {
                    break;
                }
                if node::get_startup_error().is_some() {
                    // Error already set, stop updating status
                    break;
                }
                std::thread::sleep(std::time::Duration::from_secs(4));
                let js = format!(
                    "var el=document.getElementById('status');if(el)el.textContent='{}'",
                    msg
                );
                if let Some(w) = app2.get_webview_window("main") {
                    let _ = w.eval(&js);
                }
                // After 60s without progress, show a hint that Node.js may be downloading
                if i == 1 {
                    let hint_js = "var el=document.getElementById('status');if(el)el.textContent='Setting up Agent Runtime...'";
                    std::thread::sleep(std::time::Duration::from_secs(10));
                    if !node::NEXTJS_STARTED.load(std::sync::atomic::Ordering::SeqCst)
                        && node::get_startup_error().is_none()
                    {
                        if let Some(w) = app2.get_webview_window("main") {
                            let _ = w.eval(hint_js);
                        }
                    }
                    break;
                }
            }
        }) {
            log::error!("[startup] Loading status thread stopped: {error}");
        }
    });

    // Wait for server ready
    println!("⏳ Waiting for Next.js server to be ready...");
    let max_retries = 600; // 300 seconds max
    let mut retries = 0;
    while !node::NEXTJS_STARTED.load(std::sync::atomic::Ordering::SeqCst) && retries < max_retries {
        // Check for error every 5 seconds
        if retries % 10 == 0 && retries > 0 {
            if let Some(err) = node::get_startup_error() {
                eprintln!("❌ Startup error detected: {}", err);
                // Show error in loading page
                if let Some(w) = app.get_webview_window("main") {
                    let js = format!(
                        "var el=document.getElementById('status');if(el){{el.textContent='Error: {}';el.style.color='#ef4444';el.style.fontSize='13px'}}",
                        err.replace("'", "\\'").replace('\n', " ")
                    );
                    let _ = w.eval(&js);
                }
                let _ = std::fs::remove_file(&temp_path);
                return;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
        retries += 1;
    }

    if node::NEXTJS_STARTED.load(std::sync::atomic::Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(1000));
        if let Some(window) = app.get_webview_window("main") {
            if let Ok(url) = url::Url::parse(&constants::nextjs_url()) {
                let _ = window.navigate(url);
            }
        }
        // Clean up temp file
        let _ = std::fs::remove_file(&temp_path);
        println!("🚀 Tauri app started successfully!");
        println!("🌐 App URL: {}", constants::nextjs_url());
    } else {
        // Check if an error was set (may have been set just before timeout)
        if let Some(err) = node::get_startup_error() {
            let msg = format!("Failed to start: {}", err);
            eprintln!("❌ {}", msg);
            if let Some(w) = app.get_webview_window("main") {
                let js = format!(
                    "var el=document.getElementById('status');if(el){{el.textContent='{}';el.style.color='#ef4444';el.style.fontSize='13px'}}",
                    err.replace("'", "\\'").replace('\n', " ")
                );
                let _ = w.eval(&js);
            }
        } else {
            // Timeout without any error set
            let timeout_msg = "Startup timed out after 300 seconds.";
            eprintln!("❌ {}", timeout_msg);
            if let Some(w) = app.get_webview_window("main") {
                let js = format!(
                    "var el=document.getElementById('status');if(el){{el.textContent='{}';el.style.color='#ef4444';el.style.fontSize='13px'}}",
                    timeout_msg
                );
                let _ = w.eval(&js);
            }
        }
        let _ = std::fs::remove_file(&temp_path);
    }
}

fn panic_message_from_hook(info: &std::panic::PanicHookInfo<'_>) -> String {
    if let Some(s) = info.payload().downcast_ref::<&str>() {
        s.to_string()
    } else if let Some(s) = info.payload().downcast_ref::<String>() {
        s.clone()
    } else {
        "Unknown panic".to_string()
    }
}

fn panic_location_from_hook(info: &std::panic::PanicHookInfo<'_>) -> String {
    info.location()
        .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
        .unwrap_or_else(|| "unknown location".to_string())
}

fn install_panic_hook() {
    // `default_panic` is the previous panic hook (initially the standard
    // stderr/backtrace hook). We invoke it after our tagged handling so the
    // default output still runs.
    let default_panic = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if panic_guard::handle_guarded_panic_hook(info, default_panic.as_ref()) {
            return;
        }

        let panic_message = panic_message_from_hook(info);
        let location = panic_location_from_hook(info);

        eprintln!("📴 PANIC: {} at {}", panic_message, location);

        node::cleanup_nodejs_process_from_panic_hook();
        panic_guard::run_fatal_panic_hook(&panic_message, &location, info, default_panic.as_ref());
    }));
}

fn main() {
    env_logger::init();

    println!("╔══════════════════════════════════════╗");
    println!(
        "║       openloomi Tauri App v{}        ║",
        env!("CARGO_PKG_VERSION")
    );
    println!("╚══════════════════════════════════════╝");

    install_panic_hook();

    // Initialize data directories
    if let Err(e) = storage::init_data_dirs() {
        eprintln!("⚠️  Warning: Failed to initialize data directories: {}", e);
    }

    // Pre-start cleanup (production only)
    #[cfg(not(debug_assertions))]
    {
        node::cleanup_before_start();
        // Create channel to deliver AppHandle to the background thread
        let (tx, rx) = std::sync::mpsc::channel();
        let mut rx_guard =
            panic_guard::lock_recovered(&node::APP_HANDLE_RX, "store app handle receiver");
        *rx_guard = Some(rx);
        drop(rx_guard);

        let mut tx_guard =
            panic_guard::lock_recovered(&node::APP_HANDLE_TX, "store app handle sender");
        *tx_guard = Some(tx);
        drop(tx_guard);
        node::start_nextjs_server();
    }

    #[cfg(debug_assertions)]
    {
        println!(
            "📡 Development mode: expecting Next.js at {}",
            constants::nextjs_url()
        );
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            // Storage
            storage::save_token,
            storage::load_token,
            storage::delete_token,
            // System
            system::get_data_directory,
            system::get_storage_directory,
            system::get_memory_directory,
            system::get_bundled_skills_dir,
            system::get_app_info,
            system::open_url_custom,
            system::open_path_custom,
            system::pick_folder_dialog,
            system::read_file_custom,
            system::file_stat_custom,
            system::file_exists_custom,
            system::mkdir_custom,
            system::write_text_file_custom,
            system::read_text_file_custom,
            system::remove_file_custom,
            system::reveal_item_in_dir_custom,
            system::copy_file_to_clipboard,
            system::home_dir_custom,
            system::get_host_os,
            system::get_system_locale,
            // Chronicle (screen-aware memory)
            system::register_screen_capture_shortcut,
            system::unregister_screen_capture_shortcut,
            system::register_voice_input_shortcut,
            system::unregister_voice_input_shortcut,
            system::test_global_shortcut,
            // Chronicle screen capture (macOS only - uses xcap/ScreenCaptureKit)
            #[cfg(target_os = "macos")]
            system::capture_screen,
            // System audio capture
            audio_capture::start_system_audio_capture,
            audio_capture::stop_system_audio_capture,
            audio_capture::is_system_audio_capture_active,
            // Server status
            node::get_server_status,
            node::restart_server,
            // Auto-update
            update::check_for_update,
            update::start_update_download,
            update::poll_update_download_progress,
            update::finish_update_download,
            update::restart_for_update,
            update::restart_app,
            // Telegram
            telegram::desktop::detect_telegram_desktop,
            telegram::desktop::check_custom_telegram_path,
            // Notification
            notify::send_notification,
            // Render engine
            render_runtime::get_render_engine_status_cmd,
            render_runtime::ensure_render_engine_download_started_cmd,
            // Workspace
            workspace_artifacts::list_workspace_artifacts,
            // Permissions
            permissions::check_system_permissions,
            permissions::request_screen_recording_access,
            permissions::request_system_audio_access,
            permissions::request_accessibility_access,
            permissions::request_microphone_access,
            permissions::request_notification_access,
            permissions::request_folder_access,
            permissions::open_system_settings,
        ])
        .setup(|app| {
            // Deliver AppHandle to the background server thread immediately
            let app_handle = app.handle();
            let tx_guard = panic_guard::lock_recovered(&node::APP_HANDLE_TX, "send app handle");
            if let Some(ref tx) = *tx_guard {
                let _ = tx.send(app_handle.clone());
            }
            drop(tx_guard);

            let mut guard = panic_guard::lock_recovered(&node::APP_HANDLE, "store app handle");
            *guard = Some(app_handle.clone());
            drop(guard);

            // Route window close (traffic light / × / Cmd+W / Alt+F4) through the
            // close-behavior hub. By default this minimizes to the tray instead of
            // quitting; real exit happens via the tray "Quit" / Cmd+Q.
            if let Some(window) = app.get_webview_window("main") {
                // Keep the desktop app out of the narrow-width layout until that UI is ready.
                let _ = window.set_min_size(Some(tauri::LogicalSize::new(768.0, 600.0)));
                let app_handle_for_close = app.handle().clone();
                // `on_window_event` borrows its receiver, so hand the closure its
                // own owned clone to move in and reference inside the handler.
                let window_for_handler = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let action = close_behavior::decide(
                            &app_handle_for_close,
                            close_behavior::CloseSource::WindowClose,
                        );
                        if matches!(action, close_behavior::CloseAction::Hide) {
                            // Suppress the default close so we can hide instead.
                            api.prevent_close();
                        }
                        close_behavior::execute(&app_handle_for_close, &window_for_handler, action);
                    }
                });
            }

            // Launch the wait-and-navigate logic on a background thread so setup
            // returns immediately and the WebView renders about:blank right away.
            #[cfg(not(debug_assertions))]
            {
                render_runtime::ensure_render_engine_download_started();
                let app = app.handle().clone();
                std::thread::spawn(move || {
                    if let Err(error) =
                        panic_guard::catch_unwind_str("wait_and_navigate thread", || {
                            wait_and_navigate(app);
                        })
                    {
                        node::set_startup_error(error);
                    }
                });
            }

            #[cfg(debug_assertions)]
            {
                println!("🚀 Tauri app started successfully!");
                println!("🌐 App URL: {}", constants::nextjs_url());
            }

            // Build the native menu with standard macOS items and a custom Help submenu
            let app_handle = app.handle();
            if let Err(e) = menu::build_native_menu(&app_handle) {
                eprintln!("⚠️  Warning: Failed to build native menu: {}", e);
            }

            // Build the system tray so hidden (minimized) windows can be restored
            // and the app can be quit explicitly. If this fails we degrade
            // gracefully: close_behavior falls back to a real exit on window
            // close, so the user is never left with a hidden, unreachable window.
            if let Err(e) = tray::build_tray(&app_handle) {
                eprintln!(
                    "⚠️  Warning: Failed to build system tray: {}. \
                     Window close will exit the app instead of minimizing.",
                    e
                );
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // macOS: clicking the Dock icon while the window is hidden to tray
            // fires `applicationShouldHandleReopen`. Restore the main window.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                tray::handle_reopen(app_handle, has_visible_windows);
            }

            // Single funnel point for real shutdown: any exit path (Cmd+Q,
            // tray "Quit", programmatic app.exit) lands here. Run the blocking
            // cleanup on a background thread so the event loop is not frozen
            // for ~2-3s, then re-issue the exit once cleanup is done.
            //
            // Until cleanup finishes, block the exit with prevent_exit() (so an
            // in-flight cleanup can't be cut short by a second exit request).
            // Once cleanup is done, let the exit through. The cleanup thread
            // re-issues app.exit(0) to produce that final, allowed pass.
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if lifecycle::cleanup_done() {
                    // Cleanup complete — allow the process to exit for real now.
                    return;
                }
                api.prevent_exit();
                let app_handle = app_handle.clone();
                std::thread::spawn(move || {
                    lifecycle::run_cleanup();
                    // Re-issue exit; this next ExitRequested sees cleanup_done()
                    // == true and lets the process exit.
                    app_handle.exit(0);
                });
            }
        });
}
