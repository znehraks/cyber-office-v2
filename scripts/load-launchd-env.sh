#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${CO_LAUNCHD_ENV_FILE:-$HOME/.config/cyber-office-v2/launchd.env}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

export DISCORD_CEO_BOT_TOKEN="${DISCORD_CEO_BOT_TOKEN:-}"
export DISCORD_GOD_BOT_TOKEN="${DISCORD_GOD_BOT_TOKEN:-}"
export DISCORD_ADMIN_USER_IDS="${DISCORD_ADMIN_USER_IDS:-}"
export CO_SUPERVISOR_INTERVAL_MS="${CO_SUPERVISOR_INTERVAL_MS:-30000}"
export CLAUDE_BIN="${CLAUDE_BIN:-claude}"
