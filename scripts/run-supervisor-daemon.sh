#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/load-runtime-env.sh"
export CO_ROOT_DIR="$ROOT_DIR"
exec node "$ROOT_DIR/src/cli.js" supervisor daemon
