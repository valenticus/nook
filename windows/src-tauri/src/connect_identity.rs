//! Stable identity reserved for the future standalone product. These constants
//! intentionally do not alter the current Nook or Nook Dev build identities.

use std::path::{Path, PathBuf};

#[cfg(test)]
pub const APP_IDENTIFIER: &str = "io.github.valenticus.nook";
pub const INSTALL_DIR_NAME: &str = "NookStandalone";
pub const RELAY_FILE_NAME: &str = "nook-hook-standalone.exe";

/// `%LOCALAPPDATA%\NookStandalone\bin\nook-hook-standalone.exe`.
pub fn relay_path(local_app_data: &Path) -> PathBuf {
    local_app_data
        .join(INSTALL_DIR_NAME)
        .join("bin")
        .join(RELAY_FILE_NAME)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standalone_identity_is_distinct_from_existing_nook_and_dev() {
        let path = relay_path(Path::new(r"C:\Users\TestUser\AppData\Local"));
        assert_eq!(APP_IDENTIFIER, "io.github.valenticus.nook");
        assert_eq!(
            path,
            PathBuf::from(
                r"C:\Users\TestUser\AppData\Local\NookStandalone\bin\nook-hook-standalone.exe"
            )
        );
        assert_ne!(APP_IDENTIFIER, "io.github.zubairbinshaukat.nook");
        assert_ne!(APP_IDENTIFIER, "io.github.zubairbinshaukat.nook.dev");
    }
}
