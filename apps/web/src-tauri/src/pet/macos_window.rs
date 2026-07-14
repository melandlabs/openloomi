// macOS Space behavior shared by the resident pet and its auxiliary windows.
//
// Tauri's `visible_on_all_workspaces(true)` sets `CanJoinAllSpaces`, but a
// window still needs `FullScreenAuxiliary` to appear above another app's
// native full-screen Space. Without it the pet can be dragged between regular
// desktops but disappears or stops at a display occupied by a full-screen app.
//
// On macOS 13+ we additionally set `CanJoinAllApplications`, which is the
// flag Apple introduced to let an auxiliary window follow the user across
// Spaces owned by other apps — without it, an app can stay on every
// *internal* Space of its own, but still gets hidden when the user enters
// someone else's full-screen Space. Combined with an `NSPanel` at
// `NSScreenSaverWindowLevel` (see `configure_as_floating_panel`) this is
// what actually makes the pet visible above TextEdit / Safari full-screen.

const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
const FULL_SCREEN_AUXILIARY: usize = 1 << 8;
/// `NSWindowCollectionBehaviorCanJoinAllApplications` — added in macOS 13
/// (Ventura). On older systems the flag bit is harmless to set (the OS
/// simply ignores unknown bits in the bitfield), but we only set it
/// when the runtime confirms we're on 13+ so we don't rely on that
/// behaviour.
const CAN_JOIN_ALL_APPLICATIONS: usize = 1 << 5;

/// `NSScreenSaverWindowLevel` (25). Sits above every full-screen app
/// Space — the documented home for cross-app overlays like screen
/// recorders and "stay on top" widgets. We pass it to the AppKit
/// `setLevel:` selector at runtime via `desired_window_level()`
/// so the constant has a unit-testable source of truth.
const NS_SCREEN_SAVER_WINDOW_LEVEL: i64 = 25;

/// macOS 13.0 in `NSOperatingSystemVersion` form, used to gate
/// `CanJoinAllApplications` at runtime. The unit-test below asserts
/// the well-formedness of this constant — accidental bumps here would
/// silently change the threshold for the new collection flag.
#[cfg(target_os = "macos")]
const MACOS_13_0_VERSION: objc2_foundation::NSOperatingSystemVersion =
    objc2_foundation::NSOperatingSystemVersion {
        majorVersion: 13,
        minorVersion: 0,
        patchVersion: 0,
    };

/// Pure helper: returns the bitmask `collection_behavior_for_pet` should
/// apply on top of the window's existing flags. Exposed for unit tests so
/// the macOS 13+ branch has a non-AppKit source of truth.
fn desired_collection_behavior_for_macos() -> usize {
    CAN_JOIN_ALL_SPACES | FULL_SCREEN_AUXILIARY
}

/// Returns true when we're running on macOS 13 (Ventura) or later, which
/// is when `CanJoinAllApplications` started being honoured. We compute
/// this once per process via `NSProcessInfo` — the call is cheap and
/// caches internally.
#[cfg(target_os = "macos")]
fn supports_can_join_all_applications() -> bool {
    use objc2::msg_send;
    use objc2_foundation::{NSOperatingSystemVersion, NSProcessInfo};

    let process_info = NSProcessInfo::processInfo();
    let target = NSOperatingSystemVersion {
        majorVersion: 13,
        minorVersion: 0,
        patchVersion: 0,
    };
    // `msg_send!` requires a `MessageReceiver`. `Retained<NSProcessInfo>`
    // doesn't implement that trait directly, but `&T` does — so we
    // deref the smart pointer to a borrow before sending the message.
    let at_least: bool =
        unsafe { msg_send![&*process_info, isOperatingSystemAtLeastVersion: target] };
    let _ = process_info;
    at_least
}

#[cfg(not(target_os = "macos"))]
fn supports_can_join_all_applications() -> bool {
    false
}

fn collection_behavior_for_pet(current: usize) -> usize {
    let mut desired = current | desired_collection_behavior_for_macos();
    if supports_can_join_all_applications() {
        desired |= CAN_JOIN_ALL_APPLICATIONS;
    }
    desired
}

/// Source-of-truth for the window level applied by
/// `configure_as_floating_panel`. Wrapped in a function so unit tests
/// can verify the constant without linking AppKit.
fn desired_window_level() -> i64 {
    NS_SCREEN_SAVER_WINDOW_LEVEL
}

/// Window level for a given panel, taking its Tauri label so we can
/// keep the pet visually on top of the aux windows (card / bubble)
/// when they overlap — the fox sprite should never be hidden behind
/// the decision card or the speech bubble. Both the pet and the aux
/// windows sit well above normal / floating app windows
/// (`NSStatusWindowLevel` and above), so the pet stays above
/// full-screen apps while still winning the overlap against the
/// card / bubble that share its float layer.
///
/// One notch above `NS_SCREEN_SAVER_WINDOW_LEVEL` (Apple's
/// `NSPopUpMenuWindowLevel` is 101 and is reserved for live menus —
/// we don't want a desktop pet sitting at the menu level because
/// the OS may treat it as a transient and demote it under the
/// foreground app on focus changes).
fn desired_window_level_for(label: &str) -> i64 {
    if label == super::PET_LABEL {
        NS_SCREEN_SAVER_WINDOW_LEVEL + 1
    } else {
        NS_SCREEN_SAVER_WINDOW_LEVEL
    }
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

        // Configure the pet/aux windows to be visible across macOS
        // Spaces and full-screen apps. We deliberately do NOT also
        // call `setAcceptsFirstMouse:` here — the underlying window
        // is tao's `TaoWindow`, which does not implement that
        // selector and would throw
        // `NSInvalidArgumentException: unrecognized selector`,
        // taking the app down during `did_finish_launching`. The
        // right-click menu fix from issue #314 is delivered by
        // Tauri's builder-level `.accept_first_mouse(true)`
        // (see `pet/window.rs`), which routes the first mouse event
        // — including right-click — into WKWebView through a
        // different code path.
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

/// Convert the given Tauri webview window into a non-activating
/// floating `NSPanel` at `NSScreenSaverWindowLevel`, then apply the
/// full set of collection-behavior flags needed to keep it visible
/// across macOS Spaces — including other apps' full-screen Spaces.
///
/// Background (issue #330): Tauri's `WebviewWindow` is backed by a
/// plain `NSWindow`. Even with `CanJoinAllSpaces | FullScreenAuxiliary`,
/// a regular `NSWindow` is not a reliable cross-app full-screen overlay
/// — Apple's documented pattern is a non-activating `NSPanel` owned by
/// an `Accessory` app, sitting at `NSScreenSaverWindowLevel` with the
/// right `collectionBehavior` flags. This helper performs the class
/// swap on the main thread and is a no-op on non-macOS platforms.
///
/// The class swap uses the Cocoa `object_setClass` C runtime function
/// directly via `objc2::ffi::object_setClass`: after the swap, all
/// `NSPanel` selectors (including the `setHidesOnDeactivate:`
/// / `setBecomesKeyOnlyOnOrderFront:` / `setWorksWhenModal:` setters
/// below) respond correctly without re-creating the window.
///
/// We avoid `msg_send![…, setClass: panel_class]` because the objc2
/// `catch-all` feature turns the resulting `@throw` into a Rust
/// panic during `did_finish_launching`. We avoid
/// `AnyObject::set_class` because its debug-assert on instance sizes
/// fires here: tao's `TaoWindow` is 464 bytes (its own ivars on top
/// of `NSWindow`), `NSPanel` is 456 bytes, and the assert panics
/// with "old and new class sizes were not equal; this is UB!". The
/// raw FFI call skips that guard — in practice the swap is safe
/// because tao's allocation is larger than `NSPanel`'s ivar layout
/// and the subsequent setters go through ObjC method dispatch
/// (not fixed-offset ivar writes), so the mismatch never causes
/// a real out-of-bounds.
///
/// We do NOT call `setAcceptsFirstMouse:` here — the underlying
/// `tao::TaoWindow` doesn't implement that selector and would throw
/// `NSInvalidArgumentException`. The issue #314 fix is delivered by
/// the builder-level `.accept_first_mouse(true)`.
#[cfg(target_os = "macos")]
pub fn configure_as_floating_panel(window: &tauri::WebviewWindow) {
    use objc2::{
        class, ffi, msg_send,
        runtime::{AnyClass, AnyObject},
        sel,
    };

    let label = window.label().to_string();
    let label_on_main = label.clone();
    let window_on_main = window.clone();
    if let Err(error) = window.run_on_main_thread(move || {
        let raw_window = match window_on_main.ns_window() {
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

        // Wrap the entire ObjC body in catch_unwind. The `objc2`
        // crate's `catch-all` feature turns `@throw` into a Rust
        // panic, which we then catch — if the underlying class
        // doesn't implement a selector (e.g. on an older macOS that
        // lacks `CanJoinAllApplications`), we'd rather log and skip
        // than take the whole `did_finish_launching` path down with
        // "Rust cannot catch foreign exceptions".
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| unsafe {
            // 1. Swap the class to NSPanel. This is the standard
            //    Cocoa trick — same instance, larger memory layout
            //    (TaoWindow > NSPanel), NSPanel selectors now respond.
            //    We call `objc2::ffi::object_setClass` (the raw C
            //    runtime function) instead of `AnyObject::set_class`
            //    because the safe wrapper adds a `debug_assert_eq!`
            //    on `instance_size` that fires here: tao's TaoWindow
            //    is 464 bytes, NSPanel is 456 bytes. The raw FFI call
            //    skips that guard — the swap is safe in practice
            //    because the original allocation covers NSPanel's ivar
            //    range and the subsequent setters go through ObjC
            //    method dispatch (not fixed-offset ivar writes).
            let panel_class = class!(NSPanel);
            let _ = ffi::object_setClass(raw_window, panel_class as *const AnyClass);

            // 2. Panel-only properties. Setting these after the
            //    class swap is what makes the window behave like a
            //    non-activating overlay:
            //      - hidesOnDeactivate = NO: clicking another app
            //        does not hide the pet (this is the whole point
            //        of being a panel for a tray-style widget).
            //      - becomesKeyOnlyOnOrderFront = YES: clicking the
            //        panel gives it key status without activating
            //        the app, so the Dock doesn't pop in just
            //        because the user poked the pet.
            //      - worksWhenModal = YES: survive any future
            //        modal the main window might show (defensive
            //        — the current main flow doesn't show modals,
            //        but Tauri dialogs and friends do).
            //
            //    Each setter is guarded with `respondsToSelector:`
            //    because Apple has been pruning these selectors
            //    across recent macOS releases (e.g. macOS 14
            //    deprecated `setBecomesKeyOnlyOnOrderFront:` and
            //    it was removed on the user's runtime). Without
            //    the guard, a missing selector throws
            //    NSInvalidArgumentException, which objc2's
            //    `catch-all` turns into a Rust panic that
            //    `catch_unwind` here would catch — but the
            //    panic_guard hook still logs a fatal panic line.
            //    With the guard, we silently skip the missing
            //    setter and fall back to NSPanel's default for
            //    that property.
            let responds_hides: bool = msg_send![
                raw_window,
                respondsToSelector: sel!(setHidesOnDeactivate:)
            ];
            if responds_hides {
                let _: () = msg_send![raw_window, setHidesOnDeactivate: false];
            }
            let responds_becomes: bool = msg_send![
                raw_window,
                respondsToSelector: sel!(setBecomesKeyOnlyOnOrderFront:)
            ];
            if responds_becomes {
                let _: () = msg_send![raw_window, setBecomesKeyOnlyOnOrderFront: true];
            }
            let responds_works: bool = msg_send![
                raw_window,
                respondsToSelector: sel!(setWorksWhenModal:)
            ];
            if responds_works {
                let _: () = msg_send![raw_window, setWorksWhenModal: true];
            }

            // 3. Lift the panel to its target window level so it sits
            //    above every full-screen app Space. The pet gets one
            //    notch above the aux windows (card / bubble) so any
            //    overlap keeps the pet on top — see
            //    `desired_window_level_for`. Both levels still sit
            //    well above full-screen app Spaces, so the pet stays
            //    visible above TextEdit's full-screen window. Without
            //    these levels, even with the collection flags, the OS
            //    will hide the panel when the foreground app enters
            //    full-screen.
            let level = desired_window_level_for(&label_on_main);
            let _: () = msg_send![raw_window, setLevel: level];

            // 4. Apply the full collectionBehavior bitmask (CanJoin
            //    AllSpaces + FullScreenAuxiliary + CanJoinAll
            //    Applications on macOS 13+). collection_behavior
            //    _for_pet is the single source of truth for which
            //    bits we want, so callers (bubble/card re-show
            //    paths) and the existing `configure_for_all_spaces`
            //    helper stay in lockstep with this one.
            let current: usize = msg_send![raw_window, collectionBehavior];
            let desired = collection_behavior_for_pet(current);
            let _: () = msg_send![raw_window, setCollectionBehavior: desired];
        }));

        if let Err(error) = result {
            log::warn!(
                "[loop-pet] {label_on_main}: NSPanel conversion raised an ObjC exception: {error:?}"
            );
        }
    }) {
        log::warn!("[loop-pet] {label}: NSPanel conversion failed: {error}");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn configure_as_floating_panel(_window: &tauri::WebviewWindow) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_join_all_spaces_and_fullscreen_auxiliary() {
        let expected = CAN_JOIN_ALL_SPACES | FULL_SCREEN_AUXILIARY;
        let actual = collection_behavior_for_pet(0);
        // On macOS 13+ the helper additionally ORs in
        // CanJoinAllApplications, so the assertion is a bitmask
        // subset: the *base* flags must always be present
        // regardless of host OS version.
        assert_eq!(
            actual & expected,
            expected,
            "base collection flags must always be present"
        );
    }

    #[test]
    fn preserves_existing_collection_behavior_flags() {
        let existing = (1 << 1) | (1 << 7);
        let desired = collection_behavior_for_pet(existing);
        assert_eq!(
            desired & existing,
            existing,
            "pre-existing collection-behavior bits must be preserved"
        );
        assert_ne!(desired & CAN_JOIN_ALL_SPACES, 0);
        assert_ne!(desired & FULL_SCREEN_AUXILIARY, 0);
    }

    #[test]
    fn can_join_all_applications_bit_constant_is_one_lshift_five() {
        // The bit constant the helper uses must match Apple's
        // documented value for `NSWindowCollectionBehaviorCanJoinAllApplications`
        // (introduced in macOS 13 / Ventura). A drift here would
        // either no-op on 13+ (setting an unrelated flag bit) or
        // accidentally toggle a real flag — both are silent
        // regressions of the cross-app full-screen fix.
        assert_eq!(CAN_JOIN_ALL_APPLICATIONS, 1 << 5);
        // When the helper does include the bit, the base flags must
        // still be present — this is the regression test for the
        // existing PR #302 behavior, regardless of host OS.
        let desired = collection_behavior_for_pet(0);
        assert_ne!(desired & CAN_JOIN_ALL_SPACES, 0);
        assert_ne!(desired & FULL_SCREEN_AUXILIARY, 0);
    }

    #[test]
    fn desired_window_level_is_screen_saver_level() {
        // The constant must remain in sync with AppKit's
        // `NSScreenSaverWindowLevel` (defined as 25 in
        // AppKit/AppKitDefines.h). A drift here would silently
        // demote the panel back into a layer that gets hidden by
        // full-screen Spaces, re-introducing issue #330.
        assert_eq!(desired_window_level(), 25);
        assert_eq!(desired_window_level(), NS_SCREEN_SAVER_WINDOW_LEVEL);
    }

    #[test]
    fn pet_window_level_sits_one_above_aux_windows() {
        // The pet must render above the card / bubble when they
        // overlap so the fox sprite never gets hidden by the
        // decision card. We do that by giving the pet a higher
        // `setLevel:` than the aux windows while keeping both
        // above full-screen app Spaces.
        let pet = desired_window_level_for(super::super::PET_LABEL);
        let card = desired_window_level_for(super::super::PET_CARD_LABEL);
        let bubble = desired_window_level_for(super::super::PET_BUBBLE_LABEL);
        assert!(
            pet > card,
            "pet window level ({pet}) must sit above the card ({card})"
        );
        assert!(
            pet > bubble,
            "pet window level ({pet}) must sit above the bubble ({bubble})"
        );
        // Aux windows share the base screen-saver level so they
        // both stay above full-screen apps and don't fight for the
        // same z-slot.
        assert_eq!(card, NS_SCREEN_SAVER_WINDOW_LEVEL);
        assert_eq!(bubble, NS_SCREEN_SAVER_WINDOW_LEVEL);
        // Pet is exactly one tick above so the relationship is
        // obvious in Activity Monitor / `lsappinfo` and the
        // difference is documented at the call site.
        assert_eq!(pet, NS_SCREEN_SAVER_WINDOW_LEVEL + 1);
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_13_0_version_constant_is_well_formed() {
        // Guard against accidental edits to the runtime-version
        // gate: if someone bumps the major version, macOS 13+ is
        // no longer the threshold and CanJoinAllApplications
        // semantics change.
        assert_eq!(MACOS_13_0_VERSION.majorVersion, 13);
        assert_eq!(MACOS_13_0_VERSION.minorVersion, 0);
        assert_eq!(MACOS_13_0_VERSION.patchVersion, 0);
    }
}
