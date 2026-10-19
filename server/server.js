'use strict';
/* ============================================================
   VitalyaClicker 69 — ОНЛАЙН-СЕРВЕР
   Аккаунты · облачные сохранения · переводы с комиссией · чат ·
   друзья · блэкджек 1 на 1 · админ-панель
   Запуск:  npm install && npm start   (по умолчанию порт 3000)
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const https = require('https');
const { WebSocketServer } = require('ws');
const AntiClick = require(path.join(__dirname, '..', 'anticlick.js'));
const ReleasePlan = require(path.join(__dirname, 'release-plan.js'));
const Parrot = require(path.join(__dirname, 'parrot.js'));

const PORT = +process.env.PORT || 3000;
const ROOT = path.resolve(process.env.GAME_ROOT || path.join(__dirname, '..'));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest();
function readJsonSafe(p, def) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return def; } }
/* Секреты сервера: server/secret.json (в репозиторий не попадает) + переменные окружения. */
const SECRET = readJsonSafe(path.join(__dirname, 'secret.json'), {});
/* Секретный код админки хранится ТОЛЬКО на сервере (в клиентском коде его нет). */
const ADMIN_CODE = process.env.ADMIN_CODE || SECRET.adminCode || '';
const ADMIN_CODE_HASH = ADMIN_CODE ? sha256(ADMIN_CODE) : null;
/* Доступ к GitHub: облачная сборка обновлений (Actions) и публикация адреса сервера. */
const GH_CFG = readJsonSafe(path.join(ROOT, 'tools', 'gh.config.json'), {});
const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || SECRET.ghToken || GH_CFG.token || '';
const GH_REPO = process.env.GITHUB_REPO || SECRET.ghRepo || GH_CFG.repo || '';
const GH_WORKFLOW = process.env.VC_RELEASE_WORKFLOW || 'release.yml';
/* версия игры из version.json — попадает в /api/ping и в сборки.
   Читаем с небольшим кэшем: сразу после выпуска обновления сервер уже
   знает новую версию и может требовать её от старых сборок. */
let _verCache = { at: 0, v: '', assets: {} };
function verInfo() {
  if (_verCache.v && Date.now() - _verCache.at < 30000) return _verCache;
  let v = '', a = {};
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
    v = String(j.version || '').replace(/^v/i, '');
    if (j.assets && typeof j.assets === 'object') a = j.assets;
  } catch (e) {}
  _verCache = { at: Date.now(), v: v, assets: a };
  return _verCache;
}
function currentVersion() { return verInfo().v; }

const CFG = {
  transferFee: 0.05,      // комиссия перевода (5%), платит отправитель сверху
  minTransfer: 1000,
  minBet: 1000,
  turnMs: 30000,          // время на ход в блэкджеке
  discMs: 45000,          // сколько ждём вернувшегося игрока
  chatMax: 300,
  saveVersion: 24,
  bankRate: 0.002,        // 0.2% в час на вклад онлайн-банка
  bankMaxHours: 72,       // проценты капают не дольше 72 часов
  bankMin: 1000,          // минимальный вклад
  xpMsg: 2, xpTransfer: 5, xpBj: 20, xpBjWin: 30, xpDuel: 15, xpDuelWin: 10, xpDaily: 10,
  renameMs: 600000,       // как часто можно менять ник (10 минут)
  avatarMax: 30000,       // максимальный размер аватарки (data URL, символов)
  bioMax: 140,            // максимальная длина описания профиля
};

/* ---------------- ЦЕНЫ (порт из второй версии) ----------------
   configs/prices.json — плоский список { "ключ": число }. Файл не в
   репозитории: его правит владелец, сервер — единственный источник правды.
   Если цены в файле ещё нет, клиент присылает своё значение по умолчанию,
   и сервер запоминает его (так каталог заполняется сам). */
const PRICES_FILE = process.env.PRICES_FILE || path.join(ROOT, 'configs', 'prices.json');
let prices = readJsonSafe(PRICES_FILE, {});
if (!prices || typeof prices !== 'object' || Array.isArray(prices)) prices = {};
function savePrices() {
  try {
    fs.mkdirSync(path.dirname(PRICES_FILE), { recursive: true });
    const tmp = PRICES_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(prices, null, 2));
    fs.renameSync(tmp, PRICES_FILE);
  } catch (e) { console.error('цены: не удалось сохранить —', e.message); }
}
const priceKeyOk = k => /^[\w.]{1,60}$/.test(String(k || ''));
function priceOr(k, def) {
  if (!Object.prototype.hasOwnProperty.call(prices, k)) {
    if (!isFinite(def) || def < 0 || def > 1e30) return null;
    prices[k] = def; savePrices();
  }
  return prices[k];
}

/* предустановленные аватарки и градиенты ников */
const AVATARS = ['🐱', '🐶', '🦊', '🐼', '🐸', '🐵', '🦁', '🐯', '🐨', '🐷', '🐙', '🦄', '👑', '💀', '🤖', '👽', '🎮', '🚀', '🔥', '⚡', '🍀', '💎', '🪙', '🎩'];
const COLORS = [
  { id: '', name: 'Обычный', from: '', to: '' },
  { id: 'gold', name: 'Золото', from: '#ffd85e', to: '#ff9f1c' },
  { id: 'fire', name: 'Огонь', from: '#ff6b6b', to: '#ffb347' },
  { id: 'ice', name: 'Лёд', from: '#8fc2ff', to: '#4f8dea' },
  { id: 'toxic', name: 'Токсин', from: '#4be88f', to: '#1e8a4f' },
  { id: 'candy', name: 'Карамель', from: '#ff9ff3', to: '#f368e0' },
  { id: 'violet', name: 'Фиалка', from: '#b388ff', to: '#7c4dff' },
  { id: 'blood', name: 'Кровь', from: '#ff5c5c', to: '#8a1f1f' },
  { id: 'matrix', name: 'Матрица', from: '#00ff9c', to: '#008f5a' },
  { id: 'sunset', name: 'Закат', from: '#ffb347', to: '#ff5c8a' },
  { id: 'ocean', name: 'Океан', from: '#4dd0e1', to: '#0069c0' },
  { id: 'royal', name: 'Королевский', from: '#ffd85e', to: '#b388ff' },
];
/* свой цвет ника: #rrggbb или #rgb, и градиент из двух таких через запятую */
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})(?:,#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))?$/;

/* комнаты чата и допустимые реакции */
const ROOMS = [['global', '🌍', 'Общий'], ['trade', '💱', 'Торговая'], ['fun', '🎉', 'Флудилка'], ['help', '❓', 'Помощь']];
const ROOM_IDS = ROOMS.map(r => r[0]);
const EMOJIS = ['👍', '🔥', '😂', '😮', '😢', '❤️', '💀', '🪙'];

/* ---------------- БАЗА (JSON-файл, атомарная запись) ---------------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
let db = { users: {}, tokens: {}, chat: [], rooms: {}, dms: {}, audit: [], escrow: {}, seq: 1 };
if (!db.rooms) db.rooms = {};
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (e) { /* первый запуск */ }
let flushTimer = null;
function markDirty() { if (!flushTimer) flushTimer = setTimeout(flush, 700); }
function flush() {
  flushTimer = null;
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
const nid = (p) => p + (db.seq++).toString(36);

/* ---------------- УТИЛИТЫ ---------------- */
const now = () => Date.now();
const NAME_RE = /^[A-Za-z0-9_\u0400-\u04FF]{3,16}$/;
const key = n => String(n || '').toLowerCase();
const getUser = n => db.users[key(n)] || null;
function cleanText(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function hashPw(pw, salt) { return crypto.scryptSync(pw, salt, 32).toString('hex'); }
function safeEq(a, b) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function audit(admin, action, detail) {
  db.audit.push({ at: now(), admin, action, detail: cleanText(detail, 200) });
  if (db.audit.length > 300) db.audit.splice(0, db.audit.length - 300);
  markDirty();
}
/* простой лимитер: ключ → [время…] */
const hits = new Map();
function limited(k, max, windowMs) {
  const t = now(); const arr = (hits.get(k) || []).filter(x => t - x < windowMs);
  if (arr.length >= max) { hits.set(k, arr); return true; }
  arr.push(t); hits.set(k, arr); return false;
}
setInterval(() => { const t = now(); for (const [k, a] of hits) if (!a.length || t - a[a.length - 1] > 3600000) hits.delete(k); }, 600000).unref();

/* сессии живут SESSION_MS (неделя): просроченные убираем на старте и раз в час */
function pruneTokens() {
  const t = now(); let n = 0;
  for (const k of Object.keys(db.tokens)) { const v = db.tokens[k]; if (v && v.exp && v.exp < t) { delete db.tokens[k]; n++; } }
  if (n) markDirty();
  return n;
}
pruneTokens();
setInterval(pruneTokens, 3600000).unref();

/* ---------------- ПРОВЕРКА СОХРАНЕНИЯ (data.bin) ---------------- */
function fnvNew(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
function fnvOld(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; } return h >>> 0; }
const BASKETS = ['click', 'auto', 'casino', 'crypto', 'mining'];
function parseSave(main, garden) {
  if (typeof main !== 'string' || main.length < 80 || main.length > 2e6) return { ok: false, err: 'Сохранение кликера повреждено' };
  const buf = Buffer.from(main, 'base64');
  if (buf.length < 70) return { ok: false, err: 'Сохранение кликера слишком короткое' };
  if (buf.readUInt32LE(0) !== 0x56434442) return { ok: false, err: 'Неверный формат data.bin' };
  if (buf.readUInt32LE(4) !== CFG.saveVersion) return { ok: false, err: 'Устаревшая версия сохранения' };
  if (buf[buf.length - 1] === 1) return { ok: false, err: 'Заблокированное сохранение не загружается в облако' };
  const k = buf.readUInt32LE(8);
  const v = {}; let money = 0;
  for (let i = 0; i < 5; i++) {
    const x = buf.readDoubleLE(12 + i * 8);
    if (!isFinite(x) || x < 0) return { ok: false, err: 'Некорректные деньги в сохранении' };
    v[BASKETS[i]] = x; money += x;
  }
  const s = Object.keys(v).sort().map(n => n + ':' + Math.floor(v[n])).join('|');
  if (k !== fnvNew(s) && k !== fnvOld(s)) return { ok: false, err: 'Контрольная сумма сохранения не совпала' };
  let gMoney = 0, g = null;
  if (garden != null) {
    if (typeof garden !== 'string' || garden.length > 1.5e6) return { ok: false, err: 'Сохранение сада слишком большое' };
    try { g = JSON.parse(garden); } catch (e) { return { ok: false, err: 'Сохранение сада повреждено' }; }
    const gm = Number(g && g.money);
    if (isFinite(gm) && gm > 0) gMoney = gm;
  }
  return { ok: true, money: money + gMoney, clicks: buf.readDoubleLE(12 + 5 * 8), gardenMoney: gMoney };
}

/* ---------------- КОШЕЛЁК: всё движение денег — через pending-записи ---------------- */
function avail(u) {
  let b = u.balance || 0;
  for (const p of u.pending) b += p.kind === 'credit' ? p.amount : -p.amount;
  return Math.max(0, b);
}
function addPending(u, kind, amount, note) {
  const p = { id: nid('p'), kind, amount, note: cleanText(note, 80), at: now() };
  u.pending.push(p);
  if (u.pending.length > 500) u.pending.splice(0, u.pending.length - 500);
  markDirty();
  pushTo(u.name, { t: 'wallet' });
  return p;
}
function ackPending(u, ids) {
  if (!Array.isArray(ids) || !ids.length) return;
  const set = new Set(ids.slice(0, 500).map(String));
  u.pending = u.pending.filter(p => {
    if (!set.has(p.id)) return true;
    u.balance = Math.max(0, (u.balance || 0) + (p.kind === 'credit' ? p.amount : -p.amount));
    return false;
  });
  markDirty();
}
function logTx(u, o) { u.tx.push(Object.assign({ at: now() }, o)); if (u.tx.length > 60) u.tx.splice(0, u.tx.length - 60); }

/* ---------------- ОПЫТ И УРОВНИ ---------------- */
function levelOf(xp) { return 1 + Math.floor(Math.sqrt(Math.max(0, xp || 0) / 100)); }
const xpForLevel = l => 100 * (l - 1) * (l - 1);
function stats(u) { if (!u.stats) u.stats = { msgs: 0, transfers: 0, bj: 0, bjWins: 0, duels: 0, duelWins: 0, cards: 0, cardWins: 0 }; if (u.stats.cards == null) u.stats.cards = 0; if (u.stats.cardWins == null) u.stats.cardWins = 0; return u.stats; }
function addXp(u, n) {
  if (!n) return;
  const before = levelOf(u.xp);
  u.xp = (u.xp || 0) + n; markDirty();
  const after = levelOf(u.xp);
  pushTo(u.name, { t: 'xp', xp: u.xp, level: after });
  if (after > before) pushTo(u.name, { t: 'toast', text: `🏅 Новый уровень: ${after}!` });
}

/* ---------------- ОНЛАЙН-БАНК (вклад под процент) ---------------- */
function bankInfo(u) {
  const b = u.bank || { amount: 0, since: 0 };
  const amount = Math.max(0, b.amount || 0);
  const hours = amount > 0 && b.since ? Math.min(CFG.bankMaxHours, Math.max(0, (now() - b.since) / 3600000)) : 0;
  const interest = Math.floor(amount * CFG.bankRate * hours);
  return { amount, interest, rate: CFG.bankRate, hours, maxHours: CFG.bankMaxHours, min: CFG.bankMin };
}

/* ---------------- ДУЭЛИ (монетка/кости 1 на 1) ---------------- */
const Roul = require(path.join(__dirname, '..', 'roulette.js'));
const duels = new Map();     // id -> {id, game, bet, owner, other?}
const userDuel = new Map();  // name -> id
function duelList() { return [...duels.values()].map(t => ({ id: t.id, game: t.game, bet: t.bet, owner: getUser(t.owner).display })); }
function pushDuels() { pushAll({ t: 'duel.tables', tables: duelList() }); }
function duelDrop(name) { const id = userDuel.get(name); if (id) { duels.delete(id); userDuel.delete(name); pushDuels(); } }
function duelResolve(t) {
  const A = getUser(t.owner), B = getUser(t.other), bet = t.bet;
  db.escrow[t.id] = { bet, players: [A.name, B.name], at: now() };
  addPending(A, 'debit', bet, 'Дуэль: ставка'); addPending(B, 'debit', bet, 'Дуэль: ставка');
  const rnd = n => crypto.randomInt(n);
  let winner = null, reason = '', rollA = '', rollB = '';
  if (t.game === 'coin') {
    winner = rnd(2);
    rollA = winner === 0 ? 'орёл' : 'решка'; rollB = winner === 0 ? 'решка' : 'орёл';
    reason = 'Монетка: ' + (winner === 0 ? A.display : B.display) + ' — ' + rollA;
  } else {
    const a = rnd(100) + 1, b = rnd(100) + 1;
    rollA = String(a); rollB = String(b);
    if (a === b) { winner = null; reason = `Ничья ${a}:${b} — ставки возвращаются`; }
    else { winner = a > b ? 0 : 1; reason = `Кости: ${a} против ${b}`; }
  }
  const payout = [0, 0];
  if (winner === null) {
    payout[0] = payout[1] = bet;
    addPending(A, 'credit', bet, 'Дуэль: ничья, возврат ставки'); addPending(B, 'credit', bet, 'Дуэль: ничья, возврат ставки');
    logTx(A, { type: 'duel', amount: 0, other: B.display, note: 'ничья' }); logTx(B, { type: 'duel', amount: 0, other: A.display, note: 'ничья' });
  } else {
    const w = [A, B][winner], l = [A, B][1 - winner];
    payout[winner] = bet * 2;
    addPending(w, 'credit', bet * 2, 'Дуэль: победа над ' + l.display);
    logTx(w, { type: 'duel', amount: bet, other: l.display, note: 'победа' }); logTx(l, { type: 'duel', amount: -bet, other: w.display, note: 'поражение' });
  }
  stats(A).duels++; stats(B).duels++;
  addXp(A, CFG.xpDuel); addXp(B, CFG.xpDuel);
  if (winner !== null) { stats([A, B][winner]).duelWins++; addXp([A, B][winner], CFG.xpDuelWin); }
  delete db.escrow[t.id]; markDirty();
  const view = i => ({ id: t.id, game: t.game, bet, myRoll: i === 0 ? rollA : rollB, oppRoll: i === 0 ? rollB : rollA, opp: [A, B][1 - i].display, winner: winner === null ? null : [A, B][winner].display, push: winner === null, youWon: winner === i, reason, payout: payout[i] });
  pushTo(A.name, { t: 'duel.result', res: view(0) });
  pushTo(B.name, { t: 'duel.result', res: view(1) });
  userDuel.delete(A.name); userDuel.delete(B.name);
}

/* ---------------- РУЛЕТОЧНЫЙ СТОЛ 1 на 1 и более ----------------
   Точная копия рулетки из аркады (весь стол, фишки, колесо), но игроки
   играют друг против друга: каждый ставит фишки на всю ставку стола,
   колесо крутится один раз, банк забирает тот, чей расклад выиграл больше.
   У всех одинаковый результат — ставки возвращаются. */
const rouls = new Map();      // id -> {id, bet, max, owner, players[], state, bets{}, ready{}, num, view{}, payout{}, winners[]}
const userRoul = new Map();   // name -> id
const ROUL_MIN = 2, ROUL_MAX = 4;
const ROUL_BET_MS = 90000;    // время на расстановку фишек
const ROUL_LOBBY_MS = 30 * 60 * 1000;

/* проверка расклада: только существующие ставки, целые суммы, ровно ставка стола */
function roulBetsOk(bets, stake) {
  if (!Array.isArray(bets) || !bets.length || bets.length > 300) return null;
  const out = []; let total = 0;
  for (const b of bets) {
    const def = b && Roul.betById(b.id);
    const amount = Math.floor(Number(b && b.amount) || 0);
    if (!def || !isFinite(amount) || amount <= 0 || amount > 1e18) return null;
    total += amount;
    if (total > 1e18) return null;
    out.push({ id: String(b.id), amount });
  }
  if (total !== stake) return null;
  return out;
}
function roulRoomOf(name) { const id = userRoul.get(name); return id ? rouls.get(id) || null : null; }
function roulView(rm, name) {
  const done = rm.state === 'done';
  const net = p => (rm.view && rm.view[p] ? rm.view[p].net : null);
  return {
    id: rm.id, bet: rm.bet, max: rm.max, owner: getUser(rm.owner).display, state: rm.state,
    num: rm.num == null ? null : rm.num, color: rm.num == null ? '' : Roul.pocketColor(rm.num),
    deadline: rm.deadline || 0,
    you: { name: getUser(name).display, bets: rm.bets[name] || null, ready: !!rm.ready[name], net: net(name), payout: rm.payout && rm.payout[name] != null ? rm.payout[name] : 0, win: !!(rm.winners && rm.winners.indexOf(name) >= 0) },
    players: rm.players.map(p => ({
      name: getUser(p).display, online: isOnline(p), ready: !!rm.ready[p],
      bets: done ? (rm.bets[p] || []) : null, net: net(p),
      payout: rm.payout && rm.payout[p] != null ? rm.payout[p] : 0,
      win: !!(rm.winners && rm.winners.indexOf(p) >= 0)
    })),
    push: done && !rm.winners
  };
}
function roulPush(rm) { for (const p of rm.players) pushTo(p, { t: 'roul.room', room: roulView(rm, p) }); }
function roulLobby() { return [...rouls.values()].filter(r => r.state === 'lobby').map(r => ({ id: r.id, bet: r.bet, max: r.max, players: r.players.length, owner: getUser(r.owner).display })); }
function pushRouls() { pushAll({ t: 'roul.rooms', rooms: roulLobby() }); }
function roulArmLobby(rm) {
  clearTimeout(rm.timer);
  rm.timer = setTimeout(() => { if (rm.state === 'lobby') roulClose(rm, 'Стол закрыт: никто не собрался'); }, ROUL_LOBBY_MS);
  if (rm.timer && rm.timer.unref) rm.timer.unref();
}
function roulClose(rm, why) {
  if (rm.state === 'bet') return roulCancel(rm, why);
  clearTimeout(rm.timer); rm.timer = null;
  for (const p of rm.players) { userRoul.delete(p); pushTo(p, { t: 'toast', text: '🗑️ ' + why }); }
  rouls.delete(rm.id); pushRouls();
  for (const p of rm.players) pushTo(p, { t: 'roul.gone' });
}
/* передумали/вышли/вышел таймер — всем возвращаем ставки */
function roulCancel(rm, why) {
  if (rm.state !== 'bet') return;
  clearTimeout(rm.timer); rm.timer = null;
  for (const p of rm.players) addPending(getUser(p), 'credit', rm.bet, 'Рулетка: возврат ставки');
  delete db.escrow[rm.id];
  rm.state = 'lobby'; rm.deadline = 0; rm.bets = {}; rm.ready = {}; rm.num = null; rm.view = {}; rm.payout = {}; rm.winners = null;
  markDirty(); roulArmLobby(rm);
  for (const p of rm.players) pushTo(p, { t: 'toast', text: '↩️ ' + why + ' — ставки возвращены' });
  roulPush(rm); pushRouls();
}
function roulStart(rm) {
  if (rm.state !== 'lobby') throw new Error('Стол уже играет');
  if (rm.players.length < ROUL_MIN) throw new Error('Нужно минимум ' + ROUL_MIN + ' игрока');
  for (const p of rm.players) { const u = getUser(p); if (avail(u) < rm.bet) throw new Error('У игрока ' + u.display + ' не хватает денег'); }
  clearTimeout(rm.timer); rm.timer = null;
  rm.state = 'bet'; rm.bets = {}; rm.ready = {}; rm.num = null; rm.view = {}; rm.payout = {}; rm.winners = null;
  rm.deadline = now() + ROUL_BET_MS;
  db.escrow[rm.id] = { bet: rm.bet, players: rm.players.slice(), at: now() };
  for (const p of rm.players) addPending(getUser(p), 'debit', rm.bet, 'Рулетка: ставка');
  markDirty();
  rm.timer = setTimeout(() => roulCancel(rm, 'Время на ставки вышло'), ROUL_BET_MS + 500);
  if (rm.timer && rm.timer.unref) rm.timer.unref();
  roulPush(rm); pushRouls();
}
function roulResolve(rm) {
  if (rm.state !== 'bet') return;
  clearTimeout(rm.timer); rm.timer = null;
  const n = crypto.randomInt(37);
  rm.num = n; rm.view = {};
  let best = null, winners = [];
  for (const p of rm.players) {
    const r = Roul.evaluate(rm.bets[p] || [], n);
    rm.view[p] = { net: r.net, stake: r.stake, returned: r.returned, hits: r.hits.map(h => h.label) };
    if (best === null || r.net > best) { best = r.net; winners = [p]; }
    else if (r.net === best) winners.push(p);
  }
  const pot = rm.bet * rm.players.length;
  rm.payout = {};
  if (winners.length === rm.players.length) {
    rm.winners = null;
    for (const p of rm.players) {
      addPending(getUser(p), 'credit', rm.bet, 'Рулетка: ничья, возврат ставки');
      rm.payout[p] = rm.bet;
      logTx(getUser(p), { type: 'duel', amount: 0, note: 'рулетка: ничья' });
    }
  } else {
    rm.winners = winners;
    const share = Math.floor(pot / winners.length);
    let rem = pot - share * winners.length;
    for (const p of rm.players) if (winners.indexOf(p) < 0) logTx(getUser(p), { type: 'duel', amount: -rm.bet, note: 'рулетка: поражение' });
    for (const p of winners) {
      const amount = share + (rem-- > 0 ? 1 : 0);
      rm.payout[p] = amount;
      addPending(getUser(p), 'credit', amount, 'Рулетка: банк');
      logTx(getUser(p), { type: 'duel', amount: amount - rm.bet, note: 'рулетка: победа' });
    }
  }
  for (const p of rm.players) {
    const U = getUser(p); stats(U).duels++; addXp(U, CFG.xpDuel);
    if (rm.winners && rm.winners.indexOf(p) >= 0) { stats(U).duelWins++; addXp(U, CFG.xpDuelWin); }
  }
  delete db.escrow[rm.id];
  rm.state = 'done'; rm.deadline = 0; markDirty();
  roulPush(rm);
  for (const p of rm.players) userRoul.delete(p);
  pushRouls();
  const t = setTimeout(() => rouls.delete(rm.id), 180000);
  if (t && t.unref) t.unref();
}
function roulLeave(name, why) {
  const rm = roulRoomOf(name); if (!rm) return false;
  if (rm.state === 'bet') {
    roulCancel(rm, 'Игрок вышел');
  }
  clearTimeout(rm.timer); rm.timer = null;
  userRoul.delete(name);
  dropFrom(rm.players, name);
  if (!rm.players.length) { rouls.delete(rm.id); pushRouls(); return true; }
  if (rm.owner === name) { roulClose(rm, 'Создатель стола вышел'); return true; }
  markDirty(); roulArmLobby(rm); roulPush(rm); pushRouls();
  if (why) for (const p of rm.players) pushTo(p, { t: 'toast', text: '👋 ' + getUser(name).display + ' вышел из-за стола' });
  return true;
}
function roulOnDisconnect(name) {
  const rm = roulRoomOf(name); if (!rm) return;
  if (rm.state === 'bet') { roulPush(rm); return; }   /* ждём до таймера — игрок может вернуться */
  roulLeave(name, false);
}

/* ---------------- СОЕДИНЕНИЯ ---------------- */
const conns = new Map(); // name(lower) -> Set<ws>
const isOnline = n => (conns.get(key(n)) || { size: 0 }).size > 0;
function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function pushTo(name, obj) { const s = conns.get(key(name)); if (s) for (const w of s) send(w, obj); }
function pushAll(obj, filter) { for (const [n, s] of conns) for (const w of s) if (!filter || filter(n)) send(w, obj); }
function pub(u) { return { name: u.display, admin: !!u.admin, owner: !!u.owner, avatar: u.avatar || null, color: u.color || '', level: levelOf(u.xp) }; }
function friendsPresence(u) { for (const f of u.friends) pushTo(f, { t: 'friends.update' }); }

/* ---------------- HTTP: статика + регистрация/вход ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.apk': 'application/vnd.android.package-archive', '.exe': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8' };
function readBody(req, max = 8192) {
  return new Promise((res, rej) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > max) { rej(new Error('big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { res(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { rej(e); } });
    req.on('error', rej);
  });
}
function ipOf(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?'; }
/* сессия живёт неделю: игрок не входит заново каждый запуск, но забытый
   на чужом устройстве вход сам истекает. Активность продлевает срок. */
const SESSION_MS = 7 * 24 * 3600 * 1000;
function issueToken(u) {
  const token = crypto.randomBytes(32).toString('hex');
  db.tokens[sha256(token).toString('hex')] = { user: u.name, at: now(), exp: now() + SESSION_MS };
  const mine = Object.entries(db.tokens).filter(([, v]) => v.user === u.name).sort((a, b) => a[1].at - b[1].at);
  while (mine.length > 8) delete db.tokens[mine.shift()[0]];
  markDirty();
  return token;
}
/* достаём запись сессии и выбрасываем просроченные */
function tokenRec(token) {
  const h = sha256(String(token || '')).toString('hex');
  const rec = db.tokens[h];
  if (!rec) return null;
  if (rec.exp && rec.exp < now()) { delete db.tokens[h]; markDirty(); return null; }
  return { h, rec };
}
function banInfo(u) {
  if (!u.ban) return null;
  if (u.ban.until && u.ban.until < now()) { u.ban = null; markDirty(); return null; }
  return u.ban;
}
function banText(b) { return 'Аккаунт заблокирован' + (b.until ? ' до ' + new Date(b.until).toLocaleString('ru-RU') : ' навсегда') + (b.reason ? ': ' + b.reason : '') + (b.auto ? '. Разбанить может только администратор' : ''); }
const ownerUser = () => Object.values(db.users).find(x => x.owner) || null;
/* антиклик: бан аккаунта (owner не банится автоматически) */
function autoBan(u, clicks, why) {
  if (u.owner) return false;
  if (banInfo(u) && u.ban.auto) return true;
  u.ban = { until: 0, reason: 'Автокликер (' + why + ')', auto: true, at: now() };
  for (const [t, v] of Object.entries(db.tokens)) if (v.user === u.name) delete db.tokens[t];
  markDirty();
  pushTo(u.name, { t: 'ac.banned', reason: banText(u.ban) });
  setTimeout(() => { kick(u.name, banText(u.ban)); cardKick(u.name); }, 150).unref(); // дать клиенту получить ответ
  audit('система', 'anticlick.ban', u.display + ': ' + why);
  return true;
}
function cleanClicks(raw) {
  if (!Array.isArray(raw) || raw.length < AntiClick.CFG.window || raw.length > 200) return null;
  const out = []; let prev = -Infinity;
  for (const c of raw.slice(-AntiClick.CFG.window)) {
    if (!Array.isArray(c) || c.length < 3) return null;
    const x = +c[0], y = +c[1], t = +c[2];
    if (![x, y, t].every(Number.isFinite) || x < -1e5 || x > 1e5 || y < -1e5 || y > 1e5 || t < prev) return null;
    prev = t; out.push([x, y, t]);
  }
  return out;
}

async function api(req, res) {
  const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(o)); };
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,GET' }); return res.end(); }
  if (req.url === '/api/ping') return json(200, { ok: true, cfg: { fee: CFG.transferFee }, version: currentVersion(), release: !!RELEASE.running });
  if (req.url === '/api/prices') return json(200, { ok: true, prices: prices });
  if (req.method !== 'POST') return json(404, { ok: false });
  let body; try { body = await readBody(req); } catch (e) { return json(400, { ok: false, err: 'Плохой запрос' }); }
  const ip = ipOf(req);
  const name = String(body.name || '').trim(), pw = String(body.password || '');
  if (req.url === '/api/register') {
    if (limited('reg:' + ip, 5, 3600000)) return json(429, { ok: false, err: 'Слишком много регистраций, попробуйте позже' });
    if (!NAME_RE.test(name)) return json(400, { ok: false, err: 'Ник: 3–16 символов, буквы/цифры/_' });
    if (pw.length < 6 || pw.length > 64) return json(400, { ok: false, err: 'Пароль: 6–64 символа' });
    if (getUser(name)) return json(409, { ok: false, err: 'Этот ник уже занят' });
    const salt = crypto.randomBytes(16).toString('hex');
    const u = db.users[key(name)] = { name: key(name), display: name, salt, hash: hashPw(pw, salt), createdAt: now(), lastSeen: now(), admin: false, ban: null, mutedUntil: 0,
      friends: [], incoming: [], outgoing: [], save: null, balance: 0, pending: [], tx: [],
      xp: 0, lastDaily: 0, stats: { msgs: 0, transfers: 0, bj: 0, bjWins: 0, duels: 0, duelWins: 0 }, bank: { amount: 0, since: 0 },
      avatar: null, color: '', nameAt: 0, bio: '' };
    markDirty();
    return json(200, { ok: true, token: issueToken(u), name: u.display });
  }
  if (req.url === '/api/login') {
    if (limited('login:' + ip, 20, 600000) || limited('loginu:' + key(name), 10, 600000)) return json(429, { ok: false, err: 'Слишком много попыток входа, подождите' });
    const u = getUser(name);
    if (!u || !safeEq(hashPw(pw, u.salt), u.hash)) return json(401, { ok: false, err: 'Неверный ник или пароль' });
    const b = banInfo(u); if (b) return json(403, { ok: false, err: banText(b) });
    return json(200, { ok: true, token: issueToken(u), name: u.display });
  }
  /* проверка разбана после антиклика (с экрана блокировки, без токена). Если игра зафиксировала бан офлайн —
     присылает те же 50 кликов, сервер перепроверяет и банит аккаунт. */
  if (req.url === '/api/acstatus') {
    if (limited('login:' + ip, 20, 600000) || limited('loginu:' + key(name), 10, 600000)) return json(429, { ok: false, err: 'Слишком много попыток, подождите' });
    const u = getUser(name);
    if (!u || !safeEq(hashPw(pw, u.salt), u.hash)) return json(401, { ok: false, err: 'Неверный ник или пароль' });
    const clicks = cleanClicks(body.clicks);
    if (clicks) { const r = AntiClick.analyze(clicks); if (r.ban) autoBan(u, clicks, AntiClick.describe(r)); }
    const b = banInfo(u);
    return json(200, { ok: true, banned: !!b, reason: b ? banText(b) : '' });
  }
  return json(404, { ok: false });
}
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return api(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch (e) {} });
  let p; try { p = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  const rel = path.relative(ROOT, file);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).some(s => s.startsWith('.') || s === 'server' || s === 'node_modules')) { res.writeHead(404); return res.end('Not found'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
});

/* ======================= КАРТОЧНЫЕ СТОЛЫ =======================
   Один движок на все карточные игры: Блэкджек (2–4), Дурак (2–4),
   Пьяница (2–4), Верю-не-верю (2–6), Покер (2–6).
   Правила живут в cards.js и poker.js — здесь только деньги, столы,
   таймеры и рассылка состояния клиентам. */
const Cards = require(path.join(__dirname, 'cards.js'));
const Poker = require(path.join(__dirname, 'poker.js'));
const CARD_GAMES = {
  bj: { mod: Cards.bj }, durak: { mod: Cards.durak }, war: { mod: Cards.war },
  cheat: { mod: Cards.cheat }, poker: { mod: Poker.poker }
};
const CARD_ORDER = ['bj', 'durak', 'war', 'cheat', 'poker'];
const cardRooms = new Map();   // id -> {id, game, mod, bet, max, owner, players[], state, g, timer, deadline}
const userCard = new Map();    // name -> id
const CARD_LOBBY_MS = 30 * 60 * 1000;   // пустой стол закрывается
const CARD_TURN_MS = 60000;             // время на ход (если таймер не задан столом)
const CARD_DONE_MS = 180000;            // сколько держим результат на экране
const CARD_TIMERS = [15000, 30000, 60000, 120000, 0];   // таймер на ход: 0 — без ограничения
/* настройки стола от клиента: колода/перевод/партия (Дурак) + таймер на ход */
function cardOpts(game, m) {
  const src = (m && m.opts && typeof m.opts === 'object') ? m.opts : {};
  const o = {};
  if (game === 'durak') {
    o.deck = Number(src.deck) === 52 ? 52 : 36;
    o.transfer = src.transfer !== false;
    o.toEnd = src.toEnd !== false;
  }
  return o;
}
function cardTurnMs(m) {
  const ms = Math.floor(Number(m && m.turnMs));
  return CARD_TIMERS.indexOf(ms) >= 0 ? ms : CARD_TURN_MS;
}
function cardMaxFor(game, opts) {
  const mod = CARD_GAMES[game].mod;
  return mod.maxFor ? mod.maxFor(opts) : mod.max;
}

function cardRoomOf(name) { const id = userCard.get(name); return id ? cardRooms.get(id) || null : null; }
function cardLobby() {
  return [...cardRooms.values()].filter(r => r.state === 'lobby').map(r => ({
    id: r.id, game: r.game, title: r.mod.title, bet: r.bet, max: r.max, min: r.mod.min,
    players: r.players.length, owner: getUser(r.owner).display, opts: r.opts || {}, turnMs: r.turnMs
  }));
}
function pushCardLobby() { pushAll({ t: 'card.rooms', rooms: cardLobby() }); }
function cardView(rm, name) {
  return {
    id: rm.id, game: rm.game, title: rm.mod.title, bet: rm.bet, max: rm.max, min: rm.mod.min,
    owner: getUser(rm.owner).display, state: rm.state, deadline: rm.deadline || 0,
    turnMs: rm.turnMs, opts: rm.opts || {}, hardMax: cardMaxFor(rm.game, rm.opts),
    you: { name: getUser(name).display, owner: rm.owner === name },
    players: rm.players.map(p => ({ name: getUser(p).display, user: p, online: isOnline(p), owner: p === rm.owner, gone: rm.gone.has(p) }))
  };
}
function cardPush(rm) { for (const p of rm.players) if (!rm.gone.has(p)) pushTo(p, { t: 'card.room', room: cardView(rm, p) }); }
function cardGameView(rm, name) {
  const v = rm.mod.view(rm.g, rm.players.indexOf(name));
  v.id = rm.id; v.stake = rm.bet; v.title = rm.mod.title;
  if (v.pot == null) v.pot = rm.bet * rm.players.length;
  v.turn = rm.mod.turn(rm.g);
  v.names = rm.players.map(p => getUser(p).display);
  v.online = rm.players.map(p => isOnline(p));
  v.gone = rm.players.map(p => rm.gone.has(p));
  v.you = rm.players.indexOf(name);
  v.deadline = rm.deadline || 0;
  v.turnMs = rm.turnMs;
  v.opts = rm.opts || {};
  v.money = rm.payouts || null;
  return v;
}
function cardPushGame(rm) { for (const p of rm.players) if (!rm.gone.has(p)) pushTo(p, { t: 'card.state', game: cardGameView(rm, p) }); }
function cardArmLobby(rm) {
  clearTimeout(rm.timer);
  rm.timer = setTimeout(() => { if (rm.state === 'lobby') cardClose(rm, 'Стол закрыт: никто не собрался'); }, CARD_LOBBY_MS);
  if (rm.timer.unref) rm.timer.unref();
}
function cardClose(rm, why) {
  clearTimeout(rm.timer); rm.timer = null;
  if (rm.state === 'play') {
    for (const p of rm.players) addPending(getUser(p), 'credit', rm.bet, rm.mod.title + ': возврат ставки');
    delete db.escrow[rm.id]; markDirty();
  }
  cardRooms.delete(rm.id);
  for (const p of rm.players) { userCard.delete(p); pushTo(p, { t: 'toast', text: '🗑️ ' + why }); pushTo(p, { t: 'card.gone' }); }
  pushCardLobby();
}
function cardArmTurn(rm) {
  clearTimeout(rm.timer); rm.timer = null;
  rm.deadline = 0;
  const i = rm.mod.turn(rm.g);
  if (i < 0) return;
  const manual = rm.turnMs === 0;   /* «без таймера» — ждём игрока, сколько нужно */
  const who = rm.players[i];
  if (manual && who && !rm.gone.has(who) && isOnline(who)) return;
  const base = manual ? CARD_TURN_MS : rm.turnMs;
  const ms = rm.mod.delay ? rm.mod.delay(rm.g, base) : base;
  if (!manual) rm.deadline = now() + ms;
  rm.timer = setTimeout(() => { if (rm.state === 'play') { cardAuto(rm); cardAfter(rm); } }, ms + 200);
  if (rm.timer.unref) rm.timer.unref();
}
function cardAuto(rm) {
  const st = rm.g;
  if (rm.mod.done(st)) return;
  const i = rm.mod.turn(st);
  if (i < 0) return;
  const v = rm.mod.view(st, i);
  try {
    if (rm.game === 'poker') {
      if (v.can.check) rm.mod.act(st, i, { act: 'check' }); else rm.mod.act(st, i, { act: 'fold' });
    } else if (rm.game === 'bj') {
      if (v.can.hit && v.total < 17) rm.mod.act(st, i, { act: 'hit' }); else rm.mod.act(st, i, { act: 'stand' });
    } else if (rm.game === 'cheat') {
      if (v.phase === 'place') rm.mod.act(st, i, { act: 'play', cards: [0] }); else rm.mod.act(st, i, { act: 'believe' });
    } else if (rm.game === 'war') {
      if (v.phase === 'reveal' && v.canOpen) rm.mod.act(st, i, { act: 'open' });
      else if (v.phase === 'result') rm.mod.act(st, i, { act: 'next' });
    } else if (rm.game === 'durak') {
      if (v.phase === 'defend') rm.mod.act(st, i, { act: 'take' });
      else if (v.can.pass) rm.mod.act(st, i, { act: 'pass' });
      else {
        const hand = st.hand[i], ranks = new Set(st.table.map(p => p.a.r));
        let pick = -1;
        for (let j = 0; j < hand.length; j++) if (v.can.first || ranks.has(hand[j].r)) { pick = j; break; }
        if (pick >= 0) rm.mod.act(st, i, { act: 'attack', card: pick });
        else if (v.can.pass) rm.mod.act(st, i, { act: 'pass' });
      }
    }
  } catch (e) { /* ход невозможен — подождём следующего действия */ }
}
function cardAfter(rm) {
  if (rm.state !== 'play') return;
  if (rm.mod.done(rm.g)) return cardSettle(rm);
  cardArmTurn(rm);      /* сначала взводим таймер хода — дедлайн должен попасть в раздачу вида */
  cardPushGame(rm);
}
function cardStart(rm) {
  if (rm.state !== 'lobby') throw new Error('Игра уже идёт');
  if (rm.players.length < rm.mod.min) throw new Error('Нужно минимум ' + rm.mod.min + ' игрока');
  const hardMax = cardMaxFor(rm.game, rm.opts);
  if (rm.players.length > hardMax) throw new Error('За этот стол могут сесть максимум ' + hardMax + ' игрока');
  for (const p of rm.players) if (avail(getUser(p)) < rm.bet) throw new Error('У игрока ' + getUser(p).display + ' не хватает денег');
  clearTimeout(rm.timer); rm.timer = null;
  const rnd = n => crypto.randomInt(n);
  const names = rm.players.map(p => getUser(p).display);
  db.escrow[rm.id] = { bet: rm.bet, players: rm.players.slice(), at: now() };
  for (const p of rm.players) addPending(getUser(p), 'debit', rm.bet, rm.mod.title + ': ставка');
  rm.state = 'play'; rm.payouts = null; rm.deadline = 0; rm.gone = new Set();
  rm.g = rm.game === 'poker' ? rm.mod.make(names, rm.bet, rnd) : rm.mod.make(names, rnd, rm.opts);
  markDirty();
  cardPush(rm);
  cardAfter(rm);
}
function cardSettle(rm) {
  if (rm.state === 'done') return;
  clearTimeout(rm.timer); rm.timer = null;
  const pay = rm.mod.payouts(rm.g, rm.bet);
  rm.payouts = pay.map(x => Math.max(0, Math.floor(Number(x) || 0)));
  /* деньги не должны исчезать: если движок вернул меньше банка — остаток победителю */
  const potSum = rm.bet * rm.players.length;
  const gotSum = rm.payouts.reduce((a, b) => a + b, 0);
  if (gotSum < potSum) {
    const left = potSum - gotSum;
    let k = 0;
    for (let i = 1; i < rm.payouts.length; i++) if (rm.payouts[i] > rm.payouts[k]) k = i;
    if (rm.payouts[k] > 0) rm.payouts[k] += left;
    else {
      const n = rm.payouts.length || 1, bonus = Math.floor(left / n);
      let rem = left - bonus * n;
      for (let i = 0; i < rm.payouts.length; i++) rm.payouts[i] = bonus + (rem-- > 0 ? 1 : 0);
    }
  }
  const winners = [];
  for (let i = 0; i < rm.players.length; i++) {
    const U = getUser(rm.players[i]); if (!U) continue;
    const amount = rm.payouts[i], net = amount - rm.bet;
    if (amount) addPending(U, 'credit', amount, rm.mod.title + ': банк');
    logTx(U, { type: 'game', amount: net, note: rm.mod.title + (net > 0 ? ' · победа' : net < 0 ? ' · проигрыш' : ' · возврат ставки') });
    const S = stats(U); S.cards = (S.cards || 0) + 1; addXp(U, CFG.xpBj);
    if (net > 0) { S.cardWins = (S.cardWins || 0) + 1; addXp(U, CFG.xpBjWin); winners.push(i); }
  }
  delete db.escrow[rm.id];
  rm.state = 'done'; rm.deadline = 0; rm.winners = winners;
  markDirty();
  cardPush(rm);
  cardPushGame(rm);
  pushCardLobby();
  for (const p of rm.players) userCard.delete(p);
  const t = setTimeout(() => cardRooms.delete(rm.id), CARD_DONE_MS);
  if (t.unref) t.unref();
}
function cardLeave(name, why, force) {
  const rm = cardRoomOf(name); if (!rm) return false;
  /* партия идёт: выход = «сдаться» — карты уходят из игры, ставка остаётся в банке */
  if (rm.state === 'play') {
    if (!force) throw new Error('Партия идёт — её нужно доиграть');
    const i = rm.players.indexOf(name);
    if (i >= 0 && !rm.gone.has(name)) {
      rm.gone.add(name);
      if (typeof rm.mod.leave === 'function') { try { rm.mod.leave(rm.g, i); } catch (e) { } }
    }
    userCard.delete(name);
    pushTo(name, { t: 'card.gone' });
    pushTo(name, { t: 'toast', text: '🚪 Вы вышли из партии — ставка не возвращается' });
    for (const p of rm.players) if (!rm.gone.has(p)) pushTo(p, { t: 'toast', text: '🚪 ' + getUser(name).display + ' вышел(ла) из партии' });
    markDirty();
    cardAfter(rm);
    pushCardLobby();
    return true;
  }
  clearTimeout(rm.timer); rm.timer = null;
  userCard.delete(name);
  dropFrom(rm.players, name);
  if (!rm.players.length) { cardRooms.delete(rm.id); pushCardLobby(); return true; }
  if (rm.owner === name) { cardClose(rm, 'Создатель стола вышел'); return true; }
  markDirty(); cardArmLobby(rm); cardPush(rm); pushCardLobby();
  if (why) for (const p of rm.players) pushTo(p, { t: 'toast', text: '👋 ' + getUser(name).display + ' вышел из-за стола' });
  return true;
}
function cardOnDisconnect(name) {
  const rm = cardRoomOf(name); if (!rm) return;
  if (rm.state === 'lobby') { cardPush(rm); pushCardLobby(); }
  else { cardArmTurn(rm); cardPushGame(rm); }   /* «без таймера» — доигрываем за ушедшего */
}
/* бан/кик прямо за столом: возвращаем ставки и закрываем стол */
function cardKick(name) {
  const rm = cardRoomOf(name); if (!rm) return;
  if (rm.state === 'play') {
    clearTimeout(rm.timer); rm.timer = null;
    for (const p of rm.players) addPending(getUser(p), 'credit', rm.bet, rm.mod.title + ': возврат ставки');
    delete db.escrow[rm.id]; markDirty();
    cardRooms.delete(rm.id);
    for (const p of rm.players) { userCard.delete(p); pushTo(p, { t: 'card.gone' }); }
    pushCardLobby();
    return;
  }
  try { cardLeave(name, false); } catch (e) { }
}
function cardMake(u, game, bet, max, opts, turnMs) {
  const def = CARD_GAMES[game];
  if (!def) throw new Error('Неизвестная игра');
  const hardMax = cardMaxFor(game, opts);
  const rm = {
    id: nid('K'), game: game, mod: def.mod, bet: bet,
    max: Math.max(def.mod.min, Math.min(hardMax, Math.floor(Number(max) || hardMax))),
    opts: opts || {}, turnMs: turnMs == null ? CARD_TURN_MS : turnMs,
    owner: u.name, players: [u.name], state: 'lobby', g: null, timer: null, deadline: 0,
    payouts: null, gone: new Set()
  };
  cardRooms.set(rm.id, rm); userCard.set(u.name, rm.id);
  markDirty(); cardArmLobby(rm); pushCardLobby();
  return rm;
}

/* после падения сервера возвращаем ставки из незавершённых игр */
for (const [gid, e] of Object.entries(db.escrow)) {
  for (const p of e.players) { const u = db.users[p]; if (u) { u.pending.push({ id: nid('p'), kind: 'credit', amount: e.bet, note: 'Возврат ставки (перезапуск сервера)', at: now() }); } }
  delete db.escrow[gid];
}
flush();


/* ======================= WEBSOCKET ======================= */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 3 * 1024 * 1024 });
const parseAmount = x => { const n = Math.floor(Number(x)); return isFinite(n) && n > 0 && n < 1e30 ? n : 0; };

function summary(u) {
  if (!u.save) return null;
  const p = parseSave(u.save.main, u.save.garden);
  return { rev: u.save.rev, updatedAt: u.save.updatedAt, device: u.save.device || '', money: p.ok ? p.money : 0, clicks: p.ok ? p.clicks : 0 };
}
function meInfo(u) {
  return { name: u.display, admin: !!u.admin, owner: !!u.owner, rev: u.save ? u.save.rev : 0, avail: avail(u), xp: u.xp || 0, level: levelOf(u.xp), avatar: u.avatar || null, color: u.color || '', nameAt: u.nameAt || 0, prices: prices, cfg: { fee: CFG.transferFee, minTransfer: CFG.minTransfer, minBet: CFG.minBet, turnMs: CFG.turnMs, bankRate: CFG.bankRate, bankMin: CFG.bankMin, renameMs: CFG.renameMs, rooms: ROOMS.map(([id, ico, name]) => ({ id, ico, name })), emojis: EMOJIS, colors: COLORS, avatars: AVATARS, bot: botInfo() } };
}
/* отдельный чат с ботом: клиент показывает его в списке чатов */
function botInfo() { return { peer: BOT_PEER, name: parrotCfg().botName, on: !!(db.meta && db.meta.parrotOn) }; }
function friendsView(u) {
  const f = n => { const x = getUser(n); return x ? Object.assign(pub(x), { online: isOnline(x.name) }) : null; };
  return { friends: u.friends.map(f).filter(Boolean).sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name)), incoming: u.incoming.map(f).filter(Boolean), outgoing: u.outgoing.map(f).filter(Boolean) };
}
const dmKey = (a, b) => [a, b].sort().join('|');
function chatMsg(u, text, room) { return { id: nid('m'), from: u.display, admin: !!u.admin, owner: !!u.owner, av: u.avatar || null, col: u.color || '', text, at: now(), room: room || 'global', react: {} }; }
function dropFrom(arr, v) { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); }

/* ---------------- ParrotAI — отдельный чат с ботом ----------------
   Модель: server/models/Parrot-ai.bin (или .json) — её обучение делает
   страница tools/parrot-trainer.html. Включается и настраивается из админки.
   У каждого игрока своя переписка с ботом (ключ dmKey(игрок, '@parrot')),
   в общем чате бот не появляется. */
const PARROT_CFG_DEFAULT = { botName: 'ParrotAI', trigger: 'q:', askQuestion: true, answerAll: false, delaySec: 1, maxTokens: 400, contextSize: 8, random: false };
function parrotCfg() { return Object.assign({}, PARROT_CFG_DEFAULT, (db.meta && db.meta.parrotCfg) || {}); }
function cleanParrotCfg(c) {
  const out = {};
  if (c.botName != null) out.botName = cleanText(c.botName, 24) || 'ParrotAI';
  if (c.trigger != null) out.trigger = cleanText(c.trigger, 10);
  if (c.askQuestion != null) out.askQuestion = !!c.askQuestion;
  if (c.answerAll != null) out.answerAll = !!c.answerAll;
  if (c.delaySec != null) out.delaySec = Math.min(30, Math.max(0, Number(c.delaySec) || 0));
  if (c.maxTokens != null) out.maxTokens = Math.min(1000, Math.max(10, Math.floor(Number(c.maxTokens) || 400)));
  if (c.contextSize != null) out.contextSize = Math.min(50, Math.max(1, Math.floor(Number(c.contextSize) || 8)));
  if (c.random != null) out.random = !!c.random;
  return out;
}
/* отдельный чат с ботом: у каждого игрока своя переписка.
   В никах игроков символ @ запрещён (NAME_RE), поэтому ключ '@parrot'
   никогда не столкнётся с настоящим игроком. */
const BOT_PEER = '@parrot';
/* ответ бота в личный чат игрока; чуть медленнее ответа человека */
function parrotReplyTo(userName, question) {
  const c = parrotCfg();
  if (!(db.meta && db.meta.parrotOn)) return;
  if (limited('parrot:' + key(userName), 15, 60000)) return;
  const t = setTimeout(() => {
    let ans = null;
    try { ans = Parrot.answer(question, c); } catch (e) { ans = null; }
    if (!ans) return;
    const u = db.users[key(userName)];
    const msg = {
      id: nid('m'), from: c.botName, admin: false, owner: false, bot: true, av: null, col: '',
      text: String(ans).slice(0, CFG.chatMax), at: now(), room: 'bot', to: u ? u.display : userName, react: {}
    };
    const k = dmKey(userName, BOT_PEER);
    const arr = db.dms[k] = db.dms[k] || [];
    arr.push(msg); if (arr.length > 150) arr.splice(0, arr.length - 150);
    markDirty(); pushTo(userName, { t: 'chat.dm', msg, peer: BOT_PEER });
  }, Math.max(0, c.delaySec) * 1000 + Math.floor(Math.random() * 400));
  if (t.unref) t.unref();
}
/* сообщение игрока боту (обрабатывается в chat.send) */
function parrotDm(u, text) {
  const c = parrotCfg();
  if (!(db.meta && db.meta.parrotOn)) throw new Error('🦜 ' + c.botName + ' сейчас выключен');
  const k = dmKey(u.name, BOT_PEER);
  const arr = db.dms[k] = db.dms[k] || [];
  const msg = Object.assign(chatMsg(u, text, 'bot'), { to: c.botName });
  arr.push(msg); if (arr.length > 150) arr.splice(0, arr.length - 150);
  stats(u).msgs++; addXp(u, CFG.xpMsg);
  markDirty();
  pushTo(u.name, { t: 'chat.dm', msg, peer: BOT_PEER });
  parrotReplyTo(u.name, text);
  return {};
}
const PARROT_LOAD = Parrot.load();

/* кэш таблиц лидеров: пересчёт не чаще раза в минуту */
let lbCache = { at: 0, data: null };

const handlers = {
  async ping() { return {}; },

  /* ---------- ОБЛАЧНЫЕ СОХРАНЕНИЯ ---------- */
  async 'save.info'(ctx) { return { save: summary(ctx.u), rev: ctx.u.save ? ctx.u.save.rev : 0 }; },
  async 'save.get'(ctx) {
    const s = ctx.u.save; if (!s) return { empty: true };
    return { main: s.main, garden: s.garden, rev: s.rev, updatedAt: s.updatedAt };
  },
  async 'save.put'(ctx, m) {
    const u = ctx.u;
    if (limited('savep:' + u.name, 40, 60000)) throw new Error('Слишком часто, подождите');
    const cur = u.save ? u.save.rev : 0;
    const device = cleanText(m.device, 40);
    const sameDevice = !!(u.save && device && u.save.device === device);   // последним писало это же устройство — конфликта нет
    if (!m.force && !sameDevice && (Number(m.baseRev) || 0) !== cur) return { ok: false, err: 'conflict', rev: cur, save: summary(u) };
    const p = parseSave(m.main, m.garden);
    if (!p.ok) throw new Error(p.err);
    ackPending(u, m.ack);
    u.balance = p.money;
    u.save = { main: m.main, garden: m.garden == null ? null : m.garden, rev: cur + 1, updatedAt: now(), device };
    markDirty();
    return { rev: u.save.rev, updatedAt: u.save.updatedAt, avail: avail(u) };
  },

  /* ---------- КОШЕЛЁК ---------- */
  async 'wallet.pending'(ctx) { return { items: ctx.u.pending.slice(0, 200), avail: avail(ctx.u) }; },
  async 'wallet.ack'(ctx, m) { ackPending(ctx.u, m.ids); return { avail: avail(ctx.u) }; },
  async 'wallet.history'(ctx) { return { tx: ctx.u.tx.slice(-40).reverse(), avail: avail(ctx.u) }; },
  async transfer(ctx, m) {
    const u = ctx.u;
    if (limited('tr:' + u.name, 6, 10000)) throw new Error('Слишком часто, подождите немного');
    const to = getUser(m.to); if (!to) throw new Error('Игрок не найден');
    if (to.name === u.name) throw new Error('Нельзя переводить самому себе');
    if (banInfo(to)) throw new Error('Игрок заблокирован');
    const amount = parseAmount(m.amount);
    if (amount < CFG.minTransfer) throw new Error('Минимальный перевод: ' + CFG.minTransfer);
    const fee = Math.max(1, Math.ceil(amount * CFG.transferFee)), total = amount + fee;
    if (avail(u) < total) throw new Error('Недостаточно денег в облаке. Нужно ' + total + ' (с комиссией). Подождите синхронизации.');
    addPending(u, 'debit', total, `Перевод → ${to.display} (комиссия ${fee})`);
    addPending(to, 'credit', amount, `Перевод от ${u.display}`);
    logTx(u, { type: 'out', amount: -total, fee, other: to.display }); logTx(to, { type: 'in', amount, other: u.display });
    stats(u).transfers++; addXp(u, CFG.xpTransfer); addXp(to, 1);
    return { amount, fee, total, avail: avail(u) };
  },

  /* ---------- ЧАТ ---------- */
  async 'chat.history'(ctx, m) {
    if (m.with === BOT_PEER) return { msgs: (db.dms[dmKey(ctx.u.name, BOT_PEER)] || []).slice(-100), bot: parrotCfg().botName, on: !!(db.meta && db.meta.parrotOn) };
    if (m.with) { const o = getUser(m.with); if (!o) throw new Error('Игрок не найден'); return { msgs: (db.dms[dmKey(ctx.u.name, o.name)] || []).slice(-100) }; }
    const room = ROOM_IDS.includes(m.room) ? m.room : 'global';
    const box = room === 'global' ? db.chat : (db.rooms[room] || []);
    return { msgs: box.slice(-100), room };
  },
  async 'chat.send'(ctx, m) {
    const u = ctx.u;
    if (u.mutedUntil && u.mutedUntil > now()) throw new Error('Вы заглушены до ' + new Date(u.mutedUntil).toLocaleString('ru-RU'));
    if (limited('chat:' + u.name, 5, 6000)) throw new Error('Не так быстро');
    const text = cleanText(m.text, CFG.chatMax); if (!text) throw new Error('Пустое сообщение');
    if (m.to === BOT_PEER) return parrotDm(u, text);
    if (m.to) {
      const o = getUser(m.to); if (!o) throw new Error('Игрок не найден');
      if (!u.friends.includes(o.name)) throw new Error('Личные сообщения доступны только друзьям');
      const msg = Object.assign(chatMsg(u, text, 'dm'), { to: o.display });
      const k = dmKey(u.name, o.name); const arr = db.dms[k] = db.dms[k] || []; arr.push(msg); if (arr.length > 150) arr.splice(0, arr.length - 150);
      stats(u).msgs++; addXp(u, CFG.xpMsg);
      markDirty(); pushTo(o.name, { t: 'chat.dm', msg, peer: u.display }); pushTo(u.name, { t: 'chat.dm', msg, peer: o.display });
      return {};
    }
    const room = ROOM_IDS.includes(m.room) ? m.room : 'global';
    const msg = chatMsg(u, text, room);
    const box = room === 'global' ? db.chat : (db.rooms[room] = db.rooms[room] || []);
    box.push(msg); if (box.length > CFG.chatMax) box.splice(0, box.length - CFG.chatMax);
    stats(u).msgs++; addXp(u, CFG.xpMsg);
    markDirty(); pushAll({ t: 'chat.msg', msg });
    return {};
  },
  async 'chat.react'(ctx, m) {
    const u = ctx.u, emoji = String(m.emoji || '');
    if (EMOJIS.indexOf(emoji) < 0) throw new Error('Недоступная реакция');
    if (limited('react:' + u.name, 20, 10000)) throw new Error('Не так быстро');
    let msg = null, dm = null;
    for (const b of [db.chat].concat(Object.values(db.rooms || {}))) { msg = b.find(x => x.id === m.msgId); if (msg) break; }
    if (!msg) for (const [k, arr] of Object.entries(db.dms || {})) { const f = (arr || []).find(x => x.id === m.msgId); if (f) { msg = f; dm = k.split('|'); break; } }
    if (!msg) throw new Error('Сообщение не найдено');
    msg.react = msg.react || {};
    const arr = msg.react[emoji] = msg.react[emoji] || [];
    const i = arr.indexOf(u.display);
    if (i >= 0) arr.splice(i, 1); else { arr.push(u.display); if (arr.length > 50) arr.shift(); }
    if (!arr.length) delete msg.react[emoji];
    markDirty();
    const payload = { t: 'chat.react', msgId: msg.id, emoji, by: u.display, add: i < 0, react: msg.react };
    if (dm) { for (const n of dm) pushTo(n, payload); } else pushAll(payload);
    return { react: msg.react };
  },

  /* ---------- ПРОФИЛЬ / ОПЫТ / ЛИДЕРБОРД ---------- */
  async 'profile.get'(ctx) {
    const u = ctx.u, xp = u.xp || 0, level = levelOf(xp);
    return { name: u.display, admin: !!u.admin, owner: !!u.owner, xp, level, avatar: u.avatar || null, color: u.color || '', nameAt: u.nameAt || 0, bio: u.bio || '',
      canRenameIn: u.nameAt ? Math.max(0, CFG.renameMs - (now() - u.nameAt)) : 0,
      levelFloor: xpForLevel(level), levelNext: xpForLevel(level + 1),
      stats: Object.assign({ msgs: 0, transfers: 0, bj: 0, bjWins: 0, duels: 0, duelWins: 0 }, u.stats || {}),
      bank: bankInfo(u), avail: avail(u), rev: u.save ? u.save.rev : 0, createdAt: u.createdAt || 0, lastSeen: u.lastSeen || 0,
      colors: COLORS, avatars: AVATARS };
  },
  async 'profile.setcolor'(ctx, m) {
    const raw = String(m.color == null ? '' : m.color).trim();
    if (raw && !COLORS.some(c => c.id === raw) && !COLOR_RE.test(raw)) throw new Error('Неверный цвет. Пример: #ff8a00 или #ff8a00,#00c2ff');
    ctx.u.color = raw ? raw.toLowerCase() : '';
    markDirty();
    pushTo(ctx.u.name, { t: 'me.update', me: { name: ctx.u.display, avatar: ctx.u.avatar || null, color: ctx.u.color } });
    friendsPresence(ctx.u);
    return { color: ctx.u.color };
  },
  async 'profile.setavatar'(ctx, m) {
    const a = m.avatar == null ? '' : String(m.avatar);
    if (!a) ctx.u.avatar = null;
    else if (AVATARS.indexOf(a) >= 0) ctx.u.avatar = a;
    else if (/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(a) && a.length <= CFG.avatarMax) ctx.u.avatar = a;
    else throw new Error('Недопустимая аватарка (максимум ~20 КБ)');
    markDirty();
    pushTo(ctx.u.name, { t: 'me.update', me: { name: ctx.u.display, avatar: ctx.u.avatar || null, color: ctx.u.color || '' } });
    friendsPresence(ctx.u);
    return { avatar: ctx.u.avatar };
  },
  async 'profile.setbio'(ctx, m) {
    ctx.u.bio = cleanText(m.bio == null ? '' : String(m.bio), CFG.bioMax);
    markDirty();
    return { bio: ctx.u.bio };
  },
  async 'profile.setname'(ctx, m) {
    const u = ctx.u, name = String(m.name || '').trim();
    if (!NAME_RE.test(name)) throw new Error('Ник: 3–16 символов, буквы/цифры/_');
    const oldKey = u.name, oldDisplay = u.display, newKey = key(name);
    if (newKey === oldKey) throw new Error('Это ваш текущий ник');
    if (getUser(name)) throw new Error('Этот ник уже занят');
    if (u.nameAt && now() - u.nameAt < CFG.renameMs) throw new Error('Ник можно менять раз в ' + Math.round(CFG.renameMs / 60000) + ' мин');
    delete db.users[oldKey];
    u.name = newKey; u.display = name; u.nameAt = now();
    db.users[newKey] = u;
    /* переносим все ссылки на старое имя */
    for (const t of Object.values(db.tokens)) if (t.user === oldKey) t.user = newKey;
    for (const o of Object.values(db.users)) {
      o.friends = (o.friends || []).map(n => n === oldKey ? newKey : n);
      o.incoming = (o.incoming || []).map(n => n === oldKey ? newKey : n);
      o.outgoing = (o.outgoing || []).map(n => n === oldKey ? newKey : n);
    }
    const nd = {}; for (const [k, arr] of Object.entries(db.dms || {})) { const parts = k.split('|').map(p => p === oldKey ? newKey : p).sort(); const nk = parts.join('|'); nd[nk] = (nd[nk] || []).concat(arr); }
    db.dms = nd;
    if (conns.has(oldKey)) { conns.set(newKey, conns.get(oldKey)); conns.delete(oldKey); }
    if (userCard.has(oldKey)) { userCard.set(newKey, userCard.get(oldKey)); userCard.delete(oldKey); }
    if (userDuel.has(oldKey)) { userDuel.set(newKey, userDuel.get(oldKey)); userDuel.delete(oldKey); }
    for (const e of Object.values(db.escrow)) e.players = e.players.map(n => n === oldKey ? newKey : n);
    for (const r of cardRooms.values()) { r.players = r.players.map(n => n === oldKey ? newKey : n); if (r.owner === oldKey) r.owner = newKey; }
    for (const t of duels.values()) { if (t.owner === oldKey) t.owner = newKey; if (t.other === oldKey) t.other = newKey; }
    for (const b of [db.chat].concat(Object.values(db.rooms || {}))) for (const msg of b) if (msg.from === oldDisplay) msg.from = name;
    for (const arr of Object.values(db.dms)) for (const msg of arr) { if (msg.from === oldDisplay) msg.from = name; if (msg.to === oldDisplay) msg.to = name; }
    markDirty();
    pushTo(newKey, { t: 'me.update', me: { name: name, avatar: u.avatar || null, color: u.color || '' } });
    const sysMsg = { id: nid('m'), from: name, admin: !!u.admin, owner: !!u.owner, av: u.avatar || null, col: u.color || '',
      text: '✏️ ' + oldDisplay + ' теперь известен как «' + name + '»', at: now(), room: 'global', react: {}, sys: true };
    db.chat.push(sysMsg); if (db.chat.length > CFG.chatMax) db.chat.splice(0, db.chat.length - CFG.chatMax);
    markDirty(); pushAll({ t: 'chat.msg', msg: sysMsg });
    friendsPresence(u);
    return { name, nameAt: u.nameAt };
  },
  async 'players.list'(ctx, m) {
    const q = key(m.q || '');
    const list = Object.values(db.users).filter(u => !q || u.name.includes(q))
      .sort((a, b) => (isOnline(b.name) - isOnline(a.name)) || (b.lastSeen || 0) - (a.lastSeen || 0)).slice(0, 200)
      .map(u => Object.assign(pub(u), { online: isOnline(u.name), xp: u.xp || 0 }));
    return { players: list, total: Object.keys(db.users).length, online: conns.size };
  },
  async 'profile.view'(ctx, m) {
    const u = getUser(m.name);
    if (!u) throw new Error('Игрок не найден');
    const xp = u.xp || 0, level = levelOf(xp), st = Object.assign({ msgs: 0, transfers: 0, bj: 0, bjWins: 0, duels: 0, duelWins: 0 }, u.stats || {});
    return { name: u.display, admin: !!u.admin, owner: !!u.owner, avatar: u.avatar || null, color: u.color || '', bio: u.bio || '',
      xp, level, levelFloor: xpForLevel(level), levelNext: xpForLevel(level + 1),
      stats: st, friends: (u.friends || []).length, avail: avail(u), rev: u.save ? u.save.rev : 0,
      createdAt: u.createdAt || 0, lastSeen: u.lastSeen || 0, online: isOnline(u.name),
      self: u.name === ctx.u.name, friend: (ctx.u.friends || []).indexOf(u.name) >= 0,
      incoming: (ctx.u.incoming || []).indexOf(u.name) >= 0, outgoing: (ctx.u.outgoing || []).indexOf(u.name) >= 0 };
  },
  /* Таблицы лидеров: считаем прямо по облачным данным (топ-20, кэш на минуту) */
  async 'leaderboard'(ctx) {
    const all = Object.values(db.users);
    const cached = lbCache.data;
    const many = all.length > 10;   /* на маленьком сервере пересчитываем каждый раз — таблицы всегда свежие */
    if (cached && many && now() - lbCache.at < 60000) return cached.data;
    const saves = new Map();
    const si = u => {   /* разбор сохранения нужен только для кликов и сада — считаем один раз */
      if (!saves.has(u.name)) { let p = null; try { p = u.save ? parseSave(u.save.main, u.save.garden) : null; } catch (e) { p = null; } saves.set(u.name, p && p.ok ? p : null); }
      return saves.get(u.name);
    };
    const winsOf = u => { const s = stats(u); return (s.bjWins || 0) + (s.duelWins || 0) + (s.cardWins || 0); };
    const board = (val, key) => all.map(u => ({ u, v: Math.max(0, Math.floor(val(u) || 0)) }))
      .filter(r => r.v > 0).sort((a, b) => b.v - a.v).slice(0, 20)
      .map(r => Object.assign(pub(r.u), { online: isOnline(r.u.name), v: r.v, [key]: r.v }));
    const data = {
      xp: board(u => u.xp || 0, 'xp'),
      money: board(u => avail(u), 'money'),
      clicks: board(u => { const p = si(u); return p ? p.clicks : 0; }, 'clicks'),
      garden: board(u => { const p = si(u); return p ? p.gardenMoney : 0; }, 'garden'),
      wins: board(winsOf, 'wins'),
      msgs: board(u => stats(u).msgs || 0, 'msgs'),
      total: all.length, at: now()
    };
    lbCache = { at: now(), data: data };
    return data;
  },

  /* ---------- ОНЛАЙН-БАНК ---------- */
  async 'bank.info'(ctx) { return bankInfo(ctx.u); },
  async 'bank.deposit'(ctx, m) {
    const u = ctx.u;
    if (limited('bank:' + u.name, 20, 60000)) throw new Error('Слишком часто');
    const amount = parseAmount(m.amount);
    if (amount < CFG.bankMin) throw new Error('Минимальный вклад: ' + CFG.bankMin);
    if (avail(u) < amount) throw new Error('Недостаточно денег в облаке для вклада');
    const info = bankInfo(u);
    u.bank = { amount: (u.bank && u.bank.amount || 0) + info.interest + amount, since: now() };
    addPending(u, 'debit', amount, 'Банк: вклад');
    logTx(u, { type: 'bank', amount: -amount, other: 'Банк', note: 'вклад' });
    markDirty();
    return bankInfo(u);
  },
  async 'bank.withdraw'(ctx) {
    const u = ctx.u;
    const info = bankInfo(u);
    if (info.amount <= 0) throw new Error('Вклад пуст');
    const total = info.amount + info.interest;
    u.bank = { amount: 0, since: 0 };
    addPending(u, 'credit', total, 'Банк: снятие вклада + проценты');
    logTx(u, { type: 'bank', amount: total, other: 'Банк', note: 'снятие' });
    markDirty();
    return { amount: 0, interest: 0, paid: total, rate: CFG.bankRate, hours: 0, maxHours: CFG.bankMaxHours, min: CFG.bankMin };
  },

  /* ---------- ДУЭЛИ 1 НА 1 ---------- */
  async 'duel.tables'(ctx) { return { tables: duelList(), myTable: userDuel.get(ctx.u.name) || null }; },
  async 'duel.create'(ctx, m) {
    const u = ctx.u;
    if (userDuel.has(u.name)) throw new Error('У вас уже есть вызов');
    if (limited('duelc:' + u.name, 10, 60000)) throw new Error('Слишком часто');
    const game = m.game === 'coin' ? 'coin' : 'dice';
    const bet = parseAmount(m.bet);
    if (bet < CFG.minBet) throw new Error('Минимальная ставка: ' + CFG.minBet);
    if (avail(u) < bet) throw new Error('Недостаточно денег в облаке для такой ставки');
    const t = { id: nid('d'), game, bet, owner: u.name };
    duels.set(t.id, t); userDuel.set(u.name, t.id); pushDuels();
    return { table: t.id };
  },
  async 'duel.cancel'(ctx) { duelDrop(ctx.u.name); return {}; },
  async 'duel.join'(ctx, m) {
    const u = ctx.u, t = duels.get(m.table);
    if (!t) throw new Error('Вызов уже принят или закрыт');
    if (t.owner === u.name) throw new Error('Это ваш вызов');
    if (userDuel.has(u.name)) throw new Error('У вас уже есть вызов');
    const owner = getUser(t.owner);
    if (avail(u) < t.bet) throw new Error('Недостаточно денег в облаке для такой ставки');
    duels.delete(t.id); userDuel.delete(t.owner); pushDuels();
    if (!owner || avail(owner) < t.bet) { pushTo(t.owner, { t: 'toast', text: '❌ Вызов закрыт: не хватает денег' }); throw new Error('Создатель вызова не может сыграть'); }
    t.other = u.name;
    duelResolve(t);
    return {};
  },

  /* ---------- РУЛЕТОЧНЫЙ СТОЛ (2–4 игрока, как в аркаде) ---------- */
  async 'roul.rooms'(ctx) { return { rooms: roulLobby(), room: roulRoomOf(ctx.u.name) ? roulView(roulRoomOf(ctx.u.name), ctx.u.name) : null }; },
  async 'roul.create'(ctx, m) {
    const u = ctx.u;
    if (roulRoomOf(u.name)) throw new Error('Вы уже за столом');
    if (userDuel.has(u.name)) throw new Error('Сначала закройте свой вызов на дуэль');
    if (limited('roulc:' + u.name, 10, 60000)) throw new Error('Слишком часто');
    const bet = parseAmount(m.bet);
    if (bet < CFG.minBet) throw new Error('Минимальная ставка: ' + CFG.minBet);
    if (avail(u) < bet) throw new Error('Недостаточно денег в облаке для такой ставки');
    const max = Math.max(ROUL_MIN, Math.min(ROUL_MAX, Math.floor(Number(m.max) || ROUL_MIN)));
    const rm = { id: nid('R'), bet, max, owner: u.name, players: [u.name], state: 'lobby', bets: {}, ready: {}, num: null, view: {}, payout: {}, winners: null, timer: null, deadline: 0 };
    rouls.set(rm.id, rm); userRoul.set(u.name, rm.id);
    markDirty(); roulArmLobby(rm); pushRouls();
    return { room: roulView(rm, u.name) };
  },
  async 'roul.join'(ctx, m) {
    const u = ctx.u, rm = rouls.get(m.room);
    if (!rm) throw new Error('Стол уже закрыт');
    if (rm.state !== 'lobby') throw new Error('Стол уже играет');
    if (rm.players.indexOf(u.name) >= 0) throw new Error('Вы уже за этим столом');
    if (rm.players.length >= rm.max) throw new Error('Стол заполнен (' + rm.max + ' игрока)');
    if (roulRoomOf(u.name)) throw new Error('Вы уже за столом');
    if (avail(u) < rm.bet) throw new Error('Недостаточно денег в облаке для такой ставки');
    rm.players.push(u.name); userRoul.set(u.name, rm.id);
    clearTimeout(rm.timer); roulArmLobby(rm);
    markDirty();
    for (const p of rm.players) pushTo(p, { t: 'toast', text: '🎡 ' + u.display + ' сел(а) за стол' });
    roulPush(rm); pushRouls();
    return { room: roulView(rm, u.name) };
  },
  async 'roul.leave'(ctx) { roulLeave(ctx.u.name, false); return {}; },
  async 'roul.start'(ctx) {
    const u = ctx.u, rm = roulRoomOf(u.name);
    if (!rm) throw new Error('Вы не за столом');
    if (rm.owner !== u.name) throw new Error('Начать игру может создатель стола');
    roulStart(rm);
    return { room: roulView(rm, u.name) };
  },
  async 'roul.bets'(ctx, m) {
    const u = ctx.u, rm = roulRoomOf(u.name);
    if (!rm) throw new Error('Вы не за столом');
    if (rm.state !== 'bet') throw new Error('Сейчас не время ставить');
    if (rm.ready[u.name]) throw new Error('Расклад уже сдан');
    const bets = roulBetsOk(m.bets, rm.bet);
    if (!bets) throw new Error('Разложите все фишки: сумма ставок должна быть ровно ' + rm.bet);
    rm.bets[u.name] = bets; rm.ready[u.name] = true;
    markDirty();
    if (rm.players.every(p => rm.ready[p])) roulResolve(rm); else roulPush(rm);
    return { room: roulView(rm, u.name) };
  },

  /* ---------- ДРУЗЬЯ ---------- */
  async 'friends.list'(ctx) { return friendsView(ctx.u); },
  async 'friends.add'(ctx, m) {
    const u = ctx.u, o = getUser(m.name);
    if (!o) throw new Error('Игрок не найден');
    if (o.name === u.name) throw new Error('Это вы 🙂');
    if (u.friends.includes(o.name)) throw new Error('Вы уже друзья');
    if (u.incoming.includes(o.name)) { return handlers['friends.accept'](ctx, { name: o.display }); }
    if (u.outgoing.includes(o.name)) throw new Error('Заявка уже отправлена');
    if (u.outgoing.length >= 50) throw new Error('Слишком много исходящих заявок');
    u.outgoing.push(o.name); o.incoming.push(u.name); markDirty();
    pushTo(o.name, { t: 'friends.update', note: `👋 ${u.display} хочет дружить` });
    return friendsView(u);
  },
  async 'friends.accept'(ctx, m) {
    const u = ctx.u, o = getUser(m.name);
    if (!o || !u.incoming.includes(o.name)) throw new Error('Заявки нет');
    dropFrom(u.incoming, o.name); dropFrom(o.outgoing, u.name);
    if (!u.friends.includes(o.name)) u.friends.push(o.name);
    if (!o.friends.includes(u.name)) o.friends.push(u.name);
    markDirty(); pushTo(o.name, { t: 'friends.update', note: `🤝 ${u.display} принял(а) заявку` });
    return friendsView(u);
  },
  async 'friends.decline'(ctx, m) {
    const u = ctx.u, o = getUser(m.name); if (!o) throw new Error('Игрок не найден');
    dropFrom(u.incoming, o.name); dropFrom(o.outgoing, u.name); dropFrom(u.outgoing, o.name); dropFrom(o.incoming, u.name);
    markDirty(); pushTo(o.name, { t: 'friends.update' }); return friendsView(u);
  },
  async 'friends.remove'(ctx, m) {
    const u = ctx.u, o = getUser(m.name); if (!o) throw new Error('Игрок не найден');
    dropFrom(u.friends, o.name); dropFrom(o.friends, u.name);
    markDirty(); pushTo(o.name, { t: 'friends.update' }); return friendsView(u);
  },

  /* ---------- КАРТОЧНЫЕ СТОЛЫ (Блэкджек, Дурак, Пьяница, Верю-не-верю, Покер) ---------- */
  async 'card.games'(ctx) {
    const rm = cardRoomOf(ctx.u.name);
    return {
      games: CARD_ORDER.map(k => ({ key: k, title: CARD_GAMES[k].mod.title, min: CARD_GAMES[k].mod.min, max: CARD_GAMES[k].mod.max })),
      timers: CARD_TIMERS.map(ms => ({ ms: ms, label: ms ? (ms / 1000) + ' сек' : 'без таймера' })),
      turnMs: CARD_TURN_MS,
      rooms: cardLobby(),
      room: rm ? cardView(rm, ctx.u.name) : null,
      game: rm && rm.g ? cardGameView(rm, ctx.u.name) : null
    };
  },
  async 'card.create'(ctx, m) {
    const u = ctx.u;
    if (cardRoomOf(u.name)) throw new Error('Вы уже за столом');
    if (roulRoomOf(u.name)) throw new Error('Сначала выйдите из рулеточного стола');
    if (userDuel.has(u.name)) throw new Error('Сначала закройте свой вызов на дуэль');
    if (limited('cardc:' + u.name, 12, 60000)) throw new Error('Слишком часто');
    if (!CARD_GAMES[m.game]) throw new Error('Выберите игру');
    const bet = parseAmount(m.bet);
    if (bet < CFG.minBet) throw new Error('Минимальная ставка: ' + CFG.minBet);
    if (avail(u) < bet) throw new Error('Недостаточно денег в облаке для такой ставки');
    const opts = cardOpts(m.game, m);
    const rm = cardMake(u, m.game, bet, m.max, opts, cardTurnMs(m));
    return { room: cardView(rm, u.name) };
  },
  async 'card.join'(ctx, m) {
    const u = ctx.u, rm = cardRooms.get(m.room);
    if (!rm) throw new Error('Стол уже закрыт');
    if (rm.state !== 'lobby') throw new Error('Игра уже началась');
    if (rm.players.indexOf(u.name) >= 0) throw new Error('Вы уже за этим столом');
    if (rm.players.length >= rm.max) throw new Error('Стол заполнен (' + rm.max + ' игрока)');
    if (cardRoomOf(u.name)) throw new Error('Вы уже за столом');
    if (roulRoomOf(u.name)) throw new Error('Сначала выйдите из рулеточного стола');
    if (userDuel.has(u.name)) throw new Error('Сначала закройте свой вызов на дуэль');
    if (avail(u) < rm.bet) throw new Error('Недостаточно денег в облаке для такой ставки');
    rm.players.push(u.name); userCard.set(u.name, rm.id);
    clearTimeout(rm.timer); cardArmLobby(rm); markDirty();
    for (const p of rm.players) pushTo(p, { t: 'toast', text: '🎴 ' + u.display + ' сел(а) за стол' });
    cardPush(rm); pushCardLobby();
    return { room: cardView(rm, u.name) };
  },
  async 'card.leave'(ctx) { cardLeave(ctx.u.name, false, true); return {}; },
  async 'card.start'(ctx) {
    const u = ctx.u, rm = cardRoomOf(u.name);
    if (!rm) throw new Error('Вы не за столом');
    if (rm.owner !== u.name) throw new Error('Начать игру может создатель стола');
    cardStart(rm);
    return { room: cardView(rm, u.name) };
  },
  async 'card.act'(ctx, m) {
    const u = ctx.u, rm = cardRoomOf(u.name);
    if (!rm) throw new Error('Вы не за столом');
    if (rm.state !== 'play') throw new Error('Раздача ещё не идёт');
    rm.mod.act(rm.g, rm.players.indexOf(u.name), m || {});
    cardAfter(rm);
    return {};
  },

  /* ---------- АДМИНКА ---------- */
  async 'admin.code'(ctx, m) {
    const u = ctx.u;
    if (limited('adm:' + u.name, 5, 600000) || limited('admip:' + ctx.ip, 10, 600000)) throw new Error('Слишком много попыток');
    if (!ADMIN_CODE_HASH) throw new Error('Код админки не настроен (server/secret.json → adminCode или переменная ADMIN_CODE)');
    if (!crypto.timingSafeEqual(sha256(String(m.code || '')), ADMIN_CODE_HASH)) return { ok: false, err: 'bad' };
    const owner = ownerUser();
    if (owner && owner !== u) return { ok: false, err: 'Владелец уже назначен. Админов добавляет только владелец' };
    if (!owner) { u.owner = true; u.admin = true; markDirty(); audit(u.display, 'owner.claim', 'стал владельцем по коду'); }
    return { admin: true, owner: true };
  },
  /* только владелец: назначить / снять администратора */
  async 'admin.add'(ctx, m) {
    needOwner(ctx); const o = getUser(m.name); if (!o) throw new Error('Игрок не найден');
    if (o.owner) throw new Error('Это владелец');
    if (o.admin) throw new Error('Уже администратор');
    o.admin = true; markDirty(); audit(ctx.u.display, 'admin.add', o.display);
    pushTo(o.name, { t: 'role', admin: true, owner: false }); pushTo(o.name, { t: 'toast', text: '🛡️ Владелец назначил вас администратором' });
    return {};
  },
  async 'admin.remove'(ctx, m) {
    needOwner(ctx); const o = getUser(m.name); if (!o) throw new Error('Игрок не найден');
    if (o.owner) throw new Error('Владельца снять нельзя');
    if (!o.admin) throw new Error('Не администратор');
    o.admin = false; markDirty(); audit(ctx.u.display, 'admin.remove', o.display);
    pushTo(o.name, { t: 'role', admin: false, owner: false }); pushTo(o.name, { t: 'toast', text: '🛡️ Права администратора сняты' });
    return {};
  },
  /* антиклик: клиент присылает последние 50 кликов, сервер сам перепроверяет */
  async 'ac.report'(ctx, m) {
    if (limited('ac:' + ctx.u.name, 40, 60000)) return { ban: false };
    const clicks = cleanClicks(m.clicks); if (!clicks) throw new Error('Некорректные данные кликов');
    const r = AntiClick.analyze(clicks);
    if (!r.ban) return { ban: false };
    return { ban: autoBan(ctx.u, clicks, AntiClick.describe(r)), reason: AntiClick.describe(r) };
  },
  async 'admin.users'(ctx, m) {
    need(ctx);
    const q = key(m.q || '');
    const list = Object.values(db.users).filter(x => !q || x.name.includes(q)).sort((a, b) => (isOnline(b.name) - isOnline(a.name)) || b.lastSeen - a.lastSeen).slice(0, 200)
      .map(x => ({ name: x.display, online: isOnline(x.name), admin: !!x.admin, owner: !!x.owner, avail: avail(x), banned: banInfo(x) ? banText(x.ban) : null, banAuto: !!(x.ban && x.ban.auto), muted: x.mutedUntil > now() ? x.mutedUntil : 0, lastSeen: x.lastSeen, createdAt: x.createdAt }));
    return { users: list, total: Object.keys(db.users).length, online: conns.size, tables: cardRooms.size, games: cardRooms.size };
  },
  async 'admin.give'(ctx, m) {
    need(ctx); const o = getUser(m.name); if (!o) throw new Error('Игрок не найден');
    if (m.take) guard(ctx, o);
    const amount = parseAmount(m.amount); if (!amount) throw new Error('Некорректная сумма');
    if (m.take) addPending(o, 'debit', amount, 'Списано администратором'); else addPending(o, 'credit', amount, 'Выдано администратором');
    audit(ctx.u.display, m.take ? 'admin.take' : 'admin.give', `${o.display}: ${amount}`);
    return {};
  },
  async 'admin.ban'(ctx, m) {
    need(ctx); const o = getUser(m.name); if (!o) throw new Error('Игрок не найден');
    guard(ctx, o);
    const mins = Math.max(0, Math.floor(Number(m.minutes) || 0));
    o.ban = { until: mins ? now() + mins * 60000 : 0, reason: cleanText(m.reason, 100) };
    for (const [t, v] of Object.entries(db.tokens)) if (v.user === o.name) delete db.tokens[t];
    markDirty(); kick(o.name, banText(o.ban)); cardKick(o.name);
    audit(ctx.u.display, 'admin.ban', `${o.display} ${mins ? mins + ' мин' : 'навсегда'} ${o.ban.reason}`);
    return {};
  },
  async 'admin.unban'(ctx, m) { need(ctx); const o = getUser(m.name); if (!o) throw new Error('Игрок не найден'); o.ban = null; markDirty(); audit(ctx.u.display, 'admin.unban', o.display); return {}; },
  async 'admin.mute'(ctx, m) {
    need(ctx); const o = getUser(m.name); if (!o) throw new Error('Игрок не найден'); guard(ctx, o);
    const mins = Math.max(1, Math.floor(Number(m.minutes) || 10)); o.mutedUntil = now() + mins * 60000; markDirty();
    pushTo(o.name, { t: 'toast', text: `🔇 Вас заглушили на ${mins} мин` }); audit(ctx.u.display, 'admin.mute', `${o.display} ${mins} мин`); return {};
  },
  async 'admin.unmute'(ctx, m) { need(ctx); const o = getUser(m.name); if (!o) throw new Error('Игрок не найден'); o.mutedUntil = 0; markDirty(); audit(ctx.u.display, 'admin.unmute', o.display); return {}; },
  async 'admin.kick'(ctx, m) { need(ctx); const o = getUser(m.name); if (!o) throw new Error('Игрок не найден'); guard(ctx, o); kick(o.name, 'Вас отключил администратор'); audit(ctx.u.display, 'admin.kick', o.display); return {}; },
  async 'admin.broadcast'(ctx, m) {
    need(ctx); const text = cleanText(m.text, 200); if (!text) throw new Error('Пустое объявление');
    pushAll({ t: 'announce', text, from: ctx.u.display }); audit(ctx.u.display, 'admin.broadcast', text); return {};
  },
  /* выпуск обновления: блокирует всех, собирает EXE/APK, выкладывает в GitHub Releases */
  async 'admin.release'(ctx, m) {
    needOwner(ctx);
    if (RELEASE.running) throw new Error('Сборка уже идёт: ' + (RELEASE.text || '…'));
    /* сборщик принимает только три числа: '1.1' превращаем в '1.1.0' */
    const version = ReleasePlan.normalizeVersion(m.version);
    if (String(m.version || '').trim() && !version) throw new Error('Версия должна быть вида 1.0.1');
    const notes = cleanText(m.notes, 300);
    const mode = String(m.mode || 'auto').toLowerCase();
    RELEASE.running = true; RELEASE.version = version; RELEASE.startedAt = now();
    releaseMsg('Готовится обновление — игра разблокируется, когда сборка закончится');
    let used = '';
    try { used = startRelease(version, ctx.u.display, notes, mode); }
    catch (e) { RELEASE.running = false; RELEASE.mode = ''; releaseMsg(''); pushAll({ t: 'sys.lock', on: false, text: '' }); throw new Error(e.message); }
    pushAll({ t: 'announce', text: '🚀 Выпускается обновление! Игра временно заблокирована.', from: ctx.u.display });
    audit(ctx.u.display, 'admin.release', (version || 'автоинкремент') + ' [' + used + (mode !== 'auto' ? '/' + mode : '') + ']' + (notes ? ' | ' + notes : ''));
    return { version: version || '', running: true, mode: used };
  },
  async 'admin.releasestatus'(ctx) {
    needOwner(ctx);
    const c = releaseCaps();
    return {
      running: RELEASE.running, version: RELEASE.version, text: RELEASE.text, startedAt: RELEASE.startedAt,
      by: RELEASE.by, mode: RELEASE.mode, url: RELEASE.url,
      local: c.local, cloud: c.cloud, auto: c.mode, missing: c.missing, repo: c.repo
    };
  },
  async 'admin.delmsg'(ctx, m) {
    need(ctx); const i = db.chat.findIndex(x => x.id === m.msgId); if (i < 0) throw new Error('Сообщение не найдено');
    db.chat.splice(i, 1); markDirty(); pushAll({ t: 'chat.del', msgId: m.msgId }); audit(ctx.u.display, 'admin.delmsg', m.msgId); return {};
  },
  async 'admin.setpass'(ctx, m) {
    need(ctx); const o = getUser(m.name); if (!o) throw new Error('Игрок не найден'); guard(ctx, o);
    const pw = String(m.password || ''); if (pw.length < 6 || pw.length > 64) throw new Error('Пароль: 6–64 символа');
    o.salt = crypto.randomBytes(16).toString('hex'); o.hash = hashPw(pw, o.salt);
    for (const [t, v] of Object.entries(db.tokens)) if (v.user === o.name) delete db.tokens[t];
    markDirty(); kick(o.name, 'Пароль изменён администратором'); audit(ctx.u.display, 'admin.setpass', o.display); return {};
  },
  async 'admin.audit'(ctx) { need(ctx); return { log: db.audit.slice(-100).reverse() }; },
  /* ---------- ЦЕНЫ: клиент спрашивает, владелец правит ---------- */
  async 'price.get'(ctx, m) {
    const k = String(m.key || '');
    if (!priceKeyOk(k)) throw new Error('Некорректный ключ цены');
    const v = priceOr(k, Number(m.def));
    if (v == null) throw new Error('Для этой цены не задано значение');
    return { key: k, value: v };
  },
  async 'price.list'(ctx) { return { prices: prices }; },
  async 'admin.prices'(ctx) { need(ctx); return { prices: prices }; },
  async 'admin.price.set'(ctx, m) {
    need(ctx);
    const k = String(m.key || '');
    if (!priceKeyOk(k)) throw new Error('Некорректный ключ цены');
    const v = Number(m.value);
    if (!isFinite(v) || v < 0 || v > 1e30) throw new Error('Некорректная цена');
    const old = prices[k];
    prices[k] = v; savePrices();
    audit(ctx.u.display, 'price.set', k + ': ' + old + ' → ' + v);
    pushAll({ t: 'prices', prices: prices });
    return { prices: prices };
  },
  /* ParrotAI: включение/выключение, настройки, перезагрузка модели */
  async 'admin.parrot'(ctx, m) {
    need(ctx);
    db.meta = db.meta || {};
    if (typeof m.on === 'boolean') { db.meta.parrotOn = m.on; markDirty(); audit(ctx.u.display, 'parrot.toggle', m.on ? 'включён' : 'выключен'); }
    if (m.cfg && typeof m.cfg === 'object') { db.meta.parrotCfg = Object.assign({}, db.meta.parrotCfg || {}, cleanParrotCfg(m.cfg)); markDirty(); audit(ctx.u.display, 'parrot.cfg', JSON.stringify(db.meta.parrotCfg)); }
    if (m.reload) { const st = Parrot.load(); audit(ctx.u.display, 'parrot.reload', st.loaded ? 'модель загружена' : (st.error || 'ошибка')); return { on: !!db.meta.parrotOn, status: st, cfg: parrotCfg() }; }
    return { on: !!db.meta.parrotOn, status: Parrot.status(), cfg: parrotCfg() };
  },
};
function need(ctx) { if (!ctx.u.admin) throw new Error('Нет прав'); }
function needOwner(ctx) { if (!ctx.u.owner) throw new Error('Только владелец'); }
/* владельца не трогает никто; администратора — только владелец */
function guard(ctx, o) {
  if (o.owner && o !== ctx.u) throw new Error('Нельзя применять к владельцу');
  if (o.admin && !o.owner && !ctx.u.owner) throw new Error('Администратора может затронуть только владелец');
  if (o === ctx.u) throw new Error('Нельзя применять к себе');
}
function kick(name, reason) { const s = conns.get(key(name)); if (s) for (const w of [...s]) { send(w, { t: 'kicked', reason }); w.close(4001, 'kicked'); } }

/* ============================================================
   ВЫПУСК ОБНОВЛЕНИЯ
   Пока идёт сборка, все игроки видят блокировку.
   Способы сборки:
     local — на этом компьютере (tools/release.js собирает EXE и APK);
     cloud — в облаке GitHub (.github/workflows/release.yml).
   По умолчанию local, если на машине есть набор для сборки, иначе cloud.
   ============================================================ */
const RELEASE = { running: false, version: '', text: '', by: '', startedAt: 0, child: null, mode: '', url: '', marker: '', runId: 0 };

function releaseMsg(text) {
  RELEASE.text = text || '';
  pushAll({ t: 'sys.lock', on: true, text: RELEASE.text });
}
function releaseDone(ok, info) {
  RELEASE.running = false; RELEASE.child = null; RELEASE.mode = ''; RELEASE.marker = '';
  pushAll({ t: 'sys.lock', on: false, text: '' });
  if (ok) {
    RELEASE.version = info;
    pushAll({ t: 'announce', text: '✅ Обновление v' + info + ' выпущено! Обновите игру, чтобы получить новую версию.', from: 'Система' });
    pushAll({ t: 'sys.update', version: info });
  } else {
    pushAll({ t: 'announce', text: '⚠️ Обновление не выпущено: ' + info, from: 'Система' });
  }
}

/* ---------- что есть на машине сервера ---------- */
function npmCliPath() {
  const local = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(local)) return local;
  const win = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
  if (fs.existsSync(win)) return win;
  return local;
}
function localToolchain() {
  const ex = p => !!(p && fs.existsSync(p));
  return {
    node: true,
    npm: ex(npmCliPath()),
    electron: ex(path.join(ROOT, '_build', 'electron', 'node_modules')),
    mobile: ex(path.join(ROOT, '_build', 'mobile', 'node_modules')),
    jdk: ex(process.env.VC_JDK) || ex(path.join(ROOT, '_build', 'jdk')) || ex(process.env.JAVA_HOME),
    sdk: ex(process.env.VC_SDK) || ex(path.join(ROOT, '_build', 'sdk')) || ex(process.env.ANDROID_SDK_ROOT) || ex(process.env.ANDROID_HOME),
    keystore: ex(process.env.VC_KEYSTORE) || ex(path.join(ROOT, '_build', 'mobile', 'vitalyaclicker.keystore')) || ex(path.join(ROOT, 'vitalyaclicker.keystore'))
  };
}
function releaseCaps() { return ReleasePlan.caps(localToolchain(), { token: GH_TOKEN, repo: GH_REPO }); }

/* ---------- GitHub API (для облачной сборки) ---------- */
function ghApi(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const headers = {
      'User-Agent': 'VitalyaClicker', 'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + GH_TOKEN
    };
    if (payload) headers['Content-Length'] = payload.length;
    const req = https.request({ method, host: 'api.github.com', path: apiPath, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null; try { parsed = JSON.parse(text); } catch (e) {}
        resolve({ status: res.statusCode, json: parsed, text: text });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function ghErr(r, what) {
  if (r && r.status === 404) return what + ': в GitHub ничего не найдено (код и .github/workflows должны быть в ветке main)';
  if (r && (r.status === 401 || r.status === 403)) return what + ': GitHub отказал в доступе (нужен токен с правами repo и workflow)';
  const m = (r && r.json && (r.json.message || r.json.error)) || '';
  return what + ': GitHub ' + ((r && r.status) || '?') + (m ? ' — ' + String(m).slice(0, 200) : '');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- сборка в облаке GitHub Actions ---------- */
async function startCloudRelease(version, by, notes) {
  const marker = 'vc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  RELEASE.marker = marker; RELEASE.mode = 'cloud'; RELEASE.by = by || '';
  releaseMsg('Отправляю сборку в облако GitHub…');
  const wf = encodeURIComponent(GH_WORKFLOW);
  const d = await ghApi('POST', '/repos/' + GH_REPO + '/actions/workflows/' + wf + '/dispatches', {
    ref: 'main',
    inputs: { version: version || '', notes: notes || '', marker: marker, dry_run: false }
  });
  if (d.status !== 204) throw new Error(ghErr(d, 'Сборка в облаке не запустилась'));
  if (by) pushTo(by, { t: 'toast', text: '🚀 Облачная сборка запускается: https://github.com/' + GH_REPO + '/actions' });

  /* ищем свой запуск по метке (workflow подставляет её в название) */
  const runsUrl = '/repos/' + GH_REPO + '/actions/workflows/' + wf + '/runs?event=workflow_dispatch&per_page=30';
  let run = null;
  for (let i = 0; i < 15 && !run; i++) {
    await sleep(4000);
    const r = await ghApi('GET', runsUrl);
    if (r.status !== 200 || !r.json || !Array.isArray(r.json.workflow_runs)) continue;
    run = r.json.workflow_runs.filter(w => String(w.display_title || '').indexOf(marker) >= 0)[0] || null;
  }
  if (!run) { releaseDone(false, 'запуск не появился в GitHub Actions (проверьте https://github.com/' + GH_REPO + '/actions)'); return; }
  RELEASE.runId = run.id;
  RELEASE.url = run.html_url || ('https://github.com/' + GH_REPO + '/actions');
  releaseMsg('Сборка идёт в облаке GitHub: ' + RELEASE.url);

  const started = Date.now();
  let lastStep = '';
  while (Date.now() - started < 90 * 60000) {
    await sleep(10000);
    if (!RELEASE.running) return;
    const r = await ghApi('GET', '/repos/' + GH_REPO + '/actions/runs/' + run.id);
    if (r.status !== 200) continue;
    const st = r.json;
    if (st.status === 'completed') {
      if (st.conclusion === 'success') {
        let ver = version;
        const v = await ghApi('GET', '/repos/' + GH_REPO + '/contents/version.json?ref=main');
        try { ver = JSON.parse(Buffer.from(v.json.content, 'base64').toString('utf8')).version || version; } catch (e) {}
        if (by) pushTo(by, { t: 'toast', text: '✅ Облачная сборка закончилась: ' + RELEASE.url });
        releaseDone(true, ver);
      } else {
        releaseDone(false, 'сборка в облаке завершилась (' + st.conclusion + ') — смотрите ' + RELEASE.url);
      }
      return;
    }
    /* какой шаг идёт сейчас — показываем игрокам */
    const j = await ghApi('GET', '/repos/' + GH_REPO + '/actions/runs/' + run.id + '/jobs');
    let step = '';
    if (j.status === 200 && j.json && Array.isArray(j.json.jobs) && j.json.jobs[0]) {
      const job = j.json.jobs[0];
      const active = (job.steps || []).filter(s => s.status === 'in_progress' || s.status === 'queued')[0];
      step = (active && active.name) || (job.status === 'queued' ? 'ожидает свободного сборщика' : '');
    }
    const mins = Math.round((Date.now() - started) / 60000);
    if (step && step !== lastStep) { lastStep = step; releaseMsg('Сборка в облаке GitHub: ' + step + ' (' + mins + ' мин)'); }
    else releaseMsg('Сборка идёт в облаке GitHub (' + mins + ' мин)');
  }
  releaseDone(false, 'облачная сборка идёт слишком долго — проверьте ' + RELEASE.url);
}

/* ---------- запуск выпуска: local или cloud ---------- */
function startRelease(version, by, notes, mode) {
  const parts = localToolchain();
  const m = ReleasePlan.pickMode(mode, parts, { token: GH_TOKEN, repo: GH_REPO });
  RELEASE.mode = m; RELEASE.url = ''; RELEASE.marker = ''; RELEASE.runId = 0; RELEASE.by = by || '';

  if (m === 'cloud') {
    startCloudRelease(version, by, notes).catch(e => { if (RELEASE.running) releaseDone(false, e && e.message ? e.message : String(e)); });
    return m;
  }

  const script = path.join(ROOT, 'tools', 'release.js');
  if (!fs.existsSync(script)) throw new Error('Не найден tools/release.js');
  const args = [script];
  if (version) args.push('--version', version);
  if (notes) args.push('--notes', notes);
  if (GH_REPO) args.push('--repo', GH_REPO);
  const child = spawn(process.execPath, args, { cwd: ROOT, env: Object.assign({}, process.env, { PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH || '') }), windowsHide: true });
  RELEASE.child = child;
  const onData = raw => {
    for (const line of String(raw).split(/\r?\n/)) {
      const s = line.trim();
      if (!s) continue;
      if (s.startsWith('PROGRESS:')) releaseMsg(s.slice(9).trim());
      else if (s.startsWith('DONE:')) releaseDone(true, s.slice(5).trim());
      else if (s.startsWith('FAIL:')) releaseDone(false, s.slice(5).trim());
      else console.log('[release] ' + s);
    }
  };
  if (child.stdout) child.stdout.on('data', onData);
  if (child.stderr) child.stderr.on('data', onData);
  child.on('error', e => { if (RELEASE.running) releaseDone(false, 'сборка не запустилась: ' + e.message); });
  child.on('exit', code => { if (RELEASE.running) releaseDone(false, 'сборка прервалась (код ' + code + ')'); });
  return m;
}

wss.on('connection', (ws, req) => {
  const ip = ipOf(req);
  let ctx = null, count = 0;
  const rl = setInterval(() => { count = 0; }, 1000);
  const authTimer = setTimeout(() => { if (!ctx) ws.close(4002, 'auth timeout'); }, 10000);
  ws.on('message', async raw => {
    if (++count > 60) return ws.close(4003, 'flood');
    let m; try { m = JSON.parse(raw.toString('utf8')); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    const reply = (o) => { if (m.id != null) send(ws, Object.assign({ re: m.id }, o)); };
    try {
      if (m.t === 'auth') {
        const tr = tokenRec(m.token);
        const u = tr && db.users[tr.rec.user];
        if (!u) { reply({ ok: false, err: 'auth' }); return ws.close(4000, 'bad token'); }
        /* обязательные обновления: старая сборка играть не может.
           Сборка без версии (браузер/разработка) пропускается. */
        const cv = String(m.version || '').trim().replace(/^v/i, '');
        const pv = currentVersion();
        if (cv && pv && ReleasePlan.cmpVersion(cv, pv) < 0) {
          reply({ ok: false, err: 'update', needUpdate: { version: pv, url: GH_REPO ? 'https://github.com/' + GH_REPO + '/releases/latest' : '', assets: verInfo().assets } });
          return ws.close(4004, 'update required');
        }
        const b = banInfo(u); if (b) { reply({ ok: false, err: banText(b) }); return ws.close(4001, 'banned'); }
        ctx = { u, ip }; clearTimeout(authTimer);
        /* активная сессия продлевается, пока игрок заходит */
        tr.rec.at = now(); tr.rec.exp = now() + SESSION_MS;
        const set = conns.get(u.name) || new Set(); const first = set.size === 0; set.add(ws); conns.set(u.name, set);
        u.lastSeen = now();
        if (!u.lastDaily || now() - u.lastDaily > 20 * 3600000) { u.lastDaily = now(); addXp(u, CFG.xpDaily); setTimeout(() => pushTo(u.name, { t: 'toast', text: '🗓️ Ежедневный вход: +' + CFG.xpDaily + ' опыта' }), 400); }
        markDirty();
        if (first) friendsPresence(u);
        reply({ ok: true, me: meInfo(u), pending: u.pending.length, sessionUntil: tr.rec.exp });
        if (RELEASE.running) send(ws, { t: 'sys.lock', on: true, text: RELEASE.text });
        const crm = cardRoomOf(u.name);
        if (crm) { if (crm.state === 'lobby') send(ws, { t: 'card.room', room: cardView(crm, u.name) }); else send(ws, { t: 'card.state', game: cardGameView(crm, u.name) }); }
        const rm = roulRoomOf(u.name); if (rm) send(ws, { t: 'roul.room', room: roulView(rm, u.name) });
        return;
      }
      if (!ctx) return reply({ ok: false, err: 'auth' });
      const h = handlers[m.t];
      if (!h) return reply({ ok: false, err: 'Неизвестная команда' });
      const b = banInfo(ctx.u); if (b) { send(ws, { t: 'kicked', reason: banText(b) }); return ws.close(4001, 'banned'); }
      const r = await h(ctx, m);
      reply(Object.assign({ ok: true }, r || {}));
    } catch (e) {
      reply({ ok: false, err: e && e.message ? String(e.message).slice(0, 200) : 'Ошибка' });
    }
  });
  ws.on('close', () => {
    clearInterval(rl); clearTimeout(authTimer);
    if (!ctx) return;
    const set = conns.get(ctx.u.name);
    if (set) { set.delete(ws); if (!set.size) { conns.delete(ctx.u.name); ctx.u.lastSeen = now(); markDirty(); cardOnDisconnect(ctx.u.name); duelDrop(ctx.u.name); roulOnDisconnect(ctx.u.name); friendsPresence(ctx.u); } }
  });
  ws.on('error', () => {});
});

/* heartbeat: убираем «мёртвые» соединения */
setInterval(() => { for (const w of wss.clients) { if (w.isAlive === false) { w.terminate(); continue; } w.isAlive = false; try { w.ping(); } catch (e) {} } }, 30000).unref();
wss.on('connection', w => { w.isAlive = true; w.on('pong', () => { w.isAlive = true; }); });

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`VitalyaClicker online server: http://localhost:${PORT}  (игра раздаётся из ${ROOT})`);
    if (!ADMIN_CODE_HASH) console.log('ВНИМАНИЕ: код админки не задан — вход в админку по коду недоступен (server/secret.json → adminCode)');
    const lc = localToolchain();
    console.log('выпуск обновлений: набор для сборки на этом компьютере — ' + (ReleasePlan.canLocal(lc) ? 'есть (локальная сборка)' : 'нет: ' + ReleasePlan.missingLocal(lc).join(', ')));
    console.log('выпуск обновлений: GitHub — ' + (ReleasePlan.canCloud({ token: GH_TOKEN, repo: GH_REPO }) ? GH_REPO + ' (сборка в облаке)' : 'не настроен'));
    console.log('ParrotAI: ' + (PARROT_LOAD.loaded ? `модель ${PARROT_LOAD.file} (токенов ${PARROT_LOAD.tokens}, словарь ${PARROT_LOAD.vocab})` : (PARROT_LOAD.error || 'модель не найдена')));
  });
  const bye = () => { try { flush(); } catch (e) {} process.exit(0); };
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
}
module.exports = { server, flush, db, CFG };
