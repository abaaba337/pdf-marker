@echo off
cd /d "%~dp0"
if not exist web\out\index.html (
  pushd web
  call npm install
  call npm run build
  popd
)
python server.py
pause
