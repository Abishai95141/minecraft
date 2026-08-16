#!/usr/bin/env sh
# Serve the game on http://localhost:8000
#
# ES modules will not load over file:// — the browser blocks them by CORS — so
# the game must be served over HTTP even though it has no build step.

set -e
cd "$(dirname "$0")"

PORT="${1:-8000}"

if command -v python3 >/dev/null 2>&1; then
  echo "SowmiCraft -> http://localhost:$PORT"
  exec python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then
  echo "SowmiCraft -> http://localhost:$PORT"
  exec python -m http.server "$PORT"
elif command -v npx >/dev/null 2>&1; then
  echo "SowmiCraft -> http://localhost:$PORT"
  exec npx --yes serve -l "$PORT" .
elif command -v ruby >/dev/null 2>&1; then
  echo "SowmiCraft -> http://localhost:$PORT"
  exec ruby -run -e httpd . -p "$PORT"
else
  echo "No static server found. Install Python 3, or open the folder with any HTTP server." >&2
  exit 1
fi
