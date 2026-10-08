'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const R = f => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');

let pass = 0;
const t = (ime, fn) => { fn(); pass++; console.log('  ✔ ' + ime); };
console.log('Desktop verzija (GitHub Pages / PWA):');

t('pages.yml: isti paket kao APK (copy-assets.sh), objavljuje taj folder, build-apk.yml netaknut', () => {
  const y = R('.github/workflows/pages.yml');
  assert.ok(y.includes('branches: [codex-forest]') && y.includes('bash android/copy-assets.sh'));
  assert.ok(y.includes('path: android/app/src/main/assets') && y.includes('actions/deploy-pages@v4') && y.includes('pages: write') && y.includes('id-token: write'));
  assert.ok(y.includes('.nojekyll'));
  assert.ok(!R('.github/workflows/build-apk.yml').includes('deploy-pages'), 'APK workflow ne objavljuje Pages');
});

t('manifest: instalabilan na podputanji (relativni id/start_url/scope), ikone i maskable', () => {
  const m = JSON.parse(R('manifest.json'));
  assert.strictEqual(m.id, './'); assert.strictEqual(m.start_url, './index.html'); assert.strictEqual(m.scope, './');
  assert.strictEqual(m.display, 'standalone');
  assert.ok(m.icons.some(i => i.sizes === '192x192') && m.icons.some(i => i.sizes === '512x512') && m.icons.some(i => i.purpose === 'maskable'));
  assert.ok(!/(src|href)="\/[a-z]/.test(R('index.html')) && !/'\/static|"\/static/.test(R('sw.js')), 'nema apsolutnih putanja koje bi pukle na /FOREST-UNA-SANA/');
  assert.ok(R('index.html').includes("navigator.serviceWorker.register('./sw.js')"));
});

t('veliki ekran: zaglavlje panela i donja navigacija poravnati s već centriranim tijelom (680 px)', () => {
  const H = R('index.html'), i = H.indexOf('@media (min-width: 700px) {\n  .usf-panel .up-hdr');
  assert.ok(i > 0, 'media query postoji');
  const blok = H.slice(i, H.indexOf('\n}\n', i) + 3);
  assert.ok(blok.includes('.usf-panel .up-hdr') && blok.includes('#main-tabs') && blok.includes('calc((100% - 680px) / 2)') && !blok.includes('.up-body'), 'tijelo se ne dira (već ima width:min(680px…))');
  assert.ok(i > H.indexOf('#main-tabs {') && i > H.indexOf('.usf-panel .up-hdr {'), 'poslije osnovnih pravila (inače ih ona nadjačaju)');
  assert.ok(H.includes('.usf-panel .up-body { width:min(680px,calc(100% - 32px)); margin:0 auto; box-sizing:border-box; }'), 'postojeće centriranje tijela ostaje');
  assert.ok(H.includes('.usf-panel .up-body { flex:1; overflow-y:auto; padding:14px 14px calc(86px'), 'osnovni (mobilni) padding isti');
});

t('Drive preuzimanje: APK most ima prednost, na računaru direktan link u novom tabu', () => {
  const H = R('index.html');
  for (const [fn, most] of [['_dkPreuzmi', 'AndroidKarta.preuzmi)'], ['_dkmlPreuzmi', 'AndroidKarta.preuzmiKml)']]) {
    const f = H.slice(H.indexOf('async function ' + fn + '('), H.indexOf('\n}\n', H.indexOf('async function ' + fn + '(')));
    const iDesk = f.indexOf('_dkRacunar('), iApk = f.indexOf('AndroidKarta.' + (fn === '_dkmlPreuzmi' ? 'preuzmiKml' : 'preuzmi') + '(id');
    assert.ok(iDesk > 0 && iApk > iDesk && f.includes("typeof AndroidKarta === 'undefined' || !" + most), fn + ': desktop grana samo kad nema mosta');
  }
  const r = H.slice(H.indexOf('function _dkRacunar('), H.indexOf('async function _dkPreuzmi('));
  assert.ok(r.includes("a.target = '_blank'") && r.includes("rel = 'noopener noreferrer'") && r.includes('USFDriveKarte.urlPreuzimanja(fileId)') && !r.includes('fetch('));
});

console.log('\n' + pass + ' prošlo, 0 palo — desktop');
