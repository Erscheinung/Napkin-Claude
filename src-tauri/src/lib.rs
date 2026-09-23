mod envprobe;
mod events;
pub mod hook;
mod napkins;
mod pty;
mod sessions;
mod sketches;
mod snapshot;

use events::Event;
use napkins::{Napkin, Store};
use serde::Serialize;
use snapshot::Shadow;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State};

struct AppState {
    home: PathBuf,
    store: Arc<Store>,
    pty: pty::PtyManager,
    tailer: events::Tailer,
}

type R<T> = Result<T, String>;

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> R<T> + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

// ── environment ────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct AppInfo {
    version: String,
    /// `NAPKIN_FIXTURE=reference` renders the reference mock data (fidelity gate / screenshots)
    fixture: Option<String>,
    home: String,
    data_dir: String,
    #[serde(flatten)]
    env: envprobe::ShellEnv,
}

#[tauri::command]
async fn app_info(app: AppHandle, state: State<'_, AppState>) -> R<AppInfo> {
    let env = blocking(|| Ok(envprobe::get().clone())).await?;
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        fixture: std::env::var("NAPKIN_FIXTURE").ok().filter(|s| !s.is_empty()),
        home: env.vars.get("HOME").or_else(|| env.vars.get("USERPROFILE")).cloned().unwrap_or_default(),
        data_dir: state.home.display().to_string(),
        env,
    })
}

#[tauri::command]
fn fixture() -> Option<String> {
    std::env::var("NAPKIN_FIXTURE").ok().filter(|s| !s.is_empty())
}

/// Fixture mode: the frontend reports element rects so the gate can check layout.
#[tauri::command]
fn fixture_report(json: String) -> R<()> {
    let out = std::env::var("NAPKIN_FIXTURE_OUT").map_err(|_| "NAPKIN_FIXTURE_OUT not set")?;
    std::fs::write(out, json).map_err(|e| e.to_string())
}

/// Last rate-limit snapshot any napkin session reported ("the tab").
#[tauri::command]
fn usage(state: State<'_, AppState>) -> Option<serde_json::Value> {
    serde_json::from_slice(&std::fs::read(state.home.join("usage.json")).ok()?).ok()
}

#[tauri::command]
async fn recent_projects() -> R<Vec<sessions::Project>> {
    blocking(|| Ok(sessions::recent_projects(24))).await
}

// ── napkins ────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct NapkinView {
    #[serde(flatten)]
    napkin: Napkin,
    running: bool,
}

#[tauri::command]
fn napkins_list(state: State<'_, AppState>) -> Vec<NapkinView> {
    let running = state.pty.running();
    state
        .store
        .list()
        .into_iter()
        .map(|n| NapkinView { running: running.contains(&n.id), napkin: n })
        .collect()
}

/// Whether a folder is sane to snapshot. `None` means yes; `Some(reason)` means no.
fn tracking_veto(project: &Path, shadow: &Shadow) -> Option<String> {
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
    if project.parent().is_none() || project == Path::new(&home) {
        return Some("tracking is off for your home folder — pick a project folder to get rollback".into());
    }
    if !envprobe::get().git {
        return Some("git isn't installed (xcode-select --install), so rollback is off".into());
    }
    if let Err(e) = shadow.ensure() {
        return Some(format!("couldn't set up snapshots: {e}"));
    }
    match shadow.count_files_capped(snapshot::MAX_FILES) {
        Ok(n) if n > snapshot::MAX_FILES => Some(format!(
            "more than {} files here — tracking is off (add a .gitignore to shrink it)",
            snapshot::MAX_FILES
        )),
        Ok(_) => None,
        Err(e) => Some(e),
    }
}

#[tauri::command]
async fn napkin_create(state: State<'_, AppState>, project: String, title: Option<String>, resume_session: Option<String>) -> R<Napkin> {
    let home = state.home.clone();
    let store = state.store.clone();
    blocking(move || {
        let project = std::fs::canonicalize(&project).map_err(|e| format!("{project}: {e}"))?;
        if !project.is_dir() {
            return Err("that's not a folder".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let shadow = Shadow::new(&home, &project, &id);
        let veto = tracking_veto(&project, &shadow);
        let mut boundary = None;
        let mut note = veto.clone();
        if veto.is_none() {
            match shadow.snapshot("napkin boundary") {
                Ok(c) => boundary = Some(c),
                Err(e) => note = Some(format!("snapshot failed: {e}")),
            }
        }
        let now = events::now_ms();
        let n = Napkin {
            title: title.unwrap_or_else(|| "fresh napkin".into()),
            project: project.display().to_string(),
            session_id: resume_session.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            created_at: now,
            updated_at: now,
            tracking: boundary.is_some(),
            tracking_note: note,
            boundary: boundary.clone(),
            archived: false,
            id,
        };
        let mut e = Event::new("boundary");
        e.cp = boundary;
        e.label = Some("napkin laid down".into());
        let _ = events::append(&events::log_path(&home, &n.id), &e);
        store.insert(n.clone())?;
        Ok(n)
    })
    .await
}

#[tauri::command]
async fn napkin_open(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
    doodle: Option<bool>,
    on_data: Channel<InvokeResponseBody>,
) -> R<pty::Spawned> {
    let n = state.store.get(&id).ok_or("no such napkin")?;
    let env = blocking(|| Ok(envprobe::get().clone())).await?;
    let claude = env.claude.clone().ok_or("couldn't find `claude` on your PATH — install Claude Code first")?;
    if !Path::new(&n.project).is_dir() {
        return Err(format!("{} no longer exists", n.project));
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?.display().to_string();

    let resume = sessions::session_exists(&n.session_id);
    let mut args = vec![
        if resume { "--resume" } else { "--session-id" }.to_string(),
        n.session_id.clone(),
        "--settings".into(),
        hook::settings_json(&exe),
    ];
    if doodle.unwrap_or(false) {
        args.extend(["--append-system-prompt".into(), DOODLE_PROMPT.into()]);
    }
    if !resume && n.title != "fresh napkin" {
        args.extend(["--name".into(), n.title.clone()]);
    }

    let mut vars: Vec<(String, String)> = env.vars.clone().into_iter().collect();
    vars.retain(|(k, _)| !k.starts_with("NAPKIN_"));
    let lang_set = vars.iter().any(|(k, v)| (k == "LANG" || k == "LC_ALL") && !v.is_empty());
    vars.extend([
        ("TERM".into(), "xterm-256color".into()),
        ("COLORTERM".into(), "truecolor".into()),
        ("NAPKIN_HOME".into(), state.home.display().to_string()),
        ("NAPKIN_ID".into(), n.id.clone()),
        ("NAPKIN_PROJECT".into(), n.project.clone()),
        ("NAPKIN_TRACK".into(), if n.tracking { "1" } else { "0" }.into()),
    ]);
    if !lang_set {
        vars.push(("LANG".into(), "en_US.UTF-8".into()));
    }
    if let Some(sl) = hook::user_statusline() {
        vars.push(("NAPKIN_USER_STATUSLINE".into(), sl));
    }

    let spawned = state.pty.spawn(
        app,
        pty::SpawnOpts { id: id.clone(), program: claude, args, cwd: n.project.clone(), env: vars, cols, rows },
        on_data,
    )?;
    let _ = state.store.update(&id, |n| n.updated_at = events::now_ms());
    Ok(spawned)
}

/// Teaches Claude the sketch format so it can read the user's napkin sketches and draw back.
const DOODLE_PROMPT: &str = "This session runs inside Napkin, which has a sketch pad. Sketches live in \
.napkin/sketches/: <name>.md (ASCII drawing + shape list; read this when the user references a sketch), \
<name>.png, and <name>.napkin.json. You may draw for the user (diagrams, layouts, flows) by writing \
.napkin/sketches/<name>.napkin.json; Napkin shows it live. Format: {\"version\":1,\"name\":\"<name>\",\"shapes\":[\
{\"kind\":\"rect|ellipse|diamond|line|arrow|pen|text\",\"x\":40,\"y\":40,\"w\":160,\"h\":70,\"text\":\"label\",\
\"color\":\"#35322e\",\"fill\":false}]}. Boxes use x,y = top-left and w,h = size; line/arrow use x,y = start and \
w,h = delta to the end; pen uses \"points\":[[x,y],...]; text uses x,y = top-left. Canvas is about 900x560 px. \
Colors: #35322e graphite, #e0764e clay, #b8392b red, #2c47a3 blue, #2f6b34 green. Only draw when it helps.";

#[tauri::command]
fn napkin_attach(state: State<'_, AppState>, id: String) -> Vec<Event> {
    state.tailer.attach(&id, events::log_path(&state.home, &id))
}

#[tauri::command]
fn pty_write(state: State<'_, AppState>, id: String, data: String) -> R<()> {
    state.pty.write(&id, data.as_bytes())
}

#[tauri::command]
fn pty_resize(state: State<'_, AppState>, id: String, cols: u16, rows: u16) -> R<()> {
    state.pty.resize(&id, cols, rows)
}

#[tauri::command]
fn napkin_stop(state: State<'_, AppState>, id: String) {
    state.pty.kill(&id);
}

#[tauri::command]
fn napkin_rename(state: State<'_, AppState>, id: String, title: String) -> R<Napkin> {
    let title = title.trim().chars().take(80).collect::<String>();
    state.store.update(&id, |n| n.title = if title.is_empty() { "untitled napkin".into() } else { title })
}

/// "Crumple": stop the session and move the napkin off the table (kept in history).
#[tauri::command]
fn napkin_archive(state: State<'_, AppState>, id: String, archived: bool) -> R<Napkin> {
    if archived {
        state.pty.kill(&id);
        state.tailer.detach(&id);
    }
    state.store.update(&id, |n| n.archived = archived)
}

/// Forget a napkin entirely: metadata, event log and private index. Snapshot objects stay.
#[tauri::command]
fn napkin_forget(state: State<'_, AppState>, id: String) -> R<()> {
    state.pty.kill(&id);
    state.tailer.detach(&id);
    state.store.remove(&id)?;
    let dir = state.home.join("napkins").join(&id);
    if dir.starts_with(state.home.join("napkins")) && id.len() >= 32 {
        let _ = std::fs::remove_dir_all(dir);
    }
    Ok(())
}

// ── blast radius ───────────────────────────────────────────────────────────

fn shadow_for(state: &AppState, id: &str) -> R<(Napkin, Shadow)> {
    let n = state.store.get(id).ok_or("no such napkin")?;
    if !n.tracking {
        return Err(n.tracking_note.clone().unwrap_or_else(|| "tracking is off for this napkin".into()));
    }
    let s = Shadow::new(&state.home, Path::new(&n.project), id);
    Ok((n, s))
}

#[derive(Serialize)]
struct Changes {
    from: String,
    to: String,
    files: Vec<snapshot::FileChange>,
}

/// Diff `from` (default: the napkin boundary) against `to` (default: the live work tree).
#[tauri::command]
async fn napkin_changes(state: State<'_, AppState>, id: String, from: Option<String>, to: Option<String>) -> R<Changes> {
    let (n, shadow) = shadow_for(&state, &id)?;
    blocking(move || {
        let from = from.or(n.boundary).ok_or("no boundary snapshot")?;
        let to = match to {
            Some(t) => t,
            None => shadow.write_tree()?,
        };
        let files = shadow.changes(&from, &to)?;
        Ok(Changes { from, to, files })
    })
    .await
}

/// Start a fresh ink record (new boundary) — used when the old snapshots are gone.
#[tauri::command]
async fn napkin_rebase(state: State<'_, AppState>, id: String) -> R<Napkin> {
    let n = state.store.get(&id).ok_or("no such napkin")?;
    let home = state.home.clone();
    let store = state.store.clone();
    blocking(move || {
        let shadow = Shadow::new(&home, Path::new(&n.project), &id);
        shadow.ensure()?;
        let cp = shadow.snapshot("napkin boundary (fresh record)")?;
        let mut e = Event::new("boundary");
        e.cp = Some(cp.clone());
        e.label = Some("fresh ink record".into());
        events::append(&events::log_path(&home, &id), &e).map_err(|e| e.to_string())?;
        store.update(&id, |n| {
            n.boundary = Some(cp);
            n.tracking = true;
            n.tracking_note = None;
        })
    })
    .await
}

#[tauri::command]
async fn napkin_file_diff(state: State<'_, AppState>, id: String, from: String, to: String, path: String) -> R<String> {
    let (_, shadow) = shadow_for(&state, &id)?;
    blocking(move || shadow.file_diff(&from, &to, &path)).await
}

#[tauri::command]
async fn napkin_checkpoint(state: State<'_, AppState>, id: String, label: String) -> R<String> {
    let (_, shadow) = shadow_for(&state, &id)?;
    let log = events::log_path(&state.home, &id);
    blocking(move || {
        let cp = shadow.snapshot(&label)?;
        let mut e = Event::new("checkpoint");
        e.cp = Some(cp.clone());
        e.label = Some(label);
        events::append(&log, &e).map_err(|e| e.to_string())?;
        Ok(cp)
    })
    .await
}

#[tauri::command]
async fn napkin_rollback(state: State<'_, AppState>, id: String, cp: String, paths: Option<Vec<String>>, label: Option<String>) -> R<snapshot::RestoreReport> {
    let (_, shadow) = shadow_for(&state, &id)?;
    let log = events::log_path(&state.home, &id);
    blocking(move || {
        let report = shadow.restore(&cp, paths.as_deref())?;
        let mut e = Event::new("rollback");
        e.cp = Some(report.safety.clone());
        e.label = label.or(Some(format!("rolled back to {}", &cp[..cp.len().min(8)])));
        e.files = paths;
        events::append(&log, &e).map_err(|e| e.to_string())?;
        Ok(report)
    })
    .await
}

// ── sketches ───────────────────────────────────────────────────────────────

#[tauri::command]
async fn sketch_list(project: String) -> R<Vec<sketches::SketchFile>> {
    blocking(move || Ok(sketches::list(&project))).await
}

#[tauri::command]
async fn sketch_save(project: String, name: String, data: String, png: Option<String>, spec: Option<String>) -> R<sketches::Saved> {
    blocking(move || sketches::save(&project, &name, &data, png.as_deref(), spec.as_deref())).await
}

#[tauri::command]
async fn sketch_delete(project: String, name: String) -> R<()> {
    blocking(move || sketches::delete(&project, &name)).await
}

// ── app ────────────────────────────────────────────────────────────────────

/// A minimal menu: no ⌘W "Close Window" (⌘W crumples a napkin instead) and no ⌘Z
/// (the sketch canvas owns undo). Copy/paste stay so text fields and xterm work.
fn menu(h: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{AboutMetadata, Menu, PredefinedMenuItem as P, Submenu};
    let about = AboutMetadata { credits: Some("A paper-napkin skin for Claude Code.".into()), ..Default::default() };
    Menu::with_items(
        h,
        &[
            &Submenu::with_items(
                h,
                "Napkin",
                true,
                &[
                    &P::about(h, None, Some(about))?,
                    &P::separator(h)?,
                    &P::services(h, None)?,
                    &P::separator(h)?,
                    &P::hide(h, None)?,
                    &P::hide_others(h, None)?,
                    &P::show_all(h, None)?,
                    &P::separator(h)?,
                    &P::quit(h, None)?,
                ],
            )?,
            &Submenu::with_items(h, "Edit", true, &[&P::cut(h, None)?, &P::copy(h, None)?, &P::paste(h, None)?, &P::select_all(h, None)?])?,
            &Submenu::with_items(h, "Window", true, &[&P::minimize(h, None)?, &P::maximize(h, None)?, &P::fullscreen(h, None)?])?,
        ],
    )
}

// ── app ────────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Warm the shell-env probe off the main thread; first napkin opens instantly.
    std::thread::spawn(|| {
        envprobe::get();
    });

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.set_menu(menu(app.handle())?)?;
            if let Some(w) = app.get_webview_window("main").filter(|_| std::env::var("NAPKIN_FIXTURE").is_ok_and(|s| !s.is_empty())) {
                // screenshots / gate: occluded webviews don't paint, so come to the front
                let _ = w.set_focus();
                if std::env::var("NAPKIN_FIXTURE").is_ok_and(|s| s == "reference") {
                    // 1360×850 at 0.85 zoom = a 1600×1000 CSS viewport, fits a 13" screen
                    let _ = w.set_size(tauri::LogicalSize::new(1360.0, 850.0));
                    let _ = w.set_zoom(0.85);
                    let _ = w.center();
                }
            }
            // NAPKIN_DATA_DIR isolates a run (screenshots, tests) from the real napkin store
            let home = match std::env::var("NAPKIN_DATA_DIR") {
                Ok(d) if !d.is_empty() => PathBuf::from(d),
                _ => app.path().app_data_dir()?,
            };
            std::fs::create_dir_all(home.join("napkins"))?;
            let tailer = events::Tailer::default();
            tailer.start(app.handle().clone());
            app.manage(AppState {
                store: Arc::new(Store::load(&home)),
                home,
                pty: pty::PtyManager::default(),
                tailer,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            fixture,
            fixture_report,
            usage,
            recent_projects,
            napkins_list,
            napkin_create,
            napkin_open,
            napkin_attach,
            pty_write,
            pty_resize,
            napkin_stop,
            napkin_rename,
            napkin_archive,
            napkin_forget,
            napkin_changes,
            napkin_file_diff,
            napkin_rebase,
            napkin_checkpoint,
            napkin_rollback,
            sketch_list,
            sketch_save,
            sketch_delete,
        ])
        .build(tauri::generate_context!())
        .expect("error while building napkin");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = handle.try_state::<AppState>() {
                state.pty.kill_all();
            }
        }
    });
}
