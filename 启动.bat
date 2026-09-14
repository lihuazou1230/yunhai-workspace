@echo off
title Yunhai Workbench - One-click Start
cd /d "%~dp0"

echo.
echo   ============================================
echo     Yunhai Workbench - One-click Start
echo   ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [ERROR] Node.js not found. Please install Node.js 20+ first:
  echo           https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo   [1/2] First run: installing dependencies, may take a few minutes...
  echo.
  call pnpm install
  if errorlevel 1 (
    echo.
    echo   [ERROR] Dependency install failed. Check network and retry.
    echo.
    pause
    exit /b 1
  )
) else (
  echo   [1/2] Dependencies ready
)

echo   [2/2] Starting dev server, browser will open automatically...
echo.
echo   ---------------------------------------------------
echo    URL:   http://localhost:5173/
echo    Stop:  close this window or press Ctrl+C
echo   ---------------------------------------------------
echo.

where pnpm >nul 2>nul
if errorlevel 1 (
  call npm run dev:open
) else (
  call pnpm run dev:open
)

echo.
echo   Dev server stopped.
pause
