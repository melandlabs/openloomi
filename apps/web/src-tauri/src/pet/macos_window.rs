// macOS Space behavior shared by the resident pet and its auxiliary windows.
//
// Tauri's `visible_on_all_workspaces(true)` sets `CanJoinAllSpaces`, but a
// window still needs `FullScreenAuxiliary` to appear above another app's
// native full-screen Space. Without it the pet can be dragged between regular
// desktops but disappears or stops at a display occupied by a full-screen app.

const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
const FULL_SCREEN_AUXILIARY: usize = 1 << 8;

fn collection_behavior_for_pet(current: usize) -> usize {
    current | CAN_JOIN_ALL_SPACES | FULL_SCREEN_AUXILIARY
}

#[cfg(target_os = "macos")]
pub fn configure_for_all_spaces(window: &tauri::WebviewWindow) {
    use objc2::{msg_send, runtime::AnyObject};

    let label = window.label().to_string();
    let label_on_main = label.clone();
    let window_on_main = window.clone();
    if let Err(error) = window.run_on_main_thread(move || {
        let raw = match window_on_main.ns_window() {
            Ok(raw) if !raw.is_null() => raw.cast::<AnyObject>(),
            Ok(_) => {
                log::warn!("[loop-pet] {label_on_main}: NSWindow pointer was null");
                return;
            }
            Err(error) => {
                log::warn!("[loop-pet] {label_on_main}: NSWindow lookup failed: {error}");
                return;
            }
        };

        unsafe {
            let current: usize = msg_send![raw, collectionBehavior];
            let desired = collection_behavior_for_pet(current);
            let _: () = msg_send![raw, setCollectionBehavior: desired];
        }
    }) {
        log::warn!("[loop-pet] {label}: macOS Space configuration failed: {error}");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn configure_for_all_spaces(_window: &tauri::WebviewWindow) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_join_all_spaces_and_fullscreen_auxiliary() {
        assert_eq!(
            collection_behavior_for_pet(0),
            CAN_JOIN_ALL_SPACES | FULL_SCREEN_AUXILIARY
        );
    }

    #[test]
    fn preserves_existing_collection_behavior_flags() {
        let existing = (1 << 1) | (1 << 7);
        assert_eq!(
            collection_behavior_for_pet(existing),
            existing | CAN_JOIN_ALL_SPACES | FULL_SCREEN_AUXILIARY
        );
    }
}
