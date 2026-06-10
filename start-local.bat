@echo off
rem PuG Vetter — local launcher. Double-click to serve the app and open it.
cd /d "%~dp0"
start "" http://localhost:8090
echo PuG Vetter running at http://localhost:8090 — close this window to stop it.
python -m http.server 8090
