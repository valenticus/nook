#![cfg(windows)]

use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};

use serde_json::Value;

const FIXTURES: &str = include_str!("fixtures/dev-relay-events.json");

#[test]
fn synthetic_events_cross_only_the_dev_relay_endpoint() {
    let relay = env!("CARGO_BIN_EXE_nook-hook-dev");
    let server = env!("CARGO_BIN_EXE_nook-dev-relay-test-server");
    let endpoint_output = Command::new(relay)
        .arg("--test-endpoint")
        .output()
        .expect("run Dev endpoint diagnostic");
    assert!(endpoint_output.status.success());
    let endpoint = String::from_utf8(endpoint_output.stdout)
        .expect("endpoint is UTF-8")
        .trim()
        .to_string();
    assert!(
        endpoint.starts_with(r"\\.\pipe\nook-dev-"),
        "unexpected endpoint: {endpoint}"
    );

    let fixtures: Vec<Value> =
        serde_json::from_str(FIXTURES).expect("synthetic fixture JSON parses");
    let mut received = Vec::with_capacity(fixtures.len());
    for fixture in fixtures {
        let agent = fixture["agent"].as_str().unwrap();
        let event = fixture["event"].as_str().unwrap();
        let payload = fixture["payload"].clone();
        let mut peer = Command::new(server)
            .args(["--once", &endpoint])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("start disposable Dev IPC peer");
        let mut peer_output = BufReader::new(peer.stdout.take().unwrap());
        let mut ready = String::new();
        peer_output
            .read_line(&mut ready)
            .expect("read IPC readiness");
        assert_eq!(
            ready.trim(),
            "READY",
            "the Dev pipe may already be owned by a running Nook Dev"
        );

        let mut hook = Command::new(relay);
        hook.arg(event);
        if agent == "codex" {
            hook.args(["--agent", "codex"]);
        }
        let mut hook = hook
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("start Dev hook relay");
        hook.stdin
            .take()
            .unwrap()
            .write_all(format!("{payload}\n").as_bytes())
            .expect("write synthetic stdin payload");
        let hook_output = hook.wait_with_output().expect("wait for Dev hook relay");
        assert!(hook_output.status.success());

        let mut peer_tail = String::new();
        peer_output
            .read_to_string(&mut peer_tail)
            .expect("read payload captured by Dev IPC peer");
        let captured: Value =
            serde_json::from_str(peer_tail.lines().last().expect("peer received a payload"))
                .expect("captured event is JSON");
        assert_eq!(captured["hook_event_name"], event);
        assert_eq!(
            captured["session_id"],
            if agent == "codex" {
                format!("codex:{}", payload["session_id"].as_str().unwrap())
            } else {
                payload["session_id"].as_str().unwrap().to_string()
            }
        );
        if agent == "codex" {
            assert_eq!(captured["nook_tool"], "codex");
        }
        if event == "PermissionRequest" {
            let answer: Value = serde_json::from_slice(&hook_output.stdout)
                .expect("Dev test peer returns a decision");
            assert_eq!(answer["hookSpecificOutput"]["decision"]["behavior"], "deny");
        } else {
            assert!(
                hook_output.stdout.is_empty(),
                "non-permission hook must not write a decision"
            );
        }

        let status = peer.wait().expect("wait for disposable Dev IPC peer");
        assert!(status.success());
        received.push(captured);
    }

    let claude_ids: Vec<_> = received
        .iter()
        .filter(|e| e["session_id"] == "fixture-claude-01")
        .collect();
    let codex_ids: Vec<_> = received
        .iter()
        .filter(|e| e["session_id"] == "codex:fixture-codex-02")
        .collect();
    assert_eq!(claude_ids.len(), 7);
    assert_eq!(codex_ids.len(), 12);
    assert!(!received
        .iter()
        .any(|e| e["session_id"] == "fixture-codex-02"));

    // Invalid fixture input is rejected before connecting to any IPC endpoint.
    let mut malformed = Command::new(relay)
        .arg("PreToolUse")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("start Dev relay with malformed fixture");
    malformed
        .stdin
        .take()
        .unwrap()
        .write_all(b"this is not JSON")
        .expect("write malformed fixture");
    let malformed_output = malformed
        .wait_with_output()
        .expect("wait for malformed fixture");
    assert!(malformed_output.status.success());
    assert!(malformed_output.stdout.is_empty());

    // A peer that drops a permission connection never returns an allow. This
    // fixture is inert and no agent or action handler exists in the test.
    let mut peer = Command::new(server)
        .args(["--drop", &endpoint])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("start disconnecting Dev IPC peer");
    let mut peer_output = BufReader::new(peer.stdout.take().unwrap());
    let mut ready = String::new();
    peer_output
        .read_line(&mut ready)
        .expect("read IPC readiness");
    assert_eq!(ready.trim(), "READY");

    let permission = serde_json::json!({
        "hook_event_name": "PermissionRequest",
        "session_id": "fixture-disconnect-only",
        "tool_name": "Bash",
        "tool_input": { "command": "echo fixture-only" }
    });
    let mut hook = Command::new(relay)
        .arg("PermissionRequest")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("start Dev relay permission disconnect test");
    hook.stdin
        .take()
        .unwrap()
        .write_all(format!("{permission}\n").as_bytes())
        .expect("write inert permission fixture");
    let hook_output = hook
        .wait_with_output()
        .expect("wait for disconnected permission relay");
    assert!(hook_output.status.success());
    assert!(
        hook_output.stdout.is_empty(),
        "disconnect must never create an allow reply"
    );
    assert!(peer.wait().expect("wait for disconnecting peer").success());
}
