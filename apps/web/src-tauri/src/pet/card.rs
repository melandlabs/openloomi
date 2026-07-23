// Decision card window: larger always-on-top webview shown on demand
// (typically by clicking the bubble or the pet itself while there is a
// pending decision). Loads `public/loomi-card.html` which provides a
// full decision card with Open / Dismiss / Run-in-dashboard actions.
//
// Unlike the bubble, the card is *not* managed by the watcher — the
// host only shows it in response to a user gesture (`pet:open-card` from
// the bubble, or `pet:open-dashboard` from the pet's click handler when
// there is a pending decision). Hide is triggered by either the card's
// own × button (`pet:close-card`) or the host when there are no more
// pending decisions.

use std::sync::{Mutex, OnceLock};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use super::PET_CARD_LABEL;
use crate::constants;

/// Logical (CSS) width of the card window. Matches `--card-w` in
/// `loomi-card.html`.
pub const CARD_W: f64 = 360.0;
/// Logical (CSS) height of the card window. Matches `--card-h`.
pub const CARD_H: f64 = 420.0;

static CARD_APP_HANDLE: OnceLock<Mutex<Option<AppHandle>>> = OnceLock::new();

fn card_handle_slot() -> &'static Mutex<Option<AppHandle>> {
    CARD_APP_HANDLE.get_or_init(|| Mutex::new(None))
}

// ---------------------------------------------------------------------------
// Cached connector snapshot — kept in sync with `lib/loop/connectors.ts`
// ---------------------------------------------------------------------------

/// Mirrors the shape persisted by `writeConnectorSnapshot` in
/// `apps/web/lib/loop/connectors.ts`. Two top-level shapes are tolerated:
///
///   * `{ fetchedAt, connectors: [...] }`  — current `writeConnectorSnapshot`.
///   * `{ updatedAt, connectors: [...] }`  — older / external writers.
///
/// We only need `connectors` for the card emit (the renderer derives the
/// pill row + "Last checked" stamp itself), so we keep the struct minimal.
#[derive(Debug, Deserialize)]
struct ConnectorSnapshot {
    #[serde(default)]
    connectors: Option<serde_json::Value>,
}

/// Read the cached connector snapshot the watcher / connector probe wrote
/// to `~/.openloomi/loop/connectors.json`. Returns `None` if the file is
/// missing, unreadable, or carries no `connectors` array.
///
/// Best-effort by design: the watcher is the source of truth, but the
/// card window needs something to render even before the first probe
/// completes. A failure here just means we emit no `loop:connectors`
/// payload — the card's own `refreshConnectors()` listener kicks in and
/// pulls `/api/loop/connectors` over HTTP, so the user never sees a
/// permanently-stale card just because the snapshot read failed.
fn read_connector_snapshot() -> Option<serde_json::Value> {
    use std::fs;
    let home = std::env::var_os("HOME")?;
    let path = std::path::PathBuf::from(home)
        .join(".openloomi")
        .join("loop")
        .join("connectors.json");
    let raw = fs::read_to_string(&path).ok()?;
    let parsed: ConnectorSnapshot = serde_json::from_str(&raw).ok()?;
    parsed.connectors
}

/// Emit the cached connector snapshot to the card window.
///
/// #376 — the card webview is built once and reused (hidden → shown).
/// Before this fix the snapshot only reached the card via the initial
/// `refreshConnectors()` call at page-load time, which meant a card
/// opened *before* the first probe completed would render "No sources
/// connected" forever — even after the watcher wrote healthy entries.
/// Re-emitting the cached snapshot on every card open gives the listener
/// a starting point even when the webview's in-memory `connectors` is
/// still empty. The listener falls through to its own fetch when it
/// receives a fresh payload, so a missing snapshot file just means the
/// listener fires its HTTP path on the next compact open.
fn emit_connector_snapshot_to_card(app: &AppHandle) {
    let Some(connectors) = read_connector_snapshot() else {
        return;
    };
    let payload = serde_json::json!({ "items": connectors });
    let _ = app.emit_to(PET_CARD_LABEL, "loop:connectors", payload);
}

/// Build the card window if it doesn't exist yet. Idempotent.
pub fn build_card_window(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    if let Ok(mut g) = card_handle_slot().lock() {
        *g = Some(app.clone());
    }
    if let Some(w) = app.get_webview_window(PET_CARD_LABEL) {
        return Ok(w);
    }
    let base = WebviewWindowBuilder::new(
        app,
        PET_CARD_LABEL,
        WebviewUrl::App("loomi-card.html".into()),
    )
    .initialization_script(&constants::api_init_script())
    .title("Loomi · card")
    .inner_size(CARD_W, CARD_H)
    .min_inner_size(CARD_W, CARD_H)
    .max_inner_size(CARD_W, CARD_H)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .shadow(false)
    .visible(false)
    .focused(false)
    // `.focusable(true)` is still required: Tauri's `TaoWindow`
    // overrides `canBecomeKeyWindow` to read this flag, and the
    // card explicitly opts into the class-swap path
    // (`configure_as_floating_panel_with(&w, false)`) so the
    // underlying NSWindow stays a TaoWindow / NSWindow with
    // `canBecomeKeyWindow` returning YES. Without this flag the
    // window would silently refuse `becomeKeyWindow` and the
    // Subject / Body inputs would never accept focus on click.
    // See `configure_as_floating_panel_with` doc-comment for the
    // full diagnosis of why the card skips the swap.
    .focusable(true)
    // Same rationale as the pet window — the very first click that
    // lands inside the card (typically the "↗ Edit" button in the
    // footer) has to be delivered to the webview before the window
    // has had a chance to promote to key; without this opt-in the
    // first click silently no-ops on cold launch.
    .accept_first_mouse(true);
    // `drag_and_drop` is only present on the Windows webview builder, so
    // we gate the call to keep the build green everywhere. On macOS /
    // Linux the OS file-drop target still gets opted out via the
    // window's runtime configuration, but for the card (a transient
    // action surface) this is a non-issue.
    #[cfg(windows)]
    let builder = base.drag_and_drop(false);
    #[cfg(not(windows))]
    let builder = base;

    let w = builder.build()?;
    // Card: skip the NSPanel class swap. After the swap, AppKit
    // dispatches `canBecomeKeyWindow` through NSPanel's default (NO),
    // which silently rejects `becomeKeyWindow` and prevents
    // `<textarea>` / `<input>` inside the webview from accepting
    // focus. The card is a user-invoked surface, not a passive
    // overlay, so it should accept keyboard input on click. See
    // `configure_as_floating_panel_with` for the full diagnosis.
    super::macos_window::configure_as_floating_panel_with(&w, false);
    super::macos_window::configure_for_all_spaces(&w);
    let app_handle = app.clone();
    let label = PET_CARD_LABEL.to_string();
    w.on_window_event(move |ev| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = ev {
            api.prevent_close();
            if let Some(win) = app_handle.get_webview_window(&label) {
                let _ = win.set_ignore_cursor_events(true);
                let _ = win.hide();
            }
        }
    });
    Ok(w)
}

/// Show the card. Called from the pet-click and bubble-click handlers
/// when there is a pending decision. If the window doesn't exist yet
/// the first call builds it.
///
/// `compact = true` opens the card in the user-facing idle / status
/// mode introduced by #365 (title + subtitle + last-checked + sources +
/// Collapse / Open Loop buttons). The card webview listens for
/// `loop:card-mode` and immediately swaps its `data-active-mode`
/// attribute; this is emitted BEFORE `show()` so the JS handler is in
/// place before the first paint. Subsequent `loop:decision` /
/// `loop:pending-list` events still flow into the same window, so a
/// pending decision landing after a compact open transitions the card
/// into the full decision layout without an extra rebuild.
pub fn show_card_window(app: &AppHandle) {
    show_card_window_with(app, false);
}

/// Compact-mode sibling of `show_card_window`. Same window, same
/// positioning, but opens in the #365 idle/status surface so the user
/// sees a quiet, plain-language answer to "what is Loomi doing?" rather
/// than the full decision card chrome.
pub fn show_card_compact_window(app: &AppHandle) {
    show_card_window_with(app, true);
}

fn show_card_window_with(app: &AppHandle, compact: bool) {
    super::aux_position::clear_card_manual_position();
    super::aux_position::reposition_card_to_pet(app);
    // Emit the mode hint BEFORE the first paint so the JS handler can
    // set `data-active-mode` on the card root synchronously. Without
    // this the card would briefly show the full-mode chrome before
    // swapping to compact, which (on slower machines) is a visible
    // flash. Same payload shape on every open — listeners that don't
    // care about the mode field ignore it.
    let _ = app.emit_to(
        PET_CARD_LABEL,
        "loop:card-mode",
        serde_json::json!({ "compact": compact }),
    );
    // #376 — push the cached connector snapshot to the card so its
    // `loop:connectors` listener can populate `connectors` immediately,
    // even when the card webview was hidden and reused since the last
    // probe. The listener still falls through to its own HTTP refresh
    // on the `loop:card-mode` emit above, so this is a fast-path fill,
    // not a replacement for the network fetch.
    emit_connector_snapshot_to_card(app);
    if let Some(w) = app.get_webview_window(PET_CARD_LABEL) {
        let _ = w.set_ignore_cursor_events(false);
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.set_always_on_top(true);
        let _ = w.set_visible_on_all_workspaces(true);
        // Re-apply the floating-panel configuration on every show so
        // a transient rebuild of the underlying NSWindow doesn't
        // quietly strip our overlay-level + collection-behavior
        // setup. We deliberately do NOT swap the class to NSPanel
        // here — see the doc-comment in `build_card_window`.
        super::macos_window::configure_as_floating_panel_with(&w, false);
        super::macos_window::configure_for_all_spaces(&w);
        return;
    }
    if let Err(e) = build_card_window(app) {
        log::warn!("[loop-pet] show_card_window: build failed: {e}");
    }
    if let Some(w) = app.get_webview_window(PET_CARD_LABEL) {
        let _ = w.set_ignore_cursor_events(false);
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.set_always_on_top(true);
        let _ = w.set_visible_on_all_workspaces(true);
        // Re-apply the floating-panel configuration on every show so
        // a transient rebuild of the underlying NSWindow doesn't
        // quietly strip our overlay-level + collection-behavior
        // setup. Same rationale as the other branch — skip the
        // NSPanel swap so Subject / Body inputs can accept keyboard
        // focus.
        super::macos_window::configure_as_floating_panel_with(&w, false);
        super::macos_window::configure_for_all_spaces(&w);
    }
}

/// Hide the card without destroying it. State (last rendered decision)
/// is preserved in the DOM.
pub fn hide_card_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(PET_CARD_LABEL) {
        let _ = w.set_ignore_cursor_events(true);
        let _ = w.hide();
    }
}
