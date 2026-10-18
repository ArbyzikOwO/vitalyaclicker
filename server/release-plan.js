'use strict';
/* =====================================================================
   release-plan.js — выбор способа выпуска обновления.
   Чистая логика без доступа к файлам и сети, чтобы её можно было
   проверять в server/test.js.

   Локальная сборка — на машине сервера: нужны _build/electron,
   _build/mobile, JDK 17, Android SDK и ключ подписи APK.
   Облачная — GitHub Actions (.github/workflows/release.yml):
   нужен только доступ к репозиторию (токен).

   pickMode('auto'|'local'|'cloud', localParts, cloud) -> 'local' | 'cloud'
   ===================================================================== */

/* что должно быть на машине для локальной сборки */
const LOCAL_PARTS = [
  ['node', 'Node.js'],
  ['npm', 'npm (node_modules/npm/bin/npm-cli.js)'],
  ['electron', 'зависимости Electron (_build/electron/node_modules)'],
  ['mobile', 'зависимости Capacitor (_build/mobile/node_modules)'],
  ['jdk', 'JDK 17 (_build/jdk или JAVA_HOME)'],
  ['sdk', 'Android SDK (_build/sdk или ANDROID_SDK_ROOT)'],
  ['keystore', 'ключ подписи APK (_build/mobile/vitalyaclicker.keystore)']
];

/* чего не хватает для локальной сборки (человекочитаемо) */
function missingLocal(parts) {
  return LOCAL_PARTS.filter(p => !(parts && parts[p[0]])).map(p => p[1]);
}
function canLocal(parts) { return missingLocal(parts).length === 0; }
function canCloud(cloud) { return !!(cloud && cloud.token && cloud.repo); }

/* состояние для админки: что доступно и что выберется по умолчанию */
function caps(parts, cloud) {
  const local = canLocal(parts), cl = canCloud(cloud);
  return {
    local: local,
    cloud: cl,
    mode: local ? 'local' : (cl ? 'cloud' : 'none'),
    missing: missingLocal(parts),
    repo: (cloud && cloud.repo) || ''
  };
}

function pickMode(requested, parts, cloud) {
  const c = caps(parts, cloud);
  const r = String(requested || 'auto').toLowerCase();
  if (['auto', 'local', 'cloud'].indexOf(r) < 0) throw new Error('Неизвестный способ сборки: ' + requested);
  if (r === 'local') {
    if (!c.local) throw new Error('На этом компьютере нет набора для сборки. Не хватает: ' + c.missing.join(', '));
    return 'local';
  }
  if (r === 'cloud') {
    if (!c.cloud) throw new Error('Сборка в облаке недоступна: нет токена и репозитория GitHub (tools/gh.config.json)');
    return 'cloud';
  }
  if (c.local) return 'local';
  if (c.cloud) return 'cloud';
  throw new Error('Собрать нечем: на этом компьютере не хватает ' + c.missing.join(', ') + ', и не настроен доступ к GitHub');
}

module.exports = { LOCAL_PARTS, missingLocal, canLocal, canCloud, caps, pickMode };
