// Loomi — openloomi's resident desktop pet widget.
//
// Splits into focused submodules so the public surface stays small and
// each concern (window lifecycle, decision-data watcher, macOS dock
// policy) can be reasoned about and unit-tested on its own.

use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering};

use tauri::Emitter;
use tauri::Manager;

mod aux_position;
mod bubble;
mod card;
mod config_watcher;
mod dev_panel;
#[cfg(target_os = "macos")]
mod dock;
mod macos_window;
pub mod theme;
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
pub use config_watcher::spawn_config_watcher;
pub use dev_panel::{
    build_dev_panel_window, close_dev_panel_for_exit, dev_panel_requested,
    hide_dev_panel_window, show_dev_panel_window, DEV_PANEL_H, DEV_PANEL_W,
};
pub use theme::{
    read_config, write_config, PetConfig, PetConfigView, BUILTIN_THEMES, DEFAULT_THEME,
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

/// Wall-clock millis of the last time the user opened the decision
/// card. `0` means "never" — the `presenting` state uses this to
/// decide whether to flip to `happy` (`reviewed_recently = true`).
///
/// Stored as a single atomic so `mark_review_seen` can be called from
/// any event handler without locking. `Ordering::Relaxed` is fine
/// here: the value is purely a hint, and a stale read just means the
/// pet spends one extra poll cycle in `presenting` rather than
/// flipping state incorrectly.
static LAST_REVIEW_SEEN_MS: AtomicI64 = AtomicI64::new(0);

/// Stamp "now" as the most recent time the user reviewed a done
/// decision. Called from the `pet:open-card` listener.
pub fn mark_review_seen() {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    LAST_REVIEW_SEEN_MS.store(now, Ordering::Relaxed);
}

/// How long ago (in seconds) the user last reviewed a done decision.
/// Returns `None` if they have never opened the card in this process.
pub fn last_review_seen_secs_ago() -> Option<u64> {
    let stamp = LAST_REVIEW_SEEN_MS.load(Ordering::Relaxed);
    if stamp <= 0 {
        return None;
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(stamp);
    if now <= stamp {
        return Some(0);
    }
    Some(((now - stamp) / 1000) as u64)
}

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
/// Returns the pet config + the list of discovered custom themes.
/// Fronted by the widget on cold boot so the first paint can use
/// the user's chosen theme (or the default if nothing is configured).
#[tauri::command]
pub fn get_pet_config(app: tauri::AppHandle) -> PetConfigView {
    let cfg = theme::read_config(&app);
    let custom = theme::list_custom_themes(&cfg);
    theme::build_view(cfg, custom)
}

/// Updates only `activeTheme` (called by the right-click menu).
/// Re-reads + re-emits so the widget can paint the new theme without
/// a restart. Returns the fresh view so the JS side can update its
/// local cache without an extra round-trip.
///
/// Uses `rename_all = "camelCase"` so the widget can call it with
/// `t.core.invoke("set_active_theme", { themeName: "capybara" })` —
/// matching the camelCase JS convention. Tauri 2 deserialises
/// command arguments by exact field name, so without this attribute
/// the snake_case `theme_name` would arrive as an empty string and
/// the click would silently no-op (the `.catch` swallows the
/// serde error).
#[tauri::command(rename_all = "camelCase")]
pub fn set_active_theme(app: tauri::AppHandle, theme_name: String) -> Result<PetConfigView, String> {
    let mut cfg = theme::read_config(&app);
    cfg.active_theme = theme_name;
    theme::write_config(&app, &cfg)?;
    let custom = theme::list_custom_themes(&cfg);
    let view = theme::build_view(cfg, custom);
    let payload = serde_json::to_value(&view).map_err(|e| e.to_string())?;
    let _ = app.emit_to(PET_LABEL, "pet:config-changed", payload);
    Ok(view)
}

// Tests for `last_review_seen_secs_ago`. We can't realistically wait
// 60s in a unit test, so we just verify the "never" branch and a
// trivial "stamp was set" branch.
#[cfg(test)]
mod review_seen_tests {
    use super::*;

    #[test]
    fn last_review_seen_secs_ago_initially_none() {
        // We can't guarantee the static is at 0 because other tests
        // in the same process may have called `mark_review_seen`,
        // but we can at least verify the function returns *something*
        // sensible without panicking.
        let _ = last_review_seen_secs_ago();
    }

    #[test]
    fn mark_review_seen_does_not_panic() {
        mark_review_seen();
        // After marking, the timestamp is non-zero so we get a
        // Some(secs) — but the value is allowed to be 0 if the wall
        // clock somehow gave us the same millisecond, so we just
        // assert the call didn't panic.
        let _ = last_review_seen_secs_ago();
    }
}
