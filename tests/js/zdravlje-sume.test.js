'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const R = f => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
const HTML = R('index.html');
const T = require('../../static/js/tlo-potkornjak.js');
globalThis.btoa = globalThis.btoa || (s => Buffer.from(s, 'binary').toString('base64'));
globalThis.location = { href: 'https://x/index.html' };
const V = require('../../static/js/vegetacija.js');

let pass = 0;
const t = (ime, fn) => { try { fn(); pass++; console.log('  ✔ ' + ime); } catch (e) { console.error('  ✘ ' + ime + '\n      ' + e.message); process.exitCode = 1; } };
console.log('Zdravlje šume — tlo, potkornjak, vegetacijski indeksi:');

const niz = (od, n, f) => Array.from({ length: n }, (_, i) => { const d = new Date(Date.parse(od + 'T00:00:00Z') + i * 864e5).toISOString().slice(0, 10); return { d, ...f(i, d) }; });

t('dužina dana: 45° N solsticij ~15,6 h, zima ~8,9 h, 14,5 h početkom avgusta', () => {
  assert.ok(Math.abs(T.duzinaDana(45, 172) - 15.6) < 0.2);
  assert.ok(Math.abs(T.duzinaDana(45, 355) - 8.9) < 0.2);
  assert.ok(T.duzinaDana(45, 205) > 14.5 && T.duzinaDana(45, 225) < 14.5, 'prag dijapauze između 24. jula i 13. avgusta');
});

t('PHENIPS: rojenje tek kad zbir ≥ 140 °D I Tmax ≥ 16,5 °C', () => {
  // Tmax 15 °C: 6,7 °D/dan → 140 °D za 21 dan, ali let nikad (Tmax < 16,5)
  let r = T.phenips(niz('2026-04-01', 60, () => ({ tmax: 15, tsr: 10 })), 44.9);
  assert.strictEqual(r.pocetak, null); assert.strictEqual(Math.round(r.sumaRojenje), 140);
  // Tmax 18,3 °C → 10 °D/dan → 14. dan zbir 140 i let moguć
  r = T.phenips(niz('2026-04-01', 30, () => ({ tmax: 18.3, tsr: 12 })), 44.9);
  assert.strictEqual(r.pocetak, '2026-04-14');
});

t('PHENIPS: generacija 557 °D; nova generacija se ne zasniva poslije dijapauze', () => {
  // Tsr 22,3 → 14 °D/dan u hladu → 557 °D za 40 dana
  const dani = niz('2026-04-01', 200, () => ({ tmax: 28.3, tsr: 22.3 }));
  const r = T.phenips(dani, 44.9);
  assert.strictEqual(r.pocetak, '2026-04-07');
  assert.strictEqual(r.hlad[0].od, '2026-04-07');
  assert.strictEqual(r.hlad[0].do, '2026-05-16', 'kraj 1. generacije u hladu');
  assert.ok(r.sunce[0].do < r.hlad[0].do, 'osunčano brže');
  assert.ok(r.hlad.length >= 3 && r.hlad.length <= 4, 'ljeto: 3 generacije u toplom nizu, ne više');
  const zadnja = r.hlad[r.hlad.length - 1];
  assert.ok(zadnja.od < '2026-08-20', 'nova generacija ne počinje kad je dan < 14,5 h');
});

t('klimatologija: kvantili po dobu godine i percentil', () => {
  const vrijeme = [], vr = [];
  for (let g = 1991; g <= 2020; g++) for (let i = 0; i < 365; i++) {
    const d = new Date(Date.UTC(g, 0, 1) + i * 864e5).toISOString().slice(0, 10);
    vrijeme.push(d); vr.push(0.2 + 0.1 * Math.sin(2 * Math.PI * i / 365) + (g - 2005) * 0.002);
  }
  const kv = T.klimaKvantili(vrijeme, vr);
  assert.strictEqual(kv.length, 73); assert.ok(kv.every(q => q && q.length === 21 && q.every((v, i) => !i || v >= q[i - 1])));
  const b = kv[18]; // ~ april: sinus blizu vrha
  assert.strictEqual(T.percentil(b, b[0] - 0.01), 0); assert.strictEqual(T.percentil(b, b[20] + 0.01), 100);
  assert.ok(Math.abs(T.percentil(b, b[10]) - 50) < 1e-9, 'medijan = 50. percentil');
  assert.strictEqual(T.klasaSusnosti(8).t, 'ekstremno suho'); assert.strictEqual(T.klasaSusnosti(50).t, 'normalno'); assert.strictEqual(T.klasaSusnosti(null).t, 'bez poređenja');
});

t('rizik: let + suša korijenske zone = visok; bez leta = nizak', () => {
  const ph = { pocetak: '2026-05-01' };
  assert.strictEqual(T.rizik({ ph, letDana7: 5, dijapauza: false, percentilKorijen: 12 }).t, 'Visok');
  assert.strictEqual(T.rizik({ ph, letDana7: 5, dijapauza: false, percentilKorijen: 50 }).t, 'Umjeren');
  assert.strictEqual(T.rizik({ ph, letDana7: 0, dijapauza: false, percentilKorijen: 5 }).t, 'Nizak');
  assert.strictEqual(T.rizik({ ph: { pocetak: null }, letDana7: 3, percentilKorijen: 5 }).t, 'Nizak');
});

t('satno → dnevno, null vrijednosti preskočene', () => {
  const d = T.dnevno(['2026-09-01T00:00', '2026-09-01T12:00', '2026-09-02T00:00'], [0.2, 0.3, null]);
  assert.deepStrictEqual(Object.keys(d), ['2026-09-01']); assert.ok(Math.abs(d['2026-09-01'] - 0.25) < 1e-12);
});

t('evalscript: izvršiv, maskira oblake/snijeg, diskretne boje po pragovima', () => {
  for (const k of Object.keys(V.INDEKSI)) {
    const I = V.INDEKSI[k];
    const f = new Function(V.evalscript(k) + '\nreturn { setup, evaluatePixel };')();
    const s = f.setup(); assert.deepStrictEqual(s.input[0].bands, I.ulazi.concat(['SCL', 'dataMask'])); assert.strictEqual(s.output.bands, 4);
    assert.deepStrictEqual(f.evaluatePixel({ B02: .05, B04: .05, B08: .4, B11: .2, SCL: 9, dataMask: 1 }), [0, 0, 0, 0], k + ': oblak proziran');
    assert.deepStrictEqual(f.evaluatePixel({ B02: .05, B04: .05, B08: .4, B11: .2, SCL: 4, dataMask: 0 }), [0, 0, 0, 0], k + ': bez podatka');
    assert.strictEqual(I.boje.length, I.pragovi.length + 1, k + ': boja više od pragova');
    assert.strictEqual(new Set(I.boje).size, I.boje.length, k + ': boje različite (dekodiranje dodira)');
  }
  const nd = new Function(V.evalscript('ndvi') + '\nreturn evaluatePixel;')();
  const px = nd({ B04: 0.03, B08: 0.47, SCL: 4, dataMask: 1 }); // NDVI 0,88 → klasa 0,8–0,9
  assert.deepStrictEqual(px.slice(0, 3).map(v => Math.round(v * 255)), [0x13, 0x7a, 0x2a]);
  assert.strictEqual(px[3], 1);
});

t('WMS: okvir pločice 512 px u EPSG:3857, TIME, ID provjeren', () => {
  const b = V.okvir(1, 0, 0); // z1 s 512 px = cijeli svijet u jednoj pločici
  assert.ok(Math.abs(b[0] + 20037508.34) < 1 && Math.abs(b[3] - 20037508.34) < 1 && Math.abs(b[2] - 20037508.34) < 1 && Math.abs(b[1] + 20037508.34) < 1);
  assert.strictEqual(V.period('30', new Date('2026-09-30T10:00:00Z')), '2026-08-31/2026-09-30');
  assert.strictEqual(V.period('pg', new Date('2026-03-15T10:00:00Z')), '2025-03-01/2025-03-31');
  assert.ok(V.idIspravan('0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0') && !V.idIspravan('x"><script>') && !V.idIspravan(''));
  const u = V.urlPlocice(14, 8800, 5870, { id: '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0', sloj: 'NDVI', per: '30', ind: 'ndmi' });
  assert.ok(u.startsWith('https://sh.dataspace.copernicus.eu/ogc/wms/0b1c2d3e-') && /WIDTH=512&HEIGHT=512/.test(u) && /EVALSCRIPT=/.test(u) && /PRIORITY=leastCC/.test(u));
});

t('tlo i potkornjak: pamćenje po ćeliji 0,1° samo u USK, najbliže očitanje offline', () => {
  const r = (lat, lon, ts) => ({ lat, lon, ts });
  let m = T.zapamtiMjesto({}, r(44.751, 16.297, 1));
  m = T.zapamtiMjesto(m, r(44.95, 16.31, 2));           // druga ćelija
  assert.strictEqual(T.zapamtiMjesto(m, r(44.79, 16.31, 9))[T.celija(44.751, 16.297)].ts, 9, 'novije očitanje u istoj ćeliji zamjenjuje staro');
  m = T.zapamtiMjesto(m, r(44.77, 17.19, 3));           // Banja Luka — van USK
  assert.ok(!Object.values(m).some(x => x.lon > 17), 'van USK se ne pamti');
  assert.ok(m[T.celija(44.751, 16.297)], 'ključ = ćelija 0,1°');
  const n = T.najblizeMjesto(m, 44.752, 16.299);
  assert.ok(n && n.km < 1 && n.r.ts === 1, 'ista lokacija → to očitanje');
  assert.strictEqual(T.najblizeMjesto(m, 45.2, 15.8), null, 'dalje od 15 km → nema');
  let veliki = {}; for (let i = 0; i < 200; i++) veliki = T.zapamtiMjesto(veliki, r(44.2 + (i % 11) * 0.1, 15.7 + Math.floor(i / 11) * 0.07, i));
  assert.ok(Object.keys(veliki).length <= 160, 'ograničen broj mjesta');
});

t('pokretna legenda na karti: opis za svaku klasu svakog indeksa', () => {
  for (const k of Object.keys(V.INDEKSI)) {
    const I = V.INDEKSI[k];
    assert.strictEqual((I.klase || []).length, I.boje.length, k + ': opis za svaku boju');
    assert.ok(I.klase.every(t => typeof t === 'string' && t.length > 3));
  }
  const vj = R('static/js/vegetacija.js');
  assert.ok(vj.includes("box.id = 'veg-map-leg'") && vj.includes("'usf_veg_leg'") && vj.includes('setPointerCapture'), 'prevlačenje i pamćenje položaja');
  assert.ok(HTML.includes('#veg-map-leg {') && HTML.includes('id="veg-leg-karta"'));
});

t('UI, APK i SW: moduli uključeni, pane iznad offline podloge, ključ nije u kodu', () => {
  ['id="tp-osvjezi"', 'id="tp-rez"', 'id="uk-veg-switch"', 'id="veg-id"', '<script src="static/js/tlo-potkornjak.js">', '<script src="static/js/vegetacija.js">'].forEach(x => assert.ok(HTML.includes(x), x));
  const sw = R('sw.js'), kop = R('android/copy-assets.sh');
  ['static/js/tlo-potkornjak.js', 'static/js/vegetacija.js'].forEach(f => { assert.ok(sw.includes("'./" + f + "'"), 'SW ' + f); assert.ok(kop.includes(f), 'APK ' + f); });
  const vj = R('static/js/vegetacija.js');
  assert.ok(vj.includes("style.zIndex = '214'") && vj.includes("style.pointerEvents = 'none'") && vj.includes('_kartaKlikIzvor'));
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(vj + HTML), 'nijedan CDSE ID u repozitoriju');
  const tj = R('static/js/tlo-potkornjak.js');
  assert.ok(tj.includes("localStorage.setItem(KLJUC_ZADNJE") && tj.includes('prikaziZadnje('), 'zadnji rezultat offline');
});

console.log('\n' + pass + ' prošlo, ' + (process.exitCode ? 'IMA PALIH' : '0 palo') + ' — zdravlje šume');
