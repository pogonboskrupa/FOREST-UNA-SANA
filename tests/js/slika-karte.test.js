'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../../static/js/slika-karte.js');
const R = f => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');

let pass = 0;
const t = (ime, fn) => { fn(); pass++; console.log('  ✔ ' + ime); };
console.log('Slika odjela / sjekačkih linija u razmjeri:');

t('razmjera: najmanja standardna u koju objekat stane (A4, 200 dpi)', () => {
  const mPoPxNa1 = 0.0254 / 200; // m papira po px
  // karta 1514 × 1889 px = 192 × 240 mm; 400 m široko → 400 / 0,192 m ≈ 1:2083 (+6 %) → 1:2500
  assert.strictEqual(S.slkRazmjera(400, 300, 1514, 1889), 2500);
  assert.strictEqual(S.slkRazmjera(800, 900, 1514, 1889), 5000); // 800 / 0,192 m × 1,06 ≈ 1:4410
  const r = S.slkRazmjera(3000, 3000, 1514, 1889);
  assert.ok(S.SLK_RAZMJERE.includes(r) && 3000 <= 1514 * mPoPxNa1 * r && 3000 <= 1889 * mPoPxNa1 * r, 'stane cijeli: 1:' + r);
});

t('mjerilo i interval izohipsi', () => {
  assert.strictEqual(S.slkMjerilo(0.5, 400), 200);     // ≤ 200 m
  assert.strictEqual(S.slkMjerilo(2, 450), 500);       // ≤ 900 m → 500
  assert.strictEqual(S.slkInterval(40), 2); assert.strictEqual(S.slkInterval(140), 10); assert.strictEqual(S.slkInterval(900), 50);
});

t('izohipse (marching squares): nagnuta ravan → prave linije na tačnom mjestu', () => {
  const nx = 5, ny = 4, z = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = 100 + 10 * i; // raste prema istoku
  const s = S.slkIzohipse(z, nx, ny, 10);
  const na = h => s.filter(x => x[4] === h);
  assert.strictEqual(na(115).length, 0, 'samo cijeli nivoi');
  assert.ok(na(110).length === 3 && na(110).every(x => Math.abs(x[0] - 1) < 1e-9 && Math.abs(x[2] - 1) < 1e-9), 'nivo 110 na i = 1');
  z[0] = NaN; assert.ok(S.slkIzohipse(z, nx, ny, 10).every(x => !(x[1] < 1 && x[0] < 1)), 'ćelija bez visine se preskače');
});

t('UI: dugmad u sjekačkim linijama, kartici poligona i izvještaju odjela; PNG u APK dijeljenju', () => {
  const H = R('index.html'), sj = R('static/js/sjekacke.js'), od = R('static/js/odjeli.js'), J = R('android/app/src/main/java/ba/spd/usf/forest/MainActivity.java');
  assert.ok(sj.includes('data-a="slika"') && sj.includes('USFSlika.podijeli({'));
  assert.ok(H.includes("_odjelSlika(${id})") && od.includes('onclick="_odjelSlikaAkt()"') && od.includes('function _odjelSlika('));
  assert.ok(H.includes('<script src="static/js/slika-karte.js"></script>') && R('sw.js').includes("'./static/js/slika-karte.js'") && R('android/copy-assets.sh').includes('static/js/slika-karte.js'));
  assert.strictEqual((J.match(/endsWith\(".png"\)\) return "image\/png"/g) || []).length, 2, 'PNG mime u oba mosta');
  const js = R('static/js/slika-karte.js');
  const imena = [...js.matchAll(/^(?:const|let|function)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
  imena.forEach(i => assert.ok(!new RegExp('(?:const|let|function)\\s+' + i + '\\b').test(H), 'sudar imena: ' + i));
});

console.log('\n' + pass + ' prošlo, 0 palo — slika u razmjeri');
