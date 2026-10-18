/* ============================================================
   VitalyaClicker 69 — ОНЛАЙН-МОДУЛЬ (клиент)
   Облако · переводы с комиссией · чат · друзья · блэкджек 1×1 · админка
   Работает вместе с server/server.js. Игровые функции (state, addMoney,
   spendMoney, totalMoney, saveForced, toast, fmt) берутся из index.html.
   Секретного кода админки здесь нет — он проверяется только на сервере.
   ============================================================ */
(function () {
'use strict';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MAIN_KEY = 'data.bin', GARDEN_KEY = 'sad_data.bin', META_KEY = 'online_meta', APPLIED_KEY = 'online_applied';
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const isFrozen = () => (typeof frozen !== 'undefined') && frozen;
const T = (m) => { try { toast(m); } catch (e) {} };
const F = (n) => { try { return fmt(n); } catch (e) { return String(n); } };
const roleTag = o => o && o.owner ? '<span class="ol-tag gold">👑 OWNER</span>' : (o && o.admin ? '<span class="ol-tag red">ADMIN</span>' : '');
const hhmm = ts => { const d = new Date(ts); const p = n => String(n).padStart(2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()); };

/* ---------- локальные настройки ---------- */
let meta = { server: '', token: '', name: '', rev: 0, auto: true, device: '' };
try { Object.assign(meta, JSON.parse(lsGet(META_KEY) || '{}')); } catch (e) {}
if (!meta.device) meta.device = 'd' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
/* адрес сервера по умолчанию для упакованных сборок (EXE/APK) */
if (!meta.server && typeof window !== 'undefined' && window.VC_SERVER) meta.server = String(window.VC_SERVER);
if (!meta.server && /^https?:/.test(location.protocol)) meta.server = location.origin;
const saveMeta = () => lsSet(META_KEY, JSON.stringify(meta));
saveMeta();

/* ---------- адрес сервера из репозитория (туннель cloudflared) ----------
   Туннель перезапускается каждые 6 часов и получает новый адрес, поэтому
   актуальный адрес лежит в server.txt репозитория (см. tools/run-server.*).
   Если игрок не задал адрес руками в ⚙️ — подставляем адрес оттуда. */
async function applyRemoteServer(force) {
  try {
    if (!window.VCUpdater || typeof window.VCUpdater.serverUrl !== 'function') return false;
    if (meta.manualServer) return false;
    const u = await window.VCUpdater.serverUrl(force);
    if (u && u !== meta.server) {
      meta.server = u; saveMeta();
      const f = $('olServer'); if (f) f.value = u;
      return true;
    }
  } catch (e) {}
  return false;
}

/* ---------- состояние ---------- */
let ws = null, authed = false, me = null, cfg = { fee: 0.05, minTransfer: 1000, minBet: 1000, bankRate: 0.002, bankMin: 1000, renameMs: 600000, rooms: [], emojis: [], colors: [], avatars: [] };
let seq = 1; const pend = new Map();
let retry = 0, retryT = null, stopReconnect = false, kickedReason = '';
let syncReady = false, pushing = false, lastSig = '', lastSyncAt = 0, syncErr = '';
let sub = 'profile';
const EMOJI_FALLBACK = ['👍', '🔥', '😂', '😮', '😢', '❤️', '💀', '🪙'];
let chat = { global: [], rooms: {}, dms: {}, room: 'global', unread: new Set(), reactFor: null };
let friends = { friends: [], incoming: [], outgoing: [] };
let bj = { tables: [], game: null, myTable: null, timer: null };
let duel = { tables: [], myTable: null, res: null, busy: false };
let prof = null, top = null, bank = null;
let arcade = { busy: false, last: null, pick: '', view: 'list', chip: 1000, bets: {}, stack: [], num: null, angle: 0 };
let adm = { users: [], stats: null, q: '', audit: null };
let players = { list: [], q: '', total: 0, online: 0 };
let walletBusy = false, walletAgain = false;
const ONLY_GLOBAL = [{ id: 'global', ico: '🌍', name: 'Общий чат' }];
const rooms = () => ONLY_GLOBAL;
const emojis = () => (cfg.emojis && cfg.emojis.length ? cfg.emojis : EMOJI_FALLBACK);
const roomIds = () => rooms().map(r => r.id);
const isRoomId = id => roomIds().indexOf(id) >= 0;
const roomMsgs = room => room === 'global' ? chat.global : (isRoomId(room) ? (chat.rooms[room] = chat.rooms[room] || []) : (chat.dms[room] = chat.dms[room] || []));
const xpLevel = xp => 1 + Math.floor(Math.sqrt(Math.max(0, xp || 0) / 100));
const xpFloor = l => 100 * (l - 1) * (l - 1);
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})(?:,#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))?$/;
function colorOf(v) {
  if (!v) return null;
  const s = String(v);
  if (s.charAt(0) === '#') { const p = s.split(','); return { from: p[0], to: p[1] || p[0], custom: true }; }
  const c = (cfg.colors || []).find(x => x.id === s);
  return (c && c.from) ? c : null;
}
function normHex(h) {
  h = String(h || '');
  if (/^#[0-9a-fA-F]{3}$/.test(h)) return '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  return /^#[0-9a-fA-F]{6}$/.test(h) ? h : '#ffd85e';
}
function gradInline(a, b) { return 'background-image:linear-gradient(90deg,' + a + ',' + b + ');-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;font-weight:900'; }
function nameStyle(id) { const c = colorOf(id); return c ? ' style="' + gradInline(c.from, c.to) + '"' : ''; }
function avaInner(av, name) {
  if (av && String(av).indexOf('data:image/') === 0) return '<img class="ol-avimg-i" src="' + esc(av) + '" alt="">';
  if (av) return '<span class="ol-avemoji-i">' + esc(av) + '</span>';
  return esc(String(name || '?').slice(0, 1).toUpperCase());
}
function avaSmall(o) { return '<span class="ol-pres-ava' + (o && o.avatar ? '' : ' init') + '">' + avaInner(o && o.avatar, (o && o.name) || '?') + '</span>'; }
function nickHTML(o, plain) {
  const n = (o && o.name) || '?';
  return '<span class="ol-nm' + (plain ? '' : ' ol-nmlink') + '"' + (plain ? '' : ' data-act="pv-view" data-name="' + esc(n) + '" title="Открыть профиль"') + nameStyle(o && o.color) + '>' + esc(n) + '</span>';
}
function relTime(ts) {
  if (!ts) return '—';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'только что';
  const m = Math.floor(s / 60); if (m < 60) return m + ' мин назад';
  const h = Math.floor(m / 60); if (h < 24) return h + ' ч назад';
  const d = Math.floor(h / 24); return d + ' дн назад';
}

/* ============================================================
   СЕТЬ
   ============================================================ */
const base = () => meta.server.replace(/\/+$/, '');
async function httpPost(path, body) {
  let r;
  try { r = await fetch(base() + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch (e) { throw new Error('Сервер недоступен. Проверьте адрес сервера.'); }
  let j; try { j = await r.json(); } catch (e) { throw new Error('Сервер ответил некорректно'); }
  if (!j.ok) throw new Error(j.err || 'Ошибка');
  return j;
}
function req(t, o, timeout) {
  return new Promise((res, rej) => {
    if (!ws || ws.readyState !== 1) return rej(new Error('Нет соединения с сервером'));
    const id = seq++;
    const to = setTimeout(() => { pend.delete(id); rej(new Error('Сервер не отвечает')); }, timeout || 15000);
    pend.set(id, { res, rej, to });
    ws.send(JSON.stringify(Object.assign({ id, t }, o || {})));
  });
}
function scheduleRetry() {
  clearTimeout(retryT);
  retry = Math.min(retry + 1, 7);
  retryT = setTimeout(connect, Math.min(30000, 1000 * Math.pow(2, retry - 1)));
}
function connect() {
  if (!meta.token || !meta.server) { setStatus(); return; }
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  stopReconnect = false; kickedReason = '';
  let sock;
  try { sock = new WebSocket(base().replace(/^http/, 'ws') + '/ws'); } catch (e) { scheduleRetry(); return; }
  ws = sock; setStatus();
  sock.onopen = async () => {
    try {
      const r = await req('auth', { token: meta.token }, 8000);
      authed = true; me = r.me; cfg = me.cfg || cfg; retry = 0;
      meta.name = me.name; saveMeta();
      setStatus(); buildPanel();
      await afterAuth();
    } catch (e) {
      const bad = e.reply && e.reply.err;
      if (bad === 'auth' || (bad && /заблокирован/.test(bad))) { meta.token = ''; saveMeta(); stopReconnect = true; buildPanel(bad === 'auth' ? 'Сессия истекла — войдите заново' : bad); }
      try { sock.close(); } catch (x) {}
    }
  };
  sock.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.re != null) {
      const p = pend.get(m.re); if (!p) return;
      pend.delete(m.re); clearTimeout(p.to);
      if (m.ok) p.res(m); else { const e = new Error(m.err || 'Ошибка'); e.reply = m; p.rej(e); }
    } else onPush(m);
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null; authed = false; syncReady = false;
    for (const [, p] of pend) { clearTimeout(p.to); p.rej(new Error('Соединение потеряно')); }
    pend.clear(); setStatus();
    if (!stopReconnect && meta.token) scheduleRetry();
  };
  sock.onerror = () => {};
}
function disconnect() { stopReconnect = true; clearTimeout(retryT); if (ws) try { ws.close(); } catch (e) {} }

async function afterAuth() {
  await Promise.allSettled([refreshFriends(), loadChat('global'), refreshBjLobby(), refreshDuel(), refreshProfile(), refreshBank(), refreshTop(), refreshPlayers(), me.admin ? refreshAdmin() : null]);
  await initialSync();
  if (syncReady) await pullWallet();
  renderAll();
}

/* ============================================================
   ОБЛАЧНЫЕ СОХРАНЕНИЯ
   ============================================================ */
function localIsFresh() { try { return !lsGet(MAIN_KEY) || (state.clicks === 0 && totalMoney() === 0); } catch (e) { return false; } }
async function initialSync() {
  syncReady = false;
  const info = await req('save.info');
  const cloud = info.save;
  if (!cloud) { syncReady = true; await pushSave(true); return; }                 // в облаке пусто — отправляем локальное
  if (cloud.device === meta.device || (meta.rev && cloud.rev === meta.rev)) {      // облако = наша же версия
    meta.rev = cloud.rev; saveMeta(); syncReady = true; return;
  }
  if (localIsFresh()) { await applyCloud(); return; }                              // чистое устройство — берём облако
  showConflict(cloud);
}
async function pushSave(force) {
  if (!authed || !syncReady || pushing || isFrozen()) return;
  try { if (state.blocked) return; } catch (e) {}
  const main = lsGet(MAIN_KEY); if (!main) return;
  const garden = lsGet(GARDEN_KEY);
  const sig = main + '|' + garden;
  if (!force && sig === lastSig) return;
  pushing = true;
  try {
    const r = await req('save.put', { main, garden, baseRev: meta.rev, force: !!force, device: meta.device });
    meta.rev = r.rev; saveMeta(); lastSig = sig; lastSyncAt = Date.now(); syncErr = '';
  } catch (e) {
    if (e.reply && e.reply.err === 'conflict') { syncReady = false; showConflict(e.reply.save); }
    else syncErr = e.message;
  } finally { pushing = false; renderCloud(); }
}
async function applyCloud() {
  const r = await req('save.get');
  if (r.empty || !r.main) { T('☁️ В облаке пока нет сохранения'); return; }
  frozen = true;                                  // останавливаем автосохранение кликера, чтобы оно не затёрло данные
  lsSet(MAIN_KEY, r.main);
  if (r.garden != null) lsSet(GARDEN_KEY, r.garden); else { try { localStorage.removeItem(GARDEN_KEY); } catch (e) {} }
  meta.rev = r.rev; saveMeta();
  T('☁️ Сохранение загружено из облака. Перезагрузка…');
  setTimeout(() => location.reload(), 600);
}
function showConflict(cloud) {
  let m = $('olConflict');
  if (!m) {
    m = document.createElement('div'); m.className = 'modal-overlay'; m.id = 'olConflict';
    m.innerHTML = '<div class="modal-box" style="max-width:380px"><div class="modal-title">☁️ Найдено другое сохранение</div><div class="modal-sub" id="olConflictBody"></div>' +
      '<div class="modal-btns" style="flex-direction:column"><button class="modal-btn yes" id="olUseCloud">☁️ Взять из облака</button><button class="modal-btn no" id="olUseLocal">💻 Оставить это устройство (перезапишет облако)</button></div></div>';
    document.body.appendChild(m);
    $('olUseCloud').onclick = async () => { m.classList.remove('show'); try { await applyCloud(); } catch (e) { T('❌ ' + e.message); } };
    $('olUseLocal').onclick = async () => { m.classList.remove('show'); syncReady = true; await pushSave(true); await pullWallet(); renderAll(); T('💻 Облако обновлено'); };
  }
  let lm = 0, lc = 0; try { lm = totalMoney(); lc = state.clicks; } catch (e) {}
  $('olConflictBody').innerHTML = 'Облако и это устройство расходятся.<br><br>' +
    '☁️ <b>Облако:</b> 🪙 ' + F(cloud ? cloud.money : 0) + ' · кликов ' + F(cloud ? cloud.clicks : 0) + '<br><span class="ol-dim">' + (cloud ? new Date(cloud.updatedAt).toLocaleString('ru-RU') : '') + '</span><br><br>' +
    '💻 <b>Здесь:</b> 🪙 ' + F(lm) + ' · кликов ' + F(lc);
  m.classList.add('show');
}

/* ============================================================
   КОШЕЛЁК: все зачисления/списания приходят с сервера и применяются ровно один раз
   ============================================================ */
function loadApplied() { try { return new Set(JSON.parse(lsGet(APPLIED_KEY) || '[]')); } catch (e) { return new Set(); } }
function storeApplied(set) { lsSet(APPLIED_KEY, JSON.stringify([...set].slice(-800))); }
async function pullWallet() {
  if (!authed || !syncReady) return;
  if (walletBusy) { walletAgain = true; return; }
  walletBusy = true;
  try {
    do {
      walletAgain = false;
      const r = await req('wallet.pending');
      await applyItems(r.items || []);
    } while (walletAgain);
  } catch (e) { /* повторим при следующем пуше */ } finally { walletBusy = false; }
}
async function applyItems(items) {
  if (!items.length || isFrozen()) return;
  const applied = loadApplied(), ids = [], notes = [];
  let plus = 0, minus = 0;
  const sorted = items.slice().sort((a, b) => (a.kind === 'credit' ? 0 : 1) - (b.kind === 'credit' ? 0 : 1));
  for (const it of sorted) {
    ids.push(it.id);
    if (applied.has(it.id)) continue;
    const amt = Math.floor(Number(it.amount)) || 0;
    if (it.kind === 'credit') { addMoney(amt, 'auto'); plus += amt; }
    else { const take = Math.min(amt, Math.floor(totalMoney())); if (take > 0 && spendMoney(take)) minus += take; }
    applied.add(it.id); if (it.note) notes.push(it.note);
  }
  storeApplied(applied);
  try { saveForced(); updateBalance(); updateAffordability(); updateHead(); } catch (e) {}
  if (plus) T('💰 +🪙 ' + F(plus) + (notes.length === 1 ? ' · ' + notes[0] : ''));
  if (minus) T('💸 −🪙 ' + F(minus) + (notes.length === 1 ? ' · ' + notes[0] : ''));
  try { await req('wallet.ack', { ids }); } catch (e) {}
  await pushSave(true);
  if (sub === 'transfer') renderTransferHist();
}

/* ============================================================
   PUSH-СООБЩЕНИЯ СЕРВЕРА
   ============================================================ */
let walletT = null;
function onPush(m) {
  switch (m.t) {
    case 'wallet': clearTimeout(walletT); walletT = setTimeout(pullWallet, 150); break;
    case 'friends.update': refreshFriends(); if (m.note) T(m.note); break;
    case 'xp': if (me) { me.xp = m.xp; me.level = m.level; } if (sub === 'profile') renderProfile(); break;
    case 'me.update': {
      const changedName = me && m.me.name && me.name !== m.me.name;
      if (me) { me.name = m.me.name; me.avatar = m.me.avatar || null; me.color = m.me.color || ''; }
      meta.name = m.me.name; saveMeta();
      if (changedName) { T('✏️ Новый ник: ' + m.me.name); buildPanel(); }
      else { updateHead(); renderProfile(); if (sub === 'chat') renderChatLog(); if (sub === 'players') refreshPlayers(); updateBadges(); }
      break; }
    case 'chat.msg': {
      const rm = m.msg.room || 'global';
      const box = roomMsgs(rm); box.push(m.msg); if (box.length > 200) box.shift();
      if (sub === 'chat' && chat.room === rm && panelVisible()) appendMsg(m.msg); else markUnread(rm);
      break; }
    case 'chat.react': {
      const boxes = [chat.global].concat(Object.values(chat.rooms), Object.values(chat.dms));
      let msg = null;
      for (const b of boxes) { msg = b.find(x => x.id === m.msgId); if (msg) break; }
      if (msg) { msg.react = m.react || {}; if (sub === 'chat' && panelVisible()) renderChatLog(); }
      break; }
    case 'chat.dm': {
      const k = m.peer.toLowerCase(); (chat.dms[k] = chat.dms[k] || []).push(m.msg);
      if (sub === 'chat' && chat.room === k && panelVisible()) appendMsg(m.msg);
      else if (m.msg.from.toLowerCase() === k) { markUnread(k); T('✉️ ' + m.msg.from + ': ' + m.msg.text.slice(0, 60)); }
      break; }
    case 'chat.del': { for (const b of [chat.global].concat(Object.values(chat.rooms))) { const i = b.findIndex(x => x.id === m.msgId); if (i >= 0) b.splice(i, 1); } const n = document.querySelector('[data-mid="' + m.msgId + '"]'); if (n) n.remove(); break; }
    case 'bj.tables': bj.tables = m.tables; if (bj.myTable && !bj.tables.some(t => t.id === bj.myTable)) bj.myTable = null; renderBj(); break;
    case 'bj.state': {
      const first = !bj.game || bj.game.id !== m.game.id;
      bj.game = m.game; bj.myTable = null; renderBj();
      if (first && m.game.state === 'play') { T('🃏 Игра началась! Ставка 🪙 ' + F(m.game.bet)); if (panelVisible()) setSub('bj'); }
      break; }
    case 'duel.tables': duel.tables = m.tables || []; if (duel.myTable && !duel.tables.some(t => t.id === duel.myTable)) duel.myTable = null; renderDuel(); break;
    case 'duel.result': duel.res = m.res; duel.busy = false; renderDuel();
      T(m.res.push ? '🤝 Ничья — ставка возвращена' : m.res.youWon ? '🏆 Дуэль выиграна! +🪙 ' + F(m.res.bet) : '😵 Дуэль проиграна −🪙 ' + F(m.res.bet));
      if (panelVisible() && sub !== 'duel') setSub('duel'); pullWallet(); break;
    case 'announce': showAnnounce(m.text, m.from); break;
    case 'sys.lock': {
      if (window.VCUpdater) window.VCUpdater.lock(!!m.on, m.text || '');
      const rs = $('relState'); if (rs && m.text) rs.textContent = m.text;
      if (!m.on && me && me.owner && sub === 'admin') refreshAdmin().catch(() => {});
      break; }
    case 'sys.update': {
      T('🚀 Выпущено обновление' + (m.version ? ' v' + m.version : '') + ' — обновите игру!');
      window.dispatchEvent(new Event('vc:update-available'));
      break; }
    case 'toast': T(m.text); break;
    case 'role': if (me) { me.admin = !!m.admin; me.owner = !!m.owner; if (!me.admin && sub === 'admin') sub = 'profile'; buildPanel(); } break;
    case 'ac.banned': try { if (typeof antiClickLock === 'function') antiClickLock(m.reason, 'server'); } catch (e) {} break;
    case 'kicked': kickedReason = m.reason || ''; stopReconnect = true; T('⛔ ' + kickedReason); setStatus(); break;
  }
}
function showAnnounce(text, from) {
  let a = $('olAnnounce');
  if (!a) { a = document.createElement('div'); a.id = 'olAnnounce'; document.body.appendChild(a); }
  a.innerHTML = '📢 ' + esc(text) + '<small>от ' + esc(from) + '</small>';
  a.classList.add('show'); clearTimeout(a._t); a._t = setTimeout(() => a.classList.remove('show'), 12000);
}
const panelVisible = () => { const p = $('panel-online'); return p && p.classList.contains('active'); };
function markUnread(room) { chat.unread.add(room); updateBadges(); }
function updateBadges() {
  const dot = $('onlineTabDot'); if (dot) dot.classList.toggle('unread', chat.unread.size > 0);
  const b = document.querySelector('.ol-subtab[data-sub="chat"] .badge'); if (b) b.style.display = chat.unread.size ? '' : 'none';
}
function setStatus() {
  const dot = $('onlineTabDot'); if (dot) { dot.classList.toggle('on', authed); }
  const s = $('olStatus'); if (!s) return;
  if (authed) { s.textContent = '🟢 в сети'; s.className = 'ol-status ok'; }
  else if (kickedReason) { s.textContent = '⛔ ' + kickedReason; s.className = 'ol-status bad'; }
  else if (ws && ws.readyState === 0) { s.textContent = '⏳ подключение…'; s.className = 'ol-status'; }
  else { s.textContent = '🔴 нет связи' + (retry ? ' (повтор…)' : ''); s.className = 'ol-status bad'; }
}

/* ============================================================
   ПАНЕЛЬ: каркас
   ============================================================ */
const SUBS = [
  ['profile', '🏅', 'Профиль'],
  ['cloud', '💾', 'Облако'],
  ['transfer', '💸', 'Перевод'],
  ['bank', '🏦', 'Банк'],
  ['chat', '💬', 'Чат'],
  ['friends', '👥', 'Друзья'],
  ['players', '🧑‍🤝‍🧑', 'Игроки'],
  ['arcade', '🎲', 'Аркада'],
  ['bj', '🃏', 'Блэкджек'],
  ['duel', '⚔️', 'Дуэли'],
  ['top', '🏆', 'Топ'],
  ['admin', '🛡️', 'Админ'],
];
/* маленький бейдж с версией игры (зашивается при сборке, в dev скрыт) */
function gameVersion() {
  let v = '';
  try { v = String(window.VC_VERSION || '').trim().replace(/^v/i, ''); } catch (e) {}
  return (v && v !== '0.0.0') ? v : '';
}
function verTag() {
  const v = gameVersion();
  return v ? '<span class="ol-ver" title="Версия игры">v' + esc(v) + '</span>' : '';
}
function buildPanel(notice) {
  const p = $('panel-online'); if (!p) return;
  if (!meta.token) {
    p.innerHTML = `
      <div class="ol-box ol-auth">
        <div class="ol-hero"><div class="ol-hero-ico">🌐</div><h3>Онлайн-профиль</h3>${verTag()}</div>
        <div class="ol-sub-note" style="text-align:center">Один аккаунт для всего: облачные сохранения, переводы, онлайн-банк, общий чат и личные сообщения, друзья, список игроков, аркада, блэкджек и дуэли 1 на 1, опыт, уровни и кастомизация профиля.</div>
        <div class="ol-perks"><span>☁️ Облако</span><span>💸 Переводы</span><span>🏦 Банк</span><span>💬 Чат</span><span>👥 Друзья</span><span>🎨 Профиль</span><span>🎲 Аркада</span><span>🃏 Блэкджек</span><span>⚔️ Дуэли</span></div>
        ${notice ? '<div class="ol-preview" style="color:#ff9f1c;margin-bottom:8px">' + esc(notice) + '</div>' : ''}
        <input class="ol-in" id="olName" placeholder="Ник (3–16 символов)" maxlength="16" autocomplete="username" style="width:100%;margin-top:4px">
        <input class="ol-in" id="olPass" type="password" placeholder="Пароль (от 6 символов)" maxlength="64" autocomplete="current-password" style="width:100%;margin-top:8px">
        <div class="ol-row"><button class="ol-btn" data-act="login" style="flex:1">Войти</button><button class="ol-btn sec" data-act="register" style="flex:1">Регистрация</button></div>
        <details style="margin-top:12px"><summary class="ol-dim" style="cursor:pointer">⚙️ Адрес сервера</summary>
          <input class="ol-in" id="olServer" data-act="srv" placeholder="http://адрес:3000" value="${esc(meta.server)}" style="width:100%;margin-top:8px">${meta.manualServer ? '' : '<div class="ol-dim" style="font-size:11px;margin-top:4px">адрес берётся автоматически из репозитория игры</div>'}</details>
        <div class="ol-msg sys" id="olAuthMsg" style="margin-top:8px"></div>
      </div>`;
    setStatus(); return;
  }
  const tabs = SUBS.filter(s => s[0] !== 'admin' || (me && me.admin)).map(s => `<button class="ol-subtab${s[0] === sub ? ' active' : ''}" data-sub="${s[0]}"><span class="si">${s[1]}</span><span class="sl">${s[2]}</span>${s[0] === 'chat' ? '<span class="badge" style="display:none"></span>' : ''}</button>`).join('');
  p.innerHTML = `
    <div class="ol-box ol-head"><div class="ol-prof">
        <div class="ol-ava${me && me.owner ? ' owner' : ''}">${avaInner(me && me.avatar, meta.name)}<span class="ol-lvl" id="olLvl">1</span></div>
        <div class="ol-prof-main">
          <div class="ol-who">${nickHTML({ name: meta.name, color: me && me.color })}${roleTag(me)}</div>
          <div class="ol-status" id="olStatus"></div>
          <div class="ol-xpbar" id="olXpbar"><i id="olXpFill" style="width:0%"></i><span class="ol-xptext" id="olXpText">0 XP</span></div>
        </div></div>
      <div class="ol-row" style="margin:0"><span class="ol-coins" id="olCoins">🪙 0</span>${verTag()}<button class="ol-mini" data-act="reconnect" title="Переподключиться">🔄</button><button class="ol-mini red" data-act="logout">Выйти</button></div></div>
    <div class="ol-subtabs">${tabs}</div>
    ${SUBS.map(s => `<div class="ol-sub" id="olSub-${s[0]}"></div>`).join('')}`;
  if (sub === 'admin' && !(me && me.admin)) sub = 'profile';
  setSub(sub); setStatus(); updateHead(); updateBadges();
}
function updateHead() {
  const lvl = me && me.level ? me.level : (me ? xpLevel(me.xp) : 1);
  const av = document.querySelector('.ol-head .ol-ava');
  if (av) { av.innerHTML = avaInner(me && me.avatar, meta.name) + '<span class="ol-lvl" id="olLvl">' + lvl + '</span>'; }
  const who = document.querySelector('.ol-head .ol-who');
  if (who) who.innerHTML = nickHTML({ name: meta.name, color: me && me.color }) + roleTag(me);
  const lv = $('olLvl'); if (lv) lv.textContent = lvl;
  const xp = (me && me.xp) || 0, lo = xpFloor(lvl), hi = xpFloor(lvl + 1);
  const pct = hi > lo ? Math.max(0, Math.min(100, Math.round((xp - lo) / (hi - lo) * 100))) : 100;
  const fill = $('olXpFill'); if (fill) fill.style.width = pct + '%';
  const tx = $('olXpText'); if (tx) tx.textContent = xp + ' XP · ' + (hi - xp > 0 ? 'до ур. ' + (lvl + 1) + ': ' + (hi - xp) : 'максимум');
  const c = $('olCoins'); if (c) { let v = 0; try { v = totalMoney(); } catch (e) {} c.textContent = '🪙 ' + F(v); }
}
function setSub(s) {
  sub = s;
  document.querySelectorAll('.ol-subtab').forEach(b => b.classList.toggle('active', b.dataset.sub === s));
  document.querySelectorAll('.ol-sub').forEach(d => d.classList.toggle('active', d.id === 'olSub-' + s));
  if (s === 'chat') { chat.unread.delete(chat.room); updateBadges(); renderChatShell(); renderChatLog(); }
  if (s === 'transfer') { renderTransfer(); loadHistory(); }
  if (s === 'friends') refreshFriends();
  if (s === 'players') refreshPlayers();
  if (s === 'bj') refreshBjLobby();
  if (s === 'duel') refreshDuel();
  if (s === 'bank') refreshBank();
  if (s === 'profile') refreshProfile();
  if (s === 'top') refreshTop();
  if (s === 'arcade') renderArcade();
  if (s === 'admin') refreshAdmin();
  if (s === 'cloud') renderCloud();
  updateHead();
}
function renderAll() { if (!meta.token) return; updateHead(); renderCloud(); renderTransfer(); renderChatShell(); renderFriends(); renderPlayers(); renderBj(); renderDuel(); renderBank(); renderProfile(); renderTop(); renderArcade(); renderAdmin(); }

/* ---------- облако ---------- */
function renderCloud() {
  const d = $('olSub-cloud'); if (!d) return;
  d.innerHTML = `<div class="ol-box"><h3>💾 Облачное сохранение</h3>
    <div class="ol-sub-note">Прогресс кликера и сада хранится на сервере и подтягивается на любом устройстве.</div>
    <div class="ol-kv"><span>Статус</span><b>${authed ? (syncReady ? '✅ синхронизировано' : '⏳ нужно решение') : '🔴 нет связи'}</b></div>
    <div class="ol-kv"><span>Версия облака</span><b>#${meta.rev || 0}</b></div>
    <div class="ol-kv"><span>Последняя отправка</span><b>${lastSyncAt ? hhmm(lastSyncAt) : '—'}</b></div>
    ${syncErr ? '<div class="ol-kv"><span>Ошибка</span><b style="color:var(--red)">' + esc(syncErr) + '</b></div>' : ''}
    <label class="ol-row" style="cursor:pointer"><input type="checkbox" data-act="auto" ${meta.auto ? 'checked' : ''}> <span style="font-size:12.5px">Автосинхронизация каждые 30 сек</span></label>
    <div class="ol-row"><button class="ol-btn" data-act="cloud-push" style="flex:1" ${authed && syncReady ? '' : 'disabled'}>☁️ Сохранить сейчас</button>
    <button class="ol-btn sec" data-act="cloud-pull" style="flex:1" ${authed ? '' : 'disabled'}>📥 Загрузить из облака</button></div></div>`;
}

/* ---------- перевод ---------- */
const UNITS = { k: 1e3, m: 1e6, b: 1e9, t: 1e12, qa: 1e15, qi: 1e18, sx: 1e21, sp: 1e24, oc: 1e27, no: 1e30, 'к': 1e3, 'м': 1e6, 'б': 1e9, 'т': 1e12 };
function parseAmt(s) {
  s = String(s || '').trim().toLowerCase().replace(',', '.').replace(/\s+/g, '');
  const m = s.match(/^(\d+(?:\.\d+)?)([a-zа-я]{0,2})$/); if (!m) return 0;
  const mul = m[2] ? UNITS[m[2]] : 1; if (!mul) return 0;
  const n = Math.floor(parseFloat(m[1]) * mul);
  return isFinite(n) && n > 0 && n < 1e30 ? n : 0;
}
function renderTransfer() {
  const d = $('olSub-transfer'); if (!d || d.dataset.built) { updatePreview(); return; }
  d.dataset.built = '1';
  d.innerHTML = `<div class="ol-box"><h3>💸 Перевод денег</h3>
    <div class="ol-sub-note">Комиссия <b>${Math.round(cfg.fee * 100)}%</b> платится сверху: получатель получает ровно столько, сколько вы указали. Минимум 🪙 ${F(cfg.minTransfer)}. Можно писать 5K, 2.5M, 1B, 3T…</div>
    <input class="ol-in" id="trTo" placeholder="Ник получателя" list="trFriends" style="width:100%" autocomplete="off"><datalist id="trFriends"></datalist>
    <input class="ol-in" id="trAmt" placeholder="Сумма, например 10M" style="width:100%;margin-top:8px" inputmode="text" autocomplete="off">
    <div class="ol-preview" id="trPrev">Введите сумму</div>
    <div class="ol-row"><button class="ol-btn" data-act="tr-send" style="flex:1">💸 Отправить</button></div></div>
    <div class="ol-box"><h3>🧾 История</h3><div class="ol-list" id="trHist"><div class="ol-empty">Загрузка…</div></div></div>`;
  $('trAmt').addEventListener('input', updatePreview);
  fillFriendDatalist();
}
function fillFriendDatalist() { const dl = $('trFriends'); if (dl) dl.innerHTML = friends.friends.map(f => '<option value="' + esc(f.name) + '">').join(''); }
function feeOf(a) { return Math.max(1, Math.ceil(a * cfg.fee)); }
function updatePreview() {
  const el = $('trPrev'), inp = $('trAmt'); if (!el || !inp) return;
  const a = parseAmt(inp.value);
  if (!a) { el.innerHTML = 'Введите сумму'; return; }
  const fee = feeOf(a), tot = a + fee; let have = 0; try { have = totalMoney(); } catch (e) {}
  el.innerHTML = `Получатель получит: <b>🪙 ${F(a)}</b><br>Комиссия (${Math.round(cfg.fee * 100)}%): <b>🪙 ${F(fee)}</b><br>С вас спишется: <b>🪙 ${F(tot)}</b>` + (have < tot ? '<br><span style="color:var(--red)">Не хватает 🪙 ' + F(tot - have) + '</span>' : '');
}
const needSync = () => { if (!authed) { T('🔴 Нет связи с сервером'); return true; } if (!syncReady) { T('☁️ Сначала решите, какое сохранение использовать'); return true; } return false; };
async function doTransfer() {
  if (needSync()) return;
  const to = ($('trTo').value || '').trim(), a = parseAmt($('trAmt').value);
  if (!to) return T('Укажите ник получателя');
  if (a < cfg.minTransfer) return T('Минимум 🪙 ' + F(cfg.minTransfer));
  const fee = feeOf(a), tot = a + fee;
  if (totalMoney() < tot) return T('❌ Не хватает денег (нужно 🪙 ' + F(tot) + ')');
  if (!confirm(`Перевести 🪙 ${F(a)} игроку ${to}?\nКомиссия: 🪙 ${F(fee)}\nСпишется: 🪙 ${F(tot)}`)) return;
  try {
    await pushSave(true);
    const r = await req('transfer', { to, amount: a });
    T(`✅ Переведено 🪙 ${F(r.amount)} (комиссия ${F(r.fee)})`);
    $('trAmt').value = ''; updatePreview();
    await pullWallet(); loadHistory();
  } catch (e) { T('❌ ' + e.message); }
}
async function loadHistory() {
  const box = $('trHist'); if (!box) return;
  try {
    const r = await req('wallet.history');
    box.innerHTML = r.tx.length ? r.tx.map(x => {
      const when = '<span class="ol-dim">' + hhmm(x.at) + '</span>';
      if (x.type === 'in') return `<div class="ol-item"><span class="grow">${when} от <b>${esc(x.other)}</b></span><span class="ol-pos">+${F(x.amount)}</span></div>`;
      if (x.type === 'out') return `<div class="ol-item"><span class="grow">${when} → <b>${esc(x.other)}</b> <span class="ol-dim">(комиссия ${F(x.fee)})</span></span><span class="ol-neg">−${F(-x.amount)}</span></div>`;
      return `<div class="ol-item"><span class="grow">${when} 🃏 ${esc(x.note)} · ${esc(x.other)}</span><span class="${x.amount > 0 ? 'ol-pos' : x.amount < 0 ? 'ol-neg' : 'ol-dim'}">${x.amount > 0 ? '+' : x.amount < 0 ? '−' : ''}${F(Math.abs(x.amount))}</span></div>`;
    }).join('') : '<div class="ol-empty">Операций пока нет</div>';
  } catch (e) { box.innerHTML = '<div class="ol-empty">' + esc(e.message) + '</div>'; }
}

/* ---------- чат ---------- */
function renderChatShell() {
  const d = $('olSub-chat'); if (!d) return;
  if (!d.dataset.built) {
    d.dataset.built = '1';
    d.innerHTML = `<div class="ol-box"><h3>💬 Чат</h3>
      <div class="ol-sub-note">Общий чат для всех и личные сообщения друзьям. Реакции — нажмите <b>＋</b> под сообщением. Упоминание пишется как <b>@ник</b>.</div>
      <select class="ol-in" id="chRoom" style="width:100%;margin-bottom:8px"></select>
      <div class="ol-chatlog" id="chLog"></div>
      <div class="ol-row nowrap"><input class="ol-in" id="chText" maxlength="300" placeholder="Сообщение…" autocomplete="off"><button class="ol-btn" data-act="chat-send">➤</button></div>
      <div class="ol-emobar" id="chEmo"></div></div>`;
    $('chText').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
    $('chRoom').addEventListener('change', async e => { chat.room = e.target.value; chat.unread.delete(chat.room); chat.reactFor = null; updateBadges(); await loadChat(chat.room); renderChatLog(); const inp = $('chText'); if (inp) inp.focus(); });
  }
  const sel = $('chRoom'); if (!sel) return;
  const cur = chat.room;
  sel.innerHTML = rooms().map(r => `<option value="${r.id}">${r.ico} ${esc(r.name)}</option>`).join('')
    + friends.friends.map(f => `<option value="${esc(f.name.toLowerCase())}">${f.online ? '🟢' : '⚪'} ${esc(f.name)} (личные)</option>`).join('');
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'global'; chat.room = sel.value;
  const emo = $('chEmo'); if (emo) emo.innerHTML = emojis().map(e => `<span class="ol-emoji-b" data-act="chat-quick" data-emoji="${e}">${e}</span>`).join('');
}
async function loadChat(room) {
  try {
    if (isRoomId(room)) { const r = await req('chat.history', { room }); if (room === 'global') chat.global = r.msgs; else chat.rooms[room] = r.msgs; }
    else { const r = await req('chat.history', { with: room }); chat.dms[room] = r.msgs; }
  } catch (e) {}
  if (sub === 'chat') renderChatLog();
}
function linkify(text) {
  return esc(text).replace(/@([A-Za-z0-9_\u0400-\u04FF]{3,16})/g, '<span class="ol-mention">@$1</span>');
}
function reactHTML(m) {
  const r = m.react || {};
  const chips = Object.keys(r).filter(k => r[k] && r[k].length).map(k => {
    const mine = me && r[k].some(n => String(n).toLowerCase() === String(meta.name).toLowerCase());
    return `<span class="ol-react${mine ? ' mine' : ''}" data-act="react" data-id="${m.id}" data-emoji="${esc(k)}" title="${esc(r[k].slice(0, 10).join(', '))}">${esc(k)} ${r[k].length}</span>`;
  }).join('');
  const open = chat.reactFor === m.id ? '<span class="ol-emoji">' + emojis().map(e => `<span class="ol-emoji-b" data-act="react" data-id="${m.id}" data-emoji="${esc(e)}">${esc(e)}</span>`).join('') + '</span>' : '';
  return `<span class="ol-reacts">${chips}<span class="ol-react add" data-act="react-open" data-id="${m.id}">＋</span>${open}</span>`;
}
function msgNode(m) {
  if (m.sys) { const r = document.createElement('div'); r.className = 'ol-msg ol-sysmsg'; r.textContent = m.text; return r; }
  const row = document.createElement('div'); row.className = 'ol-msg'; row.dataset.mid = m.id;
  const mine = me && m.from.toLowerCase() === String(meta.name).toLowerCase();
  if (mine) row.classList.add('mine');
  row.insertAdjacentHTML('beforeend', avaSmall({ name: m.from, avatar: m.av }));
  const t = document.createElement('span'); t.className = 't'; t.textContent = hhmm(m.at);
  const b = document.createElement('b'); b.textContent = m.from;
  if (m.owner) b.className = 'own'; else if (m.admin) b.className = 'adm'; else if (mine) b.className = 'me';
  b.dataset.act = 'pv-view'; b.dataset.name = m.from; b.title = 'Открыть профиль'; b.classList.add('ol-nmlink');
  const c = m.col ? colorOf(m.col) : null;
  if (c) { b.style.backgroundImage = 'linear-gradient(90deg,' + c.from + ',' + c.to + ')'; b.style.webkitBackgroundClip = 'text'; b.style.backgroundClip = 'text'; b.style.webkitTextFillColor = 'transparent'; }
  const x = document.createElement('span'); x.className = 'txt'; x.innerHTML = ': ' + linkify(m.text);
  row.append(t, b, x);
  if (me && me.admin && chat.room === 'global') { const del = document.createElement('span'); del.className = 'del'; del.dataset.act = 'chat-del'; del.dataset.id = m.id; del.textContent = '🗑'; row.append(del); }
  row.insertAdjacentHTML('beforeend', reactHTML(m));
  return row;
}
function renderChatLog() {
  const log = $('chLog'); if (!log) return;
  const msgs = roomMsgs(chat.room);
  log.innerHTML = ''; msgs.forEach(m => log.appendChild(msgNode(m)));
  if (!msgs.length) { const e = document.createElement('div'); e.className = 'ol-msg sys'; e.textContent = 'Сообщений пока нет'; log.appendChild(e); }
  log.scrollTop = log.scrollHeight;
}
function appendMsg(m) {
  const log = $('chLog'); if (!log) return;
  const sys = log.querySelector('.sys'); if (sys) sys.remove();
  const near = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  log.appendChild(msgNode(m)); if (near) log.scrollTop = log.scrollHeight;
}
async function sendChat() {
  const inp = $('chText'); if (!inp) return;
  const text = inp.value.trim(); if (!text) return;
  inp.value = '';
  try { await req('chat.send', isRoomId(chat.room) ? { text, room: chat.room } : { text, to: chat.room }); }
  catch (e) { T('❌ ' + e.message); inp.value = text; }
}
async function reactTo(msgId, emoji) {
  try { const r = await req('chat.react', { msgId, emoji }); chat.reactFor = null; const m = roomMsgs(chat.room).find(x => x.id === msgId); if (m) m.react = r.react || {}; renderChatLog(); }
  catch (e) { T('❌ ' + e.message); }
}

/* ---------- друзья ---------- */
async function refreshFriends() {
  if (!authed) return;
  try { friends = await req('friends.list'); } catch (e) { return; }
  renderFriends(); fillFriendDatalist(); if ($('chRoom')) renderChatShell();
}
function renderFriends() {
  const d = $('olSub-friends'); if (!d) return;
  const it = (f, acts) => `<div class="ol-item"><span class="grow"><span class="ol-pres${f.online ? ' on' : ''}"></span>${avaSmall(f)}${nickHTML(f)}${roleTag(f)} <span class="ol-dim">· ур. ${f.level || xpLevel(f.xp || 0)}</span></span><span class="acts">${acts}</span></div>`;
  const n = (a, name, label, cls) => `<button class="ol-mini ${cls || ''}" data-act="${a}" data-name="${esc(name)}">${label}</button>`;
  d.innerHTML = `<div class="ol-box"><h3>👥 Друзья</h3>
      <div class="ol-row nowrap" style="margin-top:0"><input class="ol-in" id="frName" placeholder="Ник игрока" maxlength="16" autocomplete="off"><button class="ol-btn" data-act="fr-add">+ Добавить</button></div>
      ${friends.incoming.length ? '<div class="ol-sub-note" style="margin-top:12px">Входящие заявки</div><div class="ol-list">' + friends.incoming.map(f => it(f, n('fr-accept', f.name, '✅ Принять') + n('fr-decline', f.name, '✖', 'red'))).join('') + '</div>' : ''}
      ${friends.outgoing.length ? '<div class="ol-sub-note" style="margin-top:12px">Исходящие заявки</div><div class="ol-list">' + friends.outgoing.map(f => it(f, n('fr-decline', f.name, 'Отменить', 'red'))).join('') + '</div>' : ''}
      <div class="ol-sub-note" style="margin-top:12px">Список друзей (${friends.friends.length})</div>
      <div class="ol-list">${friends.friends.length ? friends.friends.map(f => it(f, n('fr-dm', f.name, '💬') + n('fr-pay', f.name, '💸') + n('fr-remove', f.name, '🗑', 'red'))).join('') : '<div class="ol-empty">Пока никого. Добавьте друга по нику!</div>'}</div></div>`;
}

/* ---------- блэкджек ---------- */
async function refreshBjLobby() {
  if (!authed) return;
  try { const r = await req('bj.tables'); bj.tables = r.tables; bj.game = r.game; bj.myTable = r.myTable; } catch (e) {}
  renderBj();
}
function cardHTML(c) { if (!c) return '<span class="bj-card back">?</span>'; const red = c.s === '♥' || c.s === '♦'; return '<span class="bj-card' + (red ? ' red' : '') + '">' + esc(c.r) + esc(c.s) + '</span>'; }
function handVal(cards) { let t = 0, a = 0; for (const c of cards) { if (c.r === 'A') { a++; t += 11; } else if ('JQK'.includes(c.r)) t += 10; else t += +c.r; } while (t > 21 && a) { t -= 10; a--; } return t; }
function renderBj() {
  const d = $('olSub-bj'); if (!d) return;
  clearInterval(bj.timer); bj.timer = null;
  const g = bj.game;
  if (g) {
    const hidden = g.opp.cards.some(c => !c), oppVis = handVal(g.opp.cards.filter(Boolean));
    let res = '';
    if (g.state === 'done' && g.result) {
      const r = g.result;
      res = `<div class="bj-result ${r.push ? '' : r.youWon ? 'win' : 'lose'}">${r.push ? '🤝 Ничья — ставка возвращена' : r.youWon ? '🏆 Победа! +🪙 ' + F(g.bet) : '😵 Поражение −🪙 ' + F(g.bet)}<small>${esc(r.reason)}</small></div>
        <div class="ol-row"><button class="ol-btn" data-act="bj-close" style="flex:1">К столам</button></div>`;
    }
    d.innerHTML = `<div class="bj-felt">
      <div class="bj-side"><div class="bj-name">${esc(g.opp.name)} ${g.opp.online ? '🟢' : '🔴 отключился'}${g.opp.stood && g.state === 'play' ? ' · ✋ хватит' : ''}</div>
        <div class="bj-cards">${g.opp.cards.map(cardHTML).join('')}</div>
        <div class="bj-total">${g.state === 'done' ? g.opp.total : (hidden ? oppVis + ' + ?' : oppVis)}</div></div>
      <div class="bj-pot">Ставка 🪙 ${F(g.bet)} · Банк 🪙 ${F(g.bet * 2)}</div>
      <div class="bj-side"><div class="bj-name">Вы · ${esc(g.me.name)}${g.me.stood && g.state === 'play' ? ' · ✋ хватит' : ''}</div>
        <div class="bj-cards">${g.me.cards.map(cardHTML).join('')}</div>
        <div class="bj-total">${g.me.total}${g.me.total > 21 ? ' 💥' : ''}</div></div>
      ${g.state === 'play' ? `<div class="bj-turn" id="bjTurn"></div><div class="bj-actions"><button class="ol-btn green" data-act="bj-hit" ${g.yourTurn ? '' : 'disabled'}>➕ Взять</button><button class="ol-btn red" data-act="bj-stand" ${g.yourTurn ? '' : 'disabled'}>✋ Хватит</button></div>` : ''}
      ${res}</div>`;
    if (g.state === 'play') { updateBjTimer(); bj.timer = setInterval(updateBjTimer, 500); }
    return;
  }
  const my = bj.myTable && bj.tables.find(t => t.id === bj.myTable);
  d.innerHTML = `<div class="ol-box"><h3>🃏 Блэкджек 1 на 1</h3>
    <div class="ol-sub-note">Играете друг против друга из одной колоды. У каждого по 2 карты, <b>первая карта соперника скрыта</b>. Ходите по очереди: «Взять» или «Хватит» (30 сек на ход). Больше 21 — поражение. Побеждает тот, у кого ближе к 21; блэкджек с двух карт бьёт 21 из трёх. Ничья — ставки возвращаются. Выигрыш забирает банк. Ставки идут из облачного баланса.</div>
    <div class="ol-row nowrap" style="margin-top:0"><input class="ol-in" id="bjBet" placeholder="Ставка, напр. 5M" autocomplete="off"><button class="ol-btn" data-act="bj-create" ${my ? 'disabled' : ''}>Создать стол</button></div>
    ${my ? `<div class="ol-preview" style="margin-top:10px">⏳ Ваш стол (ставка 🪙 ${F(my.bet)}) ждёт соперника… <button class="ol-mini red" data-act="bj-cancel">Закрыть стол</button></div>` : ''}</div>
    <div class="ol-box"><h3>Открытые столы</h3><div class="ol-list">${bj.tables.length ? bj.tables.map(t => `<div class="ol-item"><span class="grow">🃏 <b>${esc(t.owner)}</b> · ставка 🪙 ${F(t.bet)}</span><span class="acts">${t.id === bj.myTable ? '<span class="ol-dim">ваш</span>' : `<button class="ol-btn" style="padding:7px 14px" data-act="bj-join" data-id="${esc(t.id)}">Играть</button>`}</span></div>`).join('') : '<div class="ol-empty">Столов нет — создайте свой!</div>'}</div></div>`;
}
function updateBjTimer() {
  const g = bj.game, el = $('bjTurn'); if (!g || !el) return;
  const left = Math.max(0, Math.ceil((g.deadline - Date.now()) / 1000));
  el.textContent = (g.yourTurn ? '🎯 Ваш ход' : '⏳ Ход соперника') + ' · ' + left + ' c';
}
async function bjCall(t, o) { try { await req(t, o); } catch (e) { T('❌ ' + e.message); } }

/* ---------- профиль ---------- */
async function refreshProfile() {
  if (!authed) return;
  try { prof = await req('profile.get'); if (me) { me.xp = prof.xp; me.level = prof.level; } } catch (e) {}
  renderProfile(); updateHead();
}
function renderProfile() {
  const d = $('olSub-profile'); if (!d) return;
  const p = prof;
  if (!p) { d.innerHTML = '<div class="ol-box"><div class="ol-empty">Загрузка профиля…</div></div>'; return; }
  const lvl = p.level, lo = p.levelFloor, hi = p.levelNext;
  const pct = hi > lo ? Math.max(0, Math.min(100, Math.round((p.xp - lo) / (hi - lo) * 100))) : 100;
  const st = p.stats || {};
  const colors = (p.colors && p.colors.length ? p.colors : (cfg.colors || []));
  const avatars = (p.avatars && p.avatars.length ? p.avatars : (cfg.avatars || []));
  const waitS = Math.ceil((p.canRenameIn || 0) / 1000);
  const curCol = colorOf(p.color);
  const pc1 = normHex(curCol && curCol.from), pc2 = normHex(curCol && curCol.to);
  const isCustomCol = !!(p.color && String(p.color).charAt(0) === '#');
  d.innerHTML = `<div class="ol-box ol-profbox">
    <div class="ol-profbig">
      <div class="ol-avabig${p.owner ? ' owner' : ''}">${avaInner(p.avatar, p.name)}<span class="ol-lvlbig">${lvl}</span></div>
      <div><div class="ol-who">${nickHTML(p, true)}${roleTag(p)}</div><div class="ol-dim">С нами с ${p.createdAt ? new Date(p.createdAt).toLocaleDateString('ru-RU') : '—'}</div></div>
    </div>
    ${p.bio ? `<div class="ol-bio">«${esc(p.bio)}»</div>` : ''}
    <div class="ol-bigxp"><div class="ol-bigxp-fill" style="width:${pct}%"></div><span class="ol-bigxp-t">${p.xp} XP · уровень ${lvl}</span></div>
    <div class="ol-dim" style="text-align:center;margin-top:6px">${hi > p.xp ? 'До ' + (lvl + 1) + ' уровня: ' + (hi - p.xp) + ' XP' : 'Максимальный уровень!'}</div>
    <div class="ol-stats">
      <div><b>${st.msgs || 0}</b><i>сообщений</i></div>
      <div><b>${st.transfers || 0}</b><i>переводов</i></div>
      <div><b>${st.bj || 0}</b><i>блэкджеков</i></div>
      <div><b>${st.bjWins || 0}</b><i>побед в БД</i></div>
      <div><b>${st.duels || 0}</b><i>дуэлей</i></div>
      <div><b>${st.duelWins || 0}</b><i>побед в дуэлях</i></div>
    </div>
    <div class="ol-kv"><span>Баланс</span><b>🪙 ${F(p.avail)}</b></div>
    <div class="ol-kv"><span>В банке</span><b>🪙 ${F(p.bank ? p.bank.amount : 0)}${p.bank && p.bank.interest ? ' <span class="ol-pos">+' + F(p.bank.interest) + '</span>' : ''}</b></div>
    <div class="ol-kv"><span>Версия облака</span><b>#${p.rev}</b></div>
    <div class="ol-row"><button class="ol-btn sec" data-act="sub-goto" data-name="cloud" style="flex:1">💾 Облако</button><button class="ol-btn sec" data-act="sub-goto" data-name="bank" style="flex:1">🏦 Банк</button><button class="ol-btn sec" data-act="sub-goto" data-name="arcade" style="flex:1">🎲 Аркада</button></div>
  </div>
  <div class="ol-box"><h3>🎨 Кастомизация профиля</h3>
    <div class="ol-sub-note">Аватарку можно выбрать из набора или загрузить своё фото — картинка сама сожмётся до 96×96. Ник меняется раз в ${Math.round((cfg.renameMs || 600000) / 60000)} мин.</div>
    <div class="ol-edit-row">
      <div class="ol-avabig-prev">${avaInner(p.avatar, p.name)}</div>
      <div style="flex:1;min-width:0">
        <div class="ol-row nowrap" style="margin-top:0"><input class="ol-in" id="pfName" maxlength="16" placeholder="Новый ник" value="${esc(meta.name)}" autocomplete="off"><button class="ol-btn" data-act="pf-name" ${waitS > 0 ? 'disabled' : ''}>${waitS > 0 ? 'через ' + waitS + 'с' : 'Сменить ник'}</button></div>
        <div class="ol-row nowrap"><button class="ol-btn sec" data-act="pf-upload">📷 Загрузить фото</button><button class="ol-btn sec" data-act="pf-reset-ava" ${p.avatar ? '' : 'disabled'}>Убрать аватарку</button></div>
      </div>
    </div>
    <input type="file" id="pfFile" accept="image/*" style="display:none">
    <div class="ol-sub-note" style="margin-top:12px">Описание профиля</div>
    <input class="ol-in" id="pfBio" maxlength="140" style="width:100%" placeholder="Пара слов о себе (до 140 символов)" value="${esc(p.bio || '')}" autocomplete="off" spellcheck="false">
    <div class="ol-row" style="margin-top:6px"><button class="ol-btn" data-act="pf-bio" style="flex:1">Сохранить описание</button>${p.bio ? '<button class="ol-btn sec" data-act="pf-bio-clear" style="flex:0 0 auto;padding:9px 14px">🗑</button>' : ''}</div>
    <div class="ol-sub-note" style="margin-top:12px">Аватарки</div>
    <div class="ol-ava-grid">${avatars.map(a => `<span class="ol-ava-opt${p.avatar === a ? ' on' : ''}" data-act="pf-ava" data-name="${esc(a)}">${esc(a)}</span>`).join('')}</div>
    <div class="ol-sub-note" style="margin-top:12px">Готовые цвета ника (градиент)</div>
    <div class="ol-color-grid">
      ${isCustomCol ? `<span class="ol-color-opt on" style="background-image:linear-gradient(90deg,${curCol.from},${curCol.to})" title="Ваш свой цвет"></span>` : ''}
      ${colors.map(c => `<span class="ol-color-opt${(p.color || '') === c.id ? ' on' : ''}" data-act="pf-color" data-name="${esc(c.id)}" title="${esc(c.name)}" style="${c.from ? 'background-image:linear-gradient(90deg,' + c.from + ',' + c.to + ')' : 'background:#2b3548'}"></span>`).join('')}
    </div>
    <div class="ol-sub-note" style="margin-top:12px">Свой HEX-цвет или HEX-градиент</div>
    <div class="ol-row nowrap" style="margin-top:0"><input class="ol-in" id="pfHex" placeholder="#ff8a00 или #ff8a00,#00c2ff" value="${isCustomCol ? esc(p.color) : ''}" autocomplete="off" spellcheck="false"><button class="ol-btn" data-act="pf-hex">Применить</button></div>
    <div class="ol-edit-row" style="margin-top:8px">
      <input type="color" id="pfC1" class="ol-colorpick" value="${pc1}" title="Первый цвет">
      <button class="ol-btn sec" data-act="pf-swap" title="Поменять местами" style="flex:0 0 auto;padding:9px 12px">⇄</button>
      <input type="color" id="pfC2" class="ol-colorpick" value="${pc2}" title="Второй цвет">
      <button class="ol-btn sec" data-act="pf-grad" style="flex:1">Применить градиент</button>
    </div>
    <div class="ol-preview" style="text-align:center">Предпросмотр: <b id="pfPrev" style="${gradInline(pc1, pc2)}">Ваш ник</b></div>
    <div class="ol-row" style="margin-top:8px"><button class="ol-btn sec" data-act="pf-hex-clear" style="flex:1">Обычный цвет</button></div>
  </div>`;
  const f = $('pfFile'); if (f) f.addEventListener('change', onAvaFile);
  const c1el = $('pfC1'), c2el = $('pfC2'), prev = $('pfPrev');
  const paint = () => { if (prev && c1el && c2el) prev.style.cssText = gradInline(c1el.value, c2el.value); };
  if (c1el) c1el.addEventListener('input', paint);
  if (c2el) c2el.addEventListener('input', paint);
}
async function onAvaFile(e) {
  const file = e.target.files && e.target.files[0]; if (!file) return;
  if (!/^image\//.test(file.type)) { T('❌ Нужен файл-картинка'); return; }
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); const u = URL.createObjectURL(file); i.onload = () => { URL.revokeObjectURL(u); res(i); }; i.onerror = rej; i.src = u; });
    const s = 96, cv = document.createElement('canvas'); cv.width = s; cv.height = s;
    const cx = cv.getContext('2d'), k = Math.max(s / img.width, s / img.height);
    const w = img.width * k, h = img.height * k;
    cx.drawImage(img, (s - w) / 2, (s - h) / 2, w, h);
    let data = cv.toDataURL('image/jpeg', 0.72);
    if (data.length > 30000) data = cv.toDataURL('image/jpeg', 0.5);
    const r = await req('profile.setavatar', { avatar: data });
    if (me) me.avatar = r.avatar; if (prof) prof.avatar = r.avatar;
    T('🖼️ Аватарка обновлена'); renderProfile(); updateHead();
  } catch (x) { T('❌ ' + x.message); }
}

/* ---------- банк ---------- */
async function refreshBank() {
  if (!authed) return;
  try { bank = await req('bank.info'); } catch (e) {}
  renderBank();
}
function renderBank() {
  const d = $('olSub-bank'); if (!d) return;
  const b = bank || { amount: 0, interest: 0, rate: cfg.bankRate || 0.002, hours: 0, maxHours: 72, min: cfg.bankMin || 1000 };
  d.innerHTML = `<div class="ol-box"><h3>🏦 Онлайн-банк</h3>
    <div class="ol-sub-note">Положите облачные деньги на вклад — они растут на <b>${(b.rate * 100).toFixed(2)}%/час</b> (проценты капают до ${b.maxHours} ч). Забрать можно в любой момент вместе с процентами.</div>
    <div class="ol-bankpad"><div class="ol-bankval">🪙 ${F(b.amount)}</div><div class="ol-dim">накопленные проценты: <b class="ol-pos">+${F(b.interest)}</b>${b.hours ? ' · ' + b.hours.toFixed(1) + ' ч' : ''}</div></div>
    <div class="ol-row nowrap" style="margin-top:10px"><input class="ol-in" id="bankAmt" placeholder="Сумма вклада, напр. 5M" inputmode="text" autocomplete="off"><button class="ol-btn" data-act="bank-deposit">Вложить</button></div>
    <div class="ol-row"><button class="ol-btn green" data-act="bank-withdraw" ${b.amount > 0 ? '' : 'disabled'} style="flex:1">Снять всё (+проценты)</button><button class="ol-btn sec" data-act="bank-info">🔄</button></div>
    <div class="ol-preview">Минимум 🪙 ${F(b.min)}. Списание идёт из облачного баланса, проценты начисляются при снятии.</div></div>`;
}
async function bankDeposit() {
  if (needSync()) return;
  const el = $('bankAmt'); const a = parseAmt(el ? el.value : '');
  if (a < (cfg.bankMin || 1000)) return T('Минимальный вклад 🪙 ' + F(cfg.bankMin || 1000));
  if (totalMoney() < a) return T('❌ Не хватает денег (нужно 🪙 ' + F(a) + ')');
  try { await pushSave(true); const r = await req('bank.deposit', { amount: a }); bank = r; T('🏦 Вклад принят: 🪙 ' + F(a)); if (el) el.value = ''; await pullWallet(); loadHistory(); renderBank(); updateHead(); }
  catch (e) { T('❌ ' + e.message); }
}
async function bankWithdraw() {
  if (needSync()) return;
  try { const r = await req('bank.withdraw'); T('🏦 Снято 🪙 ' + F(r.paid || 0)); bank = r; await pullWallet(); loadHistory(); renderBank(); updateHead(); }
  catch (e) { T('❌ ' + e.message); }
}

/* ---------- аркада (против заведения, локально) ---------- */
const ARCADE = [
  { id: 'coin', ico: '🪙', name: 'Монетка', desc: 'Орёл или решка — чистые 50/50', opts: [['Орёл', 'o'], ['Решка', 'r']] },
  { id: 'dice', ico: '🎲', name: 'Кости', desc: 'Сумма двух кубиков: до 7, ровно 7 или больше', opts: [['Меньше 7', 'lo'], ['Ровно 7', 'mid'], ['Больше 7', 'hi']] },
];
const R = VCRoul;                                  // рулетка: сектора, ставки, выплаты (roulette.js)
const ROUL_CHIPS = [1000, 10000, 100000, 1000000, 10000000, 100000000];
const rouColor = c => c === 'red' ? '🔴' : c === 'black' ? '⚫' : '🟢';
const rouFace = n => R.pocketColor(n) === 'red' ? '🔴 ' + n : R.pocketColor(n) === 'black' ? '⚫ ' + n : '🟢 0';
const rouStake = () => Object.keys(arcade.bets).reduce((s, k) => s + (arcade.bets[k] || 0), 0);

function renderArcade() {
  const d = $('olSub-arcade'); if (!d) return;
  if (arcade.view === 'roulette') { renderRoulette(d); return; }
  const last = arcade.last && arcade.last.game !== 'roulette' ? arcade.last : null;
  const banner = last ? `<div class="ol-arc-res ${last.win ? 'win' : 'lose'}">${last.win ? '🏆 Выигрыш! +🪙 ' + F(last.payout) : '😵 Мимо −🪙 ' + F(last.bet)}<small>${esc(last.detail)}</small></div>` : '';
  d.innerHTML = `<div class="ol-box"><h3>🎲 Аркада</h3>
    <div class="ol-sub-note">Быстрые игры против заведения прямо в клиенте — ставки из ваших денег, выплата моментально. Минимальная ставка 🪙 1 000.</div>
    <div class="ol-row nowrap" style="margin-top:0"><input class="ol-in" id="arcBet" placeholder="Ставка, напр. 1M" inputmode="text" autocomplete="off"></div>
    ${banner}
    ${ARCADE.map(g => `<div class="ol-arc-card"><div class="ol-arc-head"><span class="ol-arc-ico">${g.ico}</span><div><div class="ol-arc-name">${g.name}</div><div class="ol-dim">${g.desc}</div></div></div>
      <div class="ol-row" style="margin-top:8px">${g.opts.map(o => `<button class="ol-btn sec" data-act="arc-play" data-name="${g.id}" data-choice="${o[1]}" style="flex:1">${o[0]}</button>`).join('')}</div></div>`).join('')}
    <div class="ol-arc-card"><div class="ol-arc-head"><span class="ol-arc-ico">🎡</span><div><div class="ol-arc-name">Рулетка</div><div class="ol-dim">Настоящий стол: числа 0–36, колесо с шариком, фишки на любое поле. Выплаты как в казино: число 35:1, сплит 17:1, стрит 11:1, угол 8:1, линия 5:1, дюжина и колонка 2:1, красное/чёрное 1:1.</div></div></div>
      <div class="ol-row" style="margin-top:8px"><button class="ol-btn" data-act="rou-open" style="flex:1">🎡 Открыть стол</button></div></div>
  </div>`;
}
const diceSum = () => (1 + Math.floor(Math.random() * 6)) + (1 + Math.floor(Math.random() * 6));
async function arcPlay(gameId, choice) {
  if (arcade.busy) return;
  const el = $('arcBet'); const bet = parseAmt(el ? el.value : '');
  if (!bet) return T('Введите ставку');
  if (bet < 1000) return T('Минимальная ставка 🪙 1 000');
  if (totalMoney() < bet) return T('❌ Не хватает денег (нужно 🪙 ' + F(bet) + ')');
  arcade.busy = true;
  spendMoney(bet);
  let win = false, detail = '', mul = 0;
  if (gameId === 'coin') { const side = Math.random() < 0.5 ? 'o' : 'r'; win = side === choice; detail = side === 'o' ? 'Монетка: Орёл' : 'Монетка: Решка'; mul = 1.95; }
  else { const s = diceSum(); const bucket = s < 7 ? 'lo' : s === 7 ? 'mid' : 'hi'; win = bucket === choice; detail = 'Кости: сумма ' + s; mul = choice === 'mid' ? 5.6 : 2.35; }
  const payout = win ? Math.floor(bet * mul) : 0;
  if (win) addMoney(payout, 'auto');
  arcade.last = { game: gameId, win, bet, payout, detail };
  try { saveForced(); updateBalance(); updateAffordability(); updateHead(); } catch (e) {}
  arcade.busy = false;
  renderArcade();
}

/* ============================================================
   РУЛЕТКА: колесо на canvas + шарик (общее для аркады и дуэлей)
   ============================================================ */
let rouBmp = null, rouBmpSize = 0;
/* статичная картинка колеса: обод, лунки, числа, ступица (без указателя и шарика) */
function wheelBitmap(size) {
  if (rouBmp && rouBmpSize === size) return rouBmp;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = document.createElement('canvas');
  c.width = c.height = Math.round(size * dpr);
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = size / 2, cy = size / 2, R0 = size / 2 - 1, RP = R0 * 0.80, RH = R0 * 0.34;
  /* обод */
  const rim = g.createLinearGradient(0, 0, size, size);
  rim.addColorStop(0, '#e3bb59'); rim.addColorStop(.45, '#6e5216'); rim.addColorStop(.75, '#c9a227'); rim.addColorStop(1, '#f0d488');
  g.beginPath(); g.arc(cx, cy, R0, 0, Math.PI * 2); g.fillStyle = rim; g.fill();
  /* дорожка шарика */
  g.beginPath(); g.arc(cx, cy, (RP + R0) / 2, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = (R0 - RP) * 0.92; g.stroke();
  /* сектора */
  const tFont = Math.max(8, Math.round(size * 0.042));
  for (let i = 0; i < 37; i++) {
    const n = R.ORDER[i];
    const a0 = (-90 + i * R.SPAN) * Math.PI / 180, a1 = (-90 + (i + 1) * R.SPAN) * Math.PI / 180;
    const pc = R.pocketColor(n);
    g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, RP, a0, a1); g.closePath();
    g.fillStyle = pc === 'red' ? R.COLORS.red : pc === 'black' ? R.COLORS.black : R.COLORS.green;
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 1; g.stroke();
    const am = (-90 + (i + 0.5) * R.SPAN) * Math.PI / 180;
    g.save();
    g.translate(cx + Math.cos(am) * RP * 0.78, cy + Math.sin(am) * RP * 0.78);
    g.rotate(am + Math.PI / 2);
    g.fillStyle = '#fff'; g.font = '700 ' + tFont + 'px "Segoe UI",system-ui,sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(n), 0, 0);
    g.restore();
  }
  /* спицы и ступица */
  for (let k = 0; k < 10; k++) {
    const a = k * Math.PI / 5;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * RH * 0.4, cy + Math.sin(a) * RH * 0.4);
    g.lineTo(cx + Math.cos(a) * RP * 0.62, cy + Math.sin(a) * RP * 0.62);
    g.strokeStyle = 'rgba(201,162,39,.22)'; g.lineWidth = Math.max(1, size * 0.006); g.stroke();
  }
  const hub = g.createRadialGradient(cx - RH * .35, cy - RH * .35, RH * .1, cx, cy, RH);
  hub.addColorStop(0, '#33405a'); hub.addColorStop(1, '#141a26');
  g.beginPath(); g.arc(cx, cy, RH, 0, Math.PI * 2); g.fillStyle = hub; g.fill();
  g.strokeStyle = '#c9a227'; g.lineWidth = Math.max(1, size * 0.008); g.stroke();
  g.beginPath(); g.arc(cx, cy, RH * 0.42, 0, Math.PI * 2); g.fillStyle = '#0d1119'; g.fill();
  g.strokeStyle = 'rgba(255,216,94,.55)'; g.lineWidth = 1; g.stroke();
  rouBmp = c; rouBmpSize = size;
  return c;
}
function ballDraw(g, cx, cy, ang, rad, size) {
  const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad;
  const r = Math.max(3, size * 0.022);
  const gr = g.createRadialGradient(x - r * .35, y - r * .35, r * .15, x, y, r);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(.6, '#e8eaf0'); gr.addColorStop(1, '#98a0af');
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = gr; g.fill();
  g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 1; g.stroke();
}
/* один кадр: колесо под углом rot (градусы), шарик на своём месте */
function wheelFrame(ctx, size, bmp, rot, ballAng, ballRad) {
  const cx = size / 2, cy = size / 2, R0 = size / 2 - 1, RP = R0 * 0.80;
  ctx.clearRect(0, 0, size, size);
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot * Math.PI / 180);
  ctx.drawImage(bmp, -size / 2, -size / 2, size, size);
  ctx.restore();
  /* метка на ободе сверху (не вращается) — на неё «встаёт» шарик */
  ctx.beginPath();
  ctx.moveTo(cx, RP * 1.02);
  ctx.lineTo(cx - size * 0.024, R0 * 0.96);
  ctx.lineTo(cx + size * 0.024, R0 * 0.96);
  ctx.closePath(); ctx.fillStyle = '#ffd85e'; ctx.fill();
  if (ballAng != null) ballDraw(ctx, cx, cy, ballAng, ballRad, size);
}
/* кадр анимации: requestAnimationFrame + страховка таймером
   (в свёрнутом или фоновом окне rAF не тикает, и спин «зависал» бы) */
function tick(cb) {
  let done = false;
  let raf = 0, to = 0;
  const once = () => { if (done) return; done = true; cancelAnimationFrame(raf); clearTimeout(to); cb(); };
  raf = requestAnimationFrame(once);
  to = setTimeout(once, 33);
}
function wheelPrep(cv, max) {
  const size = Math.max(140, Math.min(max || 320, Math.round(cv.clientWidth || 240)));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(size * dpr)) { cv.width = cv.height = Math.round(size * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, size, dpr };
}
/* крутим колесо до числа number. Promise<угол колеса> — угол нужен, чтобы крутить дальше с того же места */
function spinWheelTo(cv, number, opts) {
  opts = opts || {};
  const { ctx, size } = wheelPrep(cv, opts.max);
  const bmp = wheelBitmap(size);
  const R0 = size / 2 - 1, restR = R0 * 0.74, trackR = R0 * 0.90;
  const from = Number(opts.from) || 0;
  const target = -R.angleOf(number);
  const delta = (((target - from) % 360) + 360) % 360 + (4 + Math.floor(Math.random() * 3)) * 360;
  const ballEnd = -90, ballFrom = ballEnd - (5 + Math.floor(Math.random() * 3)) * 360;
  const dur = opts.dur || 4200, t0 = performance.now();
  const easeW = t => 1 - Math.pow(1 - t, 3), easeB = t => 1 - Math.pow(1 - t, 4);
  return new Promise(resolve => {
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / dur);
      const rot = from + delta * easeW(t);
      const bAng = (ballFrom + (ballEnd - ballFrom) * easeB(t)) * Math.PI / 180;
      const drop = t < 0.6 ? 0 : Math.pow((t - 0.6) / 0.4, 1.7);
      wheelFrame(ctx, size, bmp, rot, bAng, trackR + (restR - trackR) * drop);
      if (t < 1) tick(step); else resolve(rot);
    };
    tick(step);
  });
}
/* нарисовать колесо в покое (после спина — там, где остановилось) */
function drawWheelRest(cv, num, max) {
  if (!cv) return;
  const { ctx, size } = wheelPrep(cv, max);
  const R0 = size / 2 - 1;
  const rot = (num == null) ? 0 : -R.angleOf(num);
  wheelFrame(ctx, size, wheelBitmap(size), rot, num == null ? null : -Math.PI / 2, num == null ? 0 : R0 * 0.74);
}

/* ---------- стол рулетки ---------- */
function rouChipBadge(id, small) {
  const a = arcade.bets[id] || 0; if (!a) return '';
  const def = R.betById(id) || {};
  return `<span class="ol-rou-chip${small ? ' sm' : ''}" title="${esc(def.label || '')} · 🪙 ${F(a)}">${small ? '' : F(a)}</span>`;
}
function rouTableHtml() {
  const spot = (id, cls, style) => R.betById(id) ? `<i class="hzz ${cls}" data-bet="${id}" style="${style}">${rouChipBadge(id, true)}</i>` : '';
  const cell = n => {
    const col = R.colOf(n), row = R.rowOf(n);
    const pc = R.pocketColor(n);
    const z = [];
    if (col < 12) z.push(spot('s:' + n + '-' + (n + 3), 'v', 'right:-5px;top:28%;bottom:28%'));
    if (col > 1) z.push(spot('s:' + (n - 3) + '-' + n, 'v', 'left:-5px;top:28%;bottom:28%'));
    if (row < 2) z.push(spot('s:' + n + '-' + (n + 1), 'h', 'top:-5px;left:28%;right:28%'));
    if (row > 0) z.push(spot('s:' + (n - 1) + '-' + n, 'h', 'bottom:-5px;left:28%;right:28%'));
    if (col < 12 && row < 2) z.push(spot('c:' + n, 'd', 'top:-6px;right:-6px'));
    if (col > 1 && row < 2) z.push(spot('c:' + (n - 3), 'd', 'top:-6px;left:-6px'));
    if (col < 12 && row > 0) z.push(spot('c:' + (n - 1), 'd', 'bottom:-6px;right:-6px'));
    if (col > 1 && row > 0) z.push(spot('c:' + (n - 4), 'd', 'bottom:-6px;left:-6px'));
    if (row === 0) {
      z.push(spot('t:' + n, 'st', 'bottom:-6px;left:33%;right:33%'));
      if (col > 1) z.push(spot('l:' + (n - 3), 'ln', 'bottom:-7px;left:-8px'));
    }
    return `<div class="ol-rou-num rb-${pc}" data-bet="n:${n}" style="grid-column:${col + 1};grid-row:${3 - row}">${n}${rouChipBadge('n:' + n)}${z.join('')}</div>`;
  };
  const cells = [`<div class="ol-rou-num ol-rou-zero rb-green" data-bet="n:0" style="grid-column:1;grid-row:1/4">0${rouChipBadge('n:0')}</div>`];
  for (let n = 1; n <= 36; n++) cells.push(cell(n));
  for (let row = 0; row < 3; row++) {
    const k = 3 - row;
    cells.push(`<div class="ol-rou-third ol-rou-col" data-bet="k:${k}" style="grid-column:14;grid-row:${3 - row}">2:1${rouChipBadge('k:' + k)}</div>`);
  }
  [[1, 2, 6], [2, 6, 10], [3, 10, 14]].forEach(([d, a, b]) => cells.push(`<div class="ol-rou-third" data-bet="d:${d}" style="grid-column:${a}/${b};grid-row:4">${d * 12 - 11}-${d * 12}${rouChipBadge('d:' + d)}</div>`));
  [['low', '1-18', 2, 4, ''], ['even', 'Чёт', 4, 6, ''], ['red', '🔴 Красное', 6, 8, 'rb-red'], ['black', '⚫ Чёрное', 8, 10, 'rb-black'], ['odd', 'Нечет', 10, 12, ''], ['high', '19-36', 12, 14, '']]
    .forEach(([id, label, a, b, cls]) => cells.push(`<div class="ol-rou-third ol-rou-even ${cls}" data-bet="${id}" style="grid-column:${a}/${b};grid-row:5">${label}${rouChipBadge(id)}</div>`));
  return cells.join('');
}
function rouUpdateStats() {
  const s = $('rouStake'); if (s) s.textContent = '🪙 ' + F(rouStake());
  const t = $('rouTable'); if (t) t.innerHTML = rouTableHtml();
  const b = $('rouSpin'); if (b) b.disabled = !!arcade.busy || !rouStake();
}
function renderRoulette(d) {
  const last = arcade.last && arcade.last.game === 'roulette' ? arcade.last : null;
  const res = last
    ? `<div class="ol-arc-res ${last.net > 0 ? 'win' : last.net < 0 ? 'lose' : ''}">${last.net > 0 ? '🏆 +🪙 ' + F(last.net) : last.net < 0 ? '😵 −🪙 ' + F(-last.net) : '🤝 без изменений'}<small>Выпало ${rouFace(last.num)} · поставлено 🪙 ${F(last.stake)} · возврат 🪙 ${F(last.returned)}${last.hits.length ? ' · сыграло: ' + esc(last.hits.map(h => h.label).join(', ')) : ''}</small></div>`
    : '';
  d.innerHTML = `<div class="ol-box">
    <div class="ol-rou-head"><h3>🎡 Рулетка</h3><button class="ol-mini" data-act="rou-back">← К играм</button></div>
    <div class="ol-rou-top">
      <div class="ol-rou-wheelwrap"><canvas class="ol-rou-wheel" id="rouCv"></canvas><div class="ol-rou-out" id="rouOut">${last ? '' : 'Выбирайте фишки и ставьте на поле'}</div></div>
      <div class="ol-rou-side">
        ${res}
        <div class="ol-rou-stake">Ставка: <b id="rouStake">🪙 ${F(rouStake())}</b></div>
        <div class="ol-rou-chips">${ROUL_CHIPS.map(v => `<button class="ol-rou-chipbtn${arcade.chip === v ? ' active' : ''}" data-act="rou-chip" data-v="${v}">${F(v)}</button>`).join('')}</div>
        <div class="ol-row"><button class="ol-btn sec" data-act="rou-undo" style="flex:1">↩ Снять</button><button class="ol-btn sec" data-act="rou-clear" style="flex:1">Очистить</button></div>
        <button class="ol-btn ol-rou-spin" data-act="rou-spin" id="rouSpin"${arcade.busy ? ' disabled' : ''}>🎡 Крутить${arcade.busy ? '…' : ''}</button>
      </div>
    </div>
    <div class="ol-rou-scroll"><div class="ol-rou-table" id="rouTable">${rouTableHtml()}</div></div>
    <div class="ol-sub-note" style="margin-top:10px">Правый клик по полю (или клик с Shift) снимает фишку с этого поля. Зеро (0) забирает все ставки, кроме прямой на 0. Преимущество заведения — 2.7%, как в настоящем казино.</div>
  </div>`;
  drawWheelRest($('rouCv'), arcade.num, 320);
}
/* фишка на поле */
function rouPlace(id, remove) {
  if (arcade.busy || !R.betById(id)) return;
  if (remove) {
    if (arcade.bets[id]) { delete arcade.bets[id]; arcade.stack = (arcade.stack || []).filter(x => x.id !== id); }
  } else {
    const add = arcade.chip;
    if (totalMoney() < rouStake() + add) return T('❌ Не хватает денег');
    arcade.bets[id] = (arcade.bets[id] || 0) + add;
    arcade.stack = (arcade.stack || []); arcade.stack.push({ id, amount: add });
  }
  rouUpdateStats();
}
function rouUndo() {
  const st = arcade.stack || [];
  const last = st.pop();
  if (!last) return;
  const cur = arcade.bets[last.id] || 0;
  if (cur > last.amount) arcade.bets[last.id] = cur - last.amount; else delete arcade.bets[last.id];
  rouUpdateStats();
}
function rouClear() { arcade.bets = {}; arcade.stack = []; rouUpdateStats(); }
async function rouSpin() {
  if (arcade.busy) return;
  const bets = Object.keys(arcade.bets).map(id => ({ id, amount: arcade.bets[id] }));
  const stake = bets.reduce((s, b) => s + b.amount, 0);
  if (!stake) return T('Поставьте фишки на поле');
  if (stake < 1000) return T('Минимальная ставка 🪙 1 000');
  if (totalMoney() < stake) return T('❌ Не хватает денег (нужно 🪙 ' + F(stake) + ')');
  const cv = $('rouCv'); if (!cv) return;
  arcade.busy = true;
  const n = Math.floor(Math.random() * 37);
  const r = R.evaluate(bets, n);
  spendMoney(stake);
  if (r.returned) addMoney(r.returned, 'auto');
  try { saveForced(); } catch (e) {}
  arcade.num = n;
  arcade.last = { game: 'roulette', num: n, color: r.color, stake, returned: r.returned, net: r.net, hits: r.hits };
  arcade.bets = {}; arcade.stack = [];
  rouUpdateStats();
  const out = $('rouOut'); if (out) out.textContent = 'Колесо крутится…';
  const rot = await spinWheelTo(cv, n, { from: Number(arcade.angle) || 0, dur: 4200 });
  arcade.angle = rot % 360;
  arcade.busy = false;
  try { updateBalance(); updateAffordability(); } catch (e) {}
  updateHead();
  renderArcade();
  T(r.net > 0 ? '🏆 Рулетка: +🪙 ' + F(r.net) : r.net < 0 ? '😵 Рулетка: −🪙 ' + F(-r.net) : '🤝 Рулетка: без изменений');
}

/* ---------- дуэли 1 на 1 ---------- */
async function refreshDuel() {
  if (!authed) return;
  try { const r = await req('duel.tables'); duel.tables = r.tables; duel.myTable = r.myTable; } catch (e) {}
  renderDuel();
}
function duelName(g) { return g === 'coin' ? 'монетка' : g === 'roulette' ? 'рулетка' : 'кости'; }
function duelLabel(t) {
  if (t.game === 'coin') return '🪙 Монетка';
  if (t.game === 'roulette') return '🎡 Рулетка на ' + (t.color === 'black' ? '⚫ чёрное' : '🔴 красное');
  return '🎲 Кости';
}
function duelSpinStart(res) {
  const cv = $('duelCv'); if (!cv) return;
  const info = $('duelWheel'), out = $('duelOut');
  const done = () => {
    if (out) out.style.display = '';
    if (info) info.textContent = res.num == null ? '' : 'Выпало ' + rouFace(res.num);
  };
  if (res.num == null) return done();
  const key = String(res.id) + ':' + res.num;
  if (duel.spinKey === key) { drawWheelRest(cv, res.num, 300); return done(); }
  duel.spinKey = key;
  spinWheelTo(cv, res.num, { dur: 4200, max: 300 }).then(() => {
    done();
    T(res.push ? '🤝 Рулетка: зеро — ставки возвращены' : res.youWon ? '🏆 Рулетка: +🪙 ' + F(res.bet) : '😵 Рулетка: −🪙 ' + F(res.bet));
  });
}
function renderDuelRoulette(d, res) {
  const myC = res.myColor || 'red', opC = res.oppColor || (myC === 'red' ? 'black' : 'red');
  const place = c => (c === 'red' ? '🔴 красное' : '⚫ чёрное');
  const cls = res.push ? '' : res.youWon ? 'win' : 'lose';
  const out = res.push ? '🤝 Зеро — ставки возвращены' : res.youWon ? '🏆 Победа! +🪙 ' + F(res.bet) : '😵 Поражение −🪙 ' + F(res.bet);
  d.innerHTML = `<div class="ol-box ol-duelbox ${cls}">
    <h3>🎡 Рулетка · ставка 🪙 ${F(res.bet)}</h3>
    <div class="ol-duel-rou">
      <div class="ol-duel-pick"><div class="ol-duel-lab">Вы</div><div class="ol-duel-pickv ${myC}">${place(myC)}</div></div>
      <div class="ol-duel-vs">VS</div>
      <div class="ol-duel-pick"><div class="ol-duel-lab">${esc(res.opp)}</div><div class="ol-duel-pickv ${opC}">${place(opC)}</div></div>
    </div>
    <div class="ol-duel-wheelwrap"><canvas id="duelCv" class="ol-rou-wheel"></canvas><div class="ol-rou-out" id="duelWheel">Колесо крутится…</div></div>
    <div class="bj-result ${cls} ol-duel-out" id="duelOut" style="display:none">${out}<small>${esc(res.reason)}</small></div>
    <div class="ol-row"><button class="ol-btn" data-act="duel-close" style="flex:1">Ещё дуэль</button></div></div>`;
  duelSpinStart(res);
}
function renderDuel() {
  const d = $('olSub-duel'); if (!d) return;
  const res = duel.res;
  if (res) {
    if (res.game === 'roulette') return renderDuelRoulette(d, res);
    d.innerHTML = `<div class="ol-box ol-duelbox ${res.push ? '' : res.youWon ? 'win' : 'lose'}">
      <h3>${res.game === 'coin' ? '🪙 Монетка' : '🎲 Кости'} · ставка 🪙 ${F(res.bet)}</h3>
      <div class="ol-duel-rolls"><div><div class="ol-duel-lab">Вы</div><div class="ol-duel-val">${esc(res.game === 'coin' ? (res.myRoll ? '🪙 ' + res.myRoll : '—') : '🎲 ' + res.myRoll)}</div></div>
        <div class="ol-duel-vs">VS</div>
        <div><div class="ol-duel-lab">${esc(res.opp)}</div><div class="ol-duel-val">${esc(res.game === 'coin' ? '🪙 ' + res.oppRoll : '🎲 ' + res.oppRoll)}</div></div></div>
      <div class="bj-result ${res.push ? '' : res.youWon ? 'win' : 'lose'}">${res.push ? '🤝 Ничья — ставка возвращена' : res.youWon ? '🏆 Победа! +🪙 ' + F(res.bet) : '😵 Поражение −🪙 ' + F(res.bet)}<small>${esc(res.reason)}</small></div>
      <div class="ol-row"><button class="ol-btn" data-act="duel-close" style="flex:1">Ещё дуэль</button></div></div>`;
    return;
  }
  const my = duel.myTable && duel.tables.find(t => t.id === duel.myTable);
  d.innerHTML = `<div class="ol-box"><h3>⚔️ Дуэли 1 на 1</h3>
    <div class="ol-sub-note">Вызов другому игроку. <b>Кости</b> — у кого больше, тот забирает банк (ничья — возврат). <b>Монетка</b> — чистые 50/50. <b>Рулетка</b> — вы выбираете цвет, соперник получает противоположный: чей цвет выпал, тот забирает банк, зеро (0) возвращает ставки. Деньги идут из облачного баланса.</div>
    <div class="ol-row nowrap" style="margin-top:0"><select class="ol-in" id="duelGame" style="flex:0 0 132px"><option value="dice">🎲 Кости</option><option value="coin">🪙 Монетка</option><option value="roulette">🎡 Рулетка</option></select>
      <select class="ol-in" id="duelColor" style="flex:0 0 122px;display:none"><option value="red">🔴 Красное</option><option value="black">⚫ Чёрное</option></select>
      <input class="ol-in" id="duelBet" placeholder="Ставка, напр. 5M" autocomplete="off"></div>
    <div class="ol-row nowrap" style="margin-top:8px"><button class="ol-btn" data-act="duel-create" style="flex:1" ${my ? 'disabled' : ''}>⚔️ Создать вызов</button></div>
    ${my ? `<div class="ol-preview" style="margin-top:10px">⏳ Ваш вызов (${duelName(my.game)}, 🪙 ${F(my.bet)}) ждёт соперника… <button class="ol-mini red" data-act="duel-cancel">Отменить</button></div>` : ''}</div>
    <div class="ol-box"><h3>Открытые вызовы</h3><div class="ol-list">${duel.tables.length ? duel.tables.map(t => {
      const free = t.color === 'black' ? 'red' : 'black';
      const joinBtn = t.game === 'roulette'
        ? `<button class="ol-btn" style="padding:7px 12px" data-act="duel-join" data-id="${esc(t.id)}" data-color="${free}" title="Создатель уже поставил на другой цвет">Принять на ${free === 'red' ? '🔴' : '⚫'}</button>`
        : `<button class="ol-btn" style="padding:7px 14px" data-act="duel-join" data-id="${esc(t.id)}">Принять</button>`;
      return `<div class="ol-item"><span class="grow">${duelLabel(t)} · <b>${esc(t.owner)}</b> · 🪙 ${F(t.bet)}</span><span class="acts">${t.id === duel.myTable ? '<span class="ol-dim">ваш</span>' : joinBtn}</span></div>`;
    }).join('') : '<div class="ol-empty">Вызовов нет — создайте свой!</div>'}</div></div>`;
}
async function duelCreate() {
  if (needSync()) return;
  const b = parseAmt(($('duelBet') || {}).value);
  if (b < cfg.minBet) return T('Минимальная ставка 🪙 ' + F(cfg.minBet));
  if (totalMoney() < b) return T('❌ Не хватает денег');
  const game = ($('duelGame') || {}).value || 'dice';
  const color = ($('duelColor') || {}).value === 'black' ? 'black' : 'red';
  await pushSave(true);
  try { const r = await req('duel.create', { game, bet: b, color }); duel.myTable = r.table; duel.spinKey = ''; renderDuel(); T('⚔️ Вызов создан'); } catch (e) { T('❌ ' + e.message); }
}
async function duelJoin(id, color) {
  if (needSync() || duel.busy) return;
  duel.busy = true; duel.spinKey = '';
  await pushSave(true);
  try { await req('duel.join', { table: id, color }); duel.myTable = null; } catch (e) { duel.busy = false; T('❌ ' + e.message); }
}

/* ---------- список игроков ---------- */
async function refreshPlayers() {
  if (!authed) return;
  try { const r = await req('players.list', { q: players.q }); players = { list: r.players || [], total: r.total || 0, online: r.online || 0, q: players.q }; } catch (e) { return; }
  renderPlayers();
}
function renderPlayers() {
  const d = $('olSub-players'); if (!d) return;
  const p = players || { list: [], q: '', total: 0, online: 0 };
  const self = String(meta.name || '').toLowerCase();
  const fr = new Set((friends && friends.friends ? friends.friends : []).map(f => f.name.toLowerCase()));
  const row = u => {
    const meRow = u.name.toLowerCase() === self;
    const acts = meRow ? '<span class="ol-dim">это вы</span>'
      : (fr.has(u.name.toLowerCase()) ? `<button class="ol-mini" data-act="pl-dm" data-name="${esc(u.name)}" title="Написать">💬</button>` : `<button class="ol-mini" data-act="pl-add" data-name="${esc(u.name)}" title="В друзья">➕</button>`)
        + `<button class="ol-mini" data-act="pl-pay" data-name="${esc(u.name)}" title="Перевести монеты">💸</button>`;
    return `<div class="ol-item"><span class="grow ol-player-row"><span class="${u.online ? 'ol-badge-online' : 'ol-badge-off'}"></span>${avaSmall(u)}${nickHTML(u)}${roleTag(u)} <span class="ol-dim">· ур. ${u.level || xpLevel(u.xp || 0)}</span></span><span class="acts">${acts}</span></div>`;
  };
  d.innerHTML = `<div class="ol-box"><h3>🧑‍🤝‍🧑 Игроки <span class="ol-tag">${p.online} онлайн · ${p.total} всего</span></h3>
    <div class="ol-sub-note">Список всех зарегистрированных игроков. Зелёная точка — в сети. Нажмите на ник, чтобы открыть профиль, или используйте кнопки: друзья, сообщение, перевод.</div>
    <div class="ol-row nowrap" style="margin-top:0"><input class="ol-in" id="plQ" placeholder="Поиск по нику" value="${esc(p.q || '')}" maxlength="16" autocomplete="off"><button class="ol-btn sec" data-act="pl-refresh">🔄</button></div>
    <div class="ol-list">${p.list.length ? p.list.map(row).join('') : '<div class="ol-empty">Никого не найдено</div>'}</div></div>`;
}

/* ---------- чужой профиль ---------- */
async function openProfile(name) {
  if (!authed) return;
  let p;
  try { p = await req('profile.view', { name }); } catch (e) { return T('❌ ' + e.message); }
  closeProfile();
  const lvl = p.level, lo = p.levelFloor, hi = p.levelNext;
  const pct = hi > lo ? Math.max(0, Math.min(100, Math.round((p.xp - lo) / (hi - lo) * 100))) : 100;
  const st = p.stats || {};
  let act = '';
  if (p.self) act = '<span class="ol-dim">Это вы</span>';
  else {
    if (p.friend) act += '<button class="ol-btn sec" disabled>✓ В друзьях</button>';
    else if (p.outgoing) act += '<button class="ol-btn sec" disabled>⏳ Заявка отправлена</button>';
    else if (p.incoming) act += `<button class="ol-btn green" data-act="pv-accept" data-name="${esc(p.name)}">✅ Принять заявку</button>`;
    else act += `<button class="ol-btn" data-act="pv-add" data-name="${esc(p.name)}">➕ В друзья</button>`;
    if (p.friend) act += `<button class="ol-btn sec" data-act="pv-dm" data-name="${esc(p.name)}">💬 Написать</button>`;
    act += `<button class="ol-btn sec" data-act="pv-pay" data-name="${esc(p.name)}">💸 Перевести</button>`;
  }
  const el = document.createElement('div');
  el.className = 'ol-pmodal'; el.id = 'olProfileModal';
  el.innerHTML = `<div class="ol-pcard">
    <button class="ol-pclose" data-act="pv-close" title="Закрыть">✖</button>
    <div class="ol-profbig">
      <div class="ol-avabig${p.owner ? ' owner' : ''}">${avaInner(p.avatar, p.name)}<span class="ol-lvlbig">${lvl}</span></div>
      <div><div class="ol-who">${nickHTML(p, true)}${roleTag(p)}</div>
        <div class="ol-dim">${p.online ? '🟢 в сети' : '⚪ не в сети'} · был(а) ${relTime(p.lastSeen)}</div>
        <div class="ol-dim">С нами с ${p.createdAt ? new Date(p.createdAt).toLocaleDateString('ru-RU') : '—'}</div></div>
    </div>
    ${p.bio ? `<div class="ol-bio">«${esc(p.bio)}»</div>` : ''}
    <div class="ol-bigxp"><div class="ol-bigxp-fill" style="width:${pct}%"></div><span class="ol-bigxp-t">${p.xp} XP · уровень ${lvl}</span></div>
    <div class="ol-dim" style="text-align:center;margin-top:6px">${hi > p.xp ? 'До ' + (lvl + 1) + ' уровня: ' + (hi - p.xp) + ' XP' : 'Максимальный уровень'}</div>
    <div class="ol-stats">
      <div><b>${st.msgs || 0}</b><i>сообщений</i></div>
      <div><b>${st.transfers || 0}</b><i>переводов</i></div>
      <div><b>${st.bj || 0}</b><i>блэкджеков</i></div>
      <div><b>${st.bjWins || 0}</b><i>побед в БД</i></div>
      <div><b>${st.duels || 0}</b><i>дуэлей</i></div>
      <div><b>${st.duelWins || 0}</b><i>побед в дуэлях</i></div>
    </div>
    <div class="ol-kv"><span>Друзей</span><b>${p.friends || 0}</b></div>
    <div class="ol-kv"><span>Баланс</span><b>🪙 ${F(p.avail)}</b></div>
    <div class="ol-row" style="margin-top:12px">${act}</div>
  </div>`;
  el.addEventListener('click', e => { if (e.target === el) closeProfile(); });
  ($('panel-online') || document.body).appendChild(el);
}
function closeProfile() { const m = document.getElementById('olProfileModal'); if (m) m.remove(); }

/* ---------- лидерборд ---------- */
async function refreshTop() {
  if (!authed) return;
  try { top = await req('leaderboard'); } catch (e) {}
  renderTop();
}
function renderTop() {
  const d = $('olSub-top'); if (!d) return;
  if (!top) { d.innerHTML = '<div class="ol-box"><div class="ol-empty">Загрузка рейтинга…</div></div>'; return; }
  const medal = i => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + '.';
  const xpRows = top.xp.map((u, i) => `<div class="ol-item"><span class="grow"><span class="ol-dim">${medal(i)}</span> <span class="ol-pres${u.online ? ' on' : ''}"></span>${avaSmall(u)}${nickHTML(u)}${roleTag(u)} <span class="ol-dim">· ур. ${u.level}</span></span><span class="ol-tag">${u.xp} XP</span></div>`).join('') || '<div class="ol-empty">Пусто</div>';
  const mRows = top.money.map((u, i) => `<div class="ol-item"><span class="grow"><span class="ol-dim">${medal(i)}</span> <span class="ol-pres${u.online ? ' on' : ''}"></span>${avaSmall(u)}${nickHTML(u)}${roleTag(u)} <span class="ol-dim">· ур. ${u.level}</span></span><span class="ol-tag gold">🪙 ${F(u.money)}</span></div>`).join('') || '<div class="ol-empty">Пусто</div>';
  d.innerHTML = `<div class="ol-box"><h3>🏆 Лидеры по опыту</h3><div class="ol-sub-note">Опыт растёт за чат, переводы, блэкджек и дуэли, плюс ежедневный вход.</div><div class="ol-list">${xpRows}</div></div>
    <div class="ol-box"><h3>💰 Богатейшие игроки</h3><div class="ol-sub-note">Баланс облака (вклады в банке не учитываются). Всего игроков: ${top.total}.</div><div class="ol-list">${mRows}</div></div>`;
}

/* ---------- админка ---------- */
async function refreshAdmin() {
  if (!authed || !me || !me.admin) return;
  try { const r = await req('admin.users', { q: adm.q }); adm.users = r.users; adm.stats = { total: r.total, online: r.online, tables: r.tables, games: r.games }; } catch (e) { T('❌ ' + e.message); }
  if (me.owner) { try { adm.rel = await req('admin.releasestatus'); } catch (e) {} }
  renderAdmin();
}
/* где сервер может собрать обновление (данные admin.releasestatus) */
function relInfoText() {
  const v = esc(window.VC_VERSION || '—');
  const r = adm.rel;
  if (!r) return 'установлено: v' + v;
  let where;
  if (r.running && r.mode) where = r.mode === 'cloud' ? 'идёт сборка в облаке GitHub' : 'идёт сборка на этом компьютере';
  else if (r.auto === 'local') where = 'сборка: этот компьютер';
  else if (r.auto === 'cloud') where = 'сборка: облако GitHub';
  else where = 'собирать нечем';
  const miss = [];
  if (!r.local && r.missing && r.missing.length) miss.push('на этом ПК нет: ' + r.missing.join(', '));
  if (!r.cloud) miss.push('нет доступа к GitHub (токен/репозиторий)');
  return 'установлено: v' + v + ' · ' + where + (miss.length ? ' · ' + miss.join('; ') : '') + (r.cloud && r.repo ? ' · ' + esc(r.repo) : '');
}
function relModeHint() {
  const r = adm.rel;
  if (!r) return '';
  return r.auto === 'local' ? ' (этот компьютер)' : (r.auto === 'cloud' ? ' (облако GitHub)' : '');
}
function renderAdmin() {
  const d = $('olSub-admin'); if (!d || !me || !me.admin) return;
  const s = adm.stats || { total: 0, online: 0, tables: 0, games: 0 };
  const btn = (a, n, label, cls) => `<button class="ol-mini ${cls || ''}" data-act="${a}" data-name="${esc(n)}">${label}</button>`;
  d.innerHTML = `<div class="ol-box"><h3>🛡️ Админ-панель</h3>
    <div class="ol-adm-stats"><div><b>${s.total}</b><i>игроков</i></div><div><b>${s.online}</b><i>онлайн</i></div><div><b>${s.tables}</b><i>столов</i></div><div><b>${s.games}</b><i>игр</i></div></div>
    <div class="ol-row nowrap"><input class="ol-in" id="admBc" placeholder="Объявление всем игрокам" maxlength="200"><button class="ol-btn" data-act="adm-bc">📢</button></div>
    <div class="ol-row nowrap"><input class="ol-in" id="admQ" placeholder="Поиск игрока" value="${esc(adm.q)}"><button class="ol-btn sec" data-act="adm-refresh">🔄</button><button class="ol-btn sec" data-act="adm-audit">📜</button></div></div>
    ${adm.audit ? '<div class="ol-box"><h3>📜 Журнал действий</h3><div class="ol-list">' + (adm.audit.length ? adm.audit.map(a => `<div class="ol-item"><span class="grow"><span class="ol-dim">${hhmm(a.at)}</span> <b>${esc(a.admin)}</b> ${esc(a.action)} <span class="ol-dim">${esc(a.detail)}</span></span></div>`).join('') : '<div class="ol-empty">Пусто</div>') + '</div></div>' : ''}
    ${me.owner ? `<div class="ol-box ol-owner"><h3>👑 Администраторы</h3>
      <div class="ol-sub-note">Админку выдаёт только владелец. Админы не могут назначать других админов и не могут трогать владельца.</div>
      <div class="ol-row nowrap" style="margin-top:0"><input class="ol-in" id="admNew" placeholder="Ник нового админа" maxlength="16" autocomplete="off"><button class="ol-btn" data-act="adm-add">➕ Назначить</button></div>
      <div class="ol-list">${adm.users.filter(u => u.admin && !u.owner).map(u => `<div class="ol-item"><span class="grow"><span class="ol-pres${u.online ? ' on' : ''}"></span><b>${esc(u.name)}</b>${roleTag(u)}</span><span class="acts">${btn('adm-demote', u.name, 'Снять', 'red')}</span></div>`).join('') || '<div class="ol-empty">Других админов пока нет</div>'}</div></div>` : ''}
    ${me.owner ? `<div class="ol-box ol-owner"><h3>🚀 Выпуск обновления</h3>
      <div class="ol-sub-note">Игра заблокируется для всех игроков, соберутся EXE и APK и попадут в GitHub Releases. Занимает 5–15 минут.</div>
      <div class="ol-row nowrap" style="margin-top:0"><input class="ol-in" id="relVer" placeholder="версия, напр. 1.0.7 (пусто — авто)" maxlength="16" autocomplete="off"><button class="ol-btn" data-act="adm-release">🚀 Выпустить</button></div>
      <input class="ol-in" id="relNotes" placeholder="Что нового (увидят игроки)" maxlength="300" autocomplete="off" style="width:100%;margin-top:6px">
      <select class="ol-in" id="relMode" autocomplete="off" style="width:100%;margin-top:6px">
        <option value="auto">Где собирать: авто${relModeHint()}</option>
        <option value="local">Где собирать: только этот компьютер</option>
        <option value="cloud">Где собирать: только GitHub (облако)</option>
      </select>
      <div class="ol-dim" id="relInfo">${relInfoText()}</div>
      <div class="ol-dim" id="relState"></div></div>` : ''}
    <div class="ol-box"><h3>Игроки</h3><div class="ol-list">${adm.users.map(u => {
      const self = u.name.toLowerCase() === String(meta.name).toLowerCase();
      const prot = self || u.owner || (u.admin && !me.owner);   /* нельзя трогать: себя, владельца, чужого админа (если ты не владелец) */
      const tags = roleTag(u) + (u.banned ? `<span class="ol-tag red">${u.banAuto ? '🤖 АВТОБАН' : 'БАН'}</span>` : '') + (u.muted ? '<span class="ol-tag">МУТ</span>' : '');
      const acts = btn('adm-give', u.name, '💰 Выдать')
        + (u.banned ? btn('adm-unban', u.name, '✅ Разбан') : '')
        + (prot ? '' : btn('adm-take', u.name, '➖ Списать') + (u.muted ? btn('adm-unmute', u.name, '🔊 Размут') : btn('adm-mute', u.name, '🔇 Мут')) + (u.banned ? '' : btn('adm-ban', u.name, '🚫 Бан', 'red')) + btn('adm-kick', u.name, '👢') + btn('adm-pass', u.name, '🔑'));
      return `<div class="ol-item col"><div><span class="ol-pres${u.online ? ' on' : ''}"></span><b>${esc(u.name)}</b>${tags} <span class="ol-dim">· 🪙 ${F(u.avail)}</span></div><div class="acts" style="margin-top:6px;justify-content:flex-start">${acts}</div></div>`;
    }).join('') || '<div class="ol-empty">Никого не найдено</div>'}</div></div>`;
}

async function admAction(act, name) {
  try {
    if (act === 'adm-give' || act === 'adm-take') { const a = parseAmt(prompt((act === 'adm-give' ? 'Сколько выдать' : 'Сколько списать') + ' игроку ' + name + '? (5K, 2M, 1B…)')); if (!a) return; await req('admin.give', { name, amount: a, take: act === 'adm-take' }); T('✅ Готово'); }
    else if (act === 'adm-mute') { const m = prompt('Мут на сколько минут?', '10'); if (!m) return; await req('admin.mute', { name, minutes: +m }); T('🔇 Заглушён'); }
    else if (act === 'adm-unmute') { await req('admin.unmute', { name }); T('🔊 Размучен'); }
    else if (act === 'adm-ban') { const m = prompt('Бан на сколько минут? (0 = навсегда)', '0'); if (m === null) return; const reason = prompt('Причина:', '') || ''; await req('admin.ban', { name, minutes: +m || 0, reason }); T('🚫 Забанен'); }
    else if (act === 'adm-unban') { await req('admin.unban', { name }); T('✅ Разбанен'); }
    else if (act === 'adm-demote') { if (!confirm('Снять права администратора у ' + name + '?')) return; await req('admin.remove', { name }); T('🛡️ Права сняты'); }
    else if (act === 'adm-kick') { await req('admin.kick', { name }); T('👢 Отключён'); }
    else if (act === 'adm-pass') { const p = prompt('Новый пароль для ' + name + ' (от 6 символов):'); if (!p) return; await req('admin.setpass', { name, password: p }); T('🔑 Пароль изменён'); }
    refreshAdmin();
  } catch (e) { T('❌ ' + e.message); }
}

/* ============================================================
   СОБЫТИЯ ИНТЕРФЕЙСА
   ============================================================ */
async function authSubmit(register) {
  const name = ($('olName').value || '').trim(), password = $('olPass').value || '', msg = $('olAuthMsg');
  meta.server = ($('olServer').value || '').trim() || meta.server;
  if (!meta.server) { msg.textContent = 'Укажите адрес сервера (⚙️ внизу)'; return; }
  msg.textContent = '⏳ …';
  try {
    const r = await httpPost(register ? '/api/register' : '/api/login', { name, password });
    meta.token = r.token; meta.name = r.name; meta.rev = 0; saveMeta();
    retry = 0; connect();
  } catch (e) { msg.textContent = '❌ ' + e.message; }
}
function logout() {
  if (!confirm('Выйти из онлайн-аккаунта? Локальное сохранение останется на этом устройстве.')) return;
  disconnect(); meta.token = ''; meta.name = ''; meta.rev = 0; saveMeta();
  authed = false; me = null; syncReady = false; chat = { global: [], rooms: {}, dms: {}, room: 'global', unread: new Set(), reactFor: null }; bj = { tables: [], game: null, myTable: null, timer: null }; duel = { tables: [], myTable: null, res: null, busy: false }; prof = null; top = null; bank = null; players = { list: [], q: '', total: 0, online: 0 }; arcade = { busy: false, last: null, pick: '', view: 'list', chip: 1000, bets: {}, stack: [], num: null, angle: 0 }; sub = 'profile';
  buildPanel(); setStatus();
}
function onClick(e) {
  const el = e.target.closest('[data-act],[data-sub],[data-bet]'); if (!el) return;
  if (el.dataset.bet) return rouPlace(el.dataset.bet, e.shiftKey || e.ctrlKey);
  if (el.dataset.sub) return setSub(el.dataset.sub);
  const act = el.dataset.act, name = el.dataset.name;
  switch (act) {
    case 'login': return authSubmit(false);
    case 'register': return authSubmit(true);
    case 'logout': return logout();
    case 'reconnect': kickedReason = ''; retry = 0; if (ws) { try { ws.close(); } catch (x) {} } stopReconnect = false; return setTimeout(connect, 150);
    case 'cloud-push': return pushSave(true).then(() => T('☁️ Сохранено в облаке'));
    case 'cloud-pull': if (confirm('Заменить локальное сохранение версией из облака?')) applyCloud().catch(x => T('❌ ' + x.message)); return;
    case 'tr-send': return doTransfer();
    case 'chat-send': return sendChat();
    case 'chat-quick': { const inp = $('chText'); if (inp) { inp.value += el.dataset.emoji; inp.focus(); } return; }
    case 'react': return reactTo(el.dataset.id, el.dataset.emoji);
    case 'react-open': chat.reactFor = chat.reactFor === el.dataset.id ? null : el.dataset.id; return renderChatLog();
    case 'chat-del': return bjCall('admin.delmsg', { msgId: el.dataset.id });
    case 'sub-goto': return setSub(el.dataset.name);
    case 'bank-deposit': return bankDeposit();
    case 'bank-withdraw': if (confirm('Снять весь вклад вместе с процентами?')) bankWithdraw(); return;
    case 'bank-info': return refreshBank();
    case 'pf-name': return (async () => { const n = ($('pfName').value || '').trim(); if (!n) return; if (n.toLowerCase() === String(meta.name).toLowerCase()) return T('Это ваш текущий ник'); try { const r = await req('profile.setname', { name: n }); meta.name = r.name; saveMeta(); if (me) me.name = r.name; T('✏️ Ник изменён: ' + r.name); buildPanel(); refreshFriends(); refreshPlayers(); refreshTop(); } catch (x) { T('❌ ' + x.message); } })();
    case 'pf-ava': return req('profile.setavatar', { avatar: name }).then(r => { if (me) me.avatar = r.avatar; if (prof) prof.avatar = r.avatar; updateHead(); renderProfile(); T('🖼️ Аватарка обновлена'); }).catch(x => T('❌ ' + x.message));
    case 'pf-color': return req('profile.setcolor', { color: name }).then(r => { if (me) me.color = r.color; if (prof) prof.color = r.color; updateHead(); renderProfile(); T('🎨 Цвет ника обновлён'); }).catch(x => T('❌ ' + x.message));
    case 'pf-upload': { const f = $('pfFile'); if (f) f.click(); return; }
    case 'pf-hex': {
      const el2 = $('pfHex'); const v = (el2 ? el2.value : '').trim();
      if (!v) return T('Введите HEX-цвет, например #ff8a00');
      if (!HEX_RE.test(v)) return T('❌ Неверный HEX. Пример: #ff8a00 или #ff8a00,#00c2ff');
      return req('profile.setcolor', { color: v }).then(r => { if (me) me.color = r.color; if (prof) prof.color = r.color; updateHead(); renderProfile(); T('🎨 Цвет ника обновлён'); }).catch(x => T('❌ ' + x.message));
    }
    case 'pf-grad': {
      const a = $('pfC1').value, b = $('pfC2').value;
      return req('profile.setcolor', { color: a + ',' + b }).then(r => { if (me) me.color = r.color; if (prof) prof.color = r.color; updateHead(); renderProfile(); T('🎨 Градиент применён'); }).catch(x => T('❌ ' + x.message));
    }
    case 'pf-swap': { const a = $('pfC1').value, b = $('pfC2').value; $('pfC1').value = b; $('pfC2').value = a; const pv = $('pfPrev'); if (pv) pv.style.cssText = gradInline(b, a); return; }
    case 'pf-hex-clear': return req('profile.setcolor', { color: '' }).then(() => { if (me) me.color = ''; if (prof) prof.color = ''; updateHead(); renderProfile(); T('Цвет сброшен'); }).catch(x => T('❌ ' + x.message));
    case 'pf-bio': return req('profile.setbio', { bio: ($('pfBio').value || '') }).then(r => { if (prof) prof.bio = r.bio; renderProfile(); T('📝 Описание сохранено'); }).catch(x => T('❌ ' + x.message));
    case 'pf-bio-clear': return req('profile.setbio', { bio: '' }).then(() => { if (prof) prof.bio = ''; renderProfile(); T('Описание удалено'); }).catch(x => T('❌ ' + x.message));
    case 'pf-reset-ava': return req('profile.setavatar', { avatar: '' }).then(() => { if (me) me.avatar = null; if (prof) prof.avatar = null; updateHead(); renderProfile(); T('Аватарка убрана'); }).catch(x => T('❌ ' + x.message));
    case 'pl-refresh': players.q = ($('plQ').value || '').trim(); return refreshPlayers();
    case 'pl-add': return req('friends.add', { name }).then(r => { friends = r; refreshFriends(); refreshPlayers(); T('👋 Заявка отправлена'); }).catch(x => T('❌ ' + x.message));
    case 'pl-dm': if (!(friends.friends || []).some(f => f.name.toLowerCase() === String(name).toLowerCase())) return T('✋ Личные сообщения доступны только друзьям'); chat.room = name.toLowerCase(); setSub('chat'); renderChatShell(); loadChat(chat.room); return;
    case 'pl-pay': setSub('transfer'); renderTransfer(); $('trTo').value = name; $('trAmt').focus(); return;
    case 'pv-view': return openProfile(name);
    case 'pv-close': closeProfile(); return;
    case 'pv-add': return req('friends.add', { name }).then(r => { friends = r; renderFriends(); renderPlayers(); T('👋 Заявка отправлена'); openProfile(name); }).catch(x => T('❌ ' + x.message));
    case 'pv-accept': return req('friends.accept', { name }).then(r => { friends = r; renderFriends(); renderChatShell(); fillFriendDatalist(); renderPlayers(); T('✅ Теперь вы друзья'); openProfile(name); }).catch(x => T('❌ ' + x.message));
    case 'pv-dm': closeProfile(); chat.room = name.toLowerCase(); setSub('chat'); renderChatShell(); loadChat(chat.room); return;
    case 'pv-pay': closeProfile(); setSub('transfer'); renderTransfer(); $('trTo').value = name; $('trAmt').focus(); return;
    case 'arc-play': return arcPlay(el.dataset.name, el.dataset.choice);
    case 'rou-open': arcade.view = 'roulette'; return renderArcade();
    case 'rou-back': arcade.view = 'list'; return renderArcade();
    case 'rou-chip': arcade.chip = Number(el.dataset.v) || 1000; return renderArcade();
    case 'rou-spin': return rouSpin();
    case 'rou-undo': return rouUndo();
    case 'rou-clear': return rouClear();
    case 'duel-create': return duelCreate();
    case 'duel-join': return duelJoin(el.dataset.id, el.dataset.color);
    case 'duel-cancel': duel.myTable = null; return bjCall('duel.cancel').then(refreshDuel);
    case 'duel-close': duel.res = null; duel.spinKey = ''; return refreshDuel();
    case 'fr-add': { const n = ($('frName').value || '').trim(); if (!n) return; return req('friends.add', { name: n }).then(r => { friends = r; renderFriends(); T('👋 Заявка отправлена'); }).catch(x => T('❌ ' + x.message)); }
    case 'fr-accept': return req('friends.accept', { name }).then(r => { friends = r; renderFriends(); renderChatShell(); fillFriendDatalist(); }).catch(x => T('❌ ' + x.message));
    case 'fr-decline': return req('friends.decline', { name }).then(r => { friends = r; renderFriends(); }).catch(x => T('❌ ' + x.message));
    case 'fr-remove': if (confirm('Удалить ' + name + ' из друзей?')) req('friends.remove', { name }).then(r => { friends = r; renderFriends(); renderChatShell(); fillFriendDatalist(); }).catch(x => T('❌ ' + x.message)); return;
    case 'fr-dm': chat.room = name.toLowerCase(); setSub('chat'); renderChatShell(); loadChat(chat.room); return;
    case 'fr-pay': setSub('transfer'); renderTransfer(); $('trTo').value = name; $('trAmt').focus(); return;
    case 'bj-create': return (async () => { if (needSync()) return; const b = parseAmt($('bjBet').value); if (b < cfg.minBet) return T('Минимальная ставка 🪙 ' + F(cfg.minBet)); if (totalMoney() < b) return T('❌ Не хватает денег'); await pushSave(true); try { const r = await req('bj.create', { bet: b }); bj.myTable = r.table; renderBj(); T('🃏 Стол создан, ждём соперника'); } catch (x) { T('❌ ' + x.message); } })();
    case 'bj-cancel': bj.myTable = null; return bjCall('bj.cancel').then(refreshBjLobby);
    case 'bj-join': return (async () => { if (needSync()) return; await pushSave(true); await bjCall('bj.join', { table: el.dataset.id }); })();
    case 'bj-hit': return bjCall('bj.hit');
    case 'bj-stand': return bjCall('bj.stand');
    case 'bj-close': bj.game = null; return refreshBjLobby().then(pullWallet);
    case 'adm-refresh': adm.q = ($('admQ').value || '').trim(); return refreshAdmin();
    case 'adm-audit': return req('admin.audit').then(r => { adm.audit = adm.audit ? null : r.log; renderAdmin(); }).catch(x => T('❌ ' + x.message));
    case 'adm-add': { const n = ($('admNew').value || '').trim(); if (!n) return; return req('admin.add', { name: n }).then(() => { T('🛡️ ' + n + ' теперь админ'); refreshAdmin(); }).catch(x => T('❌ ' + x.message)); }
    case 'adm-bc': { const t = ($('admBc').value || '').trim(); if (!t) return; return req('admin.broadcast', { text: t }).then(() => { $('admBc').value = ''; T('📢 Отправлено'); }).catch(x => T('❌ ' + x.message)); }
    case 'adm-release': {
      const v = ($('relVer').value || '').trim().replace(/^v/i, '');
      const notes = ($('relNotes') ? $('relNotes').value : '').trim();
      const mode = ($('relMode') ? $('relMode').value : 'auto');
      const where = mode === 'cloud' ? '\n\nСборка пойдёт в облаке GitHub (нужен доступ к репозиторию).'
        : (mode === 'local' ? '\n\nСборка пойдёт на этом компьютере.' : '');
      if (!confirm('Выпустить обновление' + (v ? ' v' + v : '') + '?' + where + '\n\nВсе игроки будут заблокированы, пока не соберутся EXE и APK, затем файлы попадут в GitHub Releases.')) return;
      return req('admin.release', { version: v, notes, mode }).then(r => {
        T('🚀 Сборка запущена' + (r.version ? ': v' + r.version : '') + (r.mode === 'cloud' ? ' в облаке GitHub' : ' на этом компьютере'));
        return refreshAdmin().catch(() => {});
      }).catch(x => T('❌ ' + x.message));
    }
    default: if (act && act.startsWith('adm-')) return admAction(act, name);
  }
}
function onChange(e) {
  const el = e.target;
  if (el.dataset && el.dataset.act === 'auto') { meta.auto = el.checked; saveMeta(); }
  if (el.dataset && el.dataset.act === 'srv') { meta.server = (el.value || '').trim(); meta.manualServer = true; saveMeta(); }
  if (el.id === 'duelGame') {
    const c = $('duelColor'); if (c) c.style.display = el.value === 'roulette' ? '' : 'none';
  }
}
function onKey(e) {
  if (e.key === 'Escape') return closeProfile();
  if (e.key !== 'Enter') return;
  if (e.target.id === 'olPass' || e.target.id === 'olName') authSubmit(false);
  else if (e.target.id === 'frName') { const b = document.querySelector('[data-act="fr-add"]'); if (b) b.click(); }
  else if (e.target.id === 'pfName') { const b = document.querySelector('[data-act="pf-name"]'); if (b) b.click(); }
  else if (e.target.id === 'pfHex') { const b = document.querySelector('[data-act="pf-hex"]'); if (b) b.click(); }
  else if (e.target.id === 'pfBio') { const b = document.querySelector('[data-act="pf-bio"]'); if (b) b.click(); }
  else if (e.target.id === 'plQ') { players.q = e.target.value.trim(); refreshPlayers(); }
  else if (e.target.id === 'admNew') { const b = document.querySelector('[data-act="adm-add"]'); if (b) b.click(); }
  else if (e.target.id === 'relVer') { const b = document.querySelector('[data-act="adm-release"]'); if (b) b.click(); }
  else if (e.target.id === 'admQ') { adm.q = e.target.value.trim(); refreshAdmin(); }
  else if (e.target.id === 'trAmt') doTransfer();
  else if (e.target.id === 'bankAmt') bankDeposit();
  else if (e.target.id === 'duelBet') duelCreate();
}

/* ============================================================
   ПУБЛИЧНЫЙ API (для index.html)
   ============================================================ */
/* Вызывается из обработчика промокодов. true = код отправлен на сервер (ответ покажет toast). */
function tryAdminCode(v) {
  if (!authed) return false;
  req('admin.code', { code: v }).then(r => {
    me.admin = true; me.owner = !!r.owner; buildPanel();
    T(me.owner ? '👑 Вы — владелец. Админов добавляете вы: вкладка «Онлайн» → Админ' : '🛡️ Админ-панель открыта: вкладка «Онлайн»');
    const tab = document.querySelector('.tab[data-tab="online"]'); if (tab) tab.click();
    setTimeout(() => setSub('admin'), 50);
  }).catch(e => T(e.reply && e.reply.err === 'bad' ? '❌ Неверный промокод' : '❌ ' + e.message));
  return true;
}
/* антиклик: отправить окно из 50 кликов на проверку серверу. Promise<true> — сервер получил */
function reportClicks(clicks) {
  if (!authed) return Promise.resolve(false);
  return req('ac.report', { clicks }).then(() => true).catch(() => false);
}
window.Online = { tryAdminCode, reportClicks, pushSave: () => pushSave(true), connect };

/* ============================================================
   СТАРТ
   ============================================================ */
const panel = $('panel-online');
if (panel) {
  panel.addEventListener('click', onClick);
  panel.addEventListener('change', onChange);
  panel.addEventListener('keydown', onKey);
  /* правый клик по полю рулетки снимает фишку */
  panel.addEventListener('contextmenu', e => {
    const el = e.target.closest('[data-bet]'); if (!el) return;
    e.preventDefault(); rouPlace(el.dataset.bet, true);
  });
  /* при изменении размера окна перерисовываем колесо (canvas подстраивается) */
  window.addEventListener('resize', () => {
    if (arcade.view === 'roulette' && sub === 'arcade') drawWheelRest($('rouCv'), arcade.num, 320);
  });
  const tab = document.querySelector('.tab[data-tab="online"]');
  if (tab) tab.addEventListener('click', () => { if (authed) { setSub(sub); chat.unread.delete(chat.room); updateBadges(); } updatePreview(); });
  buildPanel();
  applyRemoteServer(false).then(changed => { if (changed) buildPanel(); if (meta.token) connect(); });
  setInterval(() => { if (meta.auto && authed && syncReady) pushSave(false); }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { pushSave(false); }
    else if (meta.token && !authed) { retry = 0; connect(); } else if (authed) pullWallet();
  });
  window.addEventListener('online', () => { if (meta.token && !authed) { retry = 0; connect(); } });
}
})();
