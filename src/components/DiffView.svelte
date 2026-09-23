<script lang="ts">
  let { text, loading = false }: { text: string; loading?: boolean } = $props();

  const MAX = 1500;
  const lines = $derived.by(() => {
    const out: { cls: string; t: string }[] = [];
    for (const l of text.split("\n")) {
      if (/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|similarity|old mode|new mode)/.test(l)) continue;
      const cls = l.startsWith("@@") ? "hunk" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : l.startsWith("Binary") ? "hunk" : "ctx";
      out.push({ cls, t: l });
      if (out.length >= MAX) break;
    }
    return out;
  });
</script>

<div class="diff mono">
  {#if loading}
    <div class="ctx muted">reading the ink…</div>
  {:else if !lines.length}
    <div class="ctx muted">no textual changes</div>
  {:else}
    {#each lines as l, i (i)}
      <div class={l.cls}>{l.t || " "}</div>
    {/each}
    {#if lines.length >= MAX}<div class="hunk">… diff truncated</div>{/if}
  {/if}
</div>

<style>
  .diff {
    font-size: 11.5px;
    line-height: 1.45;
    max-height: 340px;
    overflow: auto;
    background: rgba(255, 255, 255, 0.55);
    border: 1px solid rgba(90, 80, 65, 0.15);
    border-radius: 3px;
    margin: 4px 0 8px;
    padding: 4px 0;
    user-select: text;
    -webkit-user-select: text;
    cursor: text;
  }
  .diff > div {
    white-space: pre;
    padding: 0 10px;
    min-width: max-content;
  }
  .add {
    background: rgba(63, 122, 58, 0.12);
    color: #2e5f2a;
  }
  .del {
    background: rgba(179, 55, 43, 0.1);
    color: #8f2a20;
  }
  .hunk {
    color: var(--blue-ink);
    opacity: 0.75;
    padding-top: 4px !important;
  }
  .ctx {
    color: var(--ink-2);
  }
</style>
