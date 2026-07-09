// Speech-bubble window: a small always-on-top webview anchored to the
// right of the pet. Loads `public/loomi-bubble.html` (a self-contained
// glass bubble with title + dialogue). Visibility is decided by the
// watcher (`watcher::spawn_decision_watcher`); lifecycle helpers here
// only build / show / hide and are also called from `aux_position` when
// the pet moves so the bubble tracks the pet.

use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use super::PET_BUBBLE_LABEL;
use crate::constants;

/// Logical (CSS) width of the bubble window. Matches `--bubble-w` in
/// `loomi-bubble.html`. The host reads this to anchor the bubble above
/// the pet, horizontally centered on it.
pub const BUBBLE_W: f64 = 320.0;
/// Logical (CSS) height of the bubble window. Matches `--bubble-h` in
/// `loomi-bubble.html`. 84px to fit a 2-line speech + the downward
/// tail + a small overlap with the blue dot; the dot's CSS `bottom: 4px`
/// keeps it near the window's bottom edge so the tail tip still anchors
/// to the pet (~7px above pet top with `PET_AUX_GAP = 4`).
pub const BUBBLE_H: f64 = 84.0;

static BUBBLE_APP_HANDLE: OnceLock<Mutex<Option<AppHandle>>> = OnceLock::new();

fn bubble_handle_slot() -> &'static Mutex<Option<AppHandle>> {
    BUBBLE_APP_HANDLE.get_or_init(|| Mutex::new(None))
}

/// Build the bubble window if it doesn't exist yet. Idempotent: callers
/// from `aux_position::reposition` re-invoke this on every pet move, so
/// the first call creates the window and subsequent calls short-circuit
/// on the `get_webview_window` check.
pub fn build_bubble_window(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    if let Ok(mut g) = bubble_handle_slot().lock() {
        *g = Some(app.clone());
    }
    if let Some(w) = app.get_webview_window(PET_BUBBLE_LABEL) {
        return Ok(w);
    }
    let base = WebviewWindowBuilder::new(
        app,
        PET_BUBBLE_LABEL,
        WebviewUrl::App("loomi-bubble.html".into()),
    )
    .initialization_script(&constants::api_init_script())
    .title("Loomi · bubble")
    .inner_size(BUBBLE_W, BUBBLE_H)
    .min_inner_size(BUBBLE_W, BUBBLE_H)
    .max_inner_size(BUBBLE_W, BUBBLE_H)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .shadow(false)
    .visible(false)
    .focused(false);
    // `drag_and_drop` is only present on the Windows webview builder, so
    // we gate the call to keep the build green everywhere. On macOS /
    // Linux the OS file-drop target still gets opted out via the
    // window's runtime configuration, but for the bubble (a tiny glass
    // panel) this is a non-issue.
    #[cfg(windows)]
    let builder = base.drag_and_drop(false);
    #[cfg(not(windows))]
    let builder = base;

    let w = builder.build()?;
    // CloseRequested → hide (so the OS × button on the bubble isn't a
    // destroy gesture). Tauri's webview window has decorations(false) so
    // this branch is only hit if the user wires a close shortcut in the
    // bubble HTML itself; we still wire it for safety.
    let app_handle = app.clone();
    let label = PET_BUBBLE_LABEL.to_string();
    w.on_window_event(move |ev| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = ev {
            api.prevent_close();
            if let Some(win) = app_handle.get_webview_window(&label) {
                let _ = win.hide();
            }
        }
    });
    Ok(w)
}

/// Show the bubble at its current position (set previously by
/// `aux_position::reposition_bubble_to_pet`). If the window hasn't been
/// built yet this is a no-op — the watcher's first show call will
/// trigger the build.
///
/// Both the bubble and the card are `always_on_top(true)`, so they sit
/// in the same OS float layer and their relative z-order is whatever
/// was touched last. The bubble is a transient notification and must
/// visually sit on top of the card, so we `set_focus()` after show —
/// on macOS / Windows that brings the bubble to the front of the float
/// layer; on Linux (depending on WM) the same is true for most
/// compositors. The bubble has no focusable inputs, so the focus grab
/// is harmless.
pub fn show_bubble_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(PET_BUBBLE_LABEL) {
        let _ = w.show();
        let _ = w.set_always_on_top(true);
        let _ = w.set_visible_on_all_workspaces(true);
        let _ = w.set_focus();
        // Tell the bubble's JS to (re)arm its auto-dismiss timer. The
        // bubble owns the dismiss lifecycle (see
        // `loomi-bubble.html::scheduleAutoHide`) because JS-side
        // `setTimeout` is more robust than a Rust thread when the
        // watcher re-emits `loop:decision` rapidly.
        let _ = w.emit("pet:bubble-shown", ());
    }
}

/// Hide the bubble without destroying it. The webview keeps its DOM
/// state, so re-showing lands on the same content the watcher last
/// pushed.
pub fn hide_bubble_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(PET_BUBBLE_LABEL) {
        let _ = w.hide();
    }
}
