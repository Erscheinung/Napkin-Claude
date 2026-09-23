<script lang="ts">
  // Toast, crumple dialog and ⌘K palette — everything that floats above the desk.
  import { api, type Changes } from "../lib/api";
  import { app } from "../lib/state.svelte";
  import { ago, basename, tildify } from "../lib/format";
  import Critter from "./Critter.svelte";

  // ── crumple ──────────────────────────────────────────────────────────────
  const crumpleN = $derived(app.napkin(app.crumpling));
  let crumpleChanges = $state<Changes | null>(null);
  let crumpleErr = $state<string | null>(null);
  let crumpleBusy = $state(false);

  $effect(() => {
    const n = crumpleN;
    crumpleChanges = null;
    crumpleErr = null;
    if (!n?.tracking) return;
    api.changes(n.id).then(
      (c) => (crumpleChanges = c),
      (e) => (crumpleErr = String(e)),
    );
  });

  async function doCrumple(rollback: boolean) {
    if (!crumpleN) return;
    crumpleBusy = true;
    await app.crumple(crumpleN.id, rollback);
    crumpleBusy = false;
    app.crumpling = null;
  }

  // ── palette ──────────────────────────────────────────────────────────────
  let query = $state("");
  let sel = $state(0);

  type Item = { label: string; hint: string; run: () => void; kind: string };
  const items = $derived.by(() => {
    const all: Item[] = [
      { kind: "do", label: "new napkin in…", hint: "⌘N", run: () => app.newNapkin() },
      { kind: "do", label: "back to the desk", hint: "home", run: () => app.home() },
      ...app.onTable.map((n) => ({
        kind: "napkin",
        label: n.title,
        hint: `${basename(n.project)} · ${app.live[n.id]?.status ?? "resting"}`,
        run: () => app.open(n.id),
      })),
      ...app.onTable.map((n) => ({
        kind: "sketch",
        label: `sketch on “${n.title}”`,
        hint: basename(n.project),
        run: () => app.open(n.id, "sketch"),
      })),
      ...app.projects
        .filter((p) => p.exists)
        .map((p) => ({ kind: "project", label: `new napkin in ${p.name}`, hint: tildify(p.path, app.info?.home), run: () => app.newNapkin(p.path) })),
      ...app.projects
        .filter((p) => p.exists && p.last_session)
        .map((p) => ({ kind: "project", label: `continue ${p.name}`, hint: p.last_prompt ?? ago(p.last_active), run: () => app.continueProject(p) })),
      ...app.crumpled.map((n) => ({ kind: "crumpled", label: `smooth out “${n.title}”`, hint: "crumpled", run: () => app.open(n.id) })),
    ];
    const q = query.trim().toLowerCase();
    if (!q) return all.filter((i) => i.kind !== "sketch" && i.kind !== "crumpled").slice(0, 40);
    return all
      .map((i) => ({ i, s: score(i.label.toLowerCase() + " " + i.hint.toLowerCase(), q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.i);
  });

  function score(hay: string, q: string): number {
    const at = hay.indexOf(q);
    if (at >= 0) return 100 - at;
    let hi = 0;
    for (const ch of q) {
      hi = hay.indexOf(ch, hi);
      if (hi < 0) return 0;
      hi++;
    }
    return 1;
  }

  $effect(() => {
    query;
    sel = 0;
  });

  function run(i: Item | undefined) {
    if (!i) return;
    app.paletteOpen = false;
    query = "";
    i.run();
  }

  function paletteKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      sel = Math.min(sel + 1, items.length - 1);
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      sel = Math.max(sel - 1, 0);
      e.preventDefault();
    } else if (e.key === "Enter") {
      run(items[sel]);
    } else if (e.key === "Escape") {
      app.paletteOpen = false;
    }
  }

  function autofocus(el: HTMLElement) {
    el.focus();
  }
</script>

{#if app.toast}
  <div class="toast paper" class:red={app.toast.tone === "red"}>
    <span>{app.toast.text}</span>
    {#if app.toast.action}
      {@const a = app.toast.action}
      <button class="link" onclick={() => { app.toast = null; a.run(); }}>{a.label}</button>
    {/if}
  </div>
{/if}

{#if crumpleN}
  <div class="scrim" role="presentation" onclick={() => !crumpleBusy && (app.crumpling = null)}>
    <div class="dialog sheet-card" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === "Escape" && (app.crumpling = null)}>
      <div class="d-head">
        <Critter size={52} mood="needs_you" />
        <div>
          <h2>crumple “{crumpleN.title}”?</h2>
          <p class="muted">the session stops and the napkin leaves the table. you can smooth it out later.</p>
        </div>
      </div>
      {#if crumpleN.tracking}
        {#if crumpleChanges}
          {@const f = crumpleChanges.files}
          <p class="d-sum">
            {#if f.length}
              this napkin spilled ink on <b>{f.length} file{f.length === 1 ? "" : "s"}</b>
              <span class="green">+{f.reduce((a, x) => a + (x.added ?? 0), 0)}</span>
              <span class="red">−{f.reduce((a, x) => a + (x.removed ?? 0), 0)}</span>
            {:else}
              no files changed — nothing to clean up.
            {/if}
          </p>
          {#if f.length}
            <ul class="d-files mono">
              {#each f.slice(0, 8) as x (x.path)}<li><span class="st-{x.status}">{x.status}</span> {x.path}</li>{/each}
              {#if f.length > 8}<li class="muted">…and {f.length - 8} more</li>{/if}
            </ul>
          {/if}
        {:else if crumpleErr}
          <p class="red">{crumpleErr}</p>
        {:else}
          <p class="muted">counting the ink…</p>
        {/if}
      {:else}
        <p class="muted">ink tracking was off for this napkin, so there's nothing to wipe.</p>
      {/if}
      <div class="d-actions">
        <button class="btn" onclick={() => (app.crumpling = null)} disabled={crumpleBusy}><span>never mind</span></button>
        <span class="spacer"></span>
        {#if crumpleChanges?.files.length}
          <button class="btn danger" onclick={() => doCrumple(true)} disabled={crumpleBusy}><span>wipe clean & crumple</span></button>
        {/if}
        <button class="btn clay" onclick={() => doCrumple(false)} disabled={crumpleBusy} use:autofocus>
          <span>{crumpleChanges?.files.length ? "keep the ink & crumple" : "crumple"}</span>
        </button>
      </div>
    </div>
  </div>
{/if}

{#if app.paletteOpen}
  <div class="scrim top" role="presentation" onclick={() => (app.paletteOpen = false)}>
    <div class="palette sheet-card" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
      <input class="p-input" placeholder="jump to a napkin, project, or action…" bind:value={query} onkeydown={paletteKey} use:autofocus />
      <ul class="p-list">
        {#each items as it, i (it.kind + it.label + i)}
          <li>
            <button class="p-item" class:sel={i === sel} onmouseenter={() => (sel = i)} onclick={() => run(it)}>
              <span class="p-kind">{{ do: "→", napkin: "▭", sketch: "✎", project: "▸", crumpled: "~" }[it.kind]}</span>
              <span class="p-label">{it.label}</span>
              <span class="p-hint muted">{it.hint}</span>
            </button>
          </li>
        {:else}
          <li class="muted p-empty">nothing on the napkin matches.</li>
        {/each}
      </ul>
    </div>
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    bottom: 22px;
    left: 50%;
    transform: translateX(-50%) rotate(-0.6deg);
    padding: 10px 20px;
    z-index: 50;
    font-size: 15px;
    display: flex;
    gap: 14px;
    align-items: baseline;
    max-width: 70vw;
    border-left: 4px solid var(--clay);
  }
  .toast.red {
    border-left-color: var(--red-ink);
    color: var(--red-ink);
  }
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(60, 50, 35, 0.22);
    display: grid;
    place-items: center;
    z-index: 40;
  }
  .scrim.top {
    place-items: start center;
    padding-top: 12vh;
  }
  .dialog {
    width: min(560px, 90vw);
    padding: 30px 34px 26px;
    transform: rotate(-0.4deg);
  }
  .d-head {
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }
  h2 {
    font-size: 26px;
    line-height: 1.1;
  }
  .d-head p {
    margin: 6px 0 0;
    font-size: 14.5px;
  }
  .d-sum {
    font-size: 16px;
    margin: 18px 0 6px;
  }
  .d-files {
    list-style: none;
    padding: 8px 12px;
    margin: 0;
    font-size: 12px;
    background: rgba(255, 255, 255, 0.5);
    border: 1px solid rgba(90, 80, 65, 0.12);
    max-height: 170px;
    overflow: auto;
  }
  .st-A {
    color: var(--green-ink);
  }
  .st-D {
    color: var(--red-ink);
  }
  .st-M,
  .st-T {
    color: var(--clay-deep);
  }
  .d-actions {
    display: flex;
    gap: 12px;
    margin-top: 22px;
    align-items: center;
  }
  .spacer {
    flex: 1;
  }
  .palette {
    width: min(620px, 90vw);
    padding: 14px 10px 10px;
  }
  .p-input {
    width: 100%;
    font-size: 20px;
    border: 0;
    border-bottom: 2px solid var(--ink);
    background: transparent;
    outline: none;
    padding: 4px 12px 8px;
    margin-bottom: 8px;
  }
  .p-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 52vh;
    overflow-y: auto;
  }
  .p-item {
    display: flex;
    gap: 12px;
    width: 100%;
    padding: 6px 12px;
    align-items: baseline;
    text-align: left;
    border-radius: 6px;
  }
  .p-item.sel {
    background: var(--clay-fill);
  }
  .p-kind {
    width: 14px;
    color: var(--clay-deep);
  }
  .p-label {
    font-size: 16px;
    flex: none;
    max-width: 60%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .p-hint {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    text-align: right;
  }
  .p-empty {
    padding: 10px 14px;
  }
</style>
