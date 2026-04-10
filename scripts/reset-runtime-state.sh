#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

find runtime/missions -mindepth 1 ! -name '.gitkeep' -delete
find runtime/jobs -mindepth 1 ! -name '.gitkeep' -delete
find runtime/ingress -mindepth 1 ! -name '.gitkeep' -delete
find runtime/artifacts -mindepth 1 ! -name '.gitkeep' -delete
find runtime/packets -mindepth 1 ! -name '.gitkeep' -delete
find runtime/locks -mindepth 1 ! -name '.gitkeep' -delete
find runtime/pids -mindepth 1 ! -name '.gitkeep' -delete
find runtime/state/job-keys -mindepth 1 ! -name '.gitkeep' -delete
find runtime/state/attempt-keys -mindepth 1 ! -name '.gitkeep' -delete
find runtime/state/reports -mindepth 1 ! -name '.gitkeep' -delete
find runtime/state/closeouts -mindepth 1 ! -name '.gitkeep' -delete
rm -f runtime/state/supervisor.json
: > runtime/events/events.jsonl
