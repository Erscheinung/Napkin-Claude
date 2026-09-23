//! Real PTYs for real `claude` processes. Output is shipped to the WebView as raw
//! bytes over a Tauri Channel, lightly coalesced to keep IPC calls down during bursts.

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter};

struct Session {
    gen: u64,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, Session>>>,
    next_gen: AtomicU64,
}

pub struct SpawnOpts {
    pub id: String,
    pub program: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub env: Vec<(String, String)>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Serialize, Clone)]
pub struct Spawned {
    pub gen: u64,
    pub pid: Option<u32>,
}

#[derive(Serialize, Clone)]
struct ExitPayload {
    id: String,
    gen: u64,
    code: Option<u32>,
}

const MAX_BATCH: usize = 256 * 1024;

impl PtyManager {
    pub fn spawn(&self, app: AppHandle, o: SpawnOpts, on_data: Channel<InvokeResponseBody>) -> Result<Spawned, String> {
        // Replacing a live session for the same napkin: kill the old one first.
        self.kill(&o.id);

        let pair = native_pty_system()
            .openpty(PtySize { rows: o.rows.max(2), cols: o.cols.max(10), pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("openpty: {e}"))?;

        let mut cmd = CommandBuilder::new(&o.program);
        cmd.args(&o.args);
        cmd.cwd(&o.cwd);
        cmd.env_clear();
        for (k, v) in &o.env {
            cmd.env(k, v);
        }

        let mut child = pair.slave.spawn_command(cmd).map_err(|e| format!("spawn {}: {e}", o.program))?;
        drop(pair.slave);
        let pid = child.process_id();
        let killer = child.clone_killer();
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let gen = self.next_gen.fetch_add(1, Ordering::Relaxed) + 1;

        // reader → queue → batcher → channel
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        std::thread::spawn(move || {
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if tx.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                }
            }
        });
        std::thread::spawn(move || {
            while let Ok(mut batch) = rx.recv() {
                while batch.len() < MAX_BATCH {
                    match rx.recv_timeout(Duration::from_millis(3)) {
                        Ok(more) => batch.extend_from_slice(&more),
                        Err(_) => break,
                    }
                }
                if on_data.send(InvokeResponseBody::Raw(batch)).is_err() {
                    break;
                }
            }
        });

        let sessions = self.sessions.clone();
        let id = o.id.clone();
        std::thread::spawn(move || {
            let code = child.wait().ok().map(|s| s.exit_code());
            let mut map = sessions.lock().unwrap();
            if map.get(&id).map(|s| s.gen) == Some(gen) {
                map.remove(&id);
            }
            drop(map);
            let _ = app.emit("pty-exit", ExitPayload { id, gen, code });
        });

        self.sessions
            .lock()
            .unwrap()
            .insert(o.id, Session { gen, master: pair.master, writer, killer });
        Ok(Spawned { gen, pid })
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let mut map = self.sessions.lock().unwrap();
        let s = map.get_mut(id).ok_or("napkin is not running")?;
        s.writer.write_all(data).and_then(|_| s.writer.flush()).map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let map = self.sessions.lock().unwrap();
        if let Some(s) = map.get(id) {
            s.master
                .resize(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn running(&self) -> Vec<String> {
        self.sessions.lock().unwrap().keys().cloned().collect()
    }

    pub fn kill(&self, id: &str) {
        if let Some(mut s) = self.sessions.lock().unwrap().remove(id) {
            let _ = s.killer.kill();
        }
    }

    pub fn kill_all(&self) {
        for (_, mut s) in self.sessions.lock().unwrap().drain() {
            let _ = s.killer.kill();
        }
    }
}
