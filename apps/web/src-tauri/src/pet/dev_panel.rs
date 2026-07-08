// Dev scene panel window — only spawned when `OPENLOOMI_PET_DEV=1` is
// set, so the production build never sees it. Lives in its own module
// because it's gated by an env var and we don't want a casual `mod`
// listing in pet/mod.rs to leak the dev affordance into a release
// binary.
//
// The panel hosts the 8 demo forms from
// /Users/timi/Downloads/openloomi-aha-moment-demo/index.html. Forms
// 4–8 (low-priority todo / decision briefing / morning brief / night
// wrap / proactive cases) POST /api/loop/dev/scene which injects a
// real `LoopDecision` payload into ~/.openloomi/loop/decisions.json;
// the watcher then pushes it into the bubble + card UI unchanged.
// Forms 1–3 (connection check / judgment system / noise reduction)
// don't have dedicated pet-side UI yet, so the panel renders inline
// captions for those — see lib/loop/dev-scenes.ts for the audit.
//
// Lifecycle:
//   build   — once on app boot (only when env var is set)
//   show    — called by the pet's right-click menu / future dev hooks
//   hide    — called by `pet:close-dev-panel` (panel × button) and
//             unconditionally on `pet:close-pent` exit-cleanup
//   destroy — `close_pet_for_exit_if_open` is wrong here (this isn't
//             the pet), but we expose `close_dev_panel_for_exit` so
//             shutdown tears it down.

use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use super::{PET_BUBBLE_LABEL, PET_DEV_LABEL, PET_LABEL};
use crate::constants;

/// Logical (CSS) width of the dev panel window. Matches `--w` in
/// `loomi-dev.html`. Wider than the bubble so the pet-state chip grid
/// (3 cols × 3 rows + the 8 scene buttons) fits without cramping.
pub const DEV_PANEL_W: f64 = 340.0;
/// Logical (CSS) height. 800px keeps the panel inside 13"-class
/// screens (typical usable 770-820px after a 28px macOS title bar) so
/// the footer + Form 8 are visible without scrolling, and no part of
/// the panel slides below the screen edge (880 slipped below).
pub const DEV_PANEL_H: f64 = 800.0;

static DEV_PANEL_APP_HANDLE: OnceLock<Mutex<Option<AppHandle>>> =
    OnceLock::new();

fn dev_panel_handle_slot() -> &'static Mutex<Option<AppHandle>> {
    DEV_PANEL_APP_HANDLE.get_or_init(|| Mutex::new(None))
}

/// True when the current build should expose the dev panel. Reads
/// `OPENLOOMI_PET_DEV` once and memoizes for the process lifetime —
/// flipping it after the pet window is built has no effect (the panel
/// is gated on first build, not lazily per-show).
pub fn dev_panel_requested() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| {
        std::env::var("OPENLOOMI_PET_DEV")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
    })
}

/// Build the dev panel window if it doesn't exist yet and dev mode is
/// enabled. Returns `Ok(None)` when dev mode is disabled so the caller
/// can skip without a noisy error.
pub fn build_dev_panel_window(
    app: &AppHandle,
) -> tauri::Result<Option<tauri::WebviewWindow>> {
    if !dev_panel_requested() {
        return Ok(None);
    }
    if let Ok(mut g) = dev_panel_handle_slot().lock() {
        *g = Some(app.clone());
    }
    if let Some(w) = app.get_webview_window(PET_DEV_LABEL) {
        return Ok(Some(w));
    }
    let base = WebviewWindowBuilder::new(
        app,
        PET_DEV_LABEL,
        WebviewUrl::App("loomi-dev.html".into()),
    )
    .initialization_script(&constants::api_init_script())
    .title("Loomi · dev panel")
    .inner_size(DEV_PANEL_W, DEV_PANEL_H)
    .min_inner_size(DEV_PANEL_W, DEV_PANEL_H)
    .max_inner_size(DEV_PANEL_W, DEV_PANEL_H)
    .resizable(false)
    .decorations(true) // keep standard window chrome for the dev panel
    .transparent(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(true)
    .visible(true)
    .focused(false);
    // `drag_and_drop` only exists on the Windows webview builder, so we
    // gate the call to keep the build green everywhere. Not strictly
    // needed for a dev panel that never sees file drops, but kept
    // consistent with the bubble / card builders in this module.
    #[cfg(windows)]
    let builder = base.drag_and_drop(false);
    #[cfg(not(windows))]
    let builder = base;

    let w = builder.build()?;
    // CloseRequested → hide. Decorations(true) gives the panel a real
    // OS close button; intercepting + hiding keeps the webview warm
    // so re-opens are instant.
    let app_handle = app.clone();
    let label = PET_DEV_LABEL.to_string();
    w.on_window_event(move |ev| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = ev {
            api.prevent_close();
            if let Some(win) = app_handle.get_webview_window(&label) {
                let _ = win.hide();
            }
        }
    });
    Ok(Some(w))
}

/// Show the panel. If dev mode wasn't enabled at boot, builds the
/// window on first call (no-op when already built).
pub fn show_dev_panel_window(app: &AppHandle) {
    if app.get_webview_window(PET_DEV_LABEL).is_none() {
        // No-op when dev mode was off at boot; the env var is sticky
        // for the process lifetime.
        if build_dev_panel_window(app).ok().flatten().is_none() {
            return;
        }
    }
    if let Some(w) = app.get_webview_window(PET_DEV_LABEL) {
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.set_always_on_top(true);
    }
}

/// Hide the panel. Safe to call when the window doesn't exist (no-op).
pub fn hide_dev_panel_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(PET_DEV_LABEL) {
        let _ = w.hide();
    }
}

/// Tear down the dev panel during a real app exit. Distinct from
/// `hide_dev_panel_window` — this calls `close()` so the webview's
/// resources are actually freed.
pub fn close_dev_panel_for_exit(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(PET_DEV_LABEL) {
        let _ = w.close();
    }
}
