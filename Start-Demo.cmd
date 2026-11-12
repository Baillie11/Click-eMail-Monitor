@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Install dependencies first by running npm ci in this folder.
  pause
  exit /b 1
)
if not exist dist\web\index.html (
  call npm run build
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Open http://localhost:3100 after the startup message appears.
call npm run demo
pause
