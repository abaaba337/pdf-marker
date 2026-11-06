@echo off
rem Live development: edits to web/ appear at http://127.0.0.1:3000 without reloading.
cd /d "%~dp0"
start "PDF Marker API" python server.py --no-browser --ui-port 3000
cd web
if not exist node_modules call npm install
call npm run dev
