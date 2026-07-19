#!/usr/bin/env zsh
set -euo pipefail
cd "$(dirname "$0")/.."
wasm-pack build sim --target bundler --features wasm
echo "WASM build complete: sim/pkg/"
