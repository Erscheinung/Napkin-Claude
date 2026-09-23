//! Napkin metadata (`napkins.json`). The app is the only writer; everything that
//! happens *during* a napkin lives in its event log instead.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Napkin {
    pub id: String,
    pub title: String,
    pub project: String,
    pub session_id: String,
    pub created_at: u64,
    pub updated_at: u64,
    /// Snapshot taken before Claude ever ran — the "throw it all away" boundary.
    #[serde(default)]
    pub boundary: Option<String>,
    #[serde(default)]
    pub tracking: bool,
    #[serde(default)]
    pub tracking_note: Option<String>,
    #[serde(default)]
    pub archived: bool,
}

pub struct Store {
    path: PathBuf,
    items: Mutex<Vec<Napkin>>,
}

impl Store {
    pub fn load(home: &Path) -> Store {
        let path = home.join("napkins.json");
        let items = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        Store { path, items: Mutex::new(items) }
    }

    fn save(&self, items: &[Napkin]) -> Result<(), String> {
        let tmp = self.path.with_extension("json.tmp");
        let data = serde_json::to_vec_pretty(items).map_err(|e| e.to_string())?;
        std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &self.path).map_err(|e| e.to_string())
    }

    pub fn list(&self) -> Vec<Napkin> {
        self.items.lock().unwrap().clone()
    }

    pub fn get(&self, id: &str) -> Option<Napkin> {
        self.items.lock().unwrap().iter().find(|n| n.id == id).cloned()
    }

    pub fn insert(&self, n: Napkin) -> Result<(), String> {
        let mut items = self.items.lock().unwrap();
        items.push(n);
        self.save(&items)
    }

    pub fn update<F: FnOnce(&mut Napkin)>(&self, id: &str, f: F) -> Result<Napkin, String> {
        let mut items = self.items.lock().unwrap();
        let n = items.iter_mut().find(|n| n.id == id).ok_or("no such napkin")?;
        f(n);
        let out = n.clone();
        self.save(&items)?;
        Ok(out)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let mut items = self.items.lock().unwrap();
        items.retain(|n| n.id != id);
        self.save(&items)
    }
}
