// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.
#![allow(unused)]
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use sentry::{capture_message, init, Level};
use std::sync::Arc;
use tauri::Manager;
use tauri::{Emitter, Listener};

mod constants;
mod js_scheduler;
mod menu;
mod node;
mod notify;
mod render_runtime;
mod runtime_components;
mod storage;
mod system;
mod update;

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

fn main() {
    env_logger::init();

    println!("╔══════════════════════════════════════╗");
    println!(
        "║       openloomi Tauri App v{}        ║",
        env!("CARGO_PKG_VERSION")
    );
    println!("╚══════════════════════════════════════╝");

    // Initialize Sentry for crash monitoring
    // Note: In production, set SENTRY_DSN environment variable
    let _sentry = if let Ok(dsn) = std::env::var("SENTRY_DSN") {
        println!("📡 Initializing Sentry crash monitoring...");
        Some(init(sentry::ClientOptions {
            dsn: dsn.parse::<sentry::types::Dsn>().ok(),
            release: Some(env!("CARGO_PKG_VERSION").into()),
            environment: Some(if cfg!(debug_assertions) {
                "development".into()
            } else {
                "production".into()
            }),
            ..Default::default()
        }))
    } else {
        println!("⚠️  SENTRY_DSN not set, skipping Sentry initialization");
        None
    };

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
        if let Ok(mut rx_guard) = node::APP_HANDLE_RX.lock() {
            *rx_guard = Some(rx);
        }
        if let Ok(mut tx_guard) = node::APP_HANDLE_TX.lock() {
            *tx_guard = Some(tx);
        }
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
            system::home_dir_custom,
            // Server status
            node::get_server_status,
            node::restart_server,
            // Auto-update
            update::check_for_update,
            update::start_update_download,
            update::poll_update_download_progress,
            update::finish_update_download,
            update::download_and_install_update,
            update::restart_for_update,
            // Telegram
            telegram::desktop::detect_telegram_desktop,
            telegram::desktop::check_custom_telegram_path,
            // Notification
            notify::send_notification,
            // Render engine
            render_runtime::get_render_engine_status_cmd,
            render_runtime::ensure_render_engine_download_started_cmd,
        ])
        .setup(|app| {
            // Deliver AppHandle to the background server thread immediately
            let app_handle = app.handle();
            if let Ok(tx_guard) = node::APP_HANDLE_TX.lock() {
                if let Some(ref tx) = *tx_guard {
                    let _ = tx.send(app_handle.clone());
                }
            }
            if let Ok(mut guard) = node::APP_HANDLE.lock() {
                *guard = Some(app_handle.clone());
            }

            // Set panic hook to capture panic and clean up Node.js on crash
            let default_panic = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |info| {
                let panic_message = if let Some(s) = info.payload().downcast_ref::<&str>() {
                    s.to_string()
                } else if let Some(s) = info.payload().downcast_ref::<String>() {
                    s.clone()
                } else {
                    "Unknown panic".to_string()
                };

                let location = info
                    .location()
                    .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
                    .unwrap_or_else(|| "unknown location".to_string());

                eprintln!("📴 PANIC: {} at {}", panic_message, location);

                // Capture panic to Sentry before cleanup
                capture_message(
                    &format!("PANIC: {} at {}", panic_message, location),
                    Level::Fatal,
                );

                node::cleanup_nodejs_process();
                default_panic(info);
            }));

            // Clean up on window close
            if let Some(window) = app.get_webview_window("main") {
                let window = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { .. } = event {
                        println!("📴 Window close requested, stopping scheduler...");
                        js_scheduler::stop_js_scheduler();
                        println!("📴 Cleaning up Node.js process...");
                        node::cleanup_nodejs_process();
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
                    wait_and_navigate(app);
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

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
