<script lang="ts">
  import { onMount, tick } from "svelte";
  import { api } from "../lib/api";
  import { app } from "../lib/state.svelte";
  import { getTerm } from "../lib/terminals.svelte";
  import { relTo } from "../lib/format";
  import { BOXY, INKS, bounds, docBounds, emptyDoc, hit, newId, parseDoc, type Kind, type Shape, type SketchDoc } from "../lib/sketch/model";
  import { drawShapes, forget, SKETCH_FONT } from "../lib/sketch/render";
  import { toSpec } from "../lib/sketch/spec";

  let { id, project }: { id: string; project: string } = $props();

  type Tool = "select" | Kind;
  const TOOLS: { tool: Tool; glyph: string; key: string; tip: string }[] = [
    { tool: "select", glyph: "↖", key: "v", tip: "pick & move (V) · double-click to name" },
    { tool: "rect", glyph: "▭", key: "r", tip: "box (R)" },
    { tool: "ellipse", glyph: "◯", key: "o", tip: "circle (O)" },
    { tool: "diamond", glyph: "◇", key: "d", tip: "decision (D)" },
    { tool: "arrow", glyph: "→", key: "a", tip: "arrow (A) — connects shapes in the spec" },
    { tool: "line", glyph: "╱", key: "l", tip: "line (L)" },
    { tool: "pen", glyph: "✎", key: "p", tip: "doodle (P)" },
    { tool: "text", glyph: "T", key: "t", tip: "note (T)" },
  ];

  let docs = $state<{ name: string; mtime: number }[]>([]);
  let doc = $state<SketchDoc>(emptyDoc("sketch 1"));
  let tool = $state<Tool>("rect");
  let color = $state(INKS[0].value);
  let fill = $state(false);
  let selected = $state<string | null>(null);
  let editing = $state<{ id: string; text: string } | null>(null);
  let handing = $state(false);

  let wrap: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let size = { w: 0, h: 0 };
  /** screen = doc * k + (x, y) — pan with two fingers, zoom with pinch or ⌘-scroll */
  let view = $state({ x: 0, y: 0, k: 1 });

  function fit() {
    if (!doc.shapes.length || !size.w) {
      view = { x: 0, y: 0, k: 1 };
      return;
    }
    const b = docBounds(doc.shapes, 30);
    const k = Math.min(1, size.w / b.w, size.h / b.h);
    view = { k, x: (size.w - b.w * k) / 2 - b.x * k, y: Math.min(20, (size.h - b.h * k) / 2) - b.y * k };
    draw();
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const k = Math.min(4, Math.max(0.25, view.k * Math.exp(-e.deltaY * 0.01)));
      view = { k, x: mx - ((mx - view.x) * k) / view.k, y: my - ((my - view.y) * k) / view.k };
    } else {
      view = { ...view, x: view.x - e.deltaX, y: view.y - e.deltaY };
    }
    draw();
  }

  // ── history ────────────────────────────────────────────────────────────
  let past: string[] = [];
  let future: string[] = [];
  function remember() {
    past.push(JSON.stringify(doc.shapes));
    if (past.length > 100) past.shift();
    future = [];
  }
  function undo() {
    const prev = past.pop();
    if (prev === undefined) return;
    future.push(JSON.stringify(doc.shapes));
    doc.shapes = JSON.parse(prev);
    selected = null;
    changed();
  }
  function redo() {
    const next = future.pop();
    if (next === undefined) return;
    past.push(JSON.stringify(doc.shapes));
    doc.shapes = JSON.parse(next);
    changed();
  }

  // ── persistence ────────────────────────────────────────────────────────
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSaved = new Map<string, number>(); // name → our own save time, to ignore echoes
  let dirty = false;

  function changed() {
    dirty = true;
    draw();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 700);
  }

  async function save() {
    if (!dirty) return;
    dirty = false;
    const snapshot = $state.snapshot(doc);
    lastSaved.set(snapshot.name, Date.now());
    try {
      await api.sketchSave(project, snapshot.name, JSON.stringify(snapshot, null, 1), undefined, toSpec(snapshot, null));
      await refreshList();
    } catch (e) {
      app.flash(String(e), "red");
    }
  }

  async function refreshList() {
    const files = await api.sketchList(project);
    docs = files.map((f) => ({ name: parseName(f.data, f.name), mtime: f.mtime }));
    return files;
  }

  function parseName(raw: string, fallback: string) {
    try {
      return parseDoc(raw, fallback).name;
    } catch {
      return fallback;
    }
  }

  async function load(name?: string) {
    await save();
    const files = await refreshList();
    const f = name ? files.find((x) => parseName(x.data, x.name) === name) : files[0];
    if (f) {
      try {
        doc = parseDoc(f.data, f.name);
      } catch {
        app.flash(`couldn't read ${f.name}.napkin.json`, "red");
      }
    } else {
      doc = emptyDoc(name ?? "sketch 1");
    }
    past = [];
    future = [];
    selected = null;
    fit();
    draw();
  }

  async function newSketch() {
    await save();
    let n = docs.length + 1;
    while (docs.some((d) => d.name === `sketch ${n}`)) n++;
    doc = emptyDoc(`sketch ${n}`);
    view = { x: 0, y: 0, k: 1 };
    past = [];
    future = [];
    selected = null;
    tool = "rect";
    dirty = true;
    await save();
    draw();
  }

  async function rename(next: string) {
    next = next.trim();
    if (!next || next === doc.name) return;
    const old = doc.name;
    doc.name = next;
    dirty = true;
    await save();
    await api.sketchDelete(project, old).catch(() => {});
    await refreshList();
  }

  async function toss() {
    await api.sketchDelete(project, doc.name);
    dirty = false;
    await load();
  }

  // Claude can doodle back: pick up edits to the open sketch made outside Napkin.
  async function pollDisk() {
    if (dragging || editing || dirty) return;
    const files = await api.sketchList(project).catch(() => null);
    if (!files) return;
    docs = files.map((f) => ({ name: parseName(f.data, f.name), mtime: f.mtime }));
    const mine = files.find((f) => parseName(f.data, f.name) === doc.name);
    const ours = lastSaved.get(doc.name) ?? 0;
    if (mine && mine.mtime > ours + 1500) {
      const next = parseDoc(mine.data, mine.name);
      if (JSON.stringify(next.shapes) !== JSON.stringify(doc.shapes)) {
        remember();
        doc = next;
        lastSaved.set(doc.name, mine.mtime);
        app.flash("Claude doodled on this napkin ✎");
        draw();
      }
    }
  }

  // ── drawing ────────────────────────────────────────────────────────────
  let raf = 0;
  function draw() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!canvas) return;
      const dpr = devicePixelRatio || 1;
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);
      ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.x, dpr * view.y);
      drawShapes(ctx, doc.shapes, { selected, editing: editing?.id });
    });
  }

  function resize() {
    const r = wrap.getBoundingClientRect();
    size = { w: r.width, h: r.height };
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    canvas.style.width = `${r.width}px`;
    canvas.style.height = `${r.height}px`;
    draw();
  }

  // ── pointer ────────────────────────────────────────────────────────────
  let dragging: null | { mode: "create" | "move" | "resize"; shape: Shape; ox: number; oy: number; sx: number; sy: number } = null;

  function pos(e: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left - view.x) / view.k, (e.clientY - r.top - view.y) / view.k] as const;
  }

  function onDown(e: PointerEvent) {
    if (e.button !== 0 || editing) return;
    const [x, y] = pos(e);
    canvas.setPointerCapture(e.pointerId);

    if (tool === "select") {
      const sel = doc.shapes.find((s) => s.id === selected);
      if (sel) {
        const b = bounds(sel);
        if (Math.hypot(x - (b.x + b.w + 6), y - (b.y + b.h + 6)) < 9 && sel.kind !== "pen") {
          remember();
          dragging = { mode: "resize", shape: sel, ox: x, oy: y, sx: sel.w, sy: sel.h };
          return;
        }
      }
      const s = hit(doc.shapes, x, y);
      selected = s?.id ?? null;
      if (s) {
        remember();
        dragging = { mode: "move", shape: s, ox: x, oy: y, sx: s.x, sy: s.y };
      }
      draw();
      return;
    }

    if (tool === "text") {
      remember();
      const s: Shape = { id: newId(), kind: "text", x, y: y - 14, w: 160, h: 28, color, seed: seed(), text: "" };
      doc.shapes.push(s);
      startEditing(s);
      return;
    }

    remember();
    const s: Shape = {
      id: newId(),
      kind: tool,
      x,
      y,
      w: 0,
      h: 0,
      color,
      fill: BOXY.includes(tool) ? fill : false,
      seed: seed(),
      points: tool === "pen" ? [[x, y]] : undefined,
    };
    doc.shapes.push(s);
    dragging = { mode: "create", shape: doc.shapes[doc.shapes.length - 1], ox: x, oy: y, sx: 0, sy: 0 };
  }

  function onMove(e: PointerEvent) {
    if (!dragging) return;
    const [x, y] = pos(e);
    const d = dragging;
    const s = d.shape;
    if (d.mode === "move") {
      const dx = x - d.ox, dy = y - d.oy;
      if (s.kind === "pen" && s.points) {
        const px = s.x, py = s.y;
        s.x = d.sx + dx;
        s.y = d.sy + dy;
        s.points = s.points.map(([a, b]) => [a + (s.x - px), b + (s.y - py)]);
      } else {
        s.x = d.sx + dx;
        s.y = d.sy + dy;
      }
    } else if (d.mode === "resize") {
      s.w = d.sx + (x - d.ox);
      s.h = d.sy + (y - d.oy);
    } else if (s.kind === "pen") {
      const last = s.points!.at(-1)!;
      if (Math.hypot(x - last[0], y - last[1]) >= 2.5) s.points = [...s.points!, [x, y]];
    } else {
      let w = x - d.ox, h = y - d.oy;
      if (e.shiftKey && BOXY.includes(s.kind)) w = h = Math.sign(w || 1) * Math.max(Math.abs(w), Math.abs(h));
      s.w = w;
      s.h = h;
    }
    draw();
  }

  function onUp() {
    if (!dragging) return;
    const { mode, shape: s } = dragging;
    dragging = null;
    if (mode === "create") {
      const b = bounds(s);
      const tiny = s.kind === "pen" ? (s.points?.length ?? 0) < 3 : Math.hypot(b.w, b.h) < 8;
      if (tiny) {
        doc.shapes = doc.shapes.filter((x) => x.id !== s.id);
        past.pop();
      } else if (s.kind !== "pen" && s.kind !== "line" && s.kind !== "arrow") {
        // normalize to positive size so labels and ASCII land where you expect
        Object.assign(s, b);
      }
    } else if (mode === "resize" && BOXY.includes(s.kind)) {
      Object.assign(s, bounds(s));
    }
    changed();
  }

  function onDouble(e: MouseEvent) {
    const r = canvas.getBoundingClientRect();
    const s = hit(doc.shapes, (e.clientX - r.left - view.x) / view.k, (e.clientY - r.top - view.y) / view.k);
    if (s && s.kind !== "pen") {
      remember();
      startEditing(s);
    }
  }

  let editor = $state<HTMLTextAreaElement>();
  async function startEditing(s: Shape) {
    selected = s.id;
    editing = { id: s.id, text: s.text ?? "" };
    draw();
    await tick();
    editor?.focus();
    editor?.select();
  }

  function commitEdit(keep = true) {
    if (!editing) return;
    const s = doc.shapes.find((x) => x.id === editing!.id);
    if (s) {
      if (keep) s.text = editing.text.trim() || undefined;
      if (s.kind === "text") {
        if (!s.text) doc.shapes = doc.shapes.filter((x) => x.id !== s.id);
        else {
          const ctx = canvas.getContext("2d")!;
          ctx.font = `20px ${SKETCH_FONT}`;
          const lines = s.text.split("\n");
          s.w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 4;
          s.h = lines.length * 25;
        }
      }
    }
    editing = null;
    changed();
  }

  const editorBox = $derived.by(() => {
    if (!editing) return null;
    const s = doc.shapes.find((x) => x.id === editing!.id);
    if (!s) return null;
    const b = bounds(s);
    const X = (v: number) => v * view.k + view.x;
    const Y = (v: number) => v * view.k + view.y;
    if (s.kind === "text") return { left: X(b.x), top: Y(b.y), width: Math.max(180, b.w * view.k), align: "left" };
    const cx = s.kind === "line" || s.kind === "arrow" ? s.x + s.w / 2 : b.x + b.w / 2;
    const cy = s.kind === "line" || s.kind === "arrow" ? s.y + s.h / 2 - 14 : b.y + b.h / 2;
    const width = Math.max(120, Math.min(b.w * view.k - 8, 260));
    return { left: X(cx) - width / 2, top: Y(cy) - 16, width, align: "center" };
  });

  function seed() {
    return Math.floor(Math.random() * 2 ** 31);
  }

  function removeSelected() {
    if (!selected) return;
    remember();
    forget(selected);
    doc.shapes = doc.shapes.filter((s) => s.id !== selected);
    selected = null;
    changed();
  }

  function onKey(e: KeyboardEvent) {
    if (app.view.kind !== "napkin" || app.view.tab !== "sketch" || app.paletteOpen) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    const k = e.key.toLowerCase();
    if (e.metaKey && k === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (k === "backspace" || k === "delete") {
      e.preventDefault();
      removeSelected();
    } else if (k === "escape") {
      selected = null;
      draw();
    } else if (k === "enter" && selected) {
      const s = doc.shapes.find((x) => x.id === selected);
      if (s && s.kind !== "pen") {
        e.preventDefault();
        remember();
        startEditing(s);
      }
    } else if (k === "f") {
      fill = !fill;
    } else if (/^[1-5]$/.test(k)) {
      color = INKS[Number(k) - 1].value;
      recolorSelected();
    } else {
      const found = TOOLS.find((x) => x.key === k);
      if (found) tool = found.tool;
    }
  }

  function recolorSelected() {
    const s = doc.shapes.find((x) => x.id === selected);
    if (s && s.color !== color) {
      remember();
      s.color = color;
      changed();
    }
  }

  // ── hand to Claude ─────────────────────────────────────────────────────
  function renderPng(): string {
    const shapes = $state.snapshot(doc.shapes) as Shape[];
    const box = docBounds(shapes, 28);
    const scale = 2;
    const c = document.createElement("canvas");
    c.width = Math.ceil(box.w * scale);
    c.height = Math.ceil(box.h * scale);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fbf8f1";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.setTransform(scale, 0, 0, scale, -box.x * scale, -box.y * scale);
    drawShapes(ctx, shapes);
    return c.toDataURL("image/png");
  }

  async function handToClaude() {
    if (!doc.shapes.length) {
      app.flash("the napkin is blank — draw something first");
      return;
    }
    handing = true;
    try {
      const snapshot = $state.snapshot(doc) as SketchDoc;
      const png = renderPng();
      // the spec needs the png path; slug is deterministic, so ask Rust once with a placeholder
      const first = await api.sketchSave(project, snapshot.name, JSON.stringify(snapshot, null, 1), png, toSpec(snapshot, null));
      const pngRel = first.png ? relTo(first.png, project) : null;
      const saved = await api.sketchSave(project, snapshot.name, JSON.stringify(snapshot, null, 1), undefined, toSpec(snapshot, pngRel));
      lastSaved.set(snapshot.name, Date.now());
      const specRel = saved.spec ? relTo(saved.spec, project) : "";
      const t = getTerm(id);
      const wasRunning = !!app.napkin(id)?.running;
      app.open(id, "talk");
      if (!wasRunning) {
        await t.start();
        await new Promise((r) => setTimeout(r, 2500)); // let claude draw its prompt first
      }
      t.paste(`@${specRel} `);
      app.flash("sketch handed to Claude — it's in your prompt");
    } catch (e) {
      app.flash(String(e), "red");
    } finally {
      handing = false;
    }
  }

  onMount(() => {
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    resize();
    document.fonts.load(`20px ${SKETCH_FONT}`).then(draw);
    load();
    const poll = setInterval(pollDisk, 2500);
    return () => {
      ro.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      clearInterval(poll);
      clearTimeout(saveTimer);
      save();
    };
  });
</script>

<svelte:window onkeydown={onKey} />

<div class="sketch">
  <div class="bar">
    <div class="tools">
      {#each TOOLS as t (t.tool)}
        <button class="tool" class:on={tool === t.tool} title={t.tip} onclick={() => (tool = t.tool)}>{t.glyph}</button>
      {/each}
      <span class="sep"></span>
      {#each INKS as ink, i (ink.value)}
        <button
          class="ink"
          class:on={color === ink.value}
          style="--c: {ink.value}"
          title="{ink.name} ({i + 1})"
          aria-label={ink.name}
          onclick={() => {
            color = ink.value;
            recolorSelected();
          }}
        ></button>
      {/each}
      <button class="tool hatch" class:on={fill} title="hatch fill (F)" onclick={() => (fill = !fill)}>▨</button>
      <span class="sep"></span>
      <button class="tool" title="undo (⌘Z)" onclick={undo}>↶</button>
      <button class="tool" title="redo (⌘⇧Z)" onclick={redo}>↷</button>
      <button class="tool" title="erase selected (⌫)" disabled={!selected} onclick={removeSelected}>⌫</button>
    </div>
    <div class="right">
      <input
        class="name"
        value={doc.name}
        onchange={(e) => rename((e.target as HTMLInputElement).value)}
        onkeydown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        spellcheck="false"
        title="sketch name (also its file name)"
      />
      <button class="tool" title="fit drawing ({Math.round(view.k * 100)}%)" onclick={fit}>⤢</button>
      <button class="btn small clay" disabled={handing} onclick={handToClaude} title="save PNG + ASCII + shape spec and put an @-reference in Claude's prompt">
        <span>{handing ? "folding…" : "hand to Claude →"}</span>
      </button>
    </div>
  </div>

  <div class="body">
    <aside class="shelf">
      <button class="new" onclick={newSketch}>+ new sketch</button>
      {#each docs as d (d.name)}
        <button class="doc" class:on={d.name === doc.name} onclick={() => load(d.name)}>{d.name}</button>
      {/each}
      {#if docs.length === 0}<p class="hint">sketches live in<br /><code>.napkin/sketches/</code></p>{/if}
    </aside>

    <div class="stage" bind:this={wrap}>
      <canvas
        bind:this={canvas}
        class="tool-{tool}"
        onpointerdown={onDown}
        onpointermove={onMove}
        onpointerup={onUp}
        onpointercancel={onUp}
        ondblclick={onDouble}
      ></canvas>
      {#if editing && editorBox}
        <textarea
          class="label-editor"
          bind:this={editor}
          bind:value={editing.text}
          style="left:{editorBox.left}px; top:{editorBox.top}px; width:{editorBox.width}px; font-size:{Math.max(12, 17 * view.k)}px; text-align:{editorBox.align}; color:{doc.shapes.find((s) => s.id === editing?.id)?.color}"
          rows="1"
          placeholder="name it…"
          onblur={() => commitEdit(true)}
          onkeydown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commitEdit(true);
            } else if (e.key === "Escape") commitEdit(false);
          }}
        ></textarea>
      {/if}
      {#if !doc.shapes.length}
        <p class="empty">
          doodle the idea — boxes, arrows, a few words.<br />
          double-click a shape to name it; names become references Claude can use.
        </p>
      {/if}
      {#if docs.some((d) => d.name === doc.name)}
        <button class="toss" onclick={toss} title="throw this sketch away">toss sketch</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .sketch {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 18px 20px 16px 22px;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 6px 12px 6px;
    border-bottom: 1px dashed rgba(95, 82, 62, 0.22);
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-wrap: wrap;
    flex: 1;
  }
  .tool {
    width: 28px;
    height: 28px;
    font-size: 17px;
    border-radius: 7px 5px 8px 6px;
    color: var(--ink-2);
    font-family: var(--hand);
  }
  .tool:hover {
    background: rgba(224, 118, 78, 0.08);
  }
  .tool.on {
    color: var(--ink);
    background: rgba(224, 118, 78, 0.16);
    box-shadow: inset 0 0 0 1.4px rgba(224, 118, 78, 0.6);
  }
  .tool:disabled {
    opacity: 0.35;
  }
  .ink {
    width: 19px;
    height: 19px;
    margin: 0 1px;
    border-radius: 50% 45% 52% 48%;
    background: var(--c);
    opacity: 0.85;
    box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.35);
  }
  .ink.on {
    outline: 1.6px solid var(--c);
    outline-offset: 2px;
    opacity: 1;
  }
  .sep {
    width: 1px;
    height: 20px;
    background: rgba(95, 82, 62, 0.2);
    margin: 0 5px;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 12px;
    padding-top: 10px;
  }
  .shelf {
    width: 128px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
    border-right: 1px dashed rgba(95, 82, 62, 0.18);
    padding-right: 8px;
  }
  .new {
    text-align: left;
    font-size: 14px;
    color: var(--clay-deep);
    padding: 3px 4px 6px;
  }
  .doc {
    text-align: left;
    font-size: 14px;
    padding: 3px 6px;
    border-radius: 5px;
    color: var(--ink-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .doc.on {
    color: var(--ink);
    background: rgba(224, 118, 78, 0.12);
  }
  .hint {
    font-size: 12.5px;
    color: var(--ink-3);
    margin: 8px 4px;
  }
  .hint code {
    font-family: var(--type);
    font-size: 11.5px;
  }
  .stage {
    position: relative;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  canvas {
    position: absolute;
    inset: 0;
    touch-action: none;
    cursor: crosshair;
  }
  canvas.tool-select {
    cursor: default;
  }
  canvas.tool-text {
    cursor: text;
  }
  .right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .name {
    width: 120px;
    text-align: right;
    font-family: var(--marker);
    font-size: 20px;
    background: transparent;
    border: 0;
    border-bottom: 1.4px dashed transparent;
    outline: none;
    color: var(--ink-2);
  }
  .name:hover,
  .name:focus {
    border-bottom-color: rgba(224, 118, 78, 0.6);
  }
  .label-editor {
    position: absolute;
    z-index: 3;
    resize: none;
    border: 0;
    outline: 1.4px dashed rgba(224, 118, 78, 0.7);
    background: rgba(251, 248, 241, 0.92);
    font-family: var(--hand);
    font-weight: 700;
    font-size: 17px;
    line-height: 1.2;
    padding: 4px 6px;
    overflow: hidden;
  }
  .empty {
    position: absolute;
    inset: 38% 0 auto 0;
    text-align: center;
    color: var(--ink-3);
    font-size: 16px;
    pointer-events: none;
    line-height: 1.6;
  }
  .toss {
    position: absolute;
    bottom: 4px;
    right: 6px;
    font-size: 13px;
    color: var(--ink-3);
  }
  .toss:hover {
    color: var(--red-ink);
  }
</style>
