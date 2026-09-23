<script lang="ts">
  // "the tab" (plan usage from napkin sessions' statusline) and a tiny settings page.
  import { app } from "../lib/state.svelte";
  import { settings } from "../lib/settings.svelte";

  let page = $state<"tab" | "settings">("tab");
  const limits = $derived(app.usage?.rate_limits);

  function resets(sec: number, withDay: boolean) {
    const d = new Date(sec * 1000);
    const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "").toLowerCase();
    return withDay ? `${d.toLocaleDateString([], { weekday: "short" }).toLowerCase()} ${t}` : t;
  }
  function inDays(sec: number) {
    const d = Math.max(0, Math.round((sec * 1000 - app.now) / 86_400_000));
    return d <= 0 ? "today" : d === 1 ? "1 day" : `${d} days`;
  }
  const rows = $derived(
    [
      { key: "5 h", w: limits?.five_hour, day: false },
      { key: "week", w: limits?.seven_day, day: true },
    ].filter((r) => r.w),
  );
  const weekHot = $derived((limits?.seven_day?.used_percentage ?? 0) >= 85);

  $effect(() => {
    const open = () => (page = "settings");
    window.addEventListener("napkin:settings", open);
    return () => window.removeEventListener("napkin:settings", open);
  });
</script>

<div class="tab">
  <div class="dots">· · ·</div>
  <div class="heads">
    <button class:on={page === "tab"} onclick={() => (page = "tab")}><span class="underlined">the tab</span></button>
    <button class:on={page === "settings"} onclick={() => (page = "settings")}><span class="underlined">settings</span></button>
  </div>

  {#if page === "tab"}
    {#if rows.length}
      {#each rows as r (r.key)}
        {@const pct = Math.round(r.w!.used_percentage)}
        <div class="meter" class:hot={pct >= 85}>
          <span class="k">{r.key}</span>
          <span class="bar"><span class="fill" style="width:{Math.min(100, pct)}%"></span></span>
          <span class="pct">{pct}%</span>
        </div>
        <div class="resets" class:hot={pct >= 85}>resets {resets(r.w!.resets_at, r.day)}</div>
      {/each}
      {#if weekHot && limits?.seven_day}
        <p class="warn">week limit nearly used; it resets in {inDays(limits.seven_day.resets_at)}</p>
      {/if}
    {:else}
      <p class="empty">fills in once a napkin talks to Claude.</p>
    {/if}
  {:else}
    <label class="set">
      <span>terminal ink size</span>
      <input type="range" min="11" max="18" step="0.5" bind:value={settings.fontSize} />
      <span class="val">{settings.fontSize}</span>
    </label>
    <label class="set check">
      <input type="checkbox" bind:checked={settings.doodleBack} />
      <span>let Claude doodle back on sketches</span>
    </label>
  {/if}
</div>

<style>
  .dots {
    text-align: center;
    letter-spacing: 3px;
    color: var(--ink-2);
    margin-bottom: 2px;
  }
  .heads {
    display: flex;
    gap: 26px;
    margin: 0 0 12px 8px;
  }
  .heads button {
    font-size: 16px;
    color: var(--ink-3);
  }
  .heads button.on {
    color: var(--ink);
  }
  .heads button:not(.on) .underlined {
    background: none;
  }
  .meter {
    display: grid;
    grid-template-columns: 50px 1fr 50px;
    align-items: center;
    gap: 6px;
    padding-left: 8px;
  }
  .k {
    font-size: 14.5px;
    color: var(--ink-2);
  }
  .bar {
    height: 12px;
    border: 1.2px solid var(--ink-2);
    border-radius: 1px 3px 2px 1px;
    position: relative;
    overflow: hidden;
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: repeating-linear-gradient(-62deg, rgba(53, 50, 46, 0.55) 0 1.2px, transparent 1.2px 3.4px);
    border-right: 1.2px solid rgba(53, 50, 46, 0.5);
  }
  .hot .fill {
    background: repeating-linear-gradient(-62deg, rgba(184, 57, 43, 0.85) 0 1.4px, transparent 1.4px 3.2px);
    border-right-color: var(--red-ink);
  }
  .pct {
    text-align: right;
    font-weight: 700;
    font-size: 21px;
    font-style: italic;
  }
  .hot .pct {
    color: var(--red-ink);
  }
  .resets {
    font-size: 13px;
    color: var(--ink-2);
    margin: -2px 0 8px 64px;
  }
  .resets.hot {
    color: var(--red-ink);
  }
  .warn {
    color: var(--red-ink);
    font-size: 13px;
    margin: 4px 0 0 8px;
  }
  .empty {
    font-size: 13.5px;
    color: var(--ink-3);
    margin: 0 0 0 8px;
  }
  .set {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13.5px;
    margin: 0 0 8px 8px;
  }
  .set input[type="range"] {
    flex: 1;
    accent-color: var(--clay);
  }
  .val {
    width: 26px;
    text-align: right;
    color: var(--ink-2);
  }
  .check input {
    accent-color: var(--clay);
  }
</style>
