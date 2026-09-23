<script lang="ts">
  import { untrack } from "svelte";
  import { sketch, PEN } from "../lib/rough";
  import { app } from "../lib/state.svelte";
  import { getTerm } from "../lib/terminals.svelte";
  import { STATUS_LABEL, tildify } from "../lib/format";
  import Critter from "./Critter.svelte";
  import InkSpill from "./InkSpill.svelte";
  import Sketch from "./Sketch.svelte";

  let { id }: { id: string } = $props();

  const n = $derived(app.napkin(id));
  const live = $derived(app.live[id]);
  const status = $derived(live?.status ?? "resting");
  const tab = $derived(app.view.kind === "napkin" ? app.view.tab : "talk");

  let host = $state<HTMLDivElement>();
  let editing = $state(false);
  let draft = $state("");
  let showPanel = $state(true);

  $effect(() => {
    if (tab !== "talk" || !host) return;
    const t = getTerm(id);
    t.mount(host);
    untrack(() => {
      if (!app.napkin(id)?.running) t.start();
    });
    return () => t.unmount();
  });

  function setTab(t: "talk" | "sketch") {
    app.view = { kind: "napkin", id, tab: t };
  }

  function startEdit() {
    draft = n?.title ?? "";
    editing = true;
  }

  function commitEdit() {
    editing = false;
    if (draft.trim() && draft !== n?.title) app.rename(id, draft);
  }

  function focusSelect(el: HTMLInputElement) {
    el.focus();
    el.select();
  }
</script>

{#if n}
  <div class="view">
    <header class="bar drag">
      <div class="title-block">
        <Critter size={34} mood={status} />
        <div class="titles">
          {#if editing}
            <input
              class="title-input"
              bind:value={draft}
              use:focusSelect
              onblur={commitEdit}
              onkeydown={(e) => {
                if (e.key === "Enter") commitEdit();
                if (e.key === "Escape") editing = false;
              }}
            />
          {:else}
            <button class="title" ondblclick={startEdit} title="double-click to rename">{n.title}</button>
          {/if}
          <div class="meta">
            <span class="type path" title={n.project}>{tildify(n.project, app.info?.home)}</span>
            <span class="dot">·</span>
            <span class="status-{status}">{STATUS_LABEL[status]}</span>
            {#if status === "needs_you" && live?.lastMsg}<span class="msg red">— {live.lastMsg}</span>{/if}
          </div>
        </div>
      </div>

      <nav class="tabs">
        <button class:on={tab === "talk"} onclick={() => setTab("talk")}>talk</button>
        <button class:on={tab === "sketch"} onclick={() => setTab("sketch")}>sketch <span class="kbd" use:sketch={PEN.key}>⌘⇧S</span></button>
      </nav>

      <div class="actions">
        {#if !n.running && tab === "talk"}
          <button class="btn small" use:sketch={PEN.small} onclick={() => getTerm(id).start()}><span>pick it back up</span></button>
        {/if}
        <button class="btn small" use:sketch={PEN.small} onclick={() => (showPanel = !showPanel)} title="toggle the ink spill (⌘B)">
          <span>{showPanel ? "hide" : "show"} ink spill</span>
        </button>
        <button class="btn small danger" use:sketch={PEN.danger} onclick={() => (app.crumpling = id)} title="crumple this napkin (⌘W)"><span>crumple</span></button>
      </div>
    </header>

    <div class="body">
      <div class="sheet paper napkin-edge" class:sketching={tab === "sketch"}>
        {#if tab === "talk"}
          <div class="term" bind:this={host}></div>
          <div class="grain" aria-hidden="true"></div>
        {:else}
          <Sketch {id} project={n.project} />
        {/if}
      </div>
      {#if showPanel}
        <InkSpill {id} />
      {/if}
    </div>
  </div>
{/if}

<svelte:window
  onkeydown={(e) => {
    if (e.metaKey && e.key.toLowerCase() === "b") {
      e.preventDefault();
      showPanel = !showPanel;
    }
  }}
/>

<style>
  .view {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 30px 24px 12px 26px;
    flex: none;
  }
  .bar :global(button),
  .bar input,
  .bar .path {
    -webkit-app-region: no-drag;
  }
  .title-block {
    display: flex;
    gap: 12px;
    align-items: center;
    min-width: 0;
    flex: 1;
  }
  .titles {
    min-width: 0;
  }
  .title {
    font-family: var(--marker);
    font-size: 27px;
    line-height: 1.1;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .title-input {
    font-family: var(--marker);
    font-size: 26px;
    background: transparent;
    border: 0;
    border-bottom: 2px solid var(--clay);
    outline: none;
    width: min(420px, 100%);
  }
  .meta {
    display: flex;
    gap: 6px;
    font-size: 14px;
    align-items: baseline;
    white-space: nowrap;
    min-width: 0;
  }
  .path {
    font-size: 13px;
    color: var(--ink-3);
    overflow: hidden;
    text-overflow: ellipsis;
    user-select: text;
    -webkit-user-select: text;
  }
  .dot {
    color: var(--ink-4);
  }
  .msg {
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 13px;
  }
  .tabs {
    display: flex;
    gap: 4px;
    flex: none;
  }
  .tabs button {
    font-size: 17px;
    padding: 2px 12px 4px;
    color: var(--ink-3);
    border-radius: var(--sketch-radius-2);
  }
  .tabs button.on {
    color: var(--ink);
    font-weight: 700;
    background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 8' preserveAspectRatio='none'%3E%3Cpath d='M2 5 C 30 2, 60 7, 118 3' stroke='%23e0774b' stroke-width='2.4' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")
      bottom / 90% 7px no-repeat;
  }
  .tabs .kbd {
    font-size: 9px;
    opacity: 0.7;
  }
  .actions {
    display: flex;
    gap: 10px;
    flex: none;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 18px;
    padding: 4px 22px 22px 22px;
  }
  .sheet {
    flex: 1;
    min-width: 0;
    --paper-bg: var(--napkin);
    padding: 34px 26px 30px 38px;
    display: flex;
  }
  .sheet.sketching {
    padding: 0;
  }
  .term {
    flex: 1;
    min-width: 0;
    position: relative;
    z-index: 0;
  }
  /* paper grain over the terminal glyphs so the text looks printed, not pasted */
  .grain {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    background-image: var(--grain);
    mix-blend-mode: multiply;
    opacity: 0.7;
  }
</style>
