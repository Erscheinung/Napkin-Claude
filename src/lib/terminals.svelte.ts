// One long-lived xterm per napkin, kept outside Svelte's reactivity. Terminals keep
// running (and buffering) while hidden; only the visible one gets a WebGL renderer,
// because WebKit caps the number of live WebGL contexts.

import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { listen } from "@tauri-apps/api/event";
import { api, Channel } from "./api";
import { app } from "./state.svelte";
import { settings } from "./settings.svelte";

export const paperTheme: ITheme = {
  // transparent so the crinkled napkin shows through behind the text
  background: "rgba(251, 248, 241, 0)",
  foreground: "#2b2926",
  cursor: "#d9683c",
  cursorAccent: "#fbf8f1",
  selectionBackground: "rgba(233, 138, 95, 0.30)",
  selectionInactiveBackground: "rgba(120, 110, 95, 0.18)",
  black: "#2b2926",
  red: "#b3372b",
  green: "#3f7a3a",
  yellow: "#9a6700",
  blue: "#2f4a9e",
  magenta: "#8a3f86",
  cyan: "#1f6f78",
  white: "#8f887c",
  brightBlack: "#6f685e",
  brightRed: "#d0523f",
  brightGreen: "#4f9447",
  brightYellow: "#b07c10",
  brightBlue: "#4061bd",
  brightMagenta: "#a8559f",
  brightCyan: "#2c8c96",
  brightWhite: "#aaa397",
};

export const TERM_FONT = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';

class NapkinTerm {
  readonly el: HTMLDivElement;
  readonly term: Terminal;
  private fit = new FitAddon();
  private webgl: WebglAddon | null = null;
  private resizeObs: ResizeObserver | null = null;
  private fitQueued = false;
  private opened = false;
  gen = 0;
  starting: Promise<void> | null = null;

  constructor(readonly id: string) {
    this.el = document.createElement("div");
    this.el.className = "xterm-host";
    this.term = new Terminal({
      fontFamily: TERM_FONT,
      fontSize: settings.fontSize,
      lineHeight: 1.18,
      letterSpacing: 0,
      theme: paperTheme,
      cursorBlink: true,
      cursorStyle: "bar",
      cursorWidth: 2,
      scrollback: 10_000,
      allowProposedApi: true,
      allowTransparency: true,
      minimumContrastRatio: 3,
      drawBoldTextInBrightColors: false,
      macOptionClickForcesSelection: true,
      smoothScrollDuration: 0,
    });
    this.term.loadAddon(this.fit);
    this.term.loadAddon(new Unicode11Addon());
    this.term.unicode.activeVersion = "11";

    this.term.onData((d) => this.send(d));
    this.term.onResize(({ cols, rows }) => api.resize(this.id, cols, rows).catch(() => {}));
    this.term.attachCustomKeyEventHandler((e) => {
      // Shift+Enter → newline in Claude Code's prompt (sent as Meta+Enter).
      if (e.key === "Enter" && e.shiftKey && !e.metaKey && !e.ctrlKey) {
        if (e.type === "keydown") this.send("\x1b\r");
        return false;
      }
      // Leave ⌘-shortcuts to the app (⌘C/⌘V still work through the Edit menu).
      if (e.metaKey && !["c", "v", "a"].includes(e.key.toLowerCase())) return false;
      return true;
    });
  }

  send(data: string) {
    if (!app.napkin(this.id)?.running) return;
    api.write(this.id, data).catch(() => {});
  }

  /** Type text into the prompt (bracketed paste, so newlines don't submit). */
  paste(text: string) {
    this.term.paste(text);
    this.term.focus();
  }

  mount(host: HTMLElement) {
    if (this.el.parentElement !== host) host.appendChild(this.el);
    if (!this.opened) {
      this.term.open(this.el);
      this.opened = true;
    }
    if (!this.webgl) {
      try {
        this.webgl = new WebglAddon();
        this.webgl.onContextLoss(() => {
          this.webgl?.dispose();
          this.webgl = null;
        });
        this.term.loadAddon(this.webgl);
      } catch {
        this.webgl = null; // DOM renderer fallback
      }
    }
    this.resizeObs = new ResizeObserver(() => this.queueFit());
    this.resizeObs.observe(host);
    this.fitNow();
    this.term.focus();
  }

  unmount() {
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.webgl?.dispose();
    this.webgl = null;
    this.el.remove();
  }

  private queueFit() {
    if (this.fitQueued) return;
    this.fitQueued = true;
    requestAnimationFrame(() => {
      this.fitQueued = false;
      this.fitNow();
    });
  }

  private fitNow() {
    if (!this.el.isConnected || this.el.clientWidth < 20) return;
    try {
      this.fit.fit();
    } catch {
      /* not measurable yet */
    }
  }

  /** Spawn (or resume) this napkin's `claude` process. Idempotent while starting. */
  start(): Promise<void> {
    if (this.starting) return this.starting;
    if (app.napkin(this.id)?.running) return Promise.resolve();
    this.starting = (async () => {
      app.setStatus(this.id, "starting");
      const ch = new Channel<ArrayBuffer>();
      ch.onmessage = (buf) => this.term.write(new Uint8Array(buf));
      try {
        this.fitNow();
        const r = await api.open(this.id, this.term.cols, this.term.rows, ch);
        this.gen = r.gen;
        app.setRunning(this.id, true);
        const l = app.ensureLive(this.id);
        if (l.status === "starting" || l.status === "resting") l.status = "ready";
      } catch (e) {
        app.setRunning(this.id, false);
        this.term.write(`\r\n\x1b[31m  couldn't start claude: ${String(e)}\x1b[0m\r\n`);
      } finally {
        this.starting = null;
      }
    })();
    return this.starting;
  }

  onExit(code: number | null) {
    app.setRunning(this.id, false);
    app.ensureLive(this.id).exitCode = code;
    this.term.write(`\r\n\x1b[90m  ── claude exited${code ? ` (code ${code})` : ""} · this napkin is resting ──\x1b[0m\r\n`);
  }

  dispose() {
    this.unmount();
    this.term.dispose();
  }
}

const terms = new Map<string, NapkinTerm>();

// live-apply the "terminal ink size" setting
$effect.root(() => {
  $effect(() => {
    const size = settings.fontSize;
    for (const t of terms.values()) {
      if (t.term.options.fontSize !== size) t.term.options.fontSize = size;
    }
  });
});

export function getTerm(id: string): NapkinTerm {
  let t = terms.get(id);
  if (!t) {
    t = new NapkinTerm(id);
    terms.set(id, t);
  }
  return t;
}

export function peekTerm(id: string): NapkinTerm | undefined {
  return terms.get(id);
}

export function disposeTerm(id: string) {
  terms.get(id)?.dispose();
  terms.delete(id);
}

listen<{ id: string; gen: number; code: number | null }>("pty-exit", ({ payload }) => {
  const t = terms.get(payload.id);
  if (t && t.gen === payload.gen) t.onExit(payload.code);
});
