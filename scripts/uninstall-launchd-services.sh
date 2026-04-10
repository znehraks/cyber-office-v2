#!/usr/bin/env bash
set -euo pipefail

LAUNCHD_DIR="$HOME/Library/LaunchAgents"

for label in \
  com.znehraks.cyber-office-v2.ceo \
  com.znehraks.cyber-office-v2.god \
  com.znehraks.cyber-office-v2.supervisor
do
  launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
  rm -f "$LAUNCHD_DIR/$label.plist"
done

echo "Removed launchd services."
