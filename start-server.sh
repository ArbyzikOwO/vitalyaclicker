#!/usr/bin/env bash
# Удобный запуск сервера VitalyaClicker 69 (Linux/macOS).
# Использование: ./start-server.sh [порт]
set -euo pipefail
cd "$(dirname "$0")"
PORT="${1:-3000}"

if ! command -v node >/dev/null 2>&1; then
  echo "Не найден Node.js. Установите Node.js 18+: https://nodejs.org/" >&2
  exit 1
fi

major="$(node -p "process.versions.node.split('.')[0]")"
if [ "$major" -lt 18 ]; then
  echo "Нужен Node.js 18 или новее. Сейчас: $(node -v)" >&2
  exit 1
fi

if [ ! -d server/node_modules/ws ]; then
  echo "Первый запуск: устанавливаю зависимости сервера..."
  ( cd server && npm install --no-audit --no-fund )
fi

echo
echo "  ============================================"
echo "    VitalyaClicker 69 — сервер"
echo "    Адрес:  http://localhost:$PORT"
echo "    Стоп:   Ctrl+C"
echo "  ============================================"
echo

( sleep 2; command -v xdg-open >/dev/null 2>&1 && xdg-open "http://localhost:$PORT/" >/dev/null 2>&1 || true ) &
PORT="$PORT" exec node server/server.js
