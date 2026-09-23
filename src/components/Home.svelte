<script lang="ts">
  import { app } from "../lib/state.svelte";
  import { ago, basename, greeting, STATUS_LABEL, tildify } from "../lib/format";
  import Critter from "./Critter.svelte";
  import headline from "../assets/ref/headline.png";
  import check from "../assets/ref/check.png";
  import folder from "../assets/ref/folder.png";
  import ring from "../assets/ref/coffee-ring.png";

  const last = $derived(app.onTable[0] ?? app.crumpled[0]);
  const home = $derived(app.info?.home);
  const recent = $derived([...app.projects].filter((p) => p.exists).sort((a, b) => b.last_active - a.last_active).slice(0, 6));
  const cards = $derived([...app.onTable].sort((a, b) => a.created_at - b.created_at).slice(0, 4));

</script>

<div class="desk">
  <div class="drag strip"></div>

  <section class="hero sheet-hero" data-fx="hero">
    <div class="mascot"><Critter size={118} mood="hero" /></div>
    <div class="copy">
      <p class="hello">{greeting(new Date(app.now))}</p>
      <h1><img class="headline" src={headline} alt="what are we making?" data-fx="title" /></h1>
      <p class="sub">start a fresh napkin in any folder, or pick up where you left off.</p>

      <div class="actions">
        <div class="action">
          <button class="btn big clay" onclick={() => app.newNapkin()} data-fx="primary">
            <span>new napkin in…</span>
            <span class="kbd">⌘N</span>
          </button>
          <span class="caption">choose a folder</span>
        </div>
        <div class="action">
          <button class="btn big" disabled={!last} onclick={() => last && app.open(last.id)}>
            <span>resume last</span>
          </button>
          <span class="caption">
            {#if last}{basename(last.project)} · {ago(last.updated_at, app.now)}{:else}nothing yet{/if}
          </span>
        </div>
      </div>

      <p class="claude type">
        {#if !app.info}
          <span class="muted">looking for Claude Code…</span>
        {:else if app.info.claude}
          <img class="check" src={check} alt="✓" /><span class="green">Claude Code {app.info.claude_version ?? ""}</span>
          at {tildify(app.info.claude, home)}
          {#if !app.info.git}<span class="red"> · no git, so no erasing</span>{/if}
        {:else}
          <span class="red">✗ couldn't find claude on your PATH</span>
          <span class="muted"> — curl -fsSL https://claude.ai/install.sh | bash</span>
        {/if}
      </p>
    </div>

    <div class="zigzag rule"></div>
    <p class="tips">
      <b>tip:</b>
      <span><span class="kbd">⌘K</span> to jump anywhere</span>
      <span><span class="kbd">⌘N</span> new napkin</span>
      <span><span class="kbd">⌘O</span> open a folder</span>
      <span><span class="kbd">⌘,</span> settings</span>
    </p>
  </section>

  <div class="lower">
    <section class="recent paper" data-fx="recent">
      <h2>recent projects</h2>
      {#each recent as p (p.path)}
        <div class="row" class:gone={!p.exists}>
          <div class="line">
            <img class="folder" src={folder} alt="" />
            <span class="name">{p.name}</span>
            <span class="when">{ago(p.last_active, app.now)}</span>
          </div>
          <div class="line">
            <span class="path" title={p.last_prompt ?? ""}>{tildify(p.path, home)}</span>
            <span class="links">
              {#if p.exists}
                <button class="link" onclick={() => app.newNapkin(p.path)}>new napkin</button>
                <button class="link" onclick={() => app.continueProject(p)} title={p.last_prompt ? `“${p.last_prompt}”` : ""}>continue</button>
              {:else}
                <span class="muted">folder moved</span>
              {/if}
            </span>
          </div>
        </div>
      {:else}
        <p class="empty muted">once you've used Claude Code somewhere, it shows up here.</p>
      {/each}
    </section>

    <section class="table">
      <h2 class="underlined heading">on the table</h2>
      <div class="cards">
        {#each cards as n, i (n.id)}
          {@const s = app.live[n.id]?.status ?? "resting"}
          <button class="card sheet-card" class:low={i % 2 === 1} onclick={() => app.open(n.id)} data-fx="card">
            <Critter size={40} mood={s} />
            <span class="card-text">
              <span class="card-title">{n.title}</span>
              <span class="card-meta">{basename(n.project)} · <span class="status-{s}">{STATUS_LABEL[s]}</span></span>
            </span>
          </button>
        {:else}
          <p class="muted empty">nothing here. that's a clean table.</p>
        {/each}
      </div>
      <img class="coffee" src={ring} alt="" />
    </section>
  </div>
</div>

<style>
  /* Composition follows docs/DESIGN.md §4 (reference px ÷ 1.25 → pt at 1600×1000) */
  .desk {
    position: relative;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0 5.5vw 40px 5.7vw;
  }
  .strip {
    height: 30px;
    position: sticky;
    top: 0;
    z-index: 3;
  }
  .hero {
    margin-top: calc(6.4vh - 30px);
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 30px;
    padding: 26px 26px 16px 41px;
  }
  .mascot {
    padding-top: 34px;
  }
  .hello {
    margin: 0;
    font-size: 17.5px;
    color: var(--ink-2);
  }
  h1 {
    margin: 6px 0 10px;
    line-height: 0;
  }
  /* the reference's own marker lettering (ink pooling at the stroke ends) */
  .headline {
    width: clamp(300px, 32.5vw, 640px);
    height: auto;
  }
  .sub {
    font-size: 19px;
    margin: 0 0 22px;
  }
  .actions {
    display: flex;
    gap: 44px;
    flex-wrap: wrap;
  }
  .action {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .btn.big {
    font-size: 21px;
    min-height: 50px;
    padding: 0 18px 1px;
  }
  .btn .kbd {
    font-size: 10px;
    margin-left: 4px;
  }
  .caption {
    font-size: 14.5px;
    color: var(--ink-2);
    padding-left: 10px;
  }
  .claude {
    margin: 24px 0 0;
    font-size: 16px;
    color: var(--ink);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .check {
    width: 20px;
    height: 20px;
    margin: -4px 2px 0 -4px;
  }
  .rule {
    grid-column: 1 / -1;
    margin: 26px 12px 12px -4px;
  }
  .tips {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 30px;
    align-items: center;
    font-size: 14.5px;
    color: var(--ink-2);
    margin: 0 0 0 -10px;
  }
  .tips > span {
    display: inline-flex;
    gap: 9px;
    align-items: center;
  }
  .tips b {
    color: var(--ink);
  }

  .lower {
    display: grid;
    grid-template-columns: 49% 1fr;
    column-gap: 5.3%;
    margin-top: 44px;
    position: relative;
  }

  /* notebook paper: red header rule, blue lines under every line of text */
  .recent {
    --paper-bg: var(--notebook);
    --tex: var(--tex-notebook);
    padding: 24px 0 18px;
    align-self: start;
  }
  .recent h2 {
    font-family: var(--hand);
    font-weight: 700;
    font-size: 24px;
    padding: 0 27px 8px;
    border-bottom: 1.4px solid var(--margin-red);
  }
  .row .line {
    display: flex;
    align-items: baseline;
    height: 33px;
    padding: 0 27px 0 27px;
    border-bottom: 1px solid var(--rule-blue);
    gap: 12px;
  }
  .row .line:first-child {
    align-items: center;
  }
  .folder {
    flex: none;
    width: 26px;
    height: 19px;
    align-self: center;
  }
  .name {
    font-size: 19px;
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .when,
  .links {
    width: 168px;
    flex: none;
    font-size: 13.5px;
    color: var(--ink-2);
  }
  .links {
    display: flex;
    gap: 14px;
  }
  .path {
    flex: 1;
    min-width: 0;
    padding-left: 35px;
    font-size: 14px;
    color: var(--ink-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row.gone .name {
    text-decoration: line-through;
    color: var(--ink-3);
  }
  .empty {
    padding: 8px 27px;
    font-size: 15px;
  }

  .table {
    position: relative;
    padding-top: 2px;
  }
  .table h2 {
    font-family: var(--hand);
    font-weight: 700;
    font-size: 21px;
    margin-bottom: 26px;
  }
  .cards {
    display: flex;
    flex-wrap: nowrap;
    gap: 26px 29px;
    position: relative;
    z-index: 1;
  }
  .card {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    width: min(242px, 47%);
    flex: none;
    min-height: 118px;
    padding: 16px 6px 8px 8px;
    text-align: left;
  }
  .card.low {
    margin-top: 15px;
  }
  .card:hover {
    transform: translateY(-2px);
  }
  .card-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .card-title {
    font-size: 19px;
    line-height: 1.25;
  }
  .card-meta {
    font-size: 13.5px;
    color: var(--ink-2);
  }
  /* the reference's coffee ring; its top is tucked under the second card, as in the reference */
  .coffee {
    position: absolute;
    width: 172px;
    height: 110px;
    left: 348px;
    top: 194px;
    pointer-events: none;
    z-index: 0;
  }
  @media (max-width: 1150px) {
    .lower {
      grid-template-columns: 1fr;
      row-gap: 36px;
    }
    .mascot {
      display: none;
    }
  }
</style>
