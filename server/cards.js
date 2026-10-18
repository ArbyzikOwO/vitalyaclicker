'use strict';
/* =====================================================================
   cards.js — карточные игры: чистая логика без сети и денег.
   Сервер передаёт сюда имена игроков и источник случайности (rnd),
   обратно получает состояние, «вид» для каждого игрока и выплаты.

   Игры:
     war    — Пьяница (2–4 игрока, без ходов: карты решают всё);
     cheat  — Верю-не-верю (2–6 игроков);
     durak  — Дурак подкидной (2–4 игрока).

   Интерфейс игры:
     key/title/min/max/auto — паспорт;
     make(names, rnd)       — новое состояние (для auto игра сразу доиграна);
     view(st, i)            — что видит игрок i (чужие карты скрыты);
     act(st, i, m)          — ход игрока i (бросает Error, если так нельзя);
     done(st)               — игра окончена?
     payouts(st, bet)       — сколько вернуть каждому (сумма = bet * число игроков);
     turn(st)               — чей сейчас ход (для таймера), или -1.
   ===================================================================== */

const SUITS = ['♠', '♥', '♦', '♣'];
const R36 = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const V = r => R36.indexOf(r) + 6;
const isRed = c => c.s === '♥' || c.s === '♦';
function deck36() { const d = []; for (const s of SUITS) for (const r of R36) d.push({ r: r, s: s }); return d; }
function shuffle(a, rnd) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function pushLog(st, text) { st.log.push(text); if (st.log.length > 60) st.log.splice(0, st.log.length - 60); }

/* ============================================================
   Пьяница — 2–4 игрока
   Каждый раунд все вскрывают верхнюю карту, старшая забирает
   весь базар. Равные старшие карты спорят дальше, пока не
   останется один. Побеждает тот, кто собрал все карты.
   ============================================================ */
function warStep(st) {
  if (st.over) return;
  const alive = [];
  for (let i = 0; i < st.n; i++) if (st.hands[i].length) alive.push(i);
  if (alive.length <= 1) { st.over = true; st.winner = alive.length ? alive[0] : -1; return; }
  let pool = st.tied.length ? st.tied.filter(i => st.hands[i].length) : alive;
  if (!pool.length) { pool = alive; st.tied = []; }
  if (pool.length === 1) {
    const w = pool[0];
    st.hands[w].push.apply(st.hands[w], st.pile);
    pushLog(st, st.names[w] + ' забирает базар (' + st.pile.length + ' карт)');
    st.pile = []; st.tied = [];
    return;
  }
  const drawn = pool.map(i => ({ i: i, c: st.hands[i].pop() }));
  st.pile.push.apply(st.pile, drawn.map(d => d.c));
  st.rounds++;
  let best = -1;
  for (const d of drawn) best = Math.max(best, V(d.c.r));
  const top = drawn.filter(d => V(d.c.r) === best).map(d => d.i);
  if (top.length === 1) {
    const w = top[0];
    st.hands[w].push.apply(st.hands[w], st.pile);
    pushLog(st, 'Раунд ' + st.rounds + ': ' + drawn.map(d => st.names[d.i] + ' ' + d.c.r + d.c.s).join(', ') + ' — забирает ' + st.names[w]);
    st.pile = []; st.tied = [];
  } else {
    st.tied = top;
    pushLog(st, 'Раунд ' + st.rounds + ': спор ' + top.map(i => st.names[i]).join(', ') + ' — базар растёт (' + st.pile.length + ' карт)');
  }
  const now = [];
  for (let i = 0; i < st.n; i++) if (st.hands[i].length) now.push(i);
  if (now.length <= 1) { st.over = true; st.winner = now.length ? now[0] : -1; return; }
  if (st.rounds >= 300) {
    st.over = true;
    let bi = -1;
    for (let i = 0; i < st.n; i++) if (bi < 0 || st.hands[i].length > st.hands[bi].length) bi = i;
    let tie = false;
    for (let i = 0; i < st.n; i++) if (i !== bi && st.hands[i].length === st.hands[bi].length) tie = true;
    st.winner = tie ? -1 : bi;
    pushLog(st, 'Слишком долго — побеждает тот, у кого больше карт');
  }
}
const war = {
  key: 'war', title: 'Пьяница', min: 2, max: 4, auto: true,
  make(names, rnd) {
    const st = { n: names.length, names: names.slice(), hands: names.map(() => []), pile: [], tied: [], rounds: 0, log: [], over: false, winner: -1 };
    const d = shuffle(deck36(), rnd);
    d.forEach((c, i) => st.hands[i % st.n].push(c));
    pushLog(st, 'Карты сданы: по ' + st.hands[0].length + ' каждому');
    let guard = 0;
    while (!st.over && guard++ < 2000) warStep(st);
    if (!st.over) { st.over = true; st.winner = -1; }
    return st;
  },
  view(st) {
    return { game: 'war', counts: st.hands.map(h => h.length), pile: st.pile.length, tied: st.tied.slice(), rounds: st.rounds, log: st.log.slice(-24), over: st.over, winner: st.winner };
  },
  act() { throw new Error('В «Пьянице» ходов нет — карты решают всё'); },
  done(st) { return st.over; },
  turn() { return -1; },
  payouts(st, bet) {
    const out = st.names.map(() => 0);
    if (st.winner >= 0) out[st.winner] = bet * st.n;
    else for (let i = 0; i < st.n; i++) out[i] = bet;   /* ничья — возврат */
    return out;
  }
};

/* ============================================================
   Верю-не-верю — 2–6 игроков
   По 5 карт. По кругу выкладывают 1–3 карты рубашкой вверх,
   объявляя текущее достоинство (A,2,3…K по кругу). Следующий
   игрок либо верит и кладёт дальше, либо не верит и вскрывает:
   соврал — забирает базар, сказал правду — забирает тот, кто
   не поверил. Кто первым скинул все карты — победил.
   ============================================================ */
const cheat = {
  key: 'cheat', title: 'Верю-не-верю', min: 2, max: 6, auto: false,
  make(names, rnd) {
    const st = {
      n: names.length, names: names.slice(), hands: names.map(() => []),
      pile: [], rank: 0, turn: 0, phase: 'place', pending: null,
      over: false, winner: -1, log: []
    };
    const d = shuffle(deck36(), rnd);
    for (let k = 0; k < 5; k++) for (let i = 0; i < st.n; i++) st.hands[i].push(d.pop());
    st.hands.forEach(h => h.sort((a, b) => V(a.r) - V(b.r) || a.s.localeCompare(b.s)));
    pushLog(st, 'Карты сданы: по 5 каждому');
    return st;
  },
  view(st, i) {
    const p = st.pending;
    const counts = st.hands.map(h => h.length);
    const canPlace = !st.over && st.phase === 'place' && st.turn === i;
    const canAns = !st.over && st.phase === 'challenge' && st.turn === i;
    return {
      game: 'cheat', rank: R36[st.rank], turn: st.turn, phase: st.phase, pile: st.pile.length,
      counts, hand: st.hands[i].slice(), over: st.over, winner: st.winner, log: st.log.slice(-14),
      pending: p ? { by: p.by, byName: st.names[p.by], count: p.cards.length, rank: p.rank } : null,
      can: { place: canPlace, believe: canAns, doubt: canAns }
    };
  },
  act(st, i, m) {
    if (st.over) throw new Error('Игра уже закончена');
    const act = m && m.act;
    if (st.phase === 'place') {
      if (st.turn !== i) throw new Error('Сейчас не ваш ход');
      if (act !== 'play') throw new Error('Выложите 1–3 карты или нажмите «Не верю», если есть что вскрыть');
      const idx = Array.isArray(m.cards) ? m.cards.map(x => Math.floor(Number(x))) : [];
      if (idx.length < 1 || idx.length > 3) throw new Error('Выложить можно 1–3 карты');
      const uniq = new Set(idx);
      if (uniq.size !== idx.length) throw new Error('Одну карту нельзя положить дважды');
      for (const k of idx) if (!(k >= 0 && k < st.hands[i].length)) throw new Error('Такой карты нет');
      const cards = idx.sort((a, b) => b - a).map(k => st.hands[i].splice(k, 1)[0]);
      st.pending = { by: i, cards: cards, rank: R36[st.rank] };
      st.phase = 'challenge';
      st.turn = (i + 1) % st.n;
      pushLog(st, st.names[i] + ' кладёт ' + cards.length + ' карт(ы) как «' + R36[st.rank] + '»');
      return;
    }
    /* phase === 'challenge' */
    if (st.turn !== i) throw new Error('Решает следующий игрок');
    const p = st.pending;
    if (!p) throw new Error('Нечего проверять');
    if (act === 'believe') {
      st.pile.push.apply(st.pile, p.cards);
      pushLog(st, st.names[i] + ' верит');
      st.pending = null;
      st.phase = 'place'; st.turn = i;
      st.rank = (st.rank + 1) % R36.length;
      cheatWin(st);
      return;
    }
    if (act === 'doubt') {
      const truth = p.cards.every(c => c.r === p.rank);
      st.pile.push.apply(st.pile, p.cards);
      const taker = truth ? i : p.by;
      const wasPile = st.pile.length;
      st.hands[taker].push.apply(st.hands[taker], st.pile);
      st.pile = [];
      pushLog(st, st.names[i] + ' не верит: ' + p.cards.map(c => c.r + c.s).join(' '));
      pushLog(st, truth ? st.names[i] + ' зря не поверил — забирает базар (' + wasPile + ' карт)'
        : st.names[p.by] + ' попался — забирает базар (' + wasPile + ' карт)');
      st.pending = null;
      st.rank = 0;
      st.phase = 'place';
      st.turn = (taker + 1) % st.n;
      cheatWin(st);
      return;
    }
    throw new Error('Неизвестное действие');
  },
  done(st) { return st.over; },
  turn(st) { return st.over ? -1 : st.turn; },
  payouts(st, bet) {
    const out = st.names.map(() => 0);
    if (st.winner >= 0) out[st.winner] = bet * st.n;
    else for (let i = 0; i < st.n; i++) out[i] = bet;
    return out;
  }
};
function cheatWin(st) {
  for (let i = 0; i < st.n; i++) {
    if (!st.hands[i].length) {
      st.over = true; st.winner = i;
      pushLog(st, '🏆 ' + st.names[i] + ' скинул все карты и победил');
      return;
    }
  }
  if (!st.over) {
    /* страховка от зависания: если у всех пусто — не бывает, но на всякий случай */
  }
}

/* ============================================================
   Дурак (подкидной) — 2–4 игрока
   36 карт, козырь — нижняя карта колоды. Первый скинул все
   карты (когда колода пуста) — забирает банк.
   ============================================================ */
function beats(d, a, trump) {
  if (!d || !a) return false;
  if (d.s === a.s) return V(d.r) > V(a.r);
  return d.s === trump && a.s !== trump;
}
const durak = {
  key: 'durak', title: 'Дурак', min: 2, max: 4, auto: false,
  make(names, rnd) {
    const st = {
      n: names.length, names: names.slice(), hand: names.map(() => []),
      deck: shuffle(deck36(), rnd), trump: '', table: [], discard: [], round: 1,
      attacker: 0, defender: 1, phase: 'attack', over: false, winner: -1, log: []
    };
    st.trump = st.deck[0] ? st.deck[0].s : '♠';
    for (let k = 0; k < 6; k++) for (let i = 0; i < st.n; i++) if (st.deck.length) st.hand[i].push(st.deck.pop());
    st.hand.forEach(h => h.sort(cmpCard));
    /* первым атакует тот, у кого младший козырь */
    let first = -1, low = 99;
    for (let i = 0; i < st.n; i++) for (const c of st.hand[i]) if (c.s === st.trump && V(c.r) < low) { low = V(c.r); first = i; }
    if (first < 0) first = 0;
    st.attacker = first;
    st.defender = durakNext(st, first);
    pushLog(st, 'Козырь: ' + st.trump + '. Атакует ' + st.names[st.attacker] + ', отбивается ' + st.names[st.defender]);
    return st;
  },
  view(st, i) {
    const undef = st.table.filter(p => !p.d).length;
    const ranks = new Set(st.table.map(p => p.a.r));
    const dHand = st.hand[st.defender] ? st.hand[st.defender].length : 0;
    const canAttackFirst = !st.over && st.phase === 'attack' && !st.table.length && i === st.attacker;
    const canAdd = !st.over && st.phase === 'attack' && st.table.length > 0 && i !== st.defender &&
      undef < 6 && undef < dHand && st.hand[i].some(c => ranks.has(c.r));
    const allBeaten = st.table.length > 0 && undef === 0;
    const canTransfer = !st.over && st.phase === 'defend' && i === st.defender && st.table.length > 0 &&
      st.table.every(p => !p.d) && st.hand[i].some(c => c.r === st.table[0].a.r) &&
      st.table.every(p => p.a.r === st.table[0].a.r);
    return {
      game: 'durak', trump: st.trump, deck: st.deck.length, discard: st.discard.length,
      table: st.table.map(p => ({ a: p.a, d: p.d || null })),
      hand: st.hand[i].slice(), counts: st.hand.map(h => h.length), out: st.hand.map((h, k) => !h.length && !st.deck.length),
      attacker: st.attacker, defender: st.defender, phase: st.phase, round: st.round,
      over: st.over, winner: st.winner, log: st.log.slice(-14),
      can: {
        attack: canAttackFirst || canAdd,
        add: canAdd, first: canAttackFirst,
        defend: !st.over && st.phase === 'defend' && i === st.defender && undef > 0,
        take: !st.over && st.phase === 'defend' && i === st.defender && undef > 0,
        pass: !st.over && st.phase === 'attack' && i === st.attacker && allBeaten,
        transfer: canTransfer
      }
    };
  },
  act(st, i, m) {
    if (st.over) throw new Error('Игра уже закончена');
    const act = m && m.act;
    if (act === 'attack' || act === 'add') {
      if (st.phase !== 'attack') throw new Error('Сначала отбейтесь');
      if (i === st.defender) throw new Error('Защищающийся не подкидывает');
      const idx = Math.floor(Number(m.card));
      if (!(idx >= 0 && idx < st.hand[i].length)) throw new Error('Такой карты нет');
      const c = st.hand[i][idx];
      const undef = st.table.filter(p => !p.d).length;
      if (!st.table.length) {
        if (i !== st.attacker) throw new Error('Первую карту кладёт атакующий');
      } else {
        const ranks = new Set(st.table.map(p => p.a.r));
        if (!ranks.has(c.r)) throw new Error('Подкидывать можно только то, что уже на столе');
        if (undef >= 6) throw new Error('Больше 6 карт за раз не подкидывают');
        if (undef >= st.hand[st.defender].length) throw new Error('У защищающегося не хватит карт');
      }
      st.hand[i].splice(idx, 1);
      st.table.push({ a: c, d: null });
      st.phase = 'defend';
      pushLog(st, st.names[i] + ' подкидывает ' + c.r + c.s);
      durakOut(st);
      return;
    }
    if (act === 'transfer') {
      if (st.phase !== 'defend' || i !== st.defender) throw new Error('Переводить может только защищающийся');
      if (!st.table.length || st.table.some(p => p.d)) throw new Error('Переводить можно только до отбоя');
      const r = st.table[0].a.r;
      if (!st.table.every(p => p.a.r === r)) throw new Error('Перевод только когда все карты одного достоинства');
      const idx = Math.floor(Number(m.card));
      if (!(idx >= 0 && idx < st.hand[i].length) || st.hand[i][idx].r !== r) throw new Error('Нужна карта того же достоинства');
      const nd = durakNext(st, i);
      if (nd === i) throw new Error('Переводить не на кого');
      const c = st.hand[i].splice(idx, 1)[0];
      st.table.push({ a: c, d: null });
      st.attacker = i;
      st.defender = nd;
      pushLog(st, st.names[st.attacker] + ' переводит на ' + st.names[st.defender] + ' картой ' + c.r + c.s);
      st.phase = 'defend';
      durakOut(st);
      return;
    }
    if (act === 'defend') {
      if (st.phase !== 'defend' || i !== st.defender) throw new Error('Отбивается защищающийся');
      const und = st.table.filter(p => !p.d);
      if (!und.length) throw new Error('Нечего отбивать');
      const idx = Math.floor(Number(m.card));
      if (!(idx >= 0 && idx < st.hand[i].length)) throw new Error('Такой карты нет');
      const c = st.hand[i][idx];
      const target = und[und.length - 1];
      if (!beats(c, target.a, st.trump)) throw new Error('Эта карта не бьёт ' + target.a.r + target.a.s);
      st.hand[i].splice(idx, 1);
      target.d = c;
      pushLog(st, st.names[i] + ' отбивает ' + target.a.r + target.a.s + ' картой ' + c.r + c.s);
      if (!st.table.filter(p => !p.d).length) st.phase = 'attack';   /* все отбито — можно подкидывать или сказать «бито» */
      durakOut(st);
      return;
    }
    if (act === 'take') {
      if (st.phase !== 'defend' || i !== st.defender) throw new Error('Взять может только защищающийся');
      if (!st.table.filter(p => !p.d).length) throw new Error('Все карты уже отбиты');
      pushLog(st, st.names[i] + ' берёт');
      durakEnd(st, true);
      return;
    }
    if (act === 'pass') {
      if (st.phase !== 'attack' || i !== st.attacker) throw new Error('«Бито» говорит атакующий');
      if (!st.table.length || st.table.filter(p => !p.d).length) throw new Error('Сначала отбейте все карты');
      pushLog(st, 'Бито');
      durakEnd(st, false);
      return;
    }
    throw new Error('Неизвестное действие');
  },
  done(st) { return st.over; },
  turn(st) { return st.over ? -1 : (st.phase === 'defend' ? st.defender : st.attacker); },
  payouts(st, bet) {
    const out = st.names.map(() => 0);
    if (st.winner >= 0) out[st.winner] = bet * st.n;
    else for (let i = 0; i < st.n; i++) out[i] = bet;
    return out;
  }
};
function cmpCard(a, b) { return V(a.r) - V(b.r) || SUITS.indexOf(a.s) - SUITS.indexOf(b.s); }
function durakNext(st, from) {
  for (let k = 1; k <= st.n; k++) {
    const i = (from + k) % st.n;
    if (st.hand[i].length || st.deck.length) return i;
  }
  return from;
}
function durakRefill(st) {
  const order = [];
  for (let k = 0; k < st.n; k++) order.push((st.attacker + k) % st.n);
  if (st.defender >= 0) { const k = order.indexOf(st.defender); if (k >= 0) { order.splice(k, 1); order.push(st.defender); } }
  for (const i of order) while (st.hand[i].length < 6 && st.deck.length) st.hand[i].push(st.deck.pop());
  for (const i of order) st.hand[i].sort(cmpCard);
}
function durakOut(st) {
  /* кто-то мог выйти (0 карт и пустая колода) — он и победил */
  for (let i = 0; i < st.n; i++) {
    if (!st.hand[i].length && !st.deck.length) {
      st.over = true; st.winner = i;
      pushLog(st, '🏆 ' + st.names[i] + ' скинул все карты и победил');
      return;
    }
  }
}
function durakEnd(st, took) {
  if (took) {
    for (const p of st.table) { st.hand[st.defender].push(p.a); if (p.d) st.hand[st.defender].push(p.d); }
  } else {
    for (const p of st.table) { st.discard.push(p.a); if (p.d) st.discard.push(p.d); }
  }
  st.table = [];
  st.attacker = took ? durakNext(st, st.defender) : st.defender;
  st.defender = durakNext(st, st.attacker);
  durakRefill(st);
  st.round++;
  st.phase = 'attack';
  durakOut(st);
  if (!st.over && st.round > 120) {
    /* слишком долго: побеждает тот, у кого меньше карт, если это один игрок */
    st.over = true;
    let best = -1, tie = false;
    for (let i = 0; i < st.n; i++) if (best < 0 || st.hand[i].length < st.hand[best].length) best = i;
    for (let i = 0; i < st.n; i++) if (i !== best && st.hand[i].length === st.hand[best].length) tie = true;
    st.winner = tie ? -1 : best;
    pushLog(st, 'Слишком долго — побеждает тот, у кого меньше карт');
  }
}

/* ============================================================
   Блэкджек на 2–4 игрока
   Все покупаются на ставку стола, по 2 карты, по очереди берут
   или останавливаются. Кто ближе к 21, но не перебрал — забирает
   банк; «блэкджек» с двух карт сильнее обычных 21.
   ============================================================ */
const R52 = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS52 = ['♠', '♥', '♦', '♣'];
function deck52() { const d = []; for (const s of SUITS52) for (const r of R52) d.push({ r: r, s: s }); return d; }
function handTotal(h) {
  let t = 0, aces = 0;
  for (const c of h) { if (c.r === 'A') { aces++; t += 11; } else if ('JQK'.includes(c.r)) t += 10; else t += +c.r; }
  while (t > 21 && aces) { t -= 10; aces--; }
  return t;
}
const isNatural = h => h.length === 2 && handTotal(h) === 21;
function bjFinish(st) {
  st.over = true; st.turn = -1;
  const totals = st.hands.map(handTotal);
  let best = -1, winners = [];
  for (let i = 0; i < st.n; i++) {
    if (st.bust[i] || totals[i] > 21) continue;
    const nat = isNatural(st.hands[i]);
    if (best < 0 || totals[i] > best) { best = totals[i]; winners = [i]; }
    else if (totals[i] === best) {
      if (nat && !isNatural(st.hands[winners[0]])) winners = [i];
      else if (nat === isNatural(st.hands[winners[0]])) winners.push(i);
    }
  }
  st.winners = winners;
  st.results = st.hands.map((h, i) => ({ total: totals[i], bust: st.bust[i], natural: isNatural(h), win: winners.indexOf(i) >= 0 }));
  pushLog(st, winners.length ? '🏆 ' + winners.map(i => st.names[i] + ' (' + totals[i] + ')').join(', ') + ' забирает банк'
    : 'Никто не устоял — ставки возвращаются');
}
const bj = {
  key: 'bj', title: 'Блэкджек', min: 2, max: 4, auto: false,
  make(names, rnd) {
    const st = { n: names.length, names: names.slice(), hands: names.map(() => []), deck: shuffle(deck52(), rnd), stood: names.map(() => false), bust: names.map(() => false), turn: 0, over: false, winners: [], results: null, log: [] };
    for (let k = 0; k < 2; k++) for (let i = 0; i < st.n; i++) st.hands[i].push(st.deck.pop());
    pushLog(st, 'Карты сданы');
    let first = -1;
    for (let i = 0; i < st.n; i++) {
      if (isNatural(st.hands[i])) { st.stood[i] = true; pushLog(st, st.names[i] + ': блэкджек с двух карт!'); }
      else if (first < 0) first = i;
    }
    if (first < 0) bjFinish(st); else st.turn = first;
    return st;
  },
  view(st, i) {
    const t = handTotal(st.hands[i]);
    const open = st.over;
    return {
      game: 'bj', hand: st.hands[i].slice(), total: t, stood: st.stood[i], bust: st.bust[i],
      players: st.hands.map((h, k) => ({ count: h.length, cards: open ? h.slice() : null, total: (open || k === i || st.stood[k] || st.bust[k]) ? handTotal(h) : null, stood: st.stood[k], bust: st.bust[k], natural: isNatural(h), win: (st.winners || []).indexOf(k) >= 0 })),
      turn: st.turn, over: st.over, winners: (st.winners || []).slice(), results: st.results, log: st.log.slice(-12),
      can: { hit: !st.over && st.turn === i && !st.stood[i], stand: !st.over && st.turn === i && !st.stood[i] }
    };
  },
  act(st, i, m) {
    if (st.over) throw new Error('Раздача уже закончена');
    if (st.turn !== i) throw new Error('Сейчас не ваш ход');
    const act = m && m.act;
    if (act === 'hit') {
      st.hands[i].push(st.deck.pop());
      const t = handTotal(st.hands[i]);
      pushLog(st, st.names[i] + ': берёт — ' + t);
      if (t > 21) { st.bust[i] = true; pushLog(st, st.names[i] + ': перебор'); return bjAdvance(st, i); }
      if (t === 21) { st.stood[i] = true; return bjAdvance(st, i); }
      return;
    }
    if (act === 'stand') {
      st.stood[i] = true;
      pushLog(st, st.names[i] + ': стоп (' + handTotal(st.hands[i]) + ')');
      return bjAdvance(st, i);
    }
    throw new Error('Неизвестное действие');
  },
  done(st) { return st.over; },
  turn(st) { return st.over ? -1 : st.turn; },
  payouts(st, bet) {
    const out = st.names.map(() => 0);
    const win = (st.winners || []).filter(i => !st.bust[i]);
    if (!win.length) { for (let i = 0; i < st.n; i++) out[i] = bet; return out; }
    const pot = bet * st.n, share = Math.floor(pot / win.length);
    let rem = pot - share * win.length;
    for (const i of win) out[i] = share + (rem-- > 0 ? 1 : 0);
    return out;
  }
};
function bjAdvance(st, from) {
  if (st.over) return;
  for (let k = 1; k <= st.n; k++) {
    const j = (from + k) % st.n;
    if (!st.stood[j] && !st.bust[j]) { st.turn = j; return; }
  }
  bjFinish(st);
}

module.exports = {
  war: war, cheat: cheat, durak: durak, bj: bj,
  deck36: deck36, deck52: deck52, shuffle: shuffle, SUITS: SUITS, R36: R36, R52: R52,
  V: V, isRed: isRed, handTotal: handTotal, isNatural: isNatural
};
