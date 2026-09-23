# Napkin design principles and the fidelity gate

The look is defined by `docs/reference.png` (Kevin Ngo's original concept). These are the
principles taken from studying it at full resolution. Any UI change has to pass the gate at
the bottom before it's committed.

## 0. Sample, don't synthesize

The reference is a *painted* image. Every surface is real paper, and every line is a pencil or
marker stroke with grain and pressure. Vector UI with effects layered on top always reads as
bland and geometric next to it. So the reference itself is the material library:
`scripts/fidelity/extract-assets.sh` samples it into `src/assets/ref/`:

- **paper:** mirror-tiled, seamless napkin / notebook / desk tiles, plus the ruled pad as one exact line period
- **sheets:** the napkin's and cards' own edges as 9-slice frames (deckle, stitched pressed border, lifted corner, shadow)
- **ink:** buttons and keys (9-slice, text wiped), underlines, link strokes, wave and zigzag dividers, check, folder
- **marks:** the torn pad top with its glue, the coffee ring, the marker headline, the four mascot moods

Ink sprites are lifted off their paper (color-to-alpha), so they composite onto any surface.
Tiles get a small contrast boost to offset upscaling a 1× sample on 2× screens (calibrated by
G2/G3). Only what must be dynamic (text, variable lengths) is rendered live.

## 1. The paper is quiet, and the ink is loud

| Principle | What the reference does | Anti-pattern (what went wrong before) |
|---|---|---|
| **P1 Quiet but alive paper** | Fine isotropic grain (σ ≈ 1.5–4) with soft crumple (low-frequency σ ≈ 1–4). There are no hard creases. | Directional "crinkle" streaks, tiling seams, *and* dead-flat vector fills |
| **P2 Surfaces differ by hue, not by texture** | measured means: napkin `rgb(249,245,238)` · pad `rgb(250,247,232)` ruled · notebook `rgb(247,240,220)` · desk `rgb(221,212,197)` | One paper color everywhere with heavy texture on top |
| **P3 Papers lie flat** | Shadows are short and soft (≈2–6 px blur, ≤10% alpha). Nothing floats. | Big drop shadows; tilted cards |
| **P4 Edges are fibrous, not torn** | Napkin edges are softly feathered with ±1–2 px irregularity. Only the pad has a torn top, with a pinkish binding strip. | Displacement big enough to warp whole sheets |
| **P5 Stitched pressed border** | The napkin has an embossed double line ~30 px in with a row of tiny pressed dots between the lines. Cards have a lighter version at ~12 px. | Hard gray frames; clean CSS borders |

## 2. Everything is drawn with a pen

| Principle | Reference detail |
|---|---|
| **P6 Rough double strokes** | Buttons are two rough rounded rectangles ~5 px apart, pencil-weight (≈1.5–2 px), drawn in the fill's accent color. The inner fill is flat. |
| **P7 Hand underlines** | Section labels get a tapered, slightly rising brush stroke that runs past the word. Links get a heavier blue marker stroke. |
| **P8 Graphite, not black** | Ink `#35322e`, with a slight bleed (a sub-pixel halo). Muted text is `#6b665e`. Pure black never appears. |
| **P9 Colored-pencil mascot** | The fill is a watercolor wash plus visible diagonal pencil hatching that bleeds past a thin, wobbly graphite outline. It's a rounded box body with a nub snout, two dot eyes, four stubby legs, a raised tail, and motion arcs. |
| **P10 Hand-drawn dividers** | The sidebar uses a loose wave; the napkin uses a long, tight pencil zigzag. |

## 3. Type

| Role | Face | Notes |
|---|---|---|
| Display ("what are we making?") | Patrick Hand 400 | graphite with ink bleed; ~5.5% of window width |
| Body / labels | Kalam 300 | slanted handwriting |
| Emphasis (section titles, buttons, "needs you") | Kalam 700 | |
| Machine text (version, paths in napkin) | Courier Prime | typewriter; green for "Claude Code x.y.z" |
| Terminal | JetBrains Mono | legibility beats theme |

## 4. Composition (reference px on a 2000×1250 canvas)

sidebar strip `17,55 → 363,1230` · hero napkin `476,80 → 1890,688` ·
recent card `476,740 → 1170,1162` · "on the table" cards ~300×155, not tilted ·
coffee ring partly under the last card. There's generous empty desk. Content never touches a
paper edge closer than the pressed line.

## 5. The pass gate

`npm run gate` (see `scripts/fidelity/`) launches the app with `NAPKIN_FIXTURE=reference`
(the same mock data as the reference) in a 1360×850 window at 0.85 zoom (a 1600×1000 CSS viewport), captures only the Napkin window,
scales it to 2000×1250, and checks it against `docs/reference.png`:

| Gate | Check | Pass |
|---|---|---|
| **G1 color** | mean RGB of desk, napkin, pad, notebook patches | each channel within ±8 of reference |
| **G2 grain** | fine luminance σ of each paper patch | 0.55×–1.6× reference (too flat fails as well as too loud) |
| **G3 crumple** | σ of 8×8-block means (low-frequency variance) | 0.45×–1.5× reference |
| **G4 layout** | DOM rects of sidebar / hero / recent / cards reported by the fixture | edges within 3% of canvas |
| **G5 eyeball** | side-by-side image `scripts/fidelity/out/side-by-side.png` reviewed against §1–§3 | every principle ✓ |

G1–G4 are automatic and print PASS/FAIL. G5 is a human (or Claude) review of the side-by-side,
checking each principle P1–P10 by name. A UI change ships only when all five pass.
