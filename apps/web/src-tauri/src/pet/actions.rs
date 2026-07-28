// User-defined Pet menu actions are prompt templates, not executable
// endpoints. The widget receives only sanitized menu metadata
// (`id`, `label`, `enabled`). On click, Rust resolves the prompt by id
// and hands it to the normal Loomi agent runtime through Chat.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::theme;

pub const ACTIONS_CONFIG_FILENAME: &str = "pet-actions.json";

const SUPPORTED_VERSION: u32 = 1;
const MAX_ACTIONS: usize = 8;
const MAX_ID_LEN: usize = 64;
const MAX_LABEL_CHARS: usize = 48;
const MAX_PROMPT_CHARS: usize = 4000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetActionsConfig {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub actions: Vec<PetActionDefinition>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

impl Default for PetActionsConfig {
    fn default() -> Self {
        Self {
            version: SUPPORTED_VERSION,
            enabled: false,
            actions: Vec::new(),
            updated_at: None,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetActionDefinition {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetContextActionsView {
    pub version: u32,
    pub enabled: bool,
    pub actions: Vec<PetContextActionView>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetContextActionView {
    pub id: String,
    pub label: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PetContextActionPrompt {
    pub action_id: String,
    pub label: String,
    pub prompt: String,
}

#[derive(Debug, Clone)]
struct SanitizedAction {
    id: String,
    label: String,
    prompt: String,
    enabled: bool,
}

fn default_version() -> u32 {
    SUPPORTED_VERSION
}

pub fn actions_config_path(app: &AppHandle) -> PathBuf {
    theme::config_path(app).with_file_name(ACTIONS_CONFIG_FILENAME)
}

pub fn read_config(app: &AppHandle) -> PetActionsConfig {
    read_config_at(&actions_config_path(app))
}

fn read_config_at(path: &Path) -> PetActionsConfig {
    match std::fs::read(path) {
        Ok(bytes) => {
            let raw = bytes.as_slice();
            let json = raw.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(raw);
            if json.iter().all(|byte| byte.is_ascii_whitespace()) {
                return PetActionsConfig::default();
            }
            match serde_json::from_slice::<PetActionsConfig>(json) {
                Ok(cfg) => cfg,
                Err(e) => {
                    eprintln!(
                        "[loomi-pet/actions] failed to parse {}: {e}; using defaults",
                        path.display()
                    );
                    PetActionsConfig::default()
                }
            }
        }
        Err(_) => PetActionsConfig::default(),
    }
}

pub fn build_view(cfg: &PetActionsConfig) -> PetContextActionsView {
    let supported = cfg.version == SUPPORTED_VERSION;
    let enabled = supported && cfg.enabled;
    let actions = if enabled {
        sanitized_actions(cfg)
            .into_iter()
            .filter(|action| action.enabled)
            .map(|action| PetContextActionView {
                id: action.id,
                label: action.label,
                enabled: action.enabled,
            })
            .collect()
    } else {
        Vec::new()
    };

    PetContextActionsView {
        version: cfg.version,
        enabled,
        actions,
        updated_at: cfg.updated_at.clone(),
    }
}

pub fn resolve_action_prompt(
    cfg: &PetActionsConfig,
    action_id: &str,
) -> Result<PetContextActionPrompt, String> {
    if cfg.version != SUPPORTED_VERSION {
        return Err(format!("unsupported pet actions version: {}", cfg.version));
    }
    if !cfg.enabled {
        return Err("pet context actions are disabled".into());
    }

    sanitized_actions(cfg)
        .into_iter()
        .find(|action| action.enabled && action.id == action_id)
        .map(|action| PetContextActionPrompt {
            action_id: action.id,
            label: action.label,
            prompt: action.prompt,
        })
        .ok_or_else(|| format!("pet context action not found: {action_id}"))
}

pub fn build_agent_prompt(action: &PetContextActionPrompt) -> String {
    format!(
        "The user selected this Loomi Pet action:\n\n\
Action: {}\n\
Action id: {}\n\n\
Task:\n{}\n\n\
Use the available OpenLoomi agent runtime, skills, MCP servers, connectors, local APIs, or CLI helpers as appropriate. Ask for confirmation before privacy-sensitive or destructive actions.",
        action.label, action.action_id, action.prompt
    )
}

fn sanitized_actions(cfg: &PetActionsConfig) -> Vec<SanitizedAction> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();

    for action in cfg.actions.iter().take(MAX_ACTIONS) {
        let Some(id) = sanitize_id(&action.id) else {
            continue;
        };
        if !seen.insert(id.clone()) {
            continue;
        }
        let Some(label) = sanitize_label(&action.label) else {
            continue;
        };
        let Some(prompt) = sanitize_prompt(&action.prompt) else {
            continue;
        };
        out.push(SanitizedAction {
            id,
            label,
            prompt,
            enabled: action.enabled.unwrap_or(true),
        });
    }

    out
}

fn sanitize_id(raw: &str) -> Option<String> {
    let id = raw.trim();
    if id.is_empty() || id.len() > MAX_ID_LEN {
        return None;
    }
    if id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        Some(id.to_string())
    } else {
        None
    }
}

fn sanitize_label(raw: &str) -> Option<String> {
    let label = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if label.is_empty() {
        return None;
    }
    Some(truncate_chars(&label, MAX_LABEL_CHARS))
}

fn sanitize_prompt(raw: &str) -> Option<String> {
    let normalized = raw.replace("\r\n", "\n").replace('\r', "\n");
    let prompt = normalized
        .trim()
        .chars()
        .filter(|c| *c == '\n' || *c == '\t' || !c.is_control())
        .collect::<String>();
    if prompt.is_empty() {
        return None;
    }
    Some(truncate_chars(&prompt, MAX_PROMPT_CHARS))
}

fn truncate_chars(raw: &str, max_chars: usize) -> String {
    raw.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_action(prompt: &str) -> PetActionDefinition {
        PetActionDefinition {
            id: "daily-brief".into(),
            label: "Prepare daily brief".into(),
            prompt: prompt.into(),
            enabled: None,
        }
    }

    #[test]
    fn default_config_is_disabled_and_empty() {
        let cfg = PetActionsConfig::default();
        let view = build_view(&cfg);
        assert!(!view.enabled);
        assert!(view.actions.is_empty());
    }

    #[test]
    fn build_view_exposes_only_sanitized_action_fields() {
        let cfg = PetActionsConfig {
            version: 1,
            enabled: true,
            actions: vec![
                sample_action("Prepare a concise daily brief."),
                PetActionDefinition {
                    id: "bad action".into(),
                    label: "Bad".into(),
                    prompt: "Should be skipped".into(),
                    enabled: None,
                },
                PetActionDefinition {
                    id: "missing-prompt".into(),
                    label: "Missing prompt".into(),
                    prompt: "".into(),
                    enabled: None,
                },
                PetActionDefinition {
                    id: "disabled".into(),
                    label: "Disabled".into(),
                    prompt: "Should be hidden".into(),
                    enabled: Some(false),
                },
                PetActionDefinition {
                    id: "daily-brief".into(),
                    label: "Duplicate".into(),
                    prompt: "Duplicate should be skipped".into(),
                    enabled: None,
                },
            ],
            updated_at: Some("2026-07-27T00:00:00Z".into()),
        };

        let view = build_view(&cfg);
        assert!(view.enabled);
        assert_eq!(view.actions.len(), 1);
        assert_eq!(view.actions[0].id, "daily-brief");
        assert_eq!(view.actions[0].label, "Prepare daily brief");
        assert!(view.actions[0].enabled);

        let json = serde_json::to_value(&view).unwrap();
        assert!(json["actions"][0].get("prompt").is_none());
    }

    #[test]
    fn resolve_action_prompt_returns_sanitized_prompt_payload() {
        let cfg = PetActionsConfig {
            version: 1,
            enabled: true,
            actions: vec![sample_action(
                "  Prepare my daily brief.\r\nAsk before changing data.  ",
            )],
            updated_at: None,
        };

        let resolved = resolve_action_prompt(&cfg, "daily-brief").unwrap();
        assert_eq!(resolved.action_id, "daily-brief");
        assert_eq!(resolved.label, "Prepare daily brief");
        assert_eq!(
            resolved.prompt,
            "Prepare my daily brief.\nAsk before changing data."
        );
    }

    #[test]
    fn build_agent_prompt_frames_action_for_runtime() {
        let action = PetContextActionPrompt {
            action_id: "workspace-summary".into(),
            label: "Summarize workspace".into(),
            prompt: "Identify goals, blockers, and next safe steps.".into(),
        };

        let prompt = build_agent_prompt(&action);
        assert!(prompt.contains("The user selected this Loomi Pet action"));
        assert!(prompt.contains("Summarize workspace"));
        assert!(prompt.contains("Identify goals, blockers, and next safe steps."));
        assert!(prompt.contains("OpenLoomi agent runtime"));
        assert!(prompt.contains("Ask for confirmation"));
    }

    #[test]
    fn target_only_actions_are_not_rendered() {
        let raw = r#"{
          "version": 1,
          "enabled": true,
          "actions": [
            {
              "id": "direct-http",
              "label": "Direct HTTP",
              "target": "http://127.0.0.1:48173/action"
            }
          ]
        }"#;

        let cfg = serde_json::from_str::<PetActionsConfig>(raw).unwrap();
        let view = build_view(&cfg);
        assert!(view.actions.is_empty());
    }

    #[test]
    fn read_malformed_config_as_default() {
        let dir =
            std::env::temp_dir().join(format!("loomi-pet-actions-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("pet-actions.json");
        std::fs::write(&path, b"{ nope").unwrap();

        let cfg = read_config_at(&path);
        assert!(!cfg.enabled);
        assert!(cfg.actions.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_empty_config_as_default() {
        let dir = std::env::temp_dir().join(format!(
            "loomi-pet-actions-empty-test-{}",
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("pet-actions.json");
        std::fs::write(&path, b"\xEF\xBB\xBF  \r\n\t").unwrap();

        let cfg = read_config_at(&path);
        assert!(!cfg.enabled);
        assert!(cfg.actions.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_utf8_bom_config() {
        let dir =
            std::env::temp_dir().join(format!("loomi-pet-actions-bom-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("pet-actions.json");
        let mut bytes = b"\xEF\xBB\xBF".to_vec();
        bytes.extend_from_slice(
            br#"{
              "version": 1,
              "enabled": true,
              "actions": [
                {
                  "id": "daily-brief",
                  "label": "Prepare daily brief",
                  "prompt": "Prepare my daily brief."
                }
              ]
            }"#,
        );
        std::fs::write(&path, bytes).unwrap();

        let cfg = read_config_at(&path);
        let view = build_view(&cfg);
        assert_eq!(view.actions.len(), 1);
        assert_eq!(view.actions[0].id, "daily-brief");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
