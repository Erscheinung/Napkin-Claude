<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { ask } from "@tauri-apps/plugin-dialog";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { app } from "./lib/state.svelte";
  import { api } from "./lib/api";
  import { peekTerm } from "./lib/terminals.svelte";
  import { shellQuote } from "./lib/format";
  import Sidebar from "./components/Sidebar.svelte";
  import Home from "./components/Home.svelte";
  import NapkinView from "./components/NapkinView.svelte";
  import Overlays from "./components/Overlays.svelte";

  let dropping = $state(false);

  onMount(() => {
    app.init().then(() => {
      if (app.fixture) reportFixture();
    });
    const unlisten: Array<Promise<() => void>> = [];

    unlisten.push(
      getCurrentWebview().onDragDropEvent(async (e) => {
        const p = e.payload;
        if (p.type === "enter" || p.type === "over") dropping = true;
        else if (p.type === "leave") dropping = false;
        else if (p.type === "drop") {
          dropping = false;
          const paths = p.paths;
          if (!paths.length) return;
          const v = app.view;
          if (v.kind === "napkin" && v.tab === "talk" && app.napkin(v.id)?.running) {
            // same as dropping onto Terminal.app: quoted paths at the cursor
            peekTerm(v.id)?.paste(paths.map(shellQuote).join(" ") + " ");
          } else if (v.kind === "home") {
            app.newNapkin(paths[0]);
          }
        }
      }),
    );

    unlisten.push(
      getCurrentWindow().onCloseRequested(async (e) => {
        const busy = app.onTable.filter((n) => app.live[n.id]?.status === "working");
        if (!busy.length) return;
        e.preventDefault();
        const ok = await ask(
          `${busy.length} napkin${busy.length > 1 ? "s are" : " is"} still scribbling. Close anyway? (Sessions can be picked back up later.)`,
          { title: "Close Napkin", kind: "warning", okLabel: "Close", cancelLabel: "Stay" },
        );
        if (ok) getCurrentWindow().destroy();
      }),
    );

    return () => unlisten.forEach((u) => u.then((f) => f()));
  });

  function onKey(e: KeyboardEvent) {
    if (!e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const v = app.view;
    let handled = true;
    if (k === "n" || k === "o") app.newNapkin();
    else if (k === "k" || k === "p") app.paletteOpen = !app.paletteOpen;
    else if (k === ",") window.dispatchEvent(new Event("napkin:settings"));
    else if (k === "w" && v.kind === "napkin") app.crumpling = v.id;
    else if (k === "h" && e.shiftKey) app.home();
    else if (k === "s" && e.shiftKey && v.kind === "napkin") app.open(v.id, v.tab === "sketch" ? "talk" : "sketch");
    else if (/^[1-9]$/.test(k)) {
      const n = app.onTable[Number(k) - 1];
      n ? app.open(n.id) : (handled = false);
    } else if (k === "[" && e.shiftKey === false) app.home();
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  // Fixture mode (fidelity gate): report where the key pieces landed, in window points.
  async function reportFixture() {
    await document.fonts.ready;
    await new Promise((r) => setTimeout(r, 1200));
    const rects = [...document.querySelectorAll<HTMLElement>("[data-fx]")].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.fx, x: r.x, y: r.y, w: r.width, h: r.height };
    });
    await api.fixtureReport(JSON.stringify({ viewport: { w: innerWidth, h: innerHeight }, rects }));
  }

  // external links open in the browser, not inside the app
  function onClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
    if (a && /^https?:/.test(a.href)) {
      e.preventDefault();
      openUrl(a.href);
    }
  }
</script>

<svelte:window onkeydowncapture={onKey} onclick={onClick} />

<!-- Shared paper & ink filters (docs/DESIGN.md), referenced from CSS/SVG as url(#…) -->
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <!-- P4: fibrous, feathered paper edges -->
  <filter id="fibers" x="-1%" y="-1%" width="102%" height="102%">
    <feTurbulence type="fractalNoise" baseFrequency="0.32" numOctaves="2" seed="4" result="n" />
    <feDisplacementMap in="SourceGraphic" in2="n" scale="1.4" xChannelSelector="R" yChannelSelector="G" result="d" />
    <feGaussianBlur in="d" stdDeviation="0.35" />
  </filter>
  <!-- P6: graphite/pencil grain inside strokes -->
  <filter id="pencil" x="-5%" y="-5%" width="110%" height="110%">
    <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="5" result="n" />
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.95" result="m" />
    <feComposite in="SourceGraphic" in2="m" operator="in" />
  </filter>
  <!-- P8: felt-tip marker — thin stroke, ink pooling at edges, ends and joints, slight bleed -->
  <filter id="marker" x="-3%" y="-15%" width="106%" height="130%">
    <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="11" result="n" />
    <feDisplacementMap in="SourceAlpha" in2="n" scale="1.3" xChannelSelector="R" yChannelSelector="G" result="a0" />
    <feMorphology in="a0" operator="erode" radius="0.9" result="a" />
    <feGaussianBlur in="a" stdDeviation="2.4" result="b" />
    <feComposite in="a" in2="b" operator="arithmetic" k1="-1" k2="1" result="rim" />
    <feComponentTransfer in="rim" result="pool"><feFuncA type="gamma" amplitude="2.4" exponent="1.3" /></feComponentTransfer>
    <feFlood flood-color="#57524b" result="c1" />
    <feComposite in="c1" in2="a" operator="in" result="body" />
    <feFlood flood-color="#1d1a17" result="c2" />
    <feComposite in="c2" in2="pool" operator="in" result="dark" />
    <feGaussianBlur in="a" stdDeviation="0.9" result="h0" />
    <feFlood flood-color="#35322e" flood-opacity="0.22" result="c3" />
    <feComposite in="c3" in2="h0" operator="in" result="halo" />
    <feMerge><feMergeNode in="halo" /><feMergeNode in="body" /><feMergeNode in="dark" /></feMerge>
  </filter>
  <!-- coffee stain: irregular tide line -->
  <filter id="stain" x="-10%" y="-10%" width="120%" height="120%">
    <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="21" result="n" />
    <feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G" result="d" />
    <feGaussianBlur in="d" stdDeviation="0.7" />
  </filter>
</svg>

<div class="shell" class:dropping>
  <Sidebar />
  <main>
    {#if app.view.kind === "home"}
      <Home />
    {:else}
      {#key app.view.id}
        <NapkinView id={app.view.id} />
      {/key}
    {/if}
  </main>
</div>
<Overlays />

<style>
  .shell {
    position: relative;
    height: 100%;
  }
  main {
    position: absolute;
    inset: 0 0 0 291px;
    min-width: 0;
  }
  .dropping main::after {
    content: "drop it on the napkin";
    position: absolute;
    inset: 40px 30px 30px;
    border: 3px dashed var(--clay);
    border-radius: var(--sketch-radius);
    display: grid;
    place-items: center;
    font-family: var(--marker);
    font-size: 30px;
    color: var(--clay-deep);
    background: rgba(249, 230, 218, 0.55);
    pointer-events: none;
    z-index: 30;
  }
</style>
