#!/usr/bin/env bash
set -euo pipefail

for label in \
  com.znehraks.cyber-office-v2.ceo \
  com.znehraks.cyber-office-v2.god \
  com.znehraks.cyber-office-v2.supervisor
do
  echo "--- $label"
  launchctl print "gui/$(id -u)/$label" 2>/dev/null || echo "not loaded"
done
