@echo off
chcp 65001 >nul
rem Запуск сервера + туннеля cloudflared (Windows).
rem Все параметры прокидываются в run-server.ps1, например: run-server.cmd -RestartHours 6 -Publish
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-server.ps1" %*
pause
