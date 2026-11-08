//! Read-only inventory of Claude Code and Codex hook configuration scopes.
//!
//! Global scopes are found from the current user profile (`CODEX_HOME` is
//! honored for Codex). Project scopes are limited to roots supplied by the
//! caller; this deliberately does not crawl the user's disks.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;

#[cfg(not(feature = "nook-standalone"))]
use crate::connect_identity;
use crate::{codex_hooks, hooks, platform};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "PascalCase")]
pub enum Agent {
    ClaudeCode,
    Codex,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "PascalCase")]
pub enum Scope {
    User,
    Project,
    ProjectLocal,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "PascalCase")]
pub enum Ownership {
    OriginalNook,
    NookDev,
    StandaloneNook,
    ThirdParty,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "PascalCase")]
pub enum ConfigStatus {
    Readable,
    Missing,
    Malformed,
    Inaccessible,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "PascalCase")]
pub enum ConfigurationState {
    Configured,
    NotConfigured,
    NeedsRepair,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "PascalCase")]
pub enum DeliveryState {
    NotConfigured,
    WaitingForActivity,
    Receiving,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigFile {
    pub agent: Agent,
    pub scope: Scope,
    pub path: String,
    pub status: ConfigStatus,
    pub fingerprint: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookRecord {
    pub agent: Agent,
    pub scope: Scope,
    pub config_path: String,
    pub event: String,
    pub ownership: Ownership,
    pub command: Option<String>,
    pub relay_path: Option<String>,
    pub relay_exists: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateEvent {
    pub agent: Agent,
    pub event: String,
    pub relay_path: String,
    pub scopes: Vec<Scope>,
    pub config_paths: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSummary {
    pub agent: Agent,
    pub configuration_status: ConfigurationState,
    pub delivery_state: DeliveryState,
    pub last_received_event: Option<String>,
    pub last_received_at_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectScan {
    pub standalone_relay: String,
    pub standalone_relay_ready: bool,
    pub detected_agents: Vec<Agent>,
    pub configs: Vec<ConfigFile>,
    pub hooks: Vec<HookRecord>,
    pub duplicates: Vec<DuplicateEvent>,
    pub agents: Vec<AgentSummary>,
    pub issues: Vec<String>,
}

#[derive(Default)]
pub struct DeliveryTracker(Mutex<BTreeMap<Agent, (String, u64)>>);

impl DeliveryTracker {
    pub fn observe(&self, agent: Agent, event: &str, at_ms: u64) {
        if let Ok(mut latest) = self.0.lock() {
            latest.insert(agent, (event.to_owned(), at_ms));
        }
    }

    pub fn attach(&self, scan: &mut ConnectScan) {
        let Ok(latest) = self.0.lock() else {
            return;
        };
        for summary in &mut scan.agents {
            if let Some((event, at_ms)) = latest.get(&summary.agent) {
                summary.delivery_state = DeliveryState::Receiving;
                summary.last_received_event = Some(event.clone());
                summary.last_received_at_ms = Some(*at_ms);
            }
        }
    }
}

#[derive(Clone)]
struct Candidate {
    agent: Agent,
    scope: Scope,
    path: PathBuf,
}

fn candidates(project_roots: &[String]) -> (Vec<Candidate>, Vec<String>) {
    candidates_with_user_paths(
        project_roots,
        hooks::settings_path(),
        codex_hooks::hooks_path(),
    )
}

fn candidates_with_user_paths(
    project_roots: &[String],
    claude_user_path: PathBuf,
    codex_user_path: PathBuf,
) -> (Vec<Candidate>, Vec<String>) {
    let mut out = vec![
        Candidate {
            agent: Agent::ClaudeCode,
            scope: Scope::User,
            path: claude_user_path,
        },
        Candidate {
            agent: Agent::Codex,
            scope: Scope::User,
            path: codex_user_path,
        },
    ];
    // A remembered project can be the user's home (for example, a CLI started
    // from there), making its `.codex/hooks.json` or `.claude/settings.json`
    // the exact same file as the user scope. Keep the first, authoritative
    // user candidate and never scan/plan the same physical file twice.
    let mut seen_configs = BTreeSet::new();
    for candidate in &out {
        seen_configs.insert(canonical_path_key(&candidate.path));
    }
    let mut issues = Vec::new();
    let mut seen = BTreeSet::new();
    for root in project_roots {
        let path = PathBuf::from(root);
        if !path.is_absolute() {
            issues.push(format!("Project root is not an absolute path: {root}"));
            continue;
        }
        let identity = path.to_string_lossy().to_lowercase();
        if !seen.insert(identity) {
            continue;
        }
        // These are the project scopes supported by the current managers and
        // agent formats. Claude's settings.local.json is the project-local scope.
        let project_candidates = [
            Candidate {
                agent: Agent::ClaudeCode,
                scope: Scope::Project,
                path: path.join(".claude").join("settings.json"),
            },
            Candidate {
                agent: Agent::ClaudeCode,
                scope: Scope::ProjectLocal,
                path: path.join(".claude").join("settings.local.json"),
            },
            Candidate {
                agent: Agent::Codex,
                scope: Scope::Project,
                path: path.join(".codex").join("hooks.json"),
            },
        ];
        for candidate in project_candidates {
            if seen_configs.insert(canonical_path_key(&candidate.path)) {
                out.push(candidate);
            }
        }
    }
    (out, issues)
}

/// Stable identity for a config path, including existing symlink/junction
/// resolution and lexical normalization for files that have not been created.
pub(crate) fn canonical_path_key(path: &Path) -> String {
    let resolved = std::fs::canonicalize(path).or_else(|_| {
        let parent = path.parent().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no parent")
        })?;
        let name = path.file_name().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no filename")
        })?;
        std::fs::canonicalize(parent).map(|parent| parent.join(name))
    });
    let value = resolved.unwrap_or_else(|_| lexical_normalize(path));
    let text = value.to_string_lossy().replace('/', "\\");
    if cfg!(windows) {
        text.to_lowercase()
    } else {
        text
    }
}

fn lexical_normalize(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    normalized.push(component.as_os_str());
                }
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

fn read_json(candidate: &Candidate) -> (ConfigFile, Option<Value>) {
    let path = candidate.path.to_string_lossy().to_string();
    let result = std::fs::read(&candidate.path);
    let (status, fingerprint, error, value) = match result {
        Ok(bytes) => {
            let fingerprint = Some(hooks::fingerprint(&bytes));
            let parsed = match candidate.agent {
                Agent::ClaudeCode => hooks::parse_settings(&bytes, &path),
                Agent::Codex => codex_hooks::parse(&bytes, &path),
            };
            match parsed {
                Ok(value) => (ConfigStatus::Readable, fingerprint, None, Some(value)),
                Err(error) => (ConfigStatus::Malformed, fingerprint, Some(error), None),
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (
            ConfigStatus::Missing,
            Some(hooks::fingerprint(b"")),
            None,
            None,
        ),
        Err(error) => (
            ConfigStatus::Inaccessible,
            None,
            Some(format!("Can't read {path}: {error}")),
            None,
        ),
    };
    (
        ConfigFile {
            agent: candidate.agent,
            scope: candidate.scope,
            path,
            status,
            fingerprint,
            error,
        },
        value,
    )
}

fn command_of(entry: &Value) -> Option<String> {
    entry
        .get("command")
        .and_then(Value::as_str)
        .map(str::to_owned)
}

fn relay_from_command(command: &str) -> Option<String> {
    let command = command.trim();
    if command.is_empty() {
        return None;
    }
    let first = if let Some(rest) = command.strip_prefix('"') {
        rest.split_once('"').map(|(path, _)| path)
    } else if let Some(rest) = command.strip_prefix('\'') {
        rest.split_once('\'').map(|(path, _)| path)
    } else {
        command.split_whitespace().next()
    }?;
    if first.is_empty() {
        None
    } else {
        Some(first.replace('/', "\\"))
    }
}

fn normalized(path: &str) -> String {
    path.replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

fn known_original_relay() -> PathBuf {
    let appdata = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    appdata
        .unwrap_or_else(|| {
            platform::local_dir()
                .parent()
                .unwrap_or(Path::new("."))
                .to_path_buf()
        })
        .join("Nook")
        .join("bin")
        .join("nook-hook.exe")
}

fn known_dev_relay() -> PathBuf {
    let appdata = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    appdata
        .unwrap_or_else(|| {
            platform::local_dir()
                .parent()
                .unwrap_or(Path::new("."))
                .to_path_buf()
        })
        .join("NookDev")
        .join("bin")
        .join("nook-hook-dev.exe")
}

fn known_standalone_relay() -> PathBuf {
    standalone_relay_path()
}

fn ownership(agent: Agent, entry: &Value, command: Option<&str>, relay: Option<&str>) -> Ownership {
    let is_ours = match agent {
        Agent::ClaudeCode => command.map(hooks::command_is_ours).unwrap_or(false),
        Agent::Codex => codex_hooks::is_ours(entry),
    };
    if agent == Agent::ClaudeCode
        && command.is_some_and(|value| value.to_lowercase().contains(hooks::LEGACY_MARKER))
    {
        return Ownership::OriginalNook;
    }
    let Some(command) = command else {
        return Ownership::Unknown;
    };
    let command_lower = command.to_lowercase();
    let relay_normal = relay.map(normalized).unwrap_or_default();
    if relay_normal == normalized(&known_standalone_relay().to_string_lossy())
        || relay_normal.contains("\\nookstandalone\\")
    {
        return Ownership::StandaloneNook;
    }
    if relay_normal == normalized(&known_dev_relay().to_string_lossy())
        || relay_normal.contains("\\nookdev\\")
        || relay_normal.ends_with("nook-hook-dev.exe")
    {
        return Ownership::NookDev;
    }
    if relay_normal == normalized(&known_original_relay().to_string_lossy())
        || relay_normal.contains("\\nook\\bin\\nook-hook.exe")
        || relay_normal.ends_with("coucou-hook.exe")
        || relay_normal.ends_with("coucou-hook")
    {
        return Ownership::OriginalNook;
    }
    if is_ours || command_lower.contains("nook-hook") || command_lower.contains("coucou-hook") {
        return Ownership::Unknown;
    }
    Ownership::ThirdParty
}

pub(crate) fn classify_entry(agent: Agent, entry: &Value) -> Ownership {
    let command = command_of(entry);
    let relay = command.as_deref().and_then(relay_from_command);
    ownership(agent, entry, command.as_deref(), relay.as_deref())
}

fn push_record(
    out: &mut Vec<HookRecord>,
    candidate: &Candidate,
    config_path: &str,
    event: &str,
    entry: &Value,
) {
    let command = command_of(entry);
    let relay = command.as_deref().and_then(relay_from_command);
    let owner = ownership(candidate.agent, entry, command.as_deref(), relay.as_deref());
    let relay_exists = relay.as_ref().map(|path| relay_is_usable(Path::new(path)));
    out.push(HookRecord {
        agent: candidate.agent,
        scope: candidate.scope,
        config_path: config_path.to_owned(),
        event: event.to_owned(),
        ownership: owner,
        command,
        relay_path: relay,
        relay_exists,
    });
}

fn collect_hooks(candidate: &Candidate, path: &str, value: &Value, out: &mut Vec<HookRecord>) {
    let Some(hooks_value) = value.get("hooks") else {
        return;
    };
    let Some(events) = hooks_value.as_object() else {
        out.push(HookRecord {
            agent: candidate.agent,
            scope: candidate.scope,
            config_path: path.into(),
            event: "*".into(),
            ownership: Ownership::Unknown,
            command: None,
            relay_path: None,
            relay_exists: None,
        });
        return;
    };
    for (event, groups) in events {
        let Some(groups) = groups.as_array() else {
            out.push(HookRecord {
                agent: candidate.agent,
                scope: candidate.scope,
                config_path: path.into(),
                event: event.clone(),
                ownership: Ownership::Unknown,
                command: None,
                relay_path: None,
                relay_exists: None,
            });
            continue;
        };
        for group in groups {
            let Some(entries) = group.get("hooks").and_then(Value::as_array) else {
                out.push(HookRecord {
                    agent: candidate.agent,
                    scope: candidate.scope,
                    config_path: path.into(),
                    event: event.clone(),
                    ownership: Ownership::Unknown,
                    command: None,
                    relay_path: None,
                    relay_exists: None,
                });
                continue;
            };
            for entry in entries {
                push_record(out, candidate, path, event, entry);
            }
        }
    }
}

fn find_duplicates(hooks: &[HookRecord]) -> Vec<DuplicateEvent> {
    let mut groups: BTreeMap<(Agent, String, String), BTreeMap<String, (Scope, String)>> =
        BTreeMap::new();
    for hook in hooks {
        if !matches!(
            hook.ownership,
            Ownership::OriginalNook | Ownership::NookDev | Ownership::StandaloneNook
        ) {
            continue;
        }
        let Some(relay) = hook.relay_path.as_deref() else {
            continue;
        };
        groups
            .entry((hook.agent, hook.event.clone(), normalized(relay)))
            .or_default()
            .entry(hook.config_path.to_lowercase())
            .or_insert((hook.scope, hook.config_path.clone()));
    }
    groups
        .into_iter()
        .filter_map(|((agent, event, relay), configs)| {
            let scopes: BTreeSet<_> = configs.values().map(|(scope, _)| *scope as u8).collect();
            if scopes.len() < 2 {
                return None;
            }
            let mut values: Vec<_> = configs.into_values().collect();
            values.sort_by(|a, b| a.1.cmp(&b.1));
            Some(DuplicateEvent {
                agent,
                event,
                relay_path: relay.replace('\\', "/"),
                scopes: values.iter().map(|(scope, _)| *scope).collect(),
                config_paths: values.into_iter().map(|(_, path)| path).collect(),
            })
        })
        .collect()
}

pub fn scan(project_roots: &[String]) -> ConnectScan {
    let (candidates, issues) = candidates(project_roots);
    scan_candidates(candidates, issues)
}

pub fn scan_agent(project_roots: &[String], agent: Agent) -> ConnectScan {
    let (mut candidates, issues) = candidates(project_roots);
    candidates.retain(|candidate| candidate.agent == agent);
    scan_candidates(candidates, issues)
}

fn scan_candidates(candidates: Vec<Candidate>, mut issues: Vec<String>) -> ConnectScan {
    let mut configs = Vec::with_capacity(candidates.len());
    let mut hooks_found = Vec::new();
    for candidate in &candidates {
        let (config, value) = read_json(candidate);
        if let Some(value) = value.as_ref() {
            collect_hooks(candidate, &config.path, value, &mut hooks_found);
        }
        if config.status == ConfigStatus::Inaccessible || config.status == ConfigStatus::Malformed {
            if let Some(error) = &config.error {
                issues.push(error.clone());
            }
        }
        configs.push(config);
    }
    let duplicates = find_duplicates(&hooks_found);
    let agents = [Agent::ClaudeCode, Agent::Codex]
        .into_iter()
        .map(|agent| {
            let owned: Vec<_> = hooks_found
                .iter()
                .filter(|hook| hook.agent == agent && is_nook_ownership(hook.ownership))
                .collect();
            let configured = !owned.is_empty();
            let complete = match agent {
                Agent::ClaudeCode => hooks::HOOK_EVENTS
                    .iter()
                    .all(|(event, _)| owned.iter().any(|hook| hook.event == *event)),
                Agent::Codex => codex_hooks::EVENTS
                    .iter()
                    .all(|(event, _)| owned.iter().any(|hook| hook.event == *event)),
            };
            let relay_ready = owned.iter().all(|hook| hook.relay_exists == Some(true));
            let duplicate = duplicates.iter().any(|item| item.agent == agent);
            let needs_repair = configured && (!complete || !relay_ready || duplicate);
            AgentSummary {
                agent,
                configuration_status: if configured {
                    if needs_repair {
                        ConfigurationState::NeedsRepair
                    } else {
                        ConfigurationState::Configured
                    }
                } else {
                    ConfigurationState::NotConfigured
                },
                delivery_state: if configured {
                    DeliveryState::WaitingForActivity
                } else {
                    DeliveryState::NotConfigured
                },
                last_received_event: None,
                last_received_at_ms: None,
            }
        })
        .collect();
    let standalone_relay = standalone_relay_path();
    let standalone_relay_ready = relay_is_usable(&standalone_relay);
    ConnectScan {
        standalone_relay: standalone_relay.to_string_lossy().into(),
        standalone_relay_ready,
        detected_agents: [Agent::ClaudeCode, Agent::Codex]
            .into_iter()
            .filter(|agent| agent_cli_on_path(*agent))
            .collect(),
        configs,
        hooks: hooks_found,
        duplicates,
        agents,
        issues,
    }
}

fn agent_cli_on_path(agent: Agent) -> bool {
    let names: &[&str] = match agent {
        Agent::ClaudeCode => &["claude.exe", "claude.cmd", "claude.bat", "claude"],
        Agent::Codex => &["codex.exe", "codex.cmd", "codex.bat", "codex"],
    };
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .any(|directory| names.iter().any(|name| directory.join(name).is_file()))
}

fn standalone_relay_path() -> PathBuf {
    // In the Standalone binary, use the same path source as relay installation
    // and runtime metadata. This avoids reconstructing LOCALAPPDATA separately.
    #[cfg(feature = "nook-standalone")]
    {
        return crate::settings::hook_exe_path();
    }
    #[cfg(not(feature = "nook-standalone"))]
    {
        let base = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                crate::platform::local_dir()
                    .parent()
                    .map(PathBuf::from)
                    .unwrap_or_else(|| PathBuf::from("."))
            });
        connect_identity::relay_path(&base)
    }
}

fn relay_is_usable(path: &Path) -> bool {
    use std::io::{Read, Seek, SeekFrom};

    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() || metadata.len() < 128 {
        return false;
    }
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let mut dos = [0u8; 64];
    if file.read_exact(&mut dos).is_err() || &dos[..2] != b"MZ" {
        return false;
    }
    let pe_offset = u32::from_le_bytes(dos[0x3c..0x40].try_into().unwrap()) as u64;
    if pe_offset.saturating_add(24) > metadata.len()
        || file.seek(SeekFrom::Start(pe_offset)).is_err()
    {
        return false;
    }
    let mut header = [0u8; 24];
    if file.read_exact(&mut header).is_err() || &header[..4] != b"PE\0\0" {
        return false;
    }
    let machine = u16::from_le_bytes(header[4..6].try_into().unwrap());
    let sections = u16::from_le_bytes(header[6..8].try_into().unwrap()) as u64;
    let optional_size = u16::from_le_bytes(header[20..22].try_into().unwrap()) as u64;
    if !matches!(machine, 0x8664 | 0xaa64) || sections == 0 || optional_size < 20 {
        return false;
    }
    let optional_start = pe_offset + 24;
    let section_table = optional_start.saturating_add(optional_size);
    let table_end = section_table.saturating_add(sections.saturating_mul(40));
    if table_end > metadata.len() || file.seek(SeekFrom::Start(optional_start)).is_err() {
        return false;
    }
    let mut optional = [0u8; 20];
    if file.read_exact(&mut optional).is_err()
        || !matches!(
            u16::from_le_bytes(optional[..2].try_into().unwrap()),
            0x10b | 0x20b
        )
        || u32::from_le_bytes(optional[16..20].try_into().unwrap()) == 0
        || file.seek(SeekFrom::Start(section_table)).is_err()
    {
        return false;
    }
    let mut has_file_data = false;
    for _ in 0..sections {
        let mut section = [0u8; 40];
        if file.read_exact(&mut section).is_err() {
            return false;
        }
        let raw_size = u32::from_le_bytes(section[16..20].try_into().unwrap()) as u64;
        let raw_offset = u32::from_le_bytes(section[20..24].try_into().unwrap()) as u64;
        if raw_size > 0 {
            has_file_data = true;
            if raw_offset.saturating_add(raw_size) > metadata.len() {
                return false;
            }
        }
    }
    has_file_data
}

fn is_nook_ownership(owner: Ownership) -> bool {
    matches!(
        owner,
        Ownership::OriginalNook | Ownership::NookDev | Ownership::StandaloneNook
    )
}

/// Accepts only real relay hook payloads. The Dev simulator emits directly to
/// the webview and test fixtures use reserved IDs; neither is delivery proof.
pub fn real_delivery(payload: &Value, event: &str) -> Option<Agent> {
    if payload.get("nook_simulated").and_then(Value::as_bool) == Some(true)
        || payload.get("nook_test_deny_only").and_then(Value::as_bool) == Some(true)
    {
        return None;
    }
    let session = payload
        .get("session_id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    if session.starts_with("nook-sim:")
        || session.starts_with("nook-test:")
        || session.contains(":nook-test:")
    {
        return None;
    }
    let tool = payload
        .get("nook_tool")
        .and_then(Value::as_str)
        .or_else(|| payload.get("nook_agent").and_then(Value::as_str));
    let agent = match tool {
        Some("claude") => Agent::ClaudeCode,
        Some("codex") => Agent::Codex,
        None => Agent::ClaudeCode,
        Some(_) => return None,
    };
    let supported = match agent {
        Agent::ClaudeCode => hooks::HOOK_EVENTS.iter().any(|(known, _)| *known == event),
        Agent::Codex => codex_hooks::EVENTS.iter().any(|(known, _)| *known == event),
    };
    supported.then_some(agent)
}

pub fn record_real_delivery(tracker: &DeliveryTracker, payload: &Value, event: &str) {
    let Some(agent) = real_delivery(payload, event) else {
        return;
    };
    let at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|now| now.as_millis() as u64)
        .unwrap_or(0);
    tracker.observe(agent, event, at_ms);
}

/// Future event handling can attach real delivery observations without making
/// filesystem state masquerade as proof that a hook ran.
#[cfg(test)]
pub fn record_delivery(scan: &mut ConnectScan, agent: Agent, event: &str, at_ms: u64) {
    if let Some(summary) = scan
        .agents
        .iter_mut()
        .find(|summary| summary.agent == agent)
    {
        summary.delivery_state = DeliveryState::Receiving;
        summary.last_received_event = Some(event.to_owned());
        summary.last_received_at_ms = Some(at_ms);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture {
        root: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir()
                .join(format!("nook-connect-scan-{}-{nonce}", std::process::id()));
            fs::create_dir_all(&root).unwrap();
            Self { root }
        }
        fn write(&self, relative: &str, content: &str) -> PathBuf {
            let path = self.root.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, content).unwrap();
            path
        }
        fn snapshot(&self) -> BTreeMap<PathBuf, Vec<u8>> {
            fn walk(root: &Path, dir: &Path, files: &mut BTreeMap<PathBuf, Vec<u8>>) {
                for item in fs::read_dir(dir).unwrap() {
                    let item = item.unwrap();
                    let path = item.path();
                    if path.is_dir() {
                        walk(root, &path, files);
                    } else {
                        files.insert(
                            path.strip_prefix(root).unwrap().to_path_buf(),
                            fs::read(path).unwrap(),
                        );
                    }
                }
            }
            let mut files = BTreeMap::new();
            walk(&self.root, &self.root, &mut files);
            files
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn project_config_aliasing_user_config_is_scanned_once_with_user_scope() {
        let fixture = Fixture::new();
        let root = fixture.root.clone();
        let claude_user = root.join(".claude/settings.json");
        let codex_user = root.join(".codex/hooks.json");
        fs::create_dir_all(claude_user.parent().unwrap()).unwrap();
        fs::create_dir_all(codex_user.parent().unwrap()).unwrap();
        fs::write(
            &claude_user,
            br#"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"C:/NookStandalone/bin/nook-hook-standalone.exe Stop"}]}]}}"#,
        )
        .unwrap();
        fs::write(
            &codex_user,
            br#"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"C:/NookStandalone/bin/nook-hook-standalone.exe --agent codex"}]}]}}"#,
        )
        .unwrap();
        let before = fixture.snapshot();
        let (found, issues) = candidates_with_user_paths(
            &[root.to_string_lossy().into_owned()],
            claude_user.clone(),
            codex_user.clone(),
        );
        assert!(issues.is_empty());
        assert_eq!(
            found
                .iter()
                .filter(|c| c.path == claude_user)
                .map(|c| c.scope)
                .collect::<Vec<_>>(),
            vec![Scope::User]
        );
        assert_eq!(
            found
                .iter()
                .filter(|c| c.path == codex_user)
                .map(|c| c.scope)
                .collect::<Vec<_>>(),
            vec![Scope::User]
        );
        assert!(found.iter().any(|c| c.scope == Scope::ProjectLocal));
        let scan = scan_candidates(found, issues);
        assert_eq!(scan.configs.len(), 3);
        assert_eq!(scan.hooks.len(), 2);
        assert!(scan.hooks.iter().all(|hook| hook.scope == Scope::User));
        assert_eq!(fixture.snapshot(), before);
    }

    fn candidate(path: &Path, agent: Agent, scope: Scope) -> Candidate {
        Candidate {
            agent,
            scope,
            path: path.to_path_buf(),
        }
    }

    #[test]
    fn relay_readiness_is_rechecked_and_rejects_missing_or_empty_files() {
        let fixture = Fixture::new();
        let relay = fixture
            .root
            .join("NookStandalone/bin/nook-hook-standalone.exe");
        fs::create_dir_all(relay.parent().unwrap()).unwrap();
        assert!(!relay_is_usable(&relay));
        fs::write(&relay, valid_pe_fixture()).unwrap();
        assert!(relay_is_usable(&relay));
        fs::write(&relay, b"not a valid executable").unwrap();
        assert!(!relay_is_usable(&relay));
        fs::remove_file(&relay).unwrap();
        assert!(!relay_is_usable(&relay));
    }

    fn valid_pe_fixture() -> Vec<u8> {
        let mut bytes = vec![0u8; 0x200];
        bytes[..2].copy_from_slice(b"MZ");
        bytes[0x3c..0x40].copy_from_slice(&0x80u32.to_le_bytes());
        bytes[0x80..0x84].copy_from_slice(b"PE\0\0");
        bytes[0x84..0x86].copy_from_slice(&0x8664u16.to_le_bytes());
        bytes[0x86..0x88].copy_from_slice(&1u16.to_le_bytes());
        bytes[0x94..0x96].copy_from_slice(&20u16.to_le_bytes());
        bytes[0x98..0x9a].copy_from_slice(&0x20bu16.to_le_bytes());
        bytes[0xa8..0xac].copy_from_slice(&1u32.to_le_bytes());
        bytes[0xbc..0xc0].copy_from_slice(&0x100u32.to_le_bytes());
        bytes[0xc0..0xc4].copy_from_slice(&0x100u32.to_le_bytes());
        bytes[0xb4..0xb8].copy_from_slice(&0x100u32.to_le_bytes());
        bytes
    }

    #[cfg(feature = "nook-standalone")]
    #[test]
    fn standalone_scanner_uses_the_runtime_relay_path() {
        assert_eq!(standalone_relay_path(), crate::settings::hook_exe_path());
    }
    fn collect(path: &Path, agent: Agent) -> (ConfigFile, Vec<HookRecord>) {
        let c = candidate(path, agent, Scope::Project);
        let (file, value) = read_json(&c);
        let mut found = Vec::new();
        if let Some(value) = value {
            collect_hooks(&c, &file.path, &value, &mut found);
        }
        (file, found)
    }

    #[test]
    fn empty_missing_and_project_scopes_are_read_only() {
        let fixture = Fixture::new();
        let root = fixture.root.join("project");
        let path = fixture.write("project/.claude/settings.json", r#"{"hooks":{}}"#);
        let before = fixture.snapshot();
        let (missing, records) = collect(&root.join(".codex/hooks.json"), Agent::Codex);
        let (readable, empty_records) = collect(&path, Agent::ClaudeCode);
        assert_eq!(missing.status, ConfigStatus::Missing);
        assert!(records.is_empty());
        assert_eq!(readable.status, ConfigStatus::Readable);
        assert!(empty_records.is_empty());
        assert_eq!(fixture.snapshot(), before);
    }

    #[test]
    fn scanner_fingerprints_are_refreshed_for_changed_and_missing_files() {
        let fixture = Fixture::new();
        let path = fixture.write("project/.claude/settings.json", r#"{"hooks":{}}"#);
        let first = read_json(&candidate(&path, Agent::ClaudeCode, Scope::Project)).0;
        fs::write(&path, r#"{"hooks":{"Stop":[]}}"#).unwrap();
        let second = read_json(&candidate(&path, Agent::ClaudeCode, Scope::Project)).0;
        assert_ne!(first.fingerprint, second.fingerprint);
        fs::remove_file(&path).unwrap();
        let missing = read_json(&candidate(&path, Agent::ClaudeCode, Scope::Project)).0;
        assert_eq!(missing.status, ConfigStatus::Missing);
        let empty_fingerprint = hooks::fingerprint(b"");
        assert_eq!(
            missing.fingerprint.as_deref(),
            Some(empty_fingerprint.as_str())
        );
    }

    #[test]
    fn identifies_original_dev_standalone_third_party_and_unknown() {
        let old = json!({"command":"C:/Users/test/AppData/Local/Nook/bin/nook-hook.exe"});
        let dev = json!({"command":"C:/Users/test/AppData/Local/NookDev/bin/nook-hook-dev.exe --agent codex"});
        let standalone = json!({"command":"C:/Users/test/AppData/Local/NookStandalone/bin/nook-hook-standalone.exe"});
        let third = json!({"command":"third-party-hook --event"});
        let unknown = json!({"command":"C:/tools/nook-hook.exe --agent codex"});
        let unknown_standalone =
            json!({"command":"C:/tools/nook-hook-standalone.exe --agent codex"});
        let codex_hook = |command: &str| json!({"command":command,"type":"command"});
        assert_eq!(
            ownership(
                Agent::ClaudeCode,
                &json!({"hooks":[old]}),
                Some("C:/Users/test/AppData/Local/Nook/bin/nook-hook.exe"),
                Some("C:/Users/test/AppData/Local/Nook/bin/nook-hook.exe")
            ),
            Ownership::OriginalNook
        );
        assert_eq!(
            ownership(
                Agent::Codex,
                &codex_hook(dev["command"].as_str().unwrap()),
                dev["command"].as_str(),
                Some("C:/Users/test/AppData/Local/NookDev/bin/nook-hook-dev.exe")
            ),
            Ownership::NookDev
        );
        assert_eq!(
            ownership(
                Agent::Codex,
                &codex_hook(standalone["command"].as_str().unwrap()),
                standalone["command"].as_str(),
                Some("C:/Users/test/AppData/Local/NookStandalone/bin/nook-hook-standalone.exe")
            ),
            Ownership::StandaloneNook
        );
        assert_eq!(
            ownership(
                Agent::Codex,
                &codex_hook(third["command"].as_str().unwrap()),
                third["command"].as_str(),
                Some("third-party-hook")
            ),
            Ownership::ThirdParty
        );
        assert_eq!(
            ownership(
                Agent::Codex,
                &codex_hook(unknown["command"].as_str().unwrap()),
                unknown["command"].as_str(),
                Some("C:/tools/nook-hook.exe")
            ),
            Ownership::Unknown
        );
        assert_eq!(
            ownership(
                Agent::Codex,
                &codex_hook(unknown_standalone["command"].as_str().unwrap()),
                unknown_standalone["command"].as_str(),
                Some("C:/tools/nook-hook-standalone.exe")
            ),
            Ownership::Unknown
        );
    }

    #[test]
    fn detects_only_same_relay_event_duplicates_across_scopes() {
        let fixture = Fixture::new();
        let relay = fixture.root.join("relay/nook-hook.exe");
        fs::create_dir_all(relay.parent().unwrap()).unwrap();
        fs::write(&relay, b"fixture relay").unwrap();
        let relay = relay.to_string_lossy().replace('\\', "/");
        let make = |scope, path: &str, command: &str| HookRecord {
            agent: Agent::Codex,
            scope,
            config_path: path.into(),
            event: "Stop".into(),
            ownership: Ownership::OriginalNook,
            command: Some(command.into()),
            relay_path: Some(relay.clone()),
            relay_exists: Some(true),
        };
        let hooks = vec![
            make(Scope::User, "global/hooks.json", &relay),
            make(Scope::Project, "project/.codex/hooks.json", &relay),
            make(Scope::Project, "project/.codex/hooks.json", "other-hook"),
        ];
        let duplicates = find_duplicates(&hooks);
        assert_eq!(duplicates.len(), 1);
        assert_eq!(duplicates[0].scopes.len(), 2);
        assert_eq!(hooks[0].relay_exists, Some(true));
    }

    #[test]
    fn scans_global_and_project_fixtures_for_both_agents_without_writing() {
        let fixture = Fixture::new();
        let original = "C:/Users/test/AppData/Local/Nook/bin/nook-hook.exe";
        let dev = "C:/Users/test/AppData/Local/NookDev/bin/nook-hook-dev.exe";
        let claude_json = serde_json::to_string(&json!({"hooks":{"Stop":[{"hooks":[{"type":"command","command":original,"args":["Stop"]},{"type":"command","command":"third-party-hook run"}]}]}})).unwrap();
        let codex_original = serde_json::to_string(&json!({"hooks":{"Stop":[{"hooks":[{"type":"command","command":format!("{original} --agent codex")}]}]}})).unwrap();
        let codex_dev = serde_json::to_string(&json!({"hooks":{"Stop":[{"hooks":[{"type":"command","command":format!("{dev} --agent codex")}]}]}})).unwrap();
        let claude_global = fixture.write("global/claude/settings.json", &claude_json);
        let claude_project = fixture.write("work/.claude/settings.json", &claude_json);
        let codex_global = fixture.write("global/codex/hooks.json", &codex_original);
        let codex_project = fixture.write("work/.codex/hooks.json", &codex_dev);
        let before = fixture.snapshot();
        let result = scan_candidates(
            vec![
                candidate(&claude_global, Agent::ClaudeCode, Scope::User),
                candidate(&claude_project, Agent::ClaudeCode, Scope::Project),
                candidate(&codex_global, Agent::Codex, Scope::User),
                candidate(&codex_project, Agent::Codex, Scope::Project),
            ],
            vec![],
        );
        assert_eq!(
            result
                .hooks
                .iter()
                .filter(|hook| hook.ownership == Ownership::ThirdParty)
                .count(),
            2
        );
        assert_eq!(
            result
                .hooks
                .iter()
                .filter(|hook| hook.ownership == Ownership::NookDev)
                .count(),
            1
        );
        assert_eq!(
            result
                .duplicates
                .iter()
                .filter(
                    |duplicate| duplicate.agent == Agent::ClaudeCode && duplicate.event == "Stop"
                )
                .count(),
            1
        );
        assert_eq!(
            result
                .agents
                .iter()
                .filter(|summary| summary.configuration_status == ConfigurationState::NeedsRepair)
                .count(),
            2
        );
        assert!(result.agents.iter().all(|summary| summary.delivery_state
            == DeliveryState::WaitingForActivity
            && summary.last_received_event.is_none()));
        assert_eq!(fixture.snapshot(), before);
    }

    #[test]
    fn malformed_and_unknown_entries_are_reported_without_rewriting_files() {
        let fixture = Fixture::new();
        let malformed = fixture.write("project/.claude/settings.json", "{not json");
        let unknown = fixture.write(
            "project/.codex/hooks.json",
            r#"{"hooks":{"Stop":[{"matcher":"*","hooks":[{"type":"command"}]}]}}"#,
        );
        let before = fixture.snapshot();
        let (bad_file, bad_hooks) = collect(&malformed, Agent::ClaudeCode);
        let (unknown_file, unknown_hooks) = collect(&unknown, Agent::Codex);
        assert_eq!(bad_file.status, ConfigStatus::Malformed);
        assert!(bad_hooks.is_empty());
        assert_eq!(unknown_file.status, ConfigStatus::Readable);
        assert_eq!(unknown_hooks[0].ownership, Ownership::Unknown);
        assert_eq!(fixture.snapshot(), before);
    }

    #[test]
    fn unreadable_configuration_is_reported_as_inaccessible_without_changes() {
        let fixture = Fixture::new();
        let directory_instead_of_file = fixture.root.join("project/.codex/hooks.json");
        fs::create_dir_all(&directory_instead_of_file).unwrap();
        let before = fixture.snapshot();
        let (file, hooks) = collect(&directory_instead_of_file, Agent::Codex);
        assert_eq!(file.status, ConfigStatus::Inaccessible);
        assert!(file.error.is_some());
        assert!(hooks.is_empty());
        assert_eq!(fixture.snapshot(), before);
    }

    #[test]
    fn delivery_requires_a_real_supported_hook_and_records_last_event() {
        assert_eq!(
            real_delivery(
                &json!({"nook_tool":"codex","session_id":"codex:real"}),
                "Stop"
            ),
            Some(Agent::Codex)
        );
        assert_eq!(
            real_delivery(&json!({"nook_tool":"codex","nook_simulated":true}), "Stop"),
            None
        );
        assert_eq!(
            real_delivery(
                &json!({"nook_tool":"claude","session_id":"nook-test:case"}),
                "Stop"
            ),
            None
        );
        assert_eq!(
            real_delivery(&json!({"nook_tool":"codex"}), "NotAnEvent"),
            None
        );
        let tracker = DeliveryTracker::default();
        tracker.observe(Agent::Codex, "Stop", 1234);
        let mut result = ConnectScan {
            standalone_relay: String::new(),
            standalone_relay_ready: false,
            detected_agents: vec![],
            configs: vec![],
            hooks: vec![],
            duplicates: vec![],
            agents: vec![AgentSummary {
                agent: Agent::Codex,
                configuration_status: ConfigurationState::Configured,
                delivery_state: DeliveryState::WaitingForActivity,
                last_received_event: None,
                last_received_at_ms: None,
            }],
            issues: vec![],
        };
        tracker.attach(&mut result);
        assert_eq!(result.agents[0].delivery_state, DeliveryState::Receiving);
        assert_eq!(
            result.agents[0].last_received_event.as_deref(),
            Some("Stop")
        );
        assert_eq!(result.agents[0].last_received_at_ms, Some(1234));
    }

    #[test]
    fn missing_relay_and_simultaneous_agents_are_distinct_and_delivery_is_not_assumed() {
        let fixture = Fixture::new();
        let claude_path = fixture.write("claude/settings.json", r#"{"hooks":{"Stop":[{"hooks":[{"command":"C:/missing/Nook/bin/nook-hook.exe","args":["Stop"]}]}]}}"#);
        let codex_path = fixture.write("codex/hooks.json", r#"{"hooks":{"Stop":[{"hooks":[{"command":"C:/missing/Nook/bin/nook-hook.exe --agent codex"}]}]}}"#);
        let (_, mut found) = collect(&claude_path, Agent::ClaudeCode);
        let (_, codex_found) = collect(&codex_path, Agent::Codex);
        found.extend(codex_found);
        assert_eq!(found.len(), 2);
        assert!(found.iter().all(|hook| hook.relay_exists == Some(false)));
        let mut result = ConnectScan {
            standalone_relay: String::new(),
            standalone_relay_ready: false,
            detected_agents: vec![],
            configs: vec![],
            duplicates: find_duplicates(&found),
            hooks: found,
            agents: vec![
                AgentSummary {
                    agent: Agent::ClaudeCode,
                    configuration_status: ConfigurationState::Configured,
                    delivery_state: DeliveryState::WaitingForActivity,
                    last_received_event: None,
                    last_received_at_ms: None,
                },
                AgentSummary {
                    agent: Agent::Codex,
                    configuration_status: ConfigurationState::Configured,
                    delivery_state: DeliveryState::WaitingForActivity,
                    last_received_event: None,
                    last_received_at_ms: None,
                },
            ],
            issues: vec![],
        };
        record_delivery(&mut result, Agent::Codex, "Stop", 1234);
        assert_eq!(
            result.agents[0].delivery_state,
            DeliveryState::WaitingForActivity
        );
        assert_eq!(result.agents[1].delivery_state, DeliveryState::Receiving);
        assert_eq!(
            result.agents[1].last_received_event.as_deref(),
            Some("Stop")
        );
    }
}
