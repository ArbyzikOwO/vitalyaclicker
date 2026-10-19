/*
 * prepare.js — собирает "стейдж" (папку с игрой) для упакованных сборок (EXE/APK).
 * Исходники в D:\VitalyaClicker69 НЕ меняются: копия кладётся в _build\stage,
 * туда же добавляются значения, известные только во время сборки:
 *   window.VC_SERVER    — адрес сервера по умолчанию
 *   window.VC_REPO      — "владелец/репозиторий" (релизы + server.txt)
 *   window.VC_VERSION   — версия из version.json
 *   window.VC_PLATFORM  — "win" | "android" | "linux" (нужно автообновлению)
 *
 * Запуск:  node prepare.js
 * Переменные: VC_SERVER, VC_REPO, VC_VERSION, VC_TARGET (win|linux)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUILD = __dirname;
const STAGE = path.join(BUILD, 'stage');

function readJson(p, def) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return def; } }

const VERSION = process.env.VC_VERSION || readJson(path.join(ROOT, 'version.json'), {}).version || '1.0.0';
const REPO = process.env.VC_REPO || 'ArbyzikOwO/vitalyaclicker';
const SERVER = process.env.VC_SERVER || 'http://localhost:3000';
/* куда собираем: VC_TARGET=linux делает стейдж Electron для Linux (AppImage),
   иначе — для Windows. Android-копия готовится всегда. */
const TARGET = String(process.env.VC_TARGET || 'win').trim().toLowerCase() === 'linux' ? 'linux' : 'win';

const FILES = ['index.html', 'sad.html', 'online.js', 'online.css', 'anticlick.js', 'updater.js', 'roulette.js', 'icon.png', 'version.json'];
const DIRS = ['skins', 'audio'];

function rmrf(p) { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), d = path.join(to, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

/* тег с параметрами сборки */
function cfgTag(platform) {
  return '<script>window.VC_SERVER=' + JSON.stringify(SERVER)
    + ';window.VC_REPO=' + JSON.stringify(REPO)
    + ';window.VC_VERSION=' + JSON.stringify(VERSION)
    + ';window.VC_PLATFORM=' + JSON.stringify(platform || '') + ';</script>';
}
function withTag(html, platform) {
  const tag = cfgTag(platform);
  if (html.indexOf('window.VC_SERVER') >= 0) return html.replace(/<script>window\.VC_SERVER=[\s\S]*?<\/script>/, tag);
  return html.replace('</head>', tag + '\n</head>');
}

rmrf(STAGE);
fs.mkdirSync(STAGE, { recursive: true });

let n = 0;
for (const f of FILES) {
  const src = path.join(ROOT, f);
  if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(STAGE, f)); n++; }
}
for (const d of DIRS) {
  const src = path.join(ROOT, d);
  if (fs.existsSync(src)) copyTree(src, path.join(STAGE, d));
}

/* адрес сервера по умолчанию + параметры сборки */
const idx = path.join(STAGE, 'index.html');
let html = fs.readFileSync(idx, 'utf8');
if (html.indexOf('</head>') < 0) throw new Error('в index.html нет </head>');
fs.writeFileSync(idx, withTag(html, ''));

/* копии стейджа для конкретных сборок (у каждой свой VC_PLATFORM) */
const targets = [
  { dir: path.join(BUILD, 'electron', 'stage'), platform: TARGET },
  { dir: path.join(BUILD, 'mobile', 'www'), platform: 'android' }
];
const copied = [];
for (const t of targets) {
  if (!fs.existsSync(path.dirname(t.dir))) continue;
  rmrf(t.dir);
  fs.mkdirSync(t.dir, { recursive: true });
  copyTree(STAGE, t.dir);
  const p = path.join(t.dir, 'index.html');
  fs.writeFileSync(p, withTag(fs.readFileSync(p, 'utf8'), t.platform));
  copied.push(t.dir + ' [' + t.platform + ']');
}

console.log('stage: ' + STAGE + ' (' + n + ' корневых файлов)');
console.log('версия: ' + VERSION);
console.log('репозиторий: ' + REPO);
console.log('сервер: ' + SERVER);
console.log('цель: ' + TARGET);
console.log('копии: ' + copied.join(', '));
