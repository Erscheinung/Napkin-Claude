//! Shadow-git snapshots: a private object store per project, a private index per
//! napkin. The user's own `.git`, index and stash are never read or written.

use serde::Serialize;
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Generated/vendored dirs we never snapshot (on top of the project's .gitignore).
const EXCLUDES: &str = "\
# napkin shadow repo default excludes
.git/
.napkin/
node_modules/
bower_components/
target/
.venv/
venv/
__pycache__/
*.pyc
.next/
.nuxt/
.svelte-kit/
.turbo/
.cache/
.parcel-cache/
.gradle/
DerivedData/
Pods/
.DS_Store
";

/// Walking more than this many files on first snapshot means "probably not a project".
pub const MAX_FILES: usize = 50_000;

pub struct Shadow {
    git_dir: PathBuf,
    work: PathBuf,
    index: PathBuf,
    napkin: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct FileChange {
    pub path: String,
    /// A added, M modified, D deleted, T type change
    pub status: String,
    pub added: Option<u32>,
    pub removed: Option<u32>,
}

#[derive(Serialize, Clone)]
pub struct RestoreReport {
    pub safety: String,
    pub restored: usize,
    pub removed: usize,
}

pub fn fnv1a(s: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

impl Shadow {
    pub fn new(home: &Path, project: &Path, napkin: &str) -> Shadow {
        let key = project.display().to_string();
        let base = project.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "root".into());
        let base: String = base.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
        Shadow {
            git_dir: home.join("shadow").join(format!("{base}-{}.git", &fnv1a(&key)[..10])),
            work: project.to_path_buf(),
            index: home.join("napkins").join(napkin).join("index"),
            napkin: napkin.to_string(),
        }
    }

    fn cmd(&self) -> Command {
        let mut c = Command::new("git");
        c.env("GIT_DIR", &self.git_dir)
            .env("GIT_WORK_TREE", &self.work)
            .env("GIT_INDEX_FILE", &self.index)
            .env("GIT_LITERAL_PATHSPECS", "1")
            .env("GIT_AUTHOR_NAME", "napkin")
            .env("GIT_AUTHOR_EMAIL", "napkin@localhost")
            .env("GIT_COMMITTER_NAME", "napkin")
            .env("GIT_COMMITTER_EMAIL", "napkin@localhost")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env_remove("GIT_OBJECT_DIRECTORY")
            .env_remove("GIT_ALTERNATE_OBJECT_DIRECTORIES")
            .current_dir(&self.work)
            .args([
                "-c", "core.autocrlf=false",
                "-c", "core.safecrlf=false",
                "-c", "core.quotepath=false",
                "-c", "core.fsmonitor=false",
                "-c", "core.hooksPath=/dev/null",
                "-c", "gc.auto=0",
                "-c", "advice.addEmbeddedRepo=false",
            ]);
        c
    }

    fn run(&self, args: &[&str]) -> Result<String, String> {
        self.run_input(args, None)
    }

    fn run_input(&self, args: &[&str], input: Option<&[u8]>) -> Result<String, String> {
        let mut child = self
            .cmd()
            .args(args)
            .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("git: {e}"))?;
        if let Some(inp) = input {
            let mut stdin = child.stdin.take().unwrap();
            let data = inp.to_vec();
            std::thread::spawn(move || {
                let _ = stdin.write_all(&data);
            });
        }
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(String::from_utf8_lossy(&out.stdout).into_owned())
        } else {
            Err(format!("git {}: {}", args.first().unwrap_or(&""), String::from_utf8_lossy(&out.stderr).trim()))
        }
    }

    pub fn ensure(&self) -> Result<(), String> {
        if let Some(p) = self.index.parent() {
            std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        if self.git_dir.join("HEAD").exists() {
            return Ok(());
        }
        std::fs::create_dir_all(&self.git_dir).map_err(|e| e.to_string())?;
        let ok = Command::new("git")
            .args(["init", "--quiet", "--bare"])
            .arg(&self.git_dir)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|e| format!("git init: {e}"))?;
        if !ok.success() {
            return Err("git init failed".into());
        }
        self.run(&["config", "core.bare", "false"])?;
        self.run(&["config", "gc.auto", "0"])?;
        std::fs::create_dir_all(self.git_dir.join("info")).map_err(|e| e.to_string())?;
        std::fs::write(self.git_dir.join("info").join("exclude"), EXCLUDES).map_err(|e| e.to_string())?;
        std::fs::write(self.git_dir.join("napkin-project"), self.work.display().to_string()).ok();
        Ok(())
    }

    /// Counts files the first snapshot would pick up, stopping early past `cap`.
    pub fn count_files_capped(&self, cap: usize) -> Result<usize, String> {
        let mut child = self
            .cmd()
            .args(["ls-files", "--others", "--cached", "--exclude-standard", "-z"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?;
        let mut out = child.stdout.take().unwrap();
        let mut buf = [0u8; 64 * 1024];
        let mut n = 0usize;
        loop {
            match out.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(k) => {
                    n += buf[..k].iter().filter(|b| **b == 0).count();
                    if n > cap {
                        let _ = child.kill();
                        break;
                    }
                }
            }
        }
        let _ = child.wait();
        Ok(n)
    }

    /// Stage the whole work tree into this napkin's private index and return the tree id.
    pub fn write_tree(&self) -> Result<String, String> {
        self.run(&["add", "--all", "--ignore-errors", "--", "."])
            .or_else(|e| if e.contains("unable to index") || e.contains("Permission denied") { Ok(String::new()) } else { Err(e) })?;
        Ok(self.run(&["write-tree"])?.trim().to_string())
    }

    pub fn snapshot(&self, label: &str) -> Result<String, String> {
        let tree = self.write_tree()?;
        let commit = self.run(&["commit-tree", &tree, "-m", label])?.trim().to_string();
        self.run(&["update-ref", &format!("refs/napkin/{}/{}", self.napkin, commit), &commit])?;
        Ok(commit)
    }

    pub fn changes(&self, from: &str, to: &str) -> Result<Vec<FileChange>, String> {
        let status = self.run(&["diff-tree", "-r", "--no-renames", "--name-status", "-z", from, to])?;
        let numstat = self.run(&["diff-tree", "-r", "--no-renames", "--numstat", "-z", from, to])?;

        let mut map: BTreeMap<String, FileChange> = BTreeMap::new();
        let mut it = status.split('\0').filter(|s| !s.is_empty());
        while let (Some(st), Some(path)) = (it.next(), it.next()) {
            map.insert(
                path.to_string(),
                FileChange { path: path.to_string(), status: st[..1].to_string(), added: None, removed: None },
            );
        }
        for rec in numstat.split('\0').filter(|s| !s.is_empty()) {
            let mut parts = rec.splitn(3, '\t');
            if let (Some(a), Some(r), Some(p)) = (parts.next(), parts.next(), parts.next()) {
                if let Some(fc) = map.get_mut(p) {
                    fc.added = a.parse().ok();
                    fc.removed = r.parse().ok();
                }
            }
        }
        Ok(map.into_values().collect())
    }

    pub fn file_diff(&self, from: &str, to: &str, path: &str) -> Result<String, String> {
        self.run(&["diff", "--no-color", "--no-ext-diff", "--no-renames", "-U3", from, to, "--", path])
    }

    /// Return the work tree to checkpoint `cp` (optionally only `paths`). Always takes a
    /// safety snapshot first, so a rollback can itself be rolled back.
    pub fn restore(&self, cp: &str, paths: Option<&[String]>) -> Result<RestoreReport, String> {
        let safety = self.snapshot(&format!("before rollback to {}", &cp[..cp.len().min(8)]))?;
        let mut changes = self.changes(cp, &safety)?;
        if let Some(only) = paths {
            changes.retain(|c| only.iter().any(|p| p == &c.path));
        }

        let mut removed = 0;
        let mut to_checkout: Vec<u8> = Vec::new();
        let mut restored = 0;
        for c in &changes {
            if c.status == "A" {
                let full = self.work.join(&c.path);
                if std::fs::remove_file(&full).is_ok() {
                    removed += 1;
                    self.prune_empty_dirs(full.parent());
                }
            } else {
                to_checkout.extend_from_slice(c.path.as_bytes());
                to_checkout.push(0);
                restored += 1;
            }
        }
        if !to_checkout.is_empty() {
            self.run_input(&["checkout", cp, "--pathspec-from-file=-", "--pathspec-file-nul"], Some(&to_checkout))?;
        }
        Ok(RestoreReport { safety, restored, removed })
    }

    fn prune_empty_dirs(&self, mut dir: Option<&Path>) {
        while let Some(d) = dir {
            if d == self.work || !d.starts_with(&self.work) {
                break;
            }
            if std::fs::remove_dir(d).is_err() {
                break; // not empty
            }
            dir = d.parent();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("napkin-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn snapshot_diff_and_rollback_roundtrip() {
        let root = tmp("roundtrip");
        let (home, proj) = (root.join("home"), root.join("proj"));
        fs::create_dir_all(proj.join("src")).unwrap();
        fs::create_dir_all(proj.join("node_modules/x")).unwrap();
        fs::write(proj.join("keep.txt"), "same\n").unwrap();
        fs::write(proj.join("edit.txt"), "one\ntwo\n").unwrap();
        fs::write(proj.join("gone.txt"), "bye\n").unwrap();
        fs::write(proj.join("node_modules/x/i.js"), "ignored\n").unwrap();
        fs::write(proj.join(".gitignore"), "*.secret\n").unwrap();
        fs::write(proj.join("a.secret"), "shh\n").unwrap();

        let s = Shadow::new(&home, &proj, "n1");
        s.ensure().unwrap();
        assert!(s.count_files_capped(100).unwrap() <= 5);
        let boundary = s.snapshot("boundary").unwrap();

        // Claude does things
        fs::write(proj.join("edit.txt"), "one\nTWO\nthree\n").unwrap();
        fs::remove_file(proj.join("gone.txt")).unwrap();
        fs::write(proj.join("src/new.rs"), "fn main() {}\n").unwrap();
        fs::write(proj.join("node_modules/x/i.js"), "changed but ignored\n").unwrap();
        fs::write(proj.join("b.secret"), "ignored too\n").unwrap();

        let now = s.write_tree().unwrap();
        let ch = s.changes(&boundary, &now).unwrap();
        let summary: Vec<(String, String)> = ch.iter().map(|c| (c.status.clone(), c.path.clone())).collect();
        assert_eq!(
            summary,
            vec![
                ("M".into(), "edit.txt".into()),
                ("D".into(), "gone.txt".into()),
                ("A".into(), "src/new.rs".into()),
            ]
        );
        let edit = ch.iter().find(|c| c.path == "edit.txt").unwrap();
        assert_eq!((edit.added, edit.removed), (Some(2), Some(1)));
        assert!(s.file_diff(&boundary, &now, "edit.txt").unwrap().contains("+TWO"));

        // per-file revert
        let r = s.restore(&boundary, Some(&["edit.txt".to_string()])).unwrap();
        assert_eq!((r.restored, r.removed), (1, 0));
        assert_eq!(fs::read_to_string(proj.join("edit.txt")).unwrap(), "one\ntwo\n");
        assert!(proj.join("src/new.rs").exists());

        // full rollback
        let r = s.restore(&boundary, None).unwrap();
        assert_eq!((r.restored, r.removed), (1, 1));
        assert!(!proj.join("src/new.rs").exists());
        assert!(!proj.join("src").exists(), "empty dir pruned");
        assert_eq!(fs::read_to_string(proj.join("gone.txt")).unwrap(), "bye\n");
        assert_eq!(fs::read_to_string(proj.join("a.secret")).unwrap(), "shh\n");
        assert_eq!(fs::read_to_string(proj.join("node_modules/x/i.js")).unwrap(), "changed but ignored\n");

        // and the rollback itself is undoable
        s.restore(&r.safety, None).unwrap();
        assert!(proj.join("src/new.rs").exists());
        assert!(!proj.join("gone.txt").exists());

        // the user's own repo is untouched: no .git was created in the project
        assert!(!proj.join(".git").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn tolerates_user_git_repo_and_weird_names() {
        let root = tmp("userrepo");
        let (home, proj) = (root.join("home"), root.join("proj"));
        fs::create_dir_all(&proj).unwrap();
        assert!(Command::new("git").arg("init").arg("-q").arg(&proj).status().unwrap().success());
        fs::write(proj.join("with space [1] *.txt"), "x\n").unwrap();
        let s = Shadow::new(&home, &proj, "n2");
        s.ensure().unwrap();
        let b = s.snapshot("b").unwrap();
        fs::write(proj.join("with space [1] *.txt"), "y\n").unwrap();
        s.restore(&b, Some(&["with space [1] *.txt".to_string()])).unwrap();
        assert_eq!(fs::read_to_string(proj.join("with space [1] *.txt")).unwrap(), "x\n");
        // user's index untouched
        let st = Command::new("git").args(["status", "--porcelain"]).current_dir(&proj).output().unwrap();
        assert_eq!(String::from_utf8_lossy(&st.stdout).trim(), "?? \"with space [1] *.txt\"");
        let _ = fs::remove_dir_all(&root);
    }
}
