//! `napkin hook` — invoked by Claude Code hooks (injected via `claude --settings`).
//! Reads the hook payload on stdin, snapshots on turn boundaries, appends one event.
//! Must never block Claude or print: always exits 0, silently.

use crate::events::{self, Event};
use crate::snapshot::Shadow;
use serde_json::Value;
use std::io::Read;
use std::path::PathBuf;

const EDIT_TOOLS: &[&str] = &["Write", "Edit", "MultiEdit", "NotebookEdit"];

pub fn run() -> i32 {
    let _ = inner();
    0
}

fn inner() -> Option<()> {
    let home = PathBuf::from(std::env::var("NAPKIN_HOME").ok()?);
    let id = std::env::var("NAPKIN_ID").ok()?;
    let project = PathBuf::from(std::env::var("NAPKIN_PROJECT").ok()?);
    let tracking = std::env::var("NAPKIN_TRACK").ok().as_deref() == Some("1");

    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).ok()?;
    let v: Value = serde_json::from_str(&input).ok()?;
    let name = v.get("hook_event_name")?.as_str()?;
    let mut e = Event::new(name);
    let snap = |label: &str| {
        let s = Shadow::new(&home, &project, &id);
        s.ensure()?;
        s.snapshot(label)
    };

    match name {
        "UserPromptSubmit" => {
            let prompt = v.get("prompt").and_then(Value::as_str).unwrap_or("");
            e.prompt = Some(truncate(prompt, 400));
            if tracking {
                match snap(&format!("before: {}", truncate(prompt, 72))) {
                    Ok(c) => e.cp = Some(c),
                    Err(err) => e.err = Some(err),
                }
            }
        }
        "Stop" => {
            if tracking {
                match snap("after turn") {
                    Ok(c) => e.cp = Some(c),
                    Err(err) => e.err = Some(err),
                }
            }
        }
        "PostToolUse" => {
            let tool = v.get("tool_name").and_then(Value::as_str).unwrap_or("").to_string();
            if EDIT_TOOLS.contains(&tool.as_str()) {
                let input = v.get("tool_input");
                let files: Vec<String> = ["file_path", "notebook_path"]
                    .iter()
                    .filter_map(|k| input?.get(*k)?.as_str().map(str::to_string))
                    .collect();
                if !files.is_empty() {
                    e.files = Some(files);
                }
            }
            e.tool = Some(tool);
        }
        "Notification" => {
            e.msg = v.get("message").and_then(Value::as_str).map(|s| truncate(s, 200));
            e.kind = v.get("notification_type").and_then(Value::as_str).map(str::to_string);
        }
        _ => {}
    }

    events::append(&events::log_path(&home, &id), &e).ok()
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}

/// The hook config handed to `claude --settings`. Only touches this one session.
pub fn settings_json(exe: &str) -> String {
    // Claude Code runs hook commands through a shell: POSIX quoting, or plain double quotes on Windows
    let quoted = if cfg!(windows) { format!("\"{exe}\"") } else { format!("'{}'", exe.replace('\'', r"'\''")) };
    let cmd = format!("{quoted} hook");
    let h = |matcher: Option<&str>, timeout: u32| {
        let mut entry = serde_json::json!({ "hooks": [{ "type": "command", "command": cmd, "timeout": timeout }] });
        if let Some(m) = matcher {
            entry["matcher"] = Value::String(m.to_string());
        }
        serde_json::json!([entry])
    };
    serde_json::json!({
        "hooks": {
            "UserPromptSubmit": h(None, 120),
            "PostToolUse": h(Some("*"), 10),
            "Stop": h(None, 120),
            "Notification": h(None, 10),
        },
        "statusLine": { "type": "command", "command": format!("{quoted} statusline") }
    })
    .to_string()
}

/// `napkin statusline` — Claude Code's statusLine command for napkin sessions. Records
/// the rate-limit snapshot for "the tab", then hands stdin to the user's own
/// statusline (if any) so their status bar looks exactly as it did before.
pub fn statusline() -> i32 {
    let mut input = Vec::new();
    let _ = std::io::stdin().read_to_end(&mut input);
    if let (Ok(home), Ok(v)) = (std::env::var("NAPKIN_HOME"), serde_json::from_slice::<Value>(&input)) {
        if let Some(limits) = v.get("rate_limits").filter(|l| !l.is_null()) {
            let snap = serde_json::json!({ "t": events::now_ms(), "rate_limits": limits });
            let path = PathBuf::from(home).join("usage.json");
            let tmp = path.with_extension(format!("json.{}", std::process::id()));
            if std::fs::write(&tmp, snap.to_string()).is_ok() {
                let _ = std::fs::rename(&tmp, &path);
            }
        }
    }
    let Ok(cmd) = std::env::var("NAPKIN_USER_STATUSLINE") else { return 0 };
    if cmd.trim().is_empty() {
        return 0;
    }
    use std::io::Write;
    use std::process::{Command, Stdio};
    let Ok(mut child) = Command::new("/bin/sh").arg("-c").arg(&cmd).stdin(Stdio::piped()).spawn() else { return 0 };
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(&input);
    }
    child.wait().ok().and_then(|s| s.code()).unwrap_or(0)
}

/// The user's own statusLine command from ~/.claude/settings.json, so we can chain it.
pub fn user_statusline() -> Option<String> {
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).ok()?;
    let base = std::env::var("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from(home).join(".claude"));
    let v: Value = serde_json::from_slice(&std::fs::read(base.join("settings.json")).ok()?).ok()?;
    let sl = v.get("statusLine")?;
    (sl.get("type").and_then(Value::as_str) == Some("command")).then(|| sl.get("command")?.as_str().map(str::to_string)).flatten()
}
