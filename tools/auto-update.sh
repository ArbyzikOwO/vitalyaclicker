#!/usr/bin/env bash
# =====================================================================
#  VitalyaClicker — автообновление сайтовой (серверной) версии игры.
#
#  Что делает:
#    1) проверяет ветку BRANCH на GitHub;
#    2) если появились новые коммиты — подтягивает их (git pull --ff-only);
#    3) если менялся серверный код (server/*.js, server/package.json) —
#       перезапускает игровой сервер (node server/server.js);
#    4) если менялись только файлы самой игры (index.html, online.js,
#       online.css, скины, звуки, version.json, icon.png) — перезапуск не
#       нужен: сервер отдаёт их с диска при каждом запросе.
#
#  Туннель cloudflared не трогает — публичный адрес остаётся прежним,
#  поэтому server.txt в GitHub переписывать не надо.
#  Данные игроков (server/data/) и секреты в git не лежат — скрипт их
#  не касается. Никаких reset --hard: только fast-forward, свои правки
#  не затираются.
#
#  Запуск:
#    tools/auto-update.sh                 # крутится, проверяет каждые 2 мин
#    tools/auto-update.sh --once          # один прогон и выход (cron/systemd)
#    tools/auto-update.sh --check         # только сообщить, есть ли обновление
#    INTERVAL=60 tools/auto-update.sh     # свой интервал, сек
#    RESTART=0 tools/auto-update.sh       # только git pull, сервер не трогать
#
#  Переменные: REPO_DIR, BRANCH=main, INTERVAL=120, PORT=3000, RESTART=1,
#              NODE_BIN, LOG_DIR
# =====================================================================
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${REPO_DIR:-$(dirname "$DIR")}"
BRANCH="${BRANCH:-main}"
INTERVAL="${INTERVAL:-120}"
PORT="${PORT:-3000}"
RESTART="${RESTART:-1}"
LOG_DIR="${LOG_DIR:-$DIR/logs}"
LOG="$LOG_DIR/auto-update.log"
PID_FILE="$LOG_DIR/server.pid"
mkdir -p "$LOG_DIR"

# --- не зависать, если git вдруг спросит логин/пароль ---
export GIT_TERMINAL_PROMPT=0

MODE=loop
for a in "$@"; do
  case "$a" in
    --once)  MODE=once ;;
    --check) MODE=check ;;
    -h|--help) MODE=help ;;
    *) printf 'неизвестный параметр: %s\n' "$a" >&2; MODE=help ;;
  esac
done

usage() {
  cat <<'EOF'
Автообновление сайтовой версии VitalyaClicker.

  tools/auto-update.sh              проверять каждые 2 минуты (в цикле)
  tools/auto-update.sh --once       один прогон и выход (для cron/systemd)
  tools/auto-update.sh --check      только сообщить, есть ли обновление

Переменные окружения:
  REPO_DIR   папка проекта (по умолчанию — родитель каталога скрипта)
  BRANCH     ветка GitHub (по умолчанию main)
  INTERVAL   интервал проверки в секундах (по умолчанию 120)
  PORT       порт игрового сервера (по умолчанию 3000)
  RESTART    1 — перезапускать сервер при смене серверного кода (по умолчанию), 0 — не трогать
  NODE_BIN   путь к node (если его нет в PATH)
  LOG_DIR    куда писать лог (по умолчанию tools/logs)

Пример для cron (проверка каждую минуту):
  * * * * * cd /home/user/vitalyaclicker && RESTART=1 tools/auto-update.sh --once

Пример systemd-таймера — в README_BUILD.md, раздел «Автообновление».
EOF
}

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }
GIT() { git -C "$ROOT" "$@"; }

find_node() {
  if [ -n "${NODE_BIN:-}" ] && [ -x "${NODE_BIN}" ]; then echo "${NODE_BIN}"; return 0; fi
  if command -v node >/dev/null 2>&1; then command -v node; return 0; fi
  for p in /usr/bin/node /usr/local/bin/node /usr/local/node/bin/node; do
    [ -x "$p" ] && { echo "$p"; return 0; }
  done
  return 1
}

ping_ok() { curl -fsS "http://127.0.0.1:$PORT/api/ping" >/dev/null 2>&1; }
server_pid() { [ -f "$PID_FILE" ] && cat "$PID_FILE" 2>/dev/null || true; }
game_version() {
  [ -f "$ROOT/version.json" ] || return 0
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/version.json" | head -1
}

# ---------------------------------------------------------------- сервер
start_server() {
  local node
  node="$(find_node)" || { log 'Node.js не найден — запустите сервер сами'; return 1; }
  log "запускаю сервер (порт $PORT)"
  ( cd "$ROOT" && PORT="$PORT" nohup "$node" server/server.js >>"$LOG_DIR/server.log" 2>>"$LOG_DIR/server.err.log" & echo $! >"$PID_FILE" )
  local i
  for i in $(seq 1 60); do
    ping_ok && { log "сервер работает: http://127.0.0.1:$PORT"; return 0; }
    sleep 0.5
  done
  log "сервер не ответил за 30 с — смотрите $LOG_DIR/server.err.log"
  return 1
}

restart_server() {
  local pid; pid="$(server_pid)"
  # pid-файла нет (или он устарел) — попробуем найти процесс сервера сами
  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
    if command -v pgrep >/dev/null 2>&1; then
      local found; found="$(pgrep -f 'server/server\.js' 2>/dev/null | head -1 || true)"
      [ -n "$found" ] && { pid="$found"; log "pid-файл не найден — беру процесс сервера из pgrep (pid $pid)"; }
    fi
  fi
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    log "останавливаю сервер (pid $pid)"
    kill "$pid" 2>/dev/null
    local i
    for i in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    if kill -0 "$pid" 2>/dev/null; then log 'не завершился сам — kill -9'; kill -9 "$pid" 2>/dev/null; sleep 1; fi
  elif ping_ok; then
    log 'сервер отвечает, но процесс найти не удалось — перезапустите его сами (перезапуск пропущен)'
    return 1
  fi
  start_server
}

# ------------------------------------------------------------ зависимости
npm_install() {
  local npm_bin=''
  if command -v npm >/dev/null 2>&1; then npm_bin="$(command -v npm)"
  elif [ -x "$(dirname "$(find_node 2>/dev/null || echo /nonexistent)")/npm" ]; then npm_bin="$(dirname "$(find_node)")/npm"; fi
  if [ -z "$npm_bin" ]; then log 'npm не найден — пропускаю установку зависимостей сервера'; return 1; fi
  log 'ставлю зависимости сервера (npm ci)'
  ( cd "$ROOT/server" && "$npm_bin" ci --no-audit --no-fund >>"$LOG" 2>&1 ) \
    && log 'зависимости обновлены' || log 'npm ci не удался — смотрите лог'
}

# --------------------------------------------------------------- проверка
check_once() {
  if ! GIT rev-parse --git-dir >/dev/null 2>&1; then log "не git-репозиторий: $ROOT"; return 1; fi
  if ! GIT fetch --quiet origin "$BRANCH" 2>>"$LOG"; then log 'не удалось проверить обновления (нет сети?)'; return 1; fi

  local cur new
  cur="$(GIT rev-parse HEAD)"
  new="$(GIT rev-parse FETCH_HEAD 2>/dev/null || true)"
  if [ -z "$new" ]; then log "ветка $BRANCH не найдена в origin"; return 1; fi

  if [ "$cur" = "$new" ]; then
    [ "$MODE" = check ] && log "обновлений нет — версия ${cur:0:7}, игра $(game_version)"
    return 0
  fi

  if ! GIT merge-base --is-ancestor "$cur" "$new" 2>/dev/null; then
    log "копия разошлась с origin/$BRANCH (в ней есть свои коммиты) — обновление пропущено"
    return 1
  fi

  log "есть обновление: ${cur:0:7} -> ${new:0:7}"
  [ "$MODE" = check ] && return 0

  if ! GIT pull --ff-only --quiet origin "$BRANCH" 2>>"$LOG"; then
    log 'git pull не выполнен (локальные правки или конфликт) — разберитесь вручную, обновление не применено'
    return 1
  fi
  log "код обновлён, версия игры: $(game_version)"

  # что изменилось
  local need_restart=0 need_npm=0 f
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in
      server/package.json|server/package-lock.json) need_npm=1; need_restart=1 ;;
      server/*.js)                                  need_restart=1 ;;
    esac
  done < <(GIT diff --name-only "$cur" "$new")

  [ "$need_npm" = 1 ] && npm_install

  if [ "$need_restart" = 0 ]; then
    log 'менялись только файлы игры — они отдаются с диска, перезапуск не нужен'
    return 0
  fi
  if [ "$RESTART" != 1 ]; then
    log 'серверный код изменился, но RESTART=0 — перезапустите сервер сами';
    return 0
  fi
  restart_server
}

# ------------------------------------------------------------------ старт
case "$MODE" in
  help) usage; exit 0 ;;
esac

if ! GIT rev-parse --git-dir >/dev/null 2>&1; then log "не git-репозиторий: $ROOT"; exit 1; fi
log "автообновление запущено: $ROOT (ветка $BRANCH, интервал ${INTERVAL}с, перезапуск=$RESTART)"

if [ "$MODE" = loop ]; then
  trap 'log "автообновление остановлено"; exit 0' INT TERM
  while true; do
    check_once
    sleep "$INTERVAL"
  done
else
  check_once
  exit $?
fi
