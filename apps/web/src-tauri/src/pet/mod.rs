// Loomi — openloomi's resident desktop pet widget.
//
// Splits into focused submodules so the public surface stays small and
// each concern (window lifecycle, decision-data watcher, macOS dock
// policy) can be reasoned about and unit-tested on its own.

#[cfg(target_os = "macos")]
mod dock;
mod watcher;
mod window;

pub use window::{
    build_pet_window, close_pet_for_exit, close_pet_for_exit_if_open, hide_pet_window,
    show_pet_window,
};

pub use watcher::spawn_decision_watcher;

#[cfg(target_os = "macos")]
pub use dock::sync_dock_policy;
#[cfg(not(target_os = "macos"))]
pub fn sync_dock_policy(_app: &tauri::AppHandle) {}

/// Window label used both in tauri.conf.json and to look up the runtime
/// webview window. Kept here so all submodules reference the same string.
pub const PET_LABEL: &str = "loomi-pet";
