const assert = require('assert');
const fs = require('fs');
const P = require('../../static/js/mjerenja-profil.js');
let pass = 0;
const t = async (n, f) => { await f(); pass++; console.log('  ✔ ' + n); };
const HTML = fs.readFileSync(__dirname + '/../../index.html', 'utf8');
(async () => {
  console.log('Mjerenja — visinski profil:');
  const pts = [{ lat: 44.8, lng: 16.1 }, { lat: 44.8, lng: 16.113 }]; // ≈ 1 km
  await t('uzorkovanje: jednaki koraci, kumulativna dužina, krajevi', () => {
    const u = P.uzorkuj(pts, 100, 10), uk = P.hav(pts[0], pts[1]);
    assert.ok(Math.abs(u[u.length - 1].d - uk) < 1e-6 && u[0].d === 0);
    assert.ok(u.length >= 90 && u.length <= 102);
    assert.ok(u.every((q, i) => !i || q.d > u[i - 1].d));
    assert.deepStrictEqual(P.uzorkuj([pts[0], pts[0]]), []);
  });
  await t('rupe u visinama se interpoliraju; premalo podataka = nije ok', () => {
    const r = P.popuni([100, NaN, NaN, 130, 140]);
    assert.deepStrictEqual(r.h.map(Math.round), [100, 110, 120, 130, 140]); assert.ok(r.ok && Math.abs(r.nedostaje - 0.4) < 1e-9);
    assert.strictEqual(P.popuni([NaN, 5, NaN]).ok, false);
  });
  await t('statistika: uspon/silazak s pragom, nagib 25 % ⇒ klasa 20–30', async () => {
    // uspon 20 % na 500 m (+100 m), pa ravno
    const p = await P.racunaj([{ lat: 44.8, lng: 16.1 }, { lat: 44.8, lng: 16.1 + 0.0063 }], async (la, lo) => (lo - 16.1) / 0.0063 * 125, { maxN: 50 });
    const d = p.st.duzina; assert.ok(d > 480 && d < 520, d);
    assert.ok(Math.abs(p.st.uspon - 125) < 4 && p.st.silazak === 0, 'uspon ' + p.st.uspon);
    assert.ok(Math.abs(p.st.prosjek - 125 / d * 100) < 0.5 && p.st.prosjek > 24 && p.st.prosjek < 26);
    assert.ok(p.st.poKlasi[2] > 0.9, 'klasa 20–30: ' + p.st.poKlasi);
    assert.ok(Math.abs(p.st.poKlasi.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  });
  await t('šum ispod praga 2 m se ne računa kao uspon', () => {
    const d = [0, 10, 20, 30, 40], h = [100, 101, 100, 101, 100];
    const s = P.statistika(d, h); assert.strictEqual(s.uspon, 0); assert.strictEqual(s.silazak, 0);
  });
  await t('bez DEM-a: racunaj vraća ok:false', async () => {
    const p = await P.racunaj(pts, async () => NaN); assert.strictEqual(p.ok, false);
  });
  await t('SVG: boja po klasi nagiba, mreža, kursor, min/maks', async () => {
    const p = await P.racunaj(pts, async (la, lo) => 800 + Math.sin((lo - 16.1) * 400) * 40, { maxN: 80 });
    const s = P.svg(p, 340, 150, { bojaNagib: true });
    assert.ok(s.includes('class="pf-l"') && s.includes('pf-kur') && s.includes('▲') && s.includes('▼') && s.includes('pf-g'));
    assert.ok(P.svg(p, 340, 150, { bojaNagib: false }).includes('<polyline'));
  });
  await t('integracija: skripta, SW, pločice, natpisi segmenata, dugme Profil', () => {
    assert.ok(HTML.includes('<script src="static/js/mjerenja-profil.js">'));
    assert.ok(fs.readFileSync(__dirname + '/../../sw.js', 'utf8').includes('mjerenja-profil.js'));
    assert.ok(fs.readFileSync(__dirname + '/../../android/copy-assets.sh', 'utf8').includes('mjerenja-profil.js'));
    ['function _msrKpi(', '_msrProfilTrazi()', 'class="msr-seg uk"', "_msrProfilSaved('${m.id}')", '#pf-sheet'].forEach(x => assert.ok(HTML.includes(x), x));
  });
  console.log(`\n${pass} prošlo — mjerenja-profil`);
})().catch(e => { console.error(e); process.exit(1); });
