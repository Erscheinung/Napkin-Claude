#!/usr/bin/env node
// Regenerates docs/screenshots/*.png from a scripted demo (never touches your real napkins):
// an isolated NAPKIN_DATA_DIR, a fake CLAUDE_CONFIG_DIR for "recent projects", a demo project
// with two scribbles of real file changes recorded through the real `napkin hook`.
//
//   npm run screens      (needs a debug build and the vite dev server, like the gate)

import { spawn, spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, utimesSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const out = join(root, "scripts/fidelity/out");
const demo = join(out, "demo");
const shots = join(root, "docs/screenshots");
const bin = join(root, "src-tauri/target/debug/napkin");
const tool = join(out, "measure");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portOpen = (port) =>
  new Promise((res) => {
    const s = createConnection(port, "127.0.0.1", () => (s.end(), res(true)));
    s.on("error", () => res(false));
  });

rmSync(demo, { recursive: true, force: true });
mkdirSync(shots, { recursive: true });
const w = (p, s) => (mkdirSync(dirname(p), { recursive: true }), writeFileSync(p, s));

// ── demo project ───────────────────────────────────────────────────────
const proj = join(demo, "code/weather-cli");
w(join(proj, "package.json"), `{\n  "name": "weather-cli",\n  "version": "0.3.0",\n  "bin": { "weather": "src/index.js" }\n}\n`);
w(join(proj, "README.md"), "# weather-cli\n\nTiny weather in your terminal.\n");
w(join(proj, "src/index.js"), `#!/usr/bin/env node\nimport { forecast } from "./forecast.js";\n\nconst city = process.argv[2] ?? "Lisbon";\nconst f = await forecast(city);\nconsole.log(\`\${city}: \${f.temp}°C, \${f.sky}\`);\n`);
w(join(proj, "src/forecast.js"), `export async function forecast(city) {\n  const r = await fetch(\`https://wttr.in/\${city}?format=j1\`);\n  const j = await r.json();\n  return { temp: j.current_condition[0].temp_C, sky: j.current_condition[0].weatherDesc[0].value };\n}\n`);
for (const p of ["code/lemonade-stand", "code/penpal", "Documents/recipes"]) mkdirSync(join(demo, p), { recursive: true });

// ── fake Claude history so the sidebar has neighbours ──────────────────
const claudeDir = join(demo, "claude");
const now = Date.now();
[
  ["code/lemonade-stand", "make the lemonade stand site cuter", 40, 4],
  ["code/weather-cli", "add a --units flag", 6, 2],
  ["code/penpal", "pen pal matching by timezone", 180, 31],
  ["Documents/recipes", "scale recipes by servings", 2880, 12],
].forEach(([rel, prompt, minsAgo, n]) => {
  const cwd = join(demo, rel);
  const dir = join(claudeDir, "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"));
  for (let i = 0; i < n; i++) {
    const f = join(dir, `${randomUUID()}.jsonl`);
    w(f, JSON.stringify({ type: "user", cwd, message: { role: "user", content: prompt } }) + "\n");
    const t = (now - (minsAgo + i * 30) * 60_000) / 1000;
    utimesSync(f, t, t);
  }
});

// (the throwaway config means Claude Code shows its first-run theme picker — it looks lovely on paper)

// ── a napkin with two scribbles, recorded through the real hook ─────────
const home = join(demo, "data");
const id = "d3m0d3m0-0000-4000-8000-000000000001";
const env = { ...process.env, NAPKIN_HOME: home, NAPKIN_ID: id, NAPKIN_PROJECT: proj, NAPKIN_TRACK: "1" };
const hook = (ev) => spawnSync(bin, ["hook"], { input: JSON.stringify(ev), env });
const log = join(home, "napkins", id, "events.jsonl");
const lastCp = () => JSON.parse(readFileSync(log, "utf8").trim().split("\n").at(-1)).cp;

hook({ hook_event_name: "Stop" });
const boundary = lastCp();
writeFileSync(log, JSON.stringify({ t: now - 9 * 60_000, ev: "boundary", cp: boundary, label: "napkin laid down" }) + "\n");

hook({ hook_event_name: "UserPromptSubmit", prompt: "add a --units flag so I can get fahrenheit" });
w(join(proj, "src/units.js"), `export const toF = (c) => Math.round((c * 9) / 5 + 32);\nexport const parseUnits = (argv) => (argv.includes("--units=f") ? "f" : "c");\n`);
w(join(proj, "src/index.js"), `#!/usr/bin/env node\nimport { forecast } from "./forecast.js";\nimport { parseUnits, toF } from "./units.js";\n\nconst city = process.argv[2] ?? "Lisbon";\nconst units = parseUnits(process.argv);\nconst f = await forecast(city);\nconst temp = units === "f" ? \`\${toF(f.temp)}°F\` : \`\${f.temp}°C\`;\nconsole.log(\`\${city}: \${temp}, \${f.sky}\`);\n`);
hook({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: join(proj, "src/units.js") } });
hook({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: join(proj, "src/index.js") } });
hook({ hook_event_name: "Stop" });

hook({ hook_event_name: "UserPromptSubmit", prompt: "and draw a tiny ascii sun when it's clear ☀" });
w(join(proj, "src/sun.js"), `export const sun = String.raw\`\n   \\\\ | /\n  -- o --\n   / | \\\\\n\`;\n`);
w(join(proj, "README.md"), "# weather-cli\n\nTiny weather in your terminal.\n\n    weather Lisbon --units=f\n");
hook({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: join(proj, "src/sun.js") } });
hook({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: join(proj, "README.md") } });
hook({ hook_event_name: "Stop" });
hook({ hook_event_name: "Notification", message: "Claude needs your permission to use Bash", notification_type: "permission_prompt" });

w(join(home, "napkins.json"), JSON.stringify([
  { id, title: "weather cli", project: proj, session_id: randomUUID(), created_at: now - 9 * 60_000, updated_at: now - 60_000, boundary, tracking: true, tracking_note: null, archived: false },
], null, 2));

// a sketch on the napkin
w(join(proj, ".napkin/sketches/cli-flow.napkin.json"), JSON.stringify({
  version: 1, name: "cli flow", shapes: [
    { id: "a", kind: "rect", x: 60, y: 70, w: 190, h: 80, text: "weather <city>", color: "#35322e", seed: 11 },
    { id: "b", kind: "diamond", x: 330, y: 50, w: 170, h: 120, text: "--units=f ?", color: "#35322e", seed: 12 },
    { id: "c", kind: "arrow", x: 250, y: 110, w: 80, h: 0, color: "#35322e", seed: 13 },
    { id: "d", kind: "ellipse", x: 590, y: 20, w: 170, h: 80, text: "°F", color: "#e0764e", seed: 14, fill: true },
    { id: "e", kind: "ellipse", x: 590, y: 150, w: 170, h: 80, text: "°C", color: "#2c47a3", seed: 15 },
    { id: "f", kind: "arrow", x: 500, y: 100, w: 90, h: -40, text: "yes", color: "#35322e", seed: 16 },
    { id: "g", kind: "arrow", x: 500, y: 120, w: 90, h: 60, text: "no", color: "#35322e", seed: 17 },
    { id: "h", kind: "pen", x: 0, y: 0, w: 0, h: 0, color: "#b8392b", seed: 18, points: [[840, 110], [852, 96], [870, 92], [888, 100], [896, 116], [888, 132], [870, 138], [852, 132], [842, 118]] },
    { id: "i", kind: "text", x: 800, y: 150, w: 150, h: 28, text: "a tiny sun\nwhen it's clear", color: "#b8392b", seed: 19 },
    { id: "j", kind: "text", x: 60, y: 290, w: 300, h: 28, text: "keep output to one line", color: "#5f5a52", seed: 20 },
  ],
}, null, 1));

// ── capture ────────────────────────────────────────────────────────────
let vite;
if (!(await portOpen(1420))) {
  vite = spawn("npx", ["vite", "--port", "1420", "--strictPort"], { cwd: root, stdio: "ignore" });
  for (let i = 0; i < 60 && !(await portOpen(1420)); i++) await sleep(250);
}
if (!existsSync(tool)) execFileSync("swiftc", ["-O", join(root, "scripts/fidelity/measure.swift"), "-o", tool]);

const live = new Set();
const reap = () => live.forEach((p) => p.kill());
process.on("exit", reap);
process.on("SIGINT", () => process.exit(130));

async function shoot(fixture, file, wait, attempt = 1) {
  const p = spawn(bin, [], {
    env: { ...process.env, NAPKIN_DATA_DIR: home, CLAUDE_CONFIG_DIR: claudeDir, NAPKIN_FIXTURE: fixture, NAPKIN_FIXTURE_OUT: join(out, "screens-layout.json") },
    stdio: "ignore",
  });
  live.add(p);
  let ok = false;
  try {
    let wid = "";
    for (let i = 0; i < 60 && !wid; i++) {
      await sleep(250);
      try {
        wid = execFileSync(tool, ["window", String(p.pid)]).toString().trim();
      } catch {}
    }
    if (!wid) throw new Error(`no window for ${fixture}`);
    await sleep(wait);
    const png = join(out, file);
    execFileSync("/usr/sbin/screencapture", ["-x", "-o", "-l", wid, png]);
    // a webview that never painted comes out near-black; paper is bright
    const [probe] = JSON.parse(execFileSync(tool, ["stats", png, "900,400,300,200"]).toString());
    ok = probe.r > 120;
    if (ok) {
      // textured paper compresses poorly as PNG: README gets a 1800px JPEG
      execFileSync("/usr/bin/sips", ["-Z", "1800", "-s", "format", "jpeg", "-s", "formatOptions", "84", png, "--out", join(shots, file.replace(/\.png$/, ".jpg"))], { stdio: "ignore" });
      console.log("✓", file);
    }
  } finally {
    p.kill(); // the app's claude child exits when its PTY closes
    live.delete(p);
    await sleep(800);
  }
  if (!ok) {
    if (attempt >= 3) throw new Error(`${file}: window never painted`);
    console.log("… retrying", file);
    return shoot(fixture, file, wait + 2000, attempt + 1);
  }
}

await shoot(`open:${id}:talk`, "talk.png", 7000);
await shoot(`open:${id}:talk:diff`, "ink-spill.png", 6000);
await shoot(`open:${id}:sketch`, "sketch.png", 3000);
await shoot(`open:${id}:talk:palette`, "palette.png", 4000);
await shoot(`open:${id}:talk:crumple`, "crumple.png", 6000);
await shoot("reference", "home.png", 3000);
vite?.kill();
