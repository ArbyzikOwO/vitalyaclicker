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
/* одна шкала достоинств для колод 36 и 52: 2 = 2 … 14 = туз */
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const V = r => RANKS.indexOf(r) + 2;
const isRed = c => c.s === '♥' || c.s === '♦';
function deck36() { const d = []; for (const s of SUITS) for (const r of R36) d.push({ r: r, s: s }); return d; }
function shuffle(a, rnd) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function pushLog(st, text) { st.log.push(text); if (st.log.length > 60) st.log.splice(0, st.log.length - 60); }

/* ============================================================
   Пьяница — 2–4 игрока, ручная
   Раунд за раундом игроки сами открывают верхнюю карту; старшая
   забирает весь базар. Равные старшие карты спорят дальше, пока
   не останется один. Побеждает тот, кто собрал все карты. Если за
   WAR_MAX_ROUNDS раундов карты не разошлись — финальная битва:
   по одной карте от каждого, старшая забирает банк.
   ============================================================ */
const WAR_MAX_ROUNDS = 50;

function warAlive(st) {
  const a = [];
  for (let i = 0; i < st.n; i++) if (st.hands[i].length) a.push(i);
  return a;
}
/* кто обязан открыть карту в этом раунде: спорщики, а если их нет — все живые */
function warPool(st) {
  const alive = warAlive(st);
  if (alive.length <= 1) return alive;
  let pool = st.tied.filter(i => st.hands[i].length);
  if (!pool.length) { pool = alive; st.tied = []; }
  return pool;
}
function warTakePile(st, i) {
  if (!st.pile.length) return;
  st.hands[i].push.apply(st.hands[i], st.pile);
  pushLog(st, st.names[i] + ' забирает базар (' + st.pile.length + ' карт)');
  st.pile = []; st.tied = [];
}
function warCard(c) { return c.r + c.s; }
/* начать новый раунд (или финальную битву, или закончить игру) */
function warBegin(st) {
  st.drawn = []; st.opened = st.names.map(() => false); st.last = null; st.phase = 'reveal';
  if (st.rounds >= WAR_MAX_ROUNDS) { st.final = true; st.pool = warAlive(st); return; }
  st.final = false;
  let guard = 0;
  for (;;) {
    const alive = warAlive(st);
    if (alive.length <= 1) {
      if (alive.length === 1) { warTakePile(st, alive[0]); pushLog(st, '🏆 ' + st.names[alive[0]] + ' собрал(а) все карты'); }
      st.over = true; st.winners = alive; st.phase = 'result'; st.pool = alive;
      return;
    }
    st.pool = warPool(st);
    if (st.pool.length > 1) return;
    warTakePile(st, st.pool[0]);          /* единственный претендент забирает базар */
    if (guard++ > 4) return;
  }
}
function warDraw(st, i) {
  const c = st.hands[i].pop();
  st.drawn.push({ i: i, c: c });
  st.pile.push(c);
  st.opened[i] = true;
}
function warResolve(st) {
  const best = Math.max.apply(null, st.drawn.map(d => V(d.c.r)));
  const top = st.drawn.filter(d => V(d.c.r) === best).map(d => d.i);
  const list = st.drawn.map(d => ({ i: d.i, c: d.c }));
  st.rounds++;
  if (st.final) {
    st.over = true; st.winners = top.slice(); st.phase = 'result';
    pushLog(st, '🏁 Финальная битва: ' + list.map(d => st.names[d.i] + ' ' + warCard(d.c)).join(', ') +
      (top.length > 1 ? ' — ничья, банк делится между ' + top.map(i => st.names[i]).join(', ')
        : ' — банк забирает ' + st.names[top[0]]));
  } else if (top.length === 1) {
    const w = top[0];
    pushLog(st, 'Раунд ' + st.rounds + ': ' + list.map(d => st.names[d.i] + ' ' + warCard(d.c)).join(', ') + ' — забирает ' + st.names[w]);
    warTakePile(st, w);
    st.phase = 'result';
  } else {
    st.tied = top.slice();
    st.phase = 'result';
    pushLog(st, 'Раунд ' + st.rounds + ': спор ' + top.map(i => st.names[i]).join(', ') + ' — базар растёт (' + st.pile.length + ' карт)');
  }
  st.last = {
    list: list, top: top.slice(), tie: top.length > 1 && !st.final, final: !!st.final,
    took: (!st.final && top.length === 1) ? top[0] : -1, pile: st.pile.length
  };
  if (st.over) return;
  const alive = warAlive(st);
  if (alive.length <= 1) {
    if (alive.length === 1) { warTakePile(st, alive[0]); pushLog(st, '🏆 ' + st.names[alive[0]] + ' собрал(а) все карты'); }
    st.over = true; st.winners = alive;
  }
}
const war = {
  key: 'war', title: 'Пьяница', min: 2, max: 4, auto: false,
  make(names, rnd) {
    const st = {
      n: names.length, names: names.slice(), hands: names.map(() => []),
      pile: [], tied: [], drawn: [], opened: names.map(() => false), pool: [],
      rounds: 0, phase: 'reveal', final: false, last: null,
      over: false, winners: [], log: []
    };
    const d = shuffle(deck36(), rnd);
    d.forEach((c, i) => st.hands[i % st.n].push(c));
    pushLog(st, 'Карты сданы: по ' + st.hands[0].length + ' каждому');
    pushLog(st, 'Открывайте верхнюю карту — старшая забирает весь базар');
    warBegin(st);
    return st;
  },
  view(st, i) {
    return {
      game: 'war', phase: st.phase, final: !!st.final,
      round: st.rounds, maxRounds: WAR_MAX_ROUNDS,
      counts: st.hands.map(h => h.length),
      pile: st.pile.length, tied: st.tied.slice(),
      drawn: st.drawn.map(d => ({ i: d.i, c: d.c })),
      opened: st.opened.slice(), pool: st.pool.slice(), last: st.last,
      canOpen: !st.over && st.phase === 'reveal' && st.pool.indexOf(i) >= 0 && !st.opened[i] && !!(st.hands[i] && st.hands[i].length),
      canNext: !st.over && st.phase === 'result',
      canFast: !st.over,
      over: st.over, winner: (st.winners && st.winners.length === 1) ? st.winners[0] : -1,
      winners: (st.winners || []).slice(), log: st.log.slice(-40)
    };
  },
  act(st, i, m) {
    if (st.over) throw new Error('Партия уже закончена');
    const act = m && m.act;
    if (act === 'open') {
      if (st.phase !== 'reveal') throw new Error('Сейчас не время открывать карты');
      if (st.opened[i]) throw new Error('Вы уже открыли карту');
      if (st.pool.indexOf(i) < 0) throw new Error('Вы не участвуете в этом раунде');
      if (!st.hands[i].length) throw new Error('У вас нет карт');
      warDraw(st, i);
      if (st.drawn.length >= st.pool.length) warResolve(st);
      return;
    }
    if (act === 'next') {
      if (st.phase !== 'result') throw new Error('Раунд ещё не разыгран');
      warBegin(st);
      return;
    }
    if (act === 'fast') {                     /* доиграть всё разом */
      let guard = 0;
      while (!st.over && guard++ < 5000) {
        if (st.phase === 'reveal') {
          const k = st.pool.filter(x => !st.opened[x] && st.hands[x].length)[0];
          if (k == null) break;
          warDraw(st, k);
          if (st.drawn.length >= st.pool.length) warResolve(st);
        } else warBegin(st);
      }
      st.phase = 'result';
      if (!st.over) { st.over = true; st.winners = []; }
      return;
    }
    throw new Error('Неизвестное действие');
  },
  done(st) { return st.over; },
  turn(st) {
    if (st.over) return -1;
    if (st.phase === 'result') {
      const t = st.last && st.last.took >= 0 ? st.last.took : -1;
      if (t >= 0) return t;
      const k = st.pool.filter(i => st.hands[i] && st.hands[i].length)[0];
      if (k != null) return k;
      const alive = warAlive(st);
      return alive.length ? alive[0] : -1;
    }
    const k = st.pool.filter(i => !st.opened[i] && st.hands[i].length)[0];
    return k == null ? -1 : k;
  },
  /* игрок покинул партию: его карты уходят из игры, ставка не возвращается */
  leave(st, i) {
    if (st.over) return;
    for (let k = st.drawn.length - 1; k >= 0; k--) {
      if (st.drawn[k].i === i) {
        const idx = st.pile.lastIndexOf(st.drawn[k].c);
        if (idx >= 0) st.pile.splice(idx, 1);
        st.drawn.splice(k, 1);
      }
    }
    st.hands[i] = [];
    st.opened[i] = true;
    st.tied = st.tied.filter(x => x !== i);
    st.pool = st.pool.filter(x => x !== i);
    pushLog(st, '🚪 ' + st.names[i] + ' покинул(а) партию');
    const alive = warAlive(st);
    if (alive.length <= 1) {
      if (alive.length === 1) { warTakePile(st, alive[0]); pushLog(st, '🏆 ' + st.names[alive[0]] + ' собрал(а) все карты'); }
      st.over = true; st.winners = alive.slice(); st.phase = 'result'; st.pool = alive.slice();
      return;
    }
    warBegin(st);
  },
  /* итог показываем всем, а дальше раунд идёт сам — иначе никто не нажмёт «Дальше» */
  delay(st, def) { return st.phase === 'result' ? 4000 : def; },
  payouts(st, bet) {
    const out = st.names.map(() => 0);
    const w = (st.winners || []).filter(i => i >= 0 && i < st.n);
    if (w.length === 1) { out[w[0]] = bet * st.n; return out; }
    if (w.length > 1) {
      const total = bet * st.n, base = Math.floor(total / w.length);
      let rem = total - base * w.length;
      for (const i of w) { out[i] = base + (rem > 0 ? 1 : 0); if (rem > 0) rem--; }
      return out;
    }
    for (let i = 0; i < st.n; i++) out[i] = bet;   /* ничья/тупик — возврат */
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
      out: names.map(() => false), over: false, winner: -1, log: []
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
    const canPlace = !st.over && !st.out[i] && st.phase === 'place' && st.turn === i;
    const canAns = !st.over && !st.out[i] && st.phase === 'challenge' && st.turn === i;
    return {
      game: 'cheat', rank: R36[st.rank], turn: st.turn, phase: st.phase, pile: st.pile.length,
      counts, hand: st.hands[i].slice(), out: st.out.slice(), over: st.over, winner: st.winner, log: st.log.slice(-14),
      pending: p ? { by: p.by, byName: st.names[p.by], count: p.cards.length, rank: p.rank } : null,
      can: { place: canPlace, believe: canAns, doubt: canAns, quit: !st.over && !st.out[i] }
    };
  },
  act(st, i, m) {
    if (st.over) throw new Error('Игра уже закончена');
    if (st.out[i]) throw new Error('Вы уже вышли из партии');
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
      st.turn = cheatNext(st, taker);
      cheatWin(st);
      return;
    }
    throw new Error('Неизвестное действие');
  },
  done(st) { return st.over; },
  turn(st) {
    if (st.over) return -1;
    return st.out[st.turn] ? -1 : st.turn;
  },
  /* игрок покинул партию: его карты уходят, ставка не возвращается */
  leave(st, i) {
    if (st.over || st.out[i]) return;
    st.out[i] = true;
    st.hands[i] = [];
    pushLog(st, '🚪 ' + st.names[i] + ' покинул(а) партию');
    if (st.pending && (st.pending.by === i || (st.phase === 'challenge' && st.turn === i))) {
      st.pile.push.apply(st.pile, st.pending.cards);
      st.pending = null; st.phase = 'place';
      st.rank = (st.rank + 1) % R36.length;
      st.turn = cheatNext(st, i);
    } else if (st.phase === 'place' && st.turn === i) {
      st.turn = cheatNext(st, i);
    }
    cheatEnd(st);
  },
  payouts(st, bet) {
    const out = st.names.map(() => 0);
    if (st.winner >= 0) out[st.winner] = bet * st.n;
    else for (let i = 0; i < st.n; i++) out[i] = bet;
    return out;
  }
};
function cheatNext(st, from) {
  for (let k = 1; k <= st.n; k++) { const i = (from + k) % st.n; if (!st.out[i]) return i; }
  return from;
}
/* партия кончается, когда в игре остался один */
function cheatEnd(st) {
  if (st.over) return;
  const alive = [];
  for (let i = 0; i < st.n; i++) if (!st.out[i]) alive.push(i);
  if (alive.length > 1) return;
  st.over = true;
  st.winner = alive.length === 1 ? alive[0] : -1;
  if (st.winner >= 0) pushLog(st, '🏆 ' + st.names[st.winner] + ' остался(ась) последним(ей) — победа');
}
function cheatWin(st) {
  for (let i = 0; i < st.n; i++) {
    if (st.out[i]) continue;
    if (!st.hands[i].length) {
      st.over = true; st.winner = i;
      pushLog(st, '🏆 ' + st.names[i] + ' скинул(а) все карты и победил(а)');
      return;
    }
  }
}

/* ============================================================
   Дурак (подкидной / переводной) — 2–6 игроков.
   Настройки стола (передаются в make третьим аргументом):
     deck     36 | 52  — колода (36 карт → до 4 игроков, 52 → до 6);
     transfer true     — «переводной»: защитник переводит карту дальше;
     toEnd    true     — доигрывать до последнего дурака (иначе партия
                         заканчивается сразу, как только кто-то вышел).
   По 6 карт, козырь — нижняя карта колоды. Подкидывать можно карты того
   достоинства, что уже на столе (не больше 6 неотбитых и не больше, чем
   карт у защищающегося). Кто при пустой колоде скинул все карты — вышел
   из игры; последний оставшийся — дурак. Победитель (первый вышедший)
   забирает банк.
   ============================================================ */
const DURAK_DEF = { deck: 36, transfer: true, toEnd: true };
function beats(d, a, trump) {
  if (!d || !a) return false;
  if (d.s === a.s) return V(d.r) > V(a.r);
  return d.s === trump && a.s !== trump;
}
const durak = {
  key: 'durak', title: 'Дурак', min: 2, max: 6, auto: false,
  /* сколько игроков влезает: 36 карт — 4, 52 — 6 */
  maxFor(o) { return (o && Number(o.deck) === 52) ? 6 : 4; },
  make(names, rnd, opts) {
    const o = Object.assign({}, DURAK_DEF, opts || {});
    o.deck = Number(o.deck) === 52 ? 52 : 36;
    o.transfer = o.transfer !== false;
    o.toEnd = o.toEnd !== false;
    const st = {
      n: names.length, names: names.slice(), hand: names.map(() => []),
      deck: shuffle(o.deck === 52 ? deck52() : deck36(), rnd), trump: '',
      table: [], discard: [], round: 1, opts: o,
      attacker: 0, defender: 1, phase: 'attack', over: false, winner: -1, durak: -1,
      out: names.map(() => false), finished: [], log: []
    };
    st.trump = st.deck.length ? st.deck[0].s : '♠';
    for (let k = 0; k < 6; k++) for (let i = 0; i < st.n; i++) if (st.deck.length) st.hand[i].push(st.deck.pop());
    st.hand.forEach(h => h.sort(cmpCard));
    /* первым атакует тот, у кого младший козырь */
    let first = -1, low = 99;
    for (let i = 0; i < st.n; i++) for (const c of st.hand[i]) if (c.s === st.trump && V(c.r) < low) { low = V(c.r); first = i; }
    if (first < 0) first = 0;
    st.attacker = first;
    st.defender = durakNext(st, first);
    pushLog(st, 'Козырь: ' + st.trump + ' · колода ' + (o.deck === 52 ? '52' : '36') + ' · ' +
      (o.transfer ? 'переводной' : 'без перевода') + '. Атакует ' + st.names[st.attacker] +
      ', отбивается ' + st.names[st.defender]);
    return st;
  },
  view(st, i) {
    const undef = st.table.filter(p => !p.d).length;
    const ranks = new Set(st.table.map(p => p.a.r));
    const dHand = st.hand[st.defender] ? st.hand[st.defender].length : 0;
    const me = !st.over && !st.out[i];
    const canAttackFirst = me && st.phase === 'attack' && !st.table.length && i === st.attacker;
    const canAdd = me && st.phase === 'attack' && st.table.length > 0 && i !== st.defender &&
      undef < 6 && undef < dHand && st.hand[i].some(c => ranks.has(c.r));
    const allBeaten = st.table.length > 0 && undef === 0;
    const canTransfer = me && !!st.opts.transfer && st.phase === 'defend' && i === st.defender && st.table.length > 0 &&
      st.table.every(p => !p.d) && st.hand[i].some(c => c.r === st.table[0].a.r) &&
      st.table.every(p => p.a.r === st.table[0].a.r);
    return {
      game: 'durak', trump: st.trump, deck: st.deck.length, discard: st.discard.length,
      deckSize: st.opts.deck, transfer: !!st.opts.transfer, toEnd: !!st.opts.toEnd,
      table: st.table.map(p => ({ a: p.a, d: p.d || null })),
      hand: st.hand[i].slice(), counts: st.hand.map(h => h.length), out: st.out.slice(),
      finished: st.finished.slice(), durak: st.durak,
      attacker: st.attacker, defender: st.defender, phase: st.phase, round: st.round,
      over: st.over, winner: st.winner, log: st.log.slice(-14),
      can: {
        attack: canAttackFirst || canAdd,
        add: canAdd, first: canAttackFirst,
        defend: me && st.phase === 'defend' && i === st.defender && undef > 0,
        take: me && st.phase === 'defend' && i === st.defender && undef > 0,
        pass: me && st.phase === 'attack' && i === st.attacker && allBeaten,
        transfer: canTransfer,
        quit: !st.over && !st.out[i]
      }
    };
  },
  act(st, i, m) {
    if (st.over) throw new Error('Игра уже закончена');
    if (st.out[i]) throw new Error('Вы уже вышли из игры — скинули все карты');
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
      if (!st.opts.transfer) throw new Error('Перевод отключён в настройках стола');
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
  turn(st) {
    if (st.over) return -1;
    const i = st.phase === 'defend' ? st.defender : st.attacker;
    return (i >= 0 && !st.out[i]) ? i : -1;
  },
  /* игрок покинул партию: его карты уходят в сброс, ставка не возвращается */
  leave(st, i) {
    if (st.over || st.out[i]) return;
    for (const p of st.table) { st.discard.push(p.a); if (p.d) st.discard.push(p.d); }
    st.table = [];
    st.discard.push.apply(st.discard, st.hand[i]); st.hand[i] = [];
    st.out[i] = true;
    pushLog(st, '🚪 ' + st.names[i] + ' покинул(а) партию');
    st.attacker = durakNext(st, i);
    st.defender = durakNext(st, st.attacker);
    st.phase = 'attack';
    durakRefill(st);
    durakOut(st);
  },
  payouts(st, bet) {
    const out = st.names.map(() => 0);
    if (st.winner >= 0) out[st.winner] = bet * st.n;
    else for (let i = 0; i < st.n; i++) out[i] = bet;
    return out;
  }
};
function cmpCard(a, b) { return V(a.r) - V(b.r) || SUITS.indexOf(a.s) - SUITS.indexOf(b.s); }
/* следующий игрок, который ещё в игре (не вышел) и может ходить */
function durakNext(st, from) {
  for (let k = 1; k <= st.n; k++) {
    const i = (from + k) % st.n;
    if (!st.out[i] && (st.hand[i].length || st.deck.length)) return i;
  }
  for (let k = 0; k < st.n; k++) { const i = (from + k) % st.n; if (!st.out[i]) return i; }
  return from;
}
function durakRefill(st) {
  const order = [];
  for (let k = 0; k < st.n; k++) order.push((st.attacker + k) % st.n);
  if (st.defender >= 0) { const k = order.indexOf(st.defender); if (k >= 0) { order.splice(k, 1); order.push(st.defender); } }
  for (const i of order) { if (st.out[i]) continue; while (st.hand[i].length < 6 && st.deck.length) st.hand[i].push(st.deck.pop()); }
  for (const i of order) if (!st.out[i]) st.hand[i].sort(cmpCard);
}
function durakActive(st) { const a = []; for (let i = 0; i < st.n; i++) if (!st.out[i]) a.push(i); return a; }
/* кто вышел из игры — скинул все карты при пустой колоде */
function durakOut(st) {
  if (st.over) return;
  for (let i = 0; i < st.n; i++) {
    if (st.out[i]) continue;
    if (st.hand[i].length || st.deck.length) continue;
    if (i === st.defender && st.table.some(p => !p.d)) continue;   /* защитнику ещё есть что брать */
    st.out[i] = true; st.finished.push(i);
    pushLog(st, '🏁 ' + st.names[i] + ' скинул(а) все карты и вышел(ла) из игры');
    if (st.attacker === i) st.attacker = durakNext(st, i);
    if (st.defender === i) st.defender = durakNext(st, st.attacker);
    if (!st.opts.toEnd) {
      st.over = true; st.winner = i; st.durak = -1;
      pushLog(st, '🏆 ' + st.names[i] + ' победил(а) — забирает банк');
      return;
    }
  }
  durakCheckEnd(st);
}
/* партия кончается, когда в игре остаётся один — он и есть дурак */
function durakCheckEnd(st) {
  if (st.over) return;
  const act = durakActive(st);
  if (act.length > 1) return;
  st.over = true;
  st.durak = act.length === 1 ? act[0] : -1;
  st.winner = st.finished.length ? st.finished[0] : (act.length === 1 ? act[0] : -1);
  if (st.finished.length) pushLog(st, '🏆 ' + st.names[st.finished[0]] + ' вышел(ла) первым(ой) — забирает банк');
  if (st.durak >= 0) pushLog(st, '🃏 Дурак: ' + st.names[st.durak]);
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
    /* слишком долго: побеждает вышедший первым, иначе — у кого меньше карт */
    st.over = true;
    let best = -1, tie = false;
    for (const i of durakActive(st)) if (best < 0 || st.hand[i].length < st.hand[best].length) best = i;
    for (const i of durakActive(st)) if (i !== best && st.hand[i].length === st.hand[best].length) tie = true;
    st.winner = st.finished.length ? st.finished[0] : (tie ? -1 : best);
    pushLog(st, 'Слишком долго — партия остановлена');
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
    if (st.out && st.out[i]) continue;
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
    const st = { n: names.length, names: names.slice(), hands: names.map(() => []), deck: shuffle(deck52(), rnd), stood: names.map(() => false), bust: names.map(() => false), out: names.map(() => false), turn: 0, over: false, winners: [], results: null, log: [] };
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
      players: st.hands.map((h, k) => ({ count: h.length, cards: open ? h.slice() : null, total: (open || k === i || st.stood[k] || st.bust[k]) ? handTotal(h) : null, stood: st.stood[k], bust: st.bust[k], out: !!(st.out && st.out[k]), natural: isNatural(h), win: (st.winners || []).indexOf(k) >= 0 })),
      turn: st.turn, over: st.over, winners: (st.winners || []).slice(), results: st.results, log: st.log.slice(-12),
      can: { hit: !st.over && st.turn === i && !st.stood[i], stand: !st.over && st.turn === i && !st.stood[i], quit: !st.over && !(st.out && st.out[i]) }
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
  turn(st) {
    if (st.over) return -1;
    return (st.out && st.out[st.turn]) ? -1 : st.turn;
  },
  /* игрок покинул раздачу: ставка не возвращается */
  leave(st, i) {
    if (st.over) return;
    if (!st.out) st.out = st.names.map(() => false);
    if (st.out[i]) return;
    st.out[i] = true;
    pushLog(st, '🚪 ' + st.names[i] + ' покинул(а) раздачу');
    if (st.turn === i) { bjAdvance(st, i); return; }
    let active = 0;
    for (let k = 0; k < st.n; k++) if (!st.stood[k] && !st.bust[k] && !st.out[k]) active++;
    if (!active) bjFinish(st);
  },
  payouts(st, bet) {
    const out = st.names.map(() => 0);
    const gone = i => !!(st.out && st.out[i]);
    const win = (st.winners || []).filter(i => !st.bust[i] && !gone(i));
    if (!win.length) {
      /* никто не выиграл: возвращаем тем, кто не вышел сам */
      const alive = [];
      for (let i = 0; i < st.n; i++) if (!gone(i)) alive.push(i);
      const list = alive.length ? alive : st.names.map((_, k) => k);
      const total = bet * st.n, base = Math.floor(total / list.length);
      let rem = total - base * list.length;
      for (const i of list) { out[i] = base + (rem-- > 0 ? 1 : 0); }
      return out;
    }
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
    if (!st.stood[j] && !st.bust[j] && !(st.out && st.out[j])) { st.turn = j; return; }
  }
  bjFinish(st);
}

module.exports = {
  war: war, cheat: cheat, durak: durak, bj: bj,
  deck36: deck36, deck52: deck52, shuffle: shuffle, SUITS: SUITS, R36: R36, R52: R52,
  V: V, isRed: isRed, handTotal: handTotal, isNatural: isNatural
};
