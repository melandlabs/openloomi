// Loomi Pet context actions.
//
// User-defined menu actions are intentionally narrow: OpenLoomi reads a
// versioned config file from `~/.openloomi/pet-actions.json`, renders only
// sanitized labels in the pet menu, and dispatches clicks as bounded POSTs to
// literal loopback URLs. The target URL never crosses into the widget.

use std::collections::HashSet;
use std::io::Read;
use std::net::{Ipv4Addr, Ipv6Addr};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use url::{Host, Url};

use super::theme;

pub const ACTIONS_CONFIG_FILENAME: &str = "pet-actions.json";

const SUPPORTED_VERSION: u32 = 1;
const DEFAULT_TIMEOUT_MS: u64 = 1500;
const MIN_TIMEOUT_MS: u64 = 100;
const MAX_TIMEOUT_MS: u64 = 5000;
const MAX_RESPONSE_BYTES: usize = 8 * 1024;
const MAX_ACTIONS: usize = 24;
const MAX_ID_LEN: usize = 64;
const MAX_LABEL_LEN: usize = 80;

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
    pub id: String,
    pub label: String,
    pub target: String,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetActionDispatchResult {
    pub action_id: String,
    pub ok: bool,
    pub status: Option<u16>,
    pub response: Option<String>,
    pub truncated: bool,
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
        Ok(bytes) => match serde_json::from_slice::<PetActionsConfig>(&bytes) {
            Ok(cfg) => cfg,
            Err(e) => {
                eprintln!(
                    "[loomi-pet/actions] failed to parse {}: {e}; using defaults",
                    path.display()
                );
                PetActionsConfig::default()
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => PetActionsConfig::default(),
        Err(e) => {
            eprintln!(
                "[loomi-pet/actions] failed to read {}: {e}; using defaults",
                path.display()
            );
            PetActionsConfig::default()
        }
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

pub fn dispatch_action(
    app: &AppHandle,
    action_id: &str,
) -> Result<PetActionDispatchResult, String> {
    let cfg = read_config(app);
    dispatch_action_from_config(&cfg, action_id)
}

fn dispatch_action_from_config(
    cfg: &PetActionsConfig,
    action_id: &str,
) -> Result<PetActionDispatchResult, String> {
    if cfg.version != SUPPORTED_VERSION {
        return Err(format!("unsupported pet actions version: {}", cfg.version));
    }
    if !cfg.enabled {
        return Err("pet context actions are disabled".into());
    }

    let action = sanitized_actions(cfg)
        .into_iter()
        .find(|action| action.id == action_id)
        .ok_or_else(|| "pet context action not found".to_string())?;
    if !action.enabled {
        return Err("pet context action is disabled".into());
    }

    let target = validate_loopback_target(&action.target)?;
    let timeout = effective_timeout(action.timeout_ms);
    let client = reqwest::blocking::Client::builder()
        .timeout(timeout)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("build HTTP client: {e}"))?;
    let payload = dispatch_payload(&action.id);
    let response = client
        .post(target)
        .json(&payload)
        .send()
        .map_err(|e| format!("dispatch pet context action: {e}"))?;

    let status = response.status();
    let mut limited = response.take((MAX_RESPONSE_BYTES + 1) as u64);
    let mut bytes = Vec::new();
    limited
        .read_to_end(&mut bytes)
        .map_err(|e| format!("read pet context action response: {e}"))?;
    let truncated = bytes.len() > MAX_RESPONSE_BYTES;
    if truncated {
        bytes.truncate(MAX_RESPONSE_BYTES);
    }
    let response = if bytes.is_empty() {
        None
    } else {
        Some(String::from_utf8_lossy(&bytes).to_string())
    };

    Ok(PetActionDispatchResult {
        action_id: action.id,
        ok: status.is_success(),
        status: Some(status.as_u16()),
        response,
        truncated,
    })
}

#[derive(Debug, Clone)]
struct SanitizedAction {
    id: String,
    label: String,
    target: String,
    enabled: bool,
    timeout_ms: Option<u64>,
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
        if validate_loopback_target(&action.target).is_err() {
            continue;
        }
        out.push(SanitizedAction {
            id,
            label,
            target: action.target.trim().to_string(),
            enabled: action.enabled.unwrap_or(true),
            timeout_ms: action.timeout_ms,
        });
    }
    out
}

fn sanitize_id(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_ID_LEN {
        return None;
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'))
    {
        return None;
    }
    Some(trimmed.to_string())
}

fn sanitize_label(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_LABEL_LEN {
        return None;
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return None;
    }
    Some(trimmed.to_string())
}

fn effective_timeout(raw: Option<u64>) -> Duration {
    let ms = raw
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
    Duration::from_millis(ms)
}

fn validate_loopback_target(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim()).map_err(|e| format!("invalid action target URL: {e}"))?;
    if url.scheme() != "http" {
        return Err("pet context action target must use http".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("pet context action target must not include credentials".into());
    }
    if url.fragment().is_some() {
        return Err("pet context action target must not include a fragment".into());
    }
    match url.host() {
        Some(Host::Ipv4(addr)) if addr == Ipv4Addr::LOCALHOST => Ok(url),
        Some(Host::Ipv6(addr)) if addr == Ipv6Addr::LOCALHOST => Ok(url),
        _ => Err("pet context action target must be a literal loopback address".into()),
    }
}

fn dispatch_payload(action_id: &str) -> serde_json::Value {
    serde_json::json!({
        "source": "openloomi-pet",
        "version": SUPPORTED_VERSION,
        "actionId": action_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read as _, Write as _};
    use std::net::TcpListener;
    use std::thread;

    fn sample_action(target: String) -> PetActionDefinition {
        PetActionDefinition {
            id: "meeting-recorder-toggle".into(),
            label: "Start meeting recording".into(),
            target,
            enabled: None,
            timeout_ms: Some(2000),
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
                sample_action("http://127.0.0.1:48173/openloomi/pet/toggle".into()),
                PetActionDefinition {
                    id: "bad action".into(),
                    label: "Bad".into(),
                    target: "http://127.0.0.1:48173/bad".into(),
                    enabled: None,
                    timeout_ms: None,
                },
                PetActionDefinition {
                    id: "remote".into(),
                    label: "Remote".into(),
                    target: "https://example.com/pet".into(),
                    enabled: None,
                    timeout_ms: None,
                },
                PetActionDefinition {
                    id: "control-label".into(),
                    label: "Line\nBreak".into(),
                    target: "http://127.0.0.1:48173/control-label".into(),
                    enabled: None,
                    timeout_ms: None,
                },
                PetActionDefinition {
                    id: "disabled".into(),
                    label: "Disabled".into(),
                    target: "http://127.0.0.1:48173/disabled".into(),
                    enabled: Some(false),
                    timeout_ms: None,
                },
            ],
            updated_at: Some("2026-07-27T00:00:00Z".into()),
        };

        let view = build_view(&cfg);
        assert!(view.enabled);
        assert_eq!(view.actions.len(), 1);
        assert_eq!(view.actions[0].id, "meeting-recorder-toggle");
        assert_eq!(view.actions[0].label, "Start meeting recording");
        assert!(view.actions[0].enabled);
    }

    #[test]
    fn validates_literal_loopback_targets_only() {
        assert!(validate_loopback_target("http://127.0.0.1:48173/action").is_ok());
        assert!(validate_loopback_target("http://[::1]:48173/action").is_ok());
        assert!(validate_loopback_target("http://localhost:48173/action").is_err());
        assert!(validate_loopback_target("http://127.0.0.2:48173/action").is_err());
        assert!(validate_loopback_target("https://127.0.0.1:48173/action").is_err());
        assert!(validate_loopback_target("http://192.168.1.10:48173/action").is_err());
        assert!(validate_loopback_target("http://user:pw@127.0.0.1:48173/action").is_err());
        assert!(validate_loopback_target("http://127.0.0.1:48173/action#frag").is_err());
    }

    #[test]
    fn reads_malformed_config_as_default() {
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
    fn dispatch_payload_identifies_pet_source_and_action_id() {
        let payload = dispatch_payload("meeting-recorder-toggle");
        assert_eq!(payload["source"], "openloomi-pet");
        assert_eq!(payload["version"], 1);
        assert_eq!(payload["actionId"], "meeting-recorder-toggle");
    }

    #[test]
    fn dispatch_posts_bounded_payload_to_loopback() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                .unwrap();
            let mut buf = [0_u8; 2048];
            let mut bytes = Vec::new();
            let mut expected_len = None;
            loop {
                let n = stream.read(&mut buf).unwrap();
                if n == 0 {
                    break;
                }
                bytes.extend_from_slice(&buf[..n]);
                if expected_len.is_none() {
                    if let Some(header_end) = find_header_end(&bytes) {
                        let headers = String::from_utf8_lossy(&bytes[..header_end]);
                        let content_len = headers
                            .lines()
                            .find_map(|line| {
                                line.strip_prefix("Content-Length:")
                                    .or_else(|| line.strip_prefix("content-length:"))
                                    .and_then(|v| v.trim().parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        expected_len = Some(header_end + 4 + content_len);
                    }
                }
                if let Some(total) = expected_len {
                    if bytes.len() >= total {
                        break;
                    }
                }
            }
            let req = String::from_utf8_lossy(&bytes).to_string();
            stream
                .write_all(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n")
                .unwrap();
            req
        });

        let cfg = PetActionsConfig {
            version: 1,
            enabled: true,
            actions: vec![sample_action(format!(
                "http://127.0.0.1:{}/openloomi/pet/toggle",
                addr.port()
            ))],
            updated_at: None,
        };

        let result = dispatch_action_from_config(&cfg, "meeting-recorder-toggle").unwrap();
        assert!(result.ok, "expected success, got {result:?}");
        assert_eq!(result.status, Some(204));
        assert_eq!(result.response, None);
        let req = handle.join().unwrap();
        assert!(req.starts_with("POST /openloomi/pet/toggle HTTP/1.1"));
    }

    fn find_header_end(bytes: &[u8]) -> Option<usize> {
        bytes.windows(4).position(|window| window == b"\r\n\r\n")
    }
}
