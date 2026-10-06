'use strict';
// Offline pločice pri zumiranju: <img> preko appassets/mbtiles (paralelno, van glavne niti)
// umjesto sinhronog JS→Java poziva po pločici; SW ih ne smije presresti.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const R = f => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
const H = R('index.html'), J = R('android/app/src/main/java/ba/spd/usf/forest/MainActivity.java'), SW = R('sw.js');
let pass = 0;
const t = (ime, fn) => { fn(); pass++; console.log('  ✓ ' + ime); };
console.log('Offline pločice — brzi prikaz:');
const tijelo = (src, pocetak) => { const i = src.indexOf(pocetak); assert.ok(i >= 0, pocetak); let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(i, j + 1); };

t('SW preskače /mbtiles/ prije svih grana (inače pločice prazne i keš raste)', () => {
  const f = SW.slice(SW.indexOf("self.addEventListener('fetch'"));
  const i = f.indexOf("if (url.includes('/mbtiles/')) return;");
  assert.ok(i > 0 && i < f.indexOf('respondWith'));
});

t('Java: SW klijent i WebViewClient serviraju pločice; nema pločice = 204', () => {
  const sw = J.slice(J.indexOf('new androidx.webkit.ServiceWorkerClientCompat()'), J.indexOf('webView.addJavascriptInterface'));
  assert.ok(sw.includes('interceptMbtilesTile(request.getUrl())'));
  assert.ok(J.includes('204, "No Content"') && J.includes('"Cache-Control", "max-age=86400"'));
});

t('Java: paralelni čitači i zapamćena orijentacija Y', () => {
  const tb = tijelo(J, 'private byte[] tileBytes(');
  assert.ok(tb.includes('citac(id)') && tb.includes('s.yRed') && tb.includes('s.sql'));
  assert.ok(J.includes('private static final int CITACA = 3;') && tijelo(J, 'private synchronized SQLiteDatabase[] noviCitaci(').includes('glavna.getPath()'));
  assert.ok(tijelo(J, 'public boolean deleteMap(String id)').includes('zatvoriCitace(mbtilesCitaci.remove(id), 0)'));
  assert.ok(tijelo(J, 'private void trajnaKopija(String id, KopijaKarte k)').includes('zatvoriCitace(mbtilesCitaci.remove(id), 5000)'));
});

t('JS: sloj bez sinhronog mosta po pločici, puni se na kraju zumiranja, rezerva samo kad most ima pločicu', () => {
  const sloj = H.slice(H.indexOf('const _NativeSqlTileLayer'), H.indexOf('function _nativeSqlmapAdd('));
  assert.ok(!sloj.includes('AndroidMbtiles.getTile(') && !/getContext\('2d'/.test(sloj));
  assert.ok(sloj.includes('img.src = this.getTileUrl(coords)') && sloj.includes("img.decoding = 'async'"));
  const most = sloj.slice(sloj.indexOf('const most'), sloj.indexOf('if (this._mostSamo)'));
  assert.ok(most.indexOf("if (!uri) { done(null, img); return; }") < most.indexOf('this._mostSamo = true'), '204 ne prebacuje na most');
  assert.ok(tijelo(H, 'function _nativeSqlmapAdd(info)').includes('updateWhenZooming:false'));
});
console.log(`  ${pass} testova prošlo`);
