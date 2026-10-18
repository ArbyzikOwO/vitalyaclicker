/*
 * VitalyaClicker — десктопное приложение (Electron).
 * Поднимает локальный статический сервер из папки stage/ и открывает игру.
 * Онлайн-раздел использует адрес из window.VC_SERVER (зашит при сборке).
 */
const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

const STAGE = path.join(__dirname, 'stage');
const ICON = path.join(__dirname, 'assets', 'icon.png');
const TITLE = 'VitalyaClicker';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

let win = null;

function serve(req, res) {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); } catch (e) { p = '/'; }
  if (!p || p === '/') p = '/index.html';
  const full = path.normalize(path.join(STAGE, p));
  if (full !== STAGE && !full.startsWith(STAGE + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(full).pipe(res);
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(serve);
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
  });
}

function createWindow(port) {
  win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 940, minHeight: 660,
    title: TITLE,
    backgroundColor: '#0b0e14',
    autoHideMenuBar: true,
    icon: ICON,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false, preload: path.join(__dirname, 'preload.js') }
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL('http://127.0.0.1:' + port + '/index.html');

  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control, shift = input.shift;
    if (input.key === 'F5' || (ctrl && input.key.toLowerCase() === 'r')) { win.webContents.reload(); e.preventDefault(); }
    else if (input.key === 'F11' || (input.alt && input.key === 'Enter')) { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    else if (input.key === 'F12' || (ctrl && shift && input.key.toLowerCase() === 'i')) { win.webContents.toggleDevTools(); e.preventDefault(); }
    else if (input.key === 'Escape' && win.isFullScreen()) { win.setFullScreen(false); e.preventDefault(); }
  });

  win.on('closed', () => { win = null; });
}

/* ============================================================
   АВТООБНОВЛЕНИЕ
   Портативная сборка распаковывается во временную папку, поэтому
   заменять нужно внешний файл (PORTABLE_EXECUTABLE_FILE), а не
   process.execPath. Пока игра запущена, exe занят — замену делает
   служебный .cmd после выхода игры.
   ============================================================ */
function targetExe() {
  const env = process.env;
  if (env.PORTABLE_EXECUTABLE_FILE && fs.existsSync(env.PORTABLE_EXECUTABLE_FILE)) return env.PORTABLE_EXECUTABLE_FILE;
  if (env.PORTABLE_EXECUTABLE_DIR) {
    const guess = path.join(env.PORTABLE_EXECUTABLE_DIR, 'VitalyaClicker.exe');
    if (fs.existsSync(guess)) return guess;
  }
  return process.execPath;
}

function download(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const go = (u, depth) => {
      if (depth > 8) return reject(new Error('слишком много перенаправлений'));
      let req;
      try {
        req = https.get(u, { headers: { 'User-Agent': 'VitalyaClicker', Accept: 'application/octet-stream' } }, res => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            return go(new URL(res.headers.location, u).toString(), depth + 1);
          }
          if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
          const total = Number(res.headers['content-length'] || 0);
          let got = 0;
          const out = fs.createWriteStream(dest);
          res.on('data', c => { got += c.length; if (total) onProgress(Math.round(got * 100 / total)); });
          res.on('error', reject);
          out.on('error', reject);
          res.pipe(out);
          out.on('finish', () => out.close(() => resolve(dest)));
        });
      } catch (e) { return reject(e); }
      req.on('error', reject);
      req.setTimeout(120000, () => req.destroy(new Error('таймаут загрузки')));
    };
    go(url, 0);
  });
}

/* Скрипт-помощник: заменяет запущенный exe после выхода игры.
   Важно: никаких конвейеров (tasklist | find) и timeout — у процесса,
   запущенного из игры, может не быть консоли, и тогда конвейер виснет.
   Поэтому просто повторяем copy: пока игра запущена, файл занят и копия
   не проходит; вышли — копия удалась. Это и есть ожидание. */
const UPDATE_CMD = [
  '@echo off',
  'setlocal',
  'set "TARGET=%~1"',
  'set "SRC=%~2"',
  'ping -n 2 127.0.0.1 >nul 2>nul',
  'set /a N=0',
  ':retry',
  'copy /Y "%SRC%" "%TARGET%" >nul 2>nul',
  'if not errorlevel 1 goto ok',
  'set /a N+=1',
  'if %N% GEQ 180 goto fail',
  'ping -n 2 127.0.0.1 >nul 2>nul',
  'goto retry',
  ':ok',
  'start "" "%TARGET%"',
  'del "%SRC%" >nul 2>nul',
  '(goto) 2>nul & del "%~f0"',
  'exit /b 0',
  ':fail',
  'del "%SRC%" >nul 2>nul',
  '(goto) 2>nul & del "%~f0"',
  'exit /b 1'
].join('\r\n') + '\r\n';

ipcMain.handle('vc:install', async (e, arg) => {
  const url = arg && arg.url;
  if (!url || !/^https:\/\//i.test(url)) throw new Error('Некорректная ссылка обновления');
  const dir = app.getPath('temp');
  const tmp = path.join(dir, 'VitalyaClicker-update.exe');
  const bat = path.join(dir, 'VitalyaClicker-update.cmd');
  const target = targetExe();
  try { fs.rmSync(tmp, { force: true }); } catch (err) {}
  try {
    await download(url, tmp, p => { if (win && !win.isDestroyed()) win.webContents.send('vc:progress', { percent: p }); });
    const st = fs.statSync(tmp);
    if (st.size < 5 * 1024 * 1024) throw new Error('Файл обновления повреждён');
    fs.writeFileSync(bat, UPDATE_CMD, 'utf8');
    const child = spawn('cmd.exe', ['/c', bat, target, tmp], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    setTimeout(() => app.exit(0), 800);
    return { ok: true, target, size: st.size };
  } catch (err) {
    if (win && !win.isDestroyed()) win.webContents.send('vc:error', err.message);
    throw new Error(err.message);
  }
});

const locked = app.requestSingleInstanceLock();
if (!locked) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.setAppUserModelId('com.vitalyaclicker.app');
  Menu.setApplicationMenu(null);
  app.whenReady().then(async () => {
    try {
      const port = await startServer();
      createWindow(port);
      if (process.argv.indexOf('--selftest') >= 0) selftest();
    } catch (e) {
      app.quit();
    }
    app.on('activate', () => { if (!win) startServer().then(createWindow).catch(() => {}); });
  });
  app.on('window-all-closed', () => app.quit());
}

/* автотест: запуск без показа окна, проверка загрузки страницы, вывод и выход */
function selftest() {
  const fail = (msg) => { console.log('SELFTEST FAIL: ' + msg); app.exit(1); };
  const t = setTimeout(() => fail('таймаут'), 30000);
  win.hide();
  win.webContents.once('did-fail-load', (e, code, desc) => { clearTimeout(t); fail(code + ' ' + desc); });
  win.webContents.once('did-finish-load', () => {
    win.webContents.executeJavaScript(`(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 30 && !document.querySelector('.tab[data-tab="online"]'); i++) await sleep(200);
      return {
        title: document.title,
        vcServer: window.VC_SERVER || null,
        vcVersion: window.VC_VERSION || null,
        vcRepo: window.VC_REPO || null,
        vcPlatform: window.VC_PLATFORM || null,
        updaterBridge: typeof (window.vcUpdater && window.vcUpdater.install) === 'function',
        updaterUi: !!window.VCUpdater,
        portableFile: ${JSON.stringify(targetExe())},
        tabs: [...document.querySelectorAll('.tab')].map(x => x.dataset.tab).filter(Boolean),
        skinsProbe: await fetch('skins/arbyz.jpg').then(r => r.status).catch(e => 'ERR'),
        audioProbe: await fetch('audio/background.ogg', { method: 'HEAD' }).then(r => r.status).catch(e => 'ERR'),
        onlinePanel: !!document.querySelector('#panel-online')
      };
    })()`).then(info => {
      clearTimeout(t);
      console.log('SELFTEST OK: ' + JSON.stringify(info));
      app.exit(0);
    }).catch(err => { clearTimeout(t); fail('js: ' + err.message); });
  });
}
