#!/bin/sh
# Menjalankan RouteMaximist di http://localhost:8080
cd "$(dirname "$0")"
echo "RouteMaximist berjalan di http://localhost:8080  (Ctrl+C untuk berhenti)"
if command -v python3 >/dev/null 2>&1; then python3 -m http.server 8080
elif command -v python >/dev/null 2>&1; then python -m http.server 8080
else npx --yes http-server -p 8080; fi
