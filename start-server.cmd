@echo off
chcp 866 >nul
setlocal
cd /d "%~dp0"
title VitalyaClicker 69 - сервер

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [!] Не найден Node.js.
  echo       Установите Node.js 18 или новее: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%v"
if %NODE_MAJOR% LSS 18 (
  echo.
  echo   [!] Нужен Node.js 18 или новее. Сейчас установлен:
  node -v
  echo.
  pause
  exit /b 1
)

if not exist "server\node_modules\ws" (
  echo   Первый запуск: устанавливаю зависимости сервера...
  pushd server
  call npm install --no-audit --no-fund
  popd
  if errorlevel 1 (
    echo.
    echo   [!] Не удалось установить зависимости. Проверьте интернет и попробуйте снова.
    echo.
    pause
    exit /b 1
  )
)

set "PORT=3000"
if not "%~1"=="" set "PORT=%~1"

echo.
echo   ============================================
echo     VitalyaClicker 69 - сервер
echo     Адрес:  http://localhost:%PORT%
echo     Стоп:   Ctrl+C
echo   ============================================
echo.
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:%PORT%/"
node server\server.js
echo.
echo   Сервер остановлен.
pause
