<script lang="ts">
  import { app } from "../lib/state.svelte";
  import { sketch } from "../lib/rough";
  import { agoShort, basename, STATUS_LABEL } from "../lib/format";
  import Critter from "./Critter.svelte";
  import TheTab from "./TheTab.svelte";

  let showCrumpled = $state(false);

  // napkins stay where you laid them down: group by project, oldest first
  const groups = $derived.by(() => {
    const byProject = new Map<string, typeof app.onTable>();
    for (const n of [...app.onTable].sort((a, b) => a.created_at - b.created_at)) {
      const list = byProject.get(n.project) ?? [];
      list.push(n);
      byProject.set(n.project, list);
    }
    return [...byProject.entries()].map(([path, items]) => ({ path, name: basename(path), items }));
  });

  const CLAY = { stroke: "#e0764e", fill: "#f7d7c7", double: true, radius: 6, width: 1.6 };
  const KEY = { stroke: "#5f5a52", radius: 3, width: 1.1, pad: 3, roughness: 0.8 };
</script>

<div class="traffic drag"></div>
<aside class="sidebar paper" data-fx="sidebar">
  <div class="binding" aria-hidden="true"></div>

  <button class="brand" onclick={() => app.home()} title="back to the desk">
    <span class="word ink-bleed">napkin</span>
    <Critter size={40} mood="ready" />
  </button>

  <div class="new-row">
    <button class="btn" use:sketch={CLAY} onclick={() => app.newNapkin()}><span>+ new napkin</span></button>
    <span class="kbd" use:sketch={KEY}>⌘N</span>
  </div>

  <div class="scroll">
    <h3 class="section"><span class="underlined">open napkins</span></h3>
    {#if groups.length === 0}
      <p class="empty muted">the table is clear.</p>
    {/if}
    {#each groups as g (g.path)}
      <div class="group">— {g.name}</div>
      {#each g.items as n (n.id)}
        {@const s = app.live[n.id]?.status ?? "resting"}
        {@const idx = app.onTable.indexOf(n)}
        <button class="nk" class:active={app.activeId === n.id} onclick={() => app.open(n.id)} title={n.project}>
          <span class="nk-critter"><Critter size={30} mood={s} /></span>
          <span class="nk-text">
            <span class="nk-title">{n.title}</span>
            <span class="nk-status status-{s}">{STATUS_LABEL[s]}</span>
          </span>
          {#if idx < 9}<span class="hint kbd">⌘{idx + 1}</span>{/if}
        </button>
      {/each}
    {/each}

    <div class="squiggle divider"></div>

    <h3 class="section"><span class="underlined">projects</span></h3>
    {#each app.projects.slice(0, 12) as p (p.path)}
      <button
        class="proj"
        class:gone={!p.exists}
        disabled={!p.exists}
        onclick={() => app.newNapkin(p.path)}
        title={p.exists ? `new napkin in ${p.path}` : `${p.path} no longer exists`}
      >
        <span class="chev">›</span>
        <svg class="folder" viewBox="0 0 26 20" width="21" height="16" aria-hidden="true">
          <path d="M2 4.5 L2.4 17.6 L22.8 17.2 L23.4 6.8 L12 7 L10.2 3.6 L2.6 3.8 Z M2.4 8.6 L23 8.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" />
        </svg>
        <span class="proj-name">{p.name}</span>
        <span class="proj-meta">{p.sessions} · {agoShort(p.last_active, app.now)}</span>
      </button>
    {/each}
    {#if app.projects.length === 0}
      <p class="empty muted">no Claude Code history yet.</p>
    {/if}

    {#if app.crumpled.length}
      <button class="crumpled-toggle" onclick={() => (showCrumpled = !showCrumpled)}>
        {showCrumpled ? "▾" : "▸"} crumpled ({app.crumpled.length})
      </button>
      {#if showCrumpled}
        {#each app.crumpled.slice(0, 20) as n (n.id)}
          <div class="crumpled-row">
            <button class="c-title" onclick={() => app.open(n.id)} title="smooth it out again">{n.title}</button>
            <button class="c-x" onclick={() => app.forget(n.id)} title="forget for good">×</button>
          </div>
        {/each}
      {/if}
    {/if}
  </div>

  <footer>
    <TheTab />
  </footer>
</aside>

<style>
  /* Composition: docs/DESIGN.md §4 — a ruled pad strip lying on the desk */
  .traffic {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 30px;
    z-index: 3;
  }
  .sidebar {
    --paper-bg: var(--pad);
    --line: 37.6px;
    position: absolute;
    top: 44px;
    left: 14px;
    bottom: 16px;
    width: 277px;
    display: flex;
    flex-direction: column;
    padding: 38px 20px 16px 20px;
    z-index: 2;
  }
  /* ruled lines, on the paper layer so content sits on top */
  .sidebar::after {
    background-image: repeating-linear-gradient(to bottom, transparent 0 calc(var(--line) - 1px), var(--rule) calc(var(--line) - 1px) var(--line)),
      var(--grain);
    background-position: 0 14px, 0 0;
  }
  /* the pink binding left behind when the sheet was torn off the pad */
  .binding {
    position: absolute;
    top: -3px;
    left: 0;
    right: 0;
    height: 9px;
    background: linear-gradient(to bottom, rgba(214, 140, 120, 0.55), rgba(226, 170, 150, 0.35));
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='90' height='9' viewBox='0 0 90 9' preserveAspectRatio='none'%3E%3Cpath d='M0 0 H90 V5 L87 7.5 L84 5.5 L80 8 L77 6 L73 7.8 L70 5.2 L66 7.6 L62 5.8 L59 8.2 L55 5.6 L52 7.4 L48 5 L45 7.9 L41 6 L38 8 L34 5.4 L31 7.7 L27 5.9 L24 8.3 L20 5.5 L17 7.2 L13 5.2 L10 7.9 L6 6 L3 7.6 L0 5.5 Z'/%3E%3C/svg%3E")
      0 0 / 90px 9px repeat-x;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='90' height='9' viewBox='0 0 90 9' preserveAspectRatio='none'%3E%3Cpath d='M0 0 H90 V5 L87 7.5 L84 5.5 L80 8 L77 6 L73 7.8 L70 5.2 L66 7.6 L62 5.8 L59 8.2 L55 5.6 L52 7.4 L48 5 L45 7.9 L41 6 L38 8 L34 5.4 L31 7.7 L27 5.9 L24 8.3 L20 5.5 L17 7.2 L13 5.2 L10 7.9 L6 6 L3 7.6 L0 5.5 Z'/%3E%3C/svg%3E")
      0 0 / 90px 9px repeat-x;
    filter: url(#fibers);
    pointer-events: none;
  }
  .brand {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    margin: 0 0 18px 2px;
  }
  .word {
    font-family: var(--marker);
    font-size: 40px;
    line-height: 0.95;
    padding: 0 4px 5px 0;
    background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 10' preserveAspectRatio='none'%3E%3Cpath d='M1 6 C 30 5, 70 4.6, 118 5.2 M3 8.4 C 40 7.4, 80 7.6, 116 7' stroke='%2335322e' stroke-width='1.6' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")
      left bottom / 100% 10px no-repeat;
  }
  .new-row {
    display: flex;
    align-items: center;
    gap: 16px;
    margin: 0 0 26px 4px;
  }
  .new-row .btn {
    font-size: 17px;
    padding: 8px 22px 10px;
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    margin: 0 -8px;
    padding: 0 8px 8px;
  }
  .section {
    font-family: var(--hand);
    font-weight: 400;
    font-size: 16px;
    color: var(--ink-2);
    margin: 0 0 6px 4px;
  }
  .empty {
    font-size: 14px;
    margin: 4px 0 10px 12px;
  }
  .group {
    font-size: 13.5px;
    color: var(--ink-2);
    margin: 10px 0 2px 6px;
  }
  .nk {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    text-align: left;
    padding: 3px 6px 5px 4px;
    border-radius: 4px;
  }
  .nk:hover {
    background: rgba(224, 118, 78, 0.07);
  }
  .nk.active {
    background: rgba(224, 118, 78, 0.12);
  }
  .nk-critter {
    width: 34px;
    display: flex;
    justify-content: center;
    padding-top: 6px;
    align-self: flex-start;
  }
  .nk-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .nk-title {
    font-size: 17.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .nk-status {
    font-size: 13px;
    margin-top: -1px;
  }
  .hint {
    opacity: 0;
    transition: opacity 0.1s;
  }
  .nk:hover .hint {
    opacity: 1;
  }
  .divider {
    margin: 22px 28px 16px 36px;
  }
  .proj {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    height: 37.6px;
    padding: 0 2px 0 6px;
    text-align: left;
    color: var(--ink);
  }
  .proj:hover .proj-name {
    color: var(--clay-deep);
  }
  .proj.gone .proj-name {
    text-decoration: line-through;
    text-decoration-thickness: 1.4px;
  }
  .chev {
    color: var(--ink-2);
    width: 8px;
  }
  .folder {
    color: var(--ink-2);
    flex: none;
  }
  .proj-name {
    flex: 1;
    font-size: 17.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .proj-meta {
    font-size: 12px;
    color: var(--ink-2);
    white-space: nowrap;
  }
  .crumpled-toggle {
    margin: 10px 0 2px 6px;
    font-size: 14px;
    color: var(--ink-2);
  }
  .crumpled-row {
    display: flex;
    gap: 6px;
    padding-left: 18px;
  }
  .c-title {
    flex: 1;
    text-align: left;
    font-size: 13.5px;
    color: var(--ink-3);
    text-decoration: line-through;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .c-title:hover {
    color: var(--ink);
    text-decoration: none;
  }
  .c-x {
    color: var(--ink-3);
  }
  .c-x:hover {
    color: var(--red-ink);
  }
  footer {
    flex: none;
    padding-top: 6px;
  }
</style>
