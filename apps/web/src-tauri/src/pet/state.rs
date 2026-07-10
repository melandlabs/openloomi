use std::sync::{Mutex, OnceLock};

use serde::Deserialize;
use tauri::{AppHandle, Emitter};

use super::{PET_BUBBLE_LABEL, PET_LABEL};

#[derive(Clone, Debug, PartialEq, Eq)]
struct VisualState {
    state: String,
    monologue: Option<String>,
}

impl VisualState {
    fn new(state: impl Into<String>, monologue: Option<String>) -> Self {
        Self {
            state: state.into(),
            monologue,
        }
    }
}

#[derive(Debug)]
struct StateCoordinator {
    baseline: VisualState,
    runtime: Option<VisualState>,
}

impl Default for StateCoordinator {
    fn default() -> Self {
        Self {
            baseline: VisualState::new("idle", None),
            runtime: None,
        }
    }
}

impl StateCoordinator {
    fn publish_baseline(&mut self, next: VisualState) -> Option<VisualState> {
        self.baseline = next.clone();
        self.runtime.is_none().then_some(next)
    }

    fn publish_runtime(&mut self, next: Option<VisualState>) -> VisualState {
        self.runtime = next;
        self.runtime
            .clone()
            .unwrap_or_else(|| self.baseline.clone())
    }
}

#[derive(Deserialize)]
struct RuntimeStatePayload {
    state: String,
    #[serde(default)]
    monologue: Option<String>,
}

static STATE_COORDINATOR: OnceLock<Mutex<StateCoordinator>> = OnceLock::new();

fn coordinator() -> &'static Mutex<StateCoordinator> {
    STATE_COORDINATOR.get_or_init(|| Mutex::new(StateCoordinator::default()))
}

fn emit_state(app: &AppHandle, state: &VisualState) {
    let payload = serde_json::json!({
        "state": state.state,
        "monologue": state.monologue,
    });
    let _ = app.emit_to(PET_LABEL, "loop:state", payload.clone());
    let _ = app.emit_to(PET_BUBBLE_LABEL, "loop:state", payload);
}

fn is_supported_runtime_state(state: &str) -> bool {
    matches!(
        state,
        "idle" | "thinking" | "working" | "juggling" | "happy" | "presenting" | "needsinput"
    )
}

/// Update the background state derived from Loop decisions. Active chat work
/// temporarily owns the sprite, but the latest baseline is retained and
/// restored as soon as the runtime bridge releases its override.
pub fn publish_baseline_state(
    app: &AppHandle,
    state: impl Into<String>,
    monologue: Option<String>,
) {
    let next = VisualState::new(state, monologue);
    let effective = coordinator()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .publish_baseline(next);
    if let Some(effective) = effective {
        emit_state(app, &effective);
    }
}

/// Apply a state emitted by the chat UI. `idle` is a release signal rather
/// than a permanent override: it restores the latest Loop-derived baseline.
pub fn handle_runtime_state_event(app: &AppHandle, payload: &str) -> Result<(), String> {
    let payload: RuntimeStatePayload =
        serde_json::from_str(payload).map_err(|error| error.to_string())?;
    let state = payload.state.trim();
    if !is_supported_runtime_state(state) {
        return Err(format!("unsupported pet runtime state: {state}"));
    }

    let next = if state == "idle" {
        None
    } else {
        Some(VisualState::new(state, payload.monologue))
    };
    let effective = coordinator()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .publish_runtime(next);
    emit_state(app, &effective);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_state_overrides_baseline_updates() {
        let mut state = StateCoordinator::default();
        assert_eq!(
            state.publish_runtime(Some(VisualState::new("working", None))),
            VisualState::new("working", None)
        );
        assert_eq!(
            state.publish_baseline(VisualState::new("sleeping", None)),
            None
        );
    }

    #[test]
    fn releasing_runtime_restores_latest_baseline() {
        let mut state = StateCoordinator::default();
        state.publish_runtime(Some(VisualState::new("thinking", None)));
        state.publish_baseline(VisualState::new("needsinput", Some("Review me".into())));

        assert_eq!(
            state.publish_runtime(None),
            VisualState::new("needsinput", Some("Review me".into()))
        );
    }

    #[test]
    fn runtime_state_allowlist_rejects_background_only_states() {
        assert!(is_supported_runtime_state("juggling"));
        assert!(!is_supported_runtime_state("sleeping"));
        assert!(!is_supported_runtime_state("needs-setup"));
    }
}
