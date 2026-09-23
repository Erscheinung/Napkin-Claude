# CLAUDE.md

Napkin is a paper-napkin skin for Claude Code on macOS: a Tauri 2 app that runs the real
`claude` CLI in a PTY. Every session is a disposable, inspectable "napkin" with an ink spill
panel (what changed + rollback) and a sketch canvas. See PLAN.md for the checkpoints and
docs/DESIGN.md for the visual principles.

## Commands

```bash
npm install                      # once
npm run app                      # dev: vite + cargo run (hot reload for the UI)
npm run check                    # svelte-check (TypeScript + Svelte)
(cd src-tauri && cargo test)     # snapshot/rollback + helpers
npm run gate                     # visual fidelity gate vs docs/reference.png (needs a debug build)
npm run bundle                   # release .app + .dmg in src-tauri/target/release/bundle
./scripts/install.sh             # build and copy Napkin.app to /Applications
```

## Layout

- `src-tauri/src/`
  - `pty.rs`: portable-pty sessions; raw bytes to the UI over a Tauri `Channel`, batched ~3 ms
  - `snapshot.rs`: shadow git (own `GIT_DIR` per project, own `GIT_INDEX_FILE` per napkin); never touches the user's `.git`
  - `hook.rs`: `napkin hook` / `napkin statusline` subcommands of the same binary, injected with `claude --settings`
  - `events.rs`: per-napkin `events.jsonl`, tailed by one poller thread → `napkin-events`
  - `sessions.rs`: reads `~/.claude/projects` (recent projects, resume)
  - `envprobe.rs`: login-shell env capture (GUI apps don't get the shell PATH)
  - `sketches.rs`: `<project>/.napkin/sketches/` (self-ignoring dir)
- `src/`: Svelte 5 (runes). `lib/state.svelte.ts` is the single app store; `lib/terminals.svelte.ts`
  keeps one xterm per napkin outside reactivity; `lib/rough.ts` has the pen strokes (rough.js).

## Rules of the house

- Never re-implement Claude Code. Skin it, observe it through hooks, and diff the disk.
- Hooks must always exit 0 and print nothing (except `statusline`, which passes through the user's own).
- The app is the only writer of `napkins.json`; everything that happens *during* a napkin goes to its event log.
- UI copy uses napkin words: ink spill (changes), fold (checkpoint), erase (revert), wipe clean (roll back all), scribbles (turns), crumple (close).
- Any visual change has to pass `npm run gate` and the P1–P10 review in docs/DESIGN.md. The paper stays quiet and the ink does the talking.
- Keep it light: no new runtime deps without a reason; no Electron-isms.

## Credit

Original idea and reference design: Kevin Ngo (see README).
