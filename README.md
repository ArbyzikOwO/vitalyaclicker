# VitalyaClicker 69

Кликер-игра с онлайн-режимом: прокачка и скины, облачные сохранения, чат и друзья, переводы монет,
онлайн-банк, аркада (монетка, кости, рулетка), блэкджек и дуэли 1 на 1.
Собирается в портативное приложение для Windows (Electron) и APK для Android (Capacitor).

## Что в репозитории

| Папка / файл | Что это |
|--------------|---------|
| `index.html`, `online.js`, `online.css`, `anticlick.js`, `updater.js`, `roulette.js` | сама игра (клиент) |
| `skins/`, `audio/`, `icon.png` | картинки, звуки, иконка |
| `server/` | игровой сервер (Node.js + WebSocket): аккаунты, облако, чат, банк, дуэли, админка, автотесты |
| `tools/` | запуск сервера с туннелем, сборка и публикация релизов |
| `_build/` | сборочный проект Electron и Capacitor (нужны для EXE/APK) |
| `.github/workflows/release.yml` | сборка обновления в облаке (EXE + APK → GitHub Releases) |
| `server.txt`, `version.json` | адрес игрового сервера и текущая версия — их читают клиенты |
| `README_ONLINE.md`, `README_BUILD.md`, `README_UPDATE.md` | подробная документация |

## Запуск сервера

```bash
cd server
npm install
npm start          # http://localhost:3000 — игра раздаётся этим же сервером
```

Откройте `http://localhost:3000` → вкладка **🌐 Онлайн** → регистрация.
Проверка сервера: `npm test` (188 сквозных тестов).

Чтобы игра была доступна из интернета, есть скрипты с туннелем cloudflared:
`tools\run-server.cmd` (Windows) и `tools/run-server.sh` (Linux) — они поднимают сервер, туннель и
публикуют адрес в `server.txt`, откуда его берут клиенты.

## Сборка и выпуск обновлений

```powershell
node tools\release.js --version 1.0.7                  # собрать EXE+APK и выложить релиз в GitHub
node tools\release.js --no-upload --version 1.0.7      # только собрать (файлы появятся в dist\)
node tools\release.js --upload-only --version 1.0.7    # выложить уже собранное
```

Из игры то же самое доступно владельцу: «Онлайн» → «Админ» → **🚀 Выпуск обновления**.
Там же выбирается, где собирать — на машине сервера или в облаке GitHub Actions (`.github/workflows/release.yml`).

Подробности сборки: [README_BUILD.md](README_BUILD.md) · документация онлайн-режима: [README_ONLINE.md](README_ONLINE.md) ·
как игра обновляется: [README_UPDATE.md](README_UPDATE.md).

## Секретов в репозитории нет

В `.gitignore` убраны: токены GitHub (`tools/gh.config.json`), промокод админки и токен сервера
(`server/secret.json`), пароль ключа подписи APK (`tools/build.config.json`), сам ключ (`*.keystore`),
данные игроков (`server/data/`). Шаблоны конфигов лежат рядом: `server/secret.example.json`,
`tools/build.config.example.json`. Для облачной сборки значение ключа подписи передаётся через секреты
репозитория (`ANDROID_KEYSTORE_B64`, `ANDROID_KS_PASS`, `ANDROID_KS_ALIAS`).
