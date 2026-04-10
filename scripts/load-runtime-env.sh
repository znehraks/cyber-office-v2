#!/usr/bin/env bash
set -euo pipefail

PRIMARY_ENV_FILE="${CO_RUNTIME_ENV_FILE:-$HOME/.config/cyber-office-v2/runtime.env}"
LEGACY_ENV_FILE="${CO_LAUNCHD_ENV_FILE:-$HOME/.config/cyber-office-v2/launchd.env}"

if [[ -f "$PRIMARY_ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$PRIMARY_ENV_FILE"
elif [[ -f "$LEGACY_ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$LEGACY_ENV_FILE"
fi

export DISCORD_CEO_BOT_TOKEN="${DISCORD_CEO_BOT_TOKEN:-}"
export DISCORD_GOD_BOT_TOKEN="${DISCORD_GOD_BOT_TOKEN:-}"
export DISCORD_ADMIN_USER_IDS="${DISCORD_ADMIN_USER_IDS:-}"
export CO_SUPERVISOR_INTERVAL_MS="${CO_SUPERVISOR_INTERVAL_MS:-30000}"
export CLAUDE_BIN="${CLAUDE_BIN:-claude}"
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
export OPENAI_API_KEY="${OPENAI_API_KEY:-}"
