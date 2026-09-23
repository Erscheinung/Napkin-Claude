import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, type AppInfo, type Napkin, type NapkinEvent, type Project, type Usage } from "./api";
import { basename } from "./format";
import { disposeTerm } from "./terminals.svelte";

export type Status = "resting" | "starting" | "ready" | "working" | "needs_you" | "done";

export type Turn = {
  n: number;
  prompt: string;
  at: number;
  before?: string;
  after?: string;
  files: string[];
  err?: string;
};

export type Mark = {
  kind: "boundary" | "checkpoint" | "rollback";
  at: number;
  cp?: string;
  label: string;
  files?: string[];
};

export type Live = {
  status: Status;
  turns: Turn[];
  marks: Mark[];
  /** absolute paths Claude edited with its own tools (Write/Edit/…) */
  touched: string[];
  lastMsg?: string;
  /** bumps whenever files may have changed → ink spill refreshes */
  rev: number;
  exitCode?: number | null;
};

export type View = { kind: "home" } | { kind: "napkin"; id: string; tab: "talk" | "sketch" };

export type Toast = { text: string; tone: "ink" | "red"; action?: { label: string; run: () => void } };

export const DEFAULT_TITLE = "fresh napkin";

function blankLive(): Live {
  return { status: "resting", turns: [], marks: [], touched: [], rev: 0 };
}

class AppState {
  info = $state<AppInfo | null>(null);
  napkins = $state<Napkin[]>([]);
  projects = $state<Project[]>([]);
  view = $state<View>({ kind: "home" });
  live = $state<Record<string, Live>>({});
  now = $state(Date.now());
  toast = $state<Toast | null>(null);
  private toastSeq = 0;
  paletteOpen = $state(false);
  usage = $state<Usage | null>(null);
  crumpling = $state<string | null>(null);

  get onTable() {
    return this.napkins.filter((n) => !n.archived).sort((a, b) => b.updated_at - a.updated_at);
  }
  get crumpled() {
    return this.napkins.filter((n) => n.archived).sort((a, b) => b.updated_at - a.updated_at);
  }
  get activeId(): string | null {
    return this.view.kind === "napkin" ? this.view.id : null;
  }
  napkin(id: string | null) {
    return id ? this.napkins.find((n) => n.id === id) : undefined;
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  fixture = $state<string | null>(null);
  /** screenshot extras: "diff" | "palette" | "crumple" */
  fixtureExtra = $state<string | null>(null);

  async init() {
    this.fixture = await api.fixture().catch(() => null);
    // `NAPKIN_FIXTURE=open:<napkin id>[:sketch]` — launch straight into a real napkin (screenshots)
    const openOnStart = this.fixture?.startsWith("open:") ? this.fixture.split(":") : null;
    if (openOnStart) this.fixture = null;
    if (this.fixture) {
      const { referenceFixture } = await import("./fixture");
      const f = referenceFixture(Date.now());
      Object.assign(this, { now: f.now, napkins: f.napkins, live: f.live, projects: f.projects, info: f.info, usage: f.usage });
      for (const n of f.napkins) this.attached.add(n.id);
      return;
    }
    listen<{ id: string; events: NapkinEvent[] }>("napkin-events", ({ payload }) => {
      this.reduce(payload.id, payload.events, true);
    });
    setInterval(() => (this.now = Date.now()), 30_000);
    const pollUsage = () => api.usage().then((u) => (this.usage = u), () => {});
    pollUsage();
    setInterval(pollUsage, 20_000);
    const [napkins] = await Promise.all([api.napkins(), this.refreshProjects()]);
    this.napkins = napkins;
    api.appInfo().then((i) => (this.info = i));
    for (const n of this.onTable) this.ensureLive(n.id);
    if (openOnStart?.[1] && this.napkin(openOnStart[1])) {
      this.open(openOnStart[1], openOnStart[2] === "sketch" ? "sketch" : "talk");
      this.fixtureExtra = openOnStart[3] ?? null;
      if (this.fixtureExtra === "palette") setTimeout(() => (this.paletteOpen = true), 1500);
      if (this.fixtureExtra === "crumple") setTimeout(() => (this.crumpling = openOnStart[1]), 1500);
    }
  }

  async refreshProjects() {
    try {
      this.projects = await api.recentProjects();
    } catch (e) {
      console.warn(e);
    }
  }

  async refreshNapkins() {
    this.napkins = await api.napkins();
  }

  flash(text: string, tone: "ink" | "red" = "ink", action?: Toast["action"]) {
    // $state proxies objects, so compare a sequence number rather than identity
    const seq = ++this.toastSeq;
    this.toast = { text, tone, action };
    setTimeout(() => seq === this.toastSeq && (this.toast = null), action ? 7000 : 3800);
  }

  // ── napkin live state ───────────────────────────────────────────────────

  private attached = new Set<string>();

  ensureLive(id: string): Live {
    if (!this.live[id]) this.live[id] = blankLive();
    if (!this.attached.has(id)) {
      this.attached.add(id);
      api.attach(id).then((events) => this.reduce(id, events, false));
    }
    return this.live[id];
  }

  setStatus(id: string, status: Status) {
    this.ensureLive(id).status = status;
  }

  setRunning(id: string, running: boolean) {
    const n = this.napkin(id);
    if (n) n.running = running;
    const l = this.ensureLive(id);
    if (!running) l.status = "resting";
  }

  reduce(id: string, events: NapkinEvent[], isLive: boolean) {
    const l = this.live[id] ?? (this.live[id] = blankLive());
    const running = !!this.napkin(id)?.running;
    for (const e of events) {
      const turn = l.turns[l.turns.length - 1];
      switch (e.ev) {
        case "boundary":
          l.marks.push({ kind: "boundary", at: e.t, cp: e.cp, label: e.label ?? "napkin laid down" });
          break;
        case "checkpoint":
          l.marks.push({ kind: "checkpoint", at: e.t, cp: e.cp, label: e.label ?? "checkpoint" });
          break;
        case "rollback":
          l.marks.push({ kind: "rollback", at: e.t, cp: e.cp, label: e.label ?? "rolled back", files: e.files });
          l.rev++;
          break;
        case "UserPromptSubmit":
          l.turns.push({ n: l.turns.length + 1, prompt: e.prompt ?? "", at: e.t, before: e.cp, files: [], err: e.err });
          l.status = "working";
          if (isLive) this.maybeAutoTitle(id, e.prompt ?? "");
          break;
        case "PostToolUse":
          if (l.status === "needs_you" || l.status === "ready" || l.status === "done") l.status = "working";
          for (const f of e.files ?? []) {
            if (turn && !turn.files.includes(f)) turn.files.push(f);
            if (!l.touched.includes(f)) l.touched.push(f);
          }
          if (e.files?.length) l.rev++;
          break;
        case "Notification": {
          const idle = e.kind === "idle_prompt" || /waiting for your input/i.test(e.msg ?? "");
          if (!idle) l.status = "needs_you";
          l.lastMsg = e.msg;
          break;
        }
        case "Stop":
          if (turn) {
            turn.after = e.cp;
            if (e.err) turn.err = e.err;
          }
          l.status = "done";
          l.rev++;
          break;
      }
    }
    if (!isLive && !running) l.status = "resting";
    else if (!isLive && running && l.status === "resting") l.status = "ready";
    if (isLive) {
      const n = this.napkin(id);
      if (n) n.updated_at = Date.now();
    }
  }

  private async maybeAutoTitle(id: string, prompt: string) {
    const n = this.napkin(id);
    if (!n || n.title !== DEFAULT_TITLE) return;
    const line = prompt.split("\n").find((s) => s.trim()) ?? "";
    let title = line.trim().replace(/\s+/g, " ");
    if (!title || title.startsWith("/")) return;
    if (title.length > 42) title = title.slice(0, 40).replace(/\s+\S*$/, "") + "…";
    n.title = title;
    api.rename(id, title).catch(() => {});
  }

  // ── actions ─────────────────────────────────────────────────────────────

  async pickFolder(): Promise<string | null> {
    const picked = await openDialog({ directory: true, multiple: false, title: "Lay a napkin down in…" });
    return typeof picked === "string" ? picked : null;
  }

  async newNapkin(project?: string, opts: { title?: string; resume?: string } = {}) {
    const folder = project ?? (await this.pickFolder());
    if (!folder) return;
    try {
      const n = await api.create(folder, opts.title, opts.resume);
      this.napkins.push({ ...n, running: false });
      this.ensureLive(n.id);
      this.open(n.id);
      if (n.tracking_note) this.flash(n.tracking_note, "red");
      this.refreshProjects();
    } catch (e) {
      this.flash(String(e), "red");
    }
  }

  /** "continue" on a recent project: resume Claude's latest session there. */
  continueProject(p: Project) {
    const title = p.last_prompt ? p.last_prompt.slice(0, 42) : `${p.name} (continued)`;
    return this.newNapkin(p.path, { title, resume: p.last_session ?? undefined });
  }

  open(id: string, tab: "talk" | "sketch" = "talk") {
    const n = this.napkin(id);
    if (n?.archived) {
      n.archived = false;
      api.archive(id, false);
    }
    this.ensureLive(id);
    this.view = { kind: "napkin", id, tab };
  }

  home() {
    this.view = { kind: "home" };
    this.refreshProjects();
  }

  async rename(id: string, title: string) {
    const n = await api.rename(id, title);
    const cur = this.napkin(id);
    if (cur) cur.title = n.title;
  }

  /** Stop the session and take the napkin off the table (optionally undoing its changes). */
  async crumple(id: string, rollback: boolean) {
    const n = this.napkin(id);
    if (!n) return;
    try {
      await api.stop(id); // nothing may write while we roll back
      if (rollback && n.boundary) {
        const r = await api.rollback(id, n.boundary, undefined, "crumpled — wiped clean");
        this.flash(`wiped clean · ${r.restored} put back, ${r.removed} tossed`);
      }
      await api.archive(id, true);
      n.archived = true;
      n.running = false;
      this.attached.delete(id);
      delete this.live[id];
      disposeTerm(id);
      if (this.activeId === id) {
        const next = this.onTable[0];
        next ? this.open(next.id) : this.home();
      }
    } catch (e) {
      this.flash(String(e), "red");
    }
  }

  async forget(id: string) {
    await api.forget(id);
    this.napkins = this.napkins.filter((n) => n.id !== id);
  }

  projectName(n: Napkin) {
    return basename(n.project);
  }
}

export const app = new AppState();
