'use strict';
/* ============================================================
   ParrotAI — сервер. Порт алгоритма из «обучение ParrotAI.html» (без интерфейса и задержек).
   Модель — файл models/Parrot-ai.bin (формат PRT2: словарь + датасет, один файл)
   или models/Parrot-ai.json (экспорт из обучения, как раньше).
   Конвертация старого JSON в BIN:  node parrot.js convert Parrot-ai.json Parrot-ai.bin
   ============================================================ */
const fs = require('fs'), path = require('path');

const END = '<end>', END_MARKER = '\u0001', WILDCARD = -1;
const TAG_CONTINUE = '<continue>', TAG_WRITE_DOT = '<writeToDot>', TAG_WRITE_END = '<writeToEnd>';
const BAD_START_PUNCT = new Set([':', ',', ';', '.', '!', '?']);
const MAX_SKIP_LEADING = 4, PARTIAL_THRESHOLD = 0.5;
const TAG_RE = /^<(end|continue|writeToDot|writeToEnd)(\d+)>/i;
const DEFAULTS = { context: 1, random: false, instruct: false, detectAI: '\nA: ', detectUser: 'Q: ', endTags: ['<s_text>', '</s_text>'],
  stopEnd: true, stopDot: false, stopWordLimit: false, infinite: false, wordLimit: 50 };
const isLetter = c => /[a-zA-Zа-яА-ЯёЁ]/.test(c);

/* ---------------- модель ---------------- */
let M = null;
function newModel() {
  return { idToToken: [END], tokenToId: new Map([[END, 0]]), lowerToId: new Map([[END, 0]]), dataset: new Uint32Array(0),
    posIndex: new Map(), wordPosIndex: new Map(), settings: Object.assign({}, DEFAULTS), loaded: false, file: '' };
}
function setVocab(m, arr) {
  m.idToToken = arr.slice();
  m.tokenToId = new Map(m.idToToken.map((t, i) => [t, i]));
  m.lowerToId = new Map();
  m.idToToken.forEach((t, i) => { const low = t.toLowerCase(); if (!m.lowerToId.has(low)) m.lowerToId.set(low, i); });
}
function getOrCreateId(m, tok) {
  let id = m.tokenToId.get(tok);
  if (id === undefined) {
    id = m.idToToken.length; m.idToToken.push(tok); m.tokenToId.set(tok, id);
    const low = tok.toLowerCase(); if (!m.lowerToId.has(low)) m.lowerToId.set(low, id);
  }
  return id;
}
function matchEndTagAt(m, t, i) {
  for (const tag of (m.settings.endTags || [])) {
    if (!tag) continue;
    if (i + tag.length > t.length) continue;
    if (t.substr(i, tag.length).toLowerCase() === tag.toLowerCase()) return tag.length;
  }
  return 0;
}
function textToIds(m, text, create) {
  let t = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  t = t.replace(/\n{3,}/g, END_MARKER);
  const ids = [], toks = [];
  const resolveWord = w => { if (create) return getOrCreateId(m, w); const id = m.lowerToId.get(w.toLowerCase()); return id === undefined ? WILDCARD : id; };
  const resolvePunct = c => { if (create) return getOrCreateId(m, c); const id = m.tokenToId.get(c); return id === undefined ? WILDCARD : id; };
  const resolveTag = c => { if (create) return getOrCreateId(m, c); const id = m.tokenToId.get(c); return id === undefined ? WILDCARD : id; };
  let i = 0, wordBuf = '';
  const flushWord = () => { if (wordBuf) { ids.push(resolveWord(wordBuf)); toks.push(wordBuf); wordBuf = ''; } };
  while (i < t.length) {
    const ch = t[i];
    if (ch === '<') {
      const tagLen = matchEndTagAt(m, t, i);
      if (tagLen > 0) { flushWord(); ids.push(0); toks.push('<end>'); i += tagLen; continue; }
      const mm = t.slice(i).match(TAG_RE);
      if (mm) {
        flushWord();
        const name = mm[1].toLowerCase();
        if (name === 'end') { ids.push(0); toks.push('<end>'); }
        else {
          const canonName = name === 'writetodot' ? 'writeToDot' : name === 'writetoend' ? 'writeToEnd' : name;
          const canonical = '<' + canonName + '>';
          ids.push(resolveTag(canonical)); toks.push(canonical);
        }
        i += mm[0].length; continue;
      }
    }
    if (ch === END_MARKER) { flushWord(); ids.push(0); toks.push('<end>'); i++; continue; }
    if (isLetter(ch)) { wordBuf += ch; i++; continue; }
    flushWord();
    if (ch === ' ' || ch === '\t') { i++; continue; }
    ids.push(resolvePunct(ch)); toks.push(ch); i++;
  }
  flushWord();
  return { ids, toks };
}
function isWordToken(m, id) {
  if (id === undefined || id === 0) return false;
  const t = m.idToToken[id];
  return !!(t && t !== END && isLetter(t[0]));
}
function buildIndices(m) {
  m.posIndex = new Map(); m.wordPosIndex = new Map();
  const ds = m.dataset;
  for (let i = 0; i < ds.length; i++) {
    const id = ds[i];
    let a = m.posIndex.get(id); if (!a) { a = []; m.posIndex.set(id, a); } a.push(i);
    if (isWordToken(m, id)) { let w = m.wordPosIndex.get(id); if (!w) { w = []; m.wordPosIndex.set(id, w); } w.push(i); }
  }
}
function tokenEq(m, a, b) {
  if (a === b) return true;
  const ta = m.idToToken[a], tb = m.idToToken[b];
  if (ta === undefined || tb === undefined) return false;
  return ta.toLowerCase() === tb.toLowerCase();
}
function datasetWordAppearsAfter(m, fromPos, low) {
  const ds = m.dataset;
  for (let k = fromPos; k < ds.length; k++) {
    const id = ds[k];
    if (id === 0) return false;
    const t = m.idToToken[id];
    if (t && t.toLowerCase() === low) return true;
  }
  return false;
}
function lastWordIsOk(m, dsTok, userTok, searchFrom) {
  if (!dsTok || !userTok) return false;
  if (!isLetter(dsTok[0]) || !isLetter(userTok[0])) return true;
  const dsLow = dsTok.toLowerCase(), userLow = userTok.toLowerCase();
  if (dsLow === userLow) return true;
  return datasetWordAppearsAfter(m, searchFrom, dsLow);
}
function findExactMatch(m, ctxIds) {
  const n = ctxIds.length; if (!n) return [];
  let anchor = -1;
  for (let j = 0; j < n; j++) if (ctxIds[j] !== WILDCARD) { anchor = j; break; }
  if (anchor < 0) return [];
  const list = m.posIndex.get(ctxIds[anchor]);
  if (!list || !list.length) return [];
  const out = [], ds = m.dataset;
  for (const p of list) {
    const start = p - anchor;
    if (start < 0 || start + n > ds.length) continue;
    let ok = true;
    for (let j = 0; j < n; j++) { if (ctxIds[j] === WILDCARD) continue; if (!tokenEq(m, ds[start + j], ctxIds[j])) { ok = false; break; } }
    if (ok) { const positions = []; for (let j = 0; j < n; j++) positions.push(start + j); out.push({ start, positions, score: 1 }); }
  }
  return out;
}
function findPartialMatch(m, ctxIds, threshold) {
  const n = ctxIds.length; if (!n) return [];
  let anchor = -1;
  for (let j = 0; j < n; j++) if (ctxIds[j] !== WILDCARD) { anchor = j; break; }
  if (anchor < 0) return [];
  const list = m.posIndex.get(ctxIds[anchor]);
  if (!list || !list.length) return [];
  const out = [], ds = m.dataset;
  for (const p of list) {
    const start = p - anchor;
    if (start < 0 || start + n > ds.length) continue;
    let hit = 0, total = 0;
    for (let j = 0; j < n; j++) { if (ctxIds[j] === WILDCARD) continue; total++; if (tokenEq(m, ds[start + j], ctxIds[j])) hit++; }
    if (!(total > 0 && hit / total >= threshold)) continue;
    const lastIdx = n - 1, lastDsId = ds[start + lastIdx], lastUserId = ctxIds[lastIdx];
    let lastOk = false;
    if (lastUserId === WILDCARD) lastOk = true;
    else if (lastDsId === undefined || lastDsId === 0) lastOk = false;
    else lastOk = lastWordIsOk(m, m.idToToken[lastDsId], m.idToToken[lastUserId], start + n);
    if (!lastOk) continue;
    const positions = []; for (let j = 0; j < n; j++) positions.push(start + j);
    out.push({ start, positions, score: hit / total });
  }
  return out;
}
function startsFor(m, userWords) {
  const first = userWords[0];
  if (first.id !== WILDCARD) return m.wordPosIndex.get(first.id) || [];
  const starts = []; for (const arr of m.wordPosIndex.values()) for (const p of arr) starts.push(p);
  return starts.sort((a, b) => a - b);
}
function findExactWordsMatch(m, userWords) {
  const n = userWords.length; if (!n) return [];
  const starts = startsFor(m, userWords), out = [], ds = m.dataset;
  for (const start of starts) {
    let dsPos = start, ok = true; const positions = [];
    for (let k = 0; k < n; k++) {
      while (dsPos < ds.length && ds[dsPos] !== 0 && !isWordToken(m, ds[dsPos])) dsPos++;
      if (dsPos >= ds.length || ds[dsPos] === 0) { ok = false; break; }
      const uw = userWords[k];
      if (uw.id !== WILDCARD && !tokenEq(m, ds[dsPos], uw.id)) { ok = false; break; }
      positions.push(dsPos); dsPos++;
    }
    if (ok && positions.length === n) out.push({ start, positions, score: 1 });
  }
  return out;
}
function findPartialWordsMatch(m, userWords, threshold) {
  const n = userWords.length; if (!n) return [];
  const starts = startsFor(m, userWords), out = [], ds = m.dataset;
  for (const start of starts) {
    let dsPos = start, hit = 0; const positions = [];
    for (let k = 0; k < n; k++) {
      while (dsPos < ds.length && ds[dsPos] !== 0 && !isWordToken(m, ds[dsPos])) dsPos++;
      if (dsPos >= ds.length || ds[dsPos] === 0) { positions.push(-1); continue; }
      const uw = userWords[k];
      if (uw.id === WILDCARD || tokenEq(m, ds[dsPos], uw.id)) hit++;
      positions.push(dsPos); dsPos++;
    }
    if (!(positions.length > 0 && hit / n >= threshold)) continue;
    const lastIdx = n - 1, lastPos = positions[lastIdx], lastUserWord = userWords[lastIdx];
    let lastOk = false;
    if (lastUserWord.id === WILDCARD) lastOk = true;
    else if (lastPos === undefined || lastPos < 0) lastOk = false;
    else lastOk = lastWordIsOk(m, m.idToToken[ds[lastPos]], m.idToToken[lastUserWord.id], lastPos + 1);
    if (!lastOk) continue;
    out.push({ start, positions, score: hit / n });
  }
  return out;
}
function findMatches(m, ctxIds, ctxToks) {
  const userWords = [];
  for (let i = 0; i < ctxIds.length; i++) {
    const t = ctxToks[i] || '';
    if (ctxIds[i] === WILDCARD || isLetter(t[0])) userWords.push({ id: ctxIds[i], tok: t });
  }
  const hasPunct = userWords.length !== ctxIds.length;
  let res = findExactMatch(m, ctxIds);
  if (res.length) return res.map(x => ({ ...x, usedIds: ctxIds.slice(), usedToks: ctxToks.slice() }));
  if (hasPunct && userWords.length > 0) {
    res = findExactWordsMatch(m, userWords);
    if (res.length) return res.map(x => ({ ...x, usedIds: userWords.map(w => w.id), usedToks: userWords.map(w => w.tok) }));
  }
  res = findPartialMatch(m, ctxIds, PARTIAL_THRESHOLD);
  if (res.length) return res.map(x => ({ ...x, usedIds: ctxIds.slice(), usedToks: ctxToks.slice() }));
  if (hasPunct && userWords.length > 0) {
    res = findPartialWordsMatch(m, userWords, PARTIAL_THRESHOLD);
    if (res.length) return res.map(x => ({ ...x, usedIds: userWords.map(w => w.id), usedToks: userWords.map(w => w.tok) }));
  }
  return [];
}
function rangeOverlaps(a, b, set) { for (let i = a; i <= b; i++) if (set.has(i)) return true; return false; }
function markRange(a, b, set) { if (b < a) return; for (let i = a; i <= b; i++) set.add(i); }
function findBranch(m, searchHistory, ctxSize, usedPositions, ignoreUsed) {
  const len = searchHistory.length, from = Math.max(0, len - ctxSize);
  for (let s = from; s < len; s++) {
    const slice = searchHistory.slice(s);
    const cIds = slice.map(x => x.id), cToks = slice.map(x => x.tok);
    if (cIds.length === 0) continue;
    const all = findMatches(m, cIds, cToks);
    if (all.length === 0) continue;
    const pool = ignoreUsed ? all : all.filter(c => !rangeOverlaps(c.start, c.start + cIds.length - 1, usedPositions));
    if (pool.length > 0) return { pool, usedIds: cIds, usedToks: cToks, level: s };
  }
  return null;
}
function buildSubMap(m, positions, usedIds, usedToks) {
  const sm = new Map();
  if (!positions || !positions.length) return sm;
  let lastPos = -1;
  for (let j = positions.length - 1; j >= 0; j--) if (positions[j] >= 0) { lastPos = positions[j]; break; }
  const searchFrom = lastPos >= 0 ? lastPos + 1 : 0;
  for (let j = 0; j < usedIds.length; j++) {
    const dsPos = positions[j];
    if (dsPos === undefined || dsPos < 0) continue;
    const dsId = m.dataset[dsPos];
    if (dsId === undefined || dsId === 0) continue;
    const dsTok = m.idToToken[dsId];
    if (!dsTok || dsTok === END) continue;
    if (!isLetter(dsTok[0])) continue;
    const userTok = usedToks[j];
    if (!userTok || userTok === END) continue;
    if (!isLetter(userTok[0])) continue;
    const dsLow = dsTok.toLowerCase(), userLow = userTok.toLowerCase();
    if (dsLow === userLow) continue;
    if (!datasetWordAppearsAfter(m, searchFrom, dsLow)) continue;
    sm.set(dsLow, userTok);
  }
  return sm;
}
function rankCandidates(m, pool, usedIds, usedToks) {
  const ranked = pool.map(c => {
    const subMap = buildSubMap(m, c.positions, usedIds, usedToks);
    const baseScore = c.score !== undefined ? c.score : 1;
    return { cand: c, subMap, baseScore, effective: baseScore + subMap.size * 0.5 };
  });
  ranked.sort((a, b) => (b.effective !== a.effective ? b.effective - a.effective : a.cand.start - b.cand.start));
  return ranked;
}
function computeDetectUserIds(m) {
  if (!m.settings.detectUser) return [];
  return textToIds(m, m.settings.detectUser, false).ids.filter(id => id !== WILDCARD);
}
function matchesDetectUserAt(m, pos, detectIds) {
  if (!detectIds.length) return false;
  if (pos + detectIds.length > m.dataset.length) return false;
  for (let k = 0; k < detectIds.length; k++) if (!tokenEq(m, m.dataset[pos + k], detectIds[k])) return false;
  return true;
}
function countWords(tokens) { let n = 0; for (const t of tokens) if (t && isLetter(t[0])) n++; return n; }
function tokenIsBadStart(m, id) {
  if (id === undefined || id === 0) return false;
  return BAD_START_PUNCT.has(m.idToToken[id]);
}
function randomJump(m, searchHistory, ctxSize) {
  const ds = m.dataset;
  if (ds.length === 0) return false;
  let randPos = -1;
  for (let attempt = 0; attempt < 50; attempt++) {
    const p = Math.floor(Math.random() * ds.length);
    if (ds[p] !== 0 && p + ctxSize <= ds.length) { randPos = p; break; }
  }
  if (randPos < 0) return false;
  const newLen = Math.min(ctxSize, ds.length - randPos);
  if (newLen <= 0) return false;
  searchHistory.length = 0;
  for (let k = 0; k < newLen; k++) { const pid = ds[randPos + k]; searchHistory.push({ id: pid, tok: m.idToToken[pid] || END }); }
  return true;
}
function writeFromAnotherBranch(m, searchHistory, ctxSize, detectIds, usedPositions, mode, depth, random) {
  if (depth > 4) return [];
  const found = findBranch(m, searchHistory, ctxSize, usedPositions, false);
  if (!found) return [];
  const ranked = rankCandidates(m, found.pool, found.usedIds, found.usedToks);
  const picked = random && ranked.length > 1 ? ranked[Math.floor(Math.random() * ranked.length)] : ranked[0];
  const pick = picked.cand;
  let lastRealPos = -1;
  for (let j = pick.positions.length - 1; j >= 0; j--) if (pick.positions[j] >= 0) { lastRealPos = pick.positions[j]; break; }
  if (lastRealPos < 0) return [];
  markRange(pick.start, lastRealPos, usedPositions);
  const subMap = picked.subMap;
  let pos = lastRealPos + 1;
  const tokens = [];
  while (pos < m.dataset.length && tokens.length < 100000) {
    if (matchesDetectUserAt(m, pos, detectIds)) break;
    const id = m.dataset[pos];
    if (id === 0) break;
    const tok = m.idToToken[id];
    if (tok === TAG_CONTINUE || tok === TAG_WRITE_DOT || tok === TAG_WRITE_END) { markRange(pos, pos, usedPositions); pos++; continue; }
    let outTok = tok;
    if (outTok && isLetter(outTok[0])) { const low = outTok.toLowerCase(); if (subMap.has(low)) outTok = subMap.get(low); }
    tokens.push(outTok);
    markRange(pos, pos, usedPositions);
    pos++;
    if (mode === 'dot' && /[.!?]/.test(outTok)) break;
  }
  return tokens;
}
function stripDetectAIPrefix(m, tokens) {
  if (!m.settings.instruct) return tokens;
  const prefix = textToIds(m, m.settings.detectAI || '', false).toks;
  if (!prefix.length || tokens.length < prefix.length) return tokens;
  for (let i = 0; i < prefix.length; i++) if ((tokens[i] || '').toLowerCase() !== (prefix[i] || '').toLowerCase()) return tokens;
  return tokens.slice(prefix.length);
}
function tokensToText(m, tokens) {
  const stripped = stripDetectAIPrefix(m, tokens);
  const isWord = t => /^[a-zA-Zа-яА-ЯёЁ0-9]/.test(t);
  const isSentence = t => /^[.!?,;:…]+$/.test(t);
  const isOpenBrack = t => /^[«„“(\[{]$/.test(t);
  const isCloseBrk = t => /^[»”)\]}]$/.test(t);
  const isDash = t => /^[—–]$/.test(t);
  let out = '';
  for (const t of stripped) {
    if (t === END || !t) continue;
    if (t === '\n') out = out.replace(/[ \t]+$/, '') + '\n';
    else if (isWord(t)) {
      if (out && !out.endsWith(' ') && !out.endsWith('\n') && !'«(„“[{'.split('').some(c => out.endsWith(c))) out += ' ';
      out += t;
    }
    else if (isOpenBrack(t)) { if (out && !out.endsWith(' ') && !out.endsWith('\n')) out += ' '; out += t; }
    else if (isCloseBrk(t)) out = out.replace(/[ \t]+$/, '') + t;
    else if (isSentence(t)) out = out.replace(/[ \t]+$/, '') + t;
    else if (isDash(t)) out = out.replace(/[ \t]+$/, '') + ' ' + t + ' ';
    else { if (out && !out.endsWith(' ') && !out.endsWith('\n')) out += ' '; out += t; }
  }
  return out.replace(/[ \t]+$/, '');
}
function buildSearchText(m, raw) {
  const text = (raw || '').trim();
  if (!m.settings.instruct) return text;
  const u = (m.settings.detectUser || '').trim();
  if (!u) return text;
  if (text.startsWith(u)) return text;
  return u + ' ' + text;
}

/* ---------------- генерация (порт generateResponse без задержек и интерфейса) ---------------- */
function generate(m, userText, opts) {
  const S = m.settings;
  const random = opts && opts.random !== undefined ? opts.random : !!S.random;
  const ctxSize = Math.max(1, Math.min((opts && opts.contextSize) || S.context || 1, Math.max(1, m.dataset.length)));
  const infinite = !!S.infinite;
  const maxOut = (opts && opts.maxTokens) || 400;
  const detectIds = computeDetectUserIds(m);
  const usedPositions = new Set(), searchHistory = [], outputToks = [];
  let branchPos = -1, branchSubMap = null, walkBudget = 0;
  if (userText) { const { ids, toks } = textToIds(m, userText, false); for (let i = 0; i < ids.length; i++) searchHistory.push({ id: ids[i], tok: toks[i] }); }
  if (searchHistory.length === 0) return '';
  let totalWordCount = 0;

  function searchNewBranch() {
    let found = findBranch(m, searchHistory, ctxSize, usedPositions, false);
    if (!found && usedPositions.size > 0) { usedPositions.clear(); found = findBranch(m, searchHistory, ctxSize, usedPositions, true); }
    if (!found && infinite) { if (randomJump(m, searchHistory, ctxSize)) found = findBranch(m, searchHistory, ctxSize, usedPositions, true); }
    if (!found) return false;
    const ranked = rankCandidates(m, found.pool, found.usedIds, found.usedToks);
    const picked = random && ranked.length > 1 ? ranked[Math.floor(Math.random() * ranked.length)] : ranked[0];
    const pick = picked.cand;
    branchSubMap = picked.subMap;
    let lastRealPos = -1;
    for (let j = pick.positions.length - 1; j >= 0; j--) if (pick.positions[j] >= 0) { lastRealPos = pick.positions[j]; break; }
    let bp = lastRealPos >= 0 ? lastRealPos + 1 : (pick.start + found.usedIds.length);
    let skipped = 0;
    while (skipped < MAX_SKIP_LEADING && bp < m.dataset.length) {
      const id = m.dataset[bp];
      if (id === 0) break;
      if (!tokenIsBadStart(m, id)) break;
      bp++; skipped++;
    }
    branchPos = bp;
    markRange(pick.start, Math.max(pick.start, bp - 1), usedPositions);
    walkBudget = random ? 1 : Math.max(1, ctxSize);
    return true;
  }

  if (branchPos < 0 && !searchNewBranch()) return tokensToText(m, outputToks);
  for (let step = 0; step < 200000 && outputToks.length < maxOut; step++) {
    const needSearch = walkBudget <= 0 || branchPos < 0 || branchPos >= m.dataset.length;
    if (needSearch) { if (!searchNewBranch()) break; continue; }
    if (matchesDetectUserAt(m, branchPos, detectIds)) { if (!infinite) break; walkBudget = 0; continue; }
    const id = m.dataset[branchPos];
    if (id === 0) { if (!infinite) break; walkBudget = 0; continue; }
    const tok = m.idToToken[id];
    if (tok === TAG_CONTINUE) { markRange(branchPos, branchPos, usedPositions); branchPos++; walkBudget = 0; continue; }
    if (tok === TAG_WRITE_DOT || tok === TAG_WRITE_END) {
      const mode = tok === TAG_WRITE_DOT ? 'dot' : 'end';
      markRange(branchPos, branchPos, usedPositions); branchPos++; walkBudget = 0;
      const sub = writeFromAnotherBranch(m, searchHistory, ctxSize, detectIds, usedPositions, mode, 0, random);
      for (const t of sub) { outputToks.push(t); searchHistory.push({ id: m.tokenToId.get(t) ?? WILDCARD, tok: t }); if (isLetter(t[0])) totalWordCount++; }
      continue;
    }
    let outTok = tok;
    if (outTok && isLetter(outTok[0]) && branchSubMap) { const low = outTok.toLowerCase(); if (branchSubMap.has(low)) outTok = branchSubMap.get(low); }
    outputToks.push(outTok);
    searchHistory.push({ id: m.tokenToId.get(outTok) ?? WILDCARD, tok: outTok });
    if (outTok && isLetter(outTok[0])) totalWordCount++;
    markRange(branchPos, branchPos, usedPositions);
    branchPos++; walkBudget--;
    if (!infinite) {
      if (S.stopDot && outTok && /[.!?]/.test(outTok)) break;
      if (S.stopWordLimit && totalWordCount >= S.wordLimit) break;
    }
  }
  return tokensToText(m, outputToks);
}

/* ---------------- файлы модели ---------------- */
const MAGIC = 'PRT2';
/* формат BIN (PRT2): 'PRT2' | u32 версия=2 | u32 длина JSON | JSON {idToToken, settings} | Uint32 датасет (LE) */
function encodeBin(idToToken, settings, dataset) {
  const meta = Buffer.from(JSON.stringify({ idToToken, settings }), 'utf8');
  const head = Buffer.alloc(12); head.write(MAGIC, 0, 'latin1'); head.writeUInt32LE(2, 4); head.writeUInt32LE(meta.length, 8);
  const body = Buffer.alloc(dataset.length * 4);
  for (let i = 0; i < dataset.length; i++) body.writeUInt32LE(dataset[i] >>> 0, i * 4);
  return Buffer.concat([head, meta, body]);
}
function loadFile(file) {
  const buf = fs.readFileSync(file);
  const m = newModel();
  if (file.toLowerCase().endsWith('.json')) {
    const d = JSON.parse(buf.toString('utf8'));
    m.settings = Object.assign({}, DEFAULTS, d.settings || {});
    if (!Array.isArray(m.settings.endTags)) m.settings.endTags = DEFAULTS.endTags.slice();
    setVocab(m, d.idToToken || [END]);
    m.dataset = Uint32Array.from(d.dataset || []);
  } else if (buf.length >= 12 && buf.toString('latin1', 0, 4) === MAGIC) {
    const metaLen = buf.readUInt32LE(8);
    const meta = JSON.parse(buf.toString('utf8', 12, 12 + metaLen));
    m.settings = Object.assign({}, DEFAULTS, meta.settings || {});
    if (!Array.isArray(m.settings.endTags)) m.settings.endTags = DEFAULTS.endTags.slice();
    setVocab(m, meta.idToToken || [END]);
    const off = 12 + metaLen, n = Math.floor((buf.length - off) / 4);
    m.dataset = new Uint32Array(n);
    for (let i = 0; i < n; i++) m.dataset[i] = buf.readUInt32LE(off + i * 4);
  } else {
    throw new Error('Старый .bin без словаря. Экспортируйте модель заново (новый .bin) или положите Parrot-ai.json');
  }
  buildIndices(m);
  m.loaded = true; m.file = file;
  return m;
}
const MODEL_DIR = path.join(__dirname, 'models');
const CANDIDATES = [path.join(MODEL_DIR, 'Parrot-ai.bin'), path.join(MODEL_DIR, 'Parrot-ai.json')];
function load(file) {
  const list = file ? [file] : CANDIDATES;
  for (const f of list) {
    if (!fs.existsSync(f)) continue;
    try { M = loadFile(f); return status(); } catch (e) { M = null; return { loaded: false, error: e.message, file: f }; }
  }
  M = null;
  return { loaded: false, error: 'Файл модели не найден: положите server/models/Parrot-ai.bin', file: CANDIDATES[0] };
}
function status() {
  if (!M || !M.loaded) return { loaded: false };
  return { loaded: true, file: path.basename(M.file), tokens: M.dataset.length, vocab: M.idToToken.length, instruct: !!M.settings.instruct };
}
/* ответ на вопрос игрока. null — модели нет или ответа нет */
function answer(question, cfg) {
  if (!M || !M.loaded) return null;
  const c = cfg || {};
  let q = String(question || '').trim();
  if (c.trigger) q = q.replace(new RegExp('^' + c.trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'i'), '');
  q = q.replace(/^q:\s*/i, '').trim();
  if (!q) return null;
  const out = generate(M, buildSearchText(M, q), { maxTokens: c.maxTokens, contextSize: c.contextSize, random: c.random }).trim().replace(/^A:\s*/, '');
  return out || null;
}

/* сборка модели из текста — та же логика, что loadFiles() в обучении: токены + 0 после файла, контекст = размер датасета */
function buildModel(text, settings) {
  const m = newModel();
  Object.assign(m.settings, settings || {});
  const { ids } = textToIds(m, text, true);
  const ds = []; for (const id of ids) if (id !== WILDCARD) ds.push(id);
  ds.push(0);
  m.dataset = Uint32Array.from(ds);
  m.settings.context = m.dataset.length;
  buildIndices(m); m.loaded = true;
  return m;
}
function setModel(m) { M = m; }

module.exports = { load, status, answer, encodeBin, loadFile, buildModel, setModel };

/* конвертация: node parrot.js convert <вход.json|bin> <выход.bin> */
if (require.main === module && process.argv[2] === 'convert') {
  const src = process.argv[3], dst = process.argv[4] || 'Parrot-ai.bin';
  const m = loadFile(src);
  fs.writeFileSync(dst, encodeBin(m.idToToken, m.settings, m.dataset));
  console.log(`Готово: ${dst} (токенов: ${m.dataset.length}, словарь: ${m.idToToken.length})`);
}
