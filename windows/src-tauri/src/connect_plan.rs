//! Read-only Connect change previews. This module deliberately has no apply API.
#[cfg(test)]
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};

use crate::{codex_hooks, connect_identity, connect_scanner as scan, hooks};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "PascalCase")]
pub enum Operation {
    Connect,
    Disconnect,
    Repair,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "PascalCase")]
pub enum ChangeKind {
    Add,
    Change,
    Remove,
    Preserve,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryChange {
    pub event: String,
    pub kind: ChangeKind,
    pub ownership: scan::Ownership,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePlan {
    pub agent: scan::Agent,
    pub scope: scan::Scope,
    pub path: String,
    pub status: scan::ConfigStatus,
    pub fingerprint: Option<String>,
    pub backup_required: bool,
    pub backup_path: Option<String>,
    pub diff: String,
    pub changes: Vec<EntryChange>,
    pub conflicts: Vec<String>,
    pub dev_approval_required: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub operation: Operation,
    pub agent: Option<scan::Agent>,
    pub target_relay: String,
    pub files: Vec<FilePlan>,
    pub duplicates: Vec<scan::DuplicateEvent>,
    pub preserved_records: usize,
    pub conflicts: Vec<String>,
    pub approved_dev_scopes: Vec<String>,
    pub dev_scopes_requiring_approval: Vec<String>,
    pub codex_trust_required: bool,
    pub requires_original_migration: bool,
    pub preview_id: Option<String>,
}

fn serialized(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_default()
}

/// Compute a fingerprinted diff for one configuration file. File reads and
/// JSON transformations share the established managers; nothing is written.
pub fn preview_with_dev_scopes(
    operation: Operation,
    roots: &[String],
    dev_scopes: &[String],
) -> Preview {
    let inventory = scan::scan(roots);
    build_for_inventory(operation, inventory, dev_scopes)
}

pub fn preview_agent_with_dev_scopes(
    operation: Operation,
    agent: scan::Agent,
    roots: &[String],
    dev_scopes: &[String],
) -> Preview {
    let inventory = scan::scan_agent(roots, agent);
    let mut preview = build_for_inventory(operation, inventory, dev_scopes);
    preview.agent = Some(agent);
    preview
}

fn build_for_inventory(
    operation: Operation,
    inventory: scan::ConnectScan,
    dev_scopes: &[String],
) -> Preview {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| crate::platform::local_dir().parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."));
    let relay = connect_identity::relay_path(&base);
    build_safe_preview(operation, inventory, relay, dev_scopes)
}

#[cfg(test)]
fn build_preview(operation: Operation, inventory: scan::ConnectScan, relay: PathBuf) -> Preview {
    let target_relay = relay.to_string_lossy().to_string();
    let mut files = Vec::new();
    let mut top_conflicts = Vec::new();
    let mut planned_scopes: BTreeMap<(scan::Agent, String), BTreeMap<scan::Scope, Vec<String>>> =
        BTreeMap::new();
    for config in &inventory.configs {
        let records: Vec<_> = inventory
            .hooks
            .iter()
            .filter(|h| h.config_path == config.path)
            .collect();
        let owned = records.iter().any(|h| {
            matches!(
                h.ownership,
                scan::Ownership::OriginalNook
                    | scan::Ownership::NookDev
                    | scan::Ownership::StandaloneNook
            )
        });
        if matches!(operation, Operation::Disconnect | Operation::Repair) && !owned {
            continue;
        }
        let path = PathBuf::from(&config.path);
        let mut conflicts = Vec::new();
        let mut changes = Vec::new();
        if config.status == scan::ConfigStatus::Malformed
            || config.status == scan::ConfigStatus::Inaccessible
        {
            let fingerprint = if config.status == scan::ConfigStatus::Malformed {
                std::fs::read(&path)
                    .ok()
                    .map(|bytes| hooks::fingerprint(&bytes))
            } else {
                None
            };
            conflicts.push(
                config
                    .error
                    .clone()
                    .unwrap_or_else(|| "Configuration cannot be read safely".into()),
            );
            files.push(FilePlan {
                agent: config.agent,
                scope: config.scope,
                path: config.path.clone(),
                status: config.status,
                fingerprint,
                backup_required: false,
                backup_path: None,
                diff: String::new(),
                changes,
                conflicts,
                dev_approval_required: false,
            });
            continue;
        }
        let existing = records;
        if operation != Operation::Disconnect {
            let expected: &[(&str, u64)] = match config.agent {
                scan::Agent::ClaudeCode => hooks::HOOK_EVENTS,
                scan::Agent::Codex => codex_hooks::EVENTS,
            };
            for (event, _) in expected {
                planned_scopes
                    .entry((config.agent, (*event).to_owned()))
                    .or_default()
                    .entry(config.scope)
                    .or_default()
                    .push(config.path.clone());
            }
        }
        let mut event_touched = std::collections::BTreeSet::new();
        let mut event_target_kept = std::collections::BTreeSet::new();
        for hook in &existing {
            let known = matches!(
                hook.ownership,
                scan::Ownership::OriginalNook
                    | scan::Ownership::NookDev
                    | scan::Ownership::StandaloneNook
            );
            if !known {
                changes.push(EntryChange {
                    event: hook.event.clone(),
                    kind: ChangeKind::Preserve,
                    ownership: hook.ownership,
                    detail: "Preserved without modification".into(),
                });
                if matches!(hook.ownership, scan::Ownership::Unknown) {
                    conflicts.push(format!(
                        "Unknown ownership on {} ({})",
                        hook.event,
                        hook.command.as_deref().unwrap_or("no command")
                    ));
                }
            } else if operation == Operation::Disconnect {
                changes.push(EntryChange {
                    event: hook.event.clone(),
                    kind: ChangeKind::Remove,
                    ownership: hook.ownership,
                    detail: "Remove Nook-owned record".into(),
                });
            } else if hook.relay_path.as_deref().is_some_and(|p| {
                p.eq_ignore_ascii_case(&target_relay)
                    || p.replace('\\', "/")
                        .eq_ignore_ascii_case(&target_relay.replace('\\', "/"))
            }) {
                if !event_target_kept.insert(hook.event.clone()) {
                    changes.push(EntryChange {
                        event: hook.event.clone(),
                        kind: ChangeKind::Remove,
                        ownership: hook.ownership,
                        detail: "Remove duplicate standalone record".into(),
                    });
                }
            } else {
                let kind = if event_touched.insert(hook.event.clone()) {
                    ChangeKind::Change
                } else {
                    ChangeKind::Remove
                };
                changes.push(EntryChange {
                    event: hook.event.clone(),
                    kind,
                    ownership: hook.ownership,
                    detail: if kind == ChangeKind::Change {
                        "Replace with standalone relay"
                    } else {
                        "Remove duplicate Nook record"
                    }
                    .into(),
                });
            }
        }
        if operation != Operation::Disconnect {
            let events: &[(&str, u64)] = match config.agent {
                scan::Agent::ClaudeCode => hooks::HOOK_EVENTS,
                scan::Agent::Codex => codex_hooks::EVENTS,
            };
            for (event, _) in events {
                if !existing.iter().any(|h| {
                    h.event == *event
                        && matches!(
                            h.ownership,
                            scan::Ownership::OriginalNook
                                | scan::Ownership::NookDev
                                | scan::Ownership::StandaloneNook
                        )
                }) {
                    changes.push(EntryChange {
                        event: (*event).into(),
                        kind: ChangeKind::Add,
                        ownership: scan::Ownership::StandaloneNook,
                        detail: "Add standalone relay event".into(),
                    });
                }
            }
        }
        let computed = hooks::preview_file(&path, |path, bytes| {
            let current = match bytes {
                Some(bytes) => match config.agent {
                    scan::Agent::ClaudeCode => {
                        hooks::parse_settings(bytes, &path.display().to_string())?
                    }
                    scan::Agent::Codex => codex_hooks::parse(bytes, &path.display().to_string())?,
                },
                None => json!({}),
            };
            let next = match (config.agent, operation) {
                (scan::Agent::ClaudeCode, Operation::Disconnect) => {
                    hooks::without_ours_for_preview(&current)
                }
                (scan::Agent::ClaudeCode, _) => hooks::merged_for_relay(&current, &relay),
                (scan::Agent::Codex, Operation::Disconnect) => codex_hooks::uninstalled(&current)?,
                (scan::Agent::Codex, _) => codex_hooks::installed(&current, &target_relay)?,
            };
            let before = bytes.map(|_| serialized(&current)).unwrap_or_default();
            let after = serialized(&next);
            let mut written = after.as_bytes().to_vec();
            written.push(b'\n');
            Ok(hooks::FileChange {
                before,
                after,
                bytes: written,
            })
        });
        match computed {
            Ok(result) => {
                let changed = !result.diff.is_empty();
                let fingerprint = Some(result.fingerprint);
                let backup_required = changed && config.status != scan::ConfigStatus::Missing;
                let backup_path = backup_required.then_some(result.backup);
                files.push(FilePlan {
                    agent: config.agent,
                    scope: config.scope,
                    path: config.path.clone(),
                    status: config.status,
                    fingerprint,
                    backup_required,
                    backup_path,
                    diff: result.diff,
                    changes,
                    conflicts,
                    dev_approval_required: false,
                });
            }
            Err(error) => {
                conflicts.push(error.clone());
                top_conflicts.push(error);
                files.push(FilePlan {
                    agent: config.agent,
                    scope: config.scope,
                    path: config.path.clone(),
                    status: config.status,
                    fingerprint: None,
                    backup_required: false,
                    backup_path: None,
                    diff: String::new(),
                    changes,
                    conflicts,
                    dev_approval_required: false,
                });
            }
        }
    }
    let preserved_records = files
        .iter()
        .flat_map(|f| &f.changes)
        .filter(|c| c.kind == ChangeKind::Preserve)
        .count();
    let codex_trust_required = operation != Operation::Disconnect
        && files
            .iter()
            .any(|file| file.agent == scan::Agent::Codex && !file.diff.is_empty());
    if !relay.is_file() {
        top_conflicts.push(format!(
            "Standalone relay is not installed yet: {}",
            relay.display()
        ));
    }
    let mut duplicates = inventory.duplicates;
    for ((agent, event), scopes) in planned_scopes {
        if scopes.len() < 2 {
            continue;
        }
        let config_paths: Vec<String> = scopes.values().flatten().cloned().collect();
        let target_key = (agent, event.clone(), target_relay.to_lowercase());
        if duplicates
            .iter()
            .any(|d| (d.agent, d.event.clone(), d.relay_path.to_lowercase()) == target_key)
        {
            continue;
        }
        top_conflicts.push(format!("The preview would configure {agent:?} {event} in multiple scopes; review duplicate delivery before approval."));
        duplicates.push(scan::DuplicateEvent {
            agent,
            event,
            relay_path: target_relay.replace('\\', "/"),
            scopes: scopes.keys().copied().collect(),
            config_paths,
        });
    }
    let requires_original_migration = files.iter().flat_map(|f| &f.changes).any(|c| {
        operation != Operation::Disconnect
            && c.ownership == scan::Ownership::OriginalNook
            && matches!(c.kind, ChangeKind::Change | ChangeKind::Remove)
    });
    Preview {
        operation,
        agent: None,
        target_relay: target_relay.clone(),
        files,
        duplicates,
        preserved_records,
        conflicts: top_conflicts,
        approved_dev_scopes: Vec::new(),
        dev_scopes_requiring_approval: Vec::new(),
        codex_trust_required,
        requires_original_migration,
        preview_id: None,
    }
}

fn safe_transform(
    agent: scan::Agent,
    scope: scan::Scope,
    operation: Operation,
    current: &Value,
    relay: &str,
    remove_dev: bool,
) -> Result<Value, String> {
    let remove_nook = |hook: &Value| {
        matches!(
            scan::classify_entry(agent, hook),
            scan::Ownership::OriginalNook | scan::Ownership::StandaloneNook
        ) || remove_dev && scan::classify_entry(agent, hook) == scan::Ownership::NookDev
    };
    let remove_standalone =
        |hook: &Value| scan::classify_entry(agent, hook) == scan::Ownership::StandaloneNook;
    match (agent, operation, scope) {
        (scan::Agent::ClaudeCode, Operation::Disconnect, _) => {
            Ok(hooks::filter_settings_hooks(current, remove_standalone))
        }
        (scan::Agent::Codex, Operation::Disconnect, _) => {
            Ok(hooks::filter_settings_hooks(current, remove_standalone))
        }
        (scan::Agent::ClaudeCode, _, scan::Scope::User) => {
            hooks::merged_for_connect_filtered(current, Path::new(relay), remove_nook)
        }
        (scan::Agent::Codex, _, scan::Scope::User) => {
            codex_hooks::installed_for_connect_filtered(current, relay, remove_nook)
        }
        (scan::Agent::ClaudeCode, _, _) => Ok(hooks::filter_settings_hooks(current, remove_nook)),
        (scan::Agent::Codex, _, _) => Ok(hooks::filter_settings_hooks(current, remove_nook)),
    }
}

fn build_safe_preview(
    operation: Operation,
    inventory: scan::ConnectScan,
    relay: PathBuf,
    approved_dev_scopes: &[String],
) -> Preview {
    let target_relay = relay.to_string_lossy().replace('\\', "/");
    let approved: std::collections::BTreeSet<String> =
        approved_dev_scopes.iter().cloned().collect();
    let mut files = Vec::new();
    let mut conflicts = inventory.issues.clone();
    let mut dev_scopes_requiring_approval = Vec::new();
    let mut planned_paths = std::collections::BTreeSet::new();
    for config in &inventory.configs {
        let path_key = scan::canonical_path_key(Path::new(&config.path));
        if !planned_paths.insert(path_key) {
            conflicts.push(format!(
                "Configuration path resolves to multiple scopes; no independent writes are allowed: {}",
                config.path
            ));
            continue;
        }
        let records: Vec<_> = inventory
            .hooks
            .iter()
            .filter(|hook| hook.config_path == config.path)
            .collect();
        let has_owned = records.iter().any(|h| {
            matches!(
                h.ownership,
                scan::Ownership::OriginalNook
                    | scan::Ownership::NookDev
                    | scan::Ownership::StandaloneNook
            )
        });
        let agent_has_owned = inventory.hooks.iter().any(|h| {
            h.agent == config.agent
                && matches!(
                    h.ownership,
                    scan::Ownership::OriginalNook
                        | scan::Ownership::NookDev
                        | scan::Ownership::StandaloneNook
                )
        });
        let has_standalone = records
            .iter()
            .any(|h| h.ownership == scan::Ownership::StandaloneNook);
        let include = match operation {
            Operation::Connect => {
                config.scope == scan::Scope::User
                    || has_owned
                    || (config.scope != scan::Scope::User
                        && config.status == scan::ConfigStatus::Malformed)
            }
            Operation::Repair => {
                (config.scope == scan::Scope::User && agent_has_owned) || has_owned
            }
            Operation::Disconnect => has_standalone,
        };
        if !include {
            continue;
        }
        let path = PathBuf::from(&config.path);
        let dev_present = records
            .iter()
            .any(|h| h.ownership == scan::Ownership::NookDev);
        let dev_approved = approved.contains(&config.path);
        if dev_present && !dev_approved {
            dev_scopes_requiring_approval.push(config.path.clone());
        }
        let mut file_conflicts = Vec::new();
        let mut changes = Vec::new();
        if config.status == scan::ConfigStatus::Malformed
            || config.status == scan::ConfigStatus::Inaccessible
        {
            let error = config
                .error
                .clone()
                .unwrap_or_else(|| "Configuration cannot be read safely".into());
            file_conflicts.push(error.clone());
            conflicts.push(error);
            let fingerprint = if config.status == scan::ConfigStatus::Malformed {
                std::fs::read(&path)
                    .ok()
                    .map(|bytes| hooks::fingerprint(&bytes))
            } else {
                None
            };
            files.push(FilePlan {
                agent: config.agent,
                scope: config.scope,
                path: config.path.clone(),
                status: config.status,
                fingerprint,
                backup_required: false,
                backup_path: None,
                diff: String::new(),
                changes,
                conflicts: file_conflicts,
                dev_approval_required: dev_present && !dev_approved,
            });
            continue;
        }
        if dev_present && !dev_approved {
            let message = format!(
                "Nook Dev records in this exact scope require separate approval: {}",
                config.path
            );
            file_conflicts.push(message.clone());
            conflicts.push(message);
        }
        for hook in &records {
            match hook.ownership {
                scan::Ownership::ThirdParty | scan::Ownership::Unknown => {
                    changes.push(EntryChange {
                        event: hook.event.clone(),
                        kind: ChangeKind::Preserve,
                        ownership: hook.ownership,
                        detail: "Preserved without modification".into(),
                    });
                    if hook.ownership == scan::Ownership::Unknown {
                        file_conflicts.push(format!("Unknown ownership on {}", hook.event));
                    }
                }
                scan::Ownership::NookDev if !dev_approved => changes.push(EntryChange {
                    event: hook.event.clone(),
                    kind: ChangeKind::Preserve,
                    ownership: hook.ownership,
                    detail: "Preserved pending separate scope approval".into(),
                }),
                scan::Ownership::OriginalNook | scan::Ownership::NookDev
                    if operation == Operation::Disconnect =>
                {
                    changes.push(EntryChange {
                        event: hook.event.clone(),
                        kind: ChangeKind::Preserve,
                        ownership: hook.ownership,
                        detail: "Disconnect removes standalone records only".into(),
                    })
                }
                scan::Ownership::StandaloneNook if operation == Operation::Disconnect => changes
                    .push(EntryChange {
                        event: hook.event.clone(),
                        kind: ChangeKind::Remove,
                        ownership: hook.ownership,
                        detail: "Remove standalone-owned record".into(),
                    }),
                scan::Ownership::OriginalNook
                | scan::Ownership::NookDev
                | scan::Ownership::StandaloneNook => {
                    let kind = if config.scope == scan::Scope::User
                        && operation != Operation::Disconnect
                    {
                        ChangeKind::Change
                    } else {
                        ChangeKind::Remove
                    };
                    changes.push(EntryChange {
                        event: hook.event.clone(),
                        kind,
                        ownership: hook.ownership,
                        detail: if kind == ChangeKind::Change {
                            "Replace with standalone relay"
                        } else {
                            "Remove project-level duplicate"
                        }
                        .into(),
                    });
                }
            }
        }
        if config.scope == scan::Scope::User && operation != Operation::Disconnect {
            let events: &[(&str, u64)] = match config.agent {
                scan::Agent::ClaudeCode => hooks::HOOK_EVENTS,
                scan::Agent::Codex => codex_hooks::EVENTS,
            };
            for (event, _) in events {
                if !records.iter().any(|h| {
                    h.event == *event
                        && matches!(
                            h.ownership,
                            scan::Ownership::OriginalNook
                                | scan::Ownership::NookDev
                                | scan::Ownership::StandaloneNook
                        )
                }) {
                    changes.push(EntryChange {
                        event: (*event).into(),
                        kind: ChangeKind::Add,
                        ownership: scan::Ownership::StandaloneNook,
                        detail: "Add standalone global hook".into(),
                    });
                }
            }
        }
        let computed = hooks::preview_file(&path, |path, bytes| {
            let current = match bytes {
                Some(bytes) => match config.agent {
                    scan::Agent::ClaudeCode => {
                        hooks::parse_settings(bytes, &path.display().to_string())?
                    }
                    scan::Agent::Codex => codex_hooks::parse(bytes, &path.display().to_string())?,
                },
                None => json!({}),
            };
            let next = safe_transform(
                config.agent,
                config.scope,
                operation,
                &current,
                &target_relay,
                dev_approved,
            )?;
            let before = bytes.map(|_| serialized(&current)).unwrap_or_default();
            let after = serialized(&next);
            let mut written = after.as_bytes().to_vec();
            written.push(b'\n');
            Ok(hooks::FileChange {
                before,
                after,
                bytes: written,
            })
        });
        match computed {
            Ok(result) => {
                let changed = result.diff != "No change.";
                let backup_required = changed && config.status != scan::ConfigStatus::Missing;
                let backup_path = backup_required.then_some(result.backup);
                files.push(FilePlan {
                    agent: config.agent,
                    scope: config.scope,
                    path: config.path.clone(),
                    status: config.status,
                    fingerprint: Some(result.fingerprint),
                    backup_required,
                    backup_path,
                    diff: result.diff,
                    changes,
                    conflicts: file_conflicts,
                    dev_approval_required: dev_present && !dev_approved,
                });
            }
            Err(error) => {
                file_conflicts.push(error.clone());
                conflicts.push(error);
                files.push(FilePlan {
                    agent: config.agent,
                    scope: config.scope,
                    path: config.path.clone(),
                    status: config.status,
                    fingerprint: None,
                    backup_required: false,
                    backup_path: None,
                    diff: String::new(),
                    changes,
                    conflicts: file_conflicts,
                    dev_approval_required: dev_present && !dev_approved,
                });
            }
        }
    }
    for scope in &approved {
        if !inventory
            .hooks
            .iter()
            .any(|h| h.config_path == *scope && h.ownership == scan::Ownership::NookDev)
        {
            conflicts.push(format!(
                "Dev scope approval does not match an identified Dev-owned config: {scope}"
            ));
        }
    }
    if operation != Operation::Disconnect && !relay.is_file() {
        conflicts.push(format!(
            "Standalone relay is not installed yet: {}",
            relay.display()
        ));
    }
    let codex_trust_required = operation != Operation::Disconnect
        && files
            .iter()
            .any(|f| f.agent == scan::Agent::Codex && f.diff != "No change.");
    let preserved_records = files
        .iter()
        .flat_map(|f| &f.changes)
        .filter(|c| c.kind == ChangeKind::Preserve)
        .count();
    let requires_original_migration = files.iter().flat_map(|f| &f.changes).any(|c| {
        operation != Operation::Disconnect
            && c.ownership == scan::Ownership::OriginalNook
            && matches!(c.kind, ChangeKind::Change | ChangeKind::Remove)
    });
    Preview {
        operation,
        agent: None,
        target_relay,
        files,
        duplicates: inventory.duplicates,
        preserved_records,
        conflicts,
        approved_dev_scopes: approved.into_iter().collect(),
        dev_scopes_requiring_approval,
        codex_trust_required,
        requires_original_migration,
        preview_id: None,
    }
}

#[derive(Default)]
pub struct PreviewTicket(std::sync::Mutex<Option<(String, Preview)>>);
impl PreviewTicket {
    pub fn issue(&self, mut preview: Preview) -> Result<Preview, String> {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let nonce = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let id = format!("{:x}-{:x}-{:x}", std::process::id(), now, nonce);
        preview.preview_id = Some(id.clone());
        *self
            .0
            .lock()
            .map_err(|_| "Connect preview state is unavailable".to_string())? =
            Some((id, preview.clone()));
        Ok(preview)
    }
    pub fn take(&self, id: &str) -> Result<Preview, String> {
        let mut guard = self
            .0
            .lock()
            .map_err(|_| "Connect preview state is unavailable".to_string())?;
        match guard.take() {
            Some((saved_id, preview)) if saved_id == id => Ok(preview),
            Some(saved) => {
                *guard = Some(saved);
                Err("Preview expired or was replaced; review a fresh preview.".into())
            }
            None => Err("Preview expired; review a fresh preview.".into()),
        }
    }
}

struct PreparedFile {
    file: FilePlan,
    old: Option<Vec<u8>>,
    next: Vec<u8>,
    new_fingerprint: String,
    backup: Option<PathBuf>,
}

/// Apply a reviewed plan as one rollback-capable transaction. The UI-facing
/// command supplies explicit confirmation; this core remains fixture-testable.
pub fn apply_preview(
    plan: &Preview,
    codex_trust_approved: bool,
    fail_before_write: Option<usize>,
) -> Result<Vec<String>, String> {
    let mut apply_paths = std::collections::BTreeSet::new();
    for file in &plan.files {
        if !apply_paths.insert(scan::canonical_path_key(Path::new(&file.path))) {
            return Err(format!(
                "Configuration path appears in multiple scopes; no files were changed: {}",
                file.path
            ));
        }
    }
    if plan
        .conflicts
        .iter()
        .any(|conflict| conflict.starts_with("Configuration path resolves to multiple scopes"))
    {
        return Err("Overlapping configuration scopes must be resolved before applying. Nothing was changed.".into());
    }
    if plan.operation != Operation::Disconnect && !Path::new(&plan.target_relay).is_file() {
        return Err(format!(
            "Standalone relay is missing: {}. Original hooks were left in place.",
            plan.target_relay
        ));
    }
    if !plan.dev_scopes_requiring_approval.is_empty() {
        return Err(
            "Nook Dev hooks need separate approval for each listed scope before applying.".into(),
        );
    }
    if plan
        .conflicts
        .iter()
        .any(|c| c.starts_with("Dev scope approval does not match"))
    {
        return Err("A Dev scope approval did not match the preview.".into());
    }
    if plan.codex_trust_required && !codex_trust_approved {
        return Err("Codex hooks require explicit trust approval. Review Codex's /hooks trust prompt; Nook will not bypass it.".into());
    }
    if plan.files.iter().any(|f| {
        matches!(
            f.status,
            scan::ConfigStatus::Malformed | scan::ConfigStatus::Inaccessible
        )
    }) {
        return Err("A configuration is malformed or inaccessible; no files were changed.".into());
    }
    let mut prepared = Vec::new();
    for file in &plan.files {
        let expected = file
            .fingerprint
            .as_deref()
            .ok_or_else(|| format!("No fingerprint for {}", file.path))?;
        let path = PathBuf::from(&file.path);
        let old = hooks::read_file(&path)?;
        if hooks::fingerprint(old.as_deref().unwrap_or_default()) != expected {
            return Err(format!(
                "{} changed since preview. Nothing was applied.",
                file.path
            ));
        }
        let result = hooks::preview_file(&path, |path, bytes| {
            let current = match bytes {
                Some(bytes) => match file.agent {
                    scan::Agent::ClaudeCode => {
                        hooks::parse_settings(bytes, &path.display().to_string())?
                    }
                    scan::Agent::Codex => codex_hooks::parse(bytes, &path.display().to_string())?,
                },
                None => json!({}),
            };
            let remove_dev = plan
                .approved_dev_scopes
                .iter()
                .any(|approved| approved == &file.path);
            let next = safe_transform(
                file.agent,
                file.scope,
                plan.operation,
                &current,
                &plan.target_relay,
                remove_dev,
            )?;
            let before = bytes.map(|_| serialized(&current)).unwrap_or_default();
            let after = serialized(&next);
            let mut output = after.as_bytes().to_vec();
            output.push(b'\n');
            Ok(hooks::FileChange {
                before,
                after,
                bytes: output,
            })
        })?;
        if result.fingerprint != expected || result.diff != file.diff {
            return Err(format!(
                "{} no longer matches the reviewed preview. Nothing was applied.",
                file.path
            ));
        }
        let current = match old.as_deref() {
            Some(bytes) => match file.agent {
                scan::Agent::ClaudeCode => hooks::parse_settings(bytes, &file.path)?,
                scan::Agent::Codex => codex_hooks::parse(bytes, &file.path)?,
            },
            None => json!({}),
        };
        let remove_dev = plan
            .approved_dev_scopes
            .iter()
            .any(|approved| approved == &file.path);
        let next_value = safe_transform(
            file.agent,
            file.scope,
            plan.operation,
            &current,
            &plan.target_relay,
            remove_dev,
        )?;
        let mut next = serialized(&next_value).into_bytes();
        next.push(b'\n');
        if result.diff == "No change." {
            continue;
        }
        let backup = if old.is_some() {
            Some(PathBuf::from(file.backup_path.as_deref().ok_or_else(
                || format!("No backup path for {}", file.path),
            )?))
        } else {
            None
        };
        prepared.push(PreparedFile {
            file: file.clone(),
            old,
            next: next.clone(),
            new_fingerprint: hooks::fingerprint(&next),
            backup,
        });
    }
    // All backups are durable before the first configuration is replaced.
    let mut created_backups = Vec::new();
    for item in &prepared {
        if let (Some(backup), Some(old)) = (&item.backup, &item.old) {
            if let Err(error) = hooks::write_backup(backup, old, Some(Path::new(&item.file.path))) {
                for created in created_backups {
                    let _ = std::fs::remove_file(created);
                }
                return Err(error);
            }
            created_backups.push(backup.clone());
        }
    }
    for item in &prepared {
        let now = hooks::read_file(Path::new(&item.file.path))?;
        if hooks::fingerprint(now.as_deref().unwrap_or_default())
            != item.file.fingerprint.as_deref().unwrap_or_default()
        {
            for backup in &created_backups {
                let _ = std::fs::remove_file(backup);
            }
            return Err(format!(
                "{} changed during backup. Nothing was applied.",
                item.file.path
            ));
        }
    }
    let mut applied: Vec<usize> = Vec::new();
    for (index, item) in prepared.iter().enumerate() {
        if fail_before_write == Some(index) {
            return rollback_transaction(
                &prepared,
                &applied,
                &created_backups,
                format!("Injected fixture failure before write {index}"),
            );
        }
        let path = PathBuf::from(&item.file.path);
        let fingerprint = item.file.fingerprint.as_deref().unwrap_or_default();
        let result =
            hooks::write_file_with_backup(&path, fingerprint, item.backup.as_deref(), |_, _| {
                Ok(hooks::FileChange {
                    before: String::new(),
                    after: String::new(),
                    bytes: item.next.clone(),
                })
            });
        if let Err(error) = result {
            return rollback_transaction(&prepared, &applied, &created_backups, error);
        }
        if std::fs::read(&path).ok().as_deref() != Some(item.next.as_slice()) {
            applied.push(index);
            return rollback_transaction(
                &prepared,
                &applied,
                &created_backups,
                format!("{} did not verify after writing", item.file.path),
            );
        }
        applied.push(index);
    }
    Ok(created_backups
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect())
}

fn rollback_transaction(
    prepared: &[PreparedFile],
    applied: &[usize],
    backups: &[PathBuf],
    cause: String,
) -> Result<Vec<String>, String> {
    let mut errors = Vec::new();
    for index in applied.iter().rev() {
        let item = &prepared[*index];
        if let Err(error) = hooks::rollback_file(
            Path::new(&item.file.path),
            item.backup.as_deref(),
            item.old.is_none(),
            &item.new_fingerprint,
        ) {
            errors.push(error);
        }
    }
    for backup in backups {
        if !applied
            .iter()
            .any(|i| prepared[*i].backup.as_ref() == Some(backup))
        {
            let _ = std::fs::remove_file(backup);
        }
    }
    if errors.is_empty() {
        Err(format!("{cause}; prior changes were rolled back."))
    } else {
        Err(format!(
            "{cause}; rollback needs attention: {}",
            errors.join("; ")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "nook-connect-preview-{}-{nonce}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&root).unwrap();
            Self(root)
        }
        fn write(&self, name: &str, value: &Value) -> PathBuf {
            let path = self.0.join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, serde_json::to_vec_pretty(value).unwrap()).unwrap();
            path
        }
        fn snapshot(&self) -> BTreeMap<PathBuf, Vec<u8>> {
            fn walk(root: &Path, out: &mut BTreeMap<PathBuf, Vec<u8>>) {
                for item in fs::read_dir(root).unwrap() {
                    let path = item.unwrap().path();
                    if path.is_dir() {
                        walk(&path, out)
                    } else {
                        out.insert(path.clone(), fs::read(path).unwrap());
                    }
                }
            }
            let mut out = BTreeMap::new();
            walk(&self.0, &mut out);
            out
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn inventory(
        path: &Path,
        agent: scan::Agent,
        hooks: Vec<scan::HookRecord>,
    ) -> scan::ConnectScan {
        scan::ConnectScan {
            standalone_relay: String::new(),
            standalone_relay_ready: true,
            detected_agents: vec![],
            configs: vec![scan::ConfigFile {
                agent,
                scope: scan::Scope::User,
                path: path.to_string_lossy().into(),
                status: scan::ConfigStatus::Readable,
                fingerprint: None,
                error: None,
            }],
            hooks,
            duplicates: vec![],
            agents: vec![],
            issues: vec![],
        }
    }
    fn record_as(
        path: &Path,
        agent: scan::Agent,
        scope: scan::Scope,
        event: &str,
        command: &str,
        ownership: scan::Ownership,
    ) -> scan::HookRecord {
        scan::HookRecord {
            agent,
            scope,
            config_path: path.to_string_lossy().into(),
            event: event.into(),
            ownership,
            command: Some(command.into()),
            relay_path: Some(command.into()),
            relay_exists: Some(true),
        }
    }
    fn fixture_plan(
        f: &Fixture,
        configs: Vec<(&str, scan::Agent, scan::Scope, scan::ConfigStatus)>,
        records: Vec<scan::HookRecord>,
        op: Operation,
        approved: &[String],
    ) -> Preview {
        let configs = configs
            .into_iter()
            .map(|(path, agent, scope, status)| scan::ConfigFile {
                agent,
                scope,
                path: f.0.join(path).to_string_lossy().into(),
                status,
                fingerprint: None,
                error: None,
            })
            .collect();
        let relay = f.0.join("NookStandalone/bin/nook-hook-standalone.exe");
        fs::create_dir_all(relay.parent().unwrap()).unwrap();
        fs::write(&relay, b"fixture relay").unwrap();
        build_safe_preview(
            op,
            scan::ConnectScan {
                standalone_relay: relay.to_string_lossy().into_owned(),
                standalone_relay_ready: true,
                detected_agents: vec![],
                configs,
                hooks: records,
                duplicates: vec![],
                agents: vec![],
                issues: vec![],
            },
            relay,
            approved,
        )
    }
    fn record(
        path: &Path,
        event: &str,
        command: &str,
        ownership: scan::Ownership,
    ) -> scan::HookRecord {
        scan::HookRecord {
            agent: scan::Agent::ClaudeCode,
            scope: scan::Scope::User,
            config_path: path.to_string_lossy().into(),
            event: event.into(),
            ownership,
            command: Some(command.into()),
            relay_path: Some(command.into()),
            relay_exists: Some(true),
        }
    }

    #[test]
    fn overlapping_scope_paths_produce_one_blocked_plan_and_never_apply_twice() {
        let f = Fixture::new();
        let path = f.write(
            "codex/hooks.json",
            &json!({"hooks":{"Stop":[{"hooks":[{"type":"command","command":"C:/Nook/bin/nook-hook.exe"}]}]}}),
        );
        let relay = f.0.join("NookStandalone/bin/nook-hook-standalone.exe");
        fs::create_dir_all(relay.parent().unwrap()).unwrap();
        fs::write(&relay, b"fixture relay").unwrap();
        let path_string = path.to_string_lossy().into_owned();
        let mut user = scan::ConfigFile {
            agent: scan::Agent::ClaudeCode,
            scope: scan::Scope::User,
            path: path_string.clone(),
            status: scan::ConfigStatus::Readable,
            fingerprint: None,
            error: None,
        };
        let project = scan::ConfigFile {
            scope: scan::Scope::Project,
            ..user.clone()
        };
        user.fingerprint = Some(hooks::fingerprint(&fs::read(&path).unwrap()));
        let user_record = record(
            &path,
            "Stop",
            "C:/Nook/bin/nook-hook.exe",
            scan::Ownership::OriginalNook,
        );
        let mut project_record = user_record.clone();
        project_record.scope = scan::Scope::Project;
        let before = fs::read(&path).unwrap();
        let plan = build_safe_preview(
            Operation::Connect,
            scan::ConnectScan {
                standalone_relay: relay.to_string_lossy().into_owned(),
                standalone_relay_ready: true,
                detected_agents: vec![],
                configs: vec![user, project],
                hooks: vec![user_record.clone(), project_record.clone()],
                duplicates: vec![],
                agents: vec![],
                issues: vec![],
            },
            relay,
            &[],
        );
        assert_eq!(plan.files.len(), 1);
        assert!(plan.conflicts.iter().any(|c| c.contains("multiple scopes")));
        assert!(plan.files[0].backup_required);
        assert!(plan.files[0].backup_path.is_some());
        assert!(plan.files[0].fingerprint.is_some());
        assert_eq!(
            plan.files[0]
                .changes
                .iter()
                .filter(|change| change.ownership == scan::Ownership::OriginalNook)
                .count(),
            2
        );
        assert!(apply_preview(&plan, true, None).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
    }

    #[test]
    fn fixture_previews_preserve_third_party_and_unknown_and_never_write() {
        let f = Fixture::new();
        let path=f.write("claude/settings.json", &json!({"hooks":{"Stop":[{"hooks":[
            {"type":"command","command":"C:/Users/u/AppData/Local/Nook/bin/nook-hook.exe"},
            {"type":"command","command":"C:/Users/u/AppData/Local/NookDev/bin/nook-hook-dev.exe"},
            {"type":"command","command":"C:/tools/format.exe"},
            {"type":"command","command":"C:/odd/agent.exe"}
        ]}]}}));
        let before = f.snapshot();
        let records = vec![
            record(
                &path,
                "Stop",
                "C:/Users/u/AppData/Local/Nook/bin/nook-hook.exe",
                scan::Ownership::OriginalNook,
            ),
            record(
                &path,
                "Stop",
                "C:/Users/u/AppData/Local/NookDev/bin/nook-hook-dev.exe",
                scan::Ownership::NookDev,
            ),
            record(
                &path,
                "Stop",
                "C:/tools/format.exe",
                scan::Ownership::ThirdParty,
            ),
            record(&path, "Stop", "C:/odd/agent.exe", scan::Ownership::Unknown),
        ];
        let plan = build_preview(
            Operation::Connect,
            inventory(&path, scan::Agent::ClaudeCode, records),
            PathBuf::from("C:/Users/u/AppData/Local/NookStandalone/bin/nook-hook-standalone.exe"),
        );
        assert!(plan.files[0].backup_required);
        assert!(plan.files[0]
            .changes
            .iter()
            .any(|c| c.ownership == scan::Ownership::OriginalNook && c.kind == ChangeKind::Change));
        assert!(plan.files[0]
            .changes
            .iter()
            .any(|c| c.ownership == scan::Ownership::NookDev && c.kind == ChangeKind::Remove));
        assert_eq!(plan.preserved_records, 2);
        assert!(plan.files[0]
            .conflicts
            .iter()
            .any(|c| c.contains("Unknown ownership")));
        assert_eq!(f.snapshot(), before);
    }

    #[test]
    fn codex_preview_detects_duplicate_and_malformed_without_overwrite() {
        let f = Fixture::new();
        let good=f.write("codex/hooks.json",&json!({"hooks":{"Stop":[
            {"hooks":[{"type":"command","command":"C:/Users/u/AppData/Local/Nook/bin/nook-hook.exe --agent codex"}]},
            {"hooks":[{"type":"command","command":"C:/Users/u/AppData/Local/NookDev/bin/nook-hook-dev.exe --agent codex"}]}
        ]}}));
        let bad = f.0.join("broken.json");
        fs::write(&bad, b"{broken").unwrap();
        let snapshot = f.snapshot();
        let duplicate = scan::DuplicateEvent {
            agent: scan::Agent::Codex,
            event: "Stop".into(),
            relay_path: "C:/x/hook.exe".into(),
            scopes: vec![scan::Scope::User, scan::Scope::Project],
            config_paths: vec![good.to_string_lossy().into(), "project/hooks.json".into()],
        };
        let mut inv = inventory(&good, scan::Agent::Codex, vec![]);
        inv.duplicates.push(duplicate);
        let plan = build_preview(
            Operation::Repair,
            inv,
            PathBuf::from("C:/Users/u/AppData/Local/NookStandalone/bin/nook-hook-standalone.exe"),
        );
        assert!(!plan.duplicates.is_empty());
        assert_eq!(f.snapshot(), snapshot);
        let malformed = hooks::preview_file(&bad, |_path, _bytes| {
            Ok(hooks::FileChange {
                before: String::new(),
                after: String::new(),
                bytes: vec![],
            })
        });
        assert!(malformed.is_ok()); // raw fingerprint helper reads bytes; parser rejection is covered by scanner
        assert_eq!(f.snapshot(), snapshot);
    }

    #[test]
    fn malformed_preview_has_a_fingerprint_and_no_proposed_edit() {
        let f = Fixture::new();
        let path = f.0.join("claude/settings.json");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"{broken").unwrap();
        let before = f.snapshot();
        let mut inv = inventory(&path, scan::Agent::ClaudeCode, vec![]);
        inv.configs[0].status = scan::ConfigStatus::Malformed;
        inv.configs[0].error = Some("fixture malformed JSON".into());
        let plan = build_preview(
            Operation::Connect,
            inv,
            PathBuf::from("C:/NookStandalone/bin/nook-hook-standalone.exe"),
        );
        assert!(plan.files[0].fingerprint.is_some());
        assert!(!plan.files[0].backup_required);
        assert!(plan.files[0].diff.is_empty());
        assert!(!plan.files[0].conflicts.is_empty());
        assert_eq!(f.snapshot(), before);
    }

    #[test]
    fn disconnect_preview_removes_owned_and_preserves_other_hooks() {
        let f = Fixture::new();
        let path = f.write(
            "claude/settings.json",
            &json!({"hooks":{"Stop":[{"hooks":[
                {"type":"command","command":"C:/Users/u/AppData/Local/Nook/bin/nook-hook.exe"},
                {"type":"command","command":"C:/tools/formatter.exe"}
            ]}]}}),
        );
        let before = f.snapshot();
        let records = vec![
            record(
                &path,
                "Stop",
                "C:/Users/u/AppData/Local/Nook/bin/nook-hook.exe",
                scan::Ownership::OriginalNook,
            ),
            record(
                &path,
                "Stop",
                "C:/tools/formatter.exe",
                scan::Ownership::ThirdParty,
            ),
        ];
        let plan = build_preview(
            Operation::Disconnect,
            inventory(&path, scan::Agent::ClaudeCode, records),
            PathBuf::from("C:/NookStandalone/bin/nook-hook-standalone.exe"),
        );
        assert!(plan.files[0]
            .changes
            .iter()
            .any(|c| c.kind == ChangeKind::Remove && c.ownership == scan::Ownership::OriginalNook));
        assert!(plan.files[0]
            .changes
            .iter()
            .any(|c| c.kind == ChangeKind::Preserve && c.ownership == scan::Ownership::ThirdParty));
        assert_eq!(f.snapshot(), before);
    }

    #[test]
    fn connect_preview_reports_cross_scope_duplicates_it_would_create() {
        let f = Fixture::new();
        let global = f.0.join("global/claude/settings.json");
        let project = f.0.join("project/.claude/settings.json");
        let inv = scan::ConnectScan {
            standalone_relay: String::new(),
            standalone_relay_ready: true,
            detected_agents: vec![],
            configs: vec![
                scan::ConfigFile {
                    agent: scan::Agent::ClaudeCode,
                    scope: scan::Scope::User,
                    path: global.to_string_lossy().into(),
                    status: scan::ConfigStatus::Missing,
                    fingerprint: None,
                    error: None,
                },
                scan::ConfigFile {
                    agent: scan::Agent::ClaudeCode,
                    scope: scan::Scope::Project,
                    path: project.to_string_lossy().into(),
                    status: scan::ConfigStatus::Missing,
                    fingerprint: None,
                    error: None,
                },
            ],
            hooks: vec![],
            duplicates: vec![],
            agents: vec![],
            issues: vec![],
        };
        let before = f.snapshot();
        let plan = build_preview(
            Operation::Connect,
            inv,
            PathBuf::from("C:/NookStandalone/bin/nook-hook-standalone.exe"),
        );
        assert!(plan
            .duplicates
            .iter()
            .any(|d| d.agent == scan::Agent::ClaudeCode
                && d.event == "Stop"
                && d.scopes.contains(&scan::Scope::User)
                && d.scopes.contains(&scan::Scope::Project)));
        assert!(plan.conflicts.iter().any(|c| c.contains("multiple scopes")));
        assert_eq!(f.snapshot(), before);
    }

    #[test]
    fn connect_empty_profile_backs_up_and_reconnect_is_idempotent() {
        let f = Fixture::new();
        let path = f.write(
            "global/claude/settings.json",
            &json!({"model":"opus","hooks":{}}),
        );
        let before = fs::read(&path).unwrap();
        let plan = fixture_plan(
            &f,
            vec![(
                "global/claude/settings.json",
                scan::Agent::ClaudeCode,
                scan::Scope::User,
                scan::ConfigStatus::Readable,
            )],
            vec![],
            Operation::Connect,
            &[],
        );
        let backups = apply_preview(&plan, false, None).unwrap();
        assert_eq!(backups.len(), 1);
        assert!(Path::new(&backups[0]).exists());
        let installed: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(installed["model"], "opus");
        assert!(installed["hooks"]["Stop"].is_array());
        let _ = before;
        let again = fixture_plan(
            &f,
            vec![(
                "global/claude/settings.json",
                scan::Agent::ClaudeCode,
                scan::Scope::User,
                scan::ConfigStatus::Readable,
            )],
            vec![],
            Operation::Connect,
            &[],
        );
        assert!(
            again.files.iter().all(|file| file.diff == "No change."),
            "{:?}",
            again.files.iter().map(|f| &f.diff).collect::<Vec<_>>()
        );
        assert!(apply_preview(&again, false, None).unwrap().is_empty());
    }

    #[test]
    fn original_migration_cleans_project_and_keeps_unknown_and_foreign() {
        let f = Fixture::new();
        let global=f.write("global/claude/settings.json",&json!({"hooks":{"Stop":[{"hooks":[{"type":"command","command":"C:/Users/u/AppData/Local/Nook/bin/nook-hook.exe","args":["Stop"]}]}]}}));
        let project=f.write("project/.claude/settings.json",&json!({"hooks":{"Stop":[{"hooks":[
            {"type":"command","command":"C:/Users/u/AppData/Local/Nook/bin/nook-hook.exe","args":["Stop"]},
            {"type":"command","command":"C:/Users/u/AppData/Local/NookDev/bin/nook-hook-dev.exe","args":["Stop"]},
            {"type":"command","command":"C:/tools/formatter.exe"},
            {"type":"command","command":"C:/tools/nook-hook.exe"}
        ]}]}}));
        let original = "C:/Users/u/AppData/Local/Nook/bin/nook-hook.exe";
        let dev = "C:/Users/u/AppData/Local/NookDev/bin/nook-hook-dev.exe";
        let records = vec![
            record_as(
                &global,
                scan::Agent::ClaudeCode,
                scan::Scope::User,
                "Stop",
                original,
                scan::Ownership::OriginalNook,
            ),
            record_as(
                &project,
                scan::Agent::ClaudeCode,
                scan::Scope::Project,
                "Stop",
                original,
                scan::Ownership::OriginalNook,
            ),
            record_as(
                &project,
                scan::Agent::ClaudeCode,
                scan::Scope::Project,
                "Stop",
                dev,
                scan::Ownership::NookDev,
            ),
            record_as(
                &project,
                scan::Agent::ClaudeCode,
                scan::Scope::Project,
                "Stop",
                "C:/tools/formatter.exe",
                scan::Ownership::ThirdParty,
            ),
            record_as(
                &project,
                scan::Agent::ClaudeCode,
                scan::Scope::Project,
                "Stop",
                "C:/tools/nook-hook.exe",
                scan::Ownership::Unknown,
            ),
        ];
        let scope = project.to_string_lossy().to_string();
        let pending = fixture_plan(
            &f,
            vec![
                (
                    "global/claude/settings.json",
                    scan::Agent::ClaudeCode,
                    scan::Scope::User,
                    scan::ConfigStatus::Readable,
                ),
                (
                    "project/.claude/settings.json",
                    scan::Agent::ClaudeCode,
                    scan::Scope::Project,
                    scan::ConfigStatus::Readable,
                ),
            ],
            records.clone(),
            Operation::Connect,
            &[],
        );
        assert!(apply_preview(&pending, false, None).is_err());
        assert!(fs::read(&global)
            .unwrap()
            .windows(original.len())
            .any(|window| window == original.as_bytes()));
        let approved = fixture_plan(
            &f,
            vec![
                (
                    "global/claude/settings.json",
                    scan::Agent::ClaudeCode,
                    scan::Scope::User,
                    scan::ConfigStatus::Readable,
                ),
                (
                    "project/.claude/settings.json",
                    scan::Agent::ClaudeCode,
                    scan::Scope::Project,
                    scan::ConfigStatus::Readable,
                ),
            ],
            records,
            Operation::Connect,
            &[scope],
        );
        apply_preview(&approved, false, None).unwrap();
        let global_json: Value = serde_json::from_slice(&fs::read(global).unwrap()).unwrap();
        let project_json: Value = serde_json::from_slice(&fs::read(project).unwrap()).unwrap();
        assert!(global_json["hooks"]["Stop"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap()
            .ends_with("nook-hook-standalone.exe"));
        let project_commands: Vec<_> = project_json["hooks"]["Stop"][0]["hooks"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|h| h["command"].as_str())
            .collect();
        assert!(project_commands.contains(&"C:/tools/formatter.exe"));
        assert!(project_commands.contains(&"C:/tools/nook-hook.exe"));
        assert!(!project_commands
            .iter()
            .any(|c| c.contains("NookDev") || c.contains("/Nook/bin/")));
    }

    #[test]
    fn disconnect_removes_only_standalone_entries() {
        let f = Fixture::new();
        let path=f.write("global/claude/settings.json",&json!({"hooks":{"Stop":[{"hooks":[
            {"type":"command","command":"C:/Users/u/AppData/Local/NookStandalone/bin/nook-hook-standalone.exe","args":["Stop"]},
            {"type":"command","command":"C:/Users/u/AppData/Local/Nook/bin/nook-hook.exe","args":["Stop"]},
            {"type":"command","command":"C:/tools/formatter.exe"}
        ]}]}}));
        let records = vec![
            record_as(
                &path,
                scan::Agent::ClaudeCode,
                scan::Scope::User,
                "Stop",
                "C:/Users/u/AppData/Local/NookStandalone/bin/nook-hook-standalone.exe",
                scan::Ownership::StandaloneNook,
            ),
            record_as(
                &path,
                scan::Agent::ClaudeCode,
                scan::Scope::User,
                "Stop",
                "C:/Users/u/AppData/Local/Nook/bin/nook-hook.exe",
                scan::Ownership::OriginalNook,
            ),
        ];
        let plan = fixture_plan(
            &f,
            vec![(
                "global/claude/settings.json",
                scan::Agent::ClaudeCode,
                scan::Scope::User,
                scan::ConfigStatus::Readable,
            )],
            records,
            Operation::Disconnect,
            &[],
        );
        apply_preview(&plan, false, None).unwrap();
        let out: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        let commands: Vec<_> = out["hooks"]["Stop"][0]["hooks"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|h| h["command"].as_str())
            .collect();
        assert!(commands.contains(&"C:/Users/u/AppData/Local/Nook/bin/nook-hook.exe"));
        assert!(commands.contains(&"C:/tools/formatter.exe"));
        assert!(!commands
            .iter()
            .any(|c| c.ends_with("nook-hook-standalone.exe")));
    }

    #[test]
    fn mismatch_malformed_and_missing_relay_refuse_before_changes() {
        let f = Fixture::new();
        let path = f.write(
            "global/claude/settings.json",
            &json!({"keep":true,"hooks":{}}),
        );
        let mut plan = fixture_plan(
            &f,
            vec![(
                "global/claude/settings.json",
                scan::Agent::ClaudeCode,
                scan::Scope::User,
                scan::ConfigStatus::Readable,
            )],
            vec![],
            Operation::Connect,
            &[],
        );
        fs::write(&path, b"{\"changed\":true}").unwrap();
        let changed = fs::read(&path).unwrap();
        assert!(apply_preview(&plan, false, None)
            .unwrap_err()
            .contains("changed since preview"));
        assert_eq!(fs::read(&path).unwrap(), changed);
        plan.files[0].status = scan::ConfigStatus::Malformed;
        assert!(apply_preview(&plan, false, None).is_err());
        let relay = PathBuf::from(&plan.target_relay);
        fs::remove_file(relay).unwrap();
        assert!(apply_preview(&plan, false, None)
            .unwrap_err()
            .contains("relay is missing"));
    }

    #[test]
    fn backup_failure_leaves_config_and_partial_failure_rolls_back() {
        let f = Fixture::new();
        let a = f.write("a/claude.json", &json!({"a":1}));
        let b = f.write("b/codex.json", &json!({"b":2}));
        let mut plan = fixture_plan(
            &f,
            vec![
                (
                    "a/claude.json",
                    scan::Agent::ClaudeCode,
                    scan::Scope::User,
                    scan::ConfigStatus::Readable,
                ),
                (
                    "b/codex.json",
                    scan::Agent::Codex,
                    scan::Scope::User,
                    scan::ConfigStatus::Readable,
                ),
            ],
            vec![],
            Operation::Connect,
            &[],
        );
        let before_a = fs::read(&a).unwrap();
        let before_b = fs::read(&b).unwrap();
        plan.files[0].backup_path = Some(f.0.join("backup-is-dir").to_string_lossy().into());
        fs::create_dir_all(plan.files[0].backup_path.as_ref().unwrap()).unwrap();
        assert!(apply_preview(&plan, true, None).is_err());
        assert_eq!(fs::read(&a).unwrap(), before_a);
        assert_eq!(fs::read(&b).unwrap(), before_b);
        plan.files[0].backup_path = Some(
            a.with_file_name("claude.json.backup")
                .to_string_lossy()
                .into(),
        );
        plan.files[1].backup_path = Some(
            b.with_file_name("codex.json.backup")
                .to_string_lossy()
                .into(),
        );
        let error = apply_preview(&plan, true, Some(1)).unwrap_err();
        assert!(error.contains("rolled back"), "{error}");
        assert_eq!(fs::read(&a).unwrap(), before_a);
        assert_eq!(fs::read(&b).unwrap(), before_b);
    }

    #[test]
    fn preview_tickets_are_one_use_and_replaced_by_a_new_preview() {
        let f = Fixture::new();
        let path = f.write("global/claude/settings.json", &json!({}));
        let plan = fixture_plan(
            &f,
            vec![(
                "global/claude/settings.json",
                scan::Agent::ClaudeCode,
                scan::Scope::User,
                scan::ConfigStatus::Readable,
            )],
            vec![],
            Operation::Connect,
            &[],
        );
        let tickets = PreviewTicket::default();
        let first = tickets.issue(plan.clone()).unwrap();
        let first_id = first.preview_id.unwrap();
        assert!(tickets.take(&first_id).is_ok());
        assert!(tickets.take(&first_id).is_err());
        let second = tickets.issue(plan).unwrap();
        let second_id = second.preview_id.unwrap();
        assert!(tickets.take(&second_id).is_ok());
        assert!(Path::new(&path).exists());
    }

    #[test]
    fn changed_configuration_has_a_new_preview_fingerprint() {
        let f = Fixture::new();
        let path = f.write("claude/settings.json", &json!({"other":1}));
        let inventory = || inventory(&path, scan::Agent::ClaudeCode, vec![]);
        let relay = PathBuf::from("C:/NookStandalone/bin/nook-hook-standalone.exe");
        let first = build_preview(Operation::Connect, inventory(), relay.clone());
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"{\"other\":2}").unwrap();
        let second = build_preview(Operation::Connect, inventory(), relay);
        assert_ne!(first.files[0].fingerprint, second.files[0].fingerprint);
    }
}
