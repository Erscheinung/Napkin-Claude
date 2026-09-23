<script lang="ts" module>
  // The mascot is the reference's own watercolor + graphite drawing (sampled by
  // scripts/fidelity/extract-assets.sh), one sprite per mood.
  import hero from "../assets/ref/critter-hero.png";
  import plain from "../assets/ref/critter.png";
  import done from "../assets/ref/critter-done.png";
  import needs from "../assets/ref/critter-needs.png";

  // natural aspect ratios (w / h) of each sprite
  const SPRITES = {
    hero: { src: hero, ratio: 160 / 122 },
    plain: { src: plain, ratio: 60 / 42 },
    done: { src: done, ratio: 58 / 42 },
    needs: { src: needs, ratio: 44 / 46 },
  };
</script>

<script lang="ts">
  import type { Status } from "../lib/state.svelte";

  let { size = 48, mood = "ready" as Status | "hero" }: { size?: number; mood?: Status | "hero" } = $props();

  const sprite = $derived(
    mood === "hero" ? SPRITES.hero : mood === "done" ? SPRITES.done : mood === "needs_you" ? SPRITES.needs : SPRITES.plain,
  );
  const busy = $derived(mood === "working" || mood === "starting");
</script>

<span class="critter" class:busy class:sleepy={mood === "resting"} style="width:{size}px; height:{size / sprite.ratio}px">
  <img src={sprite.src} alt="" draggable="false" />
  {#if mood === "resting"}<span class="z">z</span>{/if}
</span>

<style>
  .critter {
    position: relative;
    display: inline-block;
    flex: none;
  }
  img {
    width: 100%;
    height: 100%;
    display: block;
  }
  .busy {
    animation: wiggle 0.55s ease-in-out infinite;
    transform-origin: 50% 90%;
  }
  .sleepy img {
    opacity: 0.72;
    filter: saturate(0.7);
  }
  .z {
    position: absolute;
    right: -8px;
    top: -10px;
    font-family: var(--hand);
    font-size: 12px;
    color: var(--ink-3);
  }
</style>
