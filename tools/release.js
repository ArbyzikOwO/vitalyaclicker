'use strict';
/* =====================================================================
   release.js — выпуск обновления: собрать EXE и APK и выложить их
   в GitHub Releases.

   Запускается сервером по кнопке «Выпустить обновление» (owner),
   но можно и вручную:
       node tools/release.js --version 1.0.1
       node tools/release.js --version 1.1     (то же, что 1.1.0)
       node tools/release.js                 (версия поднимется сама)
       node tools/release.js --no-upload     (только собрать)
       node tools/release.js --upload-only   (только выложить уже собранное в dist)
       node tools/release.js --linux         (собрать Linux AppImage — нужен Linux)

   На Windows собираются EXE и APK, на Linux — AppImage (кроссплатформенная
   сборка Electron невозможна: Windows-файлы делает Windows, Linux — Linux).

   Сервер читает stdout: PROGRESS: ... (показывается игрокам),
   DONE: <версия> — успех, FAIL: <причина> — ошибка.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');
/* общая логика версий с сервером (cmpVersion/isVersion/normalizeVersion) */
const ReleasePlan = require('../server/release-plan.js');

const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, '_build');
const DIST = path.join(ROOT, 'dist');
const CFG_FILE = path.join(__dirname, 'gh.config.json');
const NODE_DIR = path.dirname(process.execPath);

/* npm запускаем через node: .cmd файлы Node 20+ напрямую не запускает */
const NPM_CLI = (() => {
  const cand = [
    path.join(NODE_DIR, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'
  ];
  for (const p of cand) if (fs.existsSync(p)) return p;
  return cand[0];
})();

/* адрес сервера, который зашивается в сборку: tools\server.txt,
   затем server.txt из корня репозитория (его публикует run-server.*) */
function readServerUrl() {
  const cand = [path.join(__dirname, 'server.txt'), path.join(ROOT, 'server.txt')];
  for (const f of cand) {
    if (!fs.existsSync(f)) continue;
    const v = fs.readFileSync(f, 'utf8').trim().split(/\s+/)[0] || '';
    if (v) return v;
  }
  return '';
}

/* ---------------- вывод для сервера ---------------- */
const say = m => process.stdout.write('PROGRESS: ' + m + '\n');
const info = m => process.stdout.write(m + '\n');
const okDone = v => process.stdout.write('DONE: ' + v + '\n');
function die(m) { process.stdout.write('FAIL: ' + m + '\n'); process.exit(1); }

/* ---------------- аргументы ---------------- */
const argv = process.argv.slice(2);
const argVal = (name) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : ''; };
const has = name => argv.indexOf(name) >= 0;
/* сборщики (electron-builder, Gradle) принимают версию только из трёх чисел:
   '1.1' -> '1.1.0', 'v1.2.3' -> '1.2.3' */
const RAW_VERSION = argVal('--version');
const WANTED_VERSION = ReleasePlan.normalizeVersion(RAW_VERSION);
if (RAW_VERSION && !WANTED_VERSION) die('Некорректная версия: ' + RAW_VERSION + ' — нужно вида 1.1 или 1.1.0');
const NOTES = argVal('--notes');
const NO_UPLOAD = has('--no-upload');
const UPLOAD_ONLY = has('--upload-only');
const SKIP_EXE = has('--skip-exe');
const SKIP_APK = has('--skip-apk');
/* Linux-сборка (AppImage) делается только на Linux: Electron не умеет
   собирать Linux-бинарник на Windows. --linux заставляет, --skip-linux отменяет. */
const LINUX_FLAG = has('--linux');
const SKIP_LINUX = has('--skip-linux') || (!LINUX_FLAG && process.platform !== 'linux');
const BUILD_LINUX = !SKIP_LINUX;
const APPIMAGE = 'VitalyaClicker.AppImage';

/* ---------------- конфигурация ---------------- */
function readJson(p, def) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return def; } }
function writeJson(p, o) { fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n'); }

const cfg = readJson(CFG_FILE, {});
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || cfg.token || '';
const REPO = process.env.GITHUB_REPO || argVal('--repo') || cfg.repo || '';
const SERVER_URL = (process.env.VC_SERVER || readServerUrl() || cfg.server || '').trim().split(/\s+/)[0] || '';

/* ---------------- GitHub API ---------------- */
function gh(method, urlPath, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const payload = opts.json ? Buffer.from(JSON.stringify(opts.json)) : (opts.body || null);
    const headers = Object.assign({
      'User-Agent': 'VitalyaClicker',
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + TOKEN
    }, opts.headers || {});
    if (payload) headers['Content-Length'] = payload.length;
    const req = https.request({ method, host: opts.host || 'api.github.com', path: urlPath, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null; try { parsed = JSON.parse(text); } catch (e) {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
        else reject(new Error('GitHub ' + res.statusCode + ': ' + ((parsed && parsed.message) || text.slice(0, 180))));
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/* ---------------- запуск внешних команд ---------------- */
function run(file, args, cwd, label, env) {
  say(label);
  const r = spawnSync(file, args, { cwd: cwd || ROOT, stdio: 'inherit', env: env || process.env });
  if (r.error) throw new Error(label + ': ' + r.error.message);
  if (r.status !== 0) throw new Error(label + ': команда завершилась с кодом ' + r.status);
}

function bump(v) {
  const p = String(v || '1.0.0').split('.').map(x => parseInt(x, 10) || 0);
  while (p.length < 3) p.push(0);
  p[2] += 1;
  return p.slice(0, 3).join('.');
}

/* ---------------- основное ---------------- */
(async function main() {
  try {
    const vFile = path.join(ROOT, 'version.json');
    const cur = readJson(vFile, { version: '1.0.0' });
    const version = WANTED_VERSION || bump(cur.version);
    if (!ReleasePlan.isVersion(version)) return die('Некорректная версия: ' + version);
    const tag = 'v' + version;

    info('=== выпуск ' + tag + ' (было ' + cur.version + ') ===');
    if (!NO_UPLOAD && !TOKEN) return die('нет токена GitHub (tools/gh.config.json или GH_TOKEN)');
    if (!NO_UPLOAD && !REPO) return die('не задан репозиторий GitHub');

    /* 1) версия */
    say('Версия ' + tag);
    /* version.json читают клиенты: из него берётся версия, описание
       и имена файлов в релизе (releases/latest/download/<имя>). */
    const notes = NOTES || ('Обновление игры v' + version);
    /* какие сборки делает эта машина: Windows — exe+apk, Linux — AppImage */
    const IS_WIN = process.platform === 'win32';
    const BUILD_EXE = !SKIP_EXE && IS_WIN;
    const BUILD_APK = !SKIP_APK && IS_WIN;
    const PACKED = { win: 'VitalyaClicker.exe', android: 'VitalyaClicker.apk', linux: APPIMAGE };
    const wanted = [];
    if (BUILD_EXE) wanted.push('win');
    if (BUILD_APK) wanted.push('android');
    if (BUILD_LINUX) wanted.push('linux');
    /* AppImage часто догружают в уже выпущенный релиз (--upload-only уже той же
       версии): файлы других платформ лежат в том же релизе, поэтому не выкидываем их */
    const keepAssets = (UPLOAD_ONLY && String(cur.version) === version && cur.assets && typeof cur.assets === 'object') ? cur.assets : {};
    const versionPayload = {
      version: version,
      released: new Date().toISOString(),
      notes: notes,
      /* перечисляем только то, что реально лежит в этом релизе: иначе игрок
         другой платформы получит ссылку на несуществующий файл */
      assets: Object.assign({}, keepAssets, wanted.reduce((o, k) => (o[k] = PACKED[k], o), {}))
    };
    writeJson(vFile, versionPayload);
    for (const p of [path.join(BUILD, 'electron', 'package.json'), path.join(BUILD, 'mobile', 'package.json')]) {
      const j = readJson(p, null);
      if (j) { j.version = version; writeJson(p, j); }
    }

    /* 2) стейдж с зашитыми адресом/версией/репозиторием */
    say('Подготовка файлов игры');
    const env = Object.assign({}, process.env, {
      VC_VERSION: version,
      VC_REPO: REPO,
      VC_SERVER: SERVER_URL || process.env.VC_SERVER || 'http://localhost:3000',
      VC_TARGET: BUILD_LINUX ? 'linux' : 'win',
      PATH: NODE_DIR + path.delimiter + (process.env.PATH || '')
    });
    if (!UPLOAD_ONLY) run(process.execPath, [path.join(BUILD, 'prepare.js')], ROOT, 'Сборка файлов игры', env);
    if (SERVER_URL) info('адрес сервера в сборке: ' + SERVER_URL);

    /* 3) EXE (Windows) */
    if (BUILD_EXE) {
      say('Сборка EXE (Electron) — это занимает несколько минут');
      if (!UPLOAD_ONLY) run(process.execPath, [NPM_CLI, 'run', 'dist'], path.join(BUILD, 'electron'), 'Сборка EXE', env);
      const exe = path.join(DIST, 'VitalyaClicker.exe');
      if (!fs.existsSync(exe)) return die('EXE не найден: ' + exe);
      info('EXE: ' + (fs.statSync(exe).size / 1048576).toFixed(1) + ' МБ');
    } else info('EXE пропущен (эта машина не Windows)');

    /* 4) APK (Android) */
    if (BUILD_APK) {
      say('Сборка APK (Android) — это занимает несколько минут');
      if (!UPLOAD_ONLY) run(process.execPath, [path.join(BUILD, 'build-apk.js')], BUILD, 'Сборка APK', env);
      const apk = path.join(DIST, 'VitalyaClicker.apk');
      if (!fs.existsSync(apk)) return die('APK не найден: ' + apk);
      info('APK: ' + (fs.statSync(apk).size / 1048576).toFixed(1) + ' МБ');
    } else info('APK пропущен (эта машина не Windows)');

    /* 5) AppImage (Linux) — собирается только на Linux */
    if (BUILD_LINUX) {
      say('Сборка AppImage (Linux) — это занимает несколько минут');
      if (!UPLOAD_ONLY) run(process.execPath, [NPM_CLI, 'run', 'dist:linux'], path.join(BUILD, 'electron'), 'Сборка AppImage', env);
      const img = path.join(DIST, APPIMAGE);
      if (!fs.existsSync(img)) return die('AppImage не найден: ' + img);
      try { fs.chmodSync(img, 0o755); } catch (e) {}
      info('AppImage: ' + (fs.statSync(img).size / 1048576).toFixed(1) + ' МБ');
    }

    if (NO_UPLOAD) { say('Сборка готова (без публикации)'); okDone(version); return; }

    /* 5) публикация в GitHub Releases */
    say('Публикация в GitHub Releases');
    const old = await gh('GET', '/repos/' + REPO + '/releases/tags/' + tag).catch(() => null);
    let rel = null;
    if (old && UPLOAD_ONLY) {
      /* дополняем готовый релиз (например, догружаем AppImage к EXE и APK) —
         удалять его нельзя: вместе с ним пропали бы файлы других платформ */
      rel = old;
      info('релиз ' + tag + ' уже существует — добавляю файлы в него, ничего не удаляя');
    } else {
      if (old) {
        await gh('DELETE', '/repos/' + REPO + '/releases/' + old.id).catch(() => {});
        await gh('DELETE', '/repos/' + REPO + '/git/refs/tags/' + tag).catch(() => {});
        info('прежний релиз ' + tag + ' удалён');
      }
      rel = await gh('POST', '/repos/' + REPO + '/releases', {
        json: {
          tag_name: tag,
          name: 'VitalyaClicker ' + tag,
          body: notes + '\n\n' + Object.keys(versionPayload.assets).map(k => '- ' + PACKED[k] + ' (' + k + ')').join('\n') + '\n\nОбновление можно поставить прямо из игры.',
          draft: false,
          prerelease: false
        }
      });
      info('релиз создан: ' + rel.html_url);
    }

    const have = new Set(((old && old.assets) || []).map(a => a.name));
    const assets = [];
    for (const k of wanted) { const f = path.join(DIST, PACKED[k]); if (fs.existsSync(f)) assets.push([f, PACKED[k]]); }
    for (const [file, name] of assets) {
      if (have.has(name)) { info('уже в релизе: ' + name); continue; }
      const size = fs.statSync(file).size;
      say('Загрузка ' + name + ' (' + (size / 1048576).toFixed(1) + ' МБ)');
      await gh('POST', '/repos/' + REPO + '/releases/' + rel.id + '/assets?name=' + encodeURIComponent(name), {
        host: 'uploads.github.com',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: fs.readFileSync(file)
      });
      info('загружено: ' + name);
    }

    /* 6) версия в репозитории (для справки) */
    await publishFile(REPO, 'version.json', JSON.stringify(versionPayload, null, 2) + '\n', 'версия ' + tag)
      .catch(e => info('не удалось обновить version.json в репозитории: ' + e.message));

    say('Обновление ' + tag + ' выпущено');
    okDone(version);
  } catch (e) {
    die(e && e.message ? e.message : String(e));
  }
})();

/* положить файл в репозиторий через Contents API */
async function publishFile(repo, name, content, message) {
  const cur = await gh('GET', '/repos/' + repo + '/contents/' + name).catch(() => null);
  const body = { message: message, content: Buffer.from(content, 'utf8').toString('base64') };
  if (cur && cur.sha) body.sha = cur.sha;
  return gh('PUT', '/repos/' + repo + '/contents/' + name, { json: body });
}
