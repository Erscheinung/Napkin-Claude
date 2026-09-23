# Napkin — implementation plan

A paper-napkin skin for Claude Code on macOS. Every session is a **napkin**: cheap to start,
easy to inspect, and easy to throw away. Idea credit: Kevin Ngo
([original post](https://x.com/claudeai/status/2102471874110533750?s=20)).

## Goals

1. **Fast and stable.** Opens instantly, stays light on memory, and never hides what Claude
   Code prints. The real `claude` CLI runs in a real PTY. We skin it and never re-implement it.
2. **Disposable napkins.** Starting a session costs nothing, and throwing one away
   ("crumple") can undo everything it did.
3. **Inspectable blast radius.** Always show which files changed, which ones Claude touched
   itself, the per-turn diffs, and a one-click rollback boundary.
4. **Sketching.** A playful hand-drawn canvas (in the spirit of TempleOS's inline drawings)
   whose shapes become references Claude can read, and which Claude can draw back onto.
5. **Easy install.** One command to build and install, plus a `.dmg` from CI.

## Architecture decision

| Option | Verdict |
|---|---|
| Pure TUI (Ink / Bubble Tea / ratatui) wrapping `claude` | ✗ Paper textures and handwriting fonts are impossible. We'd also have to embed a VT emulator inside a TUI, which is fragile. |
| Electron + React | ✗ ~150 MB and a heavy runtime. Too much for a skin. |
| Native Swift + SwiftTerm | ~ The lightest option, but the UI work is slow, and custom paper/sketch rendering is painful. |
| **Tauri 2 + Svelte 5 + xterm.js + Rust PTY** | ✓ ~10 MB app using the system WebView. Svelte compiles away, so there's no runtime. xterm.js with WebGL is the same terminal core VS Code uses. Rust owns the PTY, snapshots, and hooks. |

Svelte *does* help here. It's a UI layer (WebView), not a terminal UI, and it compiles to
tiny vanilla JS with fine-grained reactivity. That keeps the chrome cheap next to a busy terminal.

```
┌──────────────────────── Napkin.app (Tauri) ────────────────────────┐
│  WebView: Svelte 5                                                 │
│   ├ Home (desk, recent projects, napkins on the table)             │
│   ├ Napkin view: xterm.js ◀─ raw bytes ─┐   Blast-radius panel     │
│   └ Sketch canvas (rough.js) → PNG + ASCII + shape spec            │
│                                         │                          │
│  Rust core                              │                          │
│   ├ pty.rs      portable-pty ── spawns `claude --session-id …`     │
│   ├ snapshot.rs shadow git (own GIT_DIR, never touches your .git)  │
│   ├ events.rs   tails per-napkin events.jsonl → UI                 │
│   ├ sessions.rs reads ~/.claude/projects for recents/resume        │
│   └ hook.rs     `napkin hook` subcommand (same binary)             │
└─────────────────────────────────────────▲──────────────────────────┘
                                          │ Claude Code hooks (injected via --settings)
          UserPromptSubmit → snapshot "before turn N" (blocking, so it's consistent)
          PostToolUse(Write|Edit|MultiEdit|NotebookEdit) → touched files
          Stop → snapshot "after turn N", status=done · Notification → status=needs you
```

### Key design choices

- **Shadow git for rollback.** Each project gets `~/Library/Application Support/<app>/shadow/<hash>.git`,
  with `GIT_WORK_TREE=<project>`, and each napkin gets its own `GIT_INDEX_FILE`. Your repo, index, and
  stash are never touched. Snapshots are `add -A → write-tree → commit-tree` and are pinned by
  refs under `refs/napkin/<id>/`. Sensible default excludes apply (node_modules, target, .napkin, …)
  on top of your `.gitignore`.
- **Hooks are the source of truth for events.** They're injected per session with
  `claude --settings '<json>'`, so user settings are never modified. The hook runs the Napkin
  binary itself (`<exe> hook`), so there's no python/jq dependency. It appends one compact
  JSON line to `napkins/<id>/events.jsonl`. The app is the only writer of `napkins.json`.
- **Diff is the source of truth for changes.** Hooks only see file-editing tools, and Bash can
  change anything, so the "what changed" list comes from diffing the boundary against the
  current tree. Files Claude edited directly get a ✎ badge.
- **Raw PTY bytes over a Tauri `Channel`,** with no JSON/base64 per chunk, written straight into
  xterm (UTF-8 decoding stays in xterm).
- **PATH fix-up.** GUI apps don't inherit your shell PATH, so we probe `$SHELL -l -i` once at
  startup and cache `PATH` and the `claude` location.
- **One WebGL context at a time.** Only the visible terminal gets the WebGL renderer. Hidden napkins
  keep running but render nothing.

## Checkpoints

Each checkpoint ends in a working, committed state.

- [x] **CP0 — Foundations.** git repo, PLAN.md, CLAUDE.md, README with credit, Tauri 2 + Svelte 5 scaffold that builds.
- [x] **CP1 — A napkin is a real terminal.** PTY spawn/resize/write/kill, xterm paper theme, multiple
      napkins alive at once, drag-and-drop file paths, PATH probe, Claude version on home.
- [x] **CP2 — The desk.** Home screen from the reference (sidebar, hero, recent projects, on the table),
      napkin persistence, resume last / continue / new napkin in folder, ⌘N ⌘O ⌘1-9 ⌘W.
- [x] **CP3 — Blast radius.** Shadow-git boundary at napkin start, hook-injected events, live status
      (working / needs you / done), changed-files list with +/−, diff viewer, per-turn checkpoints,
      rollback to any checkpoint (itself undoable), per-file revert, crumple dialog.
- [x] **CP4 — Sketch napkin.** rough.js canvas (rect / ellipse / diamond / line / arrow / pen / text), select,
      move, label, undo, and saving to `<project>/.napkin/sketches/` (self-ignoring dir). "Send to Claude"
      exports PNG + ASCII + a shape spec (names, boxes, arrows between shapes) and pastes an
      `@`-reference into the prompt.
- [x] **CP5 — Claude draws back.** Opt-in appended system prompt tells Claude the `.napkin.json`
      shape schema. The app reloads sketches when Claude writes them.
- [x] **CP6 — Ship it.** `scripts/install.sh` (build and copy to /Applications), GitHub Actions
      release (universal `.dmg`), README install docs, Gatekeeper notes.
- [~] **CP7 — Polish.** Done: ⌘K palette, settings (terminal ink size, doodle-back), "the tab" usage
      meter (statusline `rate_limits`), coffee ring. Next: hand-test Windows/Linux, notarized macOS
      builds, drag-to-reorder napkins, sketch pan/zoom persistence.
- [x] **CP8 — Fidelity.** Reference-sampled material library + two-sided fidelity gate (docs/DESIGN.md).

## Risks and mitigations

- **Huge folders (for example `~`).** Snapshotting is disabled when the project is `$HOME` or `/`,
  or when the untracked-file walk exceeds 50k files. The UI then shows "tracking off".
- **Claude Code's dark theme on paper.** xterm `minimumContrastRatio` keeps text readable. The docs
  recommend `/theme → Light (ANSI only)` for the best-looking result.
- **Hook failures.** The hook always exits 0 and never prints, so a Napkin bug can't block Claude.
- **Rollback deletes files added since the checkpoint.** A pre-rollback snapshot is always taken
  first, so every rollback can be undone.
