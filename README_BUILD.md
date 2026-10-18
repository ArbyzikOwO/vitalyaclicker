# Сборка приложения (EXE и APK)

Готовые файлы лежат в папке **`dist`**:

| Файл | Что это |
|------|---------|
| `dist\VitalyaClicker.exe` | Портативное Windows-приложение (Electron, ~106 МБ). Запускается двойным кликом, установка не нужна. |
| `dist\VitalyaClicker.apk` | Android-приложение (подписанный release-APK, ~9.7 МБ, требует Android 5.1+). |

Иконка берётся из `icon.png` в корне проекта (512×512) — она же используется в обоих приложениях.

## Адрес онлайн-сервера

Адрес сервера игра теперь берёт из репозитория GitHub (`server.txt`, его обновляет
скрипт `tools\run-server.*` вместе с туннелем cloudflared). Адрес, зашитый в сборку —
только запасной вариант. Подробности: **README_UPDATE.md**.

2. При пересборке: задать переменную окружения `VC_SERVER` перед запуском `prepare.js`.

## Автообновление сервера (сайтовая версия)

Автообновление поднимается **вместе с сервером**: `tools/run-server.sh` (Linux) и
`tools/run-server.ps1` (Windows) запускают его сами и гасят при остановке. Отключить:
`NOUPDATE=1` для `.sh`, ключ `-NoUpdate` для `.ps1`.

Отдельно его тоже можно запустить:

```bash
tools/auto-update.sh              # крутится, проверяет каждые 2 минуты
tools/auto-update.sh --once       # один прогон и выход (для cron/systemd)
tools/auto-update.sh --check      # только сообщить, есть ли обновление
INTERVAL=60 tools/auto-update.sh  # свой интервал, секунды
RESTART=0 tools/auto-update.sh    # только git pull, сервер не трогать
```

Скрипт проверяет ветку `main` на GitHub, подтягивает новые коммиты (`git pull --ff-only`)
и перезапускает игровой сервер, когда менялся серверный код. Если менялись только файлы
самой игры (`index.html`, `online.js`, `online.css`, `skins/`, `audio/`, `version.json`,
`icon.png`) — перезапуск не нужен, сервер отдаёт их с диска при каждом запросе.

Что скрипт **не** делает: не трогает туннель cloudflared (публичный адрес остаётся
прежним, `server.txt` переписывать не нужно), не затирает локальные правки
(только fast-forward, никаких `reset --hard`), не касается данных игроков
(`server/data/`) и секретов — их в git нет. Лог: `tools/logs/auto-update.log`.

Если `git pull` не проходит из-за собственных правок в рабочей копии, скрипт
ничего не меняет и пишет об этом в лог.

### Отдельный таймер systemd (независимо от run-server.sh)

`/etc/systemd/system/vitalyaclicker-update.service`:

```ini
[Unit]
Description=VitalyaClicker — автообновление сервера

[Service]
Type=oneshot
User=user
WorkingDirectory=/home/user/vitalyaclicker
ExecStart=/home/user/vitalyaclicker/tools/auto-update.sh --once
```

`/etc/systemd/system/vitalyaclicker-update.timer`:

```ini
[Unit]
Description=Проверять обновления VitalyaClicker каждые 2 минуты

[Timer]
OnBootSec=1min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vitalyaclicker-update.timer
systemctl list-timers | grep vitalya       # проверить, что таймер встал
journalctl -u vitalyaclicker-update -n 50  # что было в последних прогонах
```

Замена `User=user` и путей на свои. Скрипт требует `bash`, `git`, `curl`, `node`
и права останавливать/запускать процесс сервера.

### Автозапуск через cron

```cron
* * * * * cd /home/user/vitalyaclicker && RESTART=1 tools/auto-update.sh --once >/dev/null 2>&1
```

## Выпуск обновлений

Два способа сборки; как именно собирать — выбирается в админке игры
(«Онлайн» → «Админ» → «🚀 Выпуск обновления», доступно только владельцу):

| Где собираем | Что нужно | Время |
|--------------|-----------|-------|
| **Этот компьютер** | `_build\jdk`, `_build\sdk`, установленные `node_modules` и ключ подписи | 5–15 минут |
| **Облако GitHub** | только доступ к репозиторию, всё остальное делает `.github/workflows/release.yml` | 10–20 минут |

По умолчанию режим **авто**: если набор для сборки на месте — собираем локально, иначе отправляем сборку в GitHub Actions.

### Локально (как раньше)

```powershell
node tools\release.js --version 1.0.7               # собрать и выложить
node tools\release.js --no-upload --version 1.0.7   # только собрать
node tools\release.js --upload-only --version 1.0.7 # только выложить уже собранное в dist
```

### В облаке GitHub

Кнопка в игре сама отправляет `workflow_dispatch` в `.github/workflows/release.yml` и показывает прогресс.
Вручную: вкладка **Actions** → **Выпуск обновления** → **Run workflow** (галочка «Только собрать» соберёт файлы
без публикации релиза — они останутся в артефактах запуска).

Workflow: прогоняет `server/test.js`, собирает EXE и APK на `windows-latest`, подписывает APK ключом из секретов,
выкладывает файлы в GitHub Releases и обновляет `version.json`.

Секреты репозитория (Settings → Secrets and variables → Actions):

| Секрет | Значение |
|--------|----------|
| `ANDROID_KEYSTORE_B64` | `vitalyaclicker.keystore` в base64: `[Convert]::ToBase64String([IO.File]::ReadAllBytes('...\vitalyaclicker.keystore'))` |
| `ANDROID_KS_PASS` | пароль хранилища и ключа |
| `ANDROID_KS_ALIAS` | alias ключа (`vitalyaclicker`) |

Ключ подписи в репозиторий не попадает (`*.keystore` в `.gitignore`) — он кладётся в секреты один раз.

Подробности: **README_UPDATE.md**.

## Как пересобрать

Всё лежит в папке `_build` (тулчейн + скрипты). Исходники игры при сборке **не меняются**:
`prepare.js` копирует их в `_build\stage` и добавляет туда адрес сервера.

### EXE (Electron)

```powershell
cd _build\electron
$env:PATH = "C:\Program Files\nodejs;" + $env:PATH
node ..\prepare.js                                  # обновить копию игры (по желанию: $env:VC_SERVER="http://адрес:3000")
npm run dist
```

Результат: `dist\VitalyaClicker.exe`.

Быстрая проверка, что приложение грузится (без показа окна):

```powershell
cd _build\electron
.\node_modules\electron\dist\electron.exe . --selftest        # печатает SELFTEST OK: {...}
```

### APK (Capacitor + Android SDK)

```powershell
cd _build
node build-apk.js
```

Скрипт сам: обновит `www`, проверит `local.properties`, сгенерирует иконки, вызовет `gradlew assembleRelease`,
выровняет (`zipalign`) и подпишет APK (`apksigner`). Результат: `dist\VitalyaClicker.apk`.

Юнит-тесты сервера (не связаны со сборкой):

```powershell
cd server
node test.js
```

## Ключ подписи Android

Файл: `_build\mobile\vitalyaclicker.keystore` (копия в корне проекта — `vitalyaclicker.keystore`).
В репозиторий ключ не попадает.

* alias: `vitalyaclicker`
* пароль хранилища и ключа: `tools\build.config.json` → `ksPass` (шаблон — `tools\build.config.example.json`),
  либо переменная окружения `VC_KS_PASS` (так пароль передаёт GitHub Actions из секретов)

Сохраните файл: обновления приложения можно ставить поверх только с **тем же** ключом.

## Секреты (чего нет в репозитории)

| Файл | Что внутри |
|------|------------|
| `tools\gh.config.json` | токен GitHub и репозиторий для публикации релизов |
| `tools\build.config.json` | пароль ключа подписи APK |
| `server\secret.json` | промокод админки, токен и репозиторий GitHub для сервера |
| `*.keystore` | ключ подписи Android |

Шаблоны: `server\secret.example.json`, `tools\build.config.example.json`.

## Что внутри тулчейна `_build`

| Папка | Назначение | Можно удалить? |
|-------|-----------|----------------|
| `dl` | скачанные архивы JDK и cmdline-tools | да (≈340 МБ) |
| `jdk` | Temurin JDK 17 | да, но при пересборке скачается заново |
| `sdk` | Android SDK (build-tools 34, platform 34, platform-tools) | да, аналогично |
| `stage` | копия игры для сборок | да, пересоздаётся `prepare.js` |
| `electron` | проект Electron + `node_modules` | нет, если хотите быстро пересобирать EXE |
| `mobile` | проект Capacitor + Android + `node_modules` | нет, если хотите быстро пересобирать APK |
| `build-apk.js`, `prepare.js` | скрипты сборки | нет |

## Ограничения сборок

* Онлайн-раздел работает только если адрес сервера доступен из приложения. На `localhost:3000` он
  доступен, если сервер запущен на **том же** компьютере (для EXE) — на телефоне `localhost` указывает
  на сам телефон, поэтому для APK нужен внешний адрес (хостинг/IP).
* Игра хранит сохранения в `localStorage` плеера: у EXE и APK свои независимые сохранения и аккаунты.
* APK подписан самодельным ключом — для Google Play понадобится свой ключ и `AAB`-сборка.
* Портативный EXE при первом запуске распаковывается во временную папку — окно появляется
  через ~15–20 секунд, дальше запускается быстрее.
* Горячие клавиши в EXE: `F5`/`Ctrl+R` — перезагрузить, `F11`/`Alt+Enter` — полный экран, `F12` — консоль разработчика.
