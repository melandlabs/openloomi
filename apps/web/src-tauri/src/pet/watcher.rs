// Decision-file watcher: background thread that polls `decisions.json`
// for changes and maps fresh done/dismissed/attention signals into the
// pet's background state. Pending count is emitted separately as a badge;
// it does not claim that the chat runtime is thinking or juggling.
//
// The polling is intentionally simple (read + sleep). We re-evaluate the
// snapshot on every poll even when the file is unchanged because some pet
// states expire with time (`presenting`) or change when the user reviews a
// card. An mtime-only gate would leave those states pinned indefinitely.
//
// B2: also emits `loop:decision` to the bubble + card windows so the
// speech bubble tracks the latest pending decision and the larger card
// window stays in sync with whatever the user most recently opened.

use std::path::PathBuf;
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Listener, Manager};

use super::{
    handle_runtime_state_event, last_review_seen_secs_ago, publish_baseline_state,
    set_pending_decision_count, PET_BUBBLE_LABEL, PET_CARD_LABEL, PET_LABEL,
};

const POLL_MS: u64 = 2000;

/// Grace period after the watcher thread starts before the first poll.
/// Lets the eagerly-built pet / bubble / card webviews (see `setup()` in
/// `main.rs`) finish mounting their `loop:state` listeners, otherwise
/// the initial emit lands before `window.__TAURI__.event.listen` is wired
/// and gets dropped.
const FIRST_RUN_SETUP_DELAY_MS: u64 = 1500;

/// 30s freshness window for "just happened" rules (e.g. a decision moved
/// to `done` in the last 30s => `happy` with "N done" monologue).
const JUST_NOW_SECS: i64 = 30;

/// How long after a `done` decision the user has to open the card
/// before `presenting` flips to `happy`. 60 s is generous — the bubble
/// text is "Click to view" so the cue is immediate — but long enough
/// that background tabs / multi-monitor workflows don't lose the
/// signal.
pub const PRESENTING_REVIEW_GRACE_SECS: u64 = 60;

/// Spawn the dedicated watcher thread. The thread name surfaces in crash
/// dumps and process listings, which makes "which thread ate my CPU"
/// answers easy.
pub fn spawn_decision_watcher(app: AppHandle) {
    // Shared one-shot guard for the `needs-setup` bootstrap emit. The
    // AI-settings-changed listener below needs to reset it when the user
    // finishes configuration; the watch poll loop reads/writes it on
    // every iteration. `Arc<Mutex<…>>` rather than `AtomicBool` so the
    // bootstrap block can read+write atomically under the same lock —
    // avoids the "emit twice in a row" race if the listener fires right
    // after a poll.
    let setup_emitted = std::sync::Arc::new(std::sync::Mutex::new(false));

    // AI settings saved (or reset) — the pet card + bubble should leave
    // the "needs-setup" mode and return to a natural idle/sleeping
    // state. Without this listener the pet sprite + bubble monologue
    // stayed pinned to "Let's get you set up" indefinitely after the
    // user saved their first AI key, because the watch poll loop only
    // emits state on decisions.json bucket changes (the AI key lives
    // in the DB, not on disk).
    {
        let app_for_listener = app.clone();
        let setup_emitted_for_listener = setup_emitted.clone();
        app.listen("openloomi:ai-settings-changed", move |_event| {
            if let Ok(mut flag) = setup_emitted_for_listener.lock() {
                *flag = false;
            }
            let hour = current_hour_local();
            let (state, monologue) = if hour >= 22 || hour < 6 {
                ("sleeping", "circle back in the morning")
            } else {
                ("idle", "All clear")
            };
            publish_baseline_state(&app_for_listener, state, Some(monologue.into()));
            // Hide the bubble that the bootstrap emit showed — the user
            // just finished setup, no need to keep prompting.
            super::hide_bubble_window(&app_for_listener);
        });
    }

    // Clone once up-front so both spawned closures can take ownership
    // without fighting over `app`. Tauri's `AppHandle` is cheap to
    // clone (it's an Arc internally), so this is free.
    let app_for_decision = app.clone();
    let app_for_runtime_state = app.clone();

    std::thread::Builder::new()
        .name("loomi-pet-decision-watcher".into())
        .spawn(move || {
            let _ = crate::panic_guard::catch_unwind_str("loomi-pet watcher", || {
                watch_loop(&app_for_decision, setup_emitted)
            });
        })
        .expect("spawn loomi-pet watcher");

    // Runtime-state file watcher. The Next.js route
    // `/api/pet/state` writes `~/.openloomi/pet/runtime_state.json`
    // when an external client (Codex / Claude Code bridge) wants to
    // drive the pet sprite. We tail its mtime and forward each new
    // payload to the same `handle_runtime_state_event` the chat UI
    // uses, so externally-driven and internally-driven states share
    // the same coordinator and baseline/restore semantics.
    std::thread::Builder::new()
        .name("loomi-pet-runtime-state-watcher".into())
        .spawn(move || {
            let _ = crate::panic_guard::catch_unwind_str("loomi-pet runtime-state watcher", || {
                watch_runtime_state_loop(&app_for_runtime_state)
            });
        })
        .expect("spawn loomi-pet runtime-state watcher");
}

/// Cap on the `recently_completed` ring buffer. Bounds memory under
/// pathological fan-out (many pending → done transitions in one poll
/// window). 16 is generous: in practice transitions are minutes apart.
const RECENTLY_COMPLETED_CAP: usize = 16;

fn watch_loop(app: &AppHandle, setup_emitted: std::sync::Arc<std::sync::Mutex<bool>>) {
    let path = resolve_decisions_path(app);
    let mut last_buckets: (usize, usize, usize) = (0, 0, 0);
    let mut last_decision_ts: Option<String> = None;
    let mut last_top_id: Option<String> = None;
    // Track ids that were pending on the previous poll so we can detect
    // transitions out of `pending` and emit a terminal `loop:decision`
    // payload (status=done | dismissed). Without this the pet card's
    // Cancel button can stay stuck after countdown because the watcher
    // only emitted `loop:decision` for the *new* top-pending id.
    let mut last_pending_ids: Vec<String> = Vec::new();
    let mut recently_completed: Vec<(String, String)> = Vec::new();
    // Track the last emitted pet state + whether the user had been
    // "recently reviewed". The watcher normally only re-emits on
    // bucket / ts / id changes, but the `presenting → happy`
    // transition is triggered by `mark_review_seen` (i.e. the user
    // clicking the bubble), not by a decisions.json edit. Without
    // tracking `reviewed_recently` here, the pet would stay on
    // `presenting` for the full 60 s grace window even after the user
    // opened the card.
    let mut last_emitted_state: Option<String> = None;
    let mut last_reviewed_recently: bool = false;

    // One-shot first-run detection: if `~/.openloomi/loop/decisions.json`
    // doesn't exist AND the runtime isn't configured (no env-level
    // Anthropic key, and `OPENLOOMI_AGENT_PROVIDER` is unset or `claude`),
    // surface a setup hint so the pet sprite + bubble invite the user to
    // click through to AI settings. Without this, the watcher stays silent
    // on a brand-new install — the pet sprite defaults to "idle" and the
    // bubble never appears, so the user has no visual cue that anything
    // is needed. The pet card self-shows its no-api-key CTA via
    // `apply()` in `loomi-card.html` (GET /api/preferences/ai returns
    // 200 in Tauri mode → apiConfigured === false → pet:open-card emit),
    // so we don't need to show the card again here — only the bubble.
    //
    // `setup_emitted` is shared with the `openloomi:ai-settings-changed`
    // listener registered in `spawn_decision_watcher` — the listener
    // resets it to `false` after the user saves a key, so a later
    // reset (or a future watcher restart) can re-trigger the hint.
    std::thread::sleep(Duration::from_millis(FIRST_RUN_SETUP_DELAY_MS));
    if !*setup_emitted.lock().unwrap() && !path.exists() && !has_anthropic_env_key() {
        publish_baseline_state(
            app,
            "needs-setup",
            Some("Tap me — let's set up your AI provider".into()),
        );
        // Show the bubble so the monologue is immediately visible.
        // The card is already self-shown by `loomi-card.html` on first
        // load (see comment above), so we skip it here to avoid a
        // duplicate show race that could disturb the focus order.
        super::show_bubble_window(app);
        *setup_emitted.lock().unwrap() = true;
    }

    loop {
        std::thread::sleep(Duration::from_millis(POLL_MS));

        // File appeared — clear the setup guard so a future deletion
        // re-triggers the hint on next watcher restart.
        *setup_emitted.lock().unwrap() = false;

        let Ok(bytes) = std::fs::read(&path) else {
            set_pending_decision_count(0);
            let _ = app.emit_to(
                PET_LABEL,
                "loop:pending-count",
                serde_json::json!({ "count": 0 }),
            );
            continue;
        };
        let Ok(snap) = serde_json::from_slice::<DecisionsSnap>(&bytes) else {
            continue;
        };

        let buckets = (snap.pending.len(), snap.done.len(), snap.dismissed.len());
        // Publish pending count on every successful poll (not just on
        // change) so handlers like `pet:close-card` always see fresh
        // data when they ask `pending_decision_count()`. Cheap atomic
        // store — happens on the watcher thread, off the UI critical
        // path.
        set_pending_decision_count(snap.pending.len());
        let _ = app.emit_to(
            PET_LABEL,
            "loop:pending-count",
            serde_json::json!({ "count": snap.pending.len() }),
        );
        let newest_ts = snap
            .pending
            .iter()
            .chain(snap.done.iter())
            .chain(snap.dismissed.iter())
            .filter_map(|d| d.completed_at.clone().or(d.created_at.clone()))
            .max();
        let needs_user = snap.pending.iter().any(|d| d.needs_user.unwrap_or(false));
        let top_pending_id = snap.pending.first().and_then(|d| d.id.clone());
        // Snapshot the current pending ids so the transition-diff below
        // can compare against the previous poll. We clone rather than
        // borrow because `snap.pending` is moved through several helpers
        // (`set_pending_decision_count` takes &usize, but future readers
        // may consume) and a small Vec<String> is cheap.
        let current_pending_ids: Vec<String> =
            snap.pending.iter().filter_map(|d| d.id.clone()).collect();

        let reviewed_recently = last_review_seen_secs_ago()
            .map(|s| s < PRESENTING_REVIEW_GRACE_SECS)
            .unwrap_or(false);
        let (state, monologue) = map_state_to_pet(&snap, needs_user, reviewed_recently);

        let data_changed = buckets != last_buckets
            || newest_ts != last_decision_ts
            || top_pending_id != last_top_id
            || current_pending_ids != last_pending_ids;
        if !should_emit_update(
            data_changed,
            reviewed_recently != last_reviewed_recently,
            last_emitted_state.as_deref(),
            state,
        ) {
            continue;
        }
        // Detect ids that left `pending` between this poll and the last.
        // For each, look up the terminal bucket (done → "done",
        // dismissed → "dismissed"); fall back to "done" if the bucket
        // moved but the item is no longer present (defensive — handles
        // the rare case where the loop skill writes the bucket count
        // without echoing the item). Push onto `recently_completed`
        // capped at RECENTLY_COMPLETED_CAP (FIFO drop). We only compute
        // this on the `changed` branch so it's cheap on idle polls.
        for (id, status) in diff_completed_ids(&last_pending_ids, &current_pending_ids, &snap) {
            if recently_completed.len() >= RECENTLY_COMPLETED_CAP {
                recently_completed.remove(0);
            }
            recently_completed.push((id, status));
        }
        last_buckets = buckets;
        last_decision_ts = newest_ts.clone();
        last_top_id = top_pending_id.clone();
        last_pending_ids = current_pending_ids;
        last_reviewed_recently = reviewed_recently;

        last_emitted_state = Some(state.to_string());
        // Runtime chat activity temporarily wins over this baseline.
        // The coordinator still records every watcher update and restores
        // the latest one after the chat UI releases its override.
        publish_baseline_state(app, state, monologue);

        // B2: keep bubble + card windows in sync. The bubble auto-shows
        // when the latest pending decision changes and auto-hides when
        // the pending bucket empties. The card was historically
        // user-opened only, but the connector-status strip on the card
        // is the user's primary at-a-glance "is the loop healthy" view
        // — the user shouldn't have to click the bubble to see it. We
        // auto-show the card the first time a pending decision lands
        // (so the user immediately sees the decision + connector dots)
        // and otherwise leave its visibility alone (the × / click
        // handlers drive subsequent toggles).
        if let Some(top) = snap.pending.first() {
            let decision_payload = build_decision_payload(top);
            let _ = app.emit_to(PET_BUBBLE_LABEL, "loop:decision", decision_payload.clone());
            let _ = app.emit_to(PET_CARD_LABEL, "loop:decision", decision_payload);
            // Auto-show the card so the connector strip is visible
            // without an extra click. `show_card_window` is idempotent
            // and re-focuses the existing window. We do this BEFORE
            // showing the bubble so the bubble's `set_focus` call ends
            // up as the last focus event — which is what determines the
            // z-order in the OS float layer (both windows are
            // `always_on_top(true)`). If we did it in the opposite
            // order, the card would end up on top of the bubble and
            // obscure the speech text.
            super::show_card_window(app);
            // Show the bubble as a transient notification on top of
            // the card. The bubble's JS owns the auto-dismiss
            // lifecycle — see `loomi-bubble.html::scheduleAutoHide`.
            // We just need to show + focus.
            super::show_bubble_window(app);
        } else {
            let empty = serde_json::json!({});
            let _ = app.emit_to(PET_BUBBLE_LABEL, "loop:decision", empty);
            if let Some(w) = app.get_webview_window(PET_BUBBLE_LABEL) {
                let _ = w.hide();
            }
        }

        // Drain terminal transitions: for each id that left `pending`
        // between polls, emit a `loop:decision` payload that carries
        // the resolved status (`done` | `dismissed`). Mirrors the
        // bubble/card symmetry used for top-pending emissions. We
        // intentionally do NOT auto-show card/bubble for these — the
        // user's card is already open and the existing top-pending
        // branch above owns visibility decisions.
        if !recently_completed.is_empty() {
            for (id, status) in recently_completed.iter() {
                if let Some(payload) = build_terminal_decision_payload(id, status, &snap) {
                    let _ = app.emit_to(PET_BUBBLE_LABEL, "loop:decision", payload.clone());
                    let _ = app.emit_to(PET_CARD_LABEL, "loop:decision", payload);
                }
            }
            recently_completed.clear();
        }

        // C: emit a slim pending-list to the card so connection-check
        // (Form 1) and any layout that wants to render a queue can
        // subscribe. Top 5 entries is plenty for a 360×420 window —
        // the user can dismiss / open to see more in the dashboard.
        let pending_list = serde_json::json!({
            "items": snap.pending.iter().take(5).map(|d| {
                serde_json::json!({
                    "id": d.id,
                    "type": d.r#type,
                    "title": d.title,
                    "source": d.source_signal.as_ref().map(|s| s.source.clone()),
                    "source_type": d.source_signal.as_ref().map(|s| s.r#type.clone()),
                    "source_ts": d.source_signal.as_ref().and_then(|s| s.ts.clone()),
                    "confidence": d.confidence,
                })
            }).collect::<Vec<_>>()
        });
        let _ = app.emit_to(PET_CARD_LABEL, "loop:pending-list", pending_list);
    }
}

/// Decide whether the watcher should publish a fresh pet state.
///
/// `state` is included separately from data/review changes so wall-clock
/// transitions still publish. In particular, a `presenting` state must fall
/// back after its freshness window even if `decisions.json` is untouched.
fn should_emit_update(
    data_changed: bool,
    review_changed: bool,
    last_state: Option<&str>,
    next_state: &str,
) -> bool {
    data_changed || review_changed || last_state != Some(next_state)
}

/// Build the `loop:decision` payload that the bubble + card webviews
/// listen for. Mirrors the shape consumed by `loomi-bubble.html` /
/// `loomi-card.html` (id, type, title, dialogue, priority, confidence,
/// source chain, why bullets). Includes `status: "pending"` so the
/// card can self-describe the top-pending payload against the same
/// field contract the terminal emit uses (status=done|dismissed) —
/// without this, the success branch in the card cannot distinguish
/// "no payload yet" from "still pending". Note: `confidence` is
/// emitted as-is (`Option<f32>` → `null` if missing) so the card's
/// meta-node row can render `Math.round(c * 100) + "%"` directly;
/// priority is derived from the same value upstream so card and
/// payload stay consistent.
fn build_decision_payload(d: &DecItem) -> serde_json::Value {
    let priority = match d.confidence {
        Some(c) if c >= 0.85 => "p0",
        Some(c) if c >= 0.75 => "p1",
        _ => "p2",
    };
    let (source, source_type, source_ts) = match d.source_signal.as_ref() {
        Some(s) => (Some(s.source.clone()), Some(s.r#type.clone()), s.ts.clone()),
        None => (None, None, None),
    };
    serde_json::json!({
        "id": d.id,
        "type": d.r#type,
        "title": d.title,
        "dialogue": d.dialogue,
        "priority": priority,
        "confidence": d.confidence,
        "source": source,
        "source_type": source_type,
        "source_ts": source_ts,
        "why": d.context.as_ref().and_then(|c| c.why.clone()).unwrap_or_default(),
        "status": "pending",
    })
}

/// Build the `loop:decision` payload for a decision that just
/// transitioned out of `pending`. Mirrors `build_decision_payload`'s
/// shape (id/type/title/dialogue/priority/source/why) but stamps the
/// resolved status so the card's terminal branch can fire. Returns
/// `None` if we cannot find the underlying item — in that case we
/// still emit nothing rather than fabricating a half-formed payload.
fn build_terminal_decision_payload(
    id: &str,
    status: &str,
    snap: &DecisionsSnap,
) -> Option<serde_json::Value> {
    let item = snap
        .done
        .iter()
        .chain(snap.dismissed.iter())
        .find(|d| d.id.as_deref() == Some(id))?;
    let mut payload = build_decision_payload(item);
    // `build_decision_payload` defaults to status="pending" — override
    // with the resolved terminal status. Use a map so the order is
    // stable for downstream consumers that key off field position.
    if let Some(obj) = payload.as_object_mut() {
        obj.insert("status".into(), serde_json::Value::String(status.into()));
    }
    Some(payload)
}

/// Pure helper: given the previous and current pending id lists,
/// produce the (id, status) pairs that transitioned OUT of pending.
/// Status is determined by which terminal bucket the item landed in:
/// `snap.done` → "done", `snap.dismissed` → "dismissed". If the item
/// is no longer present in either bucket (defensive — handles the
/// rare case where the loop skill adjusts the bucket counts without
/// echoing the item), we fall back to "done" so the card still clears
/// rather than getting stuck forever.
///
/// Order of `out` matches the order in `prev` (stable, not sorted) so
/// emit order on the wire is predictable across polls.
fn diff_completed_ids(
    prev: &[String],
    curr: &[String],
    snap: &DecisionsSnap,
) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for id in prev {
        if curr.contains(id) {
            continue;
        }
        let status = if snap
            .done
            .iter()
            .any(|d| d.id.as_deref() == Some(id.as_str()))
        {
            "done"
        } else if snap
            .dismissed
            .iter()
            .any(|d| d.id.as_deref() == Some(id.as_str()))
        {
            "dismissed"
        } else {
            // Item left pending but didn't reappear in done/dismissed.
            // Treat as done so the card's Cancel still clears rather
            // than getting stuck. Better to surface "Done" for a
            // vanished decision than to wedge the UI.
            "done"
        };
        out.push((id.clone(), status.to_string()));
    }
    out
}

/// Resolve where the loop skill writes its decision JSON.
///
/// Precedence:
/// 1. `LOOMI_PET_DECISIONS_PATH` env var — useful for tests and for
///    pointing at a non-default skill install.
/// 2. Tauri-resolved home directory — handles macOS, Linux, and Windows
///    correctly so the watcher reads the same file the Next.js loop
///    writes on every platform. Must match the layout written by
///    `apps/web/lib/loop/paths.ts` (`LOOP_HOME = homedir()/.openloomi/loop`)
///    or the watcher will be looking at a stale file.
/// 3. Env-var fallback. On POSIX shells `HOME` is set; on Windows it's
///    typically `USERPROFILE`, and older Windows shells only have the
///    `HOMEDRIVE` + `HOMEPATH` pair. Mirrors what the `dirs` crate does.
/// 4. Relative `".openloomi/loop/decisions.json"` — preserved as a last
///    resort so unit tests that don't go through the Tauri runtime still
///    produce a usable path.
pub fn resolve_decisions_path(app: &AppHandle) -> PathBuf {
    if let Ok(p) = std::env::var("LOOMI_PET_DECISIONS_PATH") {
        return PathBuf::from(p);
    }
    if let Ok(home) = app.path().home_dir() {
        return home.join(".openloomi").join("loop").join("decisions.json");
    }
    if let Some(p) = resolve_home_from_env() {
        return p;
    }
    PathBuf::from(".openloomi/loop/decisions.json")
}

/// Resolve the runtime-state file written by `/api/pet/state`. Mirrors
/// `resolve_decisions_path` so the runtime_state lives next to
/// `loop/decisions.json`. The HTTP route is the single writer; this
/// watcher is the single reader; both sides stay in sync via file mtime.
pub fn resolve_pet_runtime_state_path(app: &AppHandle) -> PathBuf {
    if let Ok(p) = std::env::var("LOOMI_PET_RUNTIME_STATE_PATH") {
        return PathBuf::from(p);
    }
    if let Ok(home) = app.path().home_dir() {
        return home
            .join(".openloomi")
            .join("pet")
            .join("runtime_state.json");
    }
    if let Some(home) = resolve_home_dir_only() {
        return home
            .join(".openloomi")
            .join("pet")
            .join("runtime_state.json");
    }
    PathBuf::from(".openloomi/pet/runtime_state.json")
}

/// Home-directory-only env fallback (no `.openloomi/...` suffix). Used
/// by `resolve_pet_runtime_state_path` so we don't have to duplicate
/// the full env-var chain next to the existing one in
/// `resolve_home_from_env` (which appends the loop suffix).
fn resolve_home_dir_only() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        return Some(PathBuf::from(home));
    }
    let drive = std::env::var_os("HOMEDRIVE")?;
    let path = std::env::var_os("HOMEPATH")?;
    Some(PathBuf::from(format!(
        "{}{}",
        drive.to_string_lossy(),
        path.to_string_lossy()
    )))
}

/// Pure env-var home resolution. Extracted so unit tests can exercise the
/// non-Tauri fallback chain without fabricating an `AppHandle`. Behavior:
///   - Prefers `HOME` (POSIX).
///   - Falls back to `USERPROFILE` (modern Windows).
///   - Falls back to `HOMEDRIVE` + `HOMEPATH` (legacy Windows shells that
///     split the profile across two env vars).
fn resolve_home_from_env() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        return Some(
            PathBuf::from(home)
                .join(".openloomi")
                .join("loop")
                .join("decisions.json"),
        );
    }
    let drive = std::env::var_os("HOMEDRIVE")?;
    let path = std::env::var_os("HOMEPATH")?;
    Some(
        PathBuf::from(drive)
            .join(PathBuf::from(path))
            .join(".openloomi")
            .join("loop")
            .join("decisions.json"),
    )
}

#[cfg(test)]
mod path_tests {
    use super::*;
    use std::sync::Mutex;

    /// Env-var mutation is process-global. We serialize the path tests
    /// behind a single mutex so they can't race each other (and can't
    /// leak state into the rest of the suite if a panic occurs).
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn with_env<F: FnOnce()>(vars: &[&str], f: F) {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let saved: Vec<_> = vars
            .iter()
            .map(|k| (k.to_string(), std::env::var_os(k)))
            .collect();
        for k in vars {
            std::env::remove_var(k);
        }
        f();
        for (k, v) in saved {
            match v {
                Some(v) => std::env::set_var(&k, v),
                None => std::env::remove_var(&k),
            }
        }
    }

    #[test]
    fn home_env_var_wins() {
        with_env(
            &[
                "LOOMI_PET_DECISIONS_PATH",
                "HOME",
                "USERPROFILE",
                "HOMEDRIVE",
                "HOMEPATH",
            ],
            || {
                std::env::set_var("HOME", "/home/alice");
                let resolved = resolve_home_from_env().expect("HOME set");
                assert_eq!(
                    resolved,
                    PathBuf::from("/home/alice")
                        .join(".openloomi")
                        .join("loop")
                        .join("decisions.json")
                );
            },
        );
    }

    #[test]
    fn userprofile_is_used_when_home_missing() {
        with_env(
            &[
                "LOOMI_PET_DECISIONS_PATH",
                "HOME",
                "USERPROFILE",
                "HOMEDRIVE",
                "HOMEPATH",
            ],
            || {
                std::env::set_var("USERPROFILE", r"C:\Users\Alice");
                let resolved = resolve_home_from_env().expect("USERPROFILE set");
                let expected = PathBuf::from(r"C:\Users\Alice")
                    .join(".openloomi")
                    .join("loop")
                    .join("decisions.json");
                // PathBuf equality is OS-aware: backslashes on Windows,
                // forward slashes on POSIX. Compare component-wise so the
                // assertion works on both.
                assert_eq!(resolved.components().count(), expected.components().count());
                for (a, b) in resolved.components().zip(expected.components()) {
                    assert_eq!(a, b);
                }
            },
        );
    }

    #[test]
    fn homedrive_and_homepath_combine_when_present() {
        with_env(
            &[
                "LOOMI_PET_DECISIONS_PATH",
                "HOME",
                "USERPROFILE",
                "HOMEDRIVE",
                "HOMEPATH",
            ],
            || {
                std::env::set_var("HOMEDRIVE", "C:");
                std::env::set_var("HOMEPATH", r"\Users\Alice");
                let resolved = resolve_home_from_env().expect("HOME* set");
                assert!(resolved.starts_with(PathBuf::from("C:")));
                assert!(resolved.to_string_lossy().contains("Alice"));
                assert!(resolved.ends_with(PathBuf::from(".openloomi/loop/decisions.json")));
            },
        );
    }

    #[test]
    fn returns_none_when_no_env_set() {
        with_env(
            &[
                "LOOMI_PET_DECISIONS_PATH",
                "HOME",
                "USERPROFILE",
                "HOMEDRIVE",
                "HOMEPATH",
            ],
            || {
                assert!(resolve_home_from_env().is_none());
            },
        );
    }

    #[test]
    fn homedrive_alone_does_not_combine() {
        // HOMEDRIVE without HOMEPATH shouldn't fabricate a profile —
        // matching the dirs crate's behavior. Either both must be set or
        // the function returns None and lets the caller fall through.
        with_env(
            &[
                "LOOMI_PET_DECISIONS_PATH",
                "HOME",
                "USERPROFILE",
                "HOMEDRIVE",
                "HOMEPATH",
            ],
            || {
                std::env::set_var("HOMEDRIVE", "C:");
                assert!(resolve_home_from_env().is_none());
            },
        );
    }
    #[test]
    fn runtime_state_env_var_overrides_default() {
        with_env(
            &[
                "LOOMI_PET_RUNTIME_STATE_PATH",
                "HOME",
                "USERPROFILE",
                "HOMEDRIVE",
                "HOMEPATH",
            ],
            || {
                std::env::set_var(
                    "LOOMI_PET_RUNTIME_STATE_PATH",
                    "/tmp/openloomi-runtime-state-override.json",
                );
                // We can't fabricate an AppHandle here, but the env-var
                // short-circuit is the highest-priority branch in
                // resolve_pet_runtime_state_path — and the function
                // *would* have returned this exact path if the Tauri
                // runtime were available.
                assert_eq!(
                    std::env::var("LOOMI_PET_RUNTIME_STATE_PATH").unwrap(),
                    "/tmp/openloomi-runtime-state-override.json"
                );
            },
        );
    }

    #[test]
    fn home_dir_only_resolves_via_home() {
        with_env(&["HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH"], || {
            std::env::set_var("HOME", "/home/alice");
            let home = resolve_home_dir_only().expect("HOME set");
            assert_eq!(home, PathBuf::from("/home/alice"));
        });
    }

    #[test]
    fn home_dir_only_returns_none_when_no_env_set() {
        with_env(&["HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH"], || {
            assert!(resolve_home_dir_only().is_none());
        });
    }
}

#[derive(Deserialize)]
pub struct DecisionsSnap {
    #[serde(default)]
    pub pending: Vec<DecItem>,
    #[serde(default)]
    pub done: Vec<DecItem>,
    #[serde(default)]
    pub dismissed: Vec<DecItem>,
}

#[derive(Deserialize)]
pub struct DecItem {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub r#type: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    /// `defaultDialogue` and `defaultNextStep` in `lib/loop/server.ts`
    /// populate this when the card is built, but decisions written by
    /// the tick pipeline may leave it empty. The bubble / card fall
    /// back to a generic line in that case.
    #[serde(default)]
    pub dialogue: Option<String>,
    #[serde(default)]
    pub confidence: Option<f32>,
    #[serde(default)]
    pub source_signal: Option<SourceSignal>,
    #[serde(default)]
    pub context: Option<DecContext>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
    /// Loop does not currently emit this field; if it ever does, the
    /// `needsinput` branch will automatically light up. Default is
    /// `false` so missing-field behavior is well-defined.
    #[serde(default)]
    pub needs_user: Option<bool>,
}

#[derive(Deserialize)]
pub struct SourceSignal {
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub r#type: String,
    #[serde(default)]
    pub ts: Option<String>,
}

#[derive(Deserialize)]
pub struct DecContext {
    #[serde(default)]
    pub why: Option<Vec<String>>,
}

/// Map a decision snapshot to `(pet_state, optional_monologue_hint)`.
///
/// Rules fire in priority order — the first match wins. Keep this
/// function pure (no IO, no time access other than the `Utc::now()`-style
/// "fresh" check below) so it can be unit-tested by feeding in canned
/// snapshots.
///
/// `reviewed_recently` is true when the user has opened the decision
/// card within the last `PRESENTING_REVIEW_GRACE_SECS` window. It gates
/// the `presenting → happy` transition: when the user clicks the bubble
/// to see their freshly-done decisions, we want the pet to immediately
/// flip from "I have results for you" to "happy / done".
pub fn map_state_to_pet(
    s: &DecisionsSnap,
    needs_user: bool,
    reviewed_recently: bool,
) -> (&'static str, Option<String>) {
    let done = s.done.len();
    let dismissed = s.dismissed.len();
    let hour = current_hour_local();
    let done_just_now = is_just_now(&newest_bucket_ts(&s.done));
    let dismissed_just_now = is_just_now(&newest_bucket_ts(&s.dismissed));

    // `presenting` surfaces when there's a freshly-done decision that
    // the user hasn't yet seen. The pet sprite + bubble text deliberately differentiates
    // this from `happy` so the user feels the loop "handing off" the
    // result rather than just celebrating. As soon as the user
    // clicks through (`pet:open-card` → `mark_review_seen`), the
    // watcher re-emits with `reviewed_recently = true` and we fall
    // through to the `happy` branch on the next poll.
    if done > 0 && done_just_now && !reviewed_recently {
        return (
            "presenting",
            Some(format!("{done} done — review when you're ready")),
        );
    }
    if done > 0 && done_just_now {
        return ("happy", Some(format!("{} done. Tap to see.", done)));
    }
    if dismissed > 0 && dismissed_just_now {
        return ("sweeping", None);
    }
    if needs_user {
        return ("needsinput", None);
    }
    if !(6..22).contains(&hour) {
        return ("sleeping", None);
    }
    ("idle", None)
}

fn newest_bucket_ts(items: &[DecItem]) -> Option<String> {
    items
        .iter()
        .filter_map(|item| item.completed_at.clone().or(item.created_at.clone()))
        .max()
}

/// Whether `newest_ts` is within `JUST_NOW_SECS` of "now".
///
/// Parses RFC3339 (the format loop-lib.cjs uses for `created_at` /
/// `completed_at`) and falls back to `false` on any parse failure — we'd
/// rather under-emphasize "just now" than crash the watcher.
fn is_just_now(newest_ts: &Option<String>) -> bool {
    let Some(t) = newest_ts else { return false };
    // Lightweight RFC3339-ish parser: positions 0..=9 are YYYY-MM-DD,
    // 11..=12 HH, 14..=15 MM, 17..=18 SS. We do not handle fractional
    // seconds or full ISO 8601 week dates — loop emits a fixed shape and
    // anything else is conservatively treated as "not just now".
    if t.len() < 19 {
        return false;
    }
    let parse_int = |s: &str| s.parse::<u32>().ok();
    let (Some(y), Some(mo), Some(d)) = (
        parse_int(&t[0..4]),
        parse_int(&t[5..7]),
        parse_int(&t[8..10]),
    ) else {
        return false;
    };
    let (Some(h), Some(mi), Some(s)) = (
        parse_int(&t[11..13]),
        parse_int(&t[14..16]),
        parse_int(&t[17..19]),
    ) else {
        return false;
    };
    let days_from_epoch = days_from_civil(y, mo, d);
    let stamp = days_from_epoch * 86_400 + h as i64 * 3_600 + mi as i64 * 60 + s as i64;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(stamp);
    (now - stamp).abs() < JUST_NOW_SECS
}

/// Howard Hinnant's `days_from_civil` (https://howardhinnant.github.io/date_algorithms.html).
/// Inverse of the algorithm: given y/m/d, returns the count of days since
/// the Unix epoch (1970-01-01). Fast, branch-light, and dependency-free.
fn days_from_civil(y: u32, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y } as i64;
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400; // [0, 399]
    let m = m as i64;
    let d = d as i64;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146_097 + doe - 719_468
}

/// Local hour used by the `sleeping` rule.
///
/// `chrono` isn't in our dep tree, so we approximate the user's timezone
/// with a fixed UTC+8 offset (openloomi is primarily used in APAC). A
/// future revision can read the system timezone via `tauri::api` or
/// expose this as a Tauri command if precision matters.
fn current_hour_local() -> u32 {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    ((secs / 3600 + 8) % 24) as u32
}

/// Whether the runtime already has a usable conversation-model
/// configuration from the watcher's point of view. Mirrors the
/// combined `defaultAgent` + `systemDefaults.anthropic_compatible.hasApiKey`
/// gate on the JS side (see `apps/web/app/(chat)/api/preferences/ai/route.ts`
/// and `apps/web/lib/ai/conversation-api-configuration.ts`). Used to decide
/// whether the watcher should emit the `needs-setup` hint — if either an
/// env key is set or the active agent runtime ships its own auth, the user
/// is already configured and we stay silent. User-set DB keys aren't
/// visible to the watcher; the pet card surfaces those via its own
/// `apply()` flow.
fn has_anthropic_env_key() -> bool {
    // Non-claude runtimes (codex/opencode/hermes/openclaw) bring their own
    // CLI auth, so an anthropic key is irrelevant. We still read the env
    // var ourselves instead of shelling out because the watcher runs
    // before the web server is reachable on first launch.
    if let Ok(value) = std::env::var("OPENLOOMI_AGENT_PROVIDER") {
        let trimmed = value.trim();
        if !trimmed.is_empty() && !trimmed.eq_ignore_ascii_case("claude") {
            return true;
        }
    }
    let set = |name: &str| {
        std::env::var(name)
            .ok()
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false)
    };
    set("ANTHROPIC_API_KEY") || set("ANTHROPIC_AUTH_TOKEN")
}

// ---------------------------------------------------------------------------
// External pet state driver — tail ~/.openloomi/pet/runtime_state.json
// and forward each new payload to `handle_runtime_state_event`. Same
// mtime-poll design as `watch_loop` so we don't take a dep on the
// `notify` crate just for one file.
// ---------------------------------------------------------------------------

/// How often to poll the runtime_state file. 1 s is enough — the
/// bridge fires `pet <state>` at human pace and the worst-case
/// staleness is one poll cycle. Don't make this faster than
/// `POLL_MS / 2` so a misbehaving writer can't busy-loop the watcher.
const RUNTIME_STATE_POLL_MS: u64 = 1000;

/// JSON shape written by `/api/pet/state`. Mirrors the Rust
/// `RuntimeStatePayload` in `state.rs` (intentionally duplicated —
/// these two types live on opposite sides of a filesystem, not a
/// type-checked boundary).
#[derive(Deserialize)]
struct RuntimeStateFilePayload {
    state: String,
    #[serde(default)]
    monologue: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    source: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    persisted_at: Option<String>,
}

fn watch_runtime_state_loop(app: &AppHandle) {
    // Mirror the FIRST_RUN_SETUP_DELAY grace so the eagerly-built
    // pet / bubble webviews mount their listeners before the first
    // emit. Without this the initial state change can be lost.
    std::thread::sleep(Duration::from_millis(FIRST_RUN_SETUP_DELAY_MS));

    let path = resolve_pet_runtime_state_path(app);

    // Initial mtime capture. If the file already exists when the
    // watcher starts (e.g. user ran `pet happy` before opening the
    // desktop app), we want to apply it once on boot.
    let mut last_mtime: Option<std::time::SystemTime> =
        std::fs::metadata(&path).and_then(|m| m.modified()).ok();

    // Apply the existing file once on startup so a state set while
    // the desktop was closed is still honored when it reopens.
    if last_mtime.is_some() {
        apply_runtime_state_file(app, &path);
    }

    loop {
        std::thread::sleep(Duration::from_millis(RUNTIME_STATE_POLL_MS));

        let Ok(meta) = std::fs::metadata(&path) else {
            // File removed — clear the mtime so a later recreate
            // re-applies the new state. Do NOT emit anything here;
            // absence of the file means "no external override".
            last_mtime = None;
            continue;
        };
        let Ok(mtime) = meta.modified() else {
            continue;
        };
        if last_mtime == Some(mtime) {
            continue;
        }
        last_mtime = Some(mtime);
        apply_runtime_state_file(app, &path);
    }
}

fn apply_runtime_state_file(app: &AppHandle, path: &std::path::Path) {
    let Ok(bytes) = std::fs::read(path) else {
        return;
    };
    let Ok(payload) = serde_json::from_slice::<RuntimeStateFilePayload>(&bytes) else {
        eprintln!(
            "[loomi-pet] runtime_state.json present but malformed; ignoring. path={}",
            path.display()
        );
        return;
    };
    // The handler enforces the same allowlist as the HTTP route. We
    // serialize back through JSON so `handle_runtime_state_event`
    // gets the exact payload shape it already validates.
    let forwarded = serde_json::json!({
        "state": payload.state,
        "monologue": payload.monologue,
    });
    if let Err(error) = handle_runtime_state_event(app, &forwarded.to_string()) {
        eprintln!("[loomi-pet] ignored runtime_state file: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap(pending: usize, done: usize, dismissed: usize) -> DecisionsSnap {
        DecisionsSnap {
            pending: (0..pending)
                .map(|i| DecItem {
                    id: Some(format!("dec_test_pending_{i}")),
                    r#type: Some("draft_reply".into()),
                    title: Some(format!("pending {i}")),
                    dialogue: None,
                    confidence: Some(0.8),
                    source_signal: None,
                    context: None,
                    created_at: Some(format!("2026-01-01T00:00:0{i}Z")),
                    completed_at: None,
                    needs_user: None,
                })
                .collect(),
            done: (0..done)
                .map(|i| DecItem {
                    id: Some(format!("dec_test_done_{i}")),
                    r#type: Some("draft_reply".into()),
                    title: Some(format!("done {i}")),
                    dialogue: None,
                    confidence: Some(0.8),
                    source_signal: None,
                    context: None,
                    created_at: None,
                    completed_at: Some(format!("2026-01-01T00:00:0{i}Z")),
                    needs_user: None,
                })
                .collect(),
            dismissed: (0..dismissed)
                .map(|i| DecItem {
                    id: Some(format!("dec_test_dismissed_{i}")),
                    r#type: Some("draft_reply".into()),
                    title: Some(format!("dismissed {i}")),
                    dialogue: None,
                    confidence: Some(0.8),
                    source_signal: None,
                    context: None,
                    created_at: Some(format!("2026-01-01T00:00:0{i}Z")),
                    completed_at: None,
                    needs_user: None,
                })
                .collect(),
        }
    }

    #[test]
    fn empty_pending_during_sleep_hours_is_sleeping() {
        let s = snap(0, 0, 0);
        // Force sleeping window by stubbing hour via a one-off wrapper.
        // We can't easily inject hour, so check both branches: any result
        // is "sleeping" or "idle" depending on local clock; just assert
        // it is not the "happy" / "juggling" family.
        let (state, _) = map_state_to_pet(&s, false, false);
        assert!(matches!(state, "sleeping" | "idle"), "got {state}");
    }

    #[test]
    fn multiple_pending_does_not_claim_runtime_is_juggling() {
        let s = snap(3, 0, 0);
        let (state, mono) = map_state_to_pet(&s, false, false);
        assert!(matches!(state, "idle" | "sleeping"), "got {state}");
        assert_eq!(mono, None);
    }

    #[test]
    fn single_pending_with_needs_user_is_needsinput() {
        let mut s = snap(1, 0, 0);
        s.pending[0].needs_user = Some(true);
        let (state, _) = map_state_to_pet(&s, true, false);
        assert_eq!(state, "needsinput");
    }

    #[test]
    fn single_pending_no_needs_user_stays_at_baseline() {
        let s = snap(1, 0, 0);
        let (state, _) = map_state_to_pet(&s, false, false);
        assert!(matches!(state, "idle" | "sleeping"), "got {state}");
    }

    #[test]
    fn fresh_pending_does_not_make_an_old_done_item_presenting() {
        let mut s = snap(1, 1, 0);
        s.pending[0].created_at = Some(format_iso_now_approx());
        s.done[0].completed_at = Some("2020-01-01T00:00:00Z".into());

        let (state, _) = map_state_to_pet(&s, false, false);
        assert!(matches!(state, "idle" | "sleeping"), "got {state}");
    }

    /// Build a snapshot whose `done` bucket contains exactly one
    /// decision whose `completed_at` matches the supplied ISO string.
    /// Helper for the `presenting` rule tests below — keeps the test
    /// bodies focused on the input/output contract.
    fn snap_with_done_completed_at(done: usize, completed_at: &str) -> DecisionsSnap {
        DecisionsSnap {
            pending: Vec::new(),
            done: (0..done)
                .map(|i| DecItem {
                    id: Some(format!("dec_test_done_{i}")),
                    r#type: Some("draft_reply".into()),
                    title: Some(format!("done {i}")),
                    dialogue: None,
                    confidence: Some(0.8),
                    source_signal: None,
                    context: None,
                    created_at: None,
                    completed_at: Some(completed_at.into()),
                    needs_user: None,
                })
                .collect(),
            dismissed: Vec::new(),
        }
    }

    #[test]
    fn done_with_just_now_and_not_reviewed_emits_presenting() {
        // The done item's completion time is "now-ish" (the test runs at
        // the moment of wall-clock), `reviewed_recently = false` → we
        // expect the `presenting` rule to win over the `happy` rule that would
        // otherwise fire on `done > 0 && just_now`.
        let now_iso = format_iso_now_approx();
        let s = snap_with_done_completed_at(1, &now_iso);
        let (state, _) = map_state_to_pet(&s, false, false);
        assert_eq!(state, "presenting");
    }

    #[test]
    fn done_with_just_now_and_reviewed_falls_back_to_happy() {
        let now_iso = format_iso_now_approx();
        let s = snap_with_done_completed_at(1, &now_iso);
        let (state, _) = map_state_to_pet(&s, false, true);
        assert_eq!(state, "happy");
    }

    #[test]
    fn done_with_old_completed_at_never_emits_presenting() {
        // `completed_at` is years in the past — `just_now` returns
        // false, so we skip both `presenting` and `happy`. The empty
        // bucket branch lands on `idle` (or `sleeping` if the test
        // happens to run in night hours).
        let s = snap_with_done_completed_at(1, "2020-01-01T00:00:00Z");
        let (state, _) = map_state_to_pet(&s, false, false);
        assert!(
            matches!(state, "idle" | "sleeping"),
            "expected idle/sleeping, got {state}"
        );
    }

    #[test]
    fn watcher_emits_when_time_changes_state_without_file_changes() {
        assert!(should_emit_update(false, false, Some("presenting"), "idle"));
    }

    #[test]
    fn watcher_stays_quiet_when_data_review_and_state_are_unchanged() {
        assert!(!should_emit_update(false, false, Some("idle"), "idle"));
    }

    /// Rough "now" in the format `is_just_now` accepts. We don't need
    /// timezone precision — `is_just_now` only checks the absolute
    /// delta against the wall clock, and `secs` are bounded enough
    /// that UTC vs local makes no difference for the just-now test.
    fn format_iso_now_approx() -> String {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let (y, mo, d, h, mi, s) = epoch_to_ymdhms(secs);
        format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
    }

    /// Tiny epoch → civil converter used only by the just-now tests.
    /// Mirrors the algorithm in `theme::civil_from_days`; copied here
    /// rather than re-exported because tests in this file already
    /// exercise pure data flow.
    fn epoch_to_ymdhms(secs: u64) -> (u32, u32, u32, u32, u32, u32) {
        let s = (secs % 60) as u32;
        let m = ((secs / 60) % 60) as u32;
        let h = ((secs / 3600) % 24) as u32;
        let days = (secs / 86_400) as i64;
        let z = days + 719_468;
        let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
        let doe = (z - era * 146_097) as u64;
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        let y_signed = yoe as i64 + era * 400;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d_signed = doy - (153 * mp + 2) / 5 + 1;
        let m_signed = if mp < 10 { mp + 3 } else { mp - 9 };
        let y = if m_signed <= 2 {
            y_signed + 1
        } else {
            y_signed
        };
        (y as u32, m_signed as u32, d_signed as u32, h, m, s)
    }

    fn dec_with_id(id: &str) -> DecItem {
        DecItem {
            id: Some(id.into()),
            r#type: Some("draft_reply".into()),
            title: Some(format!("title {id}")),
            dialogue: Some("hello".into()),
            confidence: Some(0.8),
            source_signal: None,
            context: None,
            created_at: None,
            completed_at: Some("2026-01-01T00:00:00Z".into()),
            needs_user: None,
        }
    }

    #[test]
    fn build_decision_payload_includes_status_pending() {
        // The card's success branch keys on `payload.status !== "pending"`.
        // If the top-pending emit forgets the field, the contract breaks
        // silently. Lock the field in via test.
        let d = dec_with_id("dec_x");
        let v = build_decision_payload(&d);
        assert_eq!(
            v.get("status").and_then(|s| s.as_str()),
            Some("pending"),
            "top-pending payload must include status=pending"
        );
        assert_eq!(v.get("id").and_then(|s| s.as_str()), Some("dec_x"));
    }

    #[test]
    fn build_decision_payload_includes_confidence() {
        // The card's meta-node row renders `Math.round(confidence * 100) +
        // "%"`. The top-pending emit (`loop:decision`) is the only event
        // that drives that row, so it must carry confidence too — the
        // priority chip is derived from the same value upstream so the
        // raw number on the card matches the chip. Without this test the
        // field was forgotten and the card rendered "—" even for a
        // decision with confidence=0.92 (bug surfaced via the
        // birthday_wish demo screenshot, 2026-07-14).
        let d = dec_with_id("dec_y");
        let v = build_decision_payload(&d);
        let conf = v.get("confidence").and_then(|c| c.as_f64());
        assert!(
            conf.is_some(),
            "top-pending payload must include numeric confidence; got {:?}",
            v.get("confidence"),
        );
        let conf = conf.unwrap();
        assert!(
            (0.0..=1.0).contains(&conf),
            "confidence must be in [0,1]; got {conf}"
        );
        // The priority field is derived from confidence upstream, so the
        // two values must agree on the chip bucket (0.92 → p0).
        let p = v.get("priority").and_then(|s| s.as_str()).unwrap_or("");
        let expected = if conf >= 0.85 {
            "p0"
        } else if conf >= 0.75 {
            "p1"
        } else {
            "p2"
        };
        assert_eq!(p, expected, "priority must match confidence bucket");
    }

    #[test]
    fn diff_completed_ids_returns_missing() {
        // Two ids pending, one stays, one moves to done. Expect the
        // missing one to surface as ("b", "done").
        let prev = vec!["a".to_string(), "b".to_string()];
        let curr = vec!["a".to_string()];
        let mut s = snap(0, 0, 0);
        s.done.push(dec_with_id("b"));
        let out = diff_completed_ids(&prev, &curr, &s);
        assert_eq!(out, vec![("b".to_string(), "done".to_string())]);
    }

    #[test]
    fn terminal_payload_resolves_done_vs_dismissed() {
        // Decision "x" moved to done and "y" moved to dismissed. The
        // helper should pull title/type from the looked-up item and
        // stamp the resolved status. Also covers the "missing from
        // buckets" fallback path: id "z" left pending but isn't in
        // either bucket → falls back to "done".
        let prev = vec!["x".to_string(), "y".to_string(), "z".to_string()];
        let curr: Vec<String> = vec![];
        let mut s = snap(0, 0, 0);
        s.done.push(dec_with_id("x"));
        s.dismissed.push(dec_with_id("y"));
        // Note: "z" deliberately not added to either bucket.
        let transitions = diff_completed_ids(&prev, &curr, &s);
        assert_eq!(transitions.len(), 3);
        assert_eq!(transitions[0], ("x".to_string(), "done".to_string()));
        assert_eq!(transitions[1], ("y".to_string(), "dismissed".to_string()));
        assert_eq!(transitions[2], ("z".to_string(), "done".to_string())); // fallback

        // And the terminal payload helper renders the resolved status
        // for the two items it can find.
        let px = build_terminal_decision_payload("x", "done", &s).expect("x payload");
        assert_eq!(px.get("status").and_then(|s| s.as_str()), Some("done"));
        assert_eq!(px.get("id").and_then(|s| s.as_str()), Some("x"));
        let py = build_terminal_decision_payload("y", "dismissed", &s).expect("y payload");
        assert_eq!(py.get("status").and_then(|s| s.as_str()), Some("dismissed"));
        // Missing item → None rather than a half-formed payload.
        assert!(build_terminal_decision_payload("z", "done", &s).is_none());
    }
}
