#!/usr/bin/env bash
# Starts the Doorstep delivery bot with the settings in keeper/.env and restarts it if it stops.
#   cd keeper && ./start.sh
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "Missing keeper/.env. Run: cp .env.example .env  (then edit it)"; exit 1; }
set -a; . ./.env; set +a
[ -d node_modules ] || npm install --silent
if [ -z "${KEEPER_PASSWORD_FILE:-}" ] && [ ! -t 0 ]; then
  echo "No terminal to type the keystore password into. Set KEEPER_PASSWORD_FILE in .env."; exit 1
fi
while true; do
  node keeper.mjs || true
  # With a typed password, a restart would need typing again, so stop instead of looping.
  [ -n "${KEEPER_PASSWORD_FILE:-}" ] || { echo "Bot stopped."; exit 1; }
  echo "Bot stopped; restarting in 5 s…"; sleep 5
done
