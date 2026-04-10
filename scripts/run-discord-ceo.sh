#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export CO_ROOT_DIR="$ROOT_DIR"
CO_DISCORD_ROLE=ceo exec node "$ROOT_DIR/src/discord-bot.js"
