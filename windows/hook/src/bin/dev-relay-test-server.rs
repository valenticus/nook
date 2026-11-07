//! A disposable IPC peer for the Dev relay integration test. This binary's
//! `nook-dev` name intentionally matches the Dev app identity check; it is only
//! built with the `nook-dev-relay` feature and is never bundled by Tauri.

use std::io::{self, Read, Write};

const MAX_LINE: usize = 1 << 20;

fn main() {
    let mut args = std::env::args().skip(1);
    let mode = args.next().unwrap_or_default();
    let Some(endpoint) = args
        .next()
        .filter(|_| matches!(mode.as_str(), "--once" | "--drop"))
    else {
        eprintln!("usage: nook-dev (--once|--drop) <Dev endpoint>");
        std::process::exit(2);
    };
    if let Err(error) = validate_endpoint(&endpoint) {
        eprintln!("Refusing non-Dev endpoint: {error}");
        std::process::exit(2);
    }
    let reply_with_deny = mode == "--once";

    #[cfg(windows)]
    let result = windows_once(&endpoint, reply_with_deny);
    #[cfg(target_os = "linux")]
    let result = linux_once(&endpoint, reply_with_deny);
    #[cfg(not(any(windows, target_os = "linux")))]
    let result: io::Result<()> = Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "unsupported test platform",
    ));

    if let Err(error) = result {
        eprintln!("Dev relay test server failed: {error}");
        std::process::exit(1);
    }
}

fn validate_endpoint(endpoint: &str) -> io::Result<()> {
    #[cfg(windows)]
    let is_dev = endpoint.starts_with(r"\\.\pipe\nook-dev-");
    #[cfg(target_os = "linux")]
    let is_dev = std::path::Path::new(endpoint)
        .file_name()
        .and_then(std::ffi::OsStr::to_str)
        == Some("nook-dev.sock");
    #[cfg(not(any(windows, target_os = "linux")))]
    let is_dev = false;
    if is_dev {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "test peer accepts only the build-specific Dev endpoint",
        ))
    }
}

fn exchange(stream: &mut (impl Read + Write), reply_with_deny: bool) -> io::Result<()> {
    let mut line = Vec::new();
    let mut chunk = [0u8; 4096];
    while !line.contains(&b'\n') {
        let count = stream.read(&mut chunk)?;
        if count == 0 {
            break;
        }
        if line.len().saturating_add(count) > MAX_LINE {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "payload exceeds 1 MiB",
            ));
        }
        line.extend_from_slice(&chunk[..count]);
    }
    let payload: serde_json::Value = serde_json::from_slice(&line)?;
    println!("{}", payload);
    io::stdout().flush()?;

    // The test peer always denies; it has no agent and cannot authorize any
    // action. This exercises the reply path without running a permission.
    if reply_with_deny
        && payload
            .get("hook_event_name")
            .and_then(serde_json::Value::as_str)
            == Some("PermissionRequest")
    {
        stream.write_all(b"deny\n")?;
        stream.flush()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_peer_refuses_the_production_endpoint() {
        #[cfg(windows)]
        let production = r"\\.\pipe\nook-S-1-5-21-fixture";
        #[cfg(target_os = "linux")]
        let production = "/run/user/1000/nook.sock";
        #[cfg(not(any(windows, target_os = "linux")))]
        let production = "nook.sock";
        #[cfg(windows)]
        let dev = r"\\.\pipe\nook-dev-S-1-5-21-fixture";
        #[cfg(target_os = "linux")]
        let dev = "/run/user/1000/nook-dev.sock";
        #[cfg(not(any(windows, target_os = "linux")))]
        let dev = "nook-dev.sock";

        assert!(super::validate_endpoint(production).is_err());
        assert!(super::validate_endpoint(dev).is_ok());
    }
}

#[cfg(windows)]
fn windows_once(endpoint: &str, reply_with_deny: bool) -> io::Result<()> {
    use std::os::windows::io::FromRawHandle;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows::Win32::Storage::FileSystem::{FILE_FLAGS_AND_ATTRIBUTES, PIPE_ACCESS_DUPLEX};
    use windows::Win32::System::Pipes::{ConnectNamedPipe, CreateNamedPipeW, NAMED_PIPE_MODE};

    let wide: Vec<u16> = endpoint.encode_utf16().chain(std::iter::once(0)).collect();
    let handle = unsafe {
        CreateNamedPipeW(
            PCWSTR(wide.as_ptr()),
            FILE_FLAGS_AND_ATTRIBUTES(PIPE_ACCESS_DUPLEX.0 | 0x0008_0000), // first instance: refuse a live Dev listener
            NAMED_PIPE_MODE(0),
            1,
            MAX_LINE as u32,
            MAX_LINE as u32,
            0,
            None,
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    println!("READY");
    io::stdout().flush()?;
    let connected = unsafe { ConnectNamedPipe(handle, None) };
    if let Err(error) = connected {
        // The relay can connect between READY and ConnectNamedPipe.
        if error.code().0 as u32 != 0x8007_0217 {
            unsafe {
                let _ = CloseHandle(handle);
            }
            return Err(io::Error::other(error));
        }
    }
    let mut stream = unsafe { std::fs::File::from_raw_handle(handle.0 as _) };
    exchange(&mut stream, reply_with_deny)
}

#[cfg(target_os = "linux")]
fn linux_once(endpoint: &str, reply_with_deny: bool) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::net::UnixListener;

    let listener = UnixListener::bind(endpoint)?;
    std::fs::set_permissions(endpoint, std::fs::Permissions::from_mode(0o600))?;
    println!("READY");
    io::stdout().flush()?;
    let (mut stream, _) = listener.accept()?;
    exchange(&mut stream, reply_with_deny)
}
