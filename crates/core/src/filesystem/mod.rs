//! Filesystem helpers: disk space checks and path validation.

use crate::error::{CoreError, CoreResult};
use std::path::Path;

/// Rejects a path that escapes the given root. Used before any write driven by
/// data that came from outside the core.
pub fn ensure_within(root: &Path, candidate: &Path) -> CoreResult<()> {
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let candidate = candidate
        .canonicalize()
        .unwrap_or_else(|_| candidate.to_path_buf());

    if candidate.starts_with(&root) {
        Ok(())
    } else {
        Err(CoreError::Other(format!(
            "path escapes its root: {}",
            candidate.display()
        )))
    }
}

/// Checks that a destination directory exists and is writable before a long
/// running export begins (design doc section 49).
pub fn ensure_writable(path: &Path) -> CoreResult<()> {
    let directory = path.parent().unwrap_or(Path::new("."));
    if !directory.exists() {
        std::fs::create_dir_all(directory)?;
    }
    let probe = directory.join(".ave-write-test");
    std::fs::write(&probe, b"")?;
    std::fs::remove_file(&probe)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_child_path() {
        let root = std::env::temp_dir();
        assert!(ensure_within(&root, &root.join("a/b.txt")).is_ok());
    }

    #[test]
    fn rejects_a_traversal() {
        let root = std::env::temp_dir().join("ave-root");
        assert!(ensure_within(&root, Path::new("/etc/passwd")).is_err());
    }
}
