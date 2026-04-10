#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_ROOT="$HOME/.local/share/cyber-office-v2/current"
LAUNCHD_DIR="$HOME/Library/LaunchAgents"
CONFIG_DIR="$HOME/.config/cyber-office-v2"
ENV_FILE="$CONFIG_DIR/launchd.env"
LOG_DIR="$HOME/Library/Logs/cyber-office-v2"
TEMPLATE_DIR="$ROOT_DIR/launchd"

mkdir -p "$LAUNCHD_DIR" "$CONFIG_DIR" "$LOG_DIR" "$SERVICE_ROOT"

if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<'EOF'
DISCORD_CEO_BOT_TOKEN=
DISCORD_GOD_BOT_TOKEN=
DISCORD_ADMIN_USER_IDS=801833538605285416
CO_SUPERVISOR_INTERVAL_MS=30000
CLAUDE_BIN=claude
EOF
  chmod 600 "$ENV_FILE"
fi

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

rsync -a \
  --delete \
  --exclude '.git/' \
  --exclude '.github/' \
  --exclude 'runtime/' \
  --exclude 'test/' \
  "$ROOT_DIR/" "$SERVICE_ROOT/"

render_plist() {
  local src="$1"
  local dest="$2"
  sed \
    -e "s|__ROOT__|$SERVICE_ROOT|g" \
    -e "s|__HOME__|$HOME|g" \
    -e "s|__LOG_DIR__|$LOG_DIR|g" \
    -e "s|__ENV_FILE__|$ENV_FILE|g" \
    "$src" > "$dest"
  plutil -lint "$dest" >/dev/null
}

render_plist "$TEMPLATE_DIR/com.znehraks.cyber-office-v2.ceo.plist" \
  "$LAUNCHD_DIR/com.znehraks.cyber-office-v2.ceo.plist"
render_plist "$TEMPLATE_DIR/com.znehraks.cyber-office-v2.god.plist" \
  "$LAUNCHD_DIR/com.znehraks.cyber-office-v2.god.plist"
render_plist "$TEMPLATE_DIR/com.znehraks.cyber-office-v2.supervisor.plist" \
  "$LAUNCHD_DIR/com.znehraks.cyber-office-v2.supervisor.plist"

load_service() {
  local label="$1"
  launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$LAUNCHD_DIR/$label.plist"
  launchctl kickstart -k "gui/$(id -u)/$label" || true
}

load_service "com.znehraks.cyber-office-v2.supervisor"

if [[ -n "${DISCORD_CEO_BOT_TOKEN:-}" ]]; then
  load_service "com.znehraks.cyber-office-v2.ceo"
else
  echo "Skipped ceo bootstrap: DISCORD_CEO_BOT_TOKEN is empty."
fi

if [[ -n "${DISCORD_GOD_BOT_TOKEN:-}" ]]; then
  load_service "com.znehraks.cyber-office-v2.god"
else
  echo "Skipped god bootstrap: DISCORD_GOD_BOT_TOKEN is empty."
fi

echo "Installed launchd services."
echo "Env file: $ENV_FILE"
echo "Logs: $LOG_DIR"
echo "Service root: $SERVICE_ROOT"
