'use strict';
/* =====================================================================
   poker.js — Техасский холдем (2–6 игроков), чистая логика.
   Каждый покупается на ставку стола (buy = стек в фишках), блайнды
   маленький/большой = buy/100 и buy/50. Улицы: префлоп, флоп, тёрн,
   ривер, вскрытие. Есть олл-ины и побочные банки, поэтому выплаты
   всегда сходятся: сколько фишек было на столе — столько и вернётся.

   Интерфейс как у других игр в cards.js:
     make(names, buy, rnd), view(st, i), act(st, i, m), done(st),
     turn(st), payouts(st, buy)  — что вернуть каждому игроку.
   ===================================================================== */
const SUITS = ['♠', '♥', '♦', '♣'];
const R52 = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RV = r => R52.indexOf(r) + 2;
function deck52() { const d = []; for (const s of SUITS) for (const r of R52) d.push({ r: r, s: s }); return d; }
function shuffle(a, rnd) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function pushLog(st, text) { st.log.push(text); if (st.log.length > 50) st.log.splice(0, st.log.length - 50); }

/* ---------- оценка руки: 5 карт → [категория, от старших к младшим] ---------- */
function rank5(cs) {
  const vals = cs.map(c => RV(c.r)).sort((a, b) => b - a);
  const flush = cs.every(c => c.s === cs[0].s);
  const counts = {};
  for (const v of vals) counts[v] = (counts[v] || 0) + 1;
  const byCount = Object.keys(counts).map(Number).sort((a, b) => counts[b] - counts[a] || b - a);
  let straight = false, top = vals[0];
  if (byCount.length === 5) {
    if (vals[0] - vals[4] === 4) straight = true;
    else if (vals[0] === 14 && vals[1] === 5 && vals[2] === 4 && vals[3] === 3 && vals[4] === 2) { straight = true; top = 5; }
  }
  if (straight && flush) return [8, top];
  if (counts[byCount[0]] === 4) return [7, byCount[0], byCount[1]];
  if (byCount.length === 2 && counts[byCount[0]] === 3 && counts[byCount[1]] === 2) return [6, byCount[0], byCount[1]];
  if (flush) return [5].concat(vals);
  if (straight) return [4, top];
  if (counts[byCount[0]] === 3) return [3, byCount[0]].concat(byCount.slice(1));
  if (counts[byCount[0]] === 2 && byCount.length >= 3 && counts[byCount[1]] === 2) return [2, byCount[0], byCount[1]].concat(byCount.filter(v => counts[v] === 1));
  if (counts[byCount[0]] === 2) return [1, byCount[0]].concat(byCount.filter(v => counts[v] === 1));
  return [0].concat(vals);
}
function cmpH(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) { const x = a[i] || 0, y = b[i] || 0; if (x !== y) return x > y ? 1 : -1; }
  return 0;
}
const COMBO = (() => { const out = []; for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) for (let c = b + 1; c < 7; c++) for (let d = c + 1; d < 7; d++) for (let e = d + 1; e < 7; e++) out.push([a, b, c, d, e]); return out; })();
function best7(cards) {
  let best = null;
  for (const c of COMBO) {
    const h = rank5([cards[c[0]], cards[c[1]], cards[c[2]], cards[c[3]], cards[c[4]]]);
    if (!best || cmpH(h, best) > 0) best = h;
  }
  return best;
}
const NAMES = ['старшая карта', 'пара', 'две пары', 'сет', 'стрит', 'флеш', 'фулл-хаус', 'каре', 'стрит-флеш'];
function handName(r) { return NAMES[r[0]] || 'рука'; }

/* ---------- ход игры ---------- */
const poker = {
  key: 'poker', title: 'Покер (холдем)', min: 2, max: 6, auto: false,
  make(names, buy, rnd) {
    const n = names.length;
    const bb = Math.max(1, Math.floor(buy / 50));
    const sb = Math.max(1, Math.floor(bb / 2));
    const st = {
      n: n, names: names.slice(), buy: buy, bb: bb, sb: sb,
      deck: shuffle(deck52(), rnd), hands: names.map(() => []), board: [],
      stacks: names.map(() => buy), bets: names.map(() => 0), total: names.map(() => 0),
      folded: names.map(() => false), allin: names.map(() => false), acted: names.map(() => false),
      button: rnd(n), street: 'preflop', turn: 0, lastRaise: bb, over: false, winners: [], won: names.map(() => 0),
      showdown: null, log: [], round: 1
    };
    for (let k = 0; k < 2; k++) for (let i = 0; i < n; i++) st.hands[i].push(st.deck.pop());
    const sbI = n === 2 ? st.button : (st.button + 1) % n;
    const bbI = n === 2 ? (st.button + 1) % n : (st.button + 2) % n;
    st.sbI = sbI; st.bbI = bbI;
    putChips(st, sbI, sb); putChips(st, bbI, bb);
    pushLog(st, 'Блайнды ' + F(sb) + '/' + F(bb) + ' · малый ' + names[sbI] + ', большой ' + names[bbI]);
    st.turn = bbI;
    advance(st);
    return st;
  },
  view(st, i) {
    const cur = currentBet(st);
    const toCall = Math.max(0, cur - st.bets[i]);
    const canAct = !st.over && st.turn === i && !st.folded[i] && !st.allin[i] && st.stacks[i] > 0;
    return {
      game: 'poker', street: st.street, pot: pot(st), board: st.board.slice(),
      hand: st.hands[i].slice(), turn: st.turn, button: st.button, bb: st.bb, sb: st.sb,
      cur: cur, toCall: toCall, stack: st.stacks[i],
      players: st.stacks.map((s, k) => ({ stack: s, bet: st.bets[k], total: st.total[k], folded: st.folded[k], allin: st.allin[k], acted: st.acted[k], you: k === i })),
      can: {
        act: canAct, fold: canAct, check: canAct && toCall === 0, call: canAct && toCall > 0 && st.stacks[i] > 0,
        raise: canAct && st.stacks[i] > toCall,
        minRaise: Math.min(st.stacks[i] + st.bets[i], cur + Math.max(st.lastRaise, st.bb)),
        maxRaise: st.stacks[i] + st.bets[i], callAmount: Math.min(toCall, st.stacks[i])
      },
      over: st.over, winners: st.winners.slice(), showdown: st.showdown, log: st.log.slice(-16),
      handsRevealed: st.showdown ? st.hands.map(h => h.slice()) : null
    };
  },
  act(st, i, m) {
    if (st.over) throw new Error('Раздача уже закончена');
    if (st.turn !== i) throw new Error('Сейчас не ваш ход');
    if (st.folded[i] || st.allin[i]) throw new Error('Вы уже не в игре');
    const cur = currentBet(st);
    const toCall = Math.max(0, cur - st.bets[i]);
    const act = m && m.act;
    if (act === 'fold') {
      st.folded[i] = true; st.acted[i] = true;
      pushLog(st, st.names[i] + ': сброс');
    } else if (act === 'check') {
      if (toCall > 0) throw new Error('Нельзя чек: нужно уравнять ' + F(toCall));
      st.acted[i] = true;
      pushLog(st, st.names[i] + ': чек');
    } else if (act === 'call') {
      if (toCall <= 0) throw new Error('Нечего уравнивать — можно чек');
      const paid = putChips(st, i, toCall);
      st.acted[i] = true;
      pushLog(st, st.names[i] + ': колл ' + F(paid) + (st.allin[i] ? ' (олл-ин)' : ''));
    } else if (act === 'raise') {
      const target = Math.floor(Number(m.amount));
      const maxTo = st.bets[i] + st.stacks[i];
      if (!isFinite(target) || target <= cur) throw new Error('Поднять можно только выше текущей ставки');
      if (target > maxTo) throw new Error('У вас нет столько фишек');
      const inc = target - cur;
      const minInc = Math.max(st.lastRaise, st.bb);
      if (inc < minInc && target < maxTo) throw new Error('Мало поднял: минимум до ' + F(cur + minInc));
      putChips(st, i, target - st.bets[i]);
      if (inc > st.lastRaise) st.lastRaise = inc;
      for (let k = 0; k < st.n; k++) if (k !== i && !st.folded[k] && !st.allin[k]) st.acted[k] = false;
      st.acted[i] = true;
      pushLog(st, st.names[i] + ': рейз до ' + F(target) + (st.allin[i] ? ' (олл-ин)' : ''));
    } else throw new Error('Неизвестное действие');
    advance(st);
  },
  done(st) { return st.over; },
  turn(st) { return st.over ? -1 : st.turn; },
  payouts(st) {
    const out = st.names.map((_, i) => st.stacks[i] + st.won[i]);
    return out;
  }
};
function F(x) { return String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function pot(st) { let s = 0; for (const t of st.total) s += t; return s; }
function currentBet(st) { let m = 0; for (let i = 0; i < st.n; i++) if (!st.folded[i]) m = Math.max(m, st.bets[i]); return m; }
function putChips(st, i, amount) {
  const a = Math.max(0, Math.min(Math.floor(amount), st.stacks[i]));
  st.stacks[i] -= a; st.bets[i] += a; st.total[i] += a;
  if (st.stacks[i] <= 0) st.allin[i] = true;
  return a;
}
function canAct(st, i) { return !st.folded[i] && !st.allin[i] && st.stacks[i] > 0; }
function pending(st) {
  const cur = currentBet(st), out = [];
  for (let i = 0; i < st.n; i++) { if (!canAct(st, i)) continue; if (!st.acted[i] || st.bets[i] < cur) out.push(i); }
  return out;
}
function advance(st) {
  let alive = 0, last = -1;
  for (let i = 0; i < st.n; i++) if (!st.folded[i]) { alive++; last = i; }
  if (alive <= 1) return finish(st, [last]);
  const pend = pending(st);
  if (pend.length) {
    for (let k = 1; k <= st.n; k++) { const j = (st.turn + k) % st.n; if (pend.indexOf(j) >= 0) { st.turn = j; return; } }
    st.turn = pend[0]; return;
  }
  nextStreet(st);
}
function nextStreet(st) {
  const actors = [];
  for (let i = 0; i < st.n; i++) if (canAct(st, i)) actors.push(i);
  if (actors.length <= 1) return runOut(st);
  if (st.street === 'preflop') { st.street = 'flop'; st.deck.pop(); st.board.push(st.deck.pop(), st.deck.pop(), st.deck.pop()); pushLog(st, 'Флоп: ' + st.board.map(c => c.r + c.s).join(' ')); }
  else if (st.street === 'flop') { st.street = 'turn'; st.deck.pop(); st.board.push(st.deck.pop()); pushLog(st, 'Тёрн: ' + st.board[3].r + st.board[3].s); }
  else if (st.street === 'turn') { st.street = 'river'; st.deck.pop(); st.board.push(st.deck.pop()); pushLog(st, 'Ривер: ' + st.board[4].r + st.board[4].s); }
  else return showdown(st);
  st.bets = st.names.map(() => 0); st.acted = st.names.map(() => false); st.lastRaise = st.bb;
  for (let k = 1; k <= st.n; k++) { const j = (st.button + k) % st.n; if (canAct(st, j)) { st.turn = j; return; } }
  runOut(st);
}
function runOut(st) {
  while (st.street !== 'river') {
    if (st.street === 'preflop') { st.street = 'flop'; st.deck.pop(); st.board.push(st.deck.pop(), st.deck.pop(), st.deck.pop()); pushLog(st, 'Флоп: ' + st.board.map(c => c.r + c.s).join(' ')); }
    else if (st.street === 'flop') { st.street = 'turn'; st.deck.pop(); st.board.push(st.deck.pop()); pushLog(st, 'Тёрн: ' + st.board[3].r + st.board[3].s); }
    else { st.street = 'river'; st.deck.pop(); st.board.push(st.deck.pop()); pushLog(st, 'Ривер: ' + st.board[4].r + st.board[4].s); }
  }
  showdown(st);
}
/* побочные банки: уровни вкладов → отдельные банки с правом на выигрыш */
function sidePots(st) {
  const levels = [...new Set(st.total.filter(x => x > 0))].sort((a, b) => a - b);
  const pots = []; let prev = 0;
  for (const lv of levels) {
    let amount = 0;
    for (let i = 0; i < st.n; i++) amount += Math.min(st.total[i], lv) - Math.min(st.total[i], prev);
    const elig = [];
    for (let i = 0; i < st.n; i++) if (st.total[i] >= lv && !st.folded[i]) elig.push(i);
    if (amount > 0 && elig.length) pots.push({ amount: amount, elig: elig });
    prev = lv;
  }
  return pots;
}
function showdown(st) {
  const info = [];
  for (let i = 0; i < st.n; i++) {
    if (st.folded[i]) { info.push(null); continue; }
    const r = best7(st.hands[i].concat(st.board));
    info.push({ i: i, rank: r, name: handName(r), label: st.hands[i].map(c => c.r + c.s).join(' ') });
  }
  const pots = sidePots(st);
  const winners = [];
  for (const p of pots) {
    let best = null, ws = [];
    for (const i of p.elig) {
      if (!best || cmpH(info[i].rank, best) > 0) { best = info[i].rank; ws = [i]; }
      else if (cmpH(info[i].rank, best) === 0) ws.push(i);
    }
    const share = Math.floor(p.amount / ws.length);
    let rem = p.amount - share * ws.length;
    for (const i of ws) {
      const add = share + (rem-- > 0 ? 1 : 0);
      st.won[i] += add;
      if (winners.indexOf(i) < 0) winners.push(i);
    }
    pushLog(st, 'Банк ' + F(p.amount) + ': ' + ws.map(i => st.names[i] + ' (' + info[i].name + ')').join(', '));
  }
  st.showdown = info.filter(Boolean).map(x => ({ i: x.i, name: x.name, cards: x.label, won: st.won[x.i] }));
  finish(st, winners);
}
function finish(st, winners) {
  if (st.over) return;
  st.over = true;
  st.winners = winners.slice();
  if (!st.showdown) {
    st.showdown = winners.map(i => ({ i: i, name: 'банк без вскрытия', cards: st.hands[i] ? st.hands[i].map(c => c.r + c.s).join(' ') : '', won: 0 }));
  }
  /* фишки не должны ни теряться, ни появляться: остаток отдаём победителю */
  const sum = st.won.reduce((a, b) => a + b, 0);
  const total = st.total.reduce((a, b) => a + b, 0);
  if (sum !== total) {
    const w = winners.length ? winners[0] : 0;
    st.won[w] += total - sum;
  }
  for (const i of st.names.map((_, k) => k)) if (st.won[i] > 0) pushLog(st, '🏆 ' + st.names[i] + ' забирает ' + F(st.won[i]));
}

module.exports = { poker: poker, best7: best7, rank5: rank5, cmpH: cmpH, handName: handName, R52: R52, RV: RV, sidePots: sidePots, deck52: deck52 };
