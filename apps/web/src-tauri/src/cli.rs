// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

//! Non-interactive command-line entry point.

use std::io::Read;
use std::path::Path;
use std::process::Command;
use std::process::ExitCode;
use std::time::Duration;

// Conservative fallback used when update metadata does not include a file size.
const DEFAULT_UPDATE_SPACE_BYTES: u64 = 512 * 1024 * 1024;
// Downstream business tools can inspect session.platform to distinguish CLI runs.
const DEFAULT_ONE_SHOT_PLATFORM: &str = "cli";
// One-shot agent runs can legitimately take minutes when tools are involved.
const ONE_SHOT_TIMEOUT_SECS: u64 = 600;
// Test and CI callers can point the CLI at a non-default local API server.
const OPENLOOMI_API_URL_ENV: &str = "OPENLOOMI_API_URL";
// CI can provide auth without relying on the desktop token file.
const OPENLOOMI_AUTH_TOKEN_ENV: &str = "OPENLOOMI_AUTH_TOKEN";

#[derive(Debug, Clone, PartialEq, Eq)]
enum CliCommand {
    Help,
    Version,
    UpdateCheck { json: bool },
    OneShot(OneShotArgs),
}

// Parsed one-shot inputs stay separate from execution so the parser can be
// unit-tested without making network calls.
#[derive(Debug, Clone, PartialEq, Eq)]
struct OneShotArgs {
    prompt: Option<String>,
    read_stdin: bool,
    json: bool,
    model: Option<String>,
    provider: Option<String>,
    platform: Option<String>,
}

#[derive(Debug, serde::Serialize)]
struct CliErrorBody {
    code: String,
    message: String,
}

// Shape consumed by scripts and CI. Keep fields explicit and nullable instead
// of omitting them so downstream JSON parsers can stay simple.
#[derive(Debug, serde::Serialize)]
struct OneShotJsonOutput {
    ok: bool,
    command: &'static str,
    prompt_length: usize,
    stdin: bool,
    model: Option<String>,
    provider: Option<String>,
    platform: String,
    response: Option<String>,
    session_id: Option<String>,
    event_count: usize,
    text_event_count: usize,
    tool_calls: Vec<String>,
    permission_requests: usize,
    cost: Option<f64>,
    duration_ms: Option<f64>,
    error: Option<CliErrorBody>,
}

// Structured form of all update --check output, including preflight probes.
#[derive(Debug, serde::Serialize)]
struct UpdateCheckJsonOutput {
    ok: bool,
    command: &'static str,
    current_version: Option<String>,
    latest_version: Option<String>,
    has_update: Option<bool>,
    download_url: Option<String>,
    release_url: Option<String>,
    file_size: Option<u64>,
    preflight: Vec<PreflightCheck>,
    error: Option<CliErrorBody>,
}

// A single preflight probe; detail is human-readable but still stable enough
// to surface in JSON logs.
#[derive(Debug, serde::Serialize)]
struct PreflightCheck {
    name: &'static str,
    ok: bool,
    detail: String,
}

/// Payload expected by /api/native/agent. The serde renames keep this Rust
/// struct aligned with the existing Next.js route contract.
#[derive(Debug, serde::Serialize)]
struct OneShotAgentRequest<'a> {
    prompt: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: Option<&'a str>,
    platform: &'a str,
    #[serde(rename = "workDir", skip_serializing_if = "Option::is_none")]
    work_dir: Option<String>,
    #[serde(rename = "modelConfig", skip_serializing_if = "Option::is_none")]
    model_config: Option<OneShotModelConfig<'a>>,
    #[serde(rename = "permissionMode")]
    permission_mode: &'static str,
    #[serde(rename = "skillsConfig")]
    skills_config: OneShotFeatureConfig,
    #[serde(rename = "mcpConfig")]
    mcp_config: OneShotFeatureConfig,
    #[serde(rename = "authToken", skip_serializing_if = "Option::is_none")]
    auth_token: Option<&'a str>,
}

#[derive(Debug, serde::Serialize)]
struct OneShotModelConfig<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<&'a str>,
}

#[derive(Debug, serde::Serialize)]
struct OneShotFeatureConfig {
    enabled: bool,
    #[serde(rename = "userDirEnabled")]
    user_dir_enabled: bool,
    #[serde(rename = "appDirEnabled")]
    app_dir_enabled: bool,
}

// Accumulated result from the agent SSE stream.
#[derive(Debug, Default)]
struct OneShotStreamResult {
    response: String,
    session_id: Option<String>,
    event_count: usize,
    text_event_count: usize,
    tool_calls: Vec<String>,
    permission_requests: usize,
    cost: Option<f64>,
    duration_ms: Option<f64>,
    error: Option<String>,
}

#[derive(Debug)]
struct CliError {
    code: &'static str,
    message: String,
}

impl CliError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// Run the CLI with process arguments and return a process exit code.
pub async fn run_from_env() -> ExitCode {
    run(std::env::args()).await
}

async fn run<I>(args: I) -> ExitCode
where
    I: IntoIterator<Item = String>,
{
    let args: Vec<String> = args.into_iter().collect();
    // Keep parsing and execution separated so usage errors never partially run
    // a command.
    match parse_args(&args) {
        Ok(CliCommand::Help) => {
            print_help();
            ExitCode::SUCCESS
        }
        Ok(CliCommand::Version) => {
            println!("alloomi {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        Ok(CliCommand::UpdateCheck { json }) => run_update_check(json).await,
        Ok(CliCommand::OneShot(options)) => run_one_shot(options).await,
        Err(error) => {
            eprintln!("error: {}", error.message);
            eprintln!();
            eprintln!("Run `alloomi --help` for usage.");
            ExitCode::from(2)
        }
    }
}

fn parse_args(raw_args: &[String]) -> Result<CliCommand, CliError> {
    let args = raw_args.get(1..).unwrap_or_default();
    if args.is_empty() {
        return Ok(CliCommand::Help);
    }

    // --json is intentionally command-agnostic: it can be placed before or
    // after subcommands/options and still affects the final output format.
    let json = args.iter().any(|arg| arg == "--json");
    let args: Vec<String> = args
        .iter()
        .filter(|arg| *arg != "--json")
        .cloned()
        .collect();

    if args.is_empty() {
        return Ok(CliCommand::Help);
    }

    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        return Ok(CliCommand::Help);
    }
    if args.iter().any(|arg| arg == "--version" || arg == "-V") {
        return Ok(CliCommand::Version);
    }

    if args.first().map(String::as_str) == Some("update") {
        if args.iter().any(|arg| arg == "--check") {
            return Ok(CliCommand::UpdateCheck { json });
        }
        return Err(CliError::new(
            "usage",
            "`alloomi update` currently supports only `--check`.",
        ));
    }

    if args.iter().any(|arg| arg == "--one-shot" || arg == "-z") {
        return parse_one_shot_args(&args, json).map(CliCommand::OneShot);
    }

    Err(CliError::new(
        "usage",
        format!("unknown command or option: {}", args[0]),
    ))
}

fn parse_one_shot_args(args: &[String], json: bool) -> Result<OneShotArgs, CliError> {
    let mut read_stdin = false;
    let mut model = None;
    let mut provider = None;
    let mut platform = None;
    let mut prompt_parts: Vec<String> = Vec::new();

    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        match arg.as_str() {
            "--one-shot" | "-z" => {}
            "--stdin" => read_stdin = true,
            "--model" => {
                index += 1;
                model = Some(require_value(args, index, "--model")?);
            }
            "--provider" => {
                index += 1;
                provider = Some(require_value(args, index, "--provider")?);
            }
            "--platform" => {
                index += 1;
                platform = Some(require_value(args, index, "--platform")?);
            }
            _ if arg.starts_with("--model=") => {
                model = Some(require_inline_value(arg, "--model=")?);
            }
            _ if arg.starts_with("--provider=") => {
                provider = Some(require_inline_value(arg, "--provider=")?);
            }
            _ if arg.starts_with("--platform=") => {
                platform = Some(require_inline_value(arg, "--platform=")?);
            }
            _ if arg.starts_with('-') => {
                return Err(CliError::new(
                    "usage",
                    format!("unknown one-shot option: {}", arg),
                ));
            }
            // Multiple bare words are joined back into a single prompt so both
            // quoted and unquoted shell usage behave naturally.
            _ => prompt_parts.push(arg.clone()),
        }
        index += 1;
    }

    Ok(OneShotArgs {
        prompt: (!prompt_parts.is_empty()).then(|| prompt_parts.join(" ")),
        read_stdin,
        json,
        model,
        provider,
        platform,
    })
}

fn require_value(args: &[String], index: usize, flag: &'static str) -> Result<String, CliError> {
    let value = args
        .get(index)
        .filter(|value| !value.starts_with('-'))
        .cloned()
        .ok_or_else(|| CliError::new("usage", format!("{} requires a value.", flag)))?;
    Ok(value)
}

fn require_inline_value(arg: &str, prefix: &'static str) -> Result<String, CliError> {
    let value = arg.trim_start_matches(prefix);
    if value.is_empty() {
        return Err(CliError::new(
            "usage",
            format!(
                "{} requires a non-empty value.",
                prefix.trim_end_matches('=')
            ),
        ));
    }
    Ok(value.to_string())
}

async fn run_one_shot(options: OneShotArgs) -> ExitCode {
    let platform = one_shot_platform(&options);

    // Resolve local input and auth before touching the agent API. This keeps
    // usage/auth failures fast and gives scripts stable exit codes.
    let prompt = match resolve_one_shot_prompt(&options) {
        Ok(prompt) => prompt,
        Err(error) => {
            return print_one_shot_error(&options, 0, platform, error, 2);
        }
    };
    let prompt_length = prompt.trim().len();

    let auth_token = match load_cli_auth_token() {
        Ok(token) => token,
        Err(error) => {
            return print_one_shot_error(&options, prompt_length, platform, error, 1);
        }
    };

    match execute_one_shot(&prompt, &options, &platform, &auth_token).await {
        Ok(result) => {
            let ok = result.error.is_none();
            if options.json {
                // In JSON mode, all diagnostics belong inside the payload so
                // stdout remains machine-readable for pipeline consumers.
                print_json(&OneShotJsonOutput {
                    ok,
                    command: "one-shot",
                    prompt_length,
                    stdin: options.read_stdin,
                    model: options.model.clone(),
                    provider: options.provider.clone(),
                    platform,
                    response: Some(result.response.clone()),
                    session_id: result.session_id,
                    event_count: result.event_count,
                    text_event_count: result.text_event_count,
                    tool_calls: result.tool_calls,
                    permission_requests: result.permission_requests,
                    cost: result.cost,
                    duration_ms: result.duration_ms,
                    error: result.error.map(|message| CliErrorBody {
                        code: "agent_error".to_string(),
                        message,
                    }),
                });
            } else {
                // Human mode prints only the assistant text to stdout; errors
                // stay on stderr so shell redirection remains useful.
                if !result.response.is_empty() {
                    println!("{}", result.response);
                }
                if let Some(error) = result.error {
                    eprintln!("agent error: {}", error);
                }
            }

            if ok {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(1)
            }
        }
        Err(error) => print_one_shot_error(&options, prompt_length, platform, error, 1),
    }
}

fn print_one_shot_error(
    options: &OneShotArgs,
    prompt_length: usize,
    platform: String,
    error: CliError,
    exit_code: u8,
) -> ExitCode {
    if options.json {
        // Error payload mirrors the success schema to keep scripted callers
        // from needing separate parsers for failure cases.
        print_json(&OneShotJsonOutput {
            ok: false,
            command: "one-shot",
            prompt_length,
            stdin: options.read_stdin,
            model: options.model.clone(),
            provider: options.provider.clone(),
            platform,
            response: None,
            session_id: None,
            event_count: 0,
            text_event_count: 0,
            tool_calls: Vec::new(),
            permission_requests: 0,
            cost: None,
            duration_ms: None,
            error: Some(CliErrorBody {
                code: error.code.to_string(),
                message: error.message,
            }),
        });
    } else {
        eprintln!("error: {}", error.message);
    }
    ExitCode::from(exit_code)
}

fn one_shot_platform(options: &OneShotArgs) -> String {
    // Default to "cli" even when callers omit --platform, but still allow
    // tests and future automation surfaces to override it.
    options
        .platform
        .as_deref()
        .filter(|platform| !platform.trim().is_empty())
        .unwrap_or(DEFAULT_ONE_SHOT_PLATFORM)
        .to_string()
}

fn load_cli_auth_token() -> Result<String, CliError> {
    // Env override is useful for CI and scripted runs; otherwise reuse the
    // token saved by the desktop login flow.
    if let Ok(token) = std::env::var(OPENLOOMI_AUTH_TOKEN_ENV) {
        let token = token.trim().to_string();
        if !token.is_empty() {
            return Ok(token);
        }
    }

    match crate::storage::load_token() {
        Ok(Some(token)) if !token.trim().is_empty() => Ok(token),
        Ok(_) => Err(CliError::new(
            "not_authenticated",
            format!(
                "no saved auth token found. Log in to OpenLoomi first, or set {}.",
                OPENLOOMI_AUTH_TOKEN_ENV
            ),
        )),
        Err(error) => Err(CliError::new(
            "token",
            format!("failed to load saved auth token: {}", error),
        )),
    }
}

async fn execute_one_shot(
    prompt: &str,
    options: &OneShotArgs,
    platform: &str,
    auth_token: &str,
) -> Result<OneShotStreamResult, CliError> {
    // The CLI reuses the already-running local Next.js API instead of starting
    // its own agent runtime. Later work can decide whether to auto-start it.
    let base_url = one_shot_base_url();
    let endpoint = format!("{}/api/native/agent", base_url.trim_end_matches('/'));
    // Use the caller's current directory as the agent workspace so commands
    // launched from CI or scripts operate in the expected project folder.
    let work_dir = std::env::current_dir()
        .ok()
        .map(|path| path.display().to_string());
    let request_body = OneShotAgentRequest {
        prompt,
        provider: options.provider.as_deref(),
        platform,
        work_dir,
        model_config: options
            .model
            .as_deref()
            .map(|model| OneShotModelConfig { model: Some(model) }),
        // Non-interactive mode cannot answer permission prompts, so deny
        // unsafe tool calls instead of waiting on the TUI.
        permission_mode: "dontAsk",
        skills_config: OneShotFeatureConfig {
            enabled: true,
            user_dir_enabled: true,
            app_dir_enabled: false,
        },
        mcp_config: OneShotFeatureConfig {
            // Match the existing frontend direct-execution default for now:
            // skills are available, external MCP servers are not auto-loaded.
            enabled: false,
            user_dir_enabled: false,
            app_dir_enabled: false,
        },
        auth_token: Some(auth_token),
    };

    let client = reqwest::Client::builder()
        .user_agent("openloomi-cli")
        .timeout(Duration::from_secs(ONE_SHOT_TIMEOUT_SECS))
        .build()
        .map_err(|error| {
            CliError::new(
                "http_client",
                format!("failed to create HTTP client: {}", error),
            )
        })?;

    let response = client
        .post(&endpoint)
        .header("Accept", "text/event-stream")
        // Bearer auth gates /api/native/agent; authToken in the JSON body is
        // kept for existing downstream services that read it from agent options.
        .bearer_auth(auth_token)
        .json(&request_body)
        .send()
        .await
        .map_err(|error| map_one_shot_request_error(error, &endpoint))?;

    let status = response.status();
    let response_text = response.text().await.map_err(|error| {
        CliError::new(
            "agent_response",
            format!("failed to read agent response: {}", error),
        )
    })?;

    if !status.is_success() {
        return Err(one_shot_http_error(status, &response_text));
    }

    parse_agent_sse(&response_text)
}

fn one_shot_base_url() -> String {
    // Debug builds default to localhost:3515 and release builds to 3414 through
    // constants::nextjs_url(); env override makes integration tests flexible.
    std::env::var(OPENLOOMI_API_URL_ENV)
        .ok()
        .map(|url| url.trim().trim_end_matches('/').to_string())
        .filter(|url| !url.is_empty())
        .unwrap_or_else(crate::constants::nextjs_url)
}

fn map_one_shot_request_error(error: reqwest::Error, endpoint: &str) -> CliError {
    if error.is_timeout() {
        return CliError::new(
            "timeout",
            format!(
                "agent request timed out after {} seconds: {}",
                ONE_SHOT_TIMEOUT_SECS, endpoint
            ),
        );
    }
    if error.is_connect() {
        return CliError::new(
            "service_unavailable",
            format!(
                "could not connect to OpenLoomi agent API at {}. Start the OpenLoomi app or local web server first.",
                endpoint
            ),
        );
    }
    CliError::new("network", format!("agent request failed: {}", error))
}

fn one_shot_http_error(status: reqwest::StatusCode, body: &str) -> CliError {
    let detail = extract_error_message(body).unwrap_or_else(|| body.trim().to_string());
    let message = if detail.is_empty() {
        format!("agent API returned HTTP {}", status)
    } else {
        format!("agent API returned HTTP {}: {}", status, detail)
    };

    // Map HTTP status codes to stable CLI error codes for automation.
    let code = match status.as_u16() {
        401 | 403 => "not_authenticated",
        404 => "service_unavailable",
        408 | 504 => "timeout",
        429 => "rate_limited",
        _ if status.is_server_error() => "service_unavailable",
        _ => "agent_http",
    };

    CliError::new(code, message)
}

fn extract_error_message(body: &str) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(body).ok()?;
    if let Some(message) = value.get("message").and_then(serde_json::Value::as_str) {
        return Some(message.to_string());
    }
    match value.get("error") {
        Some(serde_json::Value::String(message)) => Some(message.clone()),
        Some(serde_json::Value::Object(error)) => error
            .get("message")
            .and_then(serde_json::Value::as_str)
            .map(ToString::to_string),
        _ => None,
    }
}

fn parse_agent_sse(raw: &str) -> Result<OneShotStreamResult, CliError> {
    let mut result = OneShotStreamResult::default();

    // /api/native/agent streams Server-Sent Events. For one-shot mode we
    // collect the stream into one final response object before exiting.
    for line in raw.lines() {
        let Some(data) = parse_sse_data_line(line) else {
            continue;
        };
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }

        let event = serde_json::from_str::<serde_json::Value>(data).map_err(|error| {
            CliError::new(
                "agent_response",
                format!("failed to parse agent SSE event: {}", error),
            )
        })?;
        record_agent_event(&mut result, &event);
    }

    if result.event_count == 0 {
        return Err(CliError::new(
            "agent_response",
            "agent API response did not contain any SSE data events.",
        ));
    }

    Ok(result)
}

fn parse_sse_data_line(line: &str) -> Option<&str> {
    // Ignore comments/heartbeats and only parse SSE data frames.
    line.strip_prefix("data: ")
        .or_else(|| line.strip_prefix("data:"))
}

fn record_agent_event(result: &mut OneShotStreamResult, event: &serde_json::Value) {
    result.event_count += 1;

    let event_type = event
        .get("type")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();

    match event_type {
        // "text" events are streaming deltas; "direct_answer" is used by some
        // planning paths. Both are user-visible assistant output.
        "text" | "direct_answer" => {
            if let Some(content) = event.get("content").and_then(serde_json::Value::as_str) {
                result.response.push_str(content);
                result.text_event_count += 1;
            }
        }
        "session" => {
            // Support both naming styles in case the server-side event shape
            // changes while keeping backward compatibility.
            result.session_id = event
                .get("sessionId")
                .or_else(|| event.get("session_id"))
                .and_then(serde_json::Value::as_str)
                .map(ToString::to_string);
        }
        "tool_use" => {
            // Tool names are useful in JSON output for auditing non-interactive
            // runs without dumping full tool inputs.
            if let Some(name) = event.get("name").and_then(serde_json::Value::as_str) {
                result.tool_calls.push(name.to_string());
            }
        }
        "permission_request" => {
            result.permission_requests += 1;
        }
        "result" => {
            result.cost = event.get("cost").and_then(serde_json::Value::as_f64);
            result.duration_ms = event.get("duration").and_then(serde_json::Value::as_f64);
        }
        "error" => {
            result.error = event
                .get("message")
                .or_else(|| event.get("content"))
                .and_then(serde_json::Value::as_str)
                .map(ToString::to_string)
                .or_else(|| Some("agent returned an error event".to_string()));
        }
        _ => {}
    }
}

fn resolve_one_shot_prompt(options: &OneShotArgs) -> Result<String, CliError> {
    if options.read_stdin && options.prompt.is_some() {
        return Err(CliError::new(
            "usage",
            "`--stdin` cannot be combined with an inline prompt.",
        ));
    }

    let prompt = if options.read_stdin {
        let mut input = String::new();
        std::io::stdin()
            .read_to_string(&mut input)
            .map_err(|error| CliError::new("stdin", format!("failed to read stdin: {error}")))?;
        input
    } else {
        options.prompt.clone().unwrap_or_default()
    };

    if prompt.trim().is_empty() {
        return Err(CliError::new(
            "usage",
            "one-shot mode requires a prompt or `--stdin` input.",
        ));
    }

    Ok(prompt)
}

async fn run_update_check(json: bool) -> ExitCode {
    match crate::update::do_check_for_update().await {
        Ok(result) => {
            // The shared updater tells us what is available; CLI preflight adds
            // install-readiness checks without performing the update.
            let preflight = run_update_preflight(Some(&result)).await;
            let preflight_ok = preflight.iter().all(|check| check.ok);

            if json {
                print_json(&UpdateCheckJsonOutput {
                    ok: preflight_ok,
                    command: "update.check",
                    current_version: Some(result.current_version),
                    latest_version: Some(result.latest_version),
                    has_update: Some(result.has_update),
                    download_url: Some(result.download_url),
                    release_url: Some(result.release_url),
                    file_size: Some(result.file_size),
                    preflight,
                    error: if preflight_ok {
                        None
                    } else {
                        Some(CliErrorBody {
                            code: "preflight_failed".to_string(),
                            message: "one or more update preflight checks failed.".to_string(),
                        })
                    },
                });
            } else {
                println!("Current version: {}", result.current_version);
                println!("Latest version: {}", result.latest_version);
                println!(
                    "Update available: {}",
                    if result.has_update { "yes" } else { "no" }
                );
                if result.has_update && !result.download_url.is_empty() {
                    println!("Download URL: {}", result.download_url);
                }
                print_preflight(&preflight);
            }
            if preflight_ok {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(1)
            }
        }
        Err(error) => {
            // Even if metadata lookup fails, still run local probes so users can
            // see whether filesystem/temp/disk prerequisites are healthy.
            let preflight = run_update_preflight(None).await;

            if json {
                print_json(&UpdateCheckJsonOutput {
                    ok: false,
                    command: "update.check",
                    current_version: Some(env!("CARGO_PKG_VERSION").to_string()),
                    latest_version: None,
                    has_update: None,
                    download_url: None,
                    release_url: None,
                    file_size: None,
                    preflight,
                    error: Some(CliErrorBody {
                        code: "update_check_failed".to_string(),
                        message: error,
                    }),
                });
            } else {
                eprintln!("update check failed: {}", error);
                print_preflight(&preflight);
            }
            ExitCode::from(1)
        }
    }
}

async fn run_update_preflight(
    update_result: Option<&crate::update::UpdateCheckResult>,
) -> Vec<PreflightCheck> {
    let mut checks = Vec::new();

    // Verify the binary path first; update code needs to know what it is
    // replacing or wrapping during installer handoff.
    checks.push(match std::env::current_exe() {
        Ok(path) if path.exists() => PreflightCheck {
            name: "current_exe",
            ok: true,
            detail: path.display().to_string(),
        },
        Ok(path) => PreflightCheck {
            name: "current_exe",
            ok: false,
            detail: format!("resolved path does not exist: {}", path.display()),
        },
        Err(error) => PreflightCheck {
            name: "current_exe",
            ok: false,
            detail: error.to_string(),
        },
    });

    let data_dir = crate::storage::get_data_dir();
    // Data and backup directories are separate probes because backup support is
    // opt-in but should fail early when the target is not writable.
    checks.push(check_directory_writable("data_dir_writable", &data_dir));
    checks.push(check_directory_writable(
        "backup_dir_writable",
        &data_dir.join("backups").join("updates"),
    ));

    let temp_dir = std::env::temp_dir();
    checks.push(check_directory_writable("temp_dir_writable", &temp_dir));

    // Network is checked independently from update metadata so --check can
    // distinguish "cannot reach release source" from local machine problems.
    checks.push(check_network_connectivity().await);

    // Prefer update metadata size, then fall back to HEAD content-length, then
    // fall back to the conservative default in required_update_space_bytes.
    let mut download_size = update_result.and_then(|result| {
        if result.file_size > 0 {
            Some(result.file_size)
        } else {
            None
        }
    });

    match update_result {
        Some(result) => {
            checks.push(check_platform_asset(result));
            if result.has_update {
                let (download_url_check, measured_download_size) =
                    check_download_url(&result.download_url).await;
                download_size = measured_download_size.or(download_size);
                checks.push(download_url_check);
            } else {
                checks.push(PreflightCheck {
                    name: "download_url",
                    ok: true,
                    detail: "skipped; no newer version is available".to_string(),
                });
            }
        }
        None => {
            checks.push(PreflightCheck {
                name: "platform_asset",
                ok: false,
                detail: "update metadata unavailable; cannot resolve platform asset".to_string(),
            });
            checks.push(PreflightCheck {
                name: "download_url",
                ok: false,
                detail: "update metadata unavailable; cannot validate download URL".to_string(),
            });
        }
    }

    checks.push(check_disk_space(&temp_dir, download_size));

    checks
}

async fn check_network_connectivity() -> PreflightCheck {
    let client = match reqwest::Client::builder()
        .user_agent("openloomi-cli")
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return PreflightCheck {
                name: "network",
                ok: false,
                detail: format!("failed to create HTTP client: {}", error),
            };
        }
    };

    // R2 is the primary latest.json source used by the updater.
    let r2_url = "https://pub-7f8ad94cb1444cbebae6bfd55ec52f5d.r2.dev/latest.json";
    match client.get(r2_url).send().await {
        Ok(response) if response.status().is_success() => {
            return PreflightCheck {
                name: "network",
                ok: true,
                detail: "R2 latest.json reachable".to_string(),
            };
        }
        Ok(response) => {
            let r2_error = format!("R2 returned HTTP {}", response.status());
            check_github_network_fallback(&client, r2_error).await
        }
        Err(error) => check_github_network_fallback(&client, format!("R2 failed: {}", error)).await,
    }
}

async fn check_github_network_fallback(
    client: &reqwest::Client,
    r2_error: String,
) -> PreflightCheck {
    // GitHub tags are a secondary signal; this keeps preflight useful during
    // transient R2 outages.
    let mut request = client
        .get("https://api.github.com/repos/melandlabs/release/tags")
        .header("Accept", "application/vnd.github+json");
    if let Ok(token) = std::env::var("GITHUB_TOKEN") {
        if !token.is_empty() {
            request = request.header("Authorization", format!("Bearer {}", token));
        }
    }

    match request.send().await {
        Ok(response) if response.status().is_success() => PreflightCheck {
            name: "network",
            ok: true,
            detail: format!("GitHub tags reachable; {}", r2_error),
        },
        Ok(response) => PreflightCheck {
            name: "network",
            ok: false,
            detail: format!("{}; GitHub returned HTTP {}", r2_error, response.status()),
        },
        Err(error) => PreflightCheck {
            name: "network",
            ok: false,
            detail: format!("{}; GitHub failed: {}", r2_error, error),
        },
    }
}

fn check_platform_asset(result: &crate::update::UpdateCheckResult) -> PreflightCheck {
    let latest_tag = format!("v{}", result.latest_version);
    // Reuse update.rs platform mapping so preflight validates the same asset
    // name the installer will later try to download.
    match crate::update::get_platform_download_filename(&latest_tag) {
        Some(filename) if result.download_url.contains(&filename) => PreflightCheck {
            name: "platform_asset",
            ok: true,
            detail: filename,
        },
        Some(filename) if result.download_url.is_empty() => PreflightCheck {
            name: "platform_asset",
            ok: false,
            detail: format!(
                "expected {}, but update check returned no download URL",
                filename
            ),
        },
        Some(filename) => PreflightCheck {
            name: "platform_asset",
            ok: false,
            detail: format!(
                "expected asset {}, but download URL was {}",
                filename, result.download_url
            ),
        },
        None => PreflightCheck {
            name: "platform_asset",
            ok: false,
            detail: format!(
                "unsupported platform or architecture for {}",
                result.latest_version
            ),
        },
    }
}

async fn check_download_url(download_url: &str) -> (PreflightCheck, Option<u64>) {
    if download_url.trim().is_empty() {
        return (
            PreflightCheck {
                name: "download_url",
                ok: false,
                detail: "download URL is empty".to_string(),
            },
            None,
        );
    }

    // HEAD avoids downloading the installer during --check while still
    // validating reachability and, when available, content length.
    let client = match reqwest::Client::builder()
        .user_agent("openloomi-cli")
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return (
                PreflightCheck {
                    name: "download_url",
                    ok: false,
                    detail: format!("failed to create HTTP client: {}", error),
                },
                None,
            );
        }
    };

    let mut request = client.head(download_url);
    if download_url.contains("github.com") {
        request = request.header("Accept", "application/octet-stream");
        if let Ok(token) = std::env::var("GITHUB_TOKEN") {
            if !token.is_empty() {
                request = request.header("Authorization", format!("Bearer {}", token));
            }
        }
    }

    match request.send().await {
        Ok(response) if response.status().is_success() => {
            let size = response.content_length();
            (
                PreflightCheck {
                    name: "download_url",
                    ok: true,
                    detail: match size {
                        Some(size) => {
                            format!("{} reachable ({})", download_url, format_bytes(size))
                        }
                        None => format!("{} reachable (size unknown)", download_url),
                    },
                },
                size,
            )
        }
        Ok(response) => (
            PreflightCheck {
                name: "download_url",
                ok: false,
                detail: format!("{} returned HTTP {}", download_url, response.status()),
            },
            None,
        ),
        Err(error) => (
            PreflightCheck {
                name: "download_url",
                ok: false,
                detail: format!("{} failed: {}", download_url, error),
            },
            None,
        ),
    }
}

fn check_directory_writable(name: &'static str, dir: &Path) -> PreflightCheck {
    if let Err(error) = std::fs::create_dir_all(dir) {
        return PreflightCheck {
            name,
            ok: false,
            detail: format!("failed to create {}: {}", dir.display(), error),
        };
    }

    let probe_path = dir.join(format!(
        ".openloomi-preflight-{}-{}",
        std::process::id(),
        name
    ));

    // Probe by creating and deleting a tiny file instead of trusting directory
    // existence; ACLs can allow one but not the other.
    match std::fs::write(&probe_path, b"ok").and_then(|_| std::fs::remove_file(&probe_path)) {
        Ok(()) => PreflightCheck {
            name,
            ok: true,
            detail: dir.display().to_string(),
        },
        Err(error) => {
            let _ = std::fs::remove_file(&probe_path);
            PreflightCheck {
                name,
                ok: false,
                detail: format!("{} is not writable: {}", dir.display(), error),
            }
        }
    }
}

fn check_disk_space(dir: &Path, download_size: Option<u64>) -> PreflightCheck {
    let required = required_update_space_bytes(download_size);
    match available_space_bytes(dir) {
        Ok(available) if available >= required => PreflightCheck {
            name: "disk_space",
            ok: true,
            detail: format!(
                "{} available in {}; requires at least {}",
                format_bytes(available),
                dir.display(),
                format_bytes(required)
            ),
        },
        Ok(available) => PreflightCheck {
            name: "disk_space",
            ok: false,
            detail: format!(
                "{} available in {}; requires at least {}",
                format_bytes(available),
                dir.display(),
                format_bytes(required)
            ),
        },
        Err(error) => PreflightCheck {
            name: "disk_space",
            ok: false,
            detail: error,
        },
    }
}

fn required_update_space_bytes(download_size: Option<u64>) -> u64 {
    // Require roughly double the installer size to leave room for download,
    // extraction, and backup work. Never go below the conservative default.
    download_size
        .unwrap_or(DEFAULT_UPDATE_SPACE_BYTES)
        .saturating_mul(2)
        .max(DEFAULT_UPDATE_SPACE_BYTES)
}

#[cfg(target_os = "windows")]
fn available_space_bytes(dir: &Path) -> Result<u64, String> {
    // Use PowerShell/.NET DriveInfo on Windows to avoid extra native
    // dependencies in the CLI target.
    let script = r#"
$path = [System.IO.Path]::GetFullPath($env:OPENLOOMI_DISK_PATH)
$root = [System.IO.Path]::GetPathRoot($path)
([System.IO.DriveInfo]::new($root)).AvailableFreeSpace
"#;
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", script])
        .env("OPENLOOMI_DISK_PATH", dir)
        .output()
        .map_err(|error| format!("failed to query disk space: {}", error))?;
    if !output.status.success() {
        return Err(format!(
            "failed to query disk space: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    parse_u64_output(&output.stdout, "disk space")
}

#[cfg(unix)]
fn available_space_bytes(dir: &Path) -> Result<u64, String> {
    // df -Pk is available on the Unix platforms OpenLoomi targets and reports
    // portable 1 KiB blocks.
    let output = Command::new("df")
        .args(["-Pk"])
        .arg(dir)
        .output()
        .map_err(|error| format!("failed to query disk space: {}", error))?;
    if !output.status.success() {
        return Err(format!(
            "failed to query disk space: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout
        .lines()
        .nth(1)
        .ok_or_else(|| "failed to parse disk space: missing df output".to_string())?;
    let available_kb = line
        .split_whitespace()
        .nth(3)
        .ok_or_else(|| "failed to parse disk space: missing available column".to_string())?
        .parse::<u64>()
        .map_err(|error| format!("failed to parse disk space: {}", error))?;
    Ok(available_kb.saturating_mul(1024))
}

#[cfg(not(any(unix, target_os = "windows")))]
fn available_space_bytes(_dir: &Path) -> Result<u64, String> {
    Err("disk space check is not supported on this platform".to_string())
}

#[cfg(target_os = "windows")]
fn parse_u64_output(output: &[u8], label: &str) -> Result<u64, String> {
    String::from_utf8_lossy(output)
        .trim()
        .parse::<u64>()
        .map_err(|error| format!("failed to parse {}: {}", label, error))
}

fn format_bytes(bytes: u64) -> String {
    const KIB: f64 = 1024.0;
    const MIB: f64 = 1024.0 * 1024.0;
    const GIB: f64 = 1024.0 * 1024.0 * 1024.0;

    let bytes = bytes as f64;
    if bytes >= GIB {
        format!("{:.1} GiB", bytes / GIB)
    } else if bytes >= MIB {
        format!("{:.1} MiB", bytes / MIB)
    } else if bytes >= KIB {
        format!("{:.1} KiB", bytes / KIB)
    } else {
        format!("{} B", bytes as u64)
    }
}

fn print_preflight(preflight: &[PreflightCheck]) {
    println!("Preflight:");
    for check in preflight {
        println!(
            "  [{}] {} - {}",
            if check.ok { "ok" } else { "fail" },
            check.name,
            check.detail
        );
    }
}

fn print_json<T: serde::Serialize>(value: &T) {
    // Pretty JSON is easier to inspect manually while remaining valid for
    // pipeline tools such as jq.
    match serde_json::to_string_pretty(value) {
        Ok(json) => println!("{}", json),
        Err(error) => {
            eprintln!("failed to serialize JSON output: {}", error);
            println!(
                r#"{{"ok":false,"error":{{"code":"json","message":"serialization failed"}}}}"#
            );
        }
    }
}

fn print_help() {
    println!(
        r#"alloomi {}

Usage:
  alloomi --one-shot <prompt> [--json] [--model <model>] [--provider <provider>] [--platform <platform>]
  alloomi --one-shot --stdin [--json] [--model <model>] [--provider <provider>] [--platform <platform>]
  alloomi update --check [--json]
  alloomi --version
  alloomi --help

Options:
  -z, --one-shot          Execute a non-interactive one-shot prompt
      --stdin             Read the one-shot prompt from standard input
      --json              Emit machine-readable JSON on stdout
      --model <model>     Override the default model for one-shot execution
      --provider <name>   Override the agent provider for one-shot execution
      --platform <name>   Override the platform context for one-shot execution
      --check             Run update preflight checks without installing updates
  -V, --version           Print version
  -h, --help              Print help
"#,
        env!("CARGO_PKG_VERSION")
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        std::iter::once("alloomi".to_string())
            .chain(values.iter().map(|value| value.to_string()))
            .collect()
    }

    #[test]
    fn parses_update_check() {
        assert_eq!(
            parse_args(&args(&["update", "--check", "--json"])).unwrap(),
            CliCommand::UpdateCheck { json: true }
        );
    }

    #[test]
    fn parses_one_shot_options() {
        assert_eq!(
            parse_args(&args(&[
                "--one-shot",
                "hello",
                "--model=gpt-test",
                "--provider",
                "claude",
                "--platform",
                "cli",
                "--json",
            ]))
            .unwrap(),
            CliCommand::OneShot(OneShotArgs {
                prompt: Some("hello".to_string()),
                read_stdin: false,
                json: true,
                model: Some("gpt-test".to_string()),
                provider: Some("claude".to_string()),
                platform: Some("cli".to_string()),
            })
        );
    }

    #[test]
    fn rejects_update_without_check() {
        assert!(parse_args(&args(&["update"])).is_err());
    }

    #[test]
    fn calculates_required_update_space() {
        assert_eq!(
            required_update_space_bytes(Some(10 * 1024 * 1024)),
            DEFAULT_UPDATE_SPACE_BYTES
        );
        assert_eq!(
            required_update_space_bytes(Some(600 * 1024 * 1024)),
            1200 * 1024 * 1024
        );
    }

    #[test]
    fn formats_bytes_for_preflight_details() {
        assert_eq!(format_bytes(42), "42 B");
        assert_eq!(format_bytes(1024), "1.0 KiB");
        assert_eq!(format_bytes(1024 * 1024), "1.0 MiB");
    }

    #[test]
    fn parses_agent_sse_text_result_and_tool_events() {
        let raw = concat!(
            ": keep-alive\n\n",
            "data: {\"type\":\"session\",\"sessionId\":\"sess-1\"}\n\n",
            "data: {\"type\":\"text\",\"content\":\"Hello\"}\n\n",
            "data: {\"type\":\"tool_use\",\"name\":\"Read\"}\n\n",
            "data: {\"type\":\"text\",\"content\":\" world\"}\n\n",
            "data: {\"type\":\"result\",\"cost\":0.12,\"duration\":345}\n\n",
            "data: {\"type\":\"done\"}\n\n",
        );

        let result = parse_agent_sse(raw).unwrap();
        assert_eq!(result.response, "Hello world");
        assert_eq!(result.session_id.as_deref(), Some("sess-1"));
        assert_eq!(result.text_event_count, 2);
        assert_eq!(result.tool_calls, vec!["Read"]);
        assert_eq!(result.cost, Some(0.12));
        assert_eq!(result.duration_ms, Some(345.0));
        assert_eq!(result.error, None);
    }

    #[test]
    fn parses_agent_sse_error_event() {
        let raw = "data: {\"type\":\"error\",\"message\":\"boom\"}\n\n";

        let result = parse_agent_sse(raw).unwrap();
        assert_eq!(result.event_count, 1);
        assert_eq!(result.error.as_deref(), Some("boom"));
    }
}
