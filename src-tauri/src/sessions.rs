//! Read-only view of Claude Code's own session store (`~/.claude/projects`), used for
//! "recent projects", "continue" and deciding between `--resume` and `--session-id`.

use serde::Serialize;
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Serialize, Clone)]
pub struct Project {
    pub path: String,
    pub name: String,
    pub last_active: u64,
    pub sessions: usize,
    pub last_session: Option<String>,
    pub last_prompt: Option<String>,
    pub exists: bool,
}

fn projects_root() -> Option<PathBuf> {
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).ok()?;
    let base = std::env::var("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(|_| Path::new(&home).join(".claude"));
    Some(base.join("projects"))
}

fn mtime_ms(p: &Path) -> u64 {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn session_exists(session_id: &str) -> bool {
    let Some(root) = projects_root() else { return false };
    let name = format!("{session_id}.jsonl");
    std::fs::read_dir(root)
        .map(|rd| rd.flatten().any(|d| d.path().join(&name).is_file()))
        .unwrap_or(false)
}

/// Pull `cwd` and the first real user prompt out of the head of a session log.
fn peek(file: &Path) -> (Option<String>, Option<String>) {
    let Ok(f) = std::fs::File::open(file) else { return (None, None) };
    let (mut cwd, mut prompt) = (None, None);
    for line in BufReader::new(f).lines().take(200).map_while(Result::ok) {
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        if cwd.is_none() {
            cwd = v.get("cwd").and_then(Value::as_str).map(str::to_string);
        }
        if prompt.is_none() && v.get("type").and_then(Value::as_str) == Some("user") {
            let content = v.pointer("/message/content");
            let text = match content {
                Some(Value::String(s)) => Some(s.clone()),
                Some(Value::Array(parts)) => parts
                    .iter()
                    .find_map(|p| (p.get("type")?.as_str()? == "text").then(|| p.get("text")?.as_str().map(str::to_string)).flatten()),
                _ => None,
            };
            if let Some(t) = text.filter(|t| !t.trim_start().starts_with('<') && !t.trim().is_empty()) {
                prompt = Some(t.lines().next().unwrap_or("").chars().take(90).collect());
            }
        }
        if cwd.is_some() && prompt.is_some() {
            break;
        }
    }
    (cwd, prompt)
}

pub fn recent_projects(limit: usize) -> Vec<Project> {
    let Some(root) = projects_root() else { return vec![] };
    let Ok(dirs) = std::fs::read_dir(root) else { return vec![] };
    let mut out: Vec<Project> = Vec::new();

    for dir in dirs.flatten() {
        let Ok(files) = std::fs::read_dir(dir.path()) else { continue };
        let mut logs: Vec<(u64, PathBuf)> = files
            .flatten()
            .map(|f| f.path())
            .filter(|p| p.extension().is_some_and(|e| e == "jsonl"))
            .map(|p| (mtime_ms(&p), p))
            .collect();
        if logs.is_empty() {
            continue;
        }
        logs.sort_by(|a, b| b.0.cmp(&a.0));
        let (last_active, newest) = logs[0].clone();
        let (cwd, prompt) = peek(&newest);
        let Some(path) = cwd.or_else(|| logs.iter().skip(1).take(3).find_map(|(_, p)| peek(p).0)) else { continue };
        let name = Path::new(&path).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| path.clone());
        out.push(Project {
            exists: Path::new(&path).is_dir(),
            name,
            last_active,
            sessions: logs.len(),
            last_session: newest.file_stem().map(|s| s.to_string_lossy().to_string()),
            last_prompt: prompt,
            path,
        });
    }

    // Two encoded dirs can map to one path (e.g. symlinks); keep the freshest.
    out.sort_by(|a, b| b.last_active.cmp(&a.last_active));
    let mut seen = std::collections::HashSet::new();
    out.retain(|p| seen.insert(p.path.clone()));
    out.truncate(limit);
    out
}
