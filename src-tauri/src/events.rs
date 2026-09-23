//! Per-napkin append-only event log (`napkins/<id>/events.jsonl`). Written by the
//! `napkin hook` subprocess and by the app; tailed by a single poller thread.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Event {
    pub t: u64,
    pub ev: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub msg: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cp: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub err: Option<String>,
}

impl Event {
    pub fn new(ev: &str) -> Event {
        Event { t: now_ms(), ev: ev.to_string(), ..Default::default() }
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn log_path(home: &Path, napkin: &str) -> PathBuf {
    home.join("napkins").join(napkin).join("events.jsonl")
}

/// One `write` per line with O_APPEND, so concurrent hook processes don't interleave.
pub fn append(path: &Path, e: &Event) -> std::io::Result<()> {
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p)?;
    }
    let mut line = serde_json::to_vec(e)?;
    line.push(b'\n');
    let mut f = OpenOptions::new().create(true).append(true).open(path)?;
    f.write_all(&line)
}

fn parse_lines(buf: &[u8]) -> Vec<Event> {
    buf.split(|b| *b == b'\n')
        .filter(|l| !l.is_empty())
        .filter_map(|l| serde_json::from_slice(l).ok())
        .collect()
}

#[derive(Serialize, Clone)]
struct Batch {
    id: String,
    events: Vec<Event>,
}

/// Tracks read offsets for every attached napkin and emits `napkin-events`.
#[derive(Clone, Default)]
pub struct Tailer {
    watched: Arc<Mutex<HashMap<String, (PathBuf, u64)>>>,
}

impl Tailer {
    /// Read the whole log and start tailing from its end, atomically.
    pub fn attach(&self, id: &str, path: PathBuf) -> Vec<Event> {
        let mut map = self.watched.lock().unwrap();
        let data = std::fs::read(&path).unwrap_or_default();
        // only consume complete lines; a partial trailing line is picked up by the poller
        let end = data.iter().rposition(|b| *b == b'\n').map(|i| i + 1).unwrap_or(0);
        map.insert(id.to_string(), (path, end as u64));
        parse_lines(&data[..end])
    }

    pub fn detach(&self, id: &str) {
        self.watched.lock().unwrap().remove(id);
    }

    pub fn start(&self, app: AppHandle) {
        let watched = self.watched.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(250));
            let mut batches = Vec::new();
            {
                let mut map = watched.lock().unwrap();
                for (id, (path, offset)) in map.iter_mut() {
                    let Ok(meta) = std::fs::metadata(&*path) else { continue };
                    if meta.len() <= *offset {
                        continue;
                    }
                    let Ok(mut f) = std::fs::File::open(&*path) else { continue };
                    if f.seek(SeekFrom::Start(*offset)).is_err() {
                        continue;
                    }
                    let mut buf = Vec::new();
                    if f.read_to_end(&mut buf).is_err() {
                        continue;
                    }
                    let Some(end) = buf.iter().rposition(|b| *b == b'\n').map(|i| i + 1) else { continue };
                    *offset += end as u64;
                    let events = parse_lines(&buf[..end]);
                    if !events.is_empty() {
                        batches.push(Batch { id: id.clone(), events });
                    }
                }
            }
            for b in batches {
                let _ = app.emit("napkin-events", b);
            }
        });
    }
}
