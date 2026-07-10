// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.
#![allow(unused)]
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri::{Emitter, Listener};

use serde_json;

mod audio_capture;
mod close_behavior;
mod constants;
mod js_scheduler;
mod lifecycle;
mod menu;
mod node;
mod notify;
mod panic_guard;
mod pet;
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

    let context = tauri::generate_context!();

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
        // Resolve the resource dir before the Tauri app is built: the Next.js
        // server starts before an AppHandle exists, and on Linux resources are
        // installed to /usr/lib/<app>, not next to the executable in /usr/bin.
        match tauri::utils::platform::resource_dir(context.package_info(), &tauri::Env::default())
        {
            Ok(dir) => {
                let mut dir_guard =
                    panic_guard::lock_recovered(&node::RESOURCE_DIR, "store resource dir");
                *dir_guard = Some(dir);
                drop(dir_guard);
            }
            Err(e) => eprintln!(
                "⚠️  Failed to resolve resource dir, falling back to exe dir: {}",
                e
            ),
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
            // Pet (dev panel → state flip). Registered unconditionally
            // (not gated on OPENLOOMI_PET_DEV): even if the panel isn't
            // built, an external caller can invoke the command without
            // any side effects beyond emitting to (possibly-absent)
            // PET_LABEL / PET_BUBBLE_LABEL windows.
            pet::emit_dev_state,
            // Pet theme system — config read/write + right-click
            // shortcuts. Registered unconditionally so the widget
            // always has a way to discover its theme on cold boot.
            pet::get_pet_config,
            pet::set_active_theme,
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

            // Build the Loomi desktop pet window. The pet is the
            // always-resident entry point — it shows on first launch
            // (visible: true in tauri.conf.json). A failure here is
            // non-fatal: the rest of the app is still useful without
            // the pet.
            if let Err(e) = pet::build_pet_window(&app_handle) {
                eprintln!("⚠️  Warning: Failed to build Loomi pet window: {}", e);
            }

            // B2: build the bubble + card aux windows eagerly so the
            // watcher can `show()` them as soon as a decision lands,
            // without paying the (small) build cost on the critical
            // path. Both are created `visible(false)` — visibility is
            // driven by watcher state (`bubble`) or user gesture
            // (`card`).
            if let Err(e) = pet::build_bubble_window(&app_handle) {
                eprintln!(
                    "⚠️  Warning: Failed to build Loomi bubble window: {}",
                    e
                );
            }
            if let Err(e) = pet::build_card_window(&app_handle) {
                eprintln!(
                    "⚠️  Warning: Failed to build Loomi card window: {}",
                    e
                );
            }
            pet::reposition_bubble_to_pet(&app_handle);
            pet::reposition_card_to_pet(&app_handle);

            // Dev scene panel: only exists when OPENLOOMI_PET_DEV=1.
            // Production builds never see this code path because the
            // env check short-circuits in the builder. We log a one-
            // liner so a developer can confirm the gate from stdout.
            if pet::dev_panel_requested() {
                match pet::build_dev_panel_window(&app_handle) {
                    Ok(Some(_)) => log::info!(
                        "[loop-pet] dev panel built (OPENLOOMI_PET_DEV=1)"
                    ),
                    Ok(None) => {
                        // No-op — should not happen because we just
                        // checked the env flag, but kept for symmetry.
                    }
                    Err(e) => eprintln!(
                        "⚠️  Warning: Failed to build Loomi dev panel: {}",
                        e
                    ),
                }
            }

            // B2-fix: Tauri's `WindowEvent::Moved` only fires on release of a
            // native drag, not continuously. To make the bubble + card
            // follow the pet smoothly while the user is dragging it, we run
            // a 20Hz background poller that re-asserts aux window positions
            // based on the pet's current `outer_position`. The poller exits
            // when the process exits — work is idempotent and `set_position`
            // is cheap.
            pet::spawn_position_poller(app_handle.clone());

            // Defensively hide the main window even though the config
            // already sets `visible: false`. On some macOS builds the
            // config alone is not enough — Tauri shows the window when
            // it finishes mounting the webview, regardless of the
            // initial flag. Hiding here is idempotent and cheap, so we
            // re-assert the intent every cold boot. The pet is the
            // always-visible entry point; the main stays hidden until
            // the user (or `pet:open-dashboard`) asks for it.
            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.hide();
            }

            // Make sure the pet is on screen and on top. `build_pet_window`
            // already sets `visible(true)` on the builder, but
            // re-applying `show_pet_window` is a cheap way to also
            // re-assert alwaysOnTop and focus order in case the OS
            // demoted the window during cold boot.
            pet::show_pet_window(&app_handle);

            // Sync the macOS Dock policy to the new visibility: the
            // main window is hidden by default and the pet is up, so
            // the app should run as an `Accessory` (no Dock icon).
            pet::sync_dock_policy(&app_handle);

            // Watch the loop skill's decisions.json on a background
            // thread and push state transitions into the pet window.
            // Cheap mtime poll — no extra deps, easy to reason about.
            pet::spawn_decision_watcher(app_handle.clone());

            // Watch `pet-config.json` and the user's custom theme
            // directory for external edits. Cheap, debounced, and
            // cross-platform — the user can hand-edit the config or
            // drop a new theme PNG in `~/.openloomi/pet-custom/` and
            // the pet reacts without a restart.
            pet::spawn_config_watcher(app_handle.clone());

            // Pet can ask the host to surface the main dashboard. We
            // listen globally (not on a single webview) so the pet is
            // not required to re-emit when its own webview is rebuilt.
            let pet_to_main = app_handle.clone();
            app_handle.listen("pet:open-dashboard", move |_event| {
                tray::show_main_window(&pet_to_main);
                // Defer the dock sync by a tick. `sync_dock_policy` reads
                // `is_visible()` to decide between Regular and Accessory;
                // on macOS that flag lags one frame after `.show()`
                // returns, so syncing immediately would observe stale
                // `false`, pick Accessory (no Dock icon), and then never
                // re-evaluate. A short background-thread sleep lets the
                // NSWindow settle before we ask the OS about its state.
                // The actual sync must then hop back to the main thread —
                // it calls `setApplicationIconImage:`, which is only safe
                // on the main thread and corrupts the objc selector table
                // (later SIGSEGV in CALayer init) when invoked off-main.
                let app_for_deferred = pet_to_main.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(80));
                    let app_for_main = app_for_deferred.clone();
                    let _ = app_for_deferred.run_on_main_thread(move || {
                        pet::sync_dock_policy(&app_for_main);
                    });
                });
            });

            // Pet right-click "Settings" → show the main window and ask
            // the Next.js side to client-side navigate to the General
            // settings page. We use a custom DOM event (rather than
            // window.location.href) so Next.js's router.push handles the
            // query-param change without a full reload, preserving
            // client state.
            let open_settings_app = app_handle.clone();
            app_handle.listen("pet:open-settings", move |_event| {
                tray::show_main_window(&open_settings_app);
                if let Some(window) = open_settings_app.get_webview_window("main") {
                    let _ = window.eval(
                        "window.dispatchEvent(new CustomEvent('openloomi:navigate-settings'))",
                    );
                }
            });

            // Pet card "Open AI settings" CTA (from the no-api-key
            // layout) → show the main window and ask the Next.js side
            // to navigate to the AI settings page with the
            // missing-key banner pre-armed. The React
            // `AiApiSettings` component already keys off
            // `?reason=missing-api-key` to render the info banner +
            // "Required for chat" badge and to auto-redirect back to
            // /chat on a successful save.
            let open_ai_settings_app = app_handle.clone();
            app_handle.listen("pet:open-ai-settings", move |_event| {
                tray::show_main_window(&open_ai_settings_app);
                if let Some(window) = open_ai_settings_app.get_webview_window("main") {
                    let _ = window.eval(
                        "window.dispatchEvent(new CustomEvent('openloomi:navigate-ai-settings'))",
                    );
                }
            });

            // The chat UI owns short-lived activity states such as
            // thinking, working, juggling and completion. The pet state
            // coordinator restores the latest Loop baseline when the UI
            // emits `idle`, so queued decisions never pin an active run to
            // the wrong sprite.
            let runtime_state_app = app_handle.clone();
            app_handle.listen("pet:runtime-state", move |event| {
                if let Err(error) =
                    pet::handle_runtime_state_event(&runtime_state_app, event.payload())
                {
                    eprintln!("[loomi-pet] ignored runtime state: {error}");
                }
            });

            // B2: bubble click → open the card (which the user can act
            // on). If the card doesn't have a current decision payload
            // (e.g. everything got dismissed in flight), the card
            // window will just show its empty state — the user can still
            // use the × to close.
            //
            // `mark_review_seen` flips the `presenting → happy`
            // transition. Without this stamp, the watcher would keep
            // the pet on `presenting` until the 60 s grace expired
            // even though the user has clearly seen the result.
            let open_card_app = app_handle.clone();
            app_handle.listen("pet:open-card", move |_event| {
                pet::mark_review_seen();
                pet::hide_bubble_window(&open_card_app);
                pet::show_card_window(&open_card_app);
            });

            // Card header drag → let the user manually park the card.
            // The aux-position poller respects this until the pet moves
            // again, at which point card following resumes.
            app_handle.listen("pet:card-drag-start", move |_event| {
                pet::set_card_manual_position(true);
            });

            // B2: card × button → close card, restore bubble only if there's still
            // a pending decision surfacing. Without this gate the bubble
            // pops up empty ("All clear") when the user dismissed the
            // last pending decision inside the card.
            //
            // We also stamp `mark_review_seen` so a card that the user
            // explicitly opened and then closed still counts as
            // "reviewed" — otherwise closing without clicking the
            // bubble would leave the pet pinned on `presenting`.
            let close_card_app = app_handle.clone();
            app_handle.listen("pet:close-card", move |_event| {
                pet::mark_review_seen();
                pet::hide_card_window(&close_card_app);
                pet::show_bubble_window_if_pending(&close_card_app);
            });

            // The bubble owns its own auto-dismiss lifecycle (see
            // `loomi-bubble.html::scheduleAutoHide`). When the JS timer
            // fires, the bubble emits this event asking the host to
            // hide the window. The host's `hide_bubble_window` is
            // idempotent, so a stale or duplicate request is a no-op.
            let auto_close_app = app_handle.clone();
            app_handle.listen("pet:bubble-auto-close", move |_event| {
                pet::hide_bubble_window(&auto_close_app);
            });

            // B2: "Open in dashboard" inside the card jumps to a
            // specific decision detail page (`/loop/<id>`). The webview
            // side dispatches this with `{ id: <dec_id> }`. We:
            //   1. show the main window (tray::show_main_window)
            //   2. dispatch a `openloomi:navigate-decision` DOM event with
            //      `{ id }` as detail — the chat layout listens for this
            //      and calls `router.push('/loop/<id>')` so Next.js's
            //      client-side router handles the transition (no full
            //      reload, preserves client state). Mirrors the
            //      `pet:open-settings` pattern above.
            let open_decision_app = app_handle.clone();
            app_handle.listen("pet:open-decision", move |event| {
                // `Event::payload()` returns `&str` in Tauri 2.x, so parse
                // it directly instead of wrapping in `Option::as_ref()`.
                let id = serde_json::from_str::<serde_json::Value>(event.payload())
                    .ok()
                    .and_then(|v| {
                        v.get("id")
                            .and_then(|x| x.as_str().map(|s| s.to_string()))
                    })
                    .unwrap_or_default();
                tray::show_main_window(&open_decision_app);
                if !id.is_empty() {
                    if let Some(window) =
                        open_decision_app.get_webview_window("main")
                    {
                        // Escape backslashes / quotes / newlines so the JS
                        // literal stays well-formed even with weird ids
                        // (decision ids are uuid-shaped in practice —
                        // defense in depth).
                        let escaped = id
                            .replace('\\', "\\\\")
                            .replace('"', "\\\"")
                            .replace('\n', "\\n");
                        let js = format!(
                            "window.dispatchEvent(new CustomEvent('openloomi:navigate-decision', {{ detail: {{ id: \"{}\" }} }}))",
                            escaped
                        );
                        let _ = window.eval(&js);
                    }
                }
            });

            // Pet card "Add more connectors" CTA → show the main
            // window and dispatch a new openloomi:send-chat-message
            // DOM event with the chat prompt. The new PetChatBridge
            // mounted in the (chat) layout listens for this event and
            // forwards it to the chat composer via
            // useChatContext().sendMessage(). Mirrors the
            // `pet:open-decision` event-payload pattern (same escape
            // helper for the JS literal so backslashes / quotes /
            // newlines can't break the eval). English prompt by
            // design — loomi-card.html is a static asset with no
            // runtime i18n, and the agent can translate the response
            // server-side.
            let guide_app = app_handle.clone();
            app_handle.listen("pet:guide-connect-more", move |_event| {
                eprintln!("[pet:guide-connect-more] listener fired");
                tray::show_main_window(&guide_app);
                if let Some(window) = guide_app.get_webview_window("main") {
                    let prompt = "Please help me connect more available connectors via Composio \
(Gmail, Slack, Google Calendar, GitHub, Linear, Obsidian, etc.). \
List the platforms I haven't connected yet, then walk me through \
authorizing each one. Begin with Gmail if it's not connected.";
                    // Escape the prompt for embedding in a JS string literal.
                    // (No backslashes / quotes / newlines in this prompt in
                    // practice, but the helper is copy-pasted from the
                    // pet:open-decision block for consistency / defense in
                    // depth.)
                    let escaped = prompt
                        .replace('\\', "\\\\")
                        .replace('"', "\\\"")
                        .replace('\n', "\\n");
                    // Call window.__petChatBridgeSend(text) directly,
                    // retrying every 200ms for up to 5s. We can't use a
                    // one-shot CustomEvent because the React bridge
                    // component might not be mounted yet when the eval
                    // lands (events with no listener are silently lost).
                    // A global function can be polled until the bridge
                    // registers it. The leading console.log + title
                    // change are diagnostic so we can confirm the eval
                    // is actually executing on the main webview (vs
                    // silently swallowed).
                    let js = format!(
                        "(function(){{console.log('[Tauri] eval landed, polling for bridge...');document.title='[pet] '+document.title;var n=0;var t=setInterval(function(){{n++;if(typeof window.__petChatBridgeSend==='function'){{clearInterval(t);console.log('[Tauri] bridge found after '+n+' ticks');window.__petChatBridgeSend(\"{}\");}}else if(n>25){{clearInterval(t);console.warn('[Tauri] bridge not ready after 5s, prompt dropped');}}}},200);}})()",
                        escaped
                    );
                    match window.eval(&js) {
                        Ok(_) => eprintln!("[pet:guide-connect-more] eval ok"),
                        Err(e) => eprintln!("[pet:guide-connect-more] eval err: {e}"),
                    }
                } else {
                    eprintln!("[pet:guide-connect-more] no main webview window");
                }
            });

            // B2b: "Open brief" / "Open wrap" inside the card. Brief and
            // wrap are not decisions — they're aggregate views
            // (morning brief, evening wrap) persisted to
            // ~/.openloomi/loop/brief.json / wrap.json. Routing these
            // through the decision flow used to land the user on a
            // filtered scheduled-jobs list ("tasks page") which had
            // nothing to do with the brief/wrap content. Now we
            // surface the main window and dispatch a flat DOM event —
            // the chat layout listens and pushes `/brief` or `/wrap`
            // (dedicated pages that read the JSON directly).
            let open_brief_app = app_handle.clone();
            app_handle.listen("pet:open-brief", move |_event| {
                tray::show_main_window(&open_brief_app);
                if let Some(window) = open_brief_app.get_webview_window("main") {
                    let _ = window.eval(
                        "window.dispatchEvent(new CustomEvent('openloomi:navigate-brief'))",
                    );
                }
            });
            let open_wrap_app = app_handle.clone();
            app_handle.listen("pet:open-wrap", move |_event| {
                tray::show_main_window(&open_wrap_app);
                if let Some(window) = open_wrap_app.get_webview_window("main") {
                    let _ = window.eval(
                        "window.dispatchEvent(new CustomEvent('openloomi:navigate-wrap'))",
                    );
                }
            });

            // Pet right-click menu's "Quit" entry funnels into the same
            // ExitRequested -> cleanup -> exit pipeline as the tray's
            // "Quit" item. Calling `exit(0)` re-fires ExitRequested;
            // `lifecycle::cleanup_done()` gates re-entry so we don't loop.
            let pet_to_quit = app_handle.clone();
            app_handle.listen("pet:quit", move |_event| {
                pet_to_quit.exit(0);
            });

            // Dev panel × button → hide the window (don't destroy).
            // Mirrors the `pet:close-card` pattern.
            let close_dev_app = app_handle.clone();
            app_handle.listen("pet:close-dev-panel", move |_event| {
                pet::hide_dev_panel_window(&close_dev_app);
            });

            // Dev panel toggle — emitted by future "Dev" menu items on
            // the pet right-click menu / tray. Show if currently
            // hidden, hide otherwise. Cheap because the window is built
            // at boot (when env var is set).
            let toggle_dev_app = app_handle.clone();
            app_handle.listen("pet:toggle-dev-panel", move |_event| {
                use tauri::Manager;
                let visible = toggle_dev_app
                    .get_webview_window(pet::PET_DEV_LABEL)
                    .and_then(|w| w.is_visible().ok())
                    .unwrap_or(false);
                if visible {
                    pet::hide_dev_panel_window(&toggle_dev_app);
                } else {
                    pet::show_dev_panel_window(&toggle_dev_app);
                }
            });

            Ok(())
        })
        .build(context)
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
                // Sync Dock visibility with whichever window is now in
                // front: if the main is showing, become a regular app;
                // if only the pet is showing, demote to Accessory so the
                // Dock reflects the lighter footprint.
                pet::sync_dock_policy(app_handle);
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
                    // Close the pet *before* tearing down the Node sidecar
                    // so the pet's webview doesn't try to talk to a dead
                    // backend on the way out. `lifecycle::run_cleanup`
                    // does the same on its own end via
                    // `pet::close_pet_for_exit`, but doing it here is
                    // a no-op safety net if cleanup order ever changes.
                    pet::close_pet_for_exit(&app_handle);
                    // Tear down the dev panel if it was built. No-op when
                    // OPENLOOMI_PET_DEV was unset at boot, so safe to
                    // call unconditionally.
                    pet::close_dev_panel_for_exit(&app_handle);
                    lifecycle::run_cleanup();
                    // Re-issue exit; this next ExitRequested sees cleanup_done()
                    // == true and lets the process exit.
                    app_handle.exit(0);
                });
            }
        });
}
