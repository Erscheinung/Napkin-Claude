// Pen strokes. Everything outlined in Napkin is drawn with rough.js (principle P6),
// deterministic per element (fixed seeds) so nothing jitters between renders.

import rough from "roughjs";
import type { Options } from "roughjs/bin/core";

const gen = rough.generator();

export type PathInfo = { d: string; stroke: string; strokeWidth: number; fill?: string };

export function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${x + r} ${y} L${x + w - r} ${y} Q${x + w} ${y} ${x + w} ${y + r} L${x + w} ${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} L${x + r} ${y + h} Q${x} ${y + h} ${x} ${y + h - r} L${x} ${y + r} Q${x} ${y} ${x + r} ${y} Z`;
}

export function paths(kind: "path", d: string, o: Options): PathInfo[];
export function paths(kind: "ellipse", d: [number, number, number, number], o: Options): PathInfo[];
export function paths(kind: "line", d: [number, number, number, number], o: Options): PathInfo[];
export function paths(kind: string, d: any, o: Options): PathInfo[] {
  const drawable =
    kind === "path" ? gen.path(d, o) : kind === "ellipse" ? gen.ellipse(d[0], d[1], d[2], d[3], o) : gen.line(d[0], d[1], d[2], d[3], o);
  return gen.toPaths(drawable) as PathInfo[];
}

export function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 2 ** 31 || 1;
}

export type SketchOpts = {
  stroke?: string;
  fill?: string;
  /** two outlines ~gap px apart, like the reference buttons */
  double?: boolean;
  gap?: number;
  radius?: number;
  width?: number;
  roughness?: number;
  seed?: number;
  /** extra room around the element for the strokes */
  pad?: number;
};

const SVGNS = "http://www.w3.org/2000/svg";

/**
 * `use:sketch` — draws a rough outline (and flat fill) behind an element's content.
 * The element gets `position: relative`; content should sit above (z-index ≥ 1).
 */
export function sketch(node: HTMLElement, opts: SketchOpts = {}) {
  let o = opts;
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("sketch-svg");
  node.classList.add("sketched");
  node.prepend(svg);
  let lastKey = "";

  function draw() {
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const key = `${w}x${h}:${JSON.stringify(o)}`;
    if (!w || !h || key === lastKey) return;
    lastKey = key;
    const pad = o.pad ?? 6;
    svg.setAttribute("width", String(w + pad * 2));
    svg.setAttribute("height", String(h + pad * 2));
    svg.style.left = svg.style.top = `${-pad}px`;
    const stroke = o.stroke ?? "#35322e";
    const seed = o.seed ?? seedOf(node.textContent ?? "x");
    const r = o.radius ?? 7;
    const width = o.width ?? 1.6;
    const base: Options = { stroke, strokeWidth: width, roughness: o.roughness ?? 1.1, bowing: 0.6, seed, preserveVertices: false };
    const gap = o.double ? (o.gap ?? 5) : 0;
    const out: PathInfo[] = [];
    // outer line
    out.push(...paths("path", roundedRect(pad, pad, w, h, r + gap / 2), { ...base, disableMultiStroke: true }));
    if (o.double) {
      out.push(
        ...paths("path", roundedRect(pad + gap, pad + gap, w - gap * 2, h - gap * 2, r), {
          ...base,
          seed: seed + 7,
          disableMultiStroke: true,
          fill: o.fill,
          fillStyle: "solid",
        }),
      );
    } else if (o.fill) {
      out.unshift(...paths("path", roundedRect(pad + 1, pad + 1, w - 2, h - 2, r), { ...base, stroke: "none", fill: o.fill, fillStyle: "solid", seed: seed + 3 }));
    }
    svg.replaceChildren(
      ...out.map((p) => {
        const el = document.createElementNS(SVGNS, "path");
        el.setAttribute("d", p.d);
        el.setAttribute("stroke", p.stroke);
        el.setAttribute("stroke-width", String(p.strokeWidth));
        el.setAttribute("fill", p.fill ?? "none");
        el.setAttribute("stroke-linecap", "round");
        el.setAttribute("stroke-linejoin", "round");
        return el;
      }),
    );
  }

  const ro = new ResizeObserver(draw);
  ro.observe(node);
  draw();
  return {
    update(next: SketchOpts) {
      o = next;
      draw();
    },
    destroy() {
      ro.disconnect();
      svg.remove();
    },
  };
}

/** Shared pen presets so every button is drawn the same way. */
export const PEN = {
  clay: { stroke: "#e0764e", fill: "#f7d7c7", double: true, radius: 6, width: 1.6 },
  graphite: { stroke: "#35322e", fill: "#fbf9f4", double: true, radius: 6, width: 1.6 },
  small: { stroke: "#5f5a52", fill: "#fbf9f4", radius: 5, width: 1.3, pad: 4 },
  danger: { stroke: "#b8392b", fill: "#fbf6f2", radius: 5, width: 1.3, pad: 4 },
  key: { stroke: "#5f5a52", radius: 3, width: 1.1, pad: 3, roughness: 0.8 },
} as const;
