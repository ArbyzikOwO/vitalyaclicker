/*
 * build-apk.js — полный пайплайн сборки Android APK.
 *   1) cap add android (если ещё не создан)
 *   2) local.properties + разрешение http (cleartext)
 *   3) генерация иконок/сплэша из icon.png
 *   4) cap sync android
 *   5) gradlew assembleRelease
 *   6) zipalign + подпись apksigner -> dist\VitalyaClicker.apk
 *
 * Работает и локально (папки _build\jdk, _build\sdk), и в CI (JAVA_HOME,
 * ANDROID_SDK_ROOT от GitHub Actions). Пароль ключа подписи берётся из
 * tools\build.config.json (в репозиторий не попадает) или из VC_KS_PASS.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BUILD = __dirname;
const MOBILE = path.join(BUILD, 'mobile');
const ANDROID = path.join(MOBILE, 'android');
const DIST = path.resolve(BUILD, '..', 'dist');
const ROOT = path.resolve(BUILD, '..');
const IS_WIN = process.platform === 'win32';

function readJson(p, def) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return def; } }
const CFG = readJson(path.join(ROOT, 'tools', 'build.config.json'), {});

/* npm запускаем через node: .cmd файлы Node 20+ напрямую не запускает */
function npmCliPath() {
  const cand = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'
  ];
  for (const p of cand) if (fs.existsSync(p)) return p;
  return cand[0];
}
const NPM_CLI = npmCliPath();

/* JDK и Android SDK: переменная окружения → папка проекта → переменные инструментов */
function pickDir(envName, localDir, fallbacks) {
  if (process.env[envName] && fs.existsSync(process.env[envName])) return process.env[envName];
  if (fs.existsSync(localDir)) return localDir;
  for (const n of fallbacks || []) if (process.env[n] && fs.existsSync(process.env[n])) return process.env[n];
  return '';
}
const JDK = pickDir('VC_JDK', path.join(BUILD, 'jdk'), ['JAVA_HOME']);
const SDK = pickDir('VC_SDK', path.join(BUILD, 'sdk'), ['ANDROID_SDK_ROOT', 'ANDROID_HOME']);
if (!JDK) throw new Error('JDK 17 не найден: положите в _build\\jdk, задайте JAVA_HOME или VC_JDK');
if (!SDK) throw new Error('Android SDK не найден: положите в _build\\sdk, задайте ANDROID_SDK_ROOT или VC_SDK');

/* build-tools: нужен 34.0.0, иначе берём самый свежий из установленных */
function buildToolsDir() {
  const want = process.env.VC_BUILD_TOOLS || '34.0.0';
  const dir = path.join(SDK, 'build-tools', want);
  if (fs.existsSync(dir)) return dir;
  const base = path.join(SDK, 'build-tools');
  const all = fs.existsSync(base) ? fs.readdirSync(base).sort() : [];
  if (!all.length) throw new Error('в Android SDK нет build-tools (нужен 34.0.0): ' + base);
  return path.join(base, all[all.length - 1]);
}
const BUILD_TOOLS = buildToolsDir();
const ZIPALIGN = path.join(BUILD_TOOLS, IS_WIN ? 'zipalign.exe' : 'zipalign');
const APKSIGNER = path.join(BUILD_TOOLS, IS_WIN ? 'apksigner.bat' : 'apksigner');

/* ключ подписи: файл + пароль (секрет) */
const KEYSTORE = process.env.VC_KEYSTORE || path.join(MOBILE, 'vitalyaclicker.keystore');
const KS_PASS = process.env.VC_KS_PASS || CFG.ksPass || '';
const KS_ALIAS = process.env.VC_KS_ALIAS || CFG.ksAlias || 'vitalyaclicker';
if (!fs.existsSync(KEYSTORE)) throw new Error('нет ключа подписи APK: ' + KEYSTORE + ' (скопируйте vitalyaclicker.keystore или задайте VC_KEYSTORE)');
if (!KS_PASS) throw new Error('нет пароля ключа подписи: tools/build.config.json → ksPass или переменная VC_KS_PASS');

const env = Object.assign({}, process.env, {
  JAVA_HOME: JDK,
  ANDROID_HOME: SDK,
  ANDROID_SDK_ROOT: SDK,
  GRADLE_OPTS: '-Dorg.gradle.daemon=false',
  PATH: [path.dirname(process.execPath), path.join(JDK, 'bin'), path.join(SDK, 'platform-tools'), process.env.PATH || ''].join(path.delimiter)
});

function run(file, args, cwd, label) {
  console.log('\n>>> ' + (label || (file + ' ' + args.join(' '))));
  const r = spawnSync(file, args, { cwd: cwd || MOBILE, stdio: 'inherit', env });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('команда завершилась с кодом ' + r.status);
}
function npm() { return run(process.execPath, [NPM_CLI].concat([].slice.call(arguments)), MOBILE, 'npm ' + [].slice.call(arguments).join(' ')); }
/* .bat/.cmd запускаем через cmd.exe (иначе Node 20+ даёт EINVAL) */
function runBat(bat, args, cwd, label) { return run('cmd.exe', ['/d', '/s', '/c', [bat].concat(args).join(' ')], cwd, label); }
/* gradle wrapper: .bat в Windows, обычный скрипт в остальных системах */
function runGradle(args) {
  if (IS_WIN) return runBat(path.join(ANDROID, 'gradlew.bat'), args, ANDROID, 'gradlew ' + args.join(' '));
  const gw = path.join(ANDROID, 'gradlew');
  try { fs.chmodSync(gw, 0o755); } catch (e) {}
  return run(gw, args, ANDROID, 'gradlew ' + args.join(' '));
}
function tool(file, args, label) {
  return IS_WIN ? runBat(file, args, BUILD, label) : run(file, args, BUILD, label);
}

/* 1) платформа */
if (!fs.existsSync(ANDROID)) npm('run', 'add:android');

/* 2) local.properties + cleartext */
fs.writeFileSync(path.join(ANDROID, 'local.properties'), 'sdk.dir=' + SDK.replace(/\\/g, '\\\\') + '\n');
const manifestPath = path.join(ANDROID, 'app', 'src', 'main', 'AndroidManifest.xml');
let manifest = fs.readFileSync(manifestPath, 'utf8');
if (manifest.indexOf('usesCleartextTraffic') < 0) {
  manifest = manifest.replace('<application', '<application\n        android:usesCleartextTraffic="true"');
  fs.writeFileSync(manifestPath, manifest);
  console.log('AndroidManifest: добавлен usesCleartextTraffic');
}

/* 3) иконки и сплэш (нужны _build\mobile\assets\icon.png и splash.png) */
const assetsIcon = path.join(MOBILE, 'assets', 'icon.png');
if (!fs.existsSync(assetsIcon)) {
  throw new Error('нет ' + assetsIcon + ' — сгенерируйте его: node _build\\mobile\\make-assets.js (нужен sharp)');
}
npm('exec', '--', 'capacitor-assets', 'generate', '--android');

/* 4) синк веб-части */
npm('run', 'sync');

/* 5) сборка */
runGradle(['assembleRelease', '--no-daemon']);

/* 6) выравнивание и подпись */
const outDir = path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'release');
const unsigned = fs.readdirSync(outDir).filter(f => /\.apk$/.test(f)).map(f => path.join(outDir, f))[0];
if (!unsigned) throw new Error('APK не найден в ' + outDir);
const aligned = path.join(DIST, 'VitalyaClicker-aligned.apk');
fs.mkdirSync(DIST, { recursive: true });
tool(ZIPALIGN, ['-p', '-f', '4', unsigned, aligned], 'zipalign');
const finalApk = path.join(DIST, 'VitalyaClicker.apk');
tool(APKSIGNER, ['sign', '--ks', KEYSTORE, '--ks-pass', 'pass:' + KS_PASS, '--key-pass', 'pass:' + KS_PASS, '--ks-key-alias', KS_ALIAS, '--out', finalApk, aligned], 'apksigner');
fs.rmSync(aligned, { force: true });
tool(APKSIGNER, ['verify', '--print-certs', finalApk], 'apksigner verify');

console.log('\nГОТОВО: ' + finalApk);
