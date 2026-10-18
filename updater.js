/* ============================================================
   updater.js — автообновление игры + блокировка на время выпуска.
   Работает в EXE (Electron), в APK (Android) и в обычном браузере.

   Почему не через GitHub API: у анонимных запросов лимит 60 в час
   на IP, а игроки часто сидят за одним адресом. Поэтому версия
   читается из version.json репозитория (обычный файл, без лимитов),
   а сама сборка скачивается по стабильной ссылке
   releases/latest/download/<имя файла>.

   Значения, которые зашиваются при сборке (_build/prepare.js):
     window.VC_REPO     — "владелец/репозиторий"
     window.VC_VERSION  — текущая версия игры
     window.VC_PLATFORM — "win" | "android" | "linux" | "web"
     window.VC_SERVER   — адрес сервера по умолчанию
   ============================================================ */
(function () {
  'use strict';

  const REPO = String(window.VC_REPO || '').trim();
  const LOCAL = String(window.VC_VERSION || '0.0.0').trim().replace(/^v/i, '');
  const PLATFORM = String(window.VC_PLATFORM || detectPlatform());
  const RAW_HOST = REPO ? 'https://raw.githubusercontent.com/' + REPO + '/' : '';
  const BRANCHES = ['main', 'master'];
  const REL_PAGE = REPO ? 'https://github.com/' + REPO + '/releases/latest' : '';
  const DL_BASE = REPO ? 'https://github.com/' + REPO + '/releases/latest/download/' : '';
  const CHECK_MS = 3 * 60 * 1000;
  const SERVER_TTL = 5 * 60 * 1000;
  const DEFAULT_ASSET = { win: 'VitalyaClicker.exe', android: 'VitalyaClicker.apk', linux: 'VitalyaClicker.AppImage' };
  /* Обновления обязательные: как только вышла новая версия, играть нельзя,
     пока игрок не обновятся. В обычном браузере (web) принуждать не нужно —
     страницу всегда отдаёт сам сервер с актуальными файлами. */
  const FORCED = PLATFORM === 'win' || PLATFORM === 'android' || PLATFORM === 'linux';
  const REL_URL = REPO ? 'https://github.com/' + REPO + '/releases/latest' : '';

  let release = null;   // { version, tag_name, notes, download, assetName }
  let checkedOnce = false;

  function detectPlatform() {
    if (window.vcUpdater) return 'win';
    if (/android/i.test(navigator.userAgent)) return 'android';
    if (/linux/i.test(navigator.userAgent)) return 'linux';
    return 'web';
  }
  const parts = v => String(v == null ? '' : v).replace(/^v/i, '').split(/[.\-+_]/).map(x => parseInt(x, 10) || 0);
  function cmpVer(a, b) {
    const A = parts(a), B = parts(b);
    for (let i = 0; i < Math.max(A.length, B.length); i++) { const x = A[i] || 0, y = B[i] || 0; if (x !== y) return x > y ? 1 : -1; }
    return 0;
  }
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* ---------------------- стили ---------------------- */
  const CSS = [
    '#vcUpBanner{position:fixed;right:14px;bottom:14px;z-index:9000;display:none;align-items:center;gap:10px;background:linear-gradient(180deg,#232b3b,#151a23);border:1px solid var(--line,#28303f);border-radius:14px;padding:10px 12px;box-shadow:0 10px 30px rgba(0,0,0,.55);max-width:360px;font-family:"Segoe UI",system-ui,sans-serif;}',
    '#vcUpBanner.show{display:flex}',
    '#vcUpBanner .vc-ico{font-size:22px;line-height:1}',
    '#vcUpBanner .vc-txt{font-size:12.5px;font-weight:700;color:var(--text,#eef2f7);line-height:1.35}',
    '#vcUpBanner .vc-txt b{color:var(--gold,#ffc93c)}',
    '#vcUpBanner .vc-btn{background:linear-gradient(180deg,#ffd85e,#ff9f1c);color:#2a1c00;border:none;border-radius:10px;padding:8px 12px;font:800 12px "Segoe UI",system-ui,sans-serif;cursor:pointer;white-space:nowrap}',
    '#vcUpBanner .vc-x{background:none;border:none;color:var(--muted,#8792a6);cursor:pointer;font-size:15px;line-height:1;padding:2px 4px}',
    '#vcLock{position:fixed;inset:0;z-index:9999;background:rgba(5,7,10,.95);display:none;align-items:center;justify-content:center;flex-direction:column;gap:16px;text-align:center;padding:24px}',
    '#vcLock.show{display:flex}',
    '#vcLock .vc-spin{width:56px;height:56px;border-radius:50%;border:4px solid #2b3548;border-top-color:var(--gold,#ffc93c);animation:vcSpin 1s linear infinite}',
    '@keyframes vcSpin{to{transform:rotate(360deg)}}',
    '#vcLock h2{font:900 21px "Segoe UI",system-ui,sans-serif;color:var(--gold,#ffc93c);letter-spacing:.4px;margin:0}',
    '#vcLock p{font:600 13.5px "Segoe UI",system-ui,sans-serif;color:var(--muted,#8792a6);max-width:460px;line-height:1.55;margin:0}',
    '#vcUpBox{position:fixed;inset:0;z-index:9500;display:none;align-items:center;justify-content:center;background:rgba(5,7,10,.86);padding:20px}',
    '#vcUpBox.show{display:flex}',
    '#vcUpBox .vc-card{width:100%;max-width:440px;background:linear-gradient(180deg,#1d2330,#151a23);border:1px solid var(--line,#28303f);border-radius:18px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.6);text-align:center}',
    '#vcUpBox h3{font:900 18px "Segoe UI",system-ui,sans-serif;color:var(--gold,#ffc93c);margin:0 0 6px}',
    '#vcUpBox .vc-ver{font:700 12.5px "Segoe UI",system-ui,sans-serif;color:var(--muted,#8792a6);margin-bottom:12px}',
    '#vcUpBox .vc-ver b{color:var(--green,#3ddc84)}',
    '#vcUpBox .vc-notes{font:600 12px "Segoe UI",system-ui,sans-serif;color:var(--muted,#8792a6);max-height:150px;overflow:auto;text-align:left;white-space:pre-wrap;background:#0e121a;border:1px solid #1c2331;border-radius:10px;padding:10px;margin-bottom:14px}',
    '#vcUpBox .vc-force{font:700 12.5px "Segoe UI",system-ui,sans-serif;color:#ff9f1c;background:rgba(255,159,28,.1);border:1px solid rgba(255,159,28,.4);border-radius:10px;padding:9px 11px;margin-bottom:12px;text-align:left;line-height:1.5}',
    '#vcUpBox .vc-bar{display:none;height:10px;border-radius:6px;background:#0e121a;border:1px solid #1c2331;overflow:hidden;margin-bottom:12px}',
    '#vcUpBox .vc-bar.show{display:block}',
    '#vcUpBox .vc-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#ffc93c,#ff9f1c)}',
    '#vcUpBox .vc-act{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}',
    '#vcUpBox button{border:none;border-radius:11px;padding:10px 16px;font:800 12.5px "Segoe UI",system-ui,sans-serif;cursor:pointer}',
    '#vcUpBox .vc-go{background:linear-gradient(180deg,#ffd85e,#ff9f1c);color:#2a1c00}',
    '#vcUpBox .vc-sec{background:#242d3d;color:var(--text,#eef2f7)}',
    '#vcUpBox .vc-msg{font:700 12px "Segoe UI",system-ui,sans-serif;color:var(--muted,#8792a6);margin-top:10px;min-height:16px;word-break:break-word}',
    '#vcUpBox .vc-link{display:inline-block;margin-top:8px;background:linear-gradient(180deg,#ffd85e,#ff9f1c);color:#2a1c00;border-radius:10px;padding:9px 14px;font:800 12.5px "Segoe UI",system-ui,sans-serif;text-decoration:none}',
    '#vcUpToast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9600;background:rgba(30,37,50,.97);border:1px solid var(--gold,#ffc93c);color:var(--text,#eef2f7);padding:10px 16px;border-radius:12px;font:800 12.5px "Segoe UI",system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.6);display:none;max-width:90vw;text-align:center}',
    '#vcUpToast.show{display:block}'
  ].join('\n');

  function injectCss() {
    if (document.getElementById('vcUpCss')) return;
    const s = document.createElement('style');
    s.id = 'vcUpCss'; s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  /* ---------------------- мелкие элементы ---------------------- */
  let toastT = null;
  function toast(text, ms) {
    injectCss();
    let t = document.getElementById('vcUpToast');
    if (!t) { t = document.createElement('div'); t.id = 'vcUpToast'; document.body.appendChild(t); }
    t.textContent = text; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms || 6000);
  }

  function banner(show, tag) {
    injectCss();
    let b = document.getElementById('vcUpBanner');
    if (!b) {
      b = document.createElement('div'); b.id = 'vcUpBanner';
      /* при обязательном обновлении закрыть баннер нельзя — кнопки «Позже» нет */
      b.innerHTML = '<span class="vc-ico">🚀</span><span class="vc-txt">Доступно обновление <b class="vc-tag"></b></span>'
        + '<button class="vc-btn vc-do">Обновить</button>'
        + (FORCED ? '' : '<button class="vc-x" title="Позже">✕</button>');
      document.body.appendChild(b);
      b.querySelector('.vc-btn').onclick = () => openBox();
      const bx = b.querySelector('.vc-x');
      if (bx) bx.onclick = () => b.classList.remove('show');
    }
    b.querySelector('.vc-tag').textContent = tag || '';
    b.classList.toggle('show', !!show);
  }

  function box(html) {
    injectCss();
    let o = document.getElementById('vcUpBox');
    if (!o) { o = document.createElement('div'); o.id = 'vcUpBox'; document.body.appendChild(o); }
    o.innerHTML = html;
    o.classList.add('show');
    return o;
  }

  /* ---------- адрес сервера из репозитория (туннель cloudflared) ---------- */
  let srvCache = { at: 0, url: '' };
  async function rawText(name) {
    if (!RAW_HOST) return '';
    for (const br of BRANCHES) {
      try {
        const r = await fetch(RAW_HOST + br + '/' + name + '?t=' + Date.now(), { cache: 'no-store' });
        if (!r.ok) continue;
        return await r.text();
      } catch (e) {}
    }
    return '';
  }
  async function serverUrl(force) {
    if (!RAW_HOST) return '';
    if (!force && Date.now() - srvCache.at < SERVER_TTL) return srvCache.url;
    const txt = (await rawText('server.txt')).trim().split(/[\s\r\n]+/)[0] || '';
    if (/^https?:\/\//i.test(txt)) srvCache = { at: Date.now(), url: txt.replace(/\/+$/, '') };
    else srvCache = { at: Date.now(), url: srvCache.url };
    return srvCache.url;
  }

  /* ---------------------- проверка обновлений ---------------------- */
  async function fetchVersionInfo() {
    const txt = await rawText('version.json');
    if (!txt) return null;
    try { const j = JSON.parse(txt); return j && j.version ? j : null; } catch (e) { return null; }
  }

  async function check(silent) {
    if (!REPO) {
      if (!silent) toast('⚠️ Репозиторий обновлений не настроен');
      return null;
    }
    try {
      const j = await fetchVersionInfo();
      if (!j) { if (!silent) toast('⚠️ Не удалось проверить обновления'); return null; }
      const ver = String(j.version).replace(/^v/i, '');
      if (cmpVer(ver, LOCAL) <= 0) {
        checkedOnce = true;
        banner(false);
        if (!silent) toast('✅ У вас последняя версия v' + LOCAL);
        return null;
      }
      const assetName = (j.assets && j.assets[PLATFORM]) || DEFAULT_ASSET[PLATFORM] || '';
      release = {
        version: ver,
        tag_name: 'v' + ver,
        notes: String(j.notes || ''),
        assetName: assetName,
        download: assetName ? DL_BASE + assetName : REL_PAGE,
        html_url: REL_PAGE,
        assets: assetName ? [{ name: assetName }] : []
      };
      checkedOnce = true;
      banner(true, 'v' + ver);
      if (FORCED) openBox();            /* обязательное обновление — окно не закрывается */
      else if (!silent) openBox();
      return release;
    } catch (e) {
      if (!silent) toast('⚠️ Не удалось проверить обновления');
      return null;
    }
  }

  function openBox() {
    const r = release;
    if (!r) { check(false); return; }
    const canAuto = PLATFORM === 'win' && window.vcUpdater && r.assetName;
    const hint = canAuto
      ? 'Игра скачает обновление и перезапустится автоматически.'
      : PLATFORM === 'android'
        ? 'Откроется загрузка APK — подтвердите установку (разрешите установку из этого источника).'
        : 'Откроется страница релиза — скачайте новую версию.';
    const notes = r.notes.trim() ? h(r.notes.slice(0, 1500)) : '<span style="opacity:.7">Обновление игры.</span>';
    const o = box('<div class="vc-card">'
      + '<h3>' + (FORCED ? '⛔ Нужно обновиться' : '🚀 Доступно обновление') + '</h3>'
      + '<div class="vc-ver">установлено: <b>v' + h(LOCAL) + '</b> &nbsp;·&nbsp; новое: <b>v' + h(r.version) + '</b></div>'
      + (FORCED ? '<div class="vc-force">Играть в старой версии нельзя: онлайн-сервер и другие игроки уже на новой. Обновитесь — это займёт минуту.</div>' : '')
      + '<div class="vc-notes">' + notes + '</div>'
      + '<div class="vc-bar"><i></i></div>'
      + '<div class="vc-act">'
      + '<button class="vc-go">' + (canAuto ? '⬇️ Обновить и перезапустить' : '⬇️ Скачать обновление') + '</button>'
      + (FORCED ? '' : '<button class="vc-sec vc-later">Позже</button>')
      + '</div>'
      + '<div class="vc-msg">' + h(hint) + '</div>'
      + (FORCED && REL_URL ? '<a class="vc-link" href="' + h(REL_URL) + '" target="_blank" rel="noopener">Скачать вручную</a>' : '')
      + '</div>');
    const later = o.querySelector('.vc-later');
    if (later) later.onclick = () => o.classList.remove('show');
    o.querySelector('.vc-go').onclick = doUpdate;
  }

  /* принудительное обновление по требованию сервера (клиент устарел) */
  function force(info) {
    info = info || {};
    const ver = String(info.version || '').trim().replace(/^v/i, '');
    if (!ver || cmpVer(ver, LOCAL) <= 0) return false;
    const assetName = info.assetName || (release && release.assetName) || DEFAULT_ASSET[PLATFORM] || '';
    release = {
      version: ver, tag_name: 'v' + ver, notes: String(info.notes || ''),
      assetName: assetName,
      download: assetName ? DL_BASE + assetName : REL_PAGE,
      html_url: REL_PAGE, assets: assetName ? [{ name: assetName }] : []
    };
    checkedOnce = true;
    banner(true, 'v' + ver);
    openBox();
    return true;
  }

  function setMsg(text, color) {
    const m = document.querySelector('#vcUpBox .vc-msg');
    if (m) { m.textContent = text || ''; m.style.color = color || ''; }
  }
  function setMsgHtml(html) {
    const m = document.querySelector('#vcUpBox .vc-msg');
    if (m) { m.innerHTML = html || ''; m.style.color = ''; }
  }
  function setBar(p) {
    const b = document.querySelector('#vcUpBox .vc-bar');
    if (!b) return;
    b.classList.add('show');
    const i = b.querySelector('i');
    if (i) i.style.width = Math.max(0, Math.min(100, p || 0)) + '%';
  }

  async function doUpdate() {
    const r = release; if (!r) return;

    /* Windows: полное автообновление через Electron */
    if (PLATFORM === 'win' && window.vcUpdater && window.vcUpdater.install && r.assetName) {
      setMsg('Подготовка…'); setBar(2);
      try {
        if (window.vcUpdater.onProgress) window.vcUpdater.onProgress(d => {
          if (d && typeof d.percent === 'number') { setBar(d.percent); setMsg('Скачивание… ' + d.percent + '%'); }
        });
        if (window.vcUpdater.onError) window.vcUpdater.onError(m => setMsg('Ошибка: ' + m, '#ff5c5c'));
        setMsg('Скачивание…');
        await window.vcUpdater.install(r.download, r.assetName);
        setBar(100); setMsg('Установка… игра сейчас перезапустится');
      } catch (e) {
        setMsg('Не удалось обновиться автоматически: ' + (e && e.message ? e.message : e), '#ff5c5c');
        setTimeout(() => window.open(r.html_url, '_blank'), 1200);
      }
      return;
    }

    /* Android: загрузку APK отдаём системе (Capacitor открывает _system в браузере) */
    if (PLATFORM === 'android' && r.assetName) {
      setMsg('Открываю загрузку APK…');
      let w = null;
      try { w = window.open(r.download, '_system'); } catch (e) {}
      if (!w) { try { w = window.open(r.download, '_blank'); } catch (e) {} }
      if (!w) {
        try {
          const a = document.createElement('a');
          a.href = r.download; a.target = '_system'; a.rel = 'noopener';
          document.body.appendChild(a); a.click(); a.remove();
        } catch (e) {}
      }
      /* запасной путь: ссылка, по которой можно просто тапнуть */
      setMsgHtml('Если загрузка не открылась сама — тапните по кнопке:'
        + '<br><a class="vc-link" href="' + h(r.download) + '" target="_system" rel="noopener">⬇️ Скачать ' + h(r.assetName) + '</a>'
        + (FORCED ? '<br><span style="opacity:.7">После установки откройте игру заново.</span>' : '<br><span style="opacity:.7">«Позже» — установить в другой раз.</span>'));
      return;
    }

    /* всё остальное — страница релиза */
    window.open(r.html_url, '_blank');
    setMsg('Загрузка открыта в браузере');
  }

  /* ---------------------- блокировка на время выпуска ---------------------- */
  function lock(on, text) {
    injectCss();
    let o = document.getElementById('vcLock');
    if (!o) {
      o = document.createElement('div'); o.id = 'vcLock';
      o.innerHTML = '<div class="vc-spin"></div><h2>🚀 Выпускается обновление</h2><p class="vc-lock-text"></p>'
        + '<p style="opacity:.7">Игра разблокируется автоматически, когда сборка закончится.</p>';
      document.body.appendChild(o);
    }
    if (on) {
      const t = o.querySelector('.vc-lock-text');
      if (t && text) t.textContent = text;
      else if (t && !t.textContent) t.textContent = 'Сервер обновляется…';
      o.classList.add('show');
    } else {
      o.classList.remove('show');
    }
  }

  /* ---------------------- запуск ---------------------- */

  /* Обязательное обновление: окно нельзя закрыть — оно только «обновить».
     Если игрок всё же как-то его убрал (или перезашёл) — оно возвращается. */
  function reassert() {
    if (!FORCED || !release) return;
    const o = document.getElementById('vcUpBox');
    if (!o || !o.classList.contains('show')) openBox();
  }

  /* вернулись в игру (из свёрнутого окна / другой вкладки) — сразу проверяем
     версию заново и, если обновление есть, снова показываем окно */
  function onVisible() {
    if (!FORCED || !release || document.hidden) return;
    check(true);
    reassert();
  }

  function start() {
    injectCss();
    setTimeout(() => check(true), 1500);
    setInterval(() => check(true), CHECK_MS);
    window.addEventListener('vc:update-available', () => check(false));
    /* окно не должно оставаться скрытым, пока есть обязательное обновление */
    setInterval(reassert, 5000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('pageshow', reassert);
    /* Esc окно не закрывает */
    document.addEventListener('keydown', e => {
      if (!FORCED || !release) return;
      if (e.key === 'Escape' || e.keyCode === 27) { e.preventDefault(); e.stopPropagation(); }
    }, true);
  }

  window.VCUpdater = {
    check: check,
    open: openBox,
    install: doUpdate,
    force: force,
    lock: lock,
    serverUrl: serverUrl,
    version: LOCAL,
    repo: REPO,
    platform: PLATFORM,
    forced: FORCED,
    get release() { return release; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
