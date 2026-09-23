// Sketch documents: the `.napkin.json` format Napkin saves (and Claude may write back).

export type Kind = "rect" | "ellipse" | "diamond" | "line" | "arrow" | "pen" | "text";

export type Shape = {
  id: string;
  kind: Kind;
  /** boxes: top-left + size. line/arrow: start point + delta. pen: bounding box of points. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** pen strokes, absolute coordinates */
  points?: [number, number][];
  /** label inside a shape, or the words of a text shape */
  text?: string;
  color: string;
  fill?: boolean;
  seed: number;
};

export type SketchDoc = { version: 1; name: string; shapes: Shape[] };

export const INKS = [
  { name: "graphite", value: "#35322e" },
  { name: "clay", value: "#e0764e" },
  { name: "red", value: "#b8392b" },
  { name: "blue", value: "#2c47a3" },
  { name: "green", value: "#2f6b34" },
];

export const BOXY: Kind[] = ["rect", "ellipse", "diamond", "text"];

export function newId() {
  return Math.random().toString(36).slice(2, 10);
}

export function emptyDoc(name: string): SketchDoc {
  return { version: 1, name, shapes: [] };
}

/** Accepts anything shaped roughly right (Claude-written files included) and normalizes it. */
export function parseDoc(raw: string, fallbackName: string): SketchDoc {
  const d = JSON.parse(raw);
  const shapes: Shape[] = (Array.isArray(d?.shapes) ? d.shapes : []).flatMap((s: any): Shape[] => {
    const kind = s?.kind as Kind;
    if (!["rect", "ellipse", "diamond", "line", "arrow", "pen", "text"].includes(kind)) return [];
    const num = (v: unknown, dflt = 0) => (typeof v === "number" && Number.isFinite(v) ? v : dflt);
    return [
      {
        id: typeof s.id === "string" ? s.id : newId(),
        kind,
        x: num(s.x),
        y: num(s.y),
        w: num(s.w, kind === "text" ? 120 : 0),
        h: num(s.h, kind === "text" ? 30 : 0),
        points: Array.isArray(s.points) ? s.points.filter((p: any) => Array.isArray(p) && p.length === 2) : undefined,
        text: typeof s.text === "string" ? s.text : typeof s.label === "string" ? s.label : undefined,
        color: typeof s.color === "string" ? s.color : INKS[0].value,
        fill: !!s.fill,
        seed: num(s.seed, Math.floor(Math.random() * 2 ** 31)),
      },
    ];
  });
  return { version: 1, name: typeof d?.name === "string" ? d.name : fallbackName, shapes };
}

/** Normalized box (positive width/height) for any shape. */
export function bounds(s: Shape) {
  if (s.kind === "pen" && s.points?.length) {
    const xs = s.points.map((p) => p[0]);
    const ys = s.points.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  const x = Math.min(s.x, s.x + s.w);
  const y = Math.min(s.y, s.y + s.h);
  return { x, y, w: Math.abs(s.w), h: Math.abs(s.h) };
}

export function docBounds(shapes: Shape[], margin = 24) {
  if (!shapes.length) return { x: 0, y: 0, w: 400, h: 240 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of shapes) {
    const b = bounds(s);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0 - margin, y: y0 - margin, w: x1 - x0 + margin * 2, h: y1 - y0 + margin * 2 };
}

/** Hit test in doc coordinates; topmost first. */
export function hit(shapes: Shape[], px: number, py: number): Shape | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.kind === "line" || s.kind === "arrow") {
      if (distToSegment(px, py, s.x, s.y, s.x + s.w, s.y + s.h) < 8) return s;
      continue;
    }
    if (s.kind === "pen") {
      const pts = s.points ?? [];
      for (let k = 1; k < pts.length; k++) {
        if (distToSegment(px, py, pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]) < 7) return s;
      }
      continue;
    }
    const b = bounds(s);
    if (px >= b.x - 4 && px <= b.x + b.w + 4 && py >= b.y - 4 && py <= b.y + b.h + 4) return s;
  }
  return null;
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function inkName(color: string) {
  return INKS.find((i) => i.value === color)?.name ?? color;
}
