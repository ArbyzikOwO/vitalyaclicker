/* ============================================================
   АНТИКЛИК — общий модуль (браузер + сервер, один и тот же алгоритм)
   Окно: последние 50 кликов [x, y, t(мс)].

   Правило 1 (позиции). Если одна и та же позиция повторяется с постоянным
   шагом (каждый 2-й, 3-й … 10-й клик) в ПОЛНОМ ОКНЕ более чем в 70% случаев
   → бан. Нужно минимум 2 разных точки: человек, который просто не двигает
   мышь, под это правило не попадает.

   Правило 2 (интервалы). Если интервалы между кликами практически
   одинаковые, порог для позиций снижается до 40%, и сюда входит шаг 1
   (клики подряд в одну точку).
   ============================================================ */
(function (root) {
  'use strict';
  const CFG = {
    window: 50,          // сколько последних кликов помним
    posTol: 2,           // px: позиции в пределах ±2 считаются одинаковыми
    maxPeriod: 10,       // проверяем шаги 1..10
    threshold: 0.70,     // порог бана по позициям (интервалы разные)
    thresholdUniform: 0.40, // порог бана по позициям (интервалы одинаковые)
    ivTolMs: 8,          // интервал «такой же», если отличается от медианы не более чем на 8 мс…
    ivTolRel: 0.03,      // …или на 3% (что больше)
    ivShare: 0.90,       // «все одинаковые» = не менее 90% интервалов в допуске
  };

  const same = (a, b) => Math.abs(a[0] - b[0]) <= CFG.posTol && Math.abs(a[1] - b[1]) <= CFG.posTol;

  function periodShare(c, p) {
    const total = c.length - p;
    if (total <= 0) return 0;
    let m = 0;
    for (let i = 0; i < total; i++) if (same(c[i], c[i + p])) m++;
    return m / total;
  }
  function distinctPoints(c) {
    const reps = [];
    for (const p of c) if (!reps.some(r => same(r, p))) reps.push(p);
    return reps.length;
  }
  function intervalsUniform(c) {
    const iv = [];
    for (let i = 1; i < c.length; i++) iv.push(c[i][2] - c[i - 1][2]);
    if (!iv.length) return false;
    const sorted = iv.slice().sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    const tol = Math.max(CFG.ivTolMs, med * CFG.ivTolRel);
    let ok = 0;
    for (const v of iv) if (Math.abs(v - med) <= tol) ok++;
    return ok / iv.length >= CFG.ivShare;
  }

  /* clicks: массив [x, y, t]. Возвращает { ready, ban, rule, period, share, threshold, uniform } */
  function analyze(clicks) {
    if (!Array.isArray(clicks) || clicks.length < CFG.window) return { ready: false, ban: false };
    const c = clicks.slice(-CFG.window);
    const uniform = intervalsUniform(c);
    const distinct = distinctPoints(c);
    const threshold = uniform ? CFG.thresholdUniform : CFG.threshold;
    let best = { share: 0, period: 0 };
    for (let p = uniform ? 1 : 2; p <= CFG.maxPeriod; p++) {
      const s = periodShare(c, p);
      if (s > best.share) best = { share: s, period: p };
    }
    const ban = best.share > threshold && (uniform || distinct >= 2);
    return { ready: true, ban, rule: uniform ? 'intervals' : 'positions', period: best.period, share: best.share, threshold, uniform, distinct };
  }

  function describe(r) {
    if (!r || !r.ban) return '';
    const pct = Math.round(r.share * 100), th = Math.round(r.threshold * 100);
    return r.uniform
      ? `одинаковые интервалы между кликами + повтор позиций (шаг ${r.period}): ${pct}% > ${th}%`
      : `повтор позиций с шагом ${r.period}: ${pct}% > ${th}%`;
  }

  const api = { CFG, analyze, describe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AntiClick = api;
})(typeof window !== 'undefined' ? window : globalThis);
