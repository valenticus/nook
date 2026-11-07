// Claude Code's status line, as the way the usage limits reach Nook.
//
// Claude Code hands its status line command — the `statusLine` key of
// ~/.claude/settings.json — a JSON that carries the 5-hour and weekly limits.
// Installing "usage limits" makes the relay that command (`nook-hook
// statusline`, hook/src/statusline.rs). It follows the hooks' rules to the
// letter, through the hooks' own code (hooks.rs `preview_change` /
// `write_change`): read, refuse what cannot be parsed, show the diff, check
// the fingerprint, take a dated backup, write beside and rename, and only
// after an explicit click. No other key is touched.
//
// A status line the user already has is not lost: its whole setting is put,
// encoded, after `--previous` in the new command. The relay runs it on every
// call and prints what it prints, and uninstalling puts it back exactly as it
// was. With none, uninstalling removes the key.
//
// Why a command string and not the hooks' exec form: `statusLine` has no
// `args` in Claude Code's settings (as of 2.1: `type`, `command`, `padding`,
// `refreshInterval`, `hideVimModeIndicator`), so the command is read by a
// shell — Git Bash when it is installed, PowerShell otherwise, `sh` on Linux.
// On Windows the two do not quote alike, so the command is written with
// nothing to quote: the relay's path as it is, and the previous setting in
// base64url. A path that would need quoting is refused rather than guessed at.
//
// `refreshInterval` is not written. It is documented ("re-runs your command
// every N seconds in addition to the event-driven updates", minimum 1,
// https://code.claude.com/docs/en/statusline), but it would bring no fresher
// limits: Claude Code 2.1.288 takes `rate_limits` from the headers of its
// last API response and keeps them in memory, and the timer only runs the
// command again with those same numbers. A status line of the user's that
// sets one keeps it, as it keeps its padding.

use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

use crate::hooks::{self, HookPreview, MARKER};
use crate::settings;

/// The key of settings.json this file is about, and no other.
const KEY: &str = "statusLine";
/// The relay's mode, and the flag the previous setting follows
/// (hook/src/statusline.rs has the same two).
const MODE: &str = "statusline";
const PREVIOUS_FLAG: &str = "--previous";
/// What the relay cannot take over from the setting it wraps: they say how
/// *that* command is run, and ours is run as a plain string.
const NOT_CARRIED: &[&str] = &["args", "shell"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageStatus {
    /// The relay is Claude Code's status line command.
    pub installed: bool,
    /// And it runs the status line the user had before.
    pub chained: bool,
    /// A status line that is not ours is there.
    pub other_status_line: bool,
    /// Which installation currently owns the user-level status line.
    pub status_line_owner: StatusLineOwner,
    /// The executable currently named by the user-level status line, when present.
    pub status_line_relay: Option<String>,
    pub settings_path: String,
    /// The effective project statusLine, with project-local taking precedence over shared project.
    pub project_overrides: Vec<ProjectStatusLine>,
    /// Project files that could not be read or parsed; the effective value is uncertain.
    pub project_scan_warnings: Vec<String>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StatusLineOwner {
    None,
    Standalone,
    Original,
    Dev,
    ThirdParty,
    Unknown,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStatusLine {
    pub project_path: String,
    pub settings_path: String,
    pub scope: String,
    pub standalone: bool,
    pub owner: StatusLineOwner,
    pub relay_path: Option<String>,
}

/// The relay's path as the command names it.
fn relay_path() -> String {
    let path = settings::hook_exe_path().to_string_lossy().to_string();
    if cfg!(windows) { path.replace('\\', "/") } else { path }
}

/// The relay as a word both of Claude Code's Windows shells read the same:
/// Git Bash wants a path with a space in quotes, PowerShell reads a quoted
/// path as a string and not as a program. With nothing but letters, digits
/// and `_ - . / :` there is nothing to quote, and nothing to get wrong.
#[cfg(windows)]
fn relay_word(relay: &str) -> Result<String, String> {
    let direct = shell_neutral_word(relay).then(|| relay.to_string());
    let short = direct
        .is_none()
        .then(|| short_windows_path(relay))
        .flatten();
    windows_relay_word(relay, short.as_deref())
}

#[cfg(windows)]
fn windows_relay_word(relay: &str, short_path: Option<&str>) -> Result<String, String> {
    if shell_neutral_word(relay) {
        return Ok(relay.to_string());
    }
    if let Some(short) = short_path.filter(|path| shell_neutral_word(path)) {
        return Ok(short.to_string());
    }
    Err(format!(
        "The relay path ({relay}) needs a Windows short path so both PowerShell and Git Bash can launch it safely. Windows did not provide a shell-safe short path. Nothing was changed."
    ))
}

#[cfg(windows)]
fn short_windows_path(relay: &str) -> Option<String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetShortPathNameW;

    let windows_path = relay.replace('/', "\\");
    let path = PathBuf::from(&windows_path);
    let parent = path.parent()?;
    let file_name = path.file_name()?.to_string_lossy();
    let wide: Vec<u16> = parent
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let needed = unsafe { GetShortPathNameW(PCWSTR(wide.as_ptr()), None) };
    if needed == 0 {
        return None;
    }
    let mut buffer = vec![0u16; needed as usize];
    let written = unsafe { GetShortPathNameW(PCWSTR(wide.as_ptr()), Some(&mut buffer)) };
    if written == 0 || written >= buffer.len() as u32 {
        return None;
    }
    let short_parent = String::from_utf16(&buffer[..written as usize]).ok()?;
    Some(
        PathBuf::from(short_parent)
            .join(file_name.as_ref())
            .to_string_lossy()
            .replace('\\', "/"),
    )
}

fn shell_neutral_word(word: &str) -> bool {
    !word.is_empty()
        && word
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '/' | ':' | '~'))
}

/// On Linux the shell is `sh`: one single-quoted word, as for the hooks.
#[cfg(unix)]
fn relay_word(relay: &str) -> Result<String, String> {
    Ok(hooks::sh_quote(relay))
}

/// A status line of ours: its command runs the relay in status line mode.
fn is_ours(setting: &Value) -> bool {
    setting
        .get("command")
        .and_then(Value::as_str)
        .is_some_and(|command| command.contains(MARKER) && command.split_whitespace().any(|word| word == MODE))
}

/// The setting a status line of ours wraps. `Ok(None)` when it wraps none;
/// an error when it says it does and what follows cannot be read back — it is
/// somebody's status line, and removing ours would lose it.
fn previous_of(ours: &Value) -> Result<Option<Value>, String> {
    let command = ours.get("command").and_then(Value::as_str).unwrap_or_default();
    let mut words = command.split_whitespace().skip_while(|word| *word != PREVIOUS_FLAG);
    if words.next().is_none() {
        return Ok(None);
    }
    words
        .next()
        .and_then(base64url_decode)
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .map(Some)
        .ok_or_else(|| "The status line Nook kept inside its own can't be read back. Nook won't touch it — fix the statusLine entry by hand.".to_string())
}

/// Our status line: the relay, and after it the setting it stands in front
/// of. What that setting said of how it is drawn — its padding, its refresh
/// interval — is said of ours too, in the same place.
fn entry(relay: &str, previous: Option<&Value>) -> Result<Value, String> {
    let mut command = format!("{} {MODE}", relay_word(relay)?);
    let mut entry = previous.and_then(Value::as_object).cloned().unwrap_or_default();
    if let Some(previous) = previous {
        command.push_str(&format!(" {PREVIOUS_FLAG} {}", base64url_encode(previous.to_string().as_bytes())));
    }
    for key in NOT_CARRIED {
        entry.shift_remove(*key);
    }
    entry.insert("type".into(), json!("command"));
    entry.insert("command".into(), Value::String(command));
    Ok(Value::Object(entry))
}

/// Settings with the relay as the status line; everything else is left
/// untouched. A status line of the user's own is wrapped; one of ours is
/// written again around what it already wraps, never around itself.
fn installed(existing: &Value, relay: &str) -> Result<Value, String> {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    let previous = match root.get(KEY) {
        None => None,
        Some(ours) if is_ours(ours) => previous_of(ours)?,
        Some(other) => Some(other.clone()),
    };
    // In the place the key already has, when it has one: the diff shows a
    // line changing, not a key moving.
    root.insert(KEY.into(), entry(relay, previous.as_ref())?);
    Ok(Value::Object(root))
}

/// Settings with our status line gone: what it wrapped is back exactly as it
/// was, or the key is removed. A status line that is not ours is not touched.
fn uninstalled(existing: &Value) -> Result<Value, String> {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    if let Some(ours) = root.get(KEY).filter(|setting| is_ours(setting)) {
        match previous_of(ours)? {
            Some(previous) => {
                root.insert(KEY.into(), previous);
            }
            None => {
                root.shift_remove(KEY);
            }
        }
    }
    Ok(Value::Object(root))
}

fn status_of(settings: &Value) -> (bool, bool, bool) {
    match settings.get(KEY) {
        None => (false, false, false),
        Some(ours) if is_ours(ours) => (true, matches!(previous_of(ours), Ok(Some(_))), false),
        Some(_) => (false, false, true),
    }
}

fn relay_path_of(setting: &Value) -> Option<String> {
    let command = setting.get("command")?.as_str()?.trim();
    let first = if let Some(rest) = command.strip_prefix('"') {
        rest.split_once('"').map(|(path, _)| path)
    } else if let Some(rest) = command.strip_prefix('\'') {
        rest.split_once('\'').map(|(path, _)| path)
    } else {
        command.split_whitespace().next()
    }?;
    (!first.is_empty()).then(|| first.replace('\\', "/"))
}

fn owner_of(setting: Option<&Value>) -> StatusLineOwner {
    let Some(setting) = setting else {
        return StatusLineOwner::None;
    };
    let Some(command) = setting.get("command").and_then(Value::as_str) else {
        return StatusLineOwner::ThirdParty;
    };
    let lower = command.to_lowercase().replace('\\', "/");
    if lower.contains("nook-hook-standalone.exe") || lower.contains("nookstandalone/") {
        StatusLineOwner::Standalone
    } else if lower.contains("nook-hook-dev.exe") || lower.contains("nookdev/") {
        StatusLineOwner::Dev
    } else if lower.contains("/nook/bin/nook-hook.exe") || lower.contains("coucou-hook")
    {
        StatusLineOwner::Original
    } else if is_ours(setting) {
        StatusLineOwner::Unknown
    } else {
        StatusLineOwner::ThirdParty
    }
}

pub fn check_original_migration_confirmation(
    install: bool,
    owner: StatusLineOwner,
    approved: bool,
) -> Result<(), String> {
    if install && owner == StatusLineOwner::Original && !approved {
        Err("Original Claude statusLine migration requires separate confirmation.".into())
    } else {
        Ok(())
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

pub fn status() -> UsageStatus {
    status_with_projects(&[])
}

pub fn status_with_projects(project_roots: &[PathBuf]) -> UsageStatus {
    let user_settings = hooks::read_settings_lossy();
    let user_status_line = user_settings.get(KEY);
    let (installed, chained, other_status_line) = status_of(&user_settings);
    let mut project_overrides = Vec::new();
    let mut project_scan_warnings = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for root in project_roots {
        let identity = root.to_string_lossy().to_lowercase();
        if !seen.insert(identity) {
            continue;
        }
        match project_status_line(root) {
            Ok(Some(override_entry)) => project_overrides.push(override_entry),
            Ok(None) => {}
            Err(warning) => project_scan_warnings.push(warning),
        }
    }
    UsageStatus {
        installed,
        chained,
        other_status_line,
        status_line_owner: owner_of(user_status_line),
        status_line_relay: user_status_line.and_then(relay_path_of),
        settings_path: hooks::settings_path().to_string_lossy().to_string(),
        project_overrides,
        project_scan_warnings,
    }
}

/// Claude Code reads project-local settings over shared project settings, both over user settings.
/// Only known Nook project roots are checked; no disk-wide search is performed.
fn project_status_line(root: &Path) -> Result<Option<ProjectStatusLine>, String> {
    fn read_scope(root: &Path, relative: &str) -> Result<Option<Value>, String> {
        let path = root.join(relative);
        let bytes = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(format!("{}: {error}", path.display())),
        };
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|error| format!("{}: {error}", path.display()))
    }
    let local = read_scope(root, ".claude/settings.local.json")?;
    let shared = read_scope(root, ".claude/settings.json")?;
    // If a remembered root is the home directory, this path is the same file
    // already reported as the user scope. Do not relabel it as a project
    // override; a distinct project-local file still has normal precedence.
    Ok(project_status_line_from_values_without_user_alias(
        root,
        shared.as_ref(),
        local.as_ref(),
        &hooks::settings_path(),
    ))
}

fn project_status_line_from_values(
    root: &Path,
    shared: Option<&Value>,
    local: Option<&Value>,
) -> Option<ProjectStatusLine> {
    project_status_line_from_values_without_user_alias(root, shared, local, Path::new(""))
}

fn project_status_line_from_values_without_user_alias(
    root: &Path,
    shared: Option<&Value>,
    local: Option<&Value>,
    user_settings_path: &Path,
) -> Option<ProjectStatusLine> {
    let shared_path = root.join(".claude/settings.json");
    let shared_is_user = !user_settings_path.as_os_str().is_empty()
        && crate::connect_scanner::canonical_path_key(&shared_path)
            == crate::connect_scanner::canonical_path_key(user_settings_path);
    let shared = if shared_is_user { None } else { shared };
    [("Project local", local), ("Project", shared)]
        .into_iter()
        .find_map(|(scope, settings)| {
            let setting = settings?.get(KEY)?;
            Some(ProjectStatusLine {
                project_path: root.to_string_lossy().into_owned(),
                settings_path: root
                    .join(if scope == "Project local" {
                        ".claude/settings.local.json"
                    } else {
                        ".claude/settings.json"
                    })
                    .to_string_lossy()
                    .into_owned(),
                scope: scope.into(),
                standalone: is_standalone(setting),
                owner: owner_of(Some(setting)),
                relay_path: relay_path_of(setting),
            })
        })
}

fn is_standalone(setting: &Value) -> bool {
    setting
        .get("command")
        .and_then(Value::as_str)
        .is_some_and(|command| command.to_lowercase().contains("nook-hook-standalone"))
}

fn change(install: bool) -> impl Fn(&Value) -> Result<Value, String> {
    move |current| if install { installed(current, &relay_path()) } else { uninstalled(current) }
}

/// The diff the user has to look at before anything is written.
pub fn preview(install: bool) -> Result<HookPreview, String> {
    hooks::preview_change(change(install))
}

/// Writes it — after a dated backup, and only if settings.json is still the
/// file the preview was made from. Returns the backup's path.
pub fn apply(install: bool, fingerprint: &str) -> Result<String, String> {
    hooks::write_change(fingerprint, change(install))
}

// ── base64url ─────────────────────────────────────────────────────────────────
//
// RFC 4648 §5, without padding: letters, digits, `-` and `_`. The one way a
// JSON value sits in a command line that Git Bash, PowerShell and sh all read
// as a single plain word.

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

fn base64url_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let group = chunk.iter().fold(0u32, |group, byte| (group << 8) | u32::from(*byte)) << (8 * (3 - chunk.len()));
        for i in 0..=chunk.len() {
            out.push(ALPHABET[(group >> (18 - 6 * i)) as usize & 63] as char);
        }
    }
    out
}

fn base64url_decode(text: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    let (mut bits, mut held) = (0u32, 0u32);
    for c in text.trim_end_matches('=').bytes() {
        let six = ALPHABET.iter().position(|a| *a == c)? as u32;
        bits = (bits << 6) | six;
        held += 6;
        if held >= 8 {
            held -= 8;
            out.push((bits >> held) as u8);
            bits &= (1 << held) - 1;
        }
    }
    Some(out)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A relay path with nothing to quote, as it is on most machines.
    const RELAY: &str = "C:/Users/me/AppData/Local/Nook/bin/nook-hook.exe";

    fn command_of(settings: &Value) -> &str {
        settings[KEY]["command"].as_str().unwrap()
    }

    /// The user's own status lines: a plain string, as Claude Code documents
    /// it, and one in exec form with everything else a status line can say.
    fn shell_form() -> Value {
        json!({ "type": "command", "command": "bash ~/.claude/statusline.sh --theme \"dark side\" | sed 's/é/e/'", "padding": 2 })
    }
    fn exec_form() -> Value {
        json!({ "type": "command", "command": "node", "args": ["C:/Users/me/line one.mjs", "--plain"], "refreshInterval": 5, "shell": "powershell" })
    }
    fn others() -> Value {
        json!({ "model": "opus", "env": { "A": "1" }, "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "other-tool.exe" }] }] } })
    }
    fn with(status_line: Option<Value>) -> Value {
        let mut settings = others();
        if let Some(status_line) = status_line {
            // In the middle, to see that it stays where it is.
            let mut root = serde_json::Map::new();
            root.insert("model".into(), settings["model"].take());
            root.insert(KEY.into(), status_line);
            root.insert("env".into(), settings["env"].take());
            root.insert("hooks".into(), settings["hooks"].take());
            settings = Value::Object(root);
        }
        settings
    }
    fn keys(settings: &Value) -> Vec<&str> {
        settings
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect()
    }

    #[test]
    fn with_no_status_line_the_relay_becomes_it_and_uninstalling_removes_the_key() {
        let before = with(None);
        let after = installed(&before, RELAY).unwrap();
        assert_eq!(after[KEY]["type"], "command");
        assert!(
            command_of(&after).ends_with(" statusline"),
            "nothing to chain to: {}",
            command_of(&after)
        );
        assert!(command_of(&after).contains(MARKER));
        assert_eq!(status_of(&after), (true, false, false));
        // Nothing else moved, and taking it out again leaves what there was.
        assert_eq!(after["hooks"], before["hooks"]);
        assert_eq!(uninstalled(&after).unwrap(), before);
        assert_eq!(pretty(&uninstalled(&after).unwrap()), pretty(&before));
        assert_eq!(status_of(&before), (false, false, false));
    }

    fn pretty(v: &Value) -> String {
        serde_json::to_string_pretty(v).unwrap()
    }

    #[test]
    fn a_status_line_of_the_users_own_is_wrapped_and_comes_back_exactly() {
        for own in [shell_form(), exec_form()] {
            let before = with(Some(own.clone()));
            assert_eq!(status_of(&before), (false, false, true));
            let after = installed(&before, RELAY).unwrap();
            assert_eq!(status_of(&after), (true, true, false));
            assert_eq!(keys(&after), keys(&before), "the key stays where it was");

            // The command is the relay, then the old setting as one plain word.
            let words: Vec<&str> = command_of(&after).split_whitespace().collect();
            assert_eq!(words.len(), 4, "{words:?}");
            assert_eq!(&words[1..3], [MODE, PREVIOUS_FLAG]);
            assert!(
                words[3].bytes().all(|b| ALPHABET.contains(&b)),
                "one word, nothing a shell reads: {}",
                words[3]
            );
            assert_eq!(
                serde_json::from_slice::<Value>(&base64url_decode(words[3]).unwrap()).unwrap(),
                own
            );
            // How it is drawn carries over; how the old command was run does not.
            for (key, value) in own.as_object().unwrap() {
                match key.as_str() {
                    "type" | "command" => {}
                    "args" | "shell" => {
                        assert!(after[KEY].get(key).is_none(), "{key} is the old command's")
                    }
                    _ => assert_eq!(&after[KEY][key], value),
                }
            }

            // Back out: byte for byte what it was, key order and all.
            let back = uninstalled(&after).unwrap();
            assert_eq!(back, before);
            assert_eq!(pretty(&back), pretty(&before));
        }
    }

    #[test]
    fn installing_twice_does_not_wrap_itself() {
        for start in [
            with(None),
            with(Some(shell_form())),
            with(Some(exec_form())),
        ] {
            let once = installed(&start, RELAY).unwrap();
            let twice = installed(&once, RELAY).unwrap();
            assert_eq!(pretty(&twice), pretty(&once));
            // The relay moved (another account folder): written again around the same thing.
            let moved = installed(&once, "D:/Nook/bin/nook-hook.exe").unwrap();
            assert!(
                command_of(&moved).contains("D:/Nook/bin/nook-hook.exe")
                    && !command_of(&moved).contains("Users/me")
            );
            assert_eq!(uninstalled(&moved).unwrap(), start);
            assert_eq!(uninstalled(&twice).unwrap(), start);
        }
    }

    #[test]
    fn a_foreign_status_line_is_never_lost() {
        // Uninstalling when ours is not there touches nothing.
        for own in [
            shell_form(),
            exec_form(),
            json!("not even an object"),
            json!({ "type": "command" }),
        ] {
            let before = with(Some(own.clone()));
            assert_eq!(uninstalled(&before).unwrap(), before);
            // And whatever it is, installing keeps it to give it back.
            let back = uninstalled(&installed(&before, RELAY).unwrap()).unwrap();
            assert_eq!(pretty(&back), pretty(&before));
        }
        // Ours, with a previous one that cannot be read back: refused, not dropped.
        let broken = with(Some(
            json!({ "type": "command", "command": format!("{RELAY} statusline --previous !!!") }),
        ));
        assert!(uninstalled(&broken).is_err());
        assert!(installed(&broken, RELAY).is_err());
        let cut = with(Some(
            json!({ "type": "command", "command": format!("{RELAY} statusline --previous") }),
        ));
        assert!(uninstalled(&cut).is_err());
        // Somebody else's command that only mentions the relay's name is not ours.
        let mention = json!({ "type": "command", "command": "echo nook-hook" });
        assert!(!is_ours(&mention) && !is_ours(&json!("nook-hook statusline")));
    }

    #[cfg(windows)]
    #[test]
    fn a_relay_path_that_would_need_quoting_is_refused() {
        let err = installed(
            &with(Some(shell_form())),
            "C:/Users/John Doe/AppData/Local/Nook/bin/nook-hook.exe",
        )
        .unwrap_err();
        assert!(err.contains("Nothing was changed"), "got: {err}");
        for odd in [
            "C:/Users/a&b/nook-hook.exe",
            "C:/Users/$x/nook-hook.exe",
            "C:/Users/é/nook-hook.exe",
            "C:/Users/(x)/nook-hook.exe",
            "",
        ] {
            assert!(relay_word(odd).is_err(), "{odd}");
        }
        assert_eq!(relay_word(RELAY).unwrap(), RELAY);
    }

    #[cfg(windows)]
    #[test]
    fn a_space_path_uses_only_a_shell_neutral_windows_short_path() {
        let long = "C:/Users/John Doe/AppData/Local/NookStandalone/bin/nook-hook-standalone.exe";
        let short = "C:/Users/JOHNDO~1/AppData/Local/NookS~1/bin/nook-hook-standalone.exe";
        assert_eq!(windows_relay_word(long, Some(short)).unwrap(), short);
        assert!(short.contains("nook-hook-standalone.exe"));
        assert!(is_ours(
            &json!({ "type": "command", "command": format!("{short} statusline") })
        ));
        assert!(windows_relay_word(long, None).is_err());
        assert!(windows_relay_word(long, Some("C:/Users/JOHN&1/relay.exe")).is_err());
    }

    #[test]
    fn project_local_status_line_takes_precedence_over_shared_project() {
        let root = Path::new("C:/project");
        let shared = json!({ "statusLine": { "type": "command", "command": "other-status-line" } });
        let local = json!({ "statusLine": { "type": "command", "command": "C:/NookStandalone/nook-hook-standalone.exe statusline" } });
        let effective = project_status_line_from_values(root, Some(&shared), Some(&local)).unwrap();
        assert_eq!(effective.scope, "Project local");
        assert!(effective.standalone);
        let effective = project_status_line_from_values(root, Some(&shared), None).unwrap();
        assert_eq!(effective.scope, "Project");
        assert!(!effective.standalone);
    }

    #[test]
    fn user_status_line_file_is_not_reported_as_a_project_override() {
        let root = Path::new("C:/fixture/home");
        let shared = json!({ "statusLine": { "type": "command", "command": "user-status-line" } });
        let user_file = root.join(".claude/settings.json");
        assert!(project_status_line_from_values_without_user_alias(
            root,
            Some(&shared),
            None,
            &user_file,
        )
        .is_none());
        let local = json!({ "statusLine": { "type": "command", "command": "project-local" } });
        assert_eq!(
            project_status_line_from_values_without_user_alias(
                root,
                Some(&shared),
                Some(&local),
                &user_file,
            )
            .unwrap()
            .scope,
            "Project local"
        );
    }

    #[test]
    fn status_line_ownership_distinguishes_each_nook_build_and_foreign_settings() {
        let original = json!({ "type": "command", "command": "C:/Users/me/AppData/Local/Nook/bin/nook-hook.exe statusline" });
        let standalone = json!({ "type": "command", "command": "C:/Users/me/AppData/Local/NookStandalone/bin/nook-hook-standalone.exe statusline" });
        let dev = json!({ "type": "command", "command": "C:/Users/me/AppData/Local/NookDev/bin/nook-hook-dev.exe statusline" });
        let third_party = json!({ "type": "command", "command": "C:/tools/custom-status.exe" });
        let unknown = json!({ "type": "command", "command": "C:/tools/nook-hook.exe statusline" });

        assert_eq!(owner_of(Some(&original)), StatusLineOwner::Original);
        assert_eq!(owner_of(Some(&standalone)), StatusLineOwner::Standalone);
        assert_eq!(owner_of(Some(&dev)), StatusLineOwner::Dev);
        assert_eq!(owner_of(Some(&third_party)), StatusLineOwner::ThirdParty);
        assert_eq!(owner_of(Some(&unknown)), StatusLineOwner::Unknown);
        assert_eq!(owner_of(None), StatusLineOwner::None);
    }

    #[test]
    fn original_status_line_migration_requires_its_own_confirmation() {
        assert!(check_original_migration_confirmation(true, StatusLineOwner::Original, false).is_err());
        assert!(check_original_migration_confirmation(true, StatusLineOwner::Original, true).is_ok());
        assert!(check_original_migration_confirmation(true, StatusLineOwner::ThirdParty, false).is_ok());
        assert!(check_original_migration_confirmation(false, StatusLineOwner::Original, false).is_ok());
    }

    #[test]
    fn migrating_original_status_line_keeps_and_restores_its_wrapped_user_line() {
        let user_line = exec_form();
        let original = json!({
            "type": "command",
            "command": format!("{RELAY} statusline --previous {}", base64url_encode(user_line.to_string().as_bytes()))
        });
        assert_eq!(owner_of(Some(&original)), StatusLineOwner::Original);
        let before = with(Some(original));
        let migrated = installed(&before, "C:/Users/me/AppData/Local/NookStandalone/bin/nook-hook-standalone.exe").unwrap();
        assert_eq!(owner_of(migrated.get(KEY)), StatusLineOwner::Standalone);
        assert_eq!(previous_of(&migrated[KEY]).unwrap(), Some(user_line.clone()));
        assert_eq!(uninstalled(&migrated).unwrap()[KEY], user_line);
    }

    #[test]
    fn ownership_and_relay_are_reported_for_effective_project_scope() {
        let root = Path::new("C:/project");
        let shared = json!({ "statusLine": { "type": "command", "command": "C:/App/Nook/bin/nook-hook.exe statusline" } });
        let local = json!({ "statusLine": { "type": "command", "command": "C:/App/NookStandalone/bin/nook-hook-standalone.exe statusline" } });
        let effective = project_status_line_from_values(root, Some(&shared), Some(&local)).unwrap();
        assert_eq!(effective.owner, StatusLineOwner::Standalone);
        assert_eq!(effective.relay_path.as_deref(), Some("C:/App/NookStandalone/bin/nook-hook-standalone.exe"));
        assert_eq!(effective.scope, "Project local");
    }

    #[test]
    fn project_scope_scan_uses_only_the_known_root_fixture() {
        let root = std::env::temp_dir().join(format!(
            "nook statusline scope fixture {} {}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let claude = root.join(".claude");
        std::fs::create_dir_all(&claude).unwrap();
        std::fs::write(
            claude.join("settings.json"),
            br#"{"statusLine":{"type":"command","command":"other-status-line"}}"#,
        )
        .unwrap();
        std::fs::write(
            claude.join("settings.local.json"),
            br#"{"statusLine":{"type":"command","command":"nook-hook-standalone.exe statusline"}}"#,
        )
        .unwrap();

        let local = project_status_line(&root).unwrap().unwrap();
        assert_eq!(local.scope, "Project local");
        assert!(local.standalone);
        std::fs::remove_file(claude.join("settings.local.json")).unwrap();
        let shared = project_status_line(&root).unwrap().unwrap();
        assert_eq!(shared.scope, "Project");
        assert!(!shared.standalone);
        std::fs::remove_file(claude.join("settings.json")).unwrap();
        assert!(project_status_line(&root).unwrap().is_none());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn base64url_goes_there_and_back() {
        for (plain, coded) in [
            ("", ""),
            ("f", "Zg"),
            ("fo", "Zm8"),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg"),
            ("fooba", "Zm9vYmE"),
            ("foobar", "Zm9vYmFy"),
        ] {
            assert_eq!(base64url_encode(plain.as_bytes()), coded);
            assert_eq!(base64url_decode(coded).unwrap(), plain.as_bytes());
        }
        assert_eq!(base64url_encode(&[0xFB, 0xFF]), "-_8");
        let all: Vec<u8> = (0..=255).collect();
        assert_eq!(base64url_decode(&base64url_encode(&all)).unwrap(), all);
        assert!(base64url_decode("Zm9v+g").is_none() && base64url_decode("a b").is_none());
        // What the relay's own test decodes (hook/src/statusline.rs): the two agree.
        assert_eq!(
            base64url_encode(br#"{"type":"command","command":"bash ~/.claude/statusline.sh","padding":0}"#),
            "eyJ0eXBlIjoiY29tbWFuZCIsImNvbW1hbmQiOiJiYXNoIH4vLmNsYXVkZS9zdGF0dXNsaW5lLnNoIiwicGFkZGluZyI6MH0"
        );
    }

    /// The part that writes, called from the one test that owns the home
    /// directory (hooks.rs): `path` is a settings.json in a temp directory.
    pub(crate) fn writing_wraps_and_restores_a_status_line(path: &std::path::Path) {
        assert_eq!(hooks::settings_path(), path);
        let original = "{\n  \"model\": \"opus\",\n  \"statusLine\": {\n    \"type\": \"command\",\n    \"command\": \"bash ~/.claude/statusline.sh\",\n    \"padding\": 0\n  },\n  \"theme\": \"dark\"\n}\n";
        std::fs::write(path, original).unwrap();
        assert!(status().other_status_line && !status().installed);

        let plan = match preview(true) {
            Ok(plan) => plan,
            // This machine's relay path needs quoting: the refusal is the result.
            Err(err) => {
                assert!(err.contains("Nothing was changed"), "got: {err}");
                assert_eq!(std::fs::read_to_string(path).unwrap(), original);
                return;
            }
        };
        assert!(
            plan.diff.contains("nook-hook") && plan.diff.contains(PREVIOUS_FLAG),
            "the diff shows the new command"
        );
        let changed: Vec<&str> = plan
            .diff
            .lines()
            .filter(|line| line.starts_with('+') || line.starts_with('-'))
            .collect();
        assert!(
            changed.iter().all(|line| line.contains("\"command\"")),
            "one line changes, the command: {changed:?}"
        );
        // A preview writes nothing.
        assert_eq!(std::fs::read_to_string(path).unwrap(), original);

        let backup = apply(true, &plan.fingerprint).expect("install should succeed");
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), original);
        let now = status();
        assert!(now.installed && now.chained && !now.other_status_line);
        let written: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(
            (
                &written["model"],
                &written["theme"],
                &written[KEY]["padding"]
            ),
            (&json!("opus"), &json!("dark"), &json!(0))
        );

        // A stale fingerprint is refused, as for the hooks.
        assert!(apply(false, &plan.fingerprint)
            .unwrap_err()
            .contains("changed since the preview"));

        // Uninstall: the file is what it was, to the byte.
        let plan = preview(false).unwrap();
        apply(false, &plan.fingerprint).expect("uninstall should succeed");
        assert_eq!(std::fs::read_to_string(path).unwrap(), original);
        assert!(status().other_status_line && !status().installed);
    }
}
