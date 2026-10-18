/* Готовит assets/icon.png (1024) и assets/splash.png (2732) для @capacitor/assets из icon.png проекта. */
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const SRC = path.resolve(__dirname, '..', '..', 'icon.png');
const OUT = path.join(__dirname, 'assets');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const base = sharp(SRC).resize(1024, 1024, { fit: 'cover' }).png();
  await base.clone().toFile(path.join(OUT, 'icon.png'));
  await base.clone().toFile(path.join(OUT, 'icon-only.png'));
  await base.clone().toFile(path.join(OUT, 'icon-foreground.png'));

  const logo = await sharp(SRC).resize(760, 760, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: { r: 11, g: 14, b: 20, alpha: 1 } } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(path.join(OUT, 'splash.png'));

  console.log('assets: ' + OUT);
  for (const f of fs.readdirSync(OUT)) console.log('  ' + f + ' (' + fs.statSync(path.join(OUT, f)).size + ' b)');
})();
