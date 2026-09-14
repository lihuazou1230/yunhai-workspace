@echo off
title Smart Workspace - Desktop Build
cd /d "%~dp0"

echo.
echo   ============================================================
echo     Smart Workspace - Build Desktop App (exe + installer)
echo   ============================================================
echo.
echo   Web build runs first, then Tauri packs it into the exe.
echo   Both artifacts are copied to the parent folder at the end:
echo     ..\<productName>.exe
echo     ..\<productName>_<version>_x64-setup.exe
echo   (file names follow src-tauri/tauri.conf.json)
echo.
echo   Takes a few minutes. Do not close this window.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [ERROR] Node.js not found. Install Node.js 22+ first:
  echo           https://nodejs.org/
  echo.
  pause
  exit /b 1
)

call node "%~dp0scripts\desktop-build.mjs" --verify
set BUILD_EXIT=%ERRORLEVEL%

echo.
if not "%BUILD_EXIT%"=="0" (
  echo   [FAILED] Build failed. Check _desktop_build.log in the parent folder.
) else (
  echo   [DONE] exe + installer are ready in the parent folder.
)
echo.
pause
exit /b %BUILD_EXIT%
