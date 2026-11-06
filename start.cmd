@echo off
cd /d "%~dp0"
rem Already running: just open the page, because a second server would split its state
curl -s -o nul -m 2 http://127.0.0.1:8765/api/tree && (start "" http://127.0.0.1:8765/ & exit /b)
if not exist web\out\index.html (
  pushd web
  call npm install
  call npm run build
  popd
)
python server.py
pause
