/// Returns the platform-specific IPC socket/pipe name.
///
/// - Linux/macOS: `~/.jackdaw/jackdaw.sock` (Unix domain socket)
/// - Windows: `jackdaw` (mapped to `\\.\pipe\jackdaw` by interprocess)
pub fn socket_path() -> String {
    if cfg!(windows) {
        "jackdaw".to_string()
    } else {
        let home = dirs::home_dir().expect("could not determine home directory");
        home.join(".jackdaw")
            .join("jackdaw.sock")
            .to_string_lossy()
            .into_owned()
    }
}

/// Returns the parent directory of the socket file (Unix only).
/// Creates it if it doesn't exist.
pub fn ensure_socket_dir() {
    if !cfg!(windows) {
        let home = dirs::home_dir().expect("could not determine home directory");
        let dir = home.join(".jackdaw");
        if !dir.exists() {
            std::fs::create_dir_all(&dir).expect("failed to create ~/.jackdaw/");
        }
    }
}

/// Build a socket path in a given directory (for testing).
pub fn socket_path_in(dir: &std::path::Path) -> String {
    dir.join("jackdaw.sock").to_string_lossy().into_owned()
}

/// Remove stale socket file if it exists (Unix only).
pub fn remove_stale_socket() {
    if !cfg!(windows) {
        let home = dirs::home_dir().expect("could not determine home directory");
        let path = home.join(".jackdaw").join("jackdaw.sock");
        if path.exists() {
            let _ = std::fs::remove_file(&path);
        }
    }
}
