'use strict';
// Ikona "Grmeč Navigator": PWA (any + maskable), apple-touch, Android mipmap (legacy, round,
// adaptive foreground) i splash — sve iz FOREST_IKONA.png, ispravnih dimenzija.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const R = f => path.join(__dirname, '../..', f);
const dim = f => { const b = fs.readFileSync(R(f)); assert.strictEqual(b.toString('ascii', 1, 4), 'PNG', f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
let pass = 0;
const t = (ime, fn) => { try { fn(); pass++; console.log('  ✔ ' + ime); } catch (e) { console.error('  ✘ ' + ime + '\n      ' + e.message); process.exitCode = 1; } };
console.log('Ikone aplikacije:');
t('PWA i web: 192, 512, maskable 512, apple-touch 180', () => {
  assert.deepStrictEqual(dim('icon-192.png'), [192, 192]); assert.deepStrictEqual(dim('icon-512.png'), [512, 512]);
  assert.deepStrictEqual(dim('icon-maskable-512.png'), [512, 512]); assert.deepStrictEqual(dim('apple-touch-icon.png'), [180, 180]);
  const m = JSON.parse(fs.readFileSync(R('manifest.json'), 'utf8'));
  assert.ok(m.icons.some(i => i.purpose === 'maskable' && i.src === 'icon-maskable-512.png'));
  assert.ok(fs.readFileSync(R('sw.js'), 'utf8').includes("'./icon-maskable-512.png'") && fs.readFileSync(R('android/copy-assets.sh'), 'utf8').includes('icon-maskable-512.png'));
  assert.ok(fs.existsSync(R('FOREST_IKONA.png')), 'izvor ikone');
});
t('Android: mipmap po gustini, adaptivna pozadina u boji ikone, splash s ikonom', () => {
  for (const [d, s, fg] of [['mdpi', 48, 108], ['hdpi', 72, 162], ['xhdpi', 96, 216], ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432]]) {
    const p = 'android/app/src/main/res/mipmap-' + d + '/';
    assert.deepStrictEqual(dim(p + 'ic_launcher.png'), [s, s]); assert.deepStrictEqual(dim(p + 'ic_launcher_round.png'), [s, s]); assert.deepStrictEqual(dim(p + 'ic_launcher_foreground.png'), [fg, fg]);
  }
  const boje = fs.readFileSync(R('android/app/src/main/res/values/colors.xml'), 'utf8');
  assert.ok(boje.includes('<color name="ic_launcher_background">#02341C</color>') && boje.includes('<color name="colorSplash">#02341C</color>'));
  // <bitmap> na adaptivnu ikonu (mipmap-anydpi-v26 XML) ruši app pri pokretanju — samo PNG
  const splash = fs.readFileSync(R('android/app/src/main/res/drawable/splash_screen.xml'), 'utf8');
  for (const m of splash.matchAll(/<bitmap[^>]*android:src="@(\w+)\/(\w+)"/g)) {
    assert.notStrictEqual(m[1], 'mipmap', '<bitmap> ne smije koristiti @mipmap (adaptive-icon)');
    assert.ok(['drawable-nodpi', 'drawable'].some(d => fs.existsSync(R('android/app/src/main/res/' + d + '/' + m[2] + '.png'))), m[2] + '.png postoji');
  }
  assert.deepStrictEqual(dim('android/app/src/main/res/drawable-nodpi/splash_logo.png'), [384, 384]);
});
console.log('\n' + pass + ' prošlo, ' + (process.exitCode ? 'IMA PALIH' : '0 palo') + ' — ikone');
