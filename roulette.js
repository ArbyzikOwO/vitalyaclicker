/* ============================================================
   roulette.js — европейская рулетка: чистая логика, раскладка и выплаты.

   Файл общий: в браузере он даёт window.VCRoul, в Node — module.exports,
   поэтому одни и те же правила ставок проверяются тестами сервера
   (server/test.js) и используются клиентом (online.js).

   Здесь нет ни DOM, ни случайности — только математика:
     • порядок чисел на колесе (европейский, 0..36);
     • каталог ставок (номер, сплит, стрит, угол, линия, дюжина,
       колонка, красное/чёрное, чёт/нечет, 1-18/19-36) с выплатами;
     • evaluate(bets, number) — что выиграло и сколько вернуть;
     • angleOf(n) — угол центра сектора (для отрисовки колеса).
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.VCRoul = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  /* ---------- колесо ---------- */
  /* Порядок чисел европейского колеса по часовой стрелке, начиная с зеро. */
  const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const RED_NUMS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  const RED_SET = new Set(RED_NUMS);
  const SPAN = 360 / 37;                 // ширина одного сектора, градусы
  const COLORS = { red: '#d23c3c', black: '#191b22', green: '#1f9d55' };
  const RED_NUMS_SET = RED_SET;

  const isRed = n => RED_SET.has(n);
  const pocketColor = n => (n === 0 ? 'green' : (RED_SET.has(n) ? 'red' : 'black'));
  const colorName = c => (c === 'red' ? '🔴 красное' : c === 'black' ? '⚫ чёрное' : '🟢 зеро');
  const otherColor = c => (c === 'red' ? 'black' : 'red');

  /* индекс сектора на колесе и угол его центра (по часовой стрелке от верха) */
  const sectorOf = n => ORDER.indexOf(n);
  const angleOf = n => sectorOf(n) * SPAN + SPAN / 2;

  /* ---------- ставки ---------- */
  /* Выплата указана как «x к 1»: выигрыш приносит amount * mult прибыли,
     поэтому возврат = amount * (mult + 1). У зеро (0) есть только «прямая» ставка. */
  const MULT = { straight: 35, split: 17, street: 11, corner: 8, line: 5, dozen: 2, column: 2, even: 1 };

  const colOf = n => Math.ceil(n / 3);            // номер столбца 1..12 в раскладке
  const rowOf = n => (n - 1) % 3;                 // 0 = нижняя строка (1,4,7...), 2 = верхняя (3,6,9...)

  const BETS = [];
  const MAP = new Map();
  function addBet(id, kind, mult, covers, label, spot) {
    const b = { id, kind, mult, covers, label, spot: spot || '' };
    BETS.push(b); MAP.set(id, b);
    return b;
  }
  const num = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; };

  /* прямые ставки */
  for (let n = 0; n <= 36; n++) addBet('n:' + n, 'straight', MULT.straight, [n], String(n));
  /* сплиты: соседи по горизонтали и по вертикали */
  for (let n = 1; n <= 36; n++) {
    const c = colOf(n), r = rowOf(n);
    if (c < 12) addBet('s:' + n + '-' + (n + 3), 'split', MULT.split, [n, n + 3], n + '/' + (n + 3));
    if (r < 2) addBet('s:' + n + '-' + (n + 1), 'split', MULT.split, [n, n + 1], n + '/' + (n + 1));
  }
  /* стриты: по три числа в столбце раскладки */
  for (let k = 1; k <= 12; k++) { const a = 3 * k - 2; addBet('t:' + a, 'street', MULT.street, [a, a + 1, a + 2], a + '-' + (a + 2)); }
  /* углы: четыре числа на пересечении */
  for (let n = 1; n <= 33; n++) { if (colOf(n) < 12 && rowOf(n) < 2) addBet('c:' + n, 'corner', MULT.corner, [n, n + 1, n + 3, n + 4], n + '/' + (n + 1) + '/' + (n + 3) + '/' + (n + 4)); }
  /* линии: два соседних стрита */
  for (let k = 1; k <= 6; k++) { const a = 6 * k - 5; addBet('l:' + a, 'line', MULT.line, num(a, a + 5), a + '-' + (a + 5)); }
  /* дюжины */
  for (let d = 1; d <= 3; d++) addBet('d:' + d, 'dozen', MULT.dozen, num(d * 12 - 11, d * 12), (d * 12 - 11) + '-' + (d * 12));
  /* колонки */
  for (let c = 1; c <= 3; c++) { const covers = []; for (let n = c; n <= 36; n += 3) covers.push(n); addBet('k:' + c, 'column', MULT.column, covers, 'Колонка ' + c); }
  /* равные шансы */
  addBet('red', 'even', MULT.even, RED_NUMS.slice(), '🔴 Красное');
  addBet('black', 'even', MULT.even, num(1, 36).filter(n => !RED_SET.has(n)), '⚫ Чёрное');
  addBet('even', 'even', MULT.even, num(1, 36).filter(n => n % 2 === 0), 'Чёт');
  addBet('odd', 'even', MULT.even, num(1, 36).filter(n => n % 2 === 1), 'Нечет');
  addBet('low', 'even', MULT.even, num(1, 18), '1-18');
  addBet('high', 'even', MULT.even, num(19, 36), '19-36');

  const betById = id => MAP.get(String(id)) || null;

  /* ---------- расчёт ---------- */
  /* bets: [{ id, amount }] → что выиграло и сколько вернуть.
     stake — сколько поставлено, returned — сколько вернётся (включая ставку),
     net — итог (returned - stake), hits — выигравшие ставки. */
  function evaluate(bets, number) {
    const n = Number(number) | 0;
    let stake = 0, returned = 0;
    const hits = [];
    for (const b of (bets || [])) {
      const def = betById(b && b.id);
      const amount = Math.max(0, Math.floor(Number(b && b.amount) || 0));
      if (!def || !amount) continue;
      stake += amount;
      if (def.covers.indexOf(n) < 0) continue;
      const payout = amount * (def.mult + 1);
      returned += payout;
      hits.push({ id: def.id, amount, mult: def.mult, payout, label: def.label });
    }
    return { number: n, color: pocketColor(n), stake, returned, net: returned - stake, hits };
  }

  /* математическое ожидание для проверки корректности выплат (должно быть -1/37) */
  function expectedValue(def) {
    const p = def.covers.length / 37;
    return p * def.mult - (1 - p);
  }

  return {
    ORDER, SPAN, COLORS, RED_NUMS: RED_NUMS_SET, MULT,
    isRed, pocketColor, colorName, otherColor,
    sectorOf, angleOf, colOf, rowOf,
    BETS, betById, evaluate, expectedValue,
    allNumbers: () => ORDER.slice().sort((a, b) => a - b),
    count: 37
  };
});
