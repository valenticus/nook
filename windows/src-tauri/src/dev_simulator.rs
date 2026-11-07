//! Synthetic hook controls for the isolated Nook Dev build only.
//! The simple simulator emits directly to the Island; manual alerts use the
//! packaged Dev relay and the isolated Dev IPC pipe. Neither starts an agent.

use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::{timeout, Instant};

use crate::island::WINDOW_LABEL;

const SIM_ID_PREFIX: &str = "nook-sim:";
const ALERT_PREFIX: &str = "nook-test:two-pending-alerts:";
const CHILD_DECISION_LIMIT: Duration = Duration::from_secs(280);
const EVENT_LIMIT: Duration = Duration::from_secs(8);
const CLEANUP_LIMIT: Duration = Duration::from_secs(4);
static ALERT_RUN: AtomicU64 = AtomicU64::new(1);
const ALLOWED_EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PermissionRequest",
    "Stop",
    "SessionEnd",
];

fn simulated_payload(agent: &str, event: &str, run_id: &str) -> Result<Value, String> {
    if !matches!(agent, "claude" | "codex") {
        return Err("Only Claude and Codex simulations are supported".into());
    }
    if run_id.len() < 8
        || run_id.len() > 48
        || !run_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("Invalid simulator run id".into());
    }

    if event.starts_with("BatteryTest") {
        let sample = match event {
            "BatteryTestStart" => {
                json!({"percent":55,"ac_connected":false,"charging":false,"battery_present":true})
            }
            "BatteryTest20" => {
                json!({"percent":20,"ac_connected":false,"charging":false,"battery_present":true})
            }
            "BatteryTest10" => {
                json!({"percent":10,"ac_connected":false,"charging":false,"battery_present":true})
            }
            "BatteryTestCharging" => {
                json!({"percent":55,"ac_connected":true,"charging":true,"battery_present":true})
            }
            "BatteryTest100" => {
                json!({"percent":100,"ac_connected":true,"charging":true,"battery_present":true})
            }
            "BatteryTestAbsent" => {
                json!({"percent":null,"ac_connected":true,"charging":null,"battery_present":false})
            }
            "BatteryTestUnknown" => {
                json!({"percent":null,"ac_connected":null,"charging":null,"battery_present":null})
            }
            "BatteryTestReset" => Value::Null,
            _ => return Err("Unsupported battery simulator action".into()),
        };
        return Ok(json!({
            "hook_event_name": event,
            "session_id": format!("{SIM_ID_PREFIX}battery:{run_id}"),
            "nook_battery_simulator": true,
            "nook_battery_action": event,
            "battery_sample": sample,
        }));
    }
    if !ALLOWED_EVENTS.contains(&event) {
        return Err("Unsupported simulated hook event".into());
    }

    let session_id = format!("{SIM_ID_PREFIX}{agent}:{run_id}");
    let mut payload = json!({
        "hook_event_name": event,
        "session_id": session_id,
        "cwd": format!("C:\\NookDevSim\\SIMULATED {agent}"),
        "nook_tool": if agent == "codex" { "codex" } else { "claude" },
        "nook_simulated": true,
    });
    match event {
        "UserPromptSubmit" => payload["prompt"] = json!("Simulated request — no model is running"),
        "PreToolUse" => {
            payload["tool_name"] = json!("Read");
            payload["tool_input"] =
                json!({"file_path": format!("C:\\NookDevSim\\{agent}\\sample.txt")});
        }
        "PostToolUse" => {
            payload["tool_name"] = json!("Read");
            payload["tool_input"] =
                json!({"file_path": format!("C:\\NookDevSim\\{agent}\\sample.txt")});
            payload["tool_response"] = json!("Synthetic read result. No file was accessed.");
        }
        "PermissionRequest" => {
            payload["tool_name"] = json!("Bash");
            payload["tool_input"] = json!({"command": "echo Nook Dev simulated permission", "description": "UI-only simulator request"});
            payload["request_id"] = json!(format!("nook-sim:req:{agent}:{run_id}"));
            payload["nook_simulated_timeout_ms"] = json!(8_000);
        }
        "Stop" => payload["last_message"] = json!("Synthetic turn finished; session remains open."),
        _ => {}
    }
    Ok(payload)
}

#[cfg(test)]
mod battery_simulator_tests {
    use super::simulated_payload;

    #[test]
    fn battery_fixture_events_are_isolated_from_session_lifecycle() {
        let payload = simulated_payload("claude", "BatteryTest20", "battery-test-run").unwrap();
        assert_eq!(payload["nook_battery_simulator"], true);
        assert_eq!(payload["battery_sample"]["percent"], 20);
        assert_eq!(payload["battery_sample"]["battery_present"], true);
        assert_eq!(payload["hook_event_name"], "BatteryTest20");
        assert!(
            simulated_payload("claude", "BatteryTestUnknownExtra", "battery-test-run").is_err()
        );
        assert!(simulated_payload("claude", "BatteryTest20", "short").is_err());
    }
}

#[tauri::command]
pub fn dev_simulator_emit(
    app: AppHandle,
    agent: String,
    event: String,
    run_id: String,
) -> Result<(), String> {
    let payload = simulated_payload(&agent, &event, &run_id)?;
    app.emit_to(WINDOW_LABEL, "hook", payload)
        .map_err(|e| e.to_string())
}

#[derive(Default)]
pub struct ManualAlerts(Mutex<Option<ManualAlertRun>>);

struct ManualAlertRun {
    run_id: String,
    claude_id: String,
    codex_wire_id: String,
    codex_id: String,
    claude: RequestChild,
    codex: RequestChild,
    claude_session: String,
    codex_session: String,
    cleanup_errors: Vec<String>,
}

struct RequestChild {
    child: Child,
    result: String,
    deadline: Instant,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualAlertsStatus {
    pub run_id: String,
    pub claude_session_id: String,
    pub codex_session_id: String,
    pub claude_request: String,
    pub codex_request: String,
    pub pending: u8,
    pub claude_session: String,
    pub codex_session: String,
    pub cleanup_errors: Vec<String>,
}

fn relay_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    #[cfg(windows)]
    let relay_name = "nook-hook-dev.exe";
    #[cfg(not(windows))]
    let relay_name = "nook-hook-dev";
    let executable = std::env::current_exe()
        .map_err(|error| format!("Could not locate the running Nook Dev executable: {error}"))?;
    let directory = executable
        .parent()
        .ok_or("The running Nook Dev executable has no parent directory")?;
    let sibling = directory.join(relay_name);
    let resource = app
        .path()
        .resolve(relay_name, tauri::path::BaseDirectory::Resource)
        .ok();
    // The no-bundle Dev build lives in dev-release/bin with its relay beside it.
    // Bundled Dev builds use the exact resource mapping in tauri.nook-dev.conf.json.
    let path = [Some(sibling.clone()), resource.clone()]
        .into_iter()
        .flatten()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| format!("Nook Dev relay was not found. Expected it beside the Dev executable at {} or at the configured Dev resource path {}", sibling.display(), resource.as_deref().map_or_else(|| "<unavailable>".into(), |path| path.display().to_string())))?;
    if path.file_name().and_then(|name| name.to_str()) != Some(relay_name) {
        return Err(format!("Refusing to use anything except {relay_name}"));
    }
    let output = std::process::Command::new(&path)
        .arg("--test-endpoint")
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("Dev relay endpoint check failed".into());
    }
    let endpoint = String::from_utf8_lossy(&output.stdout);
    #[cfg(windows)]
    let endpoint_is_dev = endpoint.trim().starts_with(r"\\.\pipe\nook-dev-");
    #[cfg(not(windows))]
    let endpoint_is_dev = endpoint.trim().ends_with("/nook-dev.sock");
    if !endpoint_is_dev {
        return Err(
            "Refusing a relay that does not report the isolated Nook Dev IPC endpoint".into(),
        );
    }
    Ok(path)
}

fn relay_args(agent: &str, event: &str) -> Vec<String> {
    if agent == "codex" {
        vec!["--agent".into(), "codex".into(), event.into()]
    } else {
        vec![event.into()]
    }
}

fn alert_payload(agent: &str, event: &str, session_id: &str, run_id: &str) -> Value {
    let mut payload = json!({
        "hook_event_name": event,
        "session_id": session_id,
        "cwd": "C:\\NookDevTestFixture",
    });
    if agent == "codex" {
        payload["turn_id"] = json!(format!("two-alerts-{run_id}"));
    }
    if event == "PermissionRequest" {
        payload["tool_name"] = json!("Bash");
        payload["tool_input"] =
            json!({ "command": "echo fixture-only", "description": "Nook Dev deny-only test" });
    }
    payload
}

async fn send_event(
    relay: &std::path::Path,
    agent: &str,
    event: &str,
    session_id: &str,
    run_id: &str,
) -> Result<(), String> {
    let payload = alert_payload(agent, event, session_id, run_id);
    let mut command = Command::new(relay);
    command
        .args(relay_args(agent, event))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start Dev relay for {agent}/{event}: {e}"))?;
    child
        .stdin
        .take()
        .ok_or("Dev relay stdin was unavailable")?
        .write_all(format!("{payload}\n").as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    let output = timeout(EVENT_LIMIT, child.wait_with_output())
        .await
        .map_err(|_| format!("Dev relay timed out for {agent}/{event}"))?
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "Dev relay failed for {agent}/{event}: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    if !output.stdout.is_empty() {
        return Err(format!("Unexpected stdout for {agent}/{event}"));
    }
    Ok(())
}

async fn start_permission(
    relay: &std::path::Path,
    agent: &str,
    session_id: &str,
    run_id: &str,
) -> Result<RequestChild, String> {
    let payload = alert_payload(agent, "PermissionRequest", session_id, run_id);
    let mut command = Command::new(relay);
    command
        .args(relay_args(agent, "PermissionRequest"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start deny-only Dev relay for {agent}: {e}"))?;
    child
        .stdin
        .take()
        .ok_or("Dev relay stdin was unavailable")?
        .write_all(format!("{payload}\n").as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    Ok(RequestChild {
        child,
        result: "Pending".into(),
        deadline: Instant::now() + CHILD_DECISION_LIMIT,
    })
}

async fn refresh_request(request: &mut RequestChild) -> Result<(), String> {
    if request.result != "Pending" {
        return Ok(());
    }
    if let Some(status) = request.child.try_wait().map_err(|e| e.to_string())? {
        let mut stdout = String::new();
        if let Some(mut pipe) = request.child.stdout.take() {
            pipe.read_to_string(&mut stdout)
                .await
                .map_err(|e| e.to_string())?;
        }
        request.result = classify_permission_result(
            status.success(),
            &stdout,
            Instant::now() >= request.deadline,
        );
        return Ok(());
    }
    if Instant::now() >= request.deadline {
        request
            .child
            .kill()
            .await
            .map_err(|e| format!("Could not stop timed-out Dev relay: {e}"))?;
        timeout(CLEANUP_LIMIT, request.child.wait())
            .await
            .map_err(|_| "Timed-out Dev relay did not exit after kill")?
            .map_err(|e| e.to_string())?;
        request.result = "TimedOut".into();
    }
    Ok(())
}

fn classify_permission_result(success: bool, stdout: &str, expired: bool) -> String {
    if !success {
        return "RelayFailed".into();
    }
    if stdout.trim().is_empty() {
        return if expired { "TimedOut" } else { "Cancelled" }.into();
    }
    match serde_json::from_str::<Value>(stdout) {
        Ok(reply)
            if reply["hookSpecificOutput"]["hookEventName"] == "PermissionRequest"
                && reply["hookSpecificOutput"]["decision"]["behavior"] == "deny" =>
        {
            "Resolved (ExplicitDeny)".into()
        }
        _ => "InvalidResponse".into(),
    }
}

fn status_of(run: &ManualAlertRun) -> ManualAlertsStatus {
    let mut status = status_snapshot(
        &run.run_id,
        &run.claude_id,
        &run.codex_id,
        &run.claude.result,
        &run.codex.result,
        &run.claude_session,
        &run.codex_session,
    );
    status.cleanup_errors = run.cleanup_errors.clone();
    status
}

fn status_snapshot(
    run_id: &str,
    claude_id: &str,
    codex_id: &str,
    claude_request: &str,
    codex_request: &str,
    claude_session: &str,
    codex_session: &str,
) -> ManualAlertsStatus {
    let pending = [claude_request, codex_request]
        .iter()
        .filter(|value| **value == "Pending")
        .count() as u8;
    ManualAlertsStatus {
        run_id: run_id.into(),
        claude_session_id: claude_id.into(),
        codex_session_id: codex_id.into(),
        claude_request: claude_request.into(),
        codex_request: codex_request.into(),
        pending,
        claude_session: claude_session.into(),
        codex_session: codex_session.into(),
        cleanup_errors: Vec::new(),
    }
}

async fn cleanup_run(relay: &std::path::Path, run: &mut ManualAlertRun) {
    run.cleanup_errors.clear();
    if !run.claude_session.starts_with("Completed") {
        match send_event(relay, "claude", "SessionEnd", &run.claude_id, &run.run_id).await {
            Ok(()) => {
                run.claude_session = "Completed (SessionEnd delivered through Dev IPC)".into()
            }
            Err(error) => {
                run.claude_session = format!("Failed: {error}");
                run.cleanup_errors
                    .push(format!("Claude SessionEnd: {error}"));
            }
        }
    }
    if !run.codex_session.starts_with("Completed") {
        match send_event(
            relay,
            "codex",
            "SessionEnd",
            &run.codex_wire_id,
            &run.run_id,
        )
        .await
        {
            Ok(()) => run.codex_session = "Completed (SessionEnd delivered through Dev IPC)".into(),
            Err(error) => {
                run.codex_session = format!("Failed: {error}");
                run.cleanup_errors
                    .push(format!("Codex SessionEnd: {error}"));
            }
        }
    }
    for (name, request) in [("Claude", &mut run.claude), ("Codex", &mut run.codex)] {
        if request.result == "Pending" {
            match timeout(CLEANUP_LIMIT, request.child.wait()).await {
                Ok(Ok(_)) => {
                    if let Err(error) = refresh_request(request).await {
                        run.cleanup_errors
                            .push(format!("{name} relay result: {error}"));
                    }
                    if request.result == "Pending" {
                        request.result = "Cancelled by SessionEnd".into();
                    }
                }
                Ok(Err(error)) => run
                    .cleanup_errors
                    .push(format!("{name} relay wait: {error}")),
                Err(_) => {
                    if let Err(error) = request.child.kill().await {
                        run.cleanup_errors
                            .push(format!("{name} child kill: {error}"));
                    }
                    match timeout(CLEANUP_LIMIT, request.child.wait()).await {
                        Ok(Ok(_)) => request.result = "Stopped by bounded cleanup".into(),
                        Ok(Err(error)) => run
                            .cleanup_errors
                            .push(format!("{name} child wait after kill: {error}")),
                        Err(_) => run
                            .cleanup_errors
                            .push(format!("{name} child did not exit after kill")),
                    }
                }
            }
        }
    }
}

#[tauri::command]
pub async fn dev_manual_alerts_start(
    app: AppHandle,
    state: State<'_, ManualAlerts>,
) -> Result<ManualAlertsStatus, String> {
    let relay = relay_path(&app)?;
    let mut guard = state.0.lock().await;
    if guard
        .as_ref()
        .is_some_and(|run| run.claude_session != "Completed" || run.codex_session != "Completed")
    {
        return Err("A two-alert Dev test is already active; use Status or Cleanup first".into());
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let run_id = format!(
        "manual-{stamp}-{}",
        ALERT_RUN.fetch_add(1, Ordering::Relaxed)
    );
    let claude_id = format!("{ALERT_PREFIX}claude:{run_id}:alert-a");
    let codex_wire_id = format!("{ALERT_PREFIX}codex:{run_id}:alert-b");
    let codex_id = format!("codex:{codex_wire_id}");
    send_event(&relay, "claude", "SessionStart", &claude_id, &run_id).await?;
    if let Err(error) = send_event(&relay, "codex", "SessionStart", &codex_wire_id, &run_id).await {
        let _ = send_event(&relay, "claude", "SessionEnd", &claude_id, &run_id).await;
        return Err(error);
    }
    let claude = match start_permission(&relay, "claude", &claude_id, &run_id).await {
        Ok(child) => child,
        Err(error) => {
            let _ = send_event(&relay, "claude", "SessionEnd", &claude_id, &run_id).await;
            let _ = send_event(&relay, "codex", "SessionEnd", &codex_wire_id, &run_id).await;
            return Err(error);
        }
    };
    let codex = match start_permission(&relay, "codex", &codex_wire_id, &run_id).await {
        Ok(child) => child,
        Err(error) => {
            drop(claude);
            let _ = send_event(&relay, "claude", "SessionEnd", &claude_id, &run_id).await;
            let _ = send_event(&relay, "codex", "SessionEnd", &codex_wire_id, &run_id).await;
            return Err(error);
        }
    };
    let run = ManualAlertRun {
        run_id,
        claude_id,
        codex_wire_id,
        codex_id,
        claude,
        codex,
        claude_session: "Active".into(),
        codex_session: "Active".into(),
        cleanup_errors: Vec::new(),
    };
    let result = status_of(&run);
    let timeout_run_id = run.run_id.clone();
    *guard = Some(run);
    let app_for_timeout = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(CHILD_DECISION_LIMIT).await;
        let Some(state) = app_for_timeout.try_state::<ManualAlerts>() else {
            return;
        };
        let mut guard = state.0.lock().await;
        let Some(run) = guard.as_mut().filter(|run| run.run_id == timeout_run_id) else {
            return;
        };
        if refresh_request(&mut run.claude).await.is_err()
            || refresh_request(&mut run.codex).await.is_err()
        { /* cleanup below records delivery independently */
        }
        if run.claude.result != "Resolved (ExplicitDeny)"
            || run.codex.result != "Resolved (ExplicitDeny)"
        {
            cleanup_run(&relay, run).await;
        }
    });
    Ok(result)
}

#[tauri::command]
pub async fn dev_manual_alerts_status(
    state: State<'_, ManualAlerts>,
) -> Result<Option<ManualAlertsStatus>, String> {
    let mut guard = state.0.lock().await;
    let Some(run) = guard.as_mut() else {
        return Ok(None);
    };
    refresh_request(&mut run.claude).await?;
    refresh_request(&mut run.codex).await?;
    Ok(Some(status_of(run)))
}

#[tauri::command]
pub async fn dev_manual_alerts_cleanup(
    app: AppHandle,
    state: State<'_, ManualAlerts>,
) -> Result<ManualAlertsStatus, String> {
    let relay = relay_path(&app)?;
    let mut guard = state.0.lock().await;
    let run = guard.as_mut().ok_or("No two-alert Dev test is active")?;
    cleanup_run(&relay, run).await;
    let result = status_of(run);
    if result.cleanup_errors.is_empty() {
        Ok(result)
    } else {
        Err(format!(
            "{}; status={}",
            result.cleanup_errors.join("; "),
            serde_json::to_string(&result).unwrap_or_default()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_and_marked_as_synthetic_for_both_agents() {
        let claude = simulated_payload("claude", "SessionStart", "run-12345678").unwrap();
        let codex = simulated_payload("codex", "SessionStart", "run-12345678").unwrap();
        assert_eq!(claude["session_id"], "nook-sim:claude:run-12345678");
        assert_eq!(codex["session_id"], "nook-sim:codex:run-12345678");
        assert_ne!(claude["session_id"], codex["session_id"]);
        assert_eq!(claude["nook_simulated"], true);
        assert_eq!(codex["nook_simulated"], true);
    }

    #[test]
    fn permission_payload_is_inert_and_carries_a_short_ui_timeout() {
        let payload = simulated_payload("codex", "PermissionRequest", "run-12345678").unwrap();
        assert_eq!(payload["request_id"], "nook-sim:req:codex:run-12345678");
        assert_eq!(payload["nook_simulated_timeout_ms"], 8_000);
        assert_eq!(
            payload["tool_input"]["command"],
            "echo Nook Dev simulated permission"
        );
    }

    #[test]
    fn rejects_pipe_like_ids_agents_and_unrecognized_events() {
        assert!(simulated_payload("claude", "SessionStart", "short").is_err());
        assert!(simulated_payload("other", "SessionStart", "run-12345678").is_err());
        assert!(simulated_payload("codex", "PermissionRequest", "../../pipe").is_err());
        assert!(simulated_payload("codex", "unknown", "run-12345678").is_err());
    }

    #[test]
    fn manual_alert_payloads_are_exact_synthetic_and_deny_only_safe() {
        let claude = alert_payload(
            "claude",
            "PermissionRequest",
            "nook-test:two-pending-alerts:claude:run-x",
            "run-x",
        );
        let codex = alert_payload(
            "codex",
            "PermissionRequest",
            "nook-test:two-pending-alerts:codex:run-x",
            "run-x",
        );
        assert_eq!(
            claude["session_id"],
            "nook-test:two-pending-alerts:claude:run-x"
        );
        assert_eq!(
            codex["session_id"],
            "nook-test:two-pending-alerts:codex:run-x"
        );
        assert_eq!(claude["tool_input"]["command"], "echo fixture-only");
        assert_eq!(codex["tool_input"]["command"], "echo fixture-only");
        assert!(claude.get("permission_decision").is_none());
        assert!(codex.get("permission_decision").is_none());
        assert_eq!(codex["turn_id"], "two-alerts-run-x");
    }

    #[test]
    fn status_distinguishes_pending_resolution_and_completed_sessions() {
        let status = status_snapshot(
            "run-x",
            "nook-test:two-pending-alerts:claude:run-x",
            "codex:nook-test:two-pending-alerts:codex:run-x",
            "Pending",
            "Resolved (ExplicitDeny)",
            "Active",
            "Completed (SessionEnd delivered through Dev IPC)",
        );
        assert_eq!(status.pending, 1);
        assert_eq!(status.claude_request, "Pending");
        assert_eq!(status.codex_request, "Resolved (ExplicitDeny)");
        assert!(status.codex_session.starts_with("Completed"));
    }

    #[test]
    fn empty_or_invalid_relay_output_is_not_a_deny() {
        assert_eq!(classify_permission_result(true, "", false), "Cancelled");
        assert_eq!(classify_permission_result(true, "", true), "TimedOut");
        assert_eq!(classify_permission_result(false, "", false), "RelayFailed");
        assert_eq!(
            classify_permission_result(true, "not-json", false),
            "InvalidResponse"
        );
        assert_eq!(
            classify_permission_result(
                true,
                r#"{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny"}}}"#,
                false
            ),
            "Resolved (ExplicitDeny)"
        );
    }
}
