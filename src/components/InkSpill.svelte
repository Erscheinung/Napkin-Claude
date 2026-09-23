<script lang="ts">
  import { untrack } from "svelte";
  import { ask } from "@tauri-apps/plugin-dialog";
  import { api, type Changes } from "../lib/api";
  import { app, type Turn } from "../lib/state.svelte";
  import { ago, relTo } from "../lib/format";
  import DiffView from "./DiffView.svelte";

  let { id }: { id: string } = $props();

  const n = $derived(app.napkin(id));
  const live = $derived(app.live[id]);
  const busy = $derived(live?.status === "working");

  type Scope = { from?: string; to?: string; label: string; turn?: number };
  let scope = $state<Scope>({ label: "since laid down" });
  let changes = $state<Changes | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let openPath = $state<string | null>(null);
  let diffText = $state("");
  let diffLoading = $state(false);
  let acting = $state(false);

  const touchedRel = $derived(new Set((live?.touched ?? []).map((p) => relTo(p, n?.project ?? ""))));
  const totals = $derived(
    (changes?.files ?? []).reduce((a, f) => ({ add: a.add + (f.added ?? 0), del: a.del + (f.removed ?? 0) }), { add: 0, del: 0 }),
  );

  let seq = 0;
  async function refresh() {
    if (!n?.tracking) return;
    const mine = ++seq;
    loading = true;
    try {
      const c = await api.changes(id, scope.from, scope.to);
      if (mine !== seq) return;
      changes = c;
      error = null;
      if (app.fixtureExtra === "diff" && !openPath && c.files.length) toggle(c.files.find((f) => f.status === "M")?.path ?? c.files[0].path);
      if (openPath && c.files.some((f) => f.path === openPath)) loadDiff(openPath);
    } catch (e) {
      if (mine === seq) error = String(e);
    } finally {
      if (mine === seq) loading = false;
    }
  }

  // refresh when hooks report file activity, a turn ends, or the scope changes (debounced)
  $effect(() => {
    live?.rev;
    scope;
    const t = setTimeout(() => untrack(refresh), 300);
    return () => clearTimeout(t);
  });

  // Bash can change files without telling hooks, so poll gently while Claude works
  $effect(() => {
    if (!busy || scope.to) return;
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  });

  async function loadDiff(path: string) {
    if (!changes) return;
    diffLoading = true;
    try {
      diffText = await api.fileDiff(id, changes.from, changes.to, path);
    } catch (e) {
      diffText = String(e);
    } finally {
      diffLoading = false;
    }
  }

  function toggle(path: string) {
    if (openPath === path) {
      openPath = null;
      return;
    }
    openPath = path;
    diffText = "";
    loadDiff(path);
  }

  async function rollback(cp: string | undefined, label: string, paths?: string[]) {
    if (!cp || acting) return;
    acting = true;
    try {
      const r = await api.rollback(id, cp, paths, label);
      app.flash(`${label} · ${r.restored} put back, ${r.removed} tossed`, "ink", {
        label: "un-erase",
        run: () => rollback(r.safety, "un-erased"),
      });
      refresh();
    } catch (e) {
      app.flash(String(e), "red");
    } finally {
      acting = false;
    }
  }

  async function rollbackAll() {
    if (!n?.boundary) return;
    const ok = await ask(
      "Wipe the napkin clean? Every file goes back to how it was when this napkin was laid down.\n\nNapkin keeps a copy of the ink first, so you can un-erase this.",
      { title: "Wipe clean", kind: "warning", okLabel: "Wipe clean", cancelLabel: "Keep the ink" },
    );
    if (ok) rollback(n.boundary, "wiped clean");
  }

  async function rollbackTurn(t: Turn) {
    const later = (live?.turns.length ?? 0) - t.n;
    const ok = await ask(
      `Erase scribble ${t.n}${later ? ` and the ${later} after it` : ""}?\n\n“${t.prompt.slice(0, 120)}”\n\nOnly files are erased — Claude still remembers the conversation. You can un-erase this.`,
      { title: "Erase scribbles", kind: "warning", okLabel: "Erase", cancelLabel: "Keep the ink" },
    );
    if (ok) rollback(t.before, `erased back to before scribble ${t.n}`);
  }

  async function rebase() {
    try {
      const fresh = await api.rebase(id);
      const cur = app.napkin(id);
      if (cur) Object.assign(cur, { boundary: fresh.boundary, tracking: true, tracking_note: null });
      error = null;
      refresh();
    } catch (e) {
      app.flash(String(e), "red");
    }
  }

  async function checkpoint() {
    try {
      await api.checkpoint(id, `fold · ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
      app.flash("folded — you can always unfold back to here");
    } catch (e) {
      app.flash(String(e), "red");
    }
  }

  function scopeTurn(t: Turn) {
    if (scope.turn === t.n) {
      scope = { label: "since laid down" };
      return;
    }
    scope = { from: t.before, to: t.after, label: `scribble ${t.n}`, turn: t.n };
  }

  type Entry =
    | { kind: "turn"; at: number; turn: Turn }
    | { kind: "mark"; at: number; label: string; cp?: string; mk: string };
  const timeline = $derived.by(() => {
    const out: Entry[] = [];
    for (const t of live?.turns ?? []) out.push({ kind: "turn", at: t.at, turn: t });
    for (const m of live?.marks ?? []) if (m.kind !== "boundary") out.push({ kind: "mark", at: m.at, label: m.label, cp: m.cp, mk: m.kind });
    return out.sort((a, b) => b.at - a.at);
  });

  const glyph: Record<string, string> = { A: "+", M: "~", D: "−", T: "~" };
  const word: Record<string, string> = { A: "new", M: "edited", D: "gone", T: "retyped" };
  function split(p: string) {
    const i = p.lastIndexOf("/");
    return i < 0 ? ["", p] : [p.slice(0, i + 1), p.slice(i + 1)];
  }
</script>

<aside class="panel paper">
  <header>
    <h3 class="underlined" title="everything this napkin changed on disk">ink spill</h3>
    {#if n?.tracking}
      <button class="icon" class:spin={loading} onclick={refresh} title="refresh">↻</button>
    {/if}
  </header>

  {#if !n?.tracking}
    <p class="note">
      <span class="red">no ink tracking</span> — {n?.tracking_note ?? "no snapshots for this napkin"}.
    </p>
    {#if live?.touched.length}
      <p class="sub muted">files Claude inked:</p>
      <ul class="files">
        {#each live.touched as f (f)}
          <li class="file"><span class="g A">✎</span><span class="path"><b>{relTo(f, n?.project ?? "")}</b></span></li>
        {/each}
      </ul>
    {/if}
  {:else}
    <div class="summary">
      {#if changes}
        <span class="count">{changes.files.length} file{changes.files.length === 1 ? "" : "s"}</span>
        <span class="green">+{totals.add}</span>
        <span class="red">−{totals.del}</span>
      {:else if error && /bad object|unknown revision|not a valid object/i.test(error)}
        <span class="lost">
          this napkin's ink record went missing (its snapshots were cleared).
          <button class="link" onclick={rebase}>start a fresh record</button>
        </span>
      {:else if error}
        <span class="red small">{error}</span>
      {:else}
        <span class="muted">measuring…</span>
      {/if}
      <span class="scope" class:turn={scope.turn}>
        {scope.label}
        {#if scope.turn}<button class="x" onclick={() => (scope = { label: "since laid down" })} title="back to the whole napkin">×</button>{/if}
      </span>
    </div>

    <ul class="files">
      {#each changes?.files ?? [] as f (f.path)}
        {@const [dir, base] = split(f.path)}
        <li class="file" class:open={openPath === f.path}>
          <button class="row" onclick={() => toggle(f.path)} title="{word[f.status]} · click to see the ink">
            <span class="g {f.status}">{glyph[f.status]}</span>
            <span class="path"><span class="dir">{dir}</span><b>{base}</b></span>
            {#if touchedRel.has(f.path)}<span class="pen" title="Claude inked this directly">✎</span>{/if}
            <span class="nums">
              {#if f.added === null}<span class="muted">bin</span>
              {:else}
                {#if f.added}<span class="green">+{f.added}</span>{/if}
                {#if f.removed}<span class="red">−{f.removed}</span>{/if}
              {/if}
            </span>
          </button>
          <button
            class="revert"
            disabled={busy || acting}
            title={busy ? "wait for Claude to put the pen down" : `erase ${base} back to how it was (${scope.label})`}
            onclick={() => rollback(changes?.from, `erased ${base}`, [f.path])}>erase</button>
          {#if openPath === f.path}
            <DiffView text={diffText} loading={diffLoading && !diffText} />
          {/if}
        </li>
      {:else}
        {#if changes}<li class="clean muted">nothing changed yet — the napkin is clean.</li>{/if}
      {/each}
    </ul>
  {/if}

  <div class="squiggle sep"></div>

  <h3 class="underlined sm">scribbles</h3>
  <ol class="timeline">
    {#each timeline as e (e.kind + e.at)}
      {#if e.kind === "turn"}
        {@const t = e.turn}
        <li class="turn" class:sel={scope.turn === t.n}>
          <button class="t-main" onclick={() => n?.tracking && t.before && scopeTurn(t)} title="show what this scribble spilled">
            <span class="t-n">{t.n}</span>
            <span class="t-prompt">{t.prompt || "(empty prompt)"}</span>
          </button>
          <div class="t-meta muted">
            {ago(t.at, app.now)}{#if t.files.length} · ✎ {t.files.length}{/if}
            {#if !t.after && busy && t.n === live?.turns.length}<span class="status-working"> · scribbling…</span>{/if}
            {#if n?.tracking && t.before}
              <button class="link tiny" disabled={busy || acting} onclick={() => rollbackTurn(t)}>erase from here</button>
            {/if}
          </div>
          {#if t.err}<div class="red small">snapshot: {t.err}</div>{/if}
        </li>
      {:else}
        <li class="mark {e.mk}">
          <span class="m-dot">{e.mk === "checkpoint" ? "⌐" : "⌫"}</span>
          <span class="m-label">{e.label}</span>
          <span class="muted small">{ago(e.at, app.now)}</span>
          {#if e.cp && n?.tracking}
            <button class="link tiny" disabled={busy || acting} onclick={() => rollback(e.cp, `unfolded to “${e.label}”`)}>
              {e.mk === "rollback" ? "un-erase" : "unfold to here"}
            </button>
          {/if}
        </li>
      {/if}
    {:else}
      <li class="muted small empty">no scribbles yet. say something to Claude.</li>
    {/each}
    <li class="mark boundary">
      <span class="m-dot">◯</span>
      <span class="m-label">napkin laid down</span>
      <span class="muted small">{n ? ago(n.created_at, app.now) : ""}</span>
    </li>
  </ol>

  {#if n?.tracking}
    <footer>
      <button class="btn small" onclick={checkpoint} disabled={acting} title="fold the napkin here — a spot you can always come back to"><span>⌐ fold here</span></button>
      <button class="btn small danger" onclick={rollbackAll} disabled={busy || acting || !changes?.files.length}>
        <span>wipe clean</span>
      </button>
    </footer>
  {/if}
</aside>

<style>
  .panel {
    width: 340px;
    flex: none;
    display: flex;
    flex-direction: column;
    padding: 16px 18px 14px;
    overflow-y: auto;
    --paper-bg: #f6f2e8;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h3 {
    font-family: var(--hand);
    font-weight: 700;
    font-size: 19px;
  }
  h3.sm {
    font-size: 16px;
    margin-bottom: 6px;
  }
  .icon {
    font-size: 18px;
    color: var(--ink-2);
    width: 26px;
    height: 26px;
    border-radius: 50%;
  }
  .icon:hover {
    background: rgba(0, 0, 0, 0.05);
  }
  .spin {
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .note {
    font-size: 14px;
    margin: 10px 0;
  }
  .sub {
    font-size: 13.5px;
    margin: 6px 0 2px;
  }
  .summary {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 8px 0 8px;
    font-size: 15px;
    flex-wrap: wrap;
  }
  .count {
    font-weight: 700;
  }
  .lost {
    font-size: 13.5px;
    color: var(--ink-2);
  }
  .scope {
    margin-left: auto;
    font-size: 12.5px;
    color: var(--ink-3);
    border: 1px dashed var(--ink-4);
    padding: 0 7px;
    border-radius: 10px;
  }
  .scope.turn {
    color: var(--clay-deep);
    border-color: var(--clay);
    border-style: solid;
  }
  .x {
    margin-left: 2px;
    color: inherit;
  }
  .files {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .file {
    position: relative;
    border-bottom: 1px solid rgba(90, 80, 65, 0.08);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 4px 2px;
    text-align: left;
    font-size: 13.5px;
  }
  .row:hover {
    background: rgba(233, 138, 95, 0.08);
  }
  .g {
    width: 14px;
    text-align: center;
    font-family: var(--mono);
    font-weight: 700;
    flex: none;
  }
  .g.A {
    color: var(--green-ink);
  }
  .g.M,
  .g.T {
    color: var(--clay-deep);
  }
  .g.D {
    color: var(--red-ink);
  }
  .path {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .path b {
    font-weight: 700;
  }
  .dir {
    color: var(--ink-3);
  }
  .pen {
    color: var(--clay-deep);
    font-size: 12px;
  }
  .nums {
    font-family: var(--mono);
    font-size: 11px;
    display: flex;
    gap: 5px;
    flex: none;
  }
  .revert {
    position: absolute;
    right: 0;
    top: 3px;
    font-size: 12px;
    padding: 1px 7px;
    border-radius: 8px;
    background: var(--napkin);
    border: 1px solid var(--ink-4);
    opacity: 0;
    transition: opacity 0.1s;
  }
  .file:hover .revert {
    opacity: 1;
  }
  .revert:hover {
    border-color: var(--red-ink);
    color: var(--red-ink);
  }
  .revert:disabled {
    display: none;
  }
  .clean {
    font-size: 14px;
    padding: 6px 2px;
  }
  .sep {
    margin: 16px 0 12px;
    flex: none;
  }
  .timeline {
    list-style: none;
    margin: 0;
    padding: 0 0 0 4px;
    flex: 1;
    border-left: 1.5px dashed var(--ink-4);
  }
  .turn,
  .mark {
    position: relative;
    padding: 4px 0 6px 12px;
  }
  .turn::before {
    content: "";
    position: absolute;
    left: -6px;
    top: 10px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 1.5px solid var(--ink-2);
    background: var(--paper);
  }
  .turn.sel::before {
    background: var(--clay);
    border-color: var(--clay-deep);
  }
  .t-main {
    display: flex;
    gap: 8px;
    text-align: left;
    width: 100%;
  }
  .t-n {
    font-weight: 700;
    color: var(--ink-2);
    flex: none;
  }
  .t-prompt {
    font-size: 14px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .t-main:hover .t-prompt {
    color: var(--clay-deep);
  }
  .t-meta {
    font-size: 12.5px;
    display: flex;
    gap: 6px;
    align-items: baseline;
    padding-left: 18px;
    flex-wrap: wrap;
  }
  .link.tiny {
    font-size: 12.5px;
    margin-left: auto;
  }
  .link:disabled {
    opacity: 0.4;
    pointer-events: none;
  }
  .mark {
    display: flex;
    gap: 6px;
    align-items: baseline;
    font-size: 13.5px;
  }
  .m-dot {
    position: absolute;
    left: -9px;
    font-size: 11px;
    background: var(--paper);
  }
  .m-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mark.boundary {
    color: var(--ink-3);
  }
  .small {
    font-size: 12.5px;
  }
  .empty {
    padding-left: 12px;
  }
  footer {
    display: flex;
    gap: 10px;
    padding-top: 14px;
    flex: none;
    justify-content: space-between;
  }
</style>
