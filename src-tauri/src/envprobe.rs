//! GUI apps on macOS don't inherit the user's shell environment. We run the login
//! shell once, capture its env (PATH, API keys, Bedrock/Vertex vars…) and cache it.

use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

#[derive(Clone, Serialize, Default)]
pub struct ShellEnv {
    #[serde(skip)]
    pub vars: HashMap<String, String>,
    pub claude: Option<String>,
    pub claude_version: Option<String>,
    pub git: bool,
    pub shell: String,
}

static ENV: OnceLock<ShellEnv> = OnceLock::new();

/// Blocks on first call (~100ms–1s depending on rc files); cached afterwards.
pub fn get() -> &'static ShellEnv {
    ENV.get_or_init(probe)
}

const START: &str = "__NAPKIN_ENV_START__";
const END: &str = "__NAPKIN_ENV_END__";

fn probe() -> ShellEnv {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut vars: HashMap<String, String> = std::env::vars().collect();

    let script = format!("printf '{START}'; env -0; printf '{END}'");
    if let Some(out) = run_with_timeout(
        Command::new(&shell).args(["-l", "-i", "-c", &script]),
        Duration::from_secs(6),
    ) {
        if let (Some(s), Some(e)) = (find(&out, START.as_bytes()), rfind(&out, END.as_bytes())) {
            let body = &out[s + START.len()..e];
            let shell_vars: HashMap<String, String> = body
                .split(|b| *b == 0)
                .filter_map(|kv| {
                    let kv = String::from_utf8_lossy(kv);
                    let (k, v) = kv.split_once('=')?;
                    Some((k.to_string(), v.to_string()))
                })
                .collect();
            if shell_vars.contains_key("PATH") {
                vars = shell_vars;
            }
        }
    }

    // Session-specific markers that would confuse a fresh `claude` process.
    for k in ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT", "TERM_PROGRAM", "TERM_PROGRAM_VERSION", "TERM_SESSION_ID", "ITERM_SESSION_ID", "SHLVL", "OLDPWD", "_"] {
        vars.remove(k);
    }

    let home = vars.get("HOME").cloned().unwrap_or_default();
    let mut path = vars.get("PATH").cloned().unwrap_or_default();
    for extra in [
        format!("{home}/.local/bin"),
        format!("{home}/.claude/local"),
        "/opt/homebrew/bin".into(),
        "/usr/local/bin".into(),
        "/usr/bin".into(),
        "/bin".into(),
    ] {
        if !path.split(':').any(|p| p == extra) {
            path.push(':');
            path.push_str(&extra);
        }
    }
    vars.insert("PATH".into(), path.clone());

    let claude = which("claude", &path);
    let claude_version = claude.as_ref().and_then(|c| {
        let out = run_with_timeout(
            Command::new(c).arg("--version").env("PATH", &path),
            Duration::from_secs(5),
        )?;
        let s = String::from_utf8_lossy(&out);
        s.split_whitespace().next().map(str::to_string)
    });
    let git = Command::new("git")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    ShellEnv { vars, claude: claude.map(|p| p.display().to_string()), claude_version, git, shell }
}

pub fn which(bin: &str, path: &str) -> Option<PathBuf> {
    path.split(':').map(|d| Path::new(d).join(bin)).find(|p| is_executable(p))
}

fn is_executable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(p).map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
}

/// Run a command, capture stdout, kill it if it outlives `timeout` (rc files can hang).
fn run_with_timeout(cmd: &mut Command, timeout: Duration) -> Option<Vec<u8>> {
    let mut child = cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() < timeout => std::thread::sleep(Duration::from_millis(15)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
        }
    }
    reader.join().ok()
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

fn rfind(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).rposition(|w| w == needle)
}
