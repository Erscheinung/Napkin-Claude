// What Claude actually reads: an ASCII rendering (TempleOS-style: the drawing lives in
// the text) plus a shape list with names, boxes and which shapes the arrows connect.

import { bounds, docBounds, inkName, type Shape, type SketchDoc } from "./model";

const CW = 10; // px per ASCII column
const CH = 20; // px per ASCII row

export function toAscii(shapes: Shape[]): string {
  const box = docBounds(shapes, 10);
  const cols = Math.min(160, Math.max(10, Math.ceil(box.w / CW)));
  const rows = Math.min(80, Math.max(4, Math.ceil(box.h / CH)));
  const grid: string[][] = Array.from({ length: rows }, () => Array(cols).fill(" "));
  const put = (c: number, r: number, ch: string, force = true) => {
    c = Math.round(c);
    r = Math.round(r);
    if (r < 0 || r >= rows || c < 0 || c >= cols) return;
    if (force || grid[r][c] === " ") grid[r][c] = ch;
  };
  const C = (x: number) => (x - box.x) / CW;
  const R = (y: number) => (y - box.y) / CH;

  const segment = (x1: number, y1: number, x2: number, y2: number, force?: string) => {
    const [c1, r1, c2, r2] = [C(x1), R(y1), C(x2), R(y2)];
    const steps = Math.max(Math.abs(c2 - c1), Math.abs(r2 - r1), 1);
    const dc = c2 - c1, dr = r2 - r1;
    const ch = force ?? (Math.abs(dr) < Math.abs(dc) * 0.4 ? "─" : Math.abs(dc) < Math.abs(dr) * 0.4 ? "│" : dc * dr > 0 ? "╲" : "╱");
    for (let i = 0; i <= steps; i++) put(c1 + (dc * i) / steps, r1 + (dr * i) / steps, ch, false);
  };

  for (const s of shapes) {
    const b = bounds(s);
    const [c0, r0, c1, r1] = [C(b.x), R(b.y), C(b.x + b.w), R(b.y + b.h)].map(Math.round);
    switch (s.kind) {
      case "rect":
      case "ellipse": {
        const round = s.kind === "ellipse";
        for (let c = c0 + 1; c < c1; c++) (put(c, r0, "─"), put(c, r1, "─"));
        for (let r = r0 + 1; r < r1; r++) (put(c0, r, round ? "(" : "│"), put(c1, r, round ? ")" : "│"));
        put(c0, r0, round ? "╭" : "┌"), put(c1, r0, round ? "╮" : "┐");
        put(c0, r1, round ? "╰" : "└"), put(c1, r1, round ? "╯" : "┘");
        break;
      }
      case "diamond": {
        const cx = (b.x + b.w / 2), cy = (b.y + b.h / 2);
        segment(cx, b.y, b.x + b.w, cy, "╲");
        segment(b.x + b.w, cy, cx, b.y + b.h, "╱");
        segment(cx, b.y + b.h, b.x, cy, "╲");
        segment(b.x, cy, cx, b.y, "╱");
        put(C(b.x), R(cy), "<");
        put(C(b.x + b.w), R(cy), ">");
        break;
      }
      case "line":
      case "arrow": {
        segment(s.x, s.y, s.x + s.w, s.y + s.h);
        if (s.kind === "arrow") {
          const a = Math.atan2(s.h, s.w);
          const head = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? (s.w > 0 ? "▶" : "◀") : s.h > 0 ? "▼" : "▲";
          put(C(s.x + s.w), R(s.y + s.h), head);
        }
        break;
      }
      case "pen": {
        const pts = s.points ?? [];
        for (let i = 1; i < pts.length; i++) {
          const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
          const steps = Math.max(1, Math.ceil(Math.hypot(C(x2) - C(x1), R(y2) - R(y1))));
          for (let k = 0; k <= steps; k++) put(C(x1 + ((x2 - x1) * k) / steps), R(y1 + ((y2 - y1) * k) / steps), "·", false);
        }
        break;
      }
    }
  }
  // labels last so they sit on top of the lines
  for (const s of shapes) {
    if (!s.text) continue;
    const b = bounds(s);
    const lines = s.text.split("\n");
    lines.forEach((line, i) => {
      const text = line.slice(0, cols);
      let c: number, r: number;
      if (s.kind === "text") {
        c = C(b.x);
        r = R(b.y) + i;
      } else if (s.kind === "line" || s.kind === "arrow") {
        c = C(s.x + s.w / 2) - text.length / 2;
        r = R(s.y + s.h / 2) - 1 + i;
      } else {
        c = C(b.x + b.w / 2) - text.length / 2;
        r = R(b.y + b.h / 2) - (lines.length - 1) / 2 + i;
      }
      [...text].forEach((ch, k) => put(c + k, r, ch));
    });
  }
  return grid
    .map((row) => row.join("").replace(/\s+$/, ""))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

function label(s: Shape, i: number) {
  return s.text?.trim() ? `“${s.text.trim().replace(/\n/g, " / ")}”` : `#${i + 1}`;
}

function containing(shapes: Shape[], x: number, y: number, except: Shape) {
  let best: { s: Shape; i: number; area: number } | null = null;
  shapes.forEach((s, i) => {
    if (s === except || s.kind === "line" || s.kind === "arrow" || s.kind === "pen") return;
    const b = bounds(s);
    const pad = 14;
    if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) {
      const area = b.w * b.h;
      if (!best || area < best.area) best = { s, i, area };
    }
  });
  return best as { s: Shape; i: number } | null;
}

export function toSpec(doc: SketchDoc, pngRel: string | null): string {
  const { shapes } = doc;
  const box = docBounds(shapes, 0);
  const lines: string[] = [];
  lines.push(`# Napkin sketch: ${doc.name}`, "");
  lines.push(
    "A hand-drawn sketch from the user's napkin. Treat it as a rough intent (layout, flow,",
    "relationships), not pixel-exact. Coordinates are px, origin at the top-left of the drawing.",
  );
  if (pngRel) lines.push("", `Picture: \`${pngRel}\` (open it with the Read tool to see the drawing).`);
  lines.push("", "## Drawing", "", "```text", toAscii(shapes), "```", "", "## Shapes", "");
  shapes.forEach((s, i) => {
    const b = bounds(s);
    const at = `(${Math.round(b.x - box.x)}, ${Math.round(b.y - box.y)})`;
    const size = `${Math.round(b.w)}×${Math.round(b.h)}`;
    const ink = inkName(s.color);
    if (s.kind === "line" || s.kind === "arrow") {
      const from = containing(shapes, s.x, s.y, s);
      const to = containing(shapes, s.x + s.w, s.y + s.h, s);
      const a = from ? label(from.s, from.i) : `(${Math.round(s.x - box.x)}, ${Math.round(s.y - box.y)})`;
      const z = to ? label(to.s, to.i) : `(${Math.round(s.x + s.w - box.x)}, ${Math.round(s.y + s.h - box.y)})`;
      lines.push(`${i + 1}. ${s.kind} ${a} ${s.kind === "arrow" ? "→" : "—"} ${z}${s.text ? ` labelled “${s.text}”` : ""} (${ink})`);
    } else if (s.kind === "pen") {
      lines.push(`${i + 1}. freehand scribble at ${at}, ${size} (${ink})`);
    } else if (s.kind === "text") {
      lines.push(`${i + 1}. note ${label(s, i)} at ${at} (${ink})`);
    } else {
      lines.push(`${i + 1}. ${s.kind} ${label(s, i)} at ${at}, ${size}${s.fill ? ", filled" : ""} (${ink})`);
    }
  });
  if (!shapes.length) lines.push("(empty napkin)");
  return lines.join("\n") + "\n";
}
