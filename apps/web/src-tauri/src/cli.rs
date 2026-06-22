// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

//! Non-interactive command-line entry point scaffolding.

use std::io::Read;
use std::path::Path;
use std::process::Command;
use std::process::ExitCode;

const DEFAULT_UPDATE_SPACE_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
enum CliCommand {
    Help,
    Version,
    UpdateCheck { json: bool },
    OneShot(OneShotArgs),
}

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
struct JsonError<'a> {
    ok: bool,
    command: &'a str,
    error: CliErrorBody,
}

#[derive(Debug, serde::Serialize)]
struct CliErrorBody {
    code: String,
    message: String,
}

#[derive(Debug, serde::Serialize)]
struct OneShotJsonOutput {
    ok: bool,
    command: &'static str,
    implemented: bool,
    prompt_length: usize,
    stdin: bool,
    model: Option<String>,
    provider: Option<String>,
    platform: Option<String>,
    error: CliErrorBody,
}

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

#[derive(Debug, serde::Serialize)]
struct PreflightCheck {
    name: &'static str,
    ok: bool,
    detail: String,
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
        Ok(CliCommand::OneShot(options)) => run_one_shot_stub(options),
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

fn run_one_shot_stub(options: OneShotArgs) -> ExitCode {
    let prompt = match resolve_one_shot_prompt(&options) {
        Ok(prompt) => prompt,
        Err(error) => {
            if options.json {
                print_json(&JsonError {
                    ok: false,
                    command: "one-shot",
                    error: CliErrorBody {
                        code: error.code.to_string(),
                        message: error.message,
                    },
                });
            } else {
                eprintln!("error: {}", error.message);
            }
            return ExitCode::from(2);
        }
    };

    let error = CliErrorBody {
        code: "not_implemented".to_string(),
        message: "one-shot parsing is wired, but agent execution is not implemented yet."
            .to_string(),
    };

    if options.json {
        print_json(&OneShotJsonOutput {
            ok: false,
            command: "one-shot",
            implemented: false,
            prompt_length: prompt.trim().len(),
            stdin: options.read_stdin,
            model: options.model,
            provider: options.provider,
            platform: options.platform,
            error,
        });
    } else {
        println!("one-shot mode recognized");
        println!("prompt length: {}", prompt.trim().len());
        if let Some(model) = options.model {
            println!("model: {}", model);
        }
        if let Some(provider) = options.provider {
            println!("provider: {}", provider);
        }
        if let Some(platform) = options.platform {
            println!("platform: {}", platform);
        }
        eprintln!("one-shot agent execution is not implemented yet.");
    }

    ExitCode::from(2)
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
    checks.push(check_directory_writable("data_dir_writable", &data_dir));
    checks.push(check_directory_writable(
        "backup_dir_writable",
        &data_dir.join("backups").join("updates"),
    ));

    let temp_dir = std::env::temp_dir();
    checks.push(check_directory_writable("temp_dir_writable", &temp_dir));

    checks.push(check_network_connectivity().await);

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
    download_size
        .unwrap_or(DEFAULT_UPDATE_SPACE_BYTES)
        .saturating_mul(2)
        .max(DEFAULT_UPDATE_SPACE_BYTES)
}

#[cfg(target_os = "windows")]
fn available_space_bytes(dir: &Path) -> Result<u64, String> {
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
  -z, --one-shot          Parse a non-interactive one-shot prompt (execution stubbed for now)
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
}
