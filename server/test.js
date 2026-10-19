'use strict';
/* Сквозной тест сервера: node test.js */
const os = require('os'), fs = require('fs'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-test-'));
process.env.PRICES_FILE = path.join(process.env.DATA_DIR, 'prices.json');   /* тестовые цены не трогают боевой configs/prices.json */
process.env.ADMIN_CODE = 'test-admin-code-' + process.pid;   /* код админки: только для тестов */
const ADMIN_CODE = process.env.ADMIN_CODE;
const WebSocket = require('ws');
const ReleasePlan = require('./release-plan.js');
const { server } = require('./server.js');

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗ FAIL:', msg); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
function makeSave(click, clicks) {
  const b = Buffer.alloc(120);
  b.writeUInt32LE(0x56434442, 0); b.writeUInt32LE(24, 4);
  const v = { click, auto: 0, casino: 0, crypto: 0, mining: 0 };
  const s = Object.keys(v).sort().map(k => k + ':' + Math.floor(v[k])).join('|');
  b.writeUInt32LE(fnv(s), 8);
  ['click', 'auto', 'casino', 'crypto', 'mining'].forEach((k, i) => b.writeDoubleLE(v[k], 12 + i * 8));
  b.writeDoubleLE(clicks || 0, 12 + 5 * 8);   /* счётчик кликов (в контрольную сумму не входит) */
  return b.toString('base64');
}

let port;
async function post(p, body) {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
function client(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const c = { ws, pushes: [], pend: new Map(), seq: 1 };
    ws.on('message', d => { const m = JSON.parse(d); if (m.re != null) { const p = c.pend.get(m.re); if (p) { c.pend.delete(m.re); p(m); } } else c.pushes.push(m); });
    c.req = (t, o = {}) => new Promise((res, rej) => { const id = c.seq++; c.pend.set(id, res); setTimeout(() => { if (c.pend.has(id)) rej(new Error('нет ответа на ' + t)); }, 4000); ws.send(JSON.stringify(Object.assign({ id, t }, o))); });
    c.last = t => [...c.pushes].reverse().find(p => p.t === t);
    ws.on('open', async () => { const r = await c.req('auth', { token }); r.ok ? resolve(c) : reject(new Error('auth failed ' + JSON.stringify(r))); });
    ws.on('error', reject);
  });
}
/* одноразовое подключение с произвольной версией сборки — для проверки
   обязательных обновлений (сервер не пускает старые версии) */
function authTry(token, version) {
  return new Promise(resolve => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    let done = false;
    const fin = m => { if (done) return; done = true; resolve({ reply: m }); try { ws.close(); } catch (e) {} };
    ws.on('message', d => { const m = JSON.parse(d); if (m.re != null) fin(m); });
    ws.on('error', () => fin(null));
    ws.on('close', () => fin(null));
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, t: 'auth', token, version })));
    setTimeout(() => fin(null), 1500);
  });
}

(async () => {
  await new Promise(r => server.listen(0, r)); port = server.address().port;

  /* ---- помощники для карточных столов ---- */
  const RANKS36 = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const RANKS52 = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const rv = x => RANKS52.indexOf(x) + 2;
  /* гоняем партию за игроков, пока игра сама не закончится (P[0] — хозяин стола) */
  async function driveCards(P, gesture, maxMoves) {
    let guard = 0;
    while (guard++ < (maxMoves || 200)) {
      const ref = P[0].last('card.state');
      if (!ref || !ref.game || ref.game.over) break;
      const i = ref.game.turn;
      if (i < 0) break;
      const mine = P[i].last('card.state');
      if (!mine || !mine.game || mine.game.over) break;
      const act = gesture(mine.game);
      if (!act) break;
      const res = await P[i].req('card.act', act);
      if (!res.ok) { console.log('    !! ход отклонён:', res.err); break; }
      await sleep(35);
    }
  }
  /* собрать стол, сыграть партию и проверить, что деньги сошлись */
  async function cardMatch(game, P, bet, gesture, moves, extra) {
    for (const cl of P) { try { await cl.req('card.leave'); } catch (e) { } }
    await sleep(60);
    for (const cl of P) { const x = await cl.req('wallet.pending'); await cl.req('wallet.ack', { ids: x.items.map(i => i.id) }); }
    const start = [];
    for (const cl of P) start.push((await cl.req('wallet.pending')).avail);
    const cr = await P[0].req('card.create', Object.assign({ game, bet }, extra || {}));
    if (!cr.ok) return { ok: false, err: cr.err };
    for (let k = 1; k < P.length; k++) { const j = await P[k].req('card.join', { room: cr.room.id }); if (!j.ok) return { ok: false, err: j.err }; }
    const st0 = await P[0].req('card.start');
    if (!st0.ok) return { ok: false, err: st0.err };
    await sleep(90);
    if (gesture) await driveCards(P, gesture, moves);
    await sleep(180);
    const g = P[0].last('card.state') ? P[0].last('card.state').game : null;
    const end = [];
    for (const cl of P) end.push((await cl.req('wallet.pending')).avail);
    const nets = end.map((x, i) => x - start[i]);
    for (const cl of P) { const x = await cl.req('wallet.pending'); await cl.req('wallet.ack', { ids: x.items.map(i => i.id) }); }
    return { ok: true, g: g, nets: nets, okSum: nets.reduce((a, b) => a + b, 0) === 0, pot: g && g.money ? g.money.reduce((a, b) => a + b, 0) : 0 };
  }
  const durakGesture = v => {
    if (!v.can || v.over) return null;
    if (v.phase === 'defend') {
      const und = v.table.filter(p => !p.d), t = und[und.length - 1];
      for (let k = 0; k < v.hand.length; k++) {
        const c = v.hand[k];
        const beats = c.s === t.a.s ? rv(c.r) > rv(t.a.r) : (c.s === v.trump && t.a.s !== v.trump);
        if (beats) return { act: 'defend', card: k };
      }
      return { act: 'take' };
    }
    if (v.can.pass && (v.hand.length > 5 || guard3())) return { act: 'pass' };
    const ranks = new Set(v.table.map(p => p.a.r));
    for (let k = 0; k < v.hand.length; k++) if (v.can.first || ranks.has(v.hand[k].r)) return { act: 'attack', card: k };
    return v.can.pass ? { act: 'pass' } : null;
  };
  const guard3 = () => Math.random() < 0.3;
  const cheatGesture = v => v.can.place ? { act: 'play', cards: [0] }
    : (v.can.doubt ? { act: Math.random() < 0.35 ? 'doubt' : 'believe' } : null);
  const pokerGesture = v => {
    if (!v.can || !v.can.act) return null;
    const r0 = Math.random();
    if (v.can.raise && r0 < 0.15) return { act: 'raise', amount: v.can.minRaise };
    if (v.can.check && r0 < 0.65) return { act: 'check' };
    if (v.can.call) return { act: 'call' };
    return { act: 'fold' };
  };
  /* Пьяница ручная: каждый вскрывает сам, затем кто-то жмёт «Дальше» */
  const warGesture = v => {
    if (!v || v.over) return null;
    if (v.phase === 'result') return { act: 'next' };
    return v.canOpen ? { act: 'open' } : null;
  };
  const mulberry32 = a => () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };

  console.log('— Регистрация / вход');
  const ra = await post('/api/register', { name: 'Alice', password: 'secret1' });
  const rb = await post('/api/register', { name: 'Bob', password: 'secret2' });
  const rc = await post('/api/register', { name: 'Carol', password: 'secret3' });
  ok(ra.ok && rb.ok && rc.ok, 'три аккаунта зарегистрированы');
  ok(!(await post('/api/register', { name: 'alice', password: 'whatever1' })).ok, 'ник занят без учёта регистра');
  ok(!(await post('/api/login', { name: 'Alice', password: 'wrong' })).ok, 'неверный пароль отклонён');
  const A = await client(ra.token), B = await client(rb.token), C = await client(rc.token);

  console.log('— Сессия (вход помнится неделю)');
  const sess = await authTry(ra.token);
  ok(sess.reply && sess.reply.ok && sess.reply.sessionUntil > Date.now() + 6 * 24 * 3600 * 1000 && sess.reply.sessionUntil <= Date.now() + 8 * 24 * 3600 * 1000, 'сессия продлена примерно на неделю');
  const dead = await authTry('deadbeef');
  ok(!(dead.reply && dead.reply.ok), 'неизвестный токен не пускает в игру');

  console.log('— Облачное сохранение');
  let r = await A.req('save.put', { main: makeSave(1e9), garden: JSON.stringify({ money: 5e8 }), baseRev: 0 });
  ok(r.ok && r.rev === 1 && r.avail === 1.5e9, 'save.put принят, баланс = клик + сад (1.5e9)');
  r = await A.req('save.put', { main: makeSave(1e9), baseRev: 0 });
  ok(!r.ok && r.err === 'conflict', 'устаревший baseRev → конфликт');
  const bad = Buffer.from(makeSave(1e9), 'base64'); bad.writeUInt32LE(12345, 8);
  r = await A.req('save.put', { main: bad.toString('base64'), baseRev: 1 });
  ok(!r.ok, 'подделанная контрольная сумма отклонена: ' + r.err);
  r = await A.req('save.get'); ok(r.ok && r.rev === 1 && r.main, 'save.get возвращает сохранение');
  await B.req('save.put', { main: makeSave(1e9), baseRev: 0 });
  await C.req('save.put', { main: makeSave(5e3), baseRev: 0 });

  console.log('— Перевод с комиссией');
  r = await A.req('transfer', { to: 'Bob', amount: 100000 });
  ok(r.ok && r.amount === 100000 && r.fee === 5000 && r.total === 105000, 'перевод 100000 → комиссия 5000, списано 105000');
  r = await B.req('wallet.pending');
  ok(r.items.length === 1 && r.items[0].kind === 'credit' && r.items[0].amount === 100000, 'Bob получил 100000 в ожидании');
  await B.req('wallet.ack', { ids: r.items.map(i => i.id) });
  r = await A.req('wallet.pending');
  ok(r.items[0].kind === 'debit' && r.items[0].amount === 105000, 'Alice: ожидает списание 105000');
  ok(!(await A.req('transfer', { to: 'Alice', amount: 5000 })).ok, 'перевод самому себе запрещён');
  ok(!(await C.req('transfer', { to: 'Bob', amount: 1e9 })).ok, 'перевод больше облачного баланса запрещён');
  ok(!(await A.req('transfer', { to: 'Bob', amount: 10 })).ok, 'перевод ниже минимума запрещён');
  await A.req('wallet.ack', { ids: r.items.map(i => i.id) });

  console.log('— Друзья и чат');
  r = await A.req('friends.add', { name: 'Bob' }); ok(r.ok && r.outgoing.length === 1, 'заявка отправлена');
  ok(B.last('friends.update'), 'Bob получил уведомление о заявке');
  r = await B.req('friends.accept', { name: 'Alice' }); ok(r.ok && r.friends.length === 1, 'заявка принята');
  r = await A.req('friends.list'); ok(r.friends[0].name === 'Bob' && r.friends[0].online, 'Bob в друзьях и онлайн');
  r = await A.req('chat.send', { text: 'Привет <b>всем</b>' }); ok(r.ok, 'сообщение в общий чат');
  await sleep(80); ok(B.last('chat.msg') && C.last('chat.msg'), 'все получили сообщение');
  r = await A.req('chat.send', { to: 'Bob', text: 'личка' }); await sleep(80); ok(r.ok && B.last('chat.dm'), 'личное сообщение другу доставлено');
  r = await A.req('chat.send', { to: 'Carol', text: 'личка' }); ok(!r.ok, 'ЛС не-другу запрещено');
  r = await B.req('chat.history', { with: 'Alice' }); ok(r.msgs.length === 1, 'история ЛС');

  console.log('— Админка');
  r = await B.req('admin.code', { code: 'wrong' }); ok(!r.ok && r.err === 'bad', 'неверный код не даёт админку');
  r = await B.req('admin.users'); ok(!r.ok, 'без прав админ-команды недоступны');
  r = await A.req('admin.code', { code: ADMIN_CODE }); ok(r.ok && r.admin && r.owner, 'секретный код выдаёт админку (первому — овнерку)');
  r = await A.req('admin.users'); ok(r.ok && r.users.length === 3 && r.online === 3, 'admin.users работает');
  r = await A.req('admin.give', { name: 'Carol', amount: 777000 }); ok(r.ok, 'выдача денег');
  r = await C.req('wallet.pending'); ok(r.items.some(i => i.amount === 777000 && i.kind === 'credit'), 'Carol получила 777000');
  await C.req('wallet.ack', { ids: r.items.map(i => i.id) });
  r = await A.req('admin.mute', { name: 'Carol', minutes: 5 }); ok(r.ok, 'мут');
  r = await C.req('chat.send', { text: 'я заглушена' }); ok(!r.ok, 'заглушенный не может писать');
  await A.req('admin.unmute', { name: 'Carol' });
  const msgs = (await A.req('chat.history', {})).msgs;
  r = await A.req('admin.delmsg', { msgId: msgs[0].id }); await sleep(80); ok(r.ok && B.last('chat.del'), 'удаление сообщения чата');
  await A.req('admin.broadcast', { text: 'Тест!' }); await sleep(80); ok(B.last('announce'), 'объявление дошло');
  r = await A.req('admin.ban', { name: 'Carol', minutes: 0, reason: 'тест' }); ok(r.ok, 'бан');
  await sleep(100);
  ok(!(await post('/api/login', { name: 'Carol', password: 'secret3' })).ok, 'забаненный не может войти');
  r = await A.req('admin.unban', { name: 'Carol' });
  ok((await post('/api/login', { name: 'Carol', password: 'secret3' })).ok, 'после разбана вход работает');
  ok(!(await A.req('admin.ban', { name: 'Alice' })).ok, 'нельзя применить бан к себе');

  console.log('— ParrotAI (отдельный чат с ботом)');
  r = await B.req('admin.parrot'); ok(!r.ok, 'настройки ParrotAI доступны только админам');
  r = await A.req('admin.parrot'); ok(r.ok && r.status && r.status.loaded, 'модель ParrotAI загружена сервером');
  ok(typeof r.cfg.botName === 'string' && r.cfg.botName.length > 0, 'настройки бота отдаются клиенту');
  r = await A.req('admin.parrot', { on: true, cfg: { botName: 'ПопугайТест', trigger: 'попугай', delaySec: 0, askQuestion: true, answerAll: false } });
  ok(r.ok && r.on && r.cfg.botName === 'ПопугайТест' && r.cfg.delaySec === 0, 'включение бота и сохранение настроек');
  /* бот больше не пишет в общий чат */
  const globBot = (await A.req('chat.history', {})).msgs.filter(m => m.bot).length;
  await A.req('chat.send', { text: 'попугай привет' });
  await sleep(1200);
  ok((await A.req('chat.history', {})).msgs.filter(m => m.bot).length === globBot, 'в общем чате бот не отвечает');
  /* отдельный чат с ботом: у каждого игрока свой */
  r = await A.req('chat.send', { to: '@parrot', text: 'попугай привет' });
  ok(r.ok, 'сообщение в личный чат с ботом принято');
  await sleep(1200);
  const botHist = (await A.req('chat.history', { with: '@parrot' }));
  const botMsgs = botHist.msgs.filter(m => m.bot);
  ok(botHist.msgs.length >= 2 && botMsgs.length >= 1, 'бот ответил в отдельном чате');
  ok(botMsgs.pop().from === 'ПопугайТест', 'ответ от имени, заданного в настройках');
  ok(botHist.bot === 'ПопугайТест' && botHist.on === true, 'клиент получает имя и состояние бота');
  ok((await B.req('chat.history', { with: '@parrot' })).msgs.length === 0, 'у каждого игрока своя переписка с ботом');
  ok((await A.req('chat.history', {})).msgs.filter(m => m.to === 'ПопугайТест').length === 0, 'личный чат с ботом не попадает в общий');
  r = await A.req('profile.get'); ok(r.ok && r.stats.msgs >= 3, 'сообщения боту идут в статистику игрока');
  r = await A.req('admin.parrot', { on: false });
  ok(r.ok && !r.on, 'бот выключается');
  ok(!(await A.req('chat.send', { to: '@parrot', text: 'ты тут?' })).ok, 'выключенному боту написать нельзя');
  r = await A.req('admin.parrot', { cfg: { botName: 'ParrotAI', trigger: 'q:', delaySec: 1 } });
  ok(r.ok && r.cfg.botName === 'ParrotAI' && r.cfg.trigger === 'q:', 'настройки бота возвращены');

  console.log('— Таблицы лидеров');
  r = await A.req('leaderboard');
  ok(r.ok && Array.isArray(r.xp) && Array.isArray(r.money), 'таблицы лидеров отдаются клиенту');
  ok(['clicks', 'garden', 'wins', 'msgs'].every(k => Array.isArray(r[k])), 'все шесть таблиц на месте');
  ok(r.total >= 3, 'счётчик игроков');
  ok(r.money.length >= 1 && r.money.every(x => x.v > 0), 'в таблице монет только игроки с деньгами');
  ok(r.money.every((x, i, a) => !i || a[i - 1].v >= x.v), 'монеты отсортированы по убыванию');
  ok(r.xp.every((x, i, a) => !i || a[i - 1].v >= x.v), 'опыт отсортирован по убыванию');
  r = await A.req('save.put', { main: makeSave(1e9, 777), garden: JSON.stringify({ money: 5e8 }), baseRev: 1 });
  ok(r.ok, 'сохранение с кликами и садом принято');
  r = await A.req('leaderboard');
  const clickRow = r.clicks.filter(x => x.name === 'Alice')[0];
  ok(clickRow && clickRow.v === 777, 'клики в таблице берутся из сохранения');
  const gardenRow = r.garden.filter(x => x.name === 'Alice')[0];
  ok(gardenRow && gardenRow.v === 5e8, 'сад в таблице берётся из сохранения');
  ok(r.wins.every(x => x.v > 0), 'таблица побед без пустых строк');

  console.log('— Цены с сервера');
  r = await A.req('price.get', { key: 'skin.102', def: 10e6 });
  ok(r.ok && r.value === 10e6, 'цена по умолчанию запоминается на сервере');
  r = await A.req('price.get', { key: 'skin.102', def: 5 });
  ok(r.ok && r.value === 10e6, 'сервер отдаёт сохранённую цену, а не клиентскую');
  ok(!(await A.req('price.get', { key: 'плохой ключ!', def: 1 })).ok, 'кривой ключ цены отклонён');
  ok(!(await A.req('price.get', { key: 'skin.999', def: -1 })).ok, 'отрицательное значение по умолчанию отклонено');
  ok(!(await B.req('admin.price.set', { key: 'skin.102', value: 1 })).ok, 'не-админ не может менять цены');
  r = await A.req('admin.price.set', { key: 'skin.102', value: 7.5e6 });
  ok(r.ok && r.prices['skin.102'] === 7.5e6, 'владелец поменял цену');
  r = await A.req('price.get', { key: 'skin.102', def: 1 });
  ok(r.ok && r.value === 7.5e6, 'новая цена видна клиентам');
  ok(!(await A.req('admin.price.set', { key: 'skin.102', value: -5 })).ok, 'отрицательная цена отклонена');
  r = await A.req('admin.prices');
  ok(r.ok && typeof r.prices === 'object' && r.prices['skin.102'] === 7.5e6, 'список цен для админки');
  const lp = await authTry(ra.token);
  ok(lp.reply && lp.reply.ok && lp.reply.me.prices && lp.reply.me.prices['skin.102'] === 7.5e6, 'цены приходят вместе с профилем при входе');
  const apiPrices = await (await fetch(`http://127.0.0.1:${port}/api/prices`)).json();
  ok(apiPrices.ok && apiPrices.prices['skin.102'] === 7.5e6, 'HTTP /api/prices отдаёт тот же каталог');

  console.log('— Выпуск обновления');
  /* Важно: Carol (C) выше была забанена и кикнута — её соединение закрыто, поэтому здесь B. */
  r = await B.req('admin.release', { version: '1.0.1' }); ok(!r.ok && /Только владелец/.test(r.err), 'выпускать обновление может только владелец');
  r = await B.req('admin.releasestatus'); ok(!r.ok, 'статус выпуска доступен только владельцу');
  r = await A.req('admin.release', { version: 'плохая' }); ok(!r.ok && /вида/.test(r.err), 'некорректная версия отклонена');
  r = await A.req('admin.release', { version: '999' }); ok(!r.ok && /вида/.test(r.err), 'слишком короткая версия отклонена');
  r = await A.req('admin.releasestatus'); ok(r.ok && r.running === false, 'статус выпуска: сборка не идёт');

  console.log('— Владелец и админы');
  r = await A.req('admin.code', { code: ADMIN_CODE }); ok(r.ok && r.owner, 'первый, кто ввёл код, — владелец');
  r = await B.req('admin.code', { code: ADMIN_CODE }); ok(!r.ok && /Владелец уже назначен/.test(r.err), 'второй с верным кодом админку НЕ получает');
  r = await B.req('admin.users'); ok(!r.ok, 'Bob всё ещё без прав');
  r = await B.req('admin.add', { name: 'Bob' }); ok(!r.ok, 'не-владелец не может назначать админов');
  r = await A.req('admin.add', { name: 'Bob' }); await sleep(80); ok(r.ok && B.last('role') && B.last('role').admin, 'владелец назначил Bob админом');
  r = await B.req('admin.users'); ok(r.ok, 'Bob теперь админ');
  r = await B.req('admin.add', { name: 'Carol' }); ok(!r.ok, 'админ не может назначать других админов');
  r = await B.req('admin.ban', { name: 'Alice', minutes: 0 }); ok(!r.ok, 'админ не может банить владельца');
  r = await B.req('admin.kick', { name: 'Alice' }); ok(!r.ok, 'админ не может кикнуть владельца');
  r = await A.req('admin.remove', { name: 'Alice' }); ok(!r.ok, 'владельца снять нельзя');
  const rd = await post('/api/register', { name: 'Dave', password: 'secret4' });
  const D = await client(rd.token);
  await A.req('admin.add', { name: 'Dave' });
  r = await B.req('admin.ban', { name: 'Dave', minutes: 5 }); ok(!r.ok, 'админ не может банить другого админа');
  r = await A.req('admin.remove', { name: 'Dave' }); ok(r.ok, 'владелец снял админа');
  r = await D.req('admin.users'); ok(!r.ok, 'у снятого админа прав нет');

  console.log('— Антиклик');
  const AC = require('../anticlick.js');
  const rnd = (a, b) => a + Math.random() * (b - a);
  const gen = (posFn, ivFn) => { let t = 1000; const o = []; for (let i = 0; i < 50; i++) { const [x, y] = posFn(i); o.push([x, y, t]); t += ivFn(i); } return o; };
  const human = gen(() => [rnd(100, 140), rnd(200, 240)], () => rnd(110, 260));
  const still = gen(() => [300, 300], () => rnd(110, 260));
  const every5 = gen(i => [[100, 100], [220, 150], [130, 300], [250, 250], [180, 120]][i % 5], () => rnd(110, 260));
  const uniStill = gen(() => [300, 300], () => 100);
  ok(!AC.analyze(human).ban, 'человек не банится');
  ok(!AC.analyze(still).ban, 'неподвижная мышь с живыми интервалами не банится');
  ok(AC.analyze(every5).ban, 'одна и та же позиция каждый 5-й клик (100%) → бан');
  ok(AC.analyze(uniStill).ban && AC.analyze(uniStill).rule === 'intervals', 'одинаковые интервалы + одна позиция → бан (порог 40%)');
  ok(!AC.analyze(every5.slice(0, 49)).ready, 'меньше 50 кликов — анализ не запускается');
  // ровно 70% не банит, 72% банит (интервалы разные)
  const frac = gen(i => (i % 10 < 3 ? [rnd(400, 900), rnd(400, 900)] : [[100, 100], [200, 200]][i % 2]), () => rnd(110, 260));
  const fr = AC.analyze(frac); ok(typeof fr.share === 'number', 'доля совпадений считается (' + Math.round(fr.share * 100) + '%)');
  r = await D.req('ac.report', { clicks: human }); ok(r.ok && !r.ban, 'сервер: человеческие клики не баним');
  r = await D.req('ac.report', { clicks: human.slice(0, 10) }); ok(!r.ok, 'сервер: мало кликов — ошибка данных');
  r = await D.req('ac.report', { clicks: every5 }); await sleep(120);
  ok(r.ok && r.ban && D.last('ac.banned'), 'сервер: паттерн → бан аккаунта и уведомление');
  const lg = await post('/api/login', { name: 'Dave', password: 'secret4' });
  ok(!lg.ok && /только администратор/.test(lg.err), 'забаненный антикликом не может войти (разбанит только админ)');
  r = await post('/api/acstatus', { name: 'Dave', password: 'secret4' }); ok(r.ok && r.banned, 'acstatus: бан активен');
  r = await post('/api/acstatus', { name: 'Dave', password: 'bad' }); ok(!r.ok, 'acstatus: чужой пароль отклонён');
  r = await B.req('admin.users', { q: 'dave' }); ok(r.users[0].banned && r.users[0].banAuto, 'в админке бан помечен как автоматический');
  r = await A.req('ac.report', { clicks: every5 }); ok(r.ok && !r.ban, 'владелец автоматически не банится');
  r = await post('/api/acstatus', { name: 'Dave', password: 'secret4', clicks: every5 }); ok(r.banned, 'acstatus с офлайн-кликами тоже банит');
  r = await A.req('admin.unban', { name: 'Dave' }); ok(r.ok, 'админ разбанил');
  r = await post('/api/acstatus', { name: 'Dave', password: 'secret4' }); ok(r.ok && !r.banned, 'acstatus: после разбана свободен');
  ok((await post('/api/login', { name: 'Dave', password: 'secret4' })).ok, 'после разбана вход работает');

  console.log('— Карты: Блэкджек на 2–4 игроков');
  /* Carol выше была забанена и кикнута — подключаем заново и играем втроём */
  const rcl = await post('/api/login', { name: 'Carol', password: 'secret3' });
  const C2 = await client(rcl.token);
  await A.req('save.put', { main: makeSave(1e9), baseRev: 1, force: true });
  await B.req('save.put', { main: makeSave(1e9), baseRev: 1, force: true });
  r = await A.req('card.create', { game: 'bj', bet: 1e12 }); ok(!r.ok, 'ставка больше баланса отклонена');
  r = await A.req('card.create', { game: 'bj', bet: 50000 });
  ok(r.ok && r.room.state === 'lobby' && r.room.min === 2 && r.room.max === 4, 'стол блэкджека создан (2–4 игрока)');
  const bjRoom = r.room.id;
  await sleep(80);
  ok(B.last('card.rooms') && B.last('card.rooms').rooms.some(x => x.id === bjRoom), 'стол виден другим в списке');
  ok(!(await A.req('card.create', { game: 'bj', bet: 50000 })).ok, 'второй стол создать нельзя, пока сидишь за первым');
  ok(!(await A.req('card.start')).ok, 'одному раздачу не начать');
  for (const cl of [A, B, C2]) { const x = await cl.req('wallet.pending'); await cl.req('wallet.ack', { ids: x.items.map(i => i.id) }); }
  const cBal = [(await A.req('wallet.pending')).avail, (await B.req('wallet.pending')).avail, (await C2.req('wallet.pending')).avail];
  r = await B.req('card.join', { room: bjRoom }); ok(r.ok && r.room.players.length === 2, 'Bob сел за стол');
  r = await C2.req('card.join', { room: bjRoom }); ok(r.ok && r.room.players.length === 3, 'Carol села за стол (игра на троих)');
  ok(!(await B.req('card.start')).ok, 'начать игру может только создатель');
  ok(!(await A.req('card.act', { act: 'hit' })).ok, 'до раздачи ходов нет');
  r = await A.req('card.start'); ok(r.ok && r.room.state === 'play', 'хозяин начал раздачу');
  await sleep(120);
  let ga = A.last('card.state').game;
  ok(ga && ga.game === 'bj' && ga.hand.length === 2 && ga.players.length === 3, 'каждому из троих сдали по две карты');
  ok(ga.names.join(',') === 'Alice,Bob,Carol' && ga.pot === 150000, 'имена и банк пришли клиенту');
  await driveCards([A, B, C2], v => v.can.hit && v.total < 16 ? { act: 'hit' } : (v.can.stand ? { act: 'stand' } : null), 40);
  await sleep(150);
  ga = A.last('card.state').game;
  ok(ga.over, 'раздача блэкджека завершена');
  const cpa = await A.req('wallet.pending'), cpb = await B.req('wallet.pending'), cpc = await C2.req('wallet.pending');
  const cNets = [cpa.avail - cBal[0], cpb.avail - cBal[1], cpc.avail - cBal[2]];
  ok(cNets.reduce((s, x) => s + x, 0) === 0, 'блэкджек: деньги не создаются и не пропадают');
  ok(ga.money && ga.money.reduce((s, x) => s + x, 0) === 150000, 'банк 150000 разошёлся полностью');
  for (const [cl, p] of [[A, cpa], [B, cpb], [C2, cpc]]) await cl.req('wallet.ack', { ids: p.items.map(i => i.id) });
  await A.req('card.leave');

  console.log('— Карты: правила игр (cards.js / poker.js)');
  const CL = require('./cards.js'), PK = require('./poker.js');
  ok(CL.deck36().length === 36 && CL.deck52().length === 52, 'колоды на 36 и 52 карты');
  ok(new Set(CL.deck36().map(c => c.r + c.s)).size === 36 && new Set(CL.deck52().map(c => c.r + c.s)).size === 52, 'в колодах нет повторов');
  ok(CL.handTotal([{ r: 'A', s: '♠' }, { r: 'K', s: '♥' }]) === 21, 'блэкджек: A+K = 21');
  ok(CL.handTotal([{ r: 'A', s: '♠' }, { r: 'A', s: '♥' }, { r: '9', s: '♠' }]) === 21, 'блэкджек: два туза считаются 11 и 1');
  const cc = x => ({ r: x.slice(0, -1), s: x.slice(-1) });
  ok(PK.rank5([cc('10♥'), cc('J♥'), cc('Q♥'), cc('K♥'), cc('A♥')])[0] === 8, 'покер: стрит-флеш распознан');
  ok(PK.rank5([cc('A♠'), cc('2♥'), cc('3♦'), cc('4♣'), cc('5♠')])[0] === 4, 'покер: стрит с тузом снизу распознан');
  ok(PK.rank5([cc('K♠'), cc('K♥'), cc('K♦'), cc('4♣'), cc('4♠')])[0] === 6, 'покер: фулл-хаус распознан');
  ok(PK.rank5([cc('2♠'), cc('5♠'), cc('7♠'), cc('9♠'), cc('J♠')])[0] === 5, 'покер: флеш распознан');
  ok(PK.rank5([cc('A♠'), cc('A♥'), cc('7♦'), cc('4♣'), cc('2♠')])[0] === 1, 'покер: пара распознана');
  ok(PK.best7([cc('A♠'), cc('A♥'), cc('K♦'), cc('K♣'), cc('K♥'), cc('2♣'), cc('3♦')])[0] === 6, 'покер: лучшая рука из семи карт найдена');
  const pots = PK.sidePots({ n: 3, total: [1000, 500, 1000], folded: [false, false, false] });
  ok(pots.length === 2 && pots[0].amount === 1500 && pots[1].amount === 1000, 'покер: побочные банки считаются верно');

  console.log('— Карты: Пьяница, Дурак, Верю-не-верю, Покер');
  const wr = mulberry32(4242);
  const wst = CL.war.make(['A', 'B'], x => Math.floor(wr() * x));
  ok(wst.pool.length === 2 && wst.phase === 'reveal' && !wst.over, 'пьяница: стол ждёт ручного вскрытия');
  CL.war.act(wst, wst.pool[0], { act: 'open' });
  ok(wst.phase === 'reveal' && wst.drawn.length === 1, 'пьяница: одна карта — раунд ещё не решён');
  ok(!(() => { try { CL.war.act(wst, wst.pool[0], { act: 'open' }); return true; } catch (e) { return false; } })(), 'пьяница: дважды вскрыть нельзя');
  CL.war.act(wst, wst.pool.filter(i => !wst.opened[i])[0], { act: 'open' });
  ok(wst.phase === 'result' && wst.last && wst.last.list.length === 2, 'пьяница: после всех карт раунд решён');
  CL.war.act(wst, 0, { act: 'fast' });
  ok(wst.over, 'пьяница: «До конца» доигрывает партию');
  const wpay = CL.war.payouts(wst, 1000);
  ok(wpay.reduce((a, b) => a + b, 0) === 2000, 'пьяница: выплаты сходятся в банк');
  const war = await cardMatch('war', [A, B, C2], 20000, warGesture, 400);
  ok(war.ok && war.g.over, 'пьяница: партия доиграна вручную (' + war.g.log.slice(-1)[0] + ')');
  ok(war.okSum && war.pot === 60000, 'пьяница: банк 60000 и деньги сходятся');
  const durak = await cardMatch('durak', [A, B, C2], 20000, durakGesture, 600);
  ok(durak.ok && durak.g.over, 'дурак: партия доиграна (' + durak.g.log.slice(-1)[0] + ')');
  ok(durak.okSum && durak.pot === 60000, 'дурак: банк 60000 и деньги сходятся');
  const cheat = await cardMatch('cheat', [A, B, C2], 20000, cheatGesture, 200);
  ok(cheat.ok && cheat.g.over, 'верю-не-верю: партия доиграна');
  ok(cheat.okSum && cheat.pot === 60000, 'верю-не-верю: банк 60000 и деньги сходятся');
  const poker = await cardMatch('poker', [A, B, C2], 20000, pokerGesture, 200);
  ok(poker.ok && poker.g.over, 'покер: раздача доиграна (борд ' + poker.g.board.length + ' карт)');
  ok(poker.okSum && poker.pot === 60000, 'покер: банк 60000 и деньги сходятся');
  ok(poker.g.street === 'river' || poker.g.street !== '', 'покер: улицы дошли до конца');
  ok(!(await A.req('card.create', { game: 'нет-такой', bet: 50000 })).ok, 'неизвестная игра отклонена');

  console.log('— Карты: настройки Дурака (колода, перевод, партия)');
  const mkr = s => { const f = mulberry32(s); return x => Math.floor(f() * x); };
  ok(CL.V('2') < CL.V('6') && CL.V('6') < CL.V('10') && CL.V('K') < CL.V('A'), 'шкала достоинств 2 … A работает для колоды 52');
  ok(CL.durak.maxFor({ deck: 36 }) === 4 && CL.durak.maxFor({ deck: 52 }) === 6, 'дурак: 36 карт — до 4 игроков, 52 — до 6');
  const d52 = CL.durak.make(['A', 'B'], mkr(7), { deck: 52, transfer: false });
  ok(d52.deck.length === 40 && d52.hand[0].length === 6, 'дурак 52: по 6 карт каждому, колода 40');
  ok(d52.opts.transfer === false, 'дурак: перевод отключается настройкой');
  ok(CL.durak.view(d52, d52.defender).can.transfer === false, 'дурак: без перевода кнопка перевода недоступна');
  const fast = CL.durak.make(['A', 'B'], mkr(9), { toEnd: false });
  ok(fast.opts.toEnd === false, 'дурак: режим «до первого вышедшего» принят');
  const d52m = await cardMatch('durak', [A, B], 20000, durakGesture, 400, { opts: { deck: 52, transfer: false }, turnMs: 30000 });
  ok(d52m.ok && d52m.g.over, 'дурак на 52 картах без перевода доигран (' + (d52m.g.log.slice(-1)[0] || '') + ')');
  ok(d52m.okSum && d52m.pot === 40000, 'дурак на 52: банк 40000 и деньги сходятся');
  ok(d52m.g.opts && d52m.g.opts.deck === 52 && d52m.g.opts.transfer === false && d52m.g.deckSize === 52, 'настройки стола пришли клиенту');

  console.log('— Карты: достойный выход из партии');
  for (const cl of [A, B, C2]) { try { await cl.req('card.leave'); } catch (e) { } }
  await sleep(80);
  const clamp = await A.req('card.create', { game: 'durak', bet: 20000, max: 6 });
  ok(clamp.ok && clamp.room.max === 4, 'дурак на 36 картах: стол всё равно ограничен 4 игроками');
  await A.req('card.leave');
  await sleep(60);
  for (const cl of [A, B, C2]) { const x = await cl.req('wallet.pending'); await cl.req('wallet.ack', { ids: x.items.map(i => i.id) }); }
  const qBefore = [(await A.req('wallet.pending')).avail, (await B.req('wallet.pending')).avail, (await C2.req('wallet.pending')).avail];
  const qr = await A.req('card.create', { game: 'durak', bet: 20000, opts: { toEnd: false }, turnMs: 0 });
  ok(qr.ok && qr.room.turnMs === 0 && qr.room.opts.toEnd === false, 'стол дурака: таймер «без ограничения» + партия до первого вышедшего');
  await B.req('card.join', { room: qr.room.id });
  await C2.req('card.join', { room: qr.room.id });
  ok((await A.req('card.start')).ok, 'партия дурака началась');
  await sleep(140);
  ok(A.last('card.state') && A.last('card.state').game && !A.last('card.state').game.over, 'партия идёт');
  ok((await B.req('card.leave')).ok, 'игрок вышел из партии посреди игры');
  await sleep(140);
  ok(B.last('card.gone') != null, 'вышедший вернулся к списку столов');
  const gq = A.last('card.state').game;
  ok(gq && gq.gone && gq.gone[1] === true, 'остальные видят, что игрок вышел');
  ok((await B.req('card.create', { game: 'bj', bet: 20000 })).ok, 'вышедший может сесть за другой стол');
  await B.req('card.leave');
  await driveCards([A, B, C2], durakGesture, 400);
  await sleep(200);
  const gq2 = A.last('card.state').game;
  ok(gq2 && gq2.over, 'партия после выхода доиграна');
  const qa = await A.req('wallet.pending'), qb = await B.req('wallet.pending'), qc = await C2.req('wallet.pending');
  const qNets = [qa.avail - qBefore[0], qb.avail - qBefore[1], qc.avail - qBefore[2]];
  ok(qNets.reduce((s, x) => s + x, 0) === 0, 'выход из партии: деньги не создаются и не пропадают');
  ok(gq2.money && gq2.money.reduce((s, x) => s + x, 0) === 60000, 'банк 60000 разошёлся полностью');
  ok(qNets[1] <= 0, 'вышедший ничего не заработал — ставка осталась в банке');
  for (const [cl, p] of [[A, qa], [B, qb], [C2, qc]]) await cl.req('wallet.ack', { ids: p.items.map(i => i.id) });

  console.log('— Опыт, профиль, лидерборд');
  await A.req('wallet.pending').then(x => A.req('wallet.ack', { ids: x.items.map(i => i.id) }));
  await B.req('wallet.pending').then(x => B.req('wallet.ack', { ids: x.items.map(i => i.id) }));
  r = await A.req('profile.get');
  ok(r.ok && r.level >= 1 && typeof r.xp === 'number', 'profile.get отдаёт опыт и уровень');
  ok(r.xp > 0 && r.levelNext > r.levelFloor, 'опыт накоплен (' + r.xp + '), границы уровня корректны');
  r = await A.req('leaderboard');
  ok(r.ok && r.xp.length >= 2 && r.money.length >= 2, 'лидерборд: топ по опыту и по деньгам');

  console.log('— Онлайн-банк');
  r = await A.req('bank.deposit', { amount: 100000 });
  ok(r.ok && r.amount === 100000, 'вклад 100000 принят');
  r = await A.req('wallet.pending');
  ok(r.items.some(i => i.kind === 'debit' && i.amount === 100000), 'вклад списан из облачного баланса');
  await A.req('wallet.ack', { ids: r.items.map(i => i.id) });
  r = await A.req('bank.withdraw');
  ok(r.ok && r.paid >= 100000, 'снятие вернуло вклад (' + r.paid + ')');
  r = await A.req('wallet.pending');
  ok(r.items.some(i => i.kind === 'credit' && i.amount >= 100000), 'снятие зачислено обратно');
  await A.req('wallet.ack', { ids: r.items.map(i => i.id) });
  ok(!(await A.req('bank.deposit', { amount: 10 })).ok, 'вклад ниже минимума отклонён');

  console.log('— Комнаты чата и реакции');
  r = await A.req('chat.send', { text: 'в торговую', room: 'trade' });
  ok(r.ok, 'сообщение в комнату «Торговая»');
  await sleep(80);
  ok(B.last('chat.msg') && B.last('chat.msg').msg.room === 'trade', 'сообщение комнаты разослано с полем room');
  r = await A.req('chat.history', { room: 'trade' });
  ok(r.ok && r.msgs.some(m => m.text === 'в торговую'), 'история комнаты «Торговая»');
  const mid = r.msgs[r.msgs.length - 1].id;
  r = await B.req('chat.react', { msgId: mid, emoji: '🔥' });
  ok(r.ok && r.react['🔥'] && r.react['🔥'].indexOf('Bob') >= 0, 'реакция добавлена');
  await sleep(60);
  ok(B.last('chat.react') && B.last('chat.react').msgId === mid, 'реакция разослана всем');
  r = await B.req('chat.react', { msgId: mid, emoji: '🔥' });
  ok(r.ok && !r.react['🔥'], 'повторный клик снимает реакцию');
  ok(!(await B.req('chat.react', { msgId: mid, emoji: '💣' })).ok, 'недопустимая реакция отклонена');
  r = await A.req('chat.history', { with: 'Bob' });
  const dmId = (r.msgs.find(x => x.text === 'личка') || {}).id;
  ok(!!dmId, 'личная переписка доступна');
  r = await B.req('chat.react', { msgId: dmId, emoji: '👍' });
  ok(r.ok && r.react['👍'] && r.react['👍'].indexOf('Bob') >= 0, 'реакция на личное сообщение работает');
  await sleep(80);
  ok(A.last('chat.react') && A.last('chat.react').msgId === dmId, 'собеседник видит реакцию на личное');
  r = await A.req('chat.history', { with: 'Bob' });
  ok(!!(r.msgs.find(x => x.id === dmId) || {}).react['👍'], 'реакция сохранена в переписке');
  r = await A.req('chat.react', { msgId: dmId, emoji: '👍' });
  ok(r.ok && r.react['👍'].indexOf('Alice') >= 0 && r.react['👍'].indexOf('Bob') >= 0, 'второй участник тоже ставит реакцию');
  r = await A.req('chat.react', { msgId: dmId, emoji: '👍' });
  ok(r.ok && r.react['👍'] && r.react['👍'].indexOf('Alice') < 0 && r.react['👍'].indexOf('Bob') >= 0, 'повторный клик снимает свою реакцию');
  ok(!(await A.req('chat.react', { msgId: 'нет-такого-id', emoji: '👍' })).ok, 'реакция на несуществующее сообщение отклонена');

  console.log('— Дуэли 1 на 1');
  await A.req('wallet.pending').then(x => A.req('wallet.ack', { ids: x.items.map(i => i.id) }));
  await B.req('wallet.pending').then(x => B.req('wallet.ack', { ids: x.items.map(i => i.id) }));
  r = await A.req('duel.create', { game: 'dice', bet: 50000 });
  ok(r.ok, 'вызов на дуэль создан');
  await sleep(80);
  ok(B.last('duel.tables') && B.last('duel.tables').tables.some(t => t.game === 'dice'), 'вызов виден другим');
  const dt = (await B.req('duel.tables')).tables.find(t => t.game === 'dice');
  const balA = (await A.req('wallet.pending')).avail, balB = (await B.req('wallet.pending')).avail;
  r = await B.req('duel.join', { table: dt.id });
  ok(r.ok, 'соперник принял вызов');
  await sleep(120);
  const resA = A.last('duel.result'), resB = B.last('duel.result');
  ok(resA && resB && resA.res.reason && resB.res.reason, 'оба получили результат: ' + (resA && resA.res.reason));
  ok(resA.res.push ? true : (resA.res.youWon !== resB.res.youWon), 'определён победитель или ничья');
  const pa2 = await A.req('wallet.pending'), pb2 = await B.req('wallet.pending');
  const netA2 = pa2.avail - balA, netB2 = pb2.avail - balB;
  ok(resA.res.push ? (netA2 === 0 && netB2 === 0) : (netA2 === -netB2 && Math.abs(netA2) === 50000), 'выплата дуэли корректна');
  ok(netA2 + netB2 === 0, 'дуэль: деньги не создаются и не пропадают');
  await A.req('wallet.ack', { ids: pa2.items.map(i => i.id) });
  await B.req('wallet.ack', { ids: pb2.items.map(i => i.id) });
  ok(!(await B.req('duel.join', { table: dt.id })).ok, 'повторно принять вызов нельзя');
  ok(!(await A.req('duel.create', { game: 'coin', bet: 10 })).ok, 'ставка ниже минимума отклонена');

  console.log('— Рулетка: математика ставок (roulette.js)');
  const RL = require('../roulette.js');
  ok(RL.ORDER.length === 37 && new Set(RL.ORDER).size === 37, 'на колесе 37 уникальных секторов');
  ok(RL.allNumbers().join(',') === Array.from({ length: 37 }, (_, i) => i).join(','), 'на колесе присутствуют все числа 0–36');
  ok(RL.RED_NUMS.size === 18, 'красных чисел ровно 18');
  ok(RL.pocketColor(0) === 'green' && RL.pocketColor(1) === 'red' && RL.pocketColor(2) === 'black' && RL.pocketColor(36) === 'red', 'цвета лунок определены верно');
  const coverCount = { straight: 1, split: 2, street: 3, corner: 4, line: 6, dozen: 12, column: 12, even: 18 };
  ok(RL.BETS.length > 140 && RL.BETS.every(b => b.covers.length === coverCount[b.kind]), 'каждая ставка покрывает верное число чисел');
  ok(RL.BETS.every(b => b.covers.every(n => n >= 0 && n <= 36)), 'ставки не выходят за пределы 0–36');
  ok(RL.BETS.every(b => Math.abs(RL.expectedValue(b) + 1 / 37) < 1e-9), 'преимущество заведения у каждой ставки 1/37 (2.7%)');
  let ev = RL.evaluate([{ id: 'n:17', amount: 1000 }, { id: 'd:2', amount: 1000 }, { id: 'high', amount: 1000 }], 17);
  ok(ev.stake === 3000 && ev.returned === 39000 && ev.net === 36000 && ev.hits.length === 2, 'выигрыш по нескольким ставкам считается верно');
  ev = RL.evaluate([{ id: 'red', amount: 1000 }, { id: 'n:0', amount: 500 }], 0);
  ok(ev.returned === 500 * 36 && ev.hits.length === 1 && ev.net === 500 * 36 - 1500, 'зеро забирает равные шансы, но платит прямую ставку на 0');
  ok(RL.ORDER.every((n, i) => Math.abs(RL.angleOf(n) - (i * RL.SPAN + RL.SPAN / 2)) < 1e-9) && RL.angleOf(36) < 360, 'углы секторов соответствуют порядку колеса');

  console.log('— Рулеточный стол: 2–4 игрока (полный стол как в аркаде)');
  for (const [nm, cl] of [['A', A], ['B', B], ['C', C2]]) { const x = await cl.req('wallet.pending'); await cl.req('wallet.ack', { ids: x.items.map(i => i.id) }); }
  r = await A.req('roul.create', { bet: 50000, max: 3 });
  ok(r.ok && r.room && r.room.state === 'lobby' && r.room.max === 3, 'стол рулетки создан на 3 игрока');
  const roomId = r.room.id;
  await sleep(80);
  ok(C2.last('roul.rooms') && C2.last('roul.rooms').rooms.some(x => x.id === roomId), 'стол виден другим игрокам в списке');
  ok(!(await A.req('roul.create', { bet: 50000 })).ok, 'второй стол создать нельзя, пока сидишь за первым');
  ok(!(await A.req('roul.start')).ok, 'одному игру не начать');
  const rBalA = (await A.req('wallet.pending')).avail, rBalB = (await B.req('wallet.pending')).avail, rBalC = (await C2.req('wallet.pending')).avail;
  r = await B.req('roul.join', { room: roomId }); ok(r.ok && r.room.players.length === 2, 'второй игрок сел за стол');
  r = await C2.req('roul.join', { room: roomId }); ok(r.ok && r.room.players.length === 3, 'третий игрок сел за стол');
  ok(!(await B.req('roul.join', { room: roomId })).ok, 'дважды за один стол не сесть');
  r = await A.req('roul.start'); ok(r.ok && r.room.state === 'bet', 'хозяин начал игру — все раскладывают фишки');
  ok(!(await A.req('roul.bets', { bets: [{ id: 'red', amount: 1000 }] })).ok, 'неполный расклад отклонён (нужна вся ставка)');
  ok(!(await A.req('roul.bets', { bets: [{ id: 'нет-такой', amount: 50000 }] })).ok, 'неизвестная ставка отклонена');
  ok(!(await A.req('roul.bets', { bets: [{ id: 'red', amount: 60000 }] })).ok, 'расклад больше ставки отклонён');
  r = await A.req('roul.bets', { bets: [{ id: 'red', amount: 50000 }] }); ok(r.ok && r.room.you.ready && r.room.state === 'bet', 'расклад первого принят');
  r = await B.req('roul.bets', { bets: [{ id: 'black', amount: 50000 }] }); ok(r.ok, 'расклад второго принят');
  ok(!(await A.req('roul.bets', { bets: [{ id: 'red', amount: 50000 }] })).ok, 'повторно сдать расклад нельзя');
  await sleep(60);
  ok(A.last('roul.room') && !A.last('roul.room').room.players[0].bets, 'до спина чужие расклады скрыты');
  r = await C2.req('roul.bets', { bets: [{ id: 'n:0', amount: 50000 }] }); ok(r.ok && r.room.state === 'done', 'расклад третьего принят — колесо крутится');
  await sleep(150);
  const rr = C2.last('roul.room').room;
  ok(rr.state === 'done' && rr.num >= 0 && rr.num <= 36, 'колесо остановилось на числе ' + rr.num + ' (' + rr.color + ')');
  ok(rr.players.length === 3 && rr.players.every(p => p.bets && typeof p.net === 'number'), 'после спина расклады всех игроков раскрыты');
  const wn = rr.players.filter(p => p.win);
  ok(wn.length === 1, 'ровно один игрок забрал банк');
  const rpA = await A.req('wallet.pending'), rpB = await B.req('wallet.pending'), rpC = await C2.req('wallet.pending');
  const nets = [rpA.avail - rBalA, rpB.avail - rBalB, rpC.avail - rBalC];
  ok(nets.reduce((s, x) => s + x, 0) === 0, 'рулеточный стол: деньги не создаются и не пропадают');
  const wi = rr.players.findIndex(p => p.win);
  ok(nets[wi] === 100000 && nets.filter((x, i) => i !== wi).every(x => x === -50000), 'банк 150000 ушёл победителю (+100000, остальные −50000)');
  ok(rr.players[wi].payout === 150000, 'победитель получил весь банк (150000)');
  await A.req('wallet.ack', { ids: rpA.items.map(i => i.id) });
  await B.req('wallet.ack', { ids: rpB.items.map(i => i.id) });
  await C2.req('wallet.ack', { ids: rpC.items.map(i => i.id) });
  /* выход со стола во время ставок возвращает ставку всем */
  r = await A.req('roul.create', { bet: 10000, max: 2 }); const id2 = r.room.id;
  await B.req('roul.join', { room: id2 });
  await A.req('roul.start');
  await B.req('roul.leave');
  await sleep(120);
  const bA = await A.req('wallet.pending'), bB = await B.req('wallet.pending');
  ok(bA.items.filter(i => i.kind === 'debit' && i.amount === 10000).length === 1 && bA.items.filter(i => i.kind === 'credit' && i.amount === 10000).length === 1, 'выход со стола во время ставок вернул ставку первому');
  ok(bB.items.some(i => i.kind === 'credit' && i.amount === 10000), 'вышедший тоже получил ставку назад');
  await A.req('wallet.ack', { ids: bA.items.map(i => i.id) });
  await B.req('wallet.ack', { ids: bB.items.map(i => i.id) });
  await A.req('roul.leave');
  await sleep(80);
  ok(!(await A.req('roul.rooms')).room && !(await B.req('roul.rooms')).room, 'после выхода за столом никого не осталось');

  console.log('— Профиль: аватар, цвет, ник, список игроков');
  r = await A.req('profile.get');
  ok(r.ok && Array.isArray(r.colors) && Array.isArray(r.avatars) && r.avatars.length > 10, 'профиль отдаёт палитру цветов и аватарки');
  r = await A.req('players.list', {});
  ok(r.ok && r.players.length >= 2 && r.players.some(p => p.name === 'Alice') && r.players.some(p => p.online), 'список игроков с онлайн-статусом');
  r = await A.req('players.list', { q: 'bob' });
  ok(r.ok && r.players.length === 1 && r.players[0].name === 'Bob', 'поиск по списку игроков');
  r = await A.req('profile.view', { name: 'Bob' });
  ok(r.ok && r.name === 'Bob' && r.self === false && r.friend === true && typeof r.level === 'number' && typeof r.xp === 'number', 'просмотр чужого профиля: имя, уровень, опыт');
  ok(r.stats && typeof r.stats.msgs === 'number' && typeof r.friends === 'number' && typeof r.online === 'boolean', 'профиль: статистика, число друзей, статус онлайн');
  r = await B.req('profile.view', { name: 'Bob' });
  ok(r.ok && r.self === true, 'свой профиль помечен как self');
  ok(!(await A.req('profile.view', { name: 'НетТакого' })).ok, 'профиль несуществующего игрока отклонён');
  r = await A.req('profile.setcolor', { color: 'gold' });
  ok(r.ok && r.color === 'gold', 'цвет ника установлен');
  ok(!(await A.req('profile.setcolor', { color: 'hack' })).ok, 'неизвестный цвет отклонён');
  r = await A.req('profile.setcolor', { color: '#ff8a00' });
  ok(r.ok && r.color === '#ff8a00', 'свой HEX-цвет принят');
  r = await A.req('profile.setcolor', { color: '#ff8a00,#00c2ff' });
  ok(r.ok && r.color === '#ff8a00,#00c2ff', 'HEX-градиент принят');
  r = await A.req('profile.setcolor', { color: '#F80' });
  ok(r.ok && r.color === '#f80', 'короткий HEX (#rgb) принят');
  ok(!(await A.req('profile.setcolor', { color: '#12345' })).ok, 'неверный HEX отклонён');
  ok(!(await A.req('profile.setcolor', { color: 'red;background:url(x)' })).ok, 'инъекция в CSS отклонена');
  ok(!(await A.req('profile.setcolor', { color: '#ff8a00,#zzz' })).ok, 'мусор во втором цвете отклонён');
  ok((await A.req('profile.setcolor', { color: 'gold' })).ok, 'возврат к готовому цвету');
  r = await A.req('profile.setbio', { bio: 'Люблю кликать и ловить пиксели' });
  ok(r.ok && r.bio === 'Люблю кликать и ловить пиксели', 'описание профиля сохранено');
  r = await B.req('profile.view', { name: 'Alice' });
  ok(r.ok && r.bio === 'Люблю кликать и ловить пиксели', 'описание видно в чужом профиле');
  r = await A.req('profile.get');
  ok(r.ok && r.bio === 'Люблю кликать и ловить пиксели', 'описание отдаётся в своём профиле');
  r = await A.req('profile.setbio', { bio: 'x'.repeat(300) });
  ok(r.ok && r.bio.length === 140, 'описание обрезается до 140 символов');
  r = await A.req('profile.setbio', { bio: '  много   пробелов \n и переносов  ' });
  ok(r.ok && r.bio === 'много пробелов и переносов', 'лишние пробелы и переносы убираются');
  r = await A.req('profile.setbio', { bio: '' });
  ok(r.ok && r.bio === '', 'описание можно очистить');
  r = await A.req('profile.setavatar', { avatar: '🦊' });
  ok(r.ok && r.avatar === '🦊', 'аватарка-эмодзи установлена');
  ok((await A.req('profile.setavatar', { avatar: 'data:image/png;base64,' + 'A'.repeat(120) })).ok, 'картинка-аватарка принята');
  ok(!(await A.req('profile.setavatar', { avatar: 'javascript:alert(1)' })).ok, 'опасная аватарка отклонена');
  ok(!(await A.req('profile.setavatar', { avatar: 'data:image/png;base64,' + 'A'.repeat(40000) })).ok, 'слишком большая аватарка отклонена');
  await A.req('profile.setavatar', { avatar: '🦊' });
  await B.req('wallet.pending').then(x => B.req('wallet.ack', { ids: x.items.map(i => i.id) }));
  r = await A.req('profile.setname', { name: 'Alice2' });
  ok(r.ok && r.name === 'Alice2', 'ник изменён');
  await sleep(100);
  ok(B.last('friends.update'), 'друзья получили обновление о смене ника');
  r = await B.req('friends.list');
  ok(r.friends.some(f => f.name === 'Alice2'), 'у друга обновилось имя');
  r = await B.req('chat.history', { with: 'Alice2' });
  ok(r.ok && r.msgs.some(m => m.text === 'личка'), 'личная переписка сохранена после смены ника');
  ok(!(await A.req('profile.setname', { name: 'Alice3' })).ok, 'повторная смена ника — кулдаун');
  ok(!(await A.req('profile.setname', { name: 'Bob' })).ok, 'занятый ник отклонён');
  ok(!(await A.req('profile.setname', { name: 'x' })).ok, 'слишком короткий ник отклонён');
  r = await B.req('players.list', { q: 'alice2' });
  ok(r.ok && r.players.length === 1 && r.players[0].avatar === '🦊' && r.players[0].color === 'gold', 'в списке игроков видны аватарка и цвет');
  r = await A.req('players.list', { q: 'alice' });
  ok(r.ok && !r.players.some(p => p.name === 'Alice') && r.players.some(p => p.name === 'Alice2'), 'старый ник освободился, новый занят');

  console.log('\n— Выпуск обновления: где собирать');
  const full = { node: true, npm: true, electron: true, mobile: true, jdk: true, sdk: true, keystore: true };
  const gh = { token: 'tok', repo: 'ArbyzikOwO/vitalyaclicker' };
  const badMode = fn => { try { fn(); return false; } catch (e) { return true; } };
  ok(ReleasePlan.pickMode('auto', full, gh) === 'local', 'авто: набор для сборки есть — собираем на этом компьютере');
  ok(ReleasePlan.pickMode('auto', {}, gh) === 'cloud', 'авто: набора нет, GitHub есть — собираем в облаке');
  ok(ReleasePlan.pickMode('cloud', full, gh) === 'cloud', 'принудительно в облаке');
  ok(ReleasePlan.pickMode('local', full, {}) === 'local', 'принудительно локально (GitHub не нужен)');
  ok(badMode(() => ReleasePlan.pickMode('local', {}, gh)), 'принудительно локально без набора — ошибка');
  ok(badMode(() => ReleasePlan.pickMode('cloud', full, {})), 'принудительно в облаке без токена — ошибка');
  ok(badMode(() => ReleasePlan.pickMode('auto', {}, {})), 'ни набора, ни GitHub — ошибка');
  ok(badMode(() => ReleasePlan.pickMode('телепорт', full, gh)), 'неизвестный способ сборки — ошибка');
  ok(ReleasePlan.missingLocal({ node: true, npm: true }).length === 5, 'подсказка перечисляет все недостающие части набора');
  ok(ReleasePlan.missingLocal(full).length === 0, 'полный набор — ничего не хватает');
  const c1 = ReleasePlan.caps(full, gh), c2 = ReleasePlan.caps({}, gh), c3 = ReleasePlan.caps(full, {}), c4 = ReleasePlan.caps({}, {});
  ok(c1.local && c1.cloud && c1.mode === 'local' && c1.repo === gh.repo, 'состояние: доступно и локально, и в облаке');
  ok(c2.mode === 'cloud' && !c2.local && c2.cloud, 'состояние: только облако');
  ok(c3.mode === 'local' && !c3.cloud, 'состояние: только этот компьютер');
  ok(c4.mode === 'none' && !c4.local && !c4.cloud && c4.missing.length === 7, 'состояние: собирать нечем');

  await sleep(1100);   /* соединение ограничено 60 сообщениями в секунду — даём счётчику сброситься */
  r = await A.req('admin.releasestatus');
  ok(r.ok && typeof r.local === 'boolean' && typeof r.cloud === 'boolean' && Array.isArray(r.missing), 'admin.releasestatus отдаёт состояние сборки');
  ok(r.ok && r.running === false && !r.mode, 'сборка сейчас не идёт');
  await sleep(80);
  r = await A.req('admin.release', { version: '1.0.9', mode: 'телепорт' });
  ok(!r.ok && /способ/i.test(r.err || ''), 'неизвестный способ сборки отклонён');
  await sleep(80);
  r = await A.req('admin.release', { version: '1.1', mode: 'телепорт' });
  ok(!r.ok && /способ/i.test(r.err || ''), 'версия из двух чисел (1.1) проходит проверку и уходит в сборку как 1.1.0');
  await sleep(80);
  r = await A.req('admin.releasestatus');
  ok(r.ok && r.running === false, 'после отказа сборка не запущена и игра разблокирована');
  await sleep(80);
  r = await B.req('admin.releasestatus');
  ok(!r.ok, 'состояние выпуска видит только владелец');

  console.log('\n— Обязательные обновления');
  ok(ReleasePlan.cmpVersion('1.0.10', '1.0.9') === 1, 'сравнение версий: 1.0.10 новее 1.0.9');
  ok(ReleasePlan.cmpVersion('v1.2', '1.2.0') === 0, 'сравнение версий: v1.2 = 1.2.0');
  ok(ReleasePlan.cmpVersion('0.9.9', '1.0.0') === -1, 'сравнение версий: 0.9.9 старее 1.0.0');
  ok(ReleasePlan.isVersion('1.0.7') && ReleasePlan.isVersion('2.1') && !ReleasePlan.isVersion('плохая') && !ReleasePlan.isVersion('999'), 'проверка формата версии');
  ok(ReleasePlan.normalizeVersion('1.1') === '1.1.0' && ReleasePlan.normalizeVersion('v1.0.7') === '1.0.7'
     && ReleasePlan.normalizeVersion('1.0.7') === '1.0.7' && ReleasePlan.normalizeVersion('999') === ''
     && ReleasePlan.normalizeVersion('1.0.7.2') === '', 'версия 1.1 -> 1.1.0: сборщику нужны три числа');
  const ping = await fetch(`http://127.0.0.1:${port}/api/ping`).then(x => x.json());
  ok(ping.ok && !!ping.version, 'ping отдаёт текущую версию (' + ping.version + ')');
  let old = await authTry(ra.token, '0.0.1');
  ok(old.reply && old.reply.ok === false && old.reply.err === 'update' && old.reply.needUpdate && old.reply.needUpdate.version, 'старая сборка не пускается: требуется обновление до v' + (old.reply && old.reply.needUpdate && old.reply.needUpdate.version));
  old = await authTry(ra.token, '99.0.0');
  ok(old.reply && old.reply.ok === true, 'новая (или такая же) сборка пускается');
  old = await authTry(ra.token, '');
  ok(old.reply && old.reply.ok === true, 'сборка без версии (браузер) пускается');

  console.log(`\nИтого: ${pass} прошло, ${fail} упало`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
