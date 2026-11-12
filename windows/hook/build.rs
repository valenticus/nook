//! Links the Visual C++ runtime statically into nook-hook.exe.
//!
//! Without this the relay imports VCRUNTIME140.dll, and on a PC without the
//! Visual C++ Redistributable it dies before its own code runs (0xC0000135,
//! STATUS_DLL_NOT_FOUND): Claude Code only sees a failed hook, with no stderr.
//! The app does not have the problem because tauri-build does exactly this for
//! it; this is the same technique (from github.com/ChrisDenton/static_vcruntime,
//! as vendored by tauri-build): vcruntime static, the Universal CRT dynamic —
//! the UCRT ships with Windows 10 and later.

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    let windows_msvc = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    if !windows_msvc {
        return;
    }
    #[cfg(windows)]
    version_info();
    override_msvcrt_lib();
    // Libraries that would pull in the DLL runtime.
    for lib in [
        "libvcruntimed.lib",
        "vcruntime.lib",
        "vcruntimed.lib",
        "libcmtd.lib",
        "msvcrt.lib",
        "msvcrtd.lib",
        "libucrt.lib",
        "libucrtd.lib",
    ] {
        println!("cargo:rustc-link-arg=/NODEFAULTLIB:{lib}");
    }
    // The ones we want instead.
    for lib in ["libcmt.lib", "libvcruntime.lib", "ucrt.lib"] {
        println!("cargo:rustc-link-arg=/DEFAULTLIB:{lib}");
    }
}

/// What Windows shows under a file's Properties → Details, and what a security
/// product reads to say whose program this is: the relay is a separate exe
/// that Claude Code runs on every event, and without this it has no name at all.
/// Standalone has an independent release version; other relays follow the
/// Original package version.
#[cfg(windows)]
fn version_info() {
    let mut res = tauri_winres::WindowsResource::new();
    let standalone = std::env::var_os("CARGO_FEATURE_STANDALONE_RELAY").is_some();
    let dev = std::env::var_os("CARGO_FEATURE_NOOK_DEV_RELAY").is_some();
    let product_name = if standalone {
        "Nook Personal Edition"
    } else if dev {
        "Nook Dev"
    } else {
        "Nook"
    };
    let filename = if standalone {
        "nook-hook-standalone.exe"
    } else if dev {
        "nook-hook-dev.exe"
    } else {
        "nook-hook.exe"
    };
    res.set("ProductName", product_name);
    res.set(
        "FileDescription",
        if standalone {
            "Nook Personal Edition"
        } else if dev {
            "Nook Dev hook relay"
        } else {
            "Nook hook relay for Claude Code"
        },
    );
    res.set("CompanyName", "Zubair Bin Shaukat");
    res.set("LegalCopyright", "© Zubair Bin Shaukat and contributors");
    res.set(
        "InternalName",
        if standalone {
            "nook-hook-standalone"
        } else if dev {
            "nook-hook-dev"
        } else {
            "nook-hook"
        },
    );
    res.set("OriginalFilename", filename);
    if standalone {
        res.set("FileVersion", "0.2.0");
        res.set("ProductVersion", "0.2.0");
    }
    if let Err(err) = res.compile() {
        println!("cargo:warning=nook-hook: no version information ({err})");
    }
}

/// rustc hard-codes msvcrt.lib; replace it with an (almost) empty object file.
fn override_msvcrt_lib() {
    let machine: &[u8] = match std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("x86_64") => &[0x64, 0x86],
        Ok("x86") => &[0x4C, 0x01],
        _ => return,
    };
    let bytes: &[u8] = &[
        1, 0, 94, 3, 96, 98, 60, 0, 0, 0, 1, 0, 0, 0, 0, 0, 132, 1, 46, 100, 114, 101, 99, 116,
        118, 101, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 10, 16, 0, 46, 100, 114, 101, 99, 116, 118, 101, 0, 0, 0, 0, 1, 0, 0, 0, 3, 0, 4, 0,
        0, 0,
    ];
    let out_dir = std::env::var("OUT_DIR").unwrap();
    let path = std::path::Path::new(&out_dir).join("msvcrt.lib");
    let mut contents = machine.to_vec();
    contents.extend_from_slice(bytes);
    std::fs::write(path, contents).unwrap();
    println!("cargo:rustc-link-search=native={out_dir}");
}
