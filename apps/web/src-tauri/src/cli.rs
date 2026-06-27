// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

//! Non-interactive command-line entry point.

#[cfg(debug_assertions)]
use std::fs::OpenOptions;
use std::io::Read;
#[cfg(debug_assertions)]
use std::io::Write;
use std::path::Path;
#[cfg(debug_assertions)]
use std::path::PathBuf;
#[cfg(debug_assertions)]
use std::process::{Child, Stdio};
use std::process::{Command, ExitCode};
use std::time::Duration;
#[cfg(debug_assertions)]
use std::time::Instant;

#[cfg(all(target_os = "windows", debug_assertions))]
use std::os::windows::process::CommandExt;

#[cfg(all(target_os = "windows", debug_assertions))]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// Conservative fallback used when update metadata does not include a file size.
const DEFAULT_UPDATE_SPACE_BYTES: u64 = 512 * 1024 * 1024;
// Downstream business tools can inspect session.platform to distinguish CLI runs.
const DEFAULT_ONE_SHOT_PLATFORM: &str = "cli";
// One-shot agent runs can legitimately take minutes when tools are involved.
const ONE_SHOT_TIMEOUT_SECS: u64 = 600;
const ONE_SHOT_API_HEALTH_TIMEOUT_SECS: u64 = 2;
// Test and CI callers can point the CLI at a non-default local API server.
const OPENLOOMI_API_URL_ENV: &str = "OPENLOOMI_API_URL";
// CI can provide auth without relying on the desktop token file.
const OPENLOOMI_AUTH_TOKEN_ENV: &str = "OPENLOOMI_AUTH_TOKEN";
// Set to 0/false/off to force the older local HTTP route path in debug builds.
#[cfg(debug_assertions)]
const OPENLOOMI_CLI_DIRECT_ENV: &str = "OPENLOOMI_CLI_DIRECT";
// Development and tests can point the CLI at a checked-out web app directory.
#[cfg(debug_assertions)]
const OPENLOOMI_WEB_DIR_ENV: &str = "OPENLOOMI_WEB_DIR";

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
#[derive(Debug, Default, serde::Deserialize)]
#[serde(default)]
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
            println!("openloomi-ctl {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        Ok(CliCommand::UpdateCheck { json }) => run_update_check(json).await,
        Ok(CliCommand::OneShot(options)) => run_one_shot(options).await,
        Err(error) => {
            eprintln!("error: {}", error.message);
            eprintln!();
            eprintln!("Run `openloomi-ctl --help` for usage.");
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
            "`openloomi-ctl update` currently supports only `--check`.",
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
    let request_body = build_one_shot_agent_request(prompt, options, platform, auth_token);

    #[cfg(debug_assertions)]
    if should_try_direct_one_shot_runner() {
        // Development builds can execute the native-agent runner directly, so
        // one-shot does not need to open the desktop app or start a hidden
        // Next.js service. The HTTP path below is kept as an explicit fallback.
        match execute_one_shot_with_node_runner(&request_body).await {
            Ok(result) => return Ok(result),
            Err(error) if is_direct_runner_fallback_error(&error) => {
                eprintln!(
                    "warning: direct native-agent runner unavailable ({}); falling back to local API.",
                    error.message
                );
            }
            Err(error) => return Err(error),
        }
    }

    execute_one_shot_via_http(&request_body, auth_token).await
}

fn build_one_shot_agent_request<'a>(
    prompt: &'a str,
    options: &'a OneShotArgs,
    platform: &'a str,
    auth_token: &'a str,
) -> OneShotAgentRequest<'a> {
    // Use the caller's current directory as the agent workspace so commands
    // launched from CI or scripts operate in the expected project folder.
    let work_dir = std::env::current_dir()
        .ok()
        .map(|path| path.display().to_string());

    OneShotAgentRequest {
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
    }
}

async fn execute_one_shot_via_http(
    request_body: &OneShotAgentRequest<'_>,
    auth_token: &str,
) -> Result<OneShotStreamResult, CliError> {
    let base_url = one_shot_base_url();
    // HTTP mode is now only a compatibility path for an already-running API.
    // The CLI's primary path is the direct native-agent runner above.
    ensure_one_shot_api_ready(&base_url).await?;
    let endpoint = format!("{}/api/native/agent", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .user_agent("openloomi-ctl")
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

#[cfg(debug_assertions)]
fn should_try_direct_one_shot_runner() -> bool {
    // OPENLOOMI_API_URL is an explicit request to use the HTTP API path, usually
    // for integration tests or a manually managed local server.
    if std::env::var(OPENLOOMI_API_URL_ENV)
        .ok()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
    {
        return false;
    }

    // OPENLOOMI_CLI_DIRECT=0 is a debugging escape hatch for comparing the
    // direct runner with the older API route behavior.
    !matches!(
        std::env::var(OPENLOOMI_CLI_DIRECT_ENV)
            .ok()
            .map(|value| value.to_ascii_lowercase()),
        Some(value) if matches!(value.as_str(), "0" | "false" | "off")
    )
}

#[cfg(debug_assertions)]
fn is_direct_runner_fallback_error(error: &CliError) -> bool {
    matches!(
        error.code,
        "direct_runner_unavailable" | "direct_runner_start" | "direct_runner_output"
    )
}

#[cfg(debug_assertions)]
async fn execute_one_shot_with_node_runner(
    request_body: &OneShotAgentRequest<'_>,
) -> Result<OneShotStreamResult, CliError> {
    let web_dir = find_web_dir()?;
    let script = web_dir.join("scripts").join("native-agent-cli.ts");
    if !script.exists() {
        return Err(CliError::new(
            "direct_runner_unavailable",
            format!("native agent CLI runner not found at {}", script.display()),
        ));
    }

    let tsx_cli = find_dev_tsx_cli(&web_dir)?;
    let log_path = prepare_one_shot_runner_log()?;
    let stderr = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| {
            CliError::new(
                "direct_runner_start",
                format!("failed to open direct runner log: {}", error),
            )
        })?;
    let input_json = serde_json::to_string(request_body).map_err(|error| {
        CliError::new(
            "direct_runner_start",
            format!("failed to serialize direct runner input: {}", error),
        )
    })?;

    let data_dir = one_shot_web_data_dir();
    let db_path = data_dir.join("data.db");
    let base_url = crate::constants::nextjs_url();
    let mut command = Command::new("node");
    // Rust owns CLI parsing, auth-token loading, process timeout, and final
    // JSON output. The TypeScript shim owns application runtime setup and calls
    // the shared native-agent runner directly.
    command
        .arg(&tsx_cli)
        .arg(&script)
        .current_dir(&web_dir)
        .env("NODE_OPTIONS", node_options_with_react_server())
        .env("IS_TAURI", "true")
        .env("TAURI_MODE", "1")
        .env("DEPLOYMENT_MODE", "tauri")
        .env("TAURI_DATA_DIR", data_dir.to_string_lossy().to_string())
        .env("PORT", crate::constants::NEXTJS_PORT.to_string())
        .env(
            "TAURI_SERVER_PORT",
            crate::constants::NEXTJS_PORT.to_string(),
        )
        .env("TAURI_DB_PATH", db_path.to_string_lossy().to_string())
        .env("NEXTAUTH_URL", &base_url)
        .env("NEXT_PUBLIC_APP_URL", &base_url)
        .env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(stderr));

    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command.spawn().map_err(|error| {
        CliError::new(
            "direct_runner_start",
            format!(
                "failed to start direct native-agent runner with {}: {}. See log: {}",
                tsx_cli.display(),
                error,
                log_path.display()
            ),
        )
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        if let Err(error) = stdin.write_all(input_json.as_bytes()) {
            terminate_child_process(&mut child);
            return Err(CliError::new(
                "direct_runner_start",
                format!("failed to write direct runner input: {}", error),
            ));
        }
    }

    let status = wait_for_direct_runner(&mut child, &log_path)?;
    let mut stdout = String::new();
    if let Some(mut child_stdout) = child.stdout.take() {
        child_stdout.read_to_string(&mut stdout).map_err(|error| {
            CliError::new(
                "direct_runner_output",
                format!("failed to read direct runner output: {}", error),
            )
        })?;
    }

    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err(CliError::new(
            "direct_runner_output",
            format!(
                "direct native-agent runner produced no JSON output. See log: {}",
                log_path.display()
            ),
        ));
    }

    match serde_json::from_str::<OneShotStreamResult>(trimmed) {
        Ok(result) => Ok(result),
        Err(error) => {
            if !status.success() {
                return Err(CliError::new(
                    "direct_runner_output",
                    format!(
                        "direct native-agent runner exited with status {} and invalid JSON output: {}. See log: {}",
                        status,
                        error,
                        log_path.display()
                    ),
                ));
            }
            Err(CliError::new(
                "direct_runner_output",
                format!(
                    "failed to parse direct native-agent runner JSON output: {}. See log: {}",
                    error,
                    log_path.display()
                ),
            ))
        }
    }
}

#[cfg(debug_assertions)]
fn one_shot_web_data_dir() -> PathBuf {
    // The direct runner runs outside the Tauri process, so it needs the same
    // data.db location that the desktop/web runtime expects in development.
    if let Ok(path) = std::env::var("TAURI_DATA_DIR") {
        let path = path.trim();
        if !path.is_empty() {
            return PathBuf::from(path);
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(home) = std::env::var("USERPROFILE") {
            return PathBuf::from(home).join(".openloomi").join("data");
        }
        if let Ok(appdata) = std::env::var("APPDATA") {
            return PathBuf::from(appdata).join("openloomi").join("data");
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(".openloomi").join("data");
        }
    }

    crate::storage::get_data_dir()
}

#[cfg(debug_assertions)]
fn wait_for_direct_runner(
    child: &mut Child,
    log_path: &Path,
) -> Result<std::process::ExitStatus, CliError> {
    let started_at = Instant::now();
    while started_at.elapsed() < Duration::from_secs(ONE_SHOT_TIMEOUT_SECS) {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => std::thread::sleep(Duration::from_millis(200)),
            Err(error) => {
                return Err(CliError::new(
                    "direct_runner_output",
                    format!(
                        "failed to monitor direct native-agent runner: {}. See log: {}",
                        error,
                        log_path.display()
                    ),
                ));
            }
        }
    }

    terminate_child_process(child);
    Err(CliError::new(
        "direct_runner_timeout",
        format!(
            "timed out after {} seconds waiting for direct native-agent runner. See log: {}",
            ONE_SHOT_TIMEOUT_SECS,
            log_path.display()
        ),
    ))
}

#[cfg(debug_assertions)]
fn find_dev_tsx_cli(web_dir: &Path) -> Result<PathBuf, CliError> {
    let mut candidates = Vec::new();
    candidates.push(
        web_dir
            .join("node_modules")
            .join("tsx")
            .join("dist")
            .join("cli.mjs"),
    );
    if let Some(root) = web_dir.parent().and_then(Path::parent) {
        candidates.push(
            root.join("node_modules")
                .join("tsx")
                .join("dist")
                .join("cli.mjs"),
        );
    }

    candidates
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| {
            CliError::new(
                "direct_runner_unavailable",
                "tsx CLI was not found in node_modules; run pnpm install, or set OPENLOOMI_CLI_DIRECT=0 with a reachable OPENLOOMI_API_URL.",
            )
        })
}

#[cfg(debug_assertions)]
fn prepare_one_shot_runner_log() -> Result<PathBuf, CliError> {
    let log_dir = crate::storage::get_data_dir().join("logs");
    std::fs::create_dir_all(&log_dir).map_err(|error| {
        CliError::new(
            "direct_runner_start",
            format!("failed to create CLI runner log directory: {}", error),
        )
    })?;

    let log_path = log_dir.join("cli-native-agent-runner.log");
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| {
            CliError::new(
                "direct_runner_start",
                format!("failed to open CLI runner log: {}", error),
            )
        })?;
    let _ = writeln!(
        file,
        "\n=== openloomi-ctl one-shot direct native-agent runner start: {:?} ===",
        std::time::SystemTime::now()
    );
    Ok(log_path)
}

#[cfg(debug_assertions)]
fn node_options_with_react_server() -> String {
    let current = std::env::var("NODE_OPTIONS").unwrap_or_default();
    if current.contains("--conditions=react-server")
        || current.contains("--conditions react-server")
    {
        return current;
    }
    let condition = "--conditions=react-server";
    if current.trim().is_empty() {
        condition.to_string()
    } else {
        format!("{} {}", current, condition)
    }
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

async fn ensure_one_shot_api_ready(base_url: &str) -> Result<(), CliError> {
    if is_one_shot_api_ready(base_url).await {
        return Ok(());
    }

    Err(CliError::new(
        "service_unavailable",
        format!(
            "OpenLoomi agent API is not reachable at {}. Start OpenLoomi, set {} to a reachable API, or use the direct native-agent runner.",
            base_url, OPENLOOMI_API_URL_ENV
        ),
    ))
}

async fn is_one_shot_api_ready(base_url: &str) -> bool {
    let health_url = format!("{}/api/native/agent", base_url.trim_end_matches('/'));
    let client = match reqwest::Client::builder()
        .user_agent("openloomi-ctl")
        .timeout(Duration::from_secs(ONE_SHOT_API_HEALTH_TIMEOUT_SECS))
        .build()
    {
        Ok(client) => client,
        Err(_) => return false,
    };

    match client.get(&health_url).send().await {
        Ok(response) => matches!(response.status().as_u16(), 200 | 401 | 403 | 405),
        Err(_) => false,
    }
}

#[cfg(debug_assertions)]
fn find_web_dir() -> Result<PathBuf, CliError> {
    // openloomi-ctl may be launched from the repo root, apps/web, or
    // target/debug. Walk ancestors before asking the user for OPENLOOMI_WEB_DIR.
    if let Ok(path) = std::env::var(OPENLOOMI_WEB_DIR_ENV) {
        let path = PathBuf::from(path.trim());
        if path.join("package.json").exists() && path.join("scripts").exists() {
            return Ok(path);
        }
        return Err(CliError::new(
            "service_unavailable",
            format!(
                "{} does not point to a valid apps/web directory: {}",
                OPENLOOMI_WEB_DIR_ENV,
                path.display()
            ),
        ));
    }

    let mut roots = Vec::new();
    if let Ok(current_dir) = std::env::current_dir() {
        roots.push(current_dir);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            roots.push(parent.to_path_buf());
        }
    }

    for root in roots {
        for ancestor in root.ancestors() {
            let monorepo_web = ancestor.join("apps").join("web");
            if monorepo_web.join("package.json").exists() && monorepo_web.join("scripts").exists() {
                return Ok(monorepo_web);
            }

            if ancestor.join("package.json").exists()
                && ancestor.join("src-tauri").exists()
                && ancestor.join("scripts").exists()
            {
                return Ok(ancestor.to_path_buf());
            }
        }
    }

    Err(CliError::new(
        "service_unavailable",
        format!(
            "could not locate apps/web for the direct native-agent runner. Set {} to the apps/web directory.",
            OPENLOOMI_WEB_DIR_ENV
        ),
    ))
}

#[cfg(debug_assertions)]
fn terminate_child_process(child: &mut Child) {
    if matches!(child.try_wait(), Ok(Some(_))) {
        return;
    }

    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &child.id().to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }

    #[cfg(unix)]
    {
        let pid = child.id().to_string();
        let _ = Command::new("kill")
            .args(["-15", &format!("-{}", pid)])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        let _ = Command::new("kill")
            .args(["-15", &pid])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        std::thread::sleep(Duration::from_millis(500));
        let _ = Command::new("kill")
            .args(["-9", &format!("-{}", pid)])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        let _ = Command::new("kill")
            .args(["-9", &pid])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    let _ = child.kill();
    let _ = child.wait();
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
        .user_agent("openloomi-ctl")
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
        Ok(response) if response.status().is_success() => PreflightCheck {
            name: "network",
            ok: true,
            detail: "R2 latest.json reachable".to_string(),
        },
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
        .user_agent("openloomi-ctl")
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
        r#"openloomi-ctl {}

Usage:
  openloomi-ctl --one-shot <prompt> [--json] [--model <model>] [--provider <provider>] [--platform <platform>]
  openloomi-ctl --one-shot --stdin [--json] [--model <model>] [--provider <provider>] [--platform <platform>]
  openloomi-ctl update --check [--json]
  openloomi-ctl --version
  openloomi-ctl --help

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
        std::iter::once("openloomi-ctl".to_string())
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
