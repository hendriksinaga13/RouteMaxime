@echo off
cd /d "%~dp0"
echo RouteMaximist berjalan di http://localhost:8080  (tutup jendela ini untuk berhenti)
start "" http://localhost:8080
where python >nul 2>nul && (python -m http.server 8080) || (where py >nul 2>nul && py -m http.server 8080) || (npx --yes http-server -p 8080)
