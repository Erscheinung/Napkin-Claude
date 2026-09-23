<script lang="ts" module>
  // Colored-pencil mascot (principle P9): watercolor wash + diagonal pencil hatching that
  // bleeds past a thin wobbly graphite outline. Geometry is static, so paths are built once.
  import { paths, roundedRect, type PathInfo } from "../lib/rough";

  const INK = "#2f2a26";
  const WASH = "#f2865f";
  const HATCH = "#cf4630";

  type Part = { d: string; kind: "wash" | "hatch" | "ink" | "dot" };

  function part(kind: Part["kind"], list: PathInfo[]): Part[] {
    return list.map((p) => ({ d: p.d, kind }));
  }

  function blob(d: string, seed: number): Part[] {
    return [
      // wash, nudged down-left so it bleeds past the outline
      ...part("wash", paths("path", d, { seed, roughness: 2.2, stroke: "none", fill: WASH, fillStyle: "solid" })),
      ...part("hatch", paths("path", d, { seed: seed + 1, roughness: 1.3, stroke: "none", fill: HATCH, fillStyle: "hachure", hachureAngle: -48, hachureGap: 4, fillWeight: 1.3 })),
      ...part("hatch", paths("path", d, { seed: seed + 2, roughness: 1.4, stroke: "none", fill: HATCH, fillStyle: "hachure", hachureAngle: 38, hachureGap: 7.5, fillWeight: 1 })),
      ...part("ink", paths("path", d, { seed: seed + 3, roughness: 1.3, bowing: 1.2, stroke: INK, strokeWidth: 2 })),
    ];
  }

  const BODY = roundedRect(24, 22, 86, 52, 11);
  const SNOUT = roundedRect(12, 44, 16, 15, 6);
  const TAIL = "M100 32 L117 10 Q121 6 125 10 L111 38 Z";
  const LEGS = [34, 47, 83, 96].map((x) => roundedRect(x, 70, 10, 15, 3));

  const base: Part[] = [
    ...blob(TAIL, 31),
    ...LEGS.flatMap((d, i) => blob(d, 50 + i * 5)),
    ...blob(BODY, 11),
    ...blob(SNOUT, 21),
  ];
  const motion: Part[] = [
    ...part("ink", paths("path", "M126 3 Q131 7 130 14", { seed: 91, roughness: 0.8, stroke: INK, strokeWidth: 1.4 })),
    ...part("ink", paths("path", "M131 -2 Q139 5 136 16", { seed: 92, roughness: 0.8, stroke: INK, strokeWidth: 1.4 })),
  ];
  const openEyes: Part[] = [
    ...part("dot", paths("ellipse", [49, 42, 5.5, 9], { seed: 71, roughness: 0.6, stroke: INK, strokeWidth: 1, fill: INK, fillStyle: "solid" })),
    ...part("dot", paths("ellipse", [67, 42, 5.5, 9], { seed: 72, roughness: 0.6, stroke: INK, strokeWidth: 1, fill: INK, fillStyle: "solid" })),
  ];
  const closedEyes: Part[] = [
    ...part("ink", paths("path", "M45 43 Q49 47 53 43", { seed: 73, roughness: 0.5, stroke: INK, strokeWidth: 1.8 })),
    ...part("ink", paths("path", "M63 43 Q67 47 71 43", { seed: 74, roughness: 0.5, stroke: INK, strokeWidth: 1.8 })),
  ];
  const arms: Part[] = [
    ...blob("M30 30 L18 12 Q16 8 20 7 L34 26 Z", 81),
    ...blob("M104 28 L114 8 Q117 5 120 8 L110 32 Z", 85),
  ];
  const sign: Part[] = [
    ...part("ink", paths("line", [112, 30, 116, 2], { seed: 61, roughness: 0.7, stroke: INK, strokeWidth: 1.8 })),
    ...part("ink", paths("path", roundedRect(106, -22, 22, 22, 2), { seed: 62, roughness: 1, stroke: INK, strokeWidth: 1.6, fill: "#fbf8f1", fillStyle: "solid" })),
  ];
</script>

<script lang="ts">
  import type { Status } from "../lib/state.svelte";

  let { size = 48, mood = "ready" as Status | "hero" }: { size?: number; mood?: Status | "hero" } = $props();

  const sleepy = $derived(mood === "resting");
  const busy = $derived(mood === "working" || mood === "starting");
  const parts = $derived.by(() => {
    const out = [...base, ...(sleepy ? closedEyes : openEyes)];
    if (mood === "done") out.push(...arms);
    if (mood === "needs_you") out.push(...sign);
    if (mood === "hero" || busy) out.push(...motion);
    return out;
  });
</script>

<svg class="critter" class:busy width={size} height={size * 0.8} viewBox="4 -26 140 116" aria-hidden="true">
  <g class="wash-layer" transform="translate(-1.2 1.4)">
    {#each parts as p, i (i)}{#if p.kind === "wash"}<path d={p.d} fill={WASH} opacity="0.92" />{/if}{/each}
  </g>
  {#each parts as p, i (i)}
    {#if p.kind === "hatch"}<path d={p.d} stroke={HATCH} stroke-width="1.15" fill="none" opacity="0.36" stroke-linecap="round" />
    {:else if p.kind === "ink"}<path d={p.d} stroke={INK} stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round" />
    {:else if p.kind === "dot"}<path d={p.d} fill={INK} stroke={INK} stroke-width="0.6" />{/if}
  {/each}
  {#if mood === "needs_you"}
    <text x="117" y="-6" text-anchor="middle" font-family="Kalam, cursive" font-weight="700" font-size="18" fill="#b8392b">?</text>
  {/if}
  {#if sleepy}
    <text x="126" y="4" font-family="Kalam, cursive" font-size="15" fill="#8c867b">z</text>
    <text x="135" y="-8" font-family="Kalam, cursive" font-size="11" fill="#b5afa3">z</text>
  {/if}
</svg>

<style>
  .critter {
    flex: none;
    overflow: visible;
    display: block;
  }
  .busy {
    animation: wiggle 0.55s ease-in-out infinite;
    transform-origin: 50% 90%;
  }
</style>
