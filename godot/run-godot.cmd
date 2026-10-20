@echo off
rem Runs the game (no editor). ASCII-only on purpose:
rem batch files with Cyrillic break on some Windows codepages.
setlocal
set "DIR=%~dp0"
set "GODOT="

if exist "%LOCALAPPDATA%\Programs\Godot\Godot_v4.7.2-stable_win64.exe" (
  set "GODOT=%LOCALAPPDATA%\Programs\Godot\Godot_v4.7.2-stable_win64.exe"
)
if not defined GODOT (
  for %%f in ("%LOCALAPPDATA%\Programs\Godot\Godot_v*_win64.exe") do set "GODOT=%%~ff"
)
if not defined GODOT (
  where godot >nul 2>nul && set "GODOT=godot"
)

if not defined GODOT (
  echo Godot not found.
  echo Install Godot 4.x: https://godotengine.org/download
  echo or put godot.exe into PATH.
  pause
  exit /b 1
)

start "" "%GODOT%" --path "%DIR%"
