//! Passive Codex Desktop app-server quota reader, enabled only in Nook Dev.
//! The opt-in provider is shared by Dev and Standalone. Only normalized percentages and timestamps survive a read; protocol payloads
//! and account identifiers are deliberately discarded.

use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use tauri::{Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader, Lines};
use tokio::process::Command;
use tokio::time::timeout;

use crate::platform;

const MIN_REFRESH: Duration = Duration::from_secs(10 * 60);
const SNAPSHOT_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_PROTOCOL_LINE: usize = 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    pub used_percent: f64,
    pub window_duration_mins: u64,
    pub resets_at: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quotas {
    pub five_hour: Option<Window>,
    pub seven_day: Option<Window>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// Opt-in epoch: front ends discard events from an earlier enable period.
    pub generation: u64,
    pub quotas: Option<Quotas>,
    pub updated_at: Option<u64>,
    pub stale: bool,
    pub available: bool,
    pub failure_reason: Option<FailureReason>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FailureReason {
    Disabled,
    CliUnavailable,
    SpawnFailed,
    ProcessIsolationUnavailable,
    Timeout,
    Unauthorized,
    ServerExited,
    ProtocolError,
    QuotaUnavailable,
}

impl Snapshot {
    fn unavailable(reason: Option<FailureReason>) -> Self {
        Self {
            generation: 0,
            quotas: None,
            updated_at: None,
            stale: false,
            available: false,
            failure_reason: reason,
        }
    }
}

#[derive(Default)]
struct Cache {
    snapshot: Option<Snapshot>,
    fetched_at: Option<Instant>,
    failures: u32,
}

#[derive(Default)]
pub struct Provider {
    cache: Mutex<Cache>,
    gate: tokio::sync::Mutex<()>,
    enabled: std::sync::atomic::AtomicBool,
    enabled_generation: std::sync::atomic::AtomicU64,
    wake: tokio::sync::Notify,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn visible_snapshot(snapshot: &Snapshot, now: u64) -> Snapshot {
    if snapshot.quotas.is_none() {
        return snapshot.clone();
    }
    let age = snapshot.updated_at.map(|at| now.saturating_sub(at));
    if age.is_none_or(|age| age > SNAPSHOT_TTL.as_millis() as u64) {
        return Snapshot {
            generation: snapshot.generation,
            updated_at: snapshot.updated_at,
            stale: true,
            ..Snapshot::unavailable(Some(FailureReason::QuotaUnavailable))
        };
    }
    let mut visible = snapshot.clone();
    visible.stale |= age.is_some_and(|age| age > MIN_REFRESH.as_millis() as u64);
    if let Some(quotas) = &mut visible.quotas {
        quotas.five_hour = quotas.five_hour.filter(|window| window.resets_at > now);
        quotas.seven_day = quotas.seven_day.filter(|window| window.resets_at > now);
        if quotas.five_hour.is_none() && quotas.seven_day.is_none() {
            visible.quotas = None;
            visible.available = false;
            visible.stale = true;
            visible.failure_reason = Some(FailureReason::QuotaUnavailable);
        }
    }
    visible
}

fn read_window(value: &Value, now: u64) -> Option<Window> {
    let used = value
        .get("usedPercent")?
        .as_f64()
        .filter(|v| v.is_finite() && (0.0..=100.0).contains(v))?;
    let duration = value.get("windowDurationMins")?.as_u64()?;
    let resets_at = value.get("resetsAt")?.as_u64()?.checked_mul(1000)?;
    let plausible = resets_at > now && resets_at <= now.saturating_add(35 * 24 * 60 * 60 * 1000);
    plausible.then_some(Window {
        used_percent: used,
        window_duration_mins: duration,
        resets_at,
    })
}

/// Select windows by their protocol duration rather than their object key/order.
pub fn parse_rate_limits(root: &Value, now: u64) -> Option<Quotas> {
    let limits = root.get("rateLimits")?;
    let mut five_hour = None;
    let mut seven_day = None;
    let mut candidates = Vec::new();
    if let Some(primary) = limits.get("primary") {
        candidates.push(primary);
    }
    if let Some(secondary) = limits.get("secondary") {
        candidates.push(secondary);
    }
    if let Some(by_id) = root.get("rateLimitsByLimitId").and_then(Value::as_object) {
        if let Some(codex) = by_id.get("codex").and_then(Value::as_object) {
            for name in ["primary", "secondary"] {
                if let Some(window) = codex.get(name) {
                    candidates.push(window);
                }
            }
        }
    }
    for candidate in candidates {
        let Some(window) = read_window(candidate, now) else {
            continue;
        };
        match window.window_duration_mins {
            300 if five_hour.is_none() => five_hour = Some(window),
            10_080 if seven_day.is_none() => seven_day = Some(window),
            _ => {}
        }
    }
    (five_hour.is_some() || seven_day.is_some()).then_some(Quotas {
        five_hour,
        seven_day,
    })
}

fn version_tuple(text: &str) -> Option<(u64, u64, u64)> {
    let start = text.find(|c: char| c.is_ascii_digit())?;
    let version = text[start..].split_whitespace().next()?;
    let mut numbers = version.split(['.', '-', '+']);
    Some((
        numbers.next()?.parse().ok()?,
        numbers.next()?.parse().ok()?,
        numbers.next()?.parse().ok()?,
    ))
}

fn is_hash_dir(name: &std::ffi::OsStr) -> bool {
    let name = name.to_string_lossy();
    (8..=128).contains(&name.len()) && name.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn trusted_candidates(local_app_data: &Path, path_value: Option<&std::ffi::OsStr>) -> Vec<PathBuf> {
    let root = local_app_data.join("OpenAI").join("Codex").join("bin");
    let canonical_root = root.canonicalize().ok();
    let mut paths = Vec::new();
    if let Ok(entries) = fs::read_dir(&root) {
        let mut versions: Vec<_> = entries
            .flatten()
            .filter(|entry| {
                entry.file_type().is_ok_and(|kind| kind.is_dir()) && is_hash_dir(&entry.file_name())
            })
            .collect();
        versions.sort_by_key(|entry| {
            std::cmp::Reverse(entry.metadata().and_then(|m| m.modified()).ok())
        });
        for entry in versions {
            paths.push(entry.path().join("codex.exe"));
        }
    }
    // Preserve PATH order, but only accept canonical executables within the
    // signed-in user's known Codex Desktop installation root.
    if let Some(path_value) = path_value {
        for dir in std::env::split_paths(path_value) {
            let candidate = dir.join("codex.exe");
            if let Ok(canonical) = candidate.canonicalize() {
                if canonical
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
                    && canonical_root
                        .as_ref()
                        .is_some_and(|root| canonical.starts_with(root))
                {
                    paths.push(canonical);
                }
            }
        }
    }
    paths = paths
        .into_iter()
        .filter_map(|path| {
            if !path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
            {
                return None;
            }
            let canonical = path.canonicalize().ok()?;
            canonical_root
                .as_ref()
                .is_some_and(|root| canonical.starts_with(root))
                .then_some(canonical)
        })
        .collect();
    paths.dedup();
    paths
}

fn candidates() -> Vec<PathBuf> {
    let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) else {
        return Vec::new();
    };
    trusted_candidates(&local, std::env::var_os("PATH").as_deref())
}

fn resolve_codex_home(configured: Option<PathBuf>, user_profile: PathBuf) -> PathBuf {
    configured.unwrap_or_else(|| user_profile.join(".codex"))
}

async fn suitable_cli() -> Option<PathBuf> {
    for path in candidates() {
        let mut command = Command::new(&path);
        command
            .arg("--version")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        #[cfg(windows)]
        {
            command.creation_flags(crate::platform::CREATE_NO_WINDOW);
        }
        let Ok(Ok(output)) = timeout(Duration::from_secs(3), command.output()).await else {
            continue;
        };
        let version = String::from_utf8_lossy(&output.stdout);
        if output.status.success() && version_tuple(&version).is_some_and(|v| v >= (0, 165, 0)) {
            return Some(path);
        }
    }
    None
}

async fn read_from_cli(path: &Path, home: &Path) -> Result<Quotas, FailureReason> {
    read_from_cli_with(path, home, &["app-server"], None, REQUEST_TIMEOUT).await
}

async fn read_from_cli_with(
    path: &Path,
    home: &Path,
    args: &[&str],
    extra_env: Option<(&str, &str)>,
    request_timeout: Duration,
) -> Result<Quotas, FailureReason> {
    let user_home = crate::platform::home_dir();
    let mut command = Command::new(path);
    command
        .args(args)
        .current_dir(home)
        .env("CODEX_HOME", home)
        // The bundled Windows CLI searches HOME for its user profile even
        // when CODEX_HOME and the working directory are already set.
        .env("HOME", &user_home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.env("USERPROFILE", &user_home);
    if let Some((key, value)) = extra_env {
        command.env(key, value);
    }
    #[cfg(windows)]
    {
        command.creation_flags(crate::platform::CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().map_err(|_| FailureReason::SpawnFailed)?;
    #[cfg(windows)]
    let job = match ChildJob::attach(&child) {
        Ok(job) => job,
        Err(()) => {
            terminate_and_reap(&mut child).await;
            return Err(FailureReason::ProcessIsolationUnavailable);
        }
    };
    let result = timeout(request_timeout, async {
        let mut stdin = child.stdin.take().ok_or(FailureReason::ProtocolError)?;
        let stdout = child.stdout.take().ok_or(FailureReason::ProtocolError)?;
        let mut reader = BufReader::new(stdout).lines();
        request_quotas(&mut reader, &mut stdin, now_ms()).await
    })
    .await;
    // Kill and reap on success, protocol errors, and timeout alike.
    terminate_and_reap(&mut child).await;
    #[cfg(windows)]
    drop(job);
    result.map_err(|_| FailureReason::Timeout)?
}

/// JSONL app-server exchange separated from process discovery so tests can
/// exercise it against an in-memory server without starting the real CLI.
async fn request_quotas<R, W>(
    reader: &mut Lines<BufReader<R>>,
    writer: &mut W,
    now: u64,
) -> Result<Quotas, FailureReason>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let initialize = format!("{{\"id\":1,\"method\":\"initialize\",\"params\":{{\"clientInfo\":{{\"name\":\"nook\",\"version\":\"{}\"}},\"capabilities\":{{}}}}}}\n", crate::app_version());
    writer.write_all(initialize.as_bytes()).await.map_err(|_| FailureReason::ProtocolError)?;
    for _ in 0..32 {
        let line = reader
            .next_line()
            .await
            .map_err(|_| FailureReason::ProtocolError)?
            .ok_or(FailureReason::ServerExited)?;
        if line.len() > MAX_PROTOCOL_LINE {
            return Err(FailureReason::ProtocolError);
        }
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if is_server_request(&message) {
            answer_server_request(writer, &message).await?;
            continue;
        }
        if message.get("id").and_then(Value::as_i64) != Some(1)
            || (message.get("result").is_none() && message.get("error").is_none())
        {
            continue;
        }
        if message.get("error").is_some() {
            return Err(failure_from_response(&message));
        }
        writer
            .write_all(b"{\"method\":\"initialized\",\"params\":{}}\n")
            .await
            .map_err(|_| FailureReason::ProtocolError)?;
        writer
            .write_all(b"{\"id\":2,\"method\":\"account/rateLimits/read\",\"params\":{}}\n")
            .await
            .map_err(|_| FailureReason::ProtocolError)?;
        for _ in 0..32 {
            let line = reader
                .next_line()
                .await
                .map_err(|_| FailureReason::ProtocolError)?
                .ok_or(FailureReason::ServerExited)?;
            if line.len() > MAX_PROTOCOL_LINE {
                return Err(FailureReason::ProtocolError);
            }
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if is_server_request(&message) {
                answer_server_request(writer, &message).await?;
                continue;
            }
            if message.get("id").and_then(Value::as_i64) != Some(2)
                || (message.get("result").is_none() && message.get("error").is_none())
            {
                continue;
            }
            if message.get("error").is_some() {
                return Err(failure_from_response(&message));
            }
            return parse_rate_limits(message.get("result").unwrap_or(&Value::Null), now)
                .ok_or(FailureReason::QuotaUnavailable);
        }
        return Err(FailureReason::ProtocolError);
    }
    Err(FailureReason::ProtocolError)
}

fn is_server_request(message: &Value) -> bool {
    message.get("id").is_some_and(|id| !id.is_null())
        && message.get("method").and_then(Value::as_str).is_some()
        && message.get("result").is_none()
        && message.get("error").is_none()
}

async fn answer_server_request<W: AsyncWrite + Unpin>(
    writer: &mut W,
    message: &Value,
) -> Result<(), FailureReason> {
    let Some(id) = message.get("id").filter(|id| !id.is_null()) else {
        return Ok(());
    };
    let response =
        serde_json::json!({"id":id,"error":{"code":-32601,"message":"Unsupported request"}});
    writer
        .write_all(response.to_string().as_bytes())
        .await
        .map_err(|_| FailureReason::ProtocolError)?;
    writer
        .write_all(b"\n")
        .await
        .map_err(|_| FailureReason::ProtocolError)
}

fn failure_from_response(message: &Value) -> FailureReason {
    match message
        .get("error")
        .and_then(|error| error.get("code"))
        .and_then(Value::as_i64)
    {
        Some(-32001) => FailureReason::Unauthorized,
        _ => FailureReason::ProtocolError,
    }
}

async fn terminate_and_reap(child: &mut tokio::process::Child) {
    let _ = child.kill().await;
    let _ = timeout(Duration::from_secs(1), child.wait()).await;
}

#[cfg(windows)]
struct ChildJob(windows::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl ChildJob {
    fn attach(child: &tokio::process::Child) -> Result<Self, ()> {
        use std::mem::size_of;
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        use windows::Win32::System::Threading::{
            OpenProcess, PROCESS_ACCESS_RIGHTS, PROCESS_QUERY_LIMITED_INFORMATION,
            PROCESS_SET_QUOTA, PROCESS_TERMINATE,
        };

        unsafe {
            let pid = child.id().ok_or(())?;
            let job = CreateJobObjectW(None, PCWSTR::null()).map_err(|_| ())?;
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let process = match OpenProcess(
                PROCESS_ACCESS_RIGHTS(
                    PROCESS_SET_QUOTA.0 | PROCESS_TERMINATE.0 | PROCESS_QUERY_LIMITED_INFORMATION.0,
                ),
                false,
                pid,
            ) {
                Ok(process) => process,
                Err(_) => {
                    let _ = CloseHandle(job);
                    return Err(());
                }
            };
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast::<std::ffi::c_void>(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .is_err()
                || AssignProcessToJobObject(job, process).is_err()
            {
                let _ = CloseHandle(process);
                let _ = CloseHandle(job);
                return Err(());
            }
            let _ = CloseHandle(process);
            Ok(Self(job))
        }
    }
}

#[cfg(windows)]
unsafe impl Send for ChildJob {}

#[cfg(windows)]
impl Drop for ChildJob {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

async fn fetch() -> Result<Quotas, FailureReason> {
    let cli = suitable_cli().await.ok_or(FailureReason::CliUnavailable)?;
    let user_profile = std::env::var_os(crate::platform::HOME_VAR)
        .map(PathBuf::from)
        .unwrap_or_else(platform::home_dir);
    let configured_home = std::env::var_os("CODEX_HOME").map(PathBuf::from);
    let home = resolve_codex_home(configured_home, user_profile);
    read_from_cli(&cli, &home).await
}

impl Provider {
    pub fn set_enabled(&self, enabled: bool) {
        use std::sync::atomic::Ordering;
        if self.enabled.swap(enabled, Ordering::SeqCst) != enabled {
            let generation = self.enabled_generation.fetch_add(1, Ordering::SeqCst) + 1;
            if !enabled {
                *self.cache.lock().unwrap() = Cache::default();
            } else {
                let mut cache = self.cache.lock().unwrap();
                cache.snapshot = Some(Snapshot {
                    generation,
                    quotas: None,
                    updated_at: None,
                    stale: false,
                    available: false,
                    failure_reason: None,
                });
                cache.fetched_at = None;
            }
            self.wake.notify_one();
        }
    }

    fn stamp(&self, mut snapshot: Snapshot) -> Snapshot {
        snapshot.generation = self
            .enabled_generation
            .load(std::sync::atomic::Ordering::SeqCst);
        snapshot
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub async fn read(&self) -> Snapshot {
        self.read_with_at(Instant::now(), fetch()).await
    }

    /// Return the current in-memory snapshot without triggering a CLI or app-server read.
    pub fn last_snapshot(&self) -> Snapshot {
        let cache = self.cache.lock().unwrap();
        cache
            .snapshot
            .as_ref()
            .map(|snapshot| self.stamp(visible_snapshot(snapshot, now_ms())))
            .unwrap_or_else(|| {
                let mut snapshot = Snapshot::unavailable(if self.is_enabled() {
                    None
                } else {
                    Some(FailureReason::Disabled)
                });
                if self.is_enabled() {
                    snapshot.failure_reason = None;
                }
                self.stamp(snapshot)
            })
    }

    async fn read_with_at<F>(&self, now: Instant, fetch_result: F) -> Snapshot
    where
        F: Future<Output = Result<Quotas, FailureReason>>,
    {
        let _guard = self.gate.lock().await;
        if !self.is_enabled() {
            return self.stamp(Snapshot::unavailable(Some(FailureReason::Disabled)));
        }
        let generation = self
            .enabled_generation
            .load(std::sync::atomic::Ordering::SeqCst);
        if !self.is_enabled() {
            return self.stamp(Snapshot::unavailable(Some(FailureReason::Disabled)));
        }
        {
            let cache = self.cache.lock().unwrap();
            let backoff = Duration::from_secs(
                (60u64.saturating_mul(1u64 << cache.failures.min(5))).min(30 * 60),
            );
            if cache
                .fetched_at
                .is_some_and(|at| now.saturating_duration_since(at) < MIN_REFRESH.max(backoff))
            {
                return cache
                    .snapshot
                    .as_ref()
                    .map(|snapshot| self.stamp(visible_snapshot(snapshot, now_ms())))
                    .unwrap_or_else(|| self.stamp(Snapshot::unavailable(None)));
            }
        }
        let result = fetch_result.await;
        let mut cache = self.cache.lock().unwrap();
        if !self.is_enabled()
            || self
                .enabled_generation
                .load(std::sync::atomic::Ordering::SeqCst)
                != generation
        {
            return self.stamp(Snapshot::unavailable(Some(FailureReason::Disabled)));
        }
        match result {
            Ok(quotas) => {
                let snapshot = Snapshot {
                    generation,
                    quotas: Some(quotas),
                    updated_at: Some(now_ms()),
                    stale: false,
                    available: true,
                    failure_reason: None,
                };
                cache.snapshot = Some(snapshot.clone());
                cache.fetched_at = Some(now);
                cache.failures = 0;
                self.stamp(snapshot)
            }
            Err(reason) => {
                cache.failures = cache.failures.saturating_add(1);
                cache.fetched_at = Some(now);
                let snapshot = cache
                    .snapshot
                    .as_ref()
                    .filter(|last| last.quotas.is_some())
                    .map(|last| {
                        let mut stale = visible_snapshot(last, now_ms());
                        stale.stale = true;
                        stale.failure_reason = Some(reason);
                        stale
                    })
                    .unwrap_or_else(|| Snapshot::unavailable(Some(reason)));
                cache.snapshot = Some(snapshot.clone());
                self.stamp(snapshot)
            }
        }
    }
}

/// Keep the Dev snapshot current and publish only its normalized representation.
pub fn start(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let provider = app.state::<Provider>();
            if provider.is_enabled() {
                let snapshot = provider.read().await;
                let _ = app.emit("codex-quota", snapshot);
            }
            let _ = timeout(MIN_REFRESH, provider.wake.notified()).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::io::{duplex, split};

    const NOW: u64 = 1_800_000_000_000;
    const RATE_LIMITS_FIXTURE: &str =
        include_str!("../tests/fixtures/codex_app_server_rate_limits.json");

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
    }

    fn quota_result() -> Value {
        serde_json::from_str::<Value>(RATE_LIMITS_FIXTURE).unwrap()["result"].clone()
    }

    async fn mock_exchange(
        before: Vec<Value>,
        after: Vec<Value>,
        now: u64,
    ) -> Result<Quotas, FailureReason> {
        let (client, server) = duplex(32 * 1024);
        let (client_read, mut client_write) = split(client);
        let (server_read, mut server_write) = split(server);
        let mut client_lines = BufReader::new(client_read).lines();
        let expects_server_request = before.iter().any(is_server_request);
        let server_task = tokio::spawn(async move {
            let mut server_lines = BufReader::new(server_read).lines();
            let initialize: Value =
                serde_json::from_str(&server_lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(initialize["id"], 1);
            assert_eq!(initialize["method"], "initialize");
            assert!(initialize.get("jsonrpc").is_none());
            for message in before {
                server_write
                    .write_all(message.to_string().as_bytes())
                    .await
                    .unwrap();
                server_write.write_all(b"\n").await.unwrap();
            }
            let mut saw_init = false;
            let mut saw_server_request_response = false;
            let quota_request = loop {
                let line = server_lines.next_line().await.unwrap().unwrap();
                let message: Value = serde_json::from_str(&line).unwrap();
                assert!(message.get("jsonrpc").is_none());
                if message.get("method").and_then(Value::as_str) == Some("initialized") {
                    saw_init = true;
                }
                if message.get("id").and_then(Value::as_str) == Some("push1") {
                    assert_eq!(message["error"]["code"], -32601);
                    assert_eq!(message["error"]["message"], "Unsupported request");
                    saw_server_request_response = true;
                }
                if message.get("method").and_then(Value::as_str) == Some("account/rateLimits/read")
                {
                    break message;
                }
            };
            assert!(saw_init && saw_server_request_response == expects_server_request);
            assert_eq!(quota_request["id"], 2);
            assert_eq!(quota_request["params"], json!({}));
            for message in after {
                server_write
                    .write_all(message.to_string().as_bytes())
                    .await
                    .unwrap();
                server_write.write_all(b"\n").await.unwrap();
            }
        });
        let result = request_quotas(&mut client_lines, &mut client_write, now).await;
        server_task.await.unwrap();
        result
    }

    fn response(id: u64, result: Value) -> Value {
        json!({"id":id,"result":result})
    }

    #[test]
    fn parses_windows_by_duration_including_limit_map() {
        let quotas = parse_rate_limits(&quota_result(), NOW).unwrap();
        assert_eq!(quotas.five_hour.unwrap().used_percent, 23.0);
        assert_eq!(quotas.seven_day.unwrap().used_percent, 71.0);
        let expiry = parse_rate_limits(&quota_result(), 1_800_018_000_000).unwrap();
        assert_eq!(expiry.five_hour, None);
        assert_eq!(expiry.seven_day.unwrap().resets_at, 1_800_600_000_000);
        assert_eq!(parse_rate_limits(&quota_result(), 1_800_600_000_000), None);
    }

    #[test]
    fn zero_usage_is_a_valid_five_hour_value_and_missing_window_stays_missing() {
        let response = json!({"rateLimits":{"primary":{"usedPercent":0,"windowDurationMins":300,"resetsAt":1800018000},"secondary":{"usedPercent":8,"windowDurationMins":10080,"resetsAt":1800600000}}});
        let quotas = parse_rate_limits(&response, NOW).unwrap();
        assert_eq!(quotas.five_hour.unwrap().used_percent, 0.0);
        assert_eq!(quotas.seven_day.unwrap().used_percent, 8.0);

        let missing = json!({"rateLimits":{"primary":{"usedPercent":null,"windowDurationMins":300,"resetsAt":1800018000},"secondary":{"usedPercent":8,"windowDurationMins":10080,"resetsAt":1800600000}}});
        let quotas = parse_rate_limits(&missing, NOW).unwrap();
        assert_eq!(quotas.five_hour, None);
        assert_eq!(quotas.seven_day.unwrap().used_percent, 8.0);
    }

    #[test]
    fn rejects_malformed_out_of_range_and_implausible_windows() {
        let payload = json!({"rateLimits":{"primary":{"usedPercent":101,"windowDurationMins":300,"resetsAt":1800018000}}});
        assert_eq!(parse_rate_limits(&payload, NOW), None);
        assert_eq!(parse_rate_limits(&json!({"rateLimits":null}), NOW), None);
        assert_eq!(
            parse_rate_limits(
                &json!({"rateLimits":{"primary":null,"secondary":{},"rateLimitsByLimitId":null}}),
                NOW
            ),
            None
        );
        assert_eq!(
            parse_rate_limits(
                &json!({"rateLimits":{"primary":{"usedPercent":"23","windowDurationMins":300,"resetsAt":1800018000}}}),
                NOW
            ),
            None
        );
        assert_eq!(
            parse_rate_limits(
                &json!({"rateLimits":{"primary":{"usedPercent":23,"windowDurationMins":null,"resetsAt":1800018000}}}),
                NOW
            ),
            None
        );
        assert_eq!(
            parse_rate_limits(
                &json!({"rateLimits":{"primary":{"usedPercent":23,"windowDurationMins":300,"resetsAt":null}}}),
                NOW
            ),
            None
        );
        assert_eq!(
            parse_rate_limits(&json!({"error":{"code":-1,"message":"unsupported"}}), NOW),
            None
        );
        let payload = json!({"rateLimits":{"primary":{"usedPercent":20,"windowDurationMins":300,"resetsAt":0}}});
        assert_eq!(parse_rate_limits(&payload, NOW), None);
    }

    #[test]
    fn desktop_discovery_trusts_only_hash_version_exes_and_keeps_priorities() {
        let base =
            std::env::temp_dir().join(format!("nook-codex-discovery-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let root = base.join("OpenAI").join("Codex").join("bin");
        let old = root.join("a1b2c3d4");
        let newest = root.join("b1c2d3e4");
        let odd = root.join("current");
        let path_candidate = root.join("path-priority");
        let outside = base.join("untrusted");
        for dir in [&old, &newest, &odd, &path_candidate, &outside] {
            fs::create_dir_all(dir).unwrap();
        }
        for dir in [&old, &newest, &odd, &path_candidate, &outside] {
            fs::write(dir.join("codex.exe"), b"mock only").unwrap();
        }
        fs::write(newest.join("codex.cmd"), b"must never launch").unwrap();
        let path = std::env::join_paths([&path_candidate, &outside]).unwrap();
        let found = trusted_candidates(&base, Some(&path));
        assert_eq!(found.len(), 3);
        assert_eq!(
            found.last().unwrap(),
            &path_candidate.join("codex.exe").canonicalize().unwrap()
        );
        let trusted_root = root.canonicalize().unwrap();
        assert!(found
            .iter()
            .all(|candidate| candidate.starts_with(&trusted_root)));
        assert!(!found
            .iter()
            .any(|candidate| candidate.starts_with(&outside)));
        assert!(found.iter().all(|candidate| candidate
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))));
        assert!(version_tuple("codex 0.165.0-alpha.1.2").unwrap() >= (0, 165, 0));
        assert!(version_tuple("codex 0.164.9").unwrap() < (0, 165, 0));
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn quota_provider_is_disabled_by_default_and_expired_snapshots_are_unavailable() {
        runtime().block_on(async {
            let provider = Provider::default();
            assert!(!provider.is_enabled());
            assert_eq!(
                provider.read().await,
                Snapshot::unavailable(Some(FailureReason::Disabled))
            );
            let calls = std::sync::Arc::new(AtomicUsize::new(0));
            let attempts = calls.clone();
            let disabled = provider
                .read_with_at(Instant::now(), async move {
                    attempts.fetch_add(1, Ordering::SeqCst);
                    Err(FailureReason::ProtocolError)
                })
                .await;
            assert_eq!(disabled.failure_reason, Some(FailureReason::Disabled));
            assert_eq!(calls.load(Ordering::SeqCst), 0);
        });
        let mut snapshot = Snapshot {
            generation: 0,
            quotas: Some(parse_rate_limits(&quota_result(), NOW).unwrap()),
            updated_at: Some(NOW - SNAPSHOT_TTL.as_millis() as u64 - 1),
            stale: true,
            available: true,
            failure_reason: Some(FailureReason::Timeout),
        };
        let expired = visible_snapshot(&snapshot, NOW);
        assert_eq!(expired.quotas, None);
        assert!(!expired.available);
        assert!(expired.stale);
        snapshot.updated_at = Some(NOW);
        let after_reset = visible_snapshot(&snapshot, 1_800_600_000_000);
        assert_eq!(after_reset.quotas, None);
        assert!(!after_reset.available);
    }

    #[test]
    fn a_cached_snapshot_older_than_the_refresh_interval_is_marked_stale() {
        let snapshot = Snapshot {
            generation: 0,
            quotas: Some(parse_rate_limits(&quota_result(), NOW).unwrap()),
            updated_at: Some(NOW - MIN_REFRESH.as_millis() as u64 - 1),
            stale: false,
            available: true,
            failure_reason: None,
        };
        let visible = visible_snapshot(&snapshot, NOW);
        assert!(visible.available);
        assert!(visible.stale);
        assert!(visible.quotas.is_some());
    }

    #[test]
    fn opt_in_epochs_advance_and_are_stamped_on_empty_and_quota_snapshots() {
        let provider = Provider::default();
        assert_eq!(provider.last_snapshot().generation, 0);
        provider.set_enabled(true);
        let enabled = provider.last_snapshot();
        assert_eq!(enabled.generation, 1);
        assert_eq!(enabled.failure_reason, None);
        provider.set_enabled(false);
        assert_eq!(provider.last_snapshot().generation, 2);
        provider.set_enabled(true);
        assert_eq!(provider.last_snapshot().generation, 3);
    }

    #[test]
    fn last_snapshot_is_cache_only_and_never_fetches() {
        runtime().block_on(async {
            let provider = Provider::default();
            assert_eq!(
                provider.last_snapshot().failure_reason,
                Some(FailureReason::Disabled)
            );
            provider.set_enabled(true);
            let waiting = provider.last_snapshot();
            assert!(!waiting.available);
            assert_eq!(waiting.failure_reason, None);

            let quotas = parse_rate_limits(&quota_result(), NOW).unwrap();
            provider
                .read_with_at(Instant::now(), async { Ok(quotas) })
                .await;
            let cached = provider.last_snapshot();
            assert!(cached.available);
            assert_eq!(cached.quotas.unwrap().five_hour.unwrap().used_percent, 23.0);
        });
    }

    #[test]
    fn disabling_clears_snapshot_and_discards_an_in_flight_read() {
        runtime().block_on(async {
            let provider = std::sync::Arc::new(Provider::default());
            provider.set_enabled(true);
            let quotas = parse_rate_limits(&quota_result(), NOW).unwrap();
            provider
                .read_with_at(Instant::now(), async { Ok(quotas.clone()) })
                .await;
            assert!(provider.last_snapshot().available);

            let (started_tx, started_rx) = tokio::sync::oneshot::channel();
            let (result_tx, result_rx) = tokio::sync::oneshot::channel();
            let in_flight = {
                let provider = provider.clone();
                tokio::spawn(async move {
                    provider
                        .read_with_at(Instant::now() + MIN_REFRESH, async move {
                            let _ = started_tx.send(());
                            result_rx.await.unwrap()
                        })
                        .await
                })
            };
            started_rx.await.unwrap();
            provider.set_enabled(false);

            let disabled = provider.last_snapshot();
            assert_eq!(disabled.failure_reason, Some(FailureReason::Disabled));
            assert_eq!(disabled.quotas, None);
            assert!(!disabled.available);

            result_tx.send(Ok(quotas)).unwrap();
            assert_eq!(
                in_flight.await.unwrap().failure_reason,
                Some(FailureReason::Disabled)
            );
            assert_eq!(provider.last_snapshot(), disabled);
        });
    }

    #[test]
    fn version_parser_rejects_older_cli() {
        assert!(version_tuple("codex 0.165.0-alpha.1.2").unwrap() >= (0, 165, 0));
        assert!(version_tuple("codex 0.164.9").unwrap() < (0, 165, 0));
    }

    #[test]
    fn quota_reader_uses_the_active_codex_home_or_the_default_user_home() {
        let user = PathBuf::from(r"C:\Users\TestUser");
        assert_eq!(resolve_codex_home(None, user.clone()), user.join(".codex"));
        let isolated = PathBuf::from(r"C:\Users\TestUser\AppData\Local\Codex-Test");
        assert_eq!(resolve_codex_home(Some(isolated.clone()), user), isolated);
    }

    #[test]
    fn mock_app_server_handshake_notifications_and_request_id_correlation() {
        runtime().block_on(async {
            let before = vec![
                json!({"method":"server/notice","params":{"accountId":"private-account"}}),
                json!({"id":"push1","method":"server/needsInput","params":{"accountId":"private-account"}}),
                response(1, json!({"userAgent":"mock"})),
            ];
            let after = vec![
                json!({"method":"account/updated","params":{"token":"private-token"}}),
                response(99, json!({"rateLimits":{"primary":{"usedPercent":99}}})),
                response(2, quota_result()),
            ];
            let quotas = mock_exchange(before, after, NOW).await.unwrap();
            let five = quotas.five_hour.unwrap();
            let seven = quotas.seven_day.unwrap();
            assert_eq!((five.used_percent, five.window_duration_mins, five.resets_at), (23.0, 300, 1_800_018_000_000));
            assert_eq!((seven.used_percent, seven.window_duration_mins, seven.resets_at), (71.0, 10_080, 1_800_600_000_000));
            let normalized = serde_json::to_string(&quotas).unwrap();
            assert!(!normalized.contains("private-account"));
            assert!(!normalized.contains("private-token"));
            assert!(!normalized.contains("account/updated"));
        });
    }

    #[test]
    fn app_server_authorization_error_is_sanitized() {
        runtime().block_on(async {
            let result = mock_exchange(
                vec![response(1, json!({}))],
                vec![json!({"id":2,"error":{"code":-32001,"message":"denied account private-account token private-token"}})],
                NOW,
            ).await;
            assert_eq!(result, Err(FailureReason::Unauthorized));
            assert!(!format!("{result:?}").contains("private-token"));
            assert!(!format!("{result:?}").contains("private-account"));
        });
    }

    #[test]
    fn app_server_exit_before_response_returns_a_safe_error() {
        runtime().block_on(async {
            let result = mock_exchange(vec![response(1, json!({}))], vec![], NOW).await;
            assert_eq!(result, Err(FailureReason::ServerExited));
        });
    }

    #[cfg(windows)]
    #[test]
    fn app_server_cli_receives_the_windows_user_home_environment() {
        runtime().block_on(async {
            let exe = std::env::current_exe().unwrap();
            let fixture_args = ["--exact", "codex_quota::tests::mock_child_fixture", "--nocapture"];
            let expected_home = crate::platform::home_dir().to_string_lossy().to_string();
            let mode = format!("verify-home:{expected_home}");
            let result = read_from_cli_with(
                &exe,
                &std::env::temp_dir(),
                &fixture_args,
                Some(("NOOK_QUOTA_FIXTURE", &mode)),
                Duration::from_secs(2),
            )
            .await;
            assert_eq!(result.unwrap().five_hour.unwrap().used_percent, 23.0);
        });
    }

    #[cfg(windows)]
    #[test]
    fn app_server_timeout_is_bounded_and_does_not_kill_an_unrelated_child() {
        runtime().block_on(async {
            let exe = std::env::current_exe().unwrap();
            let fixture_args = [
                "--exact",
                "codex_quota::tests::mock_child_fixture",
                "--nocapture",
            ];
            let marker =
                std::env::temp_dir().join(format!("nook-codex-heartbeat-{}", std::process::id()));
            let _ = fs::remove_file(&marker);
            let fixture_mode = format!("stall:{}", marker.display());
            let mut unrelated = Command::new(&exe)
                .args(fixture_args)
                .env("NOOK_QUOTA_FIXTURE", "idle")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .kill_on_drop(true)
                .spawn()
                .unwrap();
            let result = read_from_cli_with(
                &exe,
                &std::env::temp_dir(),
                &fixture_args,
                Some(("NOOK_QUOTA_FIXTURE", &fixture_mode)),
                Duration::from_millis(500),
            )
            .await;
            let marker_seen = marker.is_file();
            let heartbeat = fs::metadata(&marker)
                .and_then(|metadata| metadata.modified())
                .ok();
            tokio::time::sleep(Duration::from_millis(180)).await;
            let stopped = heartbeat.is_some()
                && fs::metadata(&marker)
                    .and_then(|metadata| metadata.modified())
                    .ok()
                    == heartbeat;
            let unrelated_survived = unrelated.try_wait().unwrap().is_none();
            terminate_and_reap(&mut unrelated).await;
            let _ = fs::remove_file(marker);
            assert!(unrelated.try_wait().unwrap().is_some());
            assert_eq!(result, Err(FailureReason::Timeout));
            assert!(marker_seen, "mock descendant must have started");
            assert!(stopped, "job cleanup must stop the descendant");
            assert!(unrelated_survived, "the unrelated child must remain alive");
        });
    }

    #[test]
    fn mock_child_fixture() {
        match std::env::var("NOOK_QUOTA_FIXTURE") {
            Ok(mode) if mode.starts_with("verify-home:") => {
                use std::io::{BufRead, Write};
                assert_eq!(std::env::var("HOME").ok().as_deref(), Some(mode.trim_start_matches("verify-home:")));
                let stdin = std::io::stdin();
                let mut lines = stdin.lock().lines();
                let _ = lines.next();
                println!("{}", response(1, json!({})));
                let _ = std::io::stdout().flush();
                let _ = lines.next();
                let _ = lines.next();
                let mut quotas = quota_result();
                let now_seconds = now_ms() / 1000;
                quotas["rateLimits"]["primary"]["resetsAt"] = json!(now_seconds + 3600);
                quotas["rateLimits"]["secondary"]["resetsAt"] = json!(now_seconds + 7 * 24 * 3600);
                quotas["rateLimitsByLimitId"]["codex"]["primary"]["resetsAt"] = json!(now_seconds + 3600);
                quotas["rateLimitsByLimitId"]["codex"]["secondary"]["resetsAt"] = json!(now_seconds + 7 * 24 * 3600);
                println!("{}", response(2, quotas));
                let _ = std::io::stdout().flush();
            }
            Ok(mode) if mode == "idle" => loop {
                std::thread::sleep(Duration::from_secs(60));
            },
            Ok(mode) if mode.starts_with("stall:") => {
                use std::io::{BufRead, Write};
                let stdin = std::io::stdin();
                let mut lines = stdin.lock().lines();
                let _ = lines.next();
                println!("{}", response(1, json!({"accepted":true})));
                let _ = std::io::stdout().flush();
                let _ = lines.next();
                let _ = lines.next();
                let marker = mode.trim_start_matches("stall:");
                let fixture_args = [
                    "--exact",
                    "codex_quota::tests::mock_child_fixture",
                    "--nocapture",
                ];
                let heartbeat_mode = format!("heartbeat:{marker}");
                let _ = Command::new(std::env::current_exe().unwrap())
                    .args(fixture_args)
                    .env("NOOK_QUOTA_FIXTURE", heartbeat_mode)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .expect("spawn local mock descendant");
                loop {
                    std::thread::sleep(Duration::from_secs(60));
                }
            }
            Ok(mode) if mode.starts_with("heartbeat:") => {
                let marker = mode.trim_start_matches("heartbeat:");
                loop {
                    let _ = fs::write(marker, b"mock child alive");
                    std::thread::sleep(Duration::from_millis(30));
                }
            }
            _ => {}
        }
    }

    #[test]
    fn cache_serializes_parallel_reads_and_obeys_refresh_and_backoff() {
        runtime().block_on(async {
            let provider = std::sync::Arc::new(Provider::default());
            provider.set_enabled(true);
            let calls = std::sync::Arc::new(AtomicUsize::new(0));
            let base = Instant::now();
            let quotas = parse_rate_limits(&quota_result(), NOW).unwrap();
            let first_provider = provider.clone();
            let first_calls = calls.clone();
            let first_quotas = quotas.clone();
            let first = tokio::spawn(async move {
                first_provider
                    .read_with_at(base, async move {
                        first_calls.fetch_add(1, Ordering::SeqCst);
                        tokio::time::sleep(Duration::from_millis(20)).await;
                        Ok(first_quotas)
                    })
                    .await
            });
            let second_provider = provider.clone();
            let second_calls = calls.clone();
            let second_quotas = quotas.clone();
            let second = tokio::spawn(async move {
                second_provider
                    .read_with_at(base, async move {
                        second_calls.fetch_add(1, Ordering::SeqCst);
                        Ok(second_quotas)
                    })
                    .await
            });
            let second_snapshot = second.await.unwrap();
            let fresh = first.await.unwrap();
            assert_eq!(fresh, second_snapshot);
            assert!(fresh.available && !fresh.stale);
            assert_eq!(calls.load(Ordering::SeqCst), 1);

            let skipped_calls = calls.clone();
            let skipped = provider
                .read_with_at(base + Duration::from_secs(599), async move {
                    skipped_calls.fetch_add(1, Ordering::SeqCst);
                    Err(FailureReason::ProtocolError)
                })
                .await;
            assert_eq!(skipped, fresh);
            assert_eq!(calls.load(Ordering::SeqCst), 1);

            let fail_calls = calls.clone();
            let stale = provider
                .read_with_at(base + MIN_REFRESH, async move {
                    fail_calls.fetch_add(1, Ordering::SeqCst);
                    Err(FailureReason::Unauthorized)
                })
                .await;
            assert!(stale.available && stale.stale);
            assert_eq!(stale.quotas, fresh.quotas);
            assert_eq!(calls.load(Ordering::SeqCst), 2);
        });
    }

    #[test]
    fn failure_backoff_caps_retry_frequency_and_unavailable_has_no_payload() {
        runtime().block_on(async {
            let provider = Provider::default();
            provider.set_enabled(true);
            let base = Instant::now();
            for n in 0..6 {
                let snapshot = provider
                    .read_with_at(base + Duration::from_secs(n * 600), async {
                        Err(FailureReason::Timeout)
                    })
                    .await;
                assert_eq!(
                    snapshot,
                    Snapshot {
                        generation: 1,
                        ..Snapshot::unavailable(Some(FailureReason::Timeout))
                    }
                );
            }
            let too_soon = provider
                .read_with_at(base + Duration::from_secs(6 * 600), async {
                    panic!("backoff should suppress this read")
                })
                .await;
            assert_eq!(
                too_soon,
                Snapshot {
                    generation: 1,
                    ..Snapshot::unavailable(Some(FailureReason::Timeout))
                }
            );
            let due = provider
                .read_with_at(base + Duration::from_secs(6 * 600 + 1800), async {
                    Err(FailureReason::Timeout)
                })
                .await;
            assert_eq!(
                due,
                Snapshot {
                    generation: 1,
                    ..Snapshot::unavailable(Some(FailureReason::Timeout))
                }
            );
        });
    }

    #[test]
    fn timeout_and_child_cleanup_are_bounded() {
        runtime().block_on(async {
            let timed_out = timeout(Duration::from_millis(10), std::future::pending::<()>()).await;
            assert!(timed_out.is_err());

            let mut child = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "codex_quota::tests::mock_child_fixture",
                    "--nocapture",
                ])
                .env("NOOK_QUOTA_FIXTURE", "idle")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap();
            terminate_and_reap(&mut child).await;
            assert!(child.try_wait().unwrap().is_some());
        });
    }
}
