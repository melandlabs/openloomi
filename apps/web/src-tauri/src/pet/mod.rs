// Loomi — openloomi's resident desktop pet widget.
//
// Splits into focused submodules so the public surface stays small and
// each concern (window lifecycle, decision-data watcher, macOS dock
// policy) can be reasoned about and unit-tested on its own.

use std::sync::atomic::{AtomicUsize, Ordering};

use tauri::Emitter;

mod aux_position;
mod bubble;
mod card;
mod dev_panel;
#[cfg(target_os = "macos")]
mod dock;
mod watcher;
mod window;

pub use aux_position::{
    clear_card_manual_position, reposition_bubble_to_pet, reposition_card_to_pet,
    set_card_manual_position, spawn_position_poller,
};
pub use bubble::{
    build_bubble_window, hide_bubble_window, show_bubble_window, BUBBLE_H, BUBBLE_W,
};
pub use card::{
    build_card_window, hide_card_window, show_card_window, CARD_H, CARD_W,
};
pub use dev_panel::{
    build_dev_panel_window, close_dev_panel_for_exit, dev_panel_requested,
    hide_dev_panel_window, show_dev_panel_window, DEV_PANEL_H, DEV_PANEL_W,
};
pub use window::{
    build_pet_window, close_pet_for_exit, close_pet_for_exit_if_open, hide_pet_window,
    on_pet_moved_reposition_aux, show_pet_window,
};

pub use watcher::spawn_decision_watcher;

#[cfg(target_os = "macos")]
pub use dock::sync_dock_policy;
#[cfg(not(target_os = "macos"))]
pub fn sync_dock_policy(_app: &tauri::AppHandle) {}

/// Number of pending decisions in the loop skill's `decisions.json`,
/// maintained by the watcher on every poll (not just on change) so other
/// handlers — e.g. `pet:close-card` — can gate visibility decisions on
/// fresh data without re-reading the file.
///
/// `Release`/`Acquire` ordering pairs with the watcher's `store` so a
/// load after a successful `pending.is_empty()` check is guaranteed to
/// see the count the watcher last observed.
static PENDING_COUNT: AtomicUsize = AtomicUsize::new(0);

/// Set by the watcher on every successful poll.
pub(crate) fn set_pending_decision_count(n: usize) {
    PENDING_COUNT.store(n, Ordering::Release);
}

/// Current count of pending decisions. Cheap atomic load — safe to call
/// from any UI handler.
pub fn pending_decision_count() -> usize {
    PENDING_COUNT.load(Ordering::Acquire)
}

/// Show the bubble only if there's at least one pending decision.
/// Otherwise hide it. Used by `pet:close-card` so the bubble doesn't
/// pop up empty ("All clear") when the user dismisses the last pending
/// decision from inside the card.
pub fn show_bubble_window_if_pending(app: &tauri::AppHandle) -> bool {
    if pending_decision_count() > 0 {
        bubble::show_bubble_window(app);
        true
    } else {
        bubble::hide_bubble_window(app);
        false
    }
}

/// Window labels used both in tauri.conf.json and to look up the runtime
/// webview windows. Kept here so all submodules reference the same string.
pub const PET_LABEL: &str = "loomi-pet";
pub const PET_BUBBLE_LABEL: &str = "loomi-bubble";
pub const PET_CARD_LABEL: &str = "loomi-card";
/// Dev scene panel — only exists when `OPENLOOMI_PET_DEV=1` is set at
/// boot. Distinct label so dev-panel close logic doesn't bleed into
/// other windows.
pub const PET_DEV_LABEL: &str = "loomi-dev";

/// Gap (in logical pixels) between the pet's top edge and the bubble / card
/// bottom edge. The bubble / card windows sit anchored *above* the pet
/// (see `aux_position::position_above_pet`), so this gap is the vertical
/// space between the aux window's bottom and the pet's top. Picked to
/// match the visual weight of the tail in the HTML.
pub const PET_AUX_GAP: f64 = 4.0;

/// Tauri command invoked by the dev panel (`loomi-dev.html`) when a
/// state chip or a Forms 1–3 button is clicked. Re-emits
/// `{ "state": <key> }` to PET_LABEL + PET_BUBBLE_LABEL via
/// `emit_to` so the pet sprite + bubble text update.
///
/// Defined at `pet::` scope (not in `dev_panel`) on purpose —
/// `tauri::generate_handler!` resolves the `__cmd__...` /
/// `__tauri_command_name_...` siblings that `#[tauri::command]`
/// emits via the path written in the macro arg list. Re-exporting
/// the function across modules compiles fine, but the runtime
/// invoke fails with `command not found`. Keeping the command here
/// (alongside PET_LABEL / PET_BUBBLE_LABEL, which it uses) keeps the
/// macro's symbol resolution working.
///
/// The signature mirrors the rest of the codebase (no generic
/// `R: tauri::Runtime` — the macro registers the command under the
/// bare name `emit_dev_state` and matches the JS call site
/// `t.core.invoke("emit_dev_state", { state })`).
///
/// The command is registered unconditionally — the only callers in
/// the codebase are the dev panel (which only exists when
/// `OPENLOOMI_PET_DEV=1`) and tests. Invoking it without those
/// sinks just no-ops the `emit_to` calls.
#[tauri::command]
pub async fn emit_dev_state(
    app: tauri::AppHandle,
    state: String,
) -> Result<(), String> {
    let trimmed = state.trim();
    if trimmed.is_empty() {
        return Err("state key required".into());
    }
    let payload = serde_json::json!({ "state": trimmed });
    let _ = app.emit_to(PET_LABEL, "loop:state", payload.clone());
    let _ = app.emit_to(PET_BUBBLE_LABEL, "loop:state", payload);
    Ok(())
}
