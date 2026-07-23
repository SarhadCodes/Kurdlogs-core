@echo off
REM KurdLogs Core — double-click or run: deploy-local.cmd
cd /d "%~dp0"
title KurdLogs Core
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-local.ps1"
echo.
pause
