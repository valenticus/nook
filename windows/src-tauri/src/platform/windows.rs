// Windows: Win32 for the island window and the cursor, %APPDATA% for files.

use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::time::{Duration, Instant};

use tauri::WebviewWindow;

use std::collections::HashMap;

use ::windows::core::{BOOL, PWSTR};
use ::windows::Win32::Foundation::{
    CloseHandle, LocalFree, HANDLE, HLOCAL, HWND, LPARAM, POINT, RECT,
};
#[cfg(feature = "nook-dev")]
use ::windows::Win32::Foundation::{GetLastError, SetLastError, WIN32_ERROR};
use ::windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, ScreenToClient, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use ::windows::Win32::Security::Authorization::ConvertSidToStringSidW;
use ::windows::Win32::Security::{
    GetTokenInformation, TokenElevation, TokenUser, TOKEN_ELEVATION, TOKEN_QUERY, TOKEN_USER,
};
use ::windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
};
use ::windows::Win32::System::SystemInformation::GetLocalTime;
use ::windows::Win32::System::Threading::{
    AttachThreadInput, GetCurrentProcess, GetCurrentProcessId, GetCurrentThreadId, OpenProcess,
    OpenProcessToken, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use ::windows::Win32::UI::Shell::{
    IVirtualDesktopManager, SHQueryUserNotificationState, VirtualDesktopManager, QUNS_BUSY,
    QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
};
use ::windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, ChildWindowFromPointEx, EnumWindows, GetAncestor, GetClassNameW,
    GetCursorPos, GetForegroundWindow, GetParent, GetWindow, GetWindowLongPtrW, GetWindowRect,
    GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, IsZoomed,
    SetForegroundWindow, SetWindowLongPtrW, ShowWindow, WindowFromPoint, CWP_SKIPDISABLED,
    CWP_SKIPINVISIBLE, CWP_SKIPTRANSPARENT, GA_ROOT, GWL_EXSTYLE, GWL_STYLE, GW_OWNER, SW_RESTORE,
    WS_CAPTION, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};
#[cfg(feature = "nook-dev")]
use ::windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, GetTopWindow, GW_HWNDNEXT, WS_EX_LAYERED, WS_EX_TOPMOST, WS_EX_TRANSPARENT,
};

use super::LocalTime;
use crate::fullscreen::{self, Foreground, Notification};
use crate::target::Window;

/// Relay name is fixed by the independently compiled app flavor.
#[cfg(feature = "nook-dev")]
pub const HOOK_EXE: &str = "nook-hook-dev.exe";
#[cfg(feature = "nook-standalone")]
pub const HOOK_EXE: &str = "nook-hook-standalone.exe";
#[cfg(not(any(feature = "nook-dev", feature = "nook-standalone")))]
pub const HOOK_EXE: &str = "nook-hook.exe";

/// Environment variable holding the home directory.
pub const HOME_VAR: &str = "USERPROFILE";

/// Keeps spawned helpers from flashing a console window.
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// ── Files ─────────────────────────────────────────────────────────────────────

/// %APPDATA%\Nook — preferences.
pub fn config_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let dir = if cfg!(feature = "nook-dev") {
        "NookDev"
    } else if cfg!(feature = "nook-standalone") {
        "NookStandalone"
    } else {
        "Nook"
    };
    base.join(dir)
}

/// %LOCALAPPDATA%\Nook — where nook-hook.exe and the log live.
pub fn local_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let dir = if cfg!(feature = "nook-dev") {
        "NookDev"
    } else if cfg!(feature = "nook-standalone") {
        "NookStandalone"
    } else {
        "Nook"
    };
    base.join(dir)
}

/// %APPDATA% and %LOCALAPPDATA% are already private to the user.
pub fn ensure_private_dir(dir: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)
}

/// Nothing to set up before the webview starts.
pub fn prepare_environment() {}

pub fn local_time() -> LocalTime {
    let t = unsafe { GetLocalTime() };
    LocalTime {
        year: t.wYear.into(),
        month: t.wMonth.into(),
        day: t.wDay.into(),
        hour: t.wHour.into(),
        minute: t.wMinute.into(),
        second: t.wSecond.into(),
    }
}

// ── Processes ─────────────────────────────────────────────────────────────────

/// Spawned helpers must never flash a console window.
pub fn no_console(cmd: &mut Command) -> &mut Command {
    cmd.creation_flags(CREATE_NO_WINDOW)
}

pub fn open_url(url: &str) {
    let _ =
        no_console(Command::new("rundll32.exe").args(["url.dll,FileProtocolHandler", url])).spawn();
}

pub fn reveal_folder(path: &str) {
    let _ = Command::new("explorer").arg(path).spawn();
}

/// A new Claude Code session in `dir`, in a Windows Terminal window: `wt.exe -d <dir> claude`,
/// each argument given on its own, never one string. `dir` is an existing absolute folder that
/// projects.rs has already held to its rules (no quote, `%`, `;`...): Windows Terminal is the one
/// that reads `;` as the end of a command. False when `wt.exe` is not there or did not start.
pub fn launch_claude_session(dir: &str) -> bool {
    let mut cmd = Command::new("wt.exe");
    cmd.args(["-d", dir, "claude"]);
    no_console(&mut cmd).spawn().is_ok()
}

/// Our own `where`: walks %PATH% against %PATHEXT%, no shell involved.
/// Rust quotes arguments correctly for `.cmd`/`.bat` targets since 1.77, so
/// spawning `code.cmd` directly is safe.
pub fn find_on_path(stem: &str) -> Option<PathBuf> {
    let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
    let dirs = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&dirs) {
        for ext in exts.split(';').filter(|e| !e.is_empty()) {
            let candidate = dir.join(format!("{stem}{}", ext.to_lowercase()));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

// ── Who we are ────────────────────────────────────────────────────────────────
//
// Named pipes share one machine-wide namespace, so the SID in the name is what
// keeps two accounts on the same machine from ever meeting on `nook-*`.
// nook-hook computes the same string (hook/src/win.rs) and additionally checks
// that the process serving the pipe really is us.

/// The SID of the account this process runs as, as `S-1-5-21-…`.
pub fn current_user_sid() -> Option<String> {
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).ok()?;

        // First call sizes the buffer, second fills it.
        let mut needed = 0u32;
        let _ = GetTokenInformation(token, TokenUser, None, 0, &mut needed);
        if needed == 0 {
            let _ = CloseHandle(token);
            return None;
        }
        let mut buf = vec![0u8; needed as usize];
        let ok = GetTokenInformation(
            token,
            TokenUser,
            Some(buf.as_mut_ptr().cast()),
            needed,
            &mut needed,
        )
        .is_ok();
        let _ = CloseHandle(token);
        if !ok {
            return None;
        }

        let user = &*(buf.as_ptr() as *const TOKEN_USER);
        let mut text = PWSTR::null();
        ConvertSidToStringSidW(user.User.Sid, &mut text).ok()?;
        let sid = text.to_string().ok();
        let _ = LocalFree(Some(HLOCAL(text.0 as *mut _)));
        sid
    }
}

// -- Cursor ----------------------------------------------------------------

/// The poll reads the cursor and updates click-through while the island is shown.
pub const CURSOR_POLL: bool = true;

/// Cursor position in physical screen pixels.
pub fn cursor_physical() -> Option<(f64, f64)> {
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p).ok()? };
    Some((p.x as f64, p.y as f64))
}

// ── Island window ─────────────────────────────────────────────────────────────

fn hwnd_of(win: &WebviewWindow) -> Option<HWND> {
    let raw = win.hwnd().ok()?.0 as isize;
    if raw == 0 {
        return None;
    }
    Some(HWND(raw as *mut _))
}

/// Read back the effective WS_EX_TRANSPARENT bit after Tao's queued window update.
#[cfg(feature = "nook-dev")]
pub fn ignore_cursor_events_applied(win: &WebviewWindow) -> Option<bool> {
    let style = read_extended_style(hwnd_of(win)?)?;
    Some(style & WS_EX_TRANSPARENT.0 != 0)
}

#[cfg(feature = "nook-dev")]
fn read_extended_style(hwnd: HWND) -> Option<u32> {
    unsafe {
        SetLastError(WIN32_ERROR(0));
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        if style == 0 && GetLastError().0 != 0 {
            return None;
        }
        Some(style as u32)
    }
}

#[cfg(feature = "nook-dev")]
fn is_above_in_z_order(
    nook_topmost: bool,
    nook_rank: usize,
    other_topmost: bool,
    other_rank: usize,
) -> bool {
    if nook_topmost != other_topmost {
        return other_topmost;
    }
    other_rank < nook_rank
}

#[cfg(feature = "nook-dev")]
fn hwnd_label(hwnd: HWND) -> String {
    format!("0x{:X}", hwnd.0 as usize)
}

#[cfg(feature = "nook-dev")]
fn hwnd_rect(hwnd: HWND) -> String {
    let mut rect = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok() {
        format!("{},{},{},{}", rect.left, rect.top, rect.right, rect.bottom)
    } else {
        "unknown".into()
    }
}

#[cfg(feature = "nook-dev")]
fn window_class(hwnd: HWND) -> String {
    let mut class = [0u16; 128];
    let len = unsafe { GetClassNameW(hwnd, &mut class).max(0) as usize };
    String::from_utf16_lossy(&class[..len.min(class.len())])
}

#[cfg(feature = "nook-dev")]
fn window_process(hwnd: HWND) -> String {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    image_name(pid).unwrap_or_else(|| "unknown".into())
}

#[cfg(feature = "nook-dev")]
fn window_identity(hwnd: HWND) -> String {
    format!("{}/{}", window_process(hwnd), window_class(hwnd))
}

#[cfg(feature = "nook-dev")]
fn window_input_styles(hwnd: HWND) -> String {
    read_extended_style(hwnd).map_or_else(
        || "unknown".into(),
        |style| {
            format!(
                "transparent={},layered={},noactivate={},topmost={}",
                style & WS_EX_TRANSPARENT.0 != 0,
                style & WS_EX_LAYERED.0 != 0,
                style & WS_EX_NOACTIVATE.0 != 0,
                style & WS_EX_TOPMOST.0 != 0,
            )
        },
    )
}

#[cfg(feature = "nook-dev")]
unsafe extern "system" fn collect_child(hwnd: HWND, data: LPARAM) -> BOOL {
    let children = unsafe { &mut *(data.0 as *mut Vec<HWND>) };
    if children.len() < 12 {
        children.push(hwnd);
    }
    BOOL::from(true)
}

#[cfg(feature = "nook-dev")]
fn child_windows(hwnd: HWND) -> String {
    let mut children = Vec::new();
    let _ = unsafe {
        EnumChildWindows(
            Some(hwnd),
            Some(collect_child),
            LPARAM(&mut children as *mut _ as isize),
        )
    };
    if children.is_empty() {
        return "none".into();
    }
    children
        .into_iter()
        .map(|child| {
            format!(
                "{}:{}:{}:style={}",
                hwnd_label(child),
                window_class(child),
                hwnd_rect(child),
                window_input_styles(child)
            )
        })
        .collect::<Vec<_>>()
        .join(";")
}

#[cfg(feature = "nook-dev")]
fn window_parent_chain(hwnd: HWND) -> String {
    let mut chain = Vec::new();
    let mut current = hwnd;
    for _ in 0..8 {
        chain.push(format!(
            "{}:{}:{}:style={}",
            hwnd_label(current),
            window_class(current),
            hwnd_rect(current),
            window_input_styles(current)
        ));
        let Ok(parent) = (unsafe { GetParent(current) }) else {
            break;
        };
        if parent.is_invalid() || parent == current {
            break;
        }
        current = parent;
    }
    chain.join("<-")
}

#[cfg(feature = "nook-dev")]
fn child_hit_path(parent: HWND, screen_point: POINT, skip_transparent: bool) -> String {
    let mut path = Vec::new();
    let mut current = parent;
    for _ in 0..8 {
        let mut client_point = screen_point;
        if !unsafe { ScreenToClient(current, &mut client_point) }.as_bool() {
            break;
        }
        let mut flags = CWP_SKIPINVISIBLE | CWP_SKIPDISABLED;
        if skip_transparent {
            flags |= CWP_SKIPTRANSPARENT;
        }
        let child = unsafe { ChildWindowFromPointEx(current, client_point, flags) };
        if child.is_invalid() || child == current {
            break;
        }
        path.push(format!(
            "{}:{}:{}:style={}",
            hwnd_label(child),
            window_class(child),
            hwnd_rect(child),
            window_input_styles(child)
        ));
        current = child;
    }
    if path.is_empty() {
        "none".into()
    } else {
        path.join("<-")
    }
}

#[cfg(feature = "nook-dev")]
fn z_order_windows() -> Vec<HWND> {
    let mut out = Vec::new();
    let Ok(mut hwnd) = (unsafe { GetTopWindow(None) }) else {
        return out;
    };
    for _ in 0..512 {
        if hwnd.is_invalid() {
            break;
        }
        out.push(hwnd);
        let Ok(next) = (unsafe { GetWindow(hwnd, GW_HWNDNEXT) }) else {
            break;
        };
        if next == hwnd {
            break;
        }
        hwnd = next;
    }
    out
}

/// Minimal native observation for the Dev pointer-gate trace. It records no
/// title, window text, PID, or executable path.
#[cfg(feature = "nook-dev")]
pub struct PointerGateSnapshot {
    pub ignore_applied: Option<bool>,
    pub point_hits_island: Option<bool>,
    pub foreground: String,
    pub native_windows: String,
}

#[cfg(feature = "nook-dev")]
pub fn pointer_gate_snapshot(
    win: &WebviewWindow,
    cursor_x: f64,
    cursor_y: f64,
) -> PointerGateSnapshot {
    let island = hwnd_of(win);
    let point = POINT {
        x: cursor_x.round() as i32,
        y: cursor_y.round() as i32,
    };
    let under = unsafe { WindowFromPoint(point) };
    let root = if under.is_invalid() {
        under
    } else {
        unsafe { GetAncestor(under, GA_ROOT) }
    };
    let point_hits_island = island.map(|hwnd| !root.is_invalid() && root == hwnd);
    let front = unsafe { GetForegroundWindow() };
    let foreground = if front.is_invalid() {
        "unknown/unknown".to_string()
    } else {
        format!("{} {}", hwnd_label(front), window_identity(front))
    };
    let point_hwnd = if under.is_invalid() {
        "none".into()
    } else {
        hwnd_label(under)
    };
    let root_hwnd = if root.is_invalid() {
        "none".into()
    } else {
        hwnd_label(root)
    };
    let point_identity = if root.is_invalid() {
        "unknown/unknown".into()
    } else {
        window_identity(root)
    };
    let windows = z_order_windows();
    let nook_rank = island.and_then(|hwnd| windows.iter().position(|item| *item == hwnd));
    let nook_style = island.and_then(read_extended_style);
    let mut vlc_count = 0usize;
    let flags = |style: u32| {
        format!(
            "topmost={},transparent={},noactivate={},layered={}",
            style & WS_EX_TOPMOST.0 != 0,
            style & WS_EX_TRANSPARENT.0 != 0,
            style & WS_EX_NOACTIVATE.0 != 0,
            style & WS_EX_LAYERED.0 != 0,
        )
    };
    let mut vlc_windows = Vec::new();
    let mut vlc_above_nook = None;
    for (rank, hwnd) in windows.iter().enumerate() {
        if !window_process(*hwnd).eq_ignore_ascii_case("vlc.exe") {
            continue;
        }
        vlc_count += 1;
        let Some(style) = read_extended_style(*hwnd) else {
            continue;
        };
        let topmost = style & WS_EX_TOPMOST.0 != 0;
        let above = nook_rank.zip(nook_style).map(|(nook_rank, nook_style)| {
            is_above_in_z_order(nook_style & WS_EX_TOPMOST.0 != 0, nook_rank, topmost, rank)
        });
        if above == Some(true) {
            vlc_above_nook = Some(true);
        } else if vlc_above_nook.is_none() {
            vlc_above_nook = above;
        }
        if vlc_windows.len() < 8 {
            vlc_windows.push(format!(
                "{}:{}:z={rank}:{}",
                hwnd_label(*hwnd),
                window_class(*hwnd),
                flags(style)
            ));
        }
    }
    if vlc_windows.is_empty() {
        vlc_windows.push("none".into());
    }
    let island_bounds = island.map_or_else(|| "unknown".into(), hwnd_rect);
    let island_owner = island
        .and_then(|hwnd| unsafe { GetWindow(hwnd, GW_OWNER).ok() })
        .map_or_else(
            || "none".into(),
            |hwnd| {
                format!(
                    "{}:{}:{}",
                    hwnd_label(hwnd),
                    window_class(hwnd),
                    hwnd_rect(hwnd)
                )
            },
        );
    let island_children = island.map_or_else(|| "unknown".into(), child_windows);
    let child_hit_all = island.map_or_else(
        || "unknown".into(),
        |hwnd| child_hit_path(hwnd, point, false),
    );
    let child_hit_skip_transparent = island.map_or_else(
        || "unknown".into(),
        |hwnd| child_hit_path(hwnd, point, true),
    );
    let point_chain = if under.is_invalid() {
        "none".into()
    } else {
        window_parent_chain(under)
    };
    let native_windows = format!(
        "nook_hwnd={} nook_bounds={} nook_owner={} nook_children=[{}] nook_styles={} nook_z={:?} vlc_above_nook={:?} vlc_window_count={} vlc_windows=[{}] child_hit_all=[{}] child_hit_skip_transparent=[{}] point_hwnd={} point_root={} point_chain=[{}] point_target={} ",
        island.map_or_else(|| "unknown".into(), hwnd_label),
        island_bounds, island_owner, island_children,
        nook_style.map_or_else(|| "unknown".into(), flags),
        nook_rank, vlc_above_nook, vlc_count, vlc_windows.join(";"), child_hit_all, child_hit_skip_transparent, point_hwnd, root_hwnd, point_chain, point_identity,
    );
    PointerGateSnapshot {
        ignore_applied: island.and_then(|_| ignore_cursor_events_applied(win)),
        point_hits_island,
        foreground,
        native_windows,
    }
}

/// Cheap Dev-only readback for a pointer point inside the IslandRect. The
/// caller expands this to full HWND/style diagnostics only when Windows hits
/// another root window despite the Island being expected to receive input.
#[cfg(feature = "nook-dev")]
pub fn point_hits_island(win: &WebviewWindow, cursor_x: f64, cursor_y: f64) -> Option<bool> {
    let island = hwnd_of(win)?;
    let point = POINT {
        x: cursor_x.round() as i32,
        y: cursor_y.round() as i32,
    };
    let under = unsafe { WindowFromPoint(point) };
    if under.is_invalid() {
        return Some(false);
    }
    let root = unsafe { GetAncestor(under, GA_ROOT) };
    Some(!root.is_invalid() && root == island)
}

/// WS_EX_NOACTIVATE keeps clicks from stealing focus; WS_EX_TOOLWINDOW keeps the
/// island out of Alt-Tab.
pub fn make_non_activating(win: &WebviewWindow) {
    let Some(hwnd) = hwnd_of(win) else { return };
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let want = ex | WS_EX_NOACTIVATE.0 as isize | WS_EX_TOOLWINDOW.0 as isize;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, want);
    }
}

/// The agents list takes no focus and stays out of Alt-Tab, as the island does.
pub fn prepare_list_window(win: &WebviewWindow) {
    make_non_activating(win);
}

/// The window that had the keyboard when the island took it, to hand it back to.
static KEYBOARD_FROM: AtomicIsize = AtomicIsize::new(0);

/// Temporarily allow activation so the island can take the keyboard: a text
/// field to type in, Escape in the large panel, the arrows in the sidebar.
/// Giving it up hands the keyboard back to the window it was taken from —
/// putting WS_EX_NOACTIVATE back does not, on its own, move the focus anywhere,
/// and the user would have to click their own window to type in it again.
pub fn set_activating(win: &WebviewWindow, activating: bool) {
    let Some(hwnd) = hwnd_of(win) else { return };
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let front = GetForegroundWindow();
        let want = if activating {
            // Asked twice in a row, the island already has it: what is kept is
            // still the window it was first taken from.
            if front != hwnd {
                KEYBOARD_FROM.store(front.0 as isize, Ordering::Relaxed);
            }
            ex & !(WS_EX_NOACTIVATE.0 as isize)
        } else {
            ex | WS_EX_NOACTIVATE.0 as isize
        };
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, want);
        if activating {
            return;
        }
        // Only when the island still has it: a user who clicked another window
        // in the meantime has already put the keyboard where they want it.
        let from = HWND(KEYBOARD_FROM.swap(0, Ordering::Relaxed) as *mut _);
        if front == hwnd && !from.is_invalid() && IsWindow(Some(from)).as_bool() {
            let _ = SetForegroundWindow(from);
        }
    }
}

/// Shows the island again after it was hidden, without taking the keyboard
/// from whoever has it. tao drops the "created unfocused" mark once the window
/// exists, so every later show is a plain SW_SHOW, which activates: with the
/// permission a hotkey or a tray click gives, the island would come to the
/// foreground and the webview take the focus. The window in front before is
/// put back in front. On the main thread only: from another one the show is
/// queued, and this would look before it happened.
pub fn show_inactive(win: &WebviewWindow) {
    let before = unsafe { GetForegroundWindow() };
    let _ = win.show();
    let Some(hwnd) = hwnd_of(win) else { return };
    unsafe {
        if before != hwnd
            && !before.is_invalid()
            && GetForegroundWindow() == hwnd
            && IsWindow(Some(before)).as_bool()
        {
            let _ = SetForegroundWindow(before);
        }
    }
}

/// There is no compositor to anchor to: the window is placed by position alone (dock.rs).
pub fn set_dock(_win: &WebviewWindow, _dock: crate::dock::Dock) {}

// ── On every virtual desktop ──────────────────────────────────────────────────
//
// tao's `set_visible_on_all_workspaces` does nothing on Windows, and Windows
// has no documented "pin this window" call for a program's own window: a window
// stays on the desktop it was made on. What is documented is IVirtualDesktopManager,
// which may move a window *of the calling process* to a desktop. So the agents
// list is moved to whichever desktop is in front, half a second after it changed.

/// The window the follower looks after, as a raw handle; 0 when none is to be.
static DESKTOP_WATCH: AtomicIsize = AtomicIsize::new(0);
/// A follower thread is running. There is never more than one: asked again, it
/// is pointed at the new window (or told to stop) and carries on.
static DESKTOP_RUNNING: AtomicBool = AtomicBool::new(false);
/// How often the list's desktop is looked at while it is on show.
const DESKTOP_LOOK: Duration = Duration::from_millis(500);

/// Keeps a window on the desktop in front, while `on`; stops when not. One
/// look every half second, on one thread that ends by itself once the list is
/// hidden. Called again for the window it already follows, it starts nothing.
/// The island is not one of its users.
pub fn follow_desktops(win: &WebviewWindow, on: bool) {
    let hwnd = hwnd_of(win)
        .filter(|_| on)
        .map_or(0, |hwnd| hwnd.0 as isize);
    DESKTOP_WATCH.store(hwnd, Ordering::SeqCst);
    if hwnd == 0 || DESKTOP_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(|| loop {
        watch_desktops();
        DESKTOP_RUNNING.store(false, Ordering::SeqCst);
        // Asked again between the last look and the flag going down: this thread carries on.
        if DESKTOP_WATCH.load(Ordering::SeqCst) == 0 || DESKTOP_RUNNING.swap(true, Ordering::SeqCst)
        {
            break;
        }
    });
}

/// The follower's thread: looks until there is no window to follow.
fn watch_desktops() {
    // The manager is made on this thread and used only here. A thread that
    // was already in another apartment is fine too: the call is just not undone.
    let initialised = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok();
    let manager = unsafe {
        CoCreateInstance::<_, IVirtualDesktopManager>(&VirtualDesktopManager, None, CLSCTX_ALL)
    }
    .ok();
    if let Some(manager) = manager {
        loop {
            let raw = DESKTOP_WATCH.load(Ordering::SeqCst);
            if raw == 0 {
                break;
            }
            move_to_current_desktop(&manager, HWND(raw as *mut _));
            std::thread::sleep(DESKTOP_LOOK);
        }
    }
    if initialised {
        unsafe { CoUninitialize() };
    }
}

/// The top-level window under the cursor, if there is one.
fn window_under_cursor() -> Option<HWND> {
    unsafe {
        let mut at = POINT::default();
        GetCursorPos(&mut at).ok()?;
        let under = WindowFromPoint(at);
        if under.is_invalid() {
            return None;
        }
        Some(GetAncestor(under, GA_ROOT)).filter(|root| !root.is_invalid())
    }
}

/// One look: when the window is not on the desktop in front, it is moved to the
/// desktop of a window that is: the one with the keyboard or, when that is not
/// on this desktop or will not say (an empty desktop has only the shell, the
/// taskbar), the one under the cursor. Neither, and it waits for the next look.
/// Any call that fails leaves things as they are. Nothing here takes the focus.
fn move_to_current_desktop(manager: &IVirtualDesktopManager, hwnd: HWND) {
    // What the manager says of a window; `default` when it cannot say.
    let here = |window: HWND, default: bool| {
        unsafe { manager.IsWindowOnCurrentVirtualDesktop(window) }
            .map_or(default, |on| on.as_bool())
    };
    unsafe {
        if !IsWindow(Some(hwnd)).as_bool() || here(hwnd, true) {
            return;
        }
        for reference in [Some(GetForegroundWindow()), window_under_cursor()]
            .into_iter()
            .flatten()
        {
            if reference.is_invalid() || reference == hwnd || !here(reference, false) {
                continue;
            }
            if let Ok(desktop) = manager.GetWindowDesktopId(reference) {
                if manager.MoveWindowToDesktop(hwnd, &desktop).is_ok() {
                    return;
                }
            }
        }
    }
}
// ── Full-screen apps ──────────────────────────────────────────────────────────

fn rect_of(r: RECT) -> fullscreen::Rect {
    fullscreen::Rect {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
    }
}

/// The window in front, as fullscreen.rs wants it described. None when there
/// is none, or when the system will not say where it is.
fn foreground(island: Option<HWND>) -> Option<Foreground> {
    unsafe {
        let front = GetForegroundWindow();
        if front.is_invalid() {
            return None;
        }
        let mut rect = RECT::default();
        GetWindowRect(front, &mut rect).ok()?;
        let monitor = MonitorFromWindow(front, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return None;
        }
        let mut class = [0u16; 128];
        let len = GetClassNameW(front, &mut class).max(0) as usize;
        let mut pid = 0u32;
        GetWindowThreadProcessId(front, Some(&mut pid));
        let captioned = GetWindowLongPtrW(front, GWL_STYLE) as u32 & WS_CAPTION.0 == WS_CAPTION.0;
        let maximised = IsZoomed(front).as_bool();
        Some(Foreground {
            rect: rect_of(rect),
            monitor: rect_of(info.rcMonitor),
            class: String::from_utf16_lossy(&class[..len.min(class.len())]),
            process: image_name(pid).unwrap_or_default(),
            own: pid == GetCurrentProcessId(),
            // With no island window to compare with, its display is taken to be this one.
            on_island_display: island.is_none_or(|island| {
                MonitorFromWindow(island, MONITOR_DEFAULTTONEAREST) == monitor
            }),
            framed_maximised: maximised && captioned,
            maximised,
            captioned,
        })
    }
}

/// True when a full-screen app is in front on the island's display: a few
/// calls into the system, no window is enumerated. The rule is fullscreen.rs's.
pub fn fullscreen_in_front(island: Option<&WebviewWindow>) -> bool {
    fullscreen_verdict(island).0
}

/// The same, with what it was decided on, for the log: the window in front
/// (its class and its program's name, nothing else) and the shell's word.
pub fn fullscreen_verdict(island: Option<&WebviewWindow>) -> (bool, String) {
    let notification = match unsafe { SHQueryUserNotificationState() } {
        Ok(state) if state == QUNS_BUSY => Notification::Busy,
        Ok(state) if state == QUNS_RUNNING_D3D_FULL_SCREEN => Notification::D3dFullScreen,
        Ok(state) if state == QUNS_PRESENTATION_MODE => Notification::Presentation,
        Ok(_) => Notification::Normal,
        Err(_) => Notification::Unknown,
    };
    let front = foreground(island.and_then(hwnd_of));
    let full = fullscreen::is_fullscreen(front.as_ref(), notification);
    let said = match &front {
        Some(f) if cfg!(feature = "nook-dev") => format!(
            "front class={} process={} rect={},{},{},{} display={},{},{},{} maximised={} captioned={} shell={notification:?}",
            f.class, f.process, f.rect.left, f.rect.top, f.rect.right, f.rect.bottom,
            f.monitor.left, f.monitor.top, f.monitor.right, f.monitor.bottom, f.maximised, f.captioned
        ),
        Some(f) => format!(
            "front class={} process={} rect={},{},{},{} display={},{},{},{} framed_maximised={} shell={notification:?}",
            f.class, f.process, f.rect.left, f.rect.top, f.rect.right, f.rect.bottom,
            f.monitor.left, f.monitor.top, f.monitor.right, f.monitor.bottom, f.framed_maximised
        ),
        None => format!("no window in front, shell={notification:?}"),
    };
    (full, said)
}

/// Click-through here is the poll's WS_EX_TRANSPARENT toggle, not a region.
pub fn set_input_region(_win: &WebviewWindow, _rect: Option<(f64, f64, f64, f64)>) {}

// ── Going to a session's window ───────────────────────────────────────────────
//
// What to bring forward is decided in target.rs, from this: the windows there
// are, and the program a pid runs today.

/// VS Code and Cursor say the same things in a session's environment: which
/// of the two it is comes from the processes the relay names, or not at all.
pub const EDITOR_FROM_ENV: bool = false;

/// The name of the image a process runs — `Code.exe`, never its path. None
/// when the process is gone or will not say.
pub fn image_name(pid: u32) -> Option<String> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let read = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut len,
        )
        .is_ok();
        let _ = CloseHandle(process);
        if !read {
            return None;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        path.rsplit(['\\', '/'])
            .next()
            .filter(|name| !name.is_empty())
            .map(str::to_string)
    }
}

/// Every top-level window, the one last used first — the order the system
/// lists them in — each with the program it answers for.
pub fn top_windows() -> Vec<Window> {
    unsafe extern "system" fn collect(hwnd: HWND, out: LPARAM) -> BOOL {
        let out = unsafe { &mut *(out.0 as *mut Vec<Window>) };
        let mut pid = 0u32;
        let mut class = [0u16; 128];
        let mut title = [0u16; 512];
        let (class_len, title_len) = unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            (
                GetClassNameW(hwnd, &mut class).max(0) as usize,
                GetWindowTextW(hwnd, &mut title).max(0) as usize,
            )
        };
        out.push(Window {
            hwnd: hwnd.0 as isize,
            pid,
            image: String::new(),
            class: String::from_utf16_lossy(&class[..class_len]),
            title: String::from_utf16_lossy(&title[..title_len]),
            visible: unsafe { IsWindowVisible(hwnd) }.as_bool(),
            owner: unsafe { GetWindow(hwnd, GW_OWNER) }
                .map(|owner| owner.0 as isize)
                .unwrap_or(0),
        });
        true.into()
    }

    let mut windows: Vec<Window> = Vec::new();
    let _ = unsafe { EnumWindows(Some(collect), LPARAM(&mut windows as *mut _ as isize)) };
    // One look per process, not per window: an editor has many windows.
    let mut images: HashMap<u32, String> = HashMap::new();
    for window in &mut windows {
        let image = images
            .entry(window.pid)
            .or_insert_with(|| image_name(window.pid).unwrap_or_default().to_lowercase());
        window.image = image.clone();
    }
    windows
}

/// Brings a window to the front, out of the taskbar if it was minimised
/// there. True when it ends up in front.
///
/// Windows only lets a program take the foreground when it has a claim to it,
/// and the plain call is tried first: it is enough whenever the island holds
/// the keyboard (the large panel, a typed answer). Most of the time it does
/// not — its window never activates, and the click that brought us here was
/// delivered to the webview's own process — so the call is refused and the
/// window merely flashes in the taskbar. Then, and only then, this thread
/// joins the input queue of the window that *is* in front for the length of
/// one call (`AttachThreadInput`, the documented way to share a foreground
/// claim), asks again, and leaves. No key press is made up: a synthetic Alt
/// would reach the very window the user is typing in, and open its menu.
pub fn bring_forward(hwnd: isize) -> bool {
    take_foreground(HWND(hwnd as *mut _)).is_some()
}

/// How long a window gets to be in front once it was asked to: the switch
/// between two programs is not done the moment the call returns.
const FOREGROUND_SETTLE: Duration = Duration::from_millis(120);

/// `bring_forward`, saying which of its two ways worked.
fn take_foreground(hwnd: HWND) -> Option<&'static str> {
    unsafe {
        if !IsWindow(Some(hwnd)).as_bool() {
            return None;
        }
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        if SetForegroundWindow(hwnd).as_bool() && in_front(hwnd) {
            return Some("asked");
        }
        let front = GetForegroundWindow();
        let theirs = GetWindowThreadProcessId(front, None);
        let ours = GetCurrentThreadId();
        if theirs != 0 && theirs != ours && AttachThreadInput(ours, theirs, true).as_bool() {
            let _ = BringWindowToTop(hwnd);
            let _ = SetForegroundWindow(hwnd);
            let _ = AttachThreadInput(ours, theirs, false);
        }
        in_front(hwnd).then_some("joined the window in front")
    }
}

/// True once a window is the one in front, given a moment to get there.
fn in_front(hwnd: HWND) -> bool {
    let until = Instant::now() + FOREGROUND_SETTLE;
    loop {
        if unsafe { GetForegroundWindow() } == hwnd {
            return true;
        }
        if Instant::now() >= until {
            return false;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

// ── Typing into a session's window ────────────────────────────────────────────
//
// What reply_here.rs does with them is its own business; these are the system
// calls, each one small.

/// The title of a window as it is now; empty when it is gone.
pub fn window_title(hwnd: isize) -> String {
    let mut title = [0u16; 512];
    let len = unsafe { GetWindowTextW(HWND(hwnd as *mut _), &mut title) }.max(0) as usize;
    String::from_utf16_lossy(&title[..len])
}

/// True when `hwnd` is the window in front.
pub fn is_foreground(hwnd: isize) -> bool {
    unsafe { GetForegroundWindow() }.0 as isize == hwnd
}

/// True once `hwnd` is the window in front, waiting up to `ms` for it.
pub fn wait_foreground(hwnd: isize, ms: u64) -> bool {
    let until = Instant::now() + Duration::from_millis(ms);
    loop {
        if is_foreground(hwnd) {
            return true;
        }
        if Instant::now() >= until {
            return false;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Whether a process's token is elevated; None when it cannot be read.
fn token_elevated(process: HANDLE) -> Option<bool> {
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(process, TOKEN_QUERY, &mut token).ok()?;
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut returned = 0u32;
        let read = GetTokenInformation(
            token,
            TokenElevation,
            Some((&mut elevation as *mut TOKEN_ELEVATION).cast()),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned,
        )
        .is_ok();
        let _ = CloseHandle(token);
        read.then_some(elevation.TokenIsElevated != 0)
    }
}

/// True when the program that owns `hwnd` runs elevated and we do not: Windows
/// would drop what is typed to it, silently. A token that cannot be read is
/// taken to be elevated.
pub fn elevated_out_of_reach(hwnd: isize) -> bool {
    if token_elevated(unsafe { GetCurrentProcess() }).unwrap_or(false) {
        return false;
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(HWND(hwnd as *mut _), Some(&mut pid)) };
    let Ok(process) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) })
    else {
        return true;
    };
    let elevated = token_elevated(process).unwrap_or(true);
    let _ = unsafe { CloseHandle(process) };
    elevated
}

/// True once the Enter, Shift, Ctrl, Alt and Windows keys are all up, waiting up
/// to `ms` for it: the user has just pressed Enter in the island.
pub fn wait_keys_released(ms: u64) -> bool {
    use ::windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RETURN, VK_RWIN, VK_SHIFT,
    };
    let down = || {
        [VK_RETURN, VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN]
            .iter()
            .any(|key| unsafe { GetAsyncKeyState(key.0 as i32) } < 0)
    };
    let until = Instant::now() + Duration::from_millis(ms);
    loop {
        if !down() {
            return true;
        }
        if Instant::now() >= until {
            return false;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Sends keys to the window in front: a character as Unicode input, a key down
/// and up for each unit of UTF-16; Enter as the key. Returns how many input
/// events the system took, and how many there were.
pub fn send_keys(keys: &[crate::reply_here::KeyAction]) -> (usize, usize) {
    use crate::reply_here::KeyAction;
    use ::windows::Win32::UI::Input::KeyboardAndMouse::{
        MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
        KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, MAPVK_VK_TO_VSC, VIRTUAL_KEY, VK_RETURN,
    };

    let stroke = |vk: VIRTUAL_KEY, scan: u16, flags: KEYBD_EVENT_FLAGS| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: scan,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let mut events: Vec<INPUT> = Vec::with_capacity(keys.len() * 2);
    for key in keys {
        match key {
            KeyAction::Char(c) => {
                let mut units = [0u16; 2];
                for unit in c.encode_utf16(&mut units) {
                    events.push(stroke(VIRTUAL_KEY(0), *unit, KEYEVENTF_UNICODE));
                    events.push(stroke(
                        VIRTUAL_KEY(0),
                        *unit,
                        KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                    ));
                }
            }
            KeyAction::Enter => {
                let scan = unsafe { MapVirtualKeyW(VK_RETURN.0 as u32, MAPVK_VK_TO_VSC) } as u16;
                events.push(stroke(VK_RETURN, scan, KEYBD_EVENT_FLAGS(0)));
                events.push(stroke(VK_RETURN, scan, KEYEVENTF_KEYUP));
            }
        }
    }
    let sent = unsafe { SendInput(&events, std::mem::size_of::<INPUT>() as i32) } as usize;
    (sent, events.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(feature = "nook-dev")]
    #[test]
    fn z_order_comparison_respects_topmost_partition_and_rank() {
        assert!(is_above_in_z_order(false, 10, true, 20));
        assert!(!is_above_in_z_order(true, 10, false, 0));
        assert!(is_above_in_z_order(true, 3, true, 2));
        assert!(!is_above_in_z_order(false, 3, false, 4));
    }

    #[test]
    fn a_process_is_named_by_its_image_and_never_by_a_path() {
        let name = image_name(std::process::id()).expect("our own process has an image");
        assert!(
            name.to_lowercase().ends_with(".exe") && !name.contains(['\\', '/']),
            "{name}"
        );
        // No process has this pid: nothing is named.
        assert_eq!(image_name(u32::MAX - 3), None);
    }

    #[test]
    fn the_windows_are_listed_with_the_program_each_answers_for() {
        for window in top_windows() {
            assert_ne!(window.hwnd, 0);
            assert_eq!(window.image, window.image.to_lowercase());
            assert!(!window.image.contains('\\'));
        }
        // A handle that is no window is not brought anywhere.
        assert!(!bring_forward(0));
    }

    /// Takes the foreground away from whatever has it and gives it back, from a
    /// process with no claim to it at all — a harder case than the island's.
    /// Run by hand: `cargo test -p nook -- --ignored comes_forward --nocapture`.
    #[test]
    #[ignore = "moves the keyboard focus on the desktop it runs on"]
    fn a_window_comes_forward_and_the_one_before_it_comes_back() {
        let front = unsafe { GetForegroundWindow() }.0 as isize;
        let other = top_windows().into_iter().find(|w| {
            w.hwnd != front
                && w.visible
                && w.owner == 0
                && !w.title.is_empty()
                && ["code.exe", "windowsterminal.exe"].contains(&w.image.as_str())
        });
        let Some(other) = other else {
            return eprintln!("no editor or terminal window to try with");
        };
        let describe = |hwnd: isize| {
            top_windows()
                .into_iter()
                .find(|w| w.hwnd == hwnd)
                .map(|w| format!("{} [{}]", w.image, w.class))
        };
        eprintln!("in front: {:?}; going to {}", describe(front), other.image);
        let went = take_foreground(HWND(other.hwnd as *mut _));
        eprintln!("went: {went:?}");
        std::thread::sleep(Duration::from_millis(150));
        let back = (front != 0).then(|| take_foreground(HWND(front as *mut _)));
        eprintln!("came back: {back:?}");
        assert!(went.is_some(), "the window did not come forward");
        assert!(
            back.is_none_or(|how| how.is_some()),
            "the window that was in front did not come back"
        );
    }
}
