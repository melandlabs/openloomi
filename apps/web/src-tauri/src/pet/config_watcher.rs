// Loomi Pet — `pet-config.json` + custom-theme directory watcher.
//
// We use `notify` (a tiny, well-maintained cross-platform filesystem
// watcher) to listen for external edits of the user's config file
// and theme sprites. On any change we re-read the config from disk
// and emit `pet:config-changed` so the widget can swap sprites
// without a restart.
//
// Two watches:
//   * `pet-config.json` (non-recursive) — the single config file.
//   * `pet-custom/`      (recursive)    — every subdirectory the
//                                         user might drop a custom
//                                         theme into.
//
// We debounce events with a 250 ms timer — editors that write the
// file in two passes (truncate + rename, or atomic-rename with a
// sibling .tmp) fire several raw events, and we only want one
// notification per real edit.

use std::path::PathBuf;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use notify::{EventKind, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

use super::PET_LABEL;
use super::theme;

const DEBOUNCE_MS: u64 = 250;

/// Spawn a daemon thread that watches the pet config + custom
/// themes directory. The thread runs for the lifetime of the
/// process; no shutdown signal is exposed (the watcher terminates
/// with the process).
pub fn spawn_config_watcher(app: AppHandle) {
    std::thread::Builder::new()
        .name("loomi-pet-config-watcher".into())
        .spawn(move || {
            let _ = crate::panic_guard::catch_unwind_str(
                "loomi-pet config watcher",
                || watch_loop(&app),
            );
        })
        .expect("spawn loomi-pet config watcher");
}

fn watch_loop(app: &AppHandle) {
    let config_path = theme::config_path(app);
    let config_dir = config_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_default();

    // Make sure both paths exist before attaching watches — notify
    // // is happy with non-existent paths in some platforms but
    // // barfs on others. Re-resolve custom_themes_dir on every
    // // iteration so an out-of-band edit to `customThemesDir`
    // // is honored without a restart.
    if !config_dir.as_os_str().is_empty() {
        let _ = std::fs::create_dir_all(&config_dir);
    }

    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();

    let mut watcher = match notify::recommended_watcher(tx) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("[loomi-pet/config-watcher] failed to create watcher: {e}");
            return;
        }
    };

    if let Err(e) = watcher.watch(&config_path, RecursiveMode::NonRecursive) {
        eprintln!(
            "[loomi-pet/config-watcher] failed to watch config {}: {e}",
            config_path.display()
        );
    }

    // Issue #314 — on macOS FSEvents needs an existing inode to watch.
    // If the user has never successfully switched themes, the config
    // file doesn't exist yet and `watcher.watch(&config_path, …)` at
    // boot silently no-ops. Watch the parent directory too so we
    // catch the moment `pet-config.json` is first created (e.g. by a
    // hand-edit on a fresh install) and can transition to the direct
    // file watch below.
    if !config_dir.as_os_str().is_empty() {
        if let Err(e) = watcher.watch(&config_dir, RecursiveMode::NonRecursive) {
            eprintln!(
                "[loomi-pet/config-watcher] failed to watch config dir {}: {e}",
                config_dir.display()
            );
        }
    }

    let mut current_themes_dir: Option<PathBuf> = None;
    let mut last_emit = Instant::now() - Duration::from_millis(DEBOUNCE_MS * 2);
    let mut primed = false;

    loop {
        // Refresh themes-dir watch on every iteration so config edits
        // that move the custom directory get picked up.
        let cfg = theme::read_config(app);
        let themes_dir = cfg.custom_themes_path();
        if current_themes_dir.as_ref() != Some(&themes_dir) {
            if let Some(prev) = &current_themes_dir {
                let _ = watcher.unwatch(prev);
            }
            let _ = std::fs::create_dir_all(&themes_dir);
            if let Err(e) = watcher.watch(&themes_dir, RecursiveMode::Recursive) {
                eprintln!(
                    "[loomi-pet/config-watcher] failed to watch themes dir {}: {e}",
                    themes_dir.display()
                );
            }
            current_themes_dir = Some(themes_dir);
        }

        let recv = match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(r) => r,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // On the first iteration (right after the watch is
                // attached) we want to send an initial config-changed
                // event so the widget can paint with fresh state
                // without waiting for the user's first edit. We do
                // this exactly once.
                if !primed {
                    primed = true;
                    emit_config_changed(app, &cfg);
                    last_emit = Instant::now();
                }
                continue;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };

        let event = match recv {
            Ok(ev) => ev,
            Err(e) => {
                eprintln!("[loomi-pet/config-watcher] recv error: {e}");
                continue;
            }
        };
        if !matches!(
            event.kind,
            EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
        ) {
            continue;
        }
        // Issue #314 — parent-dir Create events fire for any inode
        // appearing in `~/.openloomi/`. Only honor ones for
        // `pet-config.json` (transition to direct file watch) and let
        // the modify/create/remove filter below pass them through
        // after the transition. Anything else is dropped here so the
        // debounced emit isn't drowned by unrelated directory churn.
        let touches_config_file = event.paths.iter().any(|p| {
            p.file_name()
                .zip(config_path.file_name())
                .map(|(a, b)| a == b)
                .unwrap_or(false)
        });
        if !touches_config_file {
            continue;
        }
        if matches!(event.kind, EventKind::Create(_)) {
            // Transition to a direct file watch — subsequent edits
            // hit the file watcher (no per-inode churn through the
            // directory). If `pet-config.json` is then removed, the
            // direct watch will fail; we keep the parent watch so a
            // re-creation brings it back.
            if let Err(e) = watcher.watch(&config_path, RecursiveMode::NonRecursive) {
                eprintln!(
                    "[loomi-pet/config-watcher] failed to (re-)watch config {}: {e}",
                    config_path.display()
                );
            }
        }
        // Debounce: skip events that arrive within 250 ms of the
        // previous emit so a single editor save fires one event.
        if last_emit.elapsed() < Duration::from_millis(DEBOUNCE_MS) {
            continue;
        }
        last_emit = Instant::now();
        emit_config_changed(app, &theme::read_config(app));
    }
}

fn emit_config_changed(app: &AppHandle, cfg: &theme::PetConfig) {
    let custom = theme::list_custom_themes(cfg);
    let view = theme::build_view(cfg.clone(), custom);
    let payload = match serde_json::to_value(&view) {
        Ok(v) => v,
        Err(e) => {
            eprintln!(
                "[loomi-pet/config-watcher] failed to serialize PetConfigView: {e}"
            );
            return;
        }
    };
    let _ = app.emit_to(PET_LABEL, "pet:config-changed", payload);
}

// Real coverage for the parent-dir watch + create-transition path
// (issue #314) needs a Tauri `AppHandle` mock so we can count
// `pet:config-changed` emits. That requires a test harness which
// isn't in this repo yet — tracked as a follow-up. Until then we
// keep this file's `#[cfg(test)]` block so the pattern matches the
// rest of the pet module (`watcher.rs::path_tests`, `theme::tests`,
// `window::tests`) and so a future test author can drop in the
// harness without a structural PR.
#[cfg(test)]
mod tests {
    #[test]
    fn placeholder() {
        // Sentinel: the test suite would otherwise be empty for
        // `pet::config_watcher`, which silently disables the file's
        // `cargo test` target. Removing this in favor of real coverage
        // is tracked as the follow-up issue filed alongside #314.
    }
}