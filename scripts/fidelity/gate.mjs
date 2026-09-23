#!/usr/bin/env node
// Fidelity gate (docs/DESIGN.md §5). Renders the reference fixture in the real app,
// captures only the Napkin window, and checks color / texture / layout against
// docs/reference.png. Exits non-zero on failure.
//
//   npm run gate            (needs `cargo build` once; starts vite if it isn't running)

import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const out = join(root, "scripts/fidelity/out");
const tool = join(out, "measure");
const ref = join(root, "docs/reference.png");
mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portOpen = (port) =>
  new Promise((res) => {
    const s = createConnection(port, "127.0.0.1", () => (s.end(), res(true)));
    s.on("error", () => res(false));
  });

// 1. measuring tool
const src = join(root, "scripts/fidelity/measure.swift");
if (!existsSync(tool) || statSync(tool).mtimeMs < statSync(src).mtimeMs) {
  execFileSync("swiftc", ["-O", src, "-o", tool], { stdio: "inherit" });
}

// 2. app in fixture mode (debug binary talks to the vite dev server)
let vite;
if (!(await portOpen(1420))) {
  vite = spawn("npx", ["vite", "--port", "1420", "--strictPort"], { cwd: root, stdio: "ignore" });
  for (let i = 0; i < 60 && !(await portOpen(1420)); i++) await sleep(250);
}
const bin = join(root, "src-tauri/target/debug/napkin");
if (!existsSync(bin)) throw new Error("build the app first: (cd src-tauri && cargo build)");
const layoutFile = join(out, "layout.json");
rmSync(layoutFile, { force: true });
const appProc = spawn(bin, [], {
  env: { ...process.env, NAPKIN_FIXTURE: "reference", NAPKIN_FIXTURE_OUT: layoutFile },
  stdio: "ignore",
});
const cleanup = () => {
  appProc.kill();
  vite?.kill();
};
process.on("exit", cleanup);

for (let i = 0; i < 80 && !existsSync(layoutFile); i++) await sleep(250);
if (!existsSync(layoutFile)) throw new Error("fixture never reported its layout");
await sleep(400);

// 3. capture just this window
const wid = execFileSync(tool, ["window", String(appProc.pid)]).toString().trim();
const shot = join(out, "napkin.png");
execFileSync("/usr/sbin/screencapture", ["-x", "-o", "-l", wid, shot]);
execFileSync(tool, ["sbs", ref, shot, join(out, "side-by-side.png")]);

// 4. checks
const PATCHES = {
  desk: [1250, 1010, 180, 120],
  napkin: [1450, 140, 380, 170],
  pad: [60, 880, 270, 55],
  notebook: [760, 748, 380, 40],
};
const stats = (img) =>
  JSON.parse(execFileSync(tool, ["stats", img, ...Object.values(PATCHES).map((p) => p.join(","))]).toString());
const [a, b] = [stats(ref), stats(shot)];

const results = [];
const check = (gate, name, ok, detail) => results.push({ gate, name, ok, detail });
Object.keys(PATCHES).forEach((name, i) => {
  const r = a[i], m = b[i];
  const d = Math.max(Math.abs(r.r - m.r), Math.abs(r.g - m.g), Math.abs(r.b - m.b));
  check("G1 color", name, d <= 8, `Δmax ${d.toFixed(1)} (ref ${[r.r, r.g, r.b].map(Math.round)} vs ${[m.r, m.g, m.b].map(Math.round)})`);
  check("G2 quiet", name, m.fine <= r.fine * 1.6 + 1, `σ ${m.fine.toFixed(2)} vs ref ${r.fine.toFixed(2)}`);
  check("G3 streaks", name, m.low <= r.low * 1.5 + 1, `lowσ ${m.low.toFixed(2)} vs ref ${r.low.toFixed(2)}`);
});

// reference rects in window points (reference px ÷ 1.25 on a 1600×1000 window)
const REF = {
  sidebar: [13.6, 44, 276.8, 940],
  hero: [380.8, 64, 1131.2, 486.4],
  recent: [380.8, 592, 555.2, 337.6],
  card: [993.6, 654.4, 241.6, 125.6],
  title: [598.4, null, 502.4, null],
  primary: [608, 289.6, 246.4, 49.6],
};
const layout = JSON.parse(readFileSync(layoutFile, "utf8"));
const { w: vw, h: vh } = layout.viewport;
for (const [id, want] of Object.entries(REF)) {
  const got = layout.rects.find((r) => r.id === id);
  if (!got) {
    check("G4 layout", id, false, "missing");
    continue;
  }
  const errs = [got.x, got.y, got.w, got.h].map((v, k) =>
    want[k] === null ? 0 : Math.abs(v - want[k]) / (k % 2 === 0 ? vw : vh),
  );
  const worst = Math.max(...errs);
  check("G4 layout", id, worst <= 0.03, `worst edge off by ${(worst * 100).toFixed(1)}% · got ${[got.x, got.y, got.w, got.h].map(Math.round)}`);
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.gate.padEnd(11)} ${r.name.padEnd(9)} ${r.detail}`);
}
console.log(`\nG5 eyeball: review ${join("scripts/fidelity/out", "side-by-side.png")} against P1–P10 in docs/DESIGN.md`);
console.log(failed ? `\n✗ gate failed (${failed})` : "\n✓ automatic gates passed");
cleanup();
process.exit(failed ? 1 : 0);
