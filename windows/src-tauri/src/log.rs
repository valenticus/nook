// Small append-only log at %LOCALAPPDATA%\Nook\nook.log (Windows) or
// ~/.local/share/nook/nook.log (Linux) — the equivalent of nbLog() in
// HookServer.swift. Nothing leaves the machine.

use std::io::Write;
use std::path::PathBuf;

use crate::platform;
#[cfg(not(test))]
use crate::settings;

/// One whole log line, newline included: `YYYY-MM-DD HH:MM:SS message`.
fn format_line(t: &platform::LocalTime, message: &str) -> String {
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02} {message}\n",
        t.year, t.month, t.day, t.hour, t.minute, t.second
    )
}

pub fn line(message: impl AsRef<str>) {
    let text = format_line(&platform::local_time(), message.as_ref());
    let dir = log_dir();
    if platform::ensure_private_dir(&dir).is_err() {
        return;
    }
    let path = dir.join("nook.log");
    // Keep it from growing forever: start fresh past ~1 MB.
    if std::fs::metadata(&path)
        .map(|m| m.len() > 1_000_000)
        .unwrap_or(false)
    {
        let _ = std::fs::remove_file(&path);
    }
    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true);
    // Readable by us only, like the macOS log.
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    if let Ok(mut file) = options.open(path) {
        // One write for the whole line: writeln! on a File issues one write
        // per piece, and two threads logging at once interleaved them.
        let _ = file.write_all(text.as_bytes());
    }
}

fn log_dir() -> PathBuf {
    #[cfg(test)]
    {
        // Unit tests must never append to the user's production or Dev log.
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../target/nook-test-logs")
    }
    #[cfg(not(test))]
    {
        settings::local_dir()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_line_is_stamp_message_and_newline() {
        let t = platform::LocalTime {
            year: 2026,
            month: 10,
            day: 6,
            hour: 18,
            minute: 4,
            second: 5,
        };
        assert_eq!(
            format_line(&t, "metrics: sampling resumed"),
            "2026-10-06 18:04:05 metrics: sampling resumed\n"
        );
    }

    #[test]
    fn unit_test_logs_stay_inside_the_workspace_test_target() {
        assert!(log_dir().starts_with(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../target")));
        assert!(!log_dir().ends_with("Nook"));
        assert!(!log_dir().ends_with("NookDev"));
    }
}
