// Canvas rendering with rough.js. Drawables are cached per shape (keyed by its geometry)
// so redraws during a drag only regenerate the shape being moved.

import rough from "roughjs";
import type { Drawable } from "roughjs/bin/core";
import { bounds, type Shape } from "./model";

const gen = rough.generator();
const cache = new Map<string, { key: string; drawables: Drawable[] }>();

function drawablesFor(s: Shape): Drawable[] {
  const key = JSON.stringify([s.kind, s.x, s.y, s.w, s.h, s.color, s.fill, s.seed, s.points?.length, s.points?.at(-1)]);
  const hitCache = cache.get(s.id);
  if (hitCache && hitCache.key === key) return hitCache.drawables;

  const o = {
    stroke: s.color,
    strokeWidth: 1.8,
    roughness: 1.2,
    bowing: 1,
    seed: s.seed,
    fill: s.fill ? s.color : undefined,
    fillStyle: "hachure",
    hachureGap: 7,
    fillWeight: 1,
  };
  const b = bounds(s);
  let out: Drawable[] = [];
  switch (s.kind) {
    case "rect":
      out = [gen.rectangle(b.x, b.y, b.w, b.h, o)];
      break;
    case "ellipse":
      out = [gen.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w, b.h, o)];
      break;
    case "diamond": {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      out = [gen.polygon([[cx, b.y], [b.x + b.w, cy], [cx, b.y + b.h], [b.x, cy]], o)];
      break;
    }
    case "line":
    case "arrow": {
      const x2 = s.x + s.w, y2 = s.y + s.h;
      out = [gen.line(s.x, s.y, x2, y2, { ...o, fill: undefined })];
      if (s.kind === "arrow") {
        const a = Math.atan2(s.h, s.w);
        const len = Math.min(16, Math.hypot(s.w, s.h) / 3);
        const p1: [number, number] = [x2 - len * Math.cos(a - 0.45), y2 - len * Math.sin(a - 0.45)];
        const p2: [number, number] = [x2 - len * Math.cos(a + 0.45), y2 - len * Math.sin(a + 0.45)];
        out.push(gen.linearPath([p1, [x2, y2], p2], { ...o, fill: undefined }));
      }
      break;
    }
    case "pen":
      if ((s.points?.length ?? 0) > 1) out = [gen.curve(s.points!, { ...o, fill: undefined, roughness: 0.4, strokeWidth: 2 })];
      break;
    case "text":
      out = [];
      break;
  }
  cache.set(s.id, { key, drawables: out });
  return out;
}

export const SKETCH_FONT = '"Kalam", cursive';

export function drawShapes(
  ctx: CanvasRenderingContext2D,
  shapes: Shape[],
  opts: { selected?: string | null; editing?: string | null } = {},
) {
  const rc = rough.canvas(ctx.canvas);
  for (const s of shapes) {
    for (const d of drawablesFor(s)) rc.draw(d);
    if (s.text && s.id !== opts.editing) drawLabel(ctx, s);
    if (s.id === opts.selected) drawSelection(ctx, s);
  }
}

function drawLabel(ctx: CanvasRenderingContext2D, s: Shape) {
  const b = bounds(s);
  const lines = s.text!.split("\n");
  const size = s.kind === "text" ? 20 : 17;
  ctx.save();
  ctx.fillStyle = s.color;
  ctx.font = `${s.kind === "text" ? 400 : 700} ${size}px ${SKETCH_FONT}`;
  ctx.textBaseline = "middle";
  if (s.kind === "text") {
    ctx.textAlign = "left";
    lines.forEach((l, i) => ctx.fillText(l, b.x, b.y + size * 0.7 + i * size * 1.25));
  } else {
    ctx.textAlign = "center";
    const cx = s.kind === "line" || s.kind === "arrow" ? s.x + s.w / 2 : b.x + b.w / 2;
    const cy = s.kind === "line" || s.kind === "arrow" ? s.y + s.h / 2 - 14 : b.y + b.h / 2;
    const top = cy - ((lines.length - 1) * size * 1.2) / 2;
    lines.forEach((l, i) => ctx.fillText(l, cx, top + i * size * 1.2));
  }
  ctx.restore();
}

function drawSelection(ctx: CanvasRenderingContext2D, s: Shape) {
  const b = bounds(s);
  ctx.save();
  ctx.strokeStyle = "rgba(224,118,78,0.9)";
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.2;
  ctx.strokeRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12);
  ctx.setLineDash([]);
  ctx.fillStyle = "#fbf8f1";
  ctx.strokeStyle = "#e0764e";
  ctx.beginPath();
  ctx.arc(b.x + b.w + 6, b.y + b.h + 6, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function forget(id: string) {
  cache.delete(id);
}
