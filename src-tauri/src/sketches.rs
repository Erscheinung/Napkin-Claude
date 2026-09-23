//! Sketch files live with the project in `.napkin/sketches/` (a self-ignoring dir),
//! so Claude can `@`-reference them and they outlive any single napkin.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct SketchFile {
    pub name: String,
    pub data: String,
    pub mtime: u64,
}

#[derive(Serialize)]
pub struct Saved {
    pub dir: String,
    pub json: String,
    pub png: Option<String>,
    pub spec: Option<String>,
}

pub fn dir(project: &str) -> PathBuf {
    Path::new(project).join(".napkin").join("sketches")
}

fn ensure(project: &str) -> Result<PathBuf, String> {
    let d = dir(project);
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let ignore = Path::new(project).join(".napkin").join(".gitignore");
    if !ignore.exists() {
        std::fs::write(ignore, "# napkin scratch space — ignored by git\n*\n").map_err(|e| e.to_string())?;
    }
    Ok(d)
}

pub fn slug(name: &str) -> String {
    let s: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let s = s.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-");
    if s.is_empty() { "sketch".into() } else { s.chars().take(60).collect() }
}

pub fn list(project: &str) -> Vec<SketchFile> {
    let Ok(rd) = std::fs::read_dir(dir(project)) else { return vec![] };
    let mut out: Vec<SketchFile> = rd
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            let name = p.file_name()?.to_str()?.strip_suffix(".napkin.json")?.to_string();
            let mtime = e
                .metadata()
                .ok()?
                .modified()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?
                .as_millis() as u64;
            Some(SketchFile { name, data: std::fs::read_to_string(&p).ok()?, mtime })
        })
        .collect();
    out.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    out
}

pub fn save(project: &str, name: &str, data: &str, png_b64: Option<&str>, spec: Option<&str>) -> Result<Saved, String> {
    let d = ensure(project)?;
    let s = slug(name);
    let json = d.join(format!("{s}.napkin.json"));
    std::fs::write(&json, data).map_err(|e| e.to_string())?;
    let png = match png_b64 {
        Some(b) => {
            let p = d.join(format!("{s}.png"));
            std::fs::write(&p, b64_decode(b)?).map_err(|e| e.to_string())?;
            Some(p.display().to_string())
        }
        None => None,
    };
    let spec = match spec {
        Some(md) => {
            let p = d.join(format!("{s}.md"));
            std::fs::write(&p, md).map_err(|e| e.to_string())?;
            Some(p.display().to_string())
        }
        None => None,
    };
    Ok(Saved { dir: d.display().to_string(), json: json.display().to_string(), png, spec })
}

pub fn delete(project: &str, name: &str) -> Result<(), String> {
    let d = dir(project);
    let s = slug(name);
    for ext in ["napkin.json", "png", "md"] {
        let _ = std::fs::remove_file(d.join(format!("{s}.{ext}")));
    }
    Ok(())
}

fn b64_decode(s: &str) -> Result<Vec<u8>, String> {
    let s = s.split_once(',').map(|(_, b)| b).unwrap_or(s); // tolerate data: URLs
    let val = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            _ => return None,
        } as u32)
    };
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let (mut acc, mut bits) = (0u32, 0u32);
    for c in s.bytes().filter(|c| !c.is_ascii_whitespace() && *c != b'=') {
        acc = (acc << 6) | val(c).ok_or("bad base64")?;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    #[test]
    fn b64() {
        assert_eq!(super::b64_decode("aGVsbG8gbmFwa2lu").unwrap(), b"hello napkin");
        assert_eq!(super::b64_decode("data:image/png;base64,YQ==").unwrap(), b"a");
    }
    #[test]
    fn slug() {
        assert_eq!(super::slug("  Login Flow / v2 "), "login-flow-v2");
        assert_eq!(super::slug("!!!"), "sketch");
    }
}
