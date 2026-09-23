#!/usr/bin/env bash
# Build Napkin from source and install it to /Applications.
#   ./scripts/install.sh            (needs: Node ≥ 20, Rust, Xcode command line tools)
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf "\033[38;5;173m✎ %s\033[0m\n" "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "missing $1 — $2"; exit 1; }; }

need node  "install Node 20+ (brew install node)"
need cargo "install Rust (brew install rust, or https://rustup.rs)"
need git   "install the Xcode command line tools (xcode-select --install)"
command -v claude >/dev/null 2>&1 || say "heads up: claude isn't on your PATH yet — curl -fsSL https://claude.ai/install.sh | bash"

say "installing dependencies"
npm ci --no-audit --no-fund

say "building Napkin.app (first build takes a few minutes)"
npx tauri build --bundles app

APP="src-tauri/target/release/bundle/macos/Napkin.app"
DEST="/Applications/Napkin.app"
if pgrep -xq napkin; then say "quit Napkin first, then re-run"; exit 1; fi
rm -rf "$DEST"
cp -R "$APP" "$DEST"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
say "installed → $DEST"
open "$DEST"
