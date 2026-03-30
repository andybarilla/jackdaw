use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

pub struct PtyInstance {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

pub struct SpawnConfig<'a> {
    pub id: String,
    pub cwd: &'a str,
    pub cols: u16,
    pub rows: u16,
    pub program: &'a str,
    pub args: &'a [&'a str],
    pub env: &'a [(&'a str, &'a str)],
}

#[derive(Default)]
pub struct PtyManager {
    instances: Mutex<HashMap<String, PtyInstance>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Spawn a command in a new PTY with the given ID.
    /// Returns a reader for raw PTY output — caller should consume it on a background thread.
    pub fn spawn(&self, config: SpawnConfig) -> Result<Box<dyn Read + Send>, String> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows: config.rows,
                cols: config.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("failed to open PTY: {}", e))?;

        let mut cmd = CommandBuilder::new(config.program);
        cmd.args(config.args);
        cmd.cwd(config.cwd);
        for (k, v) in config.env {
            cmd.env(k, v);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("failed to spawn command: {}", e))?;

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("failed to clone PTY reader: {}", e))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("failed to take PTY writer: {}", e))?;

        let instance = PtyInstance {
            writer,
            master: pair.master,
            child,
        };

        self.instances.lock().unwrap().insert(config.id, instance);

        Ok(reader)
    }

    /// Write raw bytes to a PTY's stdin.
    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let mut instances = self.instances.lock().unwrap();
        let instance = instances
            .get_mut(id)
            .ok_or_else(|| format!("no PTY with id: {}", id))?;
        instance
            .writer
            .write_all(data)
            .map_err(|e| format!("failed to write to PTY: {}", e))?;
        instance
            .writer
            .flush()
            .map_err(|e| format!("failed to flush PTY: {}", e))?;
        Ok(())
    }

    /// Resize a PTY.
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let instances = self.instances.lock().unwrap();
        let instance = instances
            .get(id)
            .ok_or_else(|| format!("no PTY with id: {}", id))?;
        instance
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("failed to resize PTY: {}", e))?;
        Ok(())
    }

    /// Close a PTY and kill its child process.
    pub fn close(&self, id: &str) {
        let mut instances = self.instances.lock().unwrap();
        if let Some(mut instance) = instances.remove(id) {
            let _ = instance.child.kill();
        }
    }

    /// Check if a child process has exited. Returns Some(exit_code) or None if still running.
    pub fn try_wait(&self, id: &str) -> Result<Option<u32>, String> {
        let mut instances = self.instances.lock().unwrap();
        let instance = instances
            .get_mut(id)
            .ok_or_else(|| format!("no PTY with id: {}", id))?;
        match instance.child.try_wait() {
            Ok(Some(status)) => Ok(Some(status.exit_code())),
            Ok(None) => Ok(None),
            Err(e) => Err(format!("failed to check PTY status: {}", e)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pty_manager_new_is_empty() {
        let mgr = PtyManager::new();
        let instances = mgr.instances.lock().unwrap();
        assert!(instances.is_empty());
    }

    fn spawn_config<'a>(id: &str, program: &'a str, args: &'a [&'a str]) -> SpawnConfig<'a> {
        SpawnConfig {
            id: id.to_string(),
            cwd: "/tmp",
            cols: 80,
            rows: 24,
            program,
            args,
            env: &[],
        }
    }

    #[test]
    fn spawn_creates_instance() {
        let mgr = PtyManager::new();
        let reader = mgr.spawn(spawn_config("test-1", "echo", &["hello"])).unwrap();
        assert!(mgr.instances.lock().unwrap().contains_key("test-1"));
        drop(reader);
    }

    #[test]
    fn write_sends_data_to_pty() {
        let mgr = PtyManager::new();
        let _reader = mgr.spawn(spawn_config("test-2", "cat", &[])).unwrap();
        let result = mgr.write("test-2", b"test\n");
        assert!(result.is_ok());
        mgr.close("test-2");
    }

    #[test]
    fn write_to_unknown_id_errors() {
        let mgr = PtyManager::new();
        let result = mgr.write("nonexistent", b"data");
        assert!(result.is_err());
    }

    #[test]
    fn resize_updates_pty_size() {
        let mgr = PtyManager::new();
        let _reader = mgr.spawn(spawn_config("test-3", "cat", &[])).unwrap();
        let result = mgr.resize("test-3", 120, 40);
        assert!(result.is_ok());
        mgr.close("test-3");
    }

    #[test]
    fn close_removes_instance() {
        let mgr = PtyManager::new();
        let _reader = mgr.spawn(spawn_config("test-4", "echo", &["hi"])).unwrap();
        mgr.close("test-4");
        assert!(!mgr.instances.lock().unwrap().contains_key("test-4"));
    }

    #[test]
    fn close_unknown_id_is_noop() {
        let mgr = PtyManager::new();
        mgr.close("nonexistent");
    }

    #[test]
    fn spawn_with_env_vars() {
        let mgr = PtyManager::new();
        let _reader = mgr
            .spawn(SpawnConfig {
                id: "test-5".into(),
                cwd: "/tmp",
                cols: 80,
                rows: 24,
                program: "env",
                args: &[],
                env: &[("JACKDAW_TEST", "hello")],
            })
            .unwrap();
        mgr.close("test-5");
    }
}
