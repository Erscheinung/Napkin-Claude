import { invoke, Channel } from "@tauri-apps/api/core";

export type AppInfo = {
  version: string;
  fixture: string | null;
  home: string;
  data_dir: string;
  claude: string | null;
  claude_version: string | null;
  git: boolean;
  shell: string;
};

export type Project = {
  path: string;
  name: string;
  last_active: number;
  sessions: number;
  last_session: string | null;
  last_prompt: string | null;
  exists: boolean;
};

export type Napkin = {
  id: string;
  title: string;
  project: string;
  session_id: string;
  created_at: number;
  updated_at: number;
  boundary: string | null;
  tracking: boolean;
  tracking_note: string | null;
  archived: boolean;
  running: boolean;
};

export type NapkinEvent = {
  t: number;
  ev: string;
  tool?: string;
  files?: string[];
  prompt?: string;
  msg?: string;
  kind?: string;
  cp?: string;
  label?: string;
  err?: string;
};

export type FileChange = {
  path: string;
  status: "A" | "M" | "D" | "T";
  added: number | null;
  removed: number | null;
};

export type Changes = { from: string; to: string; files: FileChange[] };
export type RestoreReport = { safety: string; restored: number; removed: number };
export type Spawned = { gen: number; pid: number | null };
export type SketchFile = { name: string; data: string; mtime: number };
export type SavedSketch = { dir: string; json: string; png: string | null; spec: string | null };

export type Window5 = { used_percentage: number; resets_at: number };
export type Usage = { t: number; rate_limits: { five_hour?: Window5; seven_day?: Window5 } };

export const api = {
  usage: () => invoke<Usage | null>("usage"),
  fixture: () => invoke<string | null>("fixture"),
  fixtureReport: (json: string) => invoke<void>("fixture_report", { json }),
  appInfo: () => invoke<AppInfo>("app_info"),
  recentProjects: () => invoke<Project[]>("recent_projects"),
  napkins: () => invoke<Napkin[]>("napkins_list"),
  create: (project: string, title?: string, resumeSession?: string) =>
    invoke<Napkin>("napkin_create", { project, title, resumeSession }),
  open: (id: string, cols: number, rows: number, onData: Channel<ArrayBuffer>) =>
    invoke<Spawned>("napkin_open", { id, cols, rows, onData }),
  attach: (id: string) => invoke<NapkinEvent[]>("napkin_attach", { id }),
  write: (id: string, data: string) => invoke<void>("pty_write", { id, data }),
  resize: (id: string, cols: number, rows: number) => invoke<void>("pty_resize", { id, cols, rows }),
  stop: (id: string) => invoke<void>("napkin_stop", { id }),
  rename: (id: string, title: string) => invoke<Napkin>("napkin_rename", { id, title }),
  archive: (id: string, archived: boolean) => invoke<Napkin>("napkin_archive", { id, archived }),
  forget: (id: string) => invoke<void>("napkin_forget", { id }),
  changes: (id: string, from?: string, to?: string) => invoke<Changes>("napkin_changes", { id, from, to }),
  fileDiff: (id: string, from: string, to: string, path: string) =>
    invoke<string>("napkin_file_diff", { id, from, to, path }),
  checkpoint: (id: string, label: string) => invoke<string>("napkin_checkpoint", { id, label }),
  rollback: (id: string, cp: string, paths?: string[], label?: string) =>
    invoke<RestoreReport>("napkin_rollback", { id, cp, paths, label }),
  sketchList: (project: string) => invoke<SketchFile[]>("sketch_list", { project }),
  sketchSave: (project: string, name: string, data: string, png?: string, spec?: string) =>
    invoke<SavedSketch>("sketch_save", { project, name, data, png, spec }),
  sketchDelete: (project: string, name: string) => invoke<void>("sketch_delete", { project, name }),
};

export { Channel };
