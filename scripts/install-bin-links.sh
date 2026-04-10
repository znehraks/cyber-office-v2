#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$HOME/bin"
ln -sfn "$ROOT_DIR/bin/co" "$HOME/bin/co"
ln -sfn "/Users/designc/Documents/cyber-office/bin/co" "$HOME/bin/co-legacy"
echo "Installed:"
echo "  co -> $ROOT_DIR/bin/co"
echo "  co-legacy -> /Users/designc/Documents/cyber-office/bin/co"
