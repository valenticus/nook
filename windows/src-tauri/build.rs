use std::env;
use std::path::Path;

fn compact_json(input: &str) -> String {
    let mut compact = String::with_capacity(input.len());
    let mut in_string = false;
    let mut escaped = false;

    for character in input.chars() {
        if in_string {
            compact.push(character);
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
        } else if character == '"' {
            in_string = true;
            compact.push(character);
        } else if !character.is_whitespace() {
            compact.push(character);
        }
    }

    compact
}

fn has_config_string(config: &str, key: &str, value: &str) -> bool {
    compact_json(config).contains(&format!("\"{key}\":\"{value}\""))
}

fn main() {
    let nook_dev = env::var_os("CARGO_FEATURE_NOOK_DEV").is_some();
    let nook_standalone = env::var_os("CARGO_FEATURE_NOOK_STANDALONE").is_some();
    let codex_quota = env::var_os("CARGO_FEATURE_CODEX_QUOTA").is_some();
    assert!(
        !nook_standalone || codex_quota,
        "Nook Standalone must include the Codex quota provider feature"
    );
    assert!(
        !(nook_dev && nook_standalone),
        "Nook Dev and Nook Standalone are separate build modes"
    );
    let dev_build = env::var("NOOK_DEV_BUILD").as_deref() == Ok("1");

    if nook_dev && env::var("PROFILE").as_deref() == Ok("release") {
        assert!(
            dev_build,
            "Release builds with `nook-dev` must use scripts/build-dev.ps1"
        );
    }

    if dev_build {
        assert!(nook_dev, "NOOK_DEV_BUILD requires Cargo feature `nook-dev`");
        let target_dir =
            env::var("CARGO_TARGET_DIR").expect("Nook Dev requires its isolated CARGO_TARGET_DIR");
        assert!(
            Path::new(&target_dir).ends_with("target-nook-dev"),
            "Nook Dev must use the target-nook-dev directory"
        );
        let config =
            env::var("TAURI_CONFIG").expect("Nook Dev requires the explicit Tauri Dev config");
        assert!(
            has_config_string(&config, "identifier", "io.github.zubairbinshaukat.nook.dev"),
            "Nook Dev feature/config mismatch"
        );
        assert!(
            has_config_string(&config, "productName", "Nook Dev"),
            "Nook Dev product/config mismatch"
        );
        assert!(
            has_config_string(&config, "mainBinaryName", "nook-dev"),
            "Nook Dev must use an independent process name"
        );
    }

    if nook_standalone && env::var("PROFILE").as_deref() == Ok("release") {
        assert!(
            env::var("NOOK_STANDALONE_BUILD").as_deref() == Ok("1"),
            "Standalone release builds require scripts/build-standalone.ps1"
        );
        let target_dir = env::var("CARGO_TARGET_DIR")
            .expect("Standalone requires its isolated CARGO_TARGET_DIR");
        assert!(
            Path::new(&target_dir).ends_with("target-nook-standalone"),
            "Nook Standalone must use the target-nook-standalone directory"
        );
        let config =
            env::var("TAURI_CONFIG").expect("Nook Standalone requires its explicit Tauri config");
        assert!(
            has_config_string(&config, "identifier", "io.github.valenticus.nook"),
            "Nook Standalone feature/config mismatch"
        );
        assert!(
            has_config_string(&config, "productName", "Nook Personal Edition"),
            "Nook Personal Edition needs an independent installer identity"
        );
        assert!(
            has_config_string(&config, "mainBinaryName", "nook-standalone"),
            "Nook Standalone must use an independent process name"
        );
    }

    if let Ok(config) = env::var("TAURI_CONFIG") {
        let config_is_dev =
            has_config_string(&config, "identifier", "io.github.zubairbinshaukat.nook.dev");
        let config_is_standalone =
            has_config_string(&config, "identifier", "io.github.valenticus.nook");
        assert_eq!(
            nook_dev, config_is_dev,
            "Nook Dev config and `nook-dev` feature must be used together"
        );
        assert_eq!(
            nook_standalone, config_is_standalone,
            "Nook Standalone config and `nook-standalone` feature must be used together"
        );
    } else if nook_dev {
        panic!("nook-dev feature requires an explicit Dev Tauri config");
    }

    tauri_build::build()
}
