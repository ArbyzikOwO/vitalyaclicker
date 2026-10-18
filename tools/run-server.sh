#!/usr/bin/env bash
# =====================================================================
#  VitalyaClicker — запуск сервера + туннеля cloudflared (Linux/macOS)
#
#  Что делает:
#    1) запускает игровой сервер (node server/server.js);
#    2) запускает автообновление (tools/auto-update.sh): оно само подтягивает
#       свежий код из GitHub и перезапускает сервер, когда менялся серверный код;
#    3) поднимает туннель: cloudflared tunnel --url http://127.0.0.1:<порт>;
#    4) вытаскивает публичный адрес и пишет его в tools/server.txt;
#    5) если заданы GITHUB_REPO и GH_TOKEN — публикует server.txt в репозиторий;
#    6) каждые N часов (по умолчанию 6) перезапускает туннель и обновляет адрес.
#
#  Запуск:  chmod +x tools/run-server.sh && tools/run-server.sh
#  Переменные: PORT=3000 RESTART_HOURS=6 PUBLISH=1 GITHUB_REPO=user/repo GH_TOKEN=...
#              CLOUDFLARED=/путь/к/cloudflared  NOTUNNEL=1
#              NOUPDATE=1 (не запускать автообновление)  UPDATE_INTERVAL=120 (сек)
# =====================================================================
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$DIR")"
PORT="${PORT:-3000}"
RESTART_HOURS="${RESTART_HOURS:-6}"
NOUPDATE="${NOUPDATE:-0}"
UPDATE_INTERVAL="${UPDATE_INTERVAL:-120}"
LOG_DIR="$DIR/logs"
SERVER_TXT="$DIR/server.txt"
mkdir -p "$LOG_DIR"

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

find_node() {
  if command -v node >/dev/null 2>&1; then command -v node; return 0; fi
  for p in /usr/bin/node /usr/local/bin/node /usr/local/node/bin/node "$HOME/.nvm/versions/node"; do
    [ -x "$p" ] && { echo "$p"; return 0; }
  done
  return 1
}

find_cloudflared() {
  if [ -n "${CLOUDFLARED:-}" ] && [ -x "$CLOUDFLARED" ]; then echo "$CLOUDFLARED"; return 0; fi
  if command -v cloudflared >/dev/null 2>&1; then command -v cloudflared; return 0; fi
  local local_bin="$DIR/cloudflared"
  if [ -x "$local_bin" ]; then echo "$local_bin"; return 0; fi
  log 'cloudflared не найден — скачиваю...'
  local url='https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64'
  case "$(uname -m)" in
    aarch64|arm64) url='https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64' ;;
    armv7l)        url='https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm' ;;
  esac
  curl -fL "$url" -o "$local_bin" && chmod +x "$local_bin" || return 1
  echo "$local_bin"
}

gh_config_get() {
  local key="$1" f="$DIR/gh.config.json"
  [ -f "$f" ] || return 1
  sed -n 's/.*"'"$key"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$f" | head -1
}

publish_server_txt() {
  local url="$1" token repo
  token="${GH_TOKEN:-${GITHUB_TOKEN:-$(gh_config_get token)}}"
  repo="${GITHUB_REPO:-$(gh_config_get repo)}"
  if [ -z "$token" ] || [ -z "$repo" ]; then log 'публикация server.txt пропущена: нет токена/репозитория'; return 0; fi
  local api="https://api.github.com/repos/$repo/contents/server.txt"
  local sha content body
  sha="$(curl -fsSL -H "Authorization: Bearer $token" -H 'User-Agent: VitalyaClicker' "$api" 2>/dev/null | tr ',' '\n' | sed -n 's/.*"sha": *"\([^"]*\)".*/\1/p' | head -1)"
  content="$(printf '%s\n' "$url" | base64 | tr -d '\n')"
  if [ -n "$sha" ]; then
    body="{\"message\":\"server: обновлён адрес туннеля\",\"content\":\"$content\",\"sha\":\"$sha\"}"
  else
    body="{\"message\":\"server: обновлён адрес туннеля\",\"content\":\"$content\"}"
  fi
  if curl -fsSL -X PUT -H "Authorization: Bearer $token" -H 'User-Agent: VitalyaClicker' \
       -H 'Content-Type: application/json' -d "$body" "$api" >/dev/null; then
    log "server.txt опубликован в GitHub ($repo)"
  else
    log 'публикация server.txt не удалась'
  fi
}

# Автообновление сервера: отдельный процесс, который сам делает git pull и
# перезапускает сервер, если менялся серверный код (см. tools/auto-update.sh).
start_updater() {
  if [ "$NOUPDATE" = 1 ]; then log 'автообновление отключено (NOUPDATE=1)'; return 0; fi
  local upd="$DIR/auto-update.sh"
  if [ ! -f "$upd" ]; then log 'автообновление: не найден tools/auto-update.sh — пропускаю'; return 0; fi
  [ -x "$upd" ] || chmod +x "$upd" 2>/dev/null
  log "запускаю автообновление (проверка каждые ${UPDATE_INTERVAL}с)"
  PORT="$PORT" NODE_BIN="$NODE_BIN" INTERVAL="$UPDATE_INTERVAL" \
    nohup "$upd" </dev/null >/dev/null 2>>"$LOG_DIR/auto-update.err.log" &
  UPD_PID=$!
  sleep 0.3
  if kill -0 "$UPD_PID" 2>/dev/null; then
    log "автообновление работает (pid $UPD_PID), лог: tools/logs/auto-update.log"
  else
    UPD_PID=""
    log 'автообновление не запустилось — смотрите tools/logs/auto-update.err.log'
  fi
}

NODE_PID=""; CF_PID=""; UPD_PID=""; STOPPED=0
cleanup() {
  [ "$STOPPED" = 1 ] && return 0
  STOPPED=1
  log 'останавливаю...'
  # сначала автообновление, чтобы оно не подняло сервер обратно
  [ -n "$UPD_PID" ] && kill "$UPD_PID" 2>/dev/null
  [ -n "$CF_PID" ] && kill "$CF_PID" 2>/dev/null
  # pid сервера берём из файла: его мог перезапустить автоапдейт
  local np="${NODE_PID:-}"
  [ -f "$LOG_DIR/server.pid" ] && np="$(cat "$LOG_DIR/server.pid" 2>/dev/null || echo "$np")"
  [ -n "$np" ] && kill "$np" 2>/dev/null
  return 0
}
trap 'cleanup; exit 0' INT TERM
trap cleanup EXIT

# ------------------------------------------------------------------ старт
NODE_BIN="$(find_node)" || { log 'Node.js не найден. Установите Node.js.'; exit 1; }
log "Node: $NODE_BIN"
log "Игра: $ROOT"

log 'запускаю игровой сервер...'
( cd "$ROOT" && PORT="$PORT" nohup "$NODE_BIN" server/server.js >"$LOG_DIR/server.log" 2>"$LOG_DIR/server.err.log" & echo $! >"$LOG_DIR/server.pid" )
NODE_PID="$(cat "$LOG_DIR/server.pid" 2>/dev/null || echo '')"

ready=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/api/ping" >/dev/null 2>&1; then ready=1; break; fi
  sleep 0.5
done
if [ "$ready" != 1 ]; then
  log 'сервер не ответил за 30 секунд — смотрите tools/logs/server.err.log'
  exit 1
fi
log "сервер работает: http://127.0.0.1:$PORT"

start_updater

if [ "${NOTUNNEL:-0}" = 1 ]; then
  log 'туннель отключён (NOTUNNEL=1): игра доступна только локально'
  while true; do sleep 3600; done
fi

CF="$(find_cloudflared)" || { log 'cloudflared недоступен'; exit 1; }
log "cloudflared: $CF"

while true; do
  rm -f "$LOG_DIR/cloudflared.log" "$LOG_DIR/cloudflared.err.log"
  log 'поднимаю туннель...'
  nohup "$CF" tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" \
    >"$LOG_DIR/cloudflared.log" 2>"$LOG_DIR/cloudflared.err.log" &
  CF_PID=$!

  url=""
  for _ in $(seq 1 240); do
    sleep 0.5
    url="$(grep -hoE 'https://[a-z0-9][a-z0-9-]*\.trycloudflare\.com' \
            "$LOG_DIR/cloudflared.err.log" "$LOG_DIR/cloudflared.log" 2>/dev/null | head -1)"
    [ -n "$url" ] && break
    kill -0 "$CF_PID" 2>/dev/null || break
  done

  if [ -z "$url" ]; then
    log 'не удалось получить публичный адрес — повтор через 30 с'
    kill "$CF_PID" 2>/dev/null
    sleep 30
    continue
  fi

  log "публичный адрес: $url"
  printf '%s' "$url" >"$SERVER_TXT"
  log "адрес записан в $SERVER_TXT"
  [ "${NOPUBLISH:-0}" = 1 ] || publish_server_txt "$url"

  log "туннель перезапустится через $RESTART_HOURS ч"
  sleep $((RESTART_HOURS * 3600))
  log 'перезапускаю туннель...'
  kill "$CF_PID" 2>/dev/null
  sleep 2
done
