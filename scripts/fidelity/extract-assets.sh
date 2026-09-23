#!/usr/bin/env bash
# Samples the reference (docs/reference.png, Kevin Ngo's concept) into the material library
# the UI is built from: seamless paper tiles and ink sprites lifted off their paper.
# Coordinates are reference px on the 2000×1250 canvas.
set -euo pipefail
cd "$(dirname "$0")/../.."
M=scripts/fidelity/out/measure
mkdir -p scripts/fidelity/out src/assets/ref
[ -x "$M" ] && [ "$M" -nt scripts/fidelity/measure.swift ] || swiftc -O scripts/fidelity/measure.swift -o "$M"
R=docs/reference.png
O=src/assets/ref

NAPKIN=248,245,238; PAD=250,247,232; NOTEBOOK=247,240,220; DESK=219,210,196

# paper (mirror-tiled so they repeat without seams)
$M crop $R 1450,145,380,165 $O/tex-napkin.png mirror
$M crop $R 1190,990,490,250 $O/tex-desk.png mirror contrast=1.8
$M crop $R 760,748,400,45 $O/tex-notebook.png mirror
$M crop $R 18,861,344,39 $O/tex-pad.png none contrast=1.9   # one ruled period; repeats vertically

# edges and stains
$M crop $R 17,44,346,26 $O/torn-top.png alpha=$DESK
$M crop $R 1680,982,215,138 $O/coffee-ring.png alpha=$DESK

# mascots (watercolor + graphite)
$M crop $R 560,168,160,122 $O/critter-hero.png alpha=$NAPKIN
$M crop $R 165,102,60,42 $O/critter.png alpha=$PAD
$M crop $R 1262,850,58,42 $O/critter-done.png alpha=$NAPKIN
$M crop $R 44,452,44,46 $O/critter-needs.png alpha=$PAD

# pen strokes
$M crop $R 740,186,650,94 $O/headline.png alpha=$NAPKIN
$M crop $R 30,134,135,16 $O/ul-brand.png alpha=$PAD
$M crop $R 42,279,136,12 $O/ul-label.png alpha=$PAD
$M crop $R 1238,776,170,16 $O/ul-heading.png alpha=$DESK
$M crop $R 940,882,112,12 $O/ul-link.png alpha=$NOTEBOOK
$M crop $R 60,535,260,24 $O/wave.png alpha=$PAD
$M crop $R 555,562,1255,26 $O/zigzag.png alpha=$NAPKIN
$M crop $R 755,493,30,30 $O/check.png alpha=$NAPKIN
$M crop $R 508,818,32,24 $O/folder.png alpha=$NOTEBOOK

# buttons & keys (9-slice border images; the text in the middle is wiped with fill=N)
$M crop $R 755,357,317,71 $O/btn-clay.png alpha=$NAPKIN fill=18
$M crop $R 1118,355,217,73 $O/btn-ink.png alpha=$NAPKIN fill=18
$M crop $R 38,158,197,66 $O/btn-side.png alpha=$PAD fill=16
$M crop $R 243,175,46,34 $O/kbd.png alpha=$PAD fill=8

# sheets: the reference's own napkin/card edges (deckle, pressed line, lifted corner, shadow)
$M crop $R 468,72,1430,624 $O/sheet-hero.png hole=64
$M crop $R 1236,812,314,170 $O/sheet-card.png hole=30

du -sh $O
