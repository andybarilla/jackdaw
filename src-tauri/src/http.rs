use rand::RngCore;
use std::path::Path;

// ── Token ────────────────────────────────────────────────────────────────────

pub fn load_or_generate_token(path: &Path) -> std::io::Result<String> {
    if path.exists() {
        let token = std::fs::read_to_string(path)?;
        return Ok(token.trim().to_string());
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token = bytes.iter().map(|b| format!("{:02x}", b)).collect::<String>();

    std::fs::write(path, &token)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }

    Ok(token)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_token_when_file_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("token");
        let token = load_or_generate_token(&path).unwrap();
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(path.exists());
    }

    #[test]
    fn loads_existing_token() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("token");
        std::fs::write(&path, "abcd1234efgh5678").unwrap();
        let token = load_or_generate_token(&path).unwrap();
        assert_eq!(token, "abcd1234efgh5678");
    }

    #[test]
    fn generated_tokens_are_unique() {
        let dir = tempfile::tempdir().unwrap();
        let t1 = load_or_generate_token(&dir.path().join("t1")).unwrap();
        let t2 = load_or_generate_token(&dir.path().join("t2")).unwrap();
        assert_ne!(t1, t2);
    }

    #[cfg(unix)]
    #[test]
    fn token_file_has_restrictive_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("token");
        load_or_generate_token(&path).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}
