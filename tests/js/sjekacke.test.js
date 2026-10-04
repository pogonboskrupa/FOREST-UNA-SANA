'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../../static/js/sjekacke.js');
const R = f => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');

let pass = 0;
const testovi = [];
const t = (ime, fn) => testovi.push([ime, fn]);
console.log('Sjekačke linije:');

// Pravougaonik 300 m (istok–zapad) × 200 m (sjever–jug) oko 44,8° N.
const lat0 = 44.8, lon0 = 16.1, L = S.slLokalno(lat0, lon0);
const pr = (x, y) => L.n(x, y);
const kvadrat = [pr(-150, -100), pr(150, -100), pr(150, 100), pr(-150, 100)];
const dist = (a, b) => { const p = L.u(a[0], a[1]), q = L.u(b[0], b[1]); return Math.hypot(p[0] - q[0], p[1] - q[1]); };

t('pad prema jugu: linije sjever–jug, razmak 60 m, cijela visina poligona', () => {
  const r = S.slLinije(kvadrat, 180, 60);
  assert.strictEqual(r.linije.length, 4, '300 m / 60 m → 4 unutrašnje linije');
  r.linije.forEach(l => { assert.ok(Math.abs(l.duz - 200) < 0.5, 'dužina 200 m'); assert.ok(l.dno[0] < l.vrh[0], 'dno je južno (nizbrdo)'); });
  const x = r.linije.map(l => L.u(l.dno[0], l.dno[1])[0]);
  for (let i = 1; i < x.length; i++) assert.ok(Math.abs(Math.abs(x[i] - x[i - 1]) - 60) < 0.01, 'razmak tačno 60 m');
  assert.ok(Math.abs(Math.abs(x[0]) - 90) < 0.01, 'L1 je 60 m od ruba');
  assert.strictEqual(r.polja.length, 5); assert.ok(Math.abs(r.polja.reduce((s, f) => s + f.ha, 0) - 6) < 0.01, 'zbir polja = 6 ha');
  assert.ok(Math.abs(r.polja[0].ha - 1.2) < 0.01 && Math.abs(r.polja[4].sirina - 60) < 0.01);
});

t('L1 počinje s lijeve strane gledano uzbrdo', () => {
  // pad na jug → uzbrdo je sjever → lijevo je zapad
  const r = S.slLinije(kvadrat, 180, 60);
  assert.ok(L.u(r.linije[0].dno[0], r.linije[0].dno[1])[0] < 0, 'L1 na zapadnoj strani');
  // pad na sjever → uzbrdo je jug → lijevo je istok
  const r2 = S.slLinije(kvadrat, 0, 60);
  assert.ok(L.u(r2.linije[0].dno[0], r2.linije[0].dno[1])[0] > 0, 'L1 na istočnoj strani');
});

t('bez optimizacije: prva linija tačno razmak od ruba, ostatak u zadnjem polju', () => {
  const r = S.slLinije(kvadrat, 180, 70, false);
  assert.strictEqual(r.linije.length, 4); assert.strictEqual(r.opt, null);
  assert.ok(Math.abs(r.polja[0].sirina - 70) < 0.01, 'prva linija 70 m od ruba');
  assert.ok(Math.abs(r.polja[r.polja.length - 1].sirina - 20) < 0.01, 'zadnje polje 300 − 4·70 = 20 m');
});

t('optimizacija: preusko zadnje polje → zadnja polja malo uža, sva ≥ 80 % razmaka', () => {
  const r = S.slLinije(kvadrat, 180, 70);
  const sir = r.polja.map(f => +f.sirina.toFixed(2));
  assert.deepStrictEqual(sir, [70, 57.5, 57.5, 57.5, 57.5]);
  assert.strictEqual(r.opt.nacin, 'suzeno'); assert.strictEqual(r.opt.k, 4);
  assert.ok(Math.abs(r.polja[0].sirina - 70) < 0.01, 'prva linija i dalje puni razmak od ruba');
  // 250 m / 60: ostatak 10 m, ni sa 4 polja nije ≥ 48 m → ostatak na zadnja 3 (šira)
  const x = S.slRaspored(250, 60);
  assert.strictEqual(x.info.nacin, 'prošireno'); assert.deepStrictEqual(x.sir.map(v => +v.toFixed(2)), [60, 63.33, 63.33, 63.33]);
  // ostatak 50 m od 60 (≥ 75 %) ostaje kako jeste
  assert.strictEqual(S.slRaspored(290, 60).info, null);
  // suženje u 2 polja: 340 / 60 → ostatak 40 → (340 − 4·60)/2 = 50 ≥ 48
  assert.deepStrictEqual(S.slRaspored(340, 60).sir.map(v => +v.toFixed(2)), [60, 60, 60, 60, 50, 50]);
});

t('konkavni poligon (U oblik): bez optimizacije dva dijela, s optimizacijom nema linija < 100 m', () => {
  const U = [pr(-150, -100), pr(150, -100), pr(150, 100), pr(50, 100), pr(50, -20), pr(-50, -20), pr(-50, 100), pr(-150, 100)];
  const raw = S.slLinije(U, 180, 60, false);
  // linije na x = -90, -30, 30, 90: dvije pune (200 m), dvije kroz zaliv (80 m)
  assert.strictEqual(raw.linije.length, 4); assert.ok(Math.abs(raw.linije.reduce((s, l) => s + l.duz, 0) - 560) < 1);
  const r = S.slLinije(U, 180, 60);
  assert.ok(r.linije.length && r.linije.every(l => l.duz >= 100), 'sve linije ≥ 100 m');
  assert.deepStrictEqual(r.linije.map(l => l.br), r.linije.map((_, i) => i + 1), 'redni brojevi bez rupa');
  const C = [pr(-150, -100), pr(150, -100), pr(150, 100), pr(-150, 100), pr(-150, 40), pr(100, 40), pr(100, -40), pr(-150, -40)];
  assert.ok(S.slLinije(C, 180, 50, false).linije.some(l => l.dio === 1), 'dio 1 kad prava dvaput ulazi u poligon');
  // mali poligon (sve tetive < 100 m): prag je 90 % najduže tetive, linije ostaju
  const mali = [pr(-150, -40), pr(150, -40), pr(150, 40), pr(-150, 40)];
  assert.strictEqual(S.slLinije(mali, 180, 60).linije.length, 4);
});

t('brisanje linije: partije se spajaju, ostale linije se prenumerišu, ključ stabilan', () => {
  const r = S.slLinije(kvadrat, 180, 60);
  assert.strictEqual(r.linije.length, 4);
  const k2 = r.linije[1].k;
  const b = S.slLinije(kvadrat, 180, 60, true, [k2]);
  assert.deepStrictEqual(b.linije.map(l => l.br), [1, 2, 3], 'L3 i L4 postaju L2 i L3');
  assert.deepStrictEqual(b.linije.map(l => l.k), [r.linije[0].k, r.linije[2].k, r.linije[3].k], 'ključ = položaj, ne broj');
  assert.strictEqual(b.polja.length, 4); assert.ok(Math.abs(b.polja[1].sirina - 120) < 0.01, 'spojena partija 120 m');
  assert.strictEqual(b.opt.obrisano, 1);
});

t('krivudav poligon: prva linija nije kratka, nema malih komada', () => {
  // lijevi kraj se sužava u šiljak (x −300 → −150), desno pun pravougaonik
  const klin = [pr(-300, 0), pr(-150, -100), pr(150, -100), pr(150, 100), pr(-150, 100)];
  const raw = S.slLinije(klin, 180, 60, false), r = S.slLinije(klin, 180, 60);
  assert.ok(raw.linije[0].duz < 100, 'bez optimizacije prva linija 60 m od šiljka je kratka: ' + raw.linije[0].duz.toFixed(0));
  assert.ok(r.linije[0].duz >= 99.5, 'prva linija pomjerena do pune dužine: ' + r.linije[0].duz.toFixed(0));
  assert.ok(r.opt.rubL > 60 && r.opt.rubL <= 96, 'pomak najviše 1,6 × razmak: ' + r.opt.rubL);
  assert.ok(r.polja.every(f => f.sirina >= 48 - 1e-6 && f.sirina <= 96 + 1e-6), 'sve partije 0,8–1,6 × širine');
  // usjek s boka ostavlja tanak pojas (10 m) uz gornju granicu: linije ga sijeku u kratke komade
  const izb = [pr(-150, -100), pr(150, -100), pr(150, 60), pr(-60, 60), pr(-60, 90), pr(150, 90), pr(150, 100), pr(-150, 100)];
  const r2 = S.slLinije(izb, 180, 60);
  assert.ok(r2.linije.every(l => l.duz >= 30), 'nijedan komad kraći od pola širine');
  const raw2 = S.slLinije(izb, 180, 60, false);
  assert.ok(raw2.linije.some(l => l.duz < 30) && r2.opt.izbaceno >= 1, 'mali komad izbačen');
});

t('brojanje s desna: obrnuti redni brojevi linija i partija, isti položaji', () => {
  const l = S.slLinije(kvadrat, 180, 60), d = S.slLinije(kvadrat, 180, 60, true, [], true);
  assert.deepStrictEqual(d.linije.map(x => x.br), [1, 2, 3, 4], 'sortirano po broju');
  assert.deepStrictEqual(d.linije.map(x => x.k), l.linije.map(x => x.k).reverse(), 'L1 je sad krajnja desna');
  assert.deepStrictEqual(d.polja.map(f => f.br), [1, 2, 3, 4, 5]);
  assert.ok(Math.abs(d.polja[0].ha - l.polja[l.polja.length - 1].ha) < 1e-9);
  // pad na jug → uzbrdo sjever → desno je istok: L1 na istočnoj strani
  assert.ok(L.u(d.linije[0].dno[0], d.linije[0].dno[1])[0] > 0);
});

t('izlomljena linija: dužina po segmentima, vodič prati najbliži segment', () => {
  const lin = { dno: pr(0, -100), vrh: pr(0, 100), geo: [pr(0, -100), pr(20, 0), pr(0, 100)] };
  assert.ok(Math.abs(S.slDuzina(S.slGeo(lin)) - 2 * Math.hypot(20, 100)) < 0.01);
  assert.strictEqual(S.slGeo({ dno: [1, 2], vrh: [3, 4] }).length, 2, 'ravna: dno i vrh');
  // tačka 5 m zapadno od loma: lijevo od linije (gledano uzbrdo) → bocno < 0
  let v = S.slVodic(lin, ...pr(15, 0));
  assert.ok(v.bocno < 0 && Math.abs(Math.abs(v.bocno) - 5 * Math.cos(Math.atan(20 / 100))) < 0.05, 'bočno ' + v.bocno);
  assert.ok(Math.abs(v.duz - Math.hypot(20, 100)) < 1, 'na pola puta');
  v = S.slVodic(lin, ...pr(0, -130));
  assert.ok(v.duz < 0, 'ispod dna'); v = S.slVodic(lin, ...pr(0, 140)); assert.ok(v.duz > v.len, 'iznad vrha');
});

t('odstupanje od pada i ocjena pravca (po izohipsi)', () => {
  assert.strictEqual(S.slOdstupanje(180, 180), 0); assert.strictEqual(S.slOdstupanje(0, 180), 0, 'smjer linije nebitan');
  assert.strictEqual(S.slOdstupanje(90, 180), 90); assert.strictEqual(S.slOdstupanje(225, 180), 45);
  const o = S.slOcjenaPravca([{ dev: 10, nagib: 15 }, { dev: 70, nagib: 15 }, { dev: 80, nagib: 12 }, { dev: 85, nagib: 4 }]);
  assert.ok(Math.abs(o.udio - 2 / 3) < 1e-9 && o.max === 80, 'blago (< 8 %) se ne broji');
  assert.strictEqual(S.slOcjenaPravca([{ dev: 80, nagib: 4 }]), null);
});

t('lepeza: susjedi skreću postepeno, partija se ne sabija ispod 60 %', () => {
  // lijeva polovina padine gleda na jug (180°), desna naglo na istok (90°)
  const zelj = [180, 180, 180, 180, 90, 90, 90, 90], pola = zelj.map(() => 300);
  const az = S.slLepeza(zelj, pola, 60, 180);
  const dmax = Math.asin(0.4 * 60 / 300) * 180 / Math.PI;
  for (let i = 1; i < az.length; i++) assert.ok(Math.abs(az[i] - az[i - 1]) <= dmax + 1e-9, 'skok ' + (az[i] - az[i - 1]).toFixed(2) + '° > ' + dmax.toFixed(2));
  assert.ok(az[0] > az[7], 'lijevo bliže jugu, desno bliže istoku');
  assert.ok(Math.abs(az[0] - 180) <= 45 && Math.abs(az[7] - 90) <= 45, 'obje strane < 45° od svog pada (ne po izohipsi): ' + az.map(v => v.toFixed(0)).join(' '));
  // jednolična padina → sve paralelno
  assert.deepStrictEqual(S.slLepeza([150, 150, 150], [200, 200, 200], 60, 150).map(v => Math.round(v)), [150, 150, 150]);
  // prelaz preko 0°/360°
  const w = S.slLepeza([355, 5], [100, 100], 60, 0); assert.ok(Math.abs(((w[0] - w[1] + 540) % 360) - 180) <= 10.1);
});

t('najmanji razmak dvije linije', () => {
  assert.ok(Math.abs(S.slMinRazmak([pr(0, -100), pr(0, 100)], [pr(60, -100), pr(60, 100)]) - 60) < 0.01);
  assert.ok(S.slMinRazmak([pr(0, -100), pr(0, 100)], [pr(60, -100), pr(10, 100)]) < 10.1, 'konvergencija na kraju');
  const f = S.slLepeza([180, 90], [300, 300], 60, 180, [0.5]);
  assert.ok(Math.abs(f[0] - f[1]) <= Math.asin(0.4 * 60 / 300) * 180 / Math.PI * 0.5 + 1e-9, 'faktor smanjuje skretanje');
});

t('lepeza: prava kroz sjeme odsječena granicom', () => {
  const seg = S.slLinijaKroz(kvadrat, pr(0, 0), 135); // jugoistok
  const a = L.u(seg[0][0], seg[0][1]), b = L.u(seg[1][0], seg[1][1]);
  assert.ok(Math.abs(a[1] + 100) < 0.5 && Math.abs(a[0] - 100) < 0.5, 'dno na jugoistoku: ' + a.map(v => v.toFixed(1)));
  assert.ok(Math.abs(b[1] - 100) < 0.5 && Math.abs(b[0] + 100) < 0.5, 'vrh na sjeverozapadu');
  assert.strictEqual(S.slLinijaKroz(kvadrat, pr(500, 500), 180), null, 'sjeme van poligona');
});

t('površine partija između krivih linija = površina poligona', () => {
  const g1 = [pr(-90, -100), pr(-60, 0), pr(-90, 100)], g2 = [pr(30, -100), pr(30, 100)];
  const ha = S.slPoljaTeren(kvadrat, [g1, g2]);
  assert.strictEqual(ha.length, 3); assert.ok(Math.abs(ha.reduce((a, b) => a + b, 0) - 6) < 0.05, 'zbir 6 ha');
  // lijeva partija: linija ide −90 → −60 → −90, prosjek −75 → (150 − 75)·200 m = 1,5 ha
  assert.ok(Math.abs(ha[0] - 1.5) < 0.1 && Math.abs(ha[2] - 2.4) < 0.1, ha.map(v => v.toFixed(2)).join('/'));
});

t('dominantan pad i dosljednost', () => {
  // visina raste prema sjeveru (dzy > 0) → pad na jug 180°
  const d = S.slDominantniPad(Array.from({ length: 20 }, () => [0, 0.5]));
  assert.ok(Math.abs(d.azimut - 180) < 1e-9 && d.dosljednost > 0.99 && Math.abs(d.nagibSt - Math.atan(0.5) * 180 / Math.PI) < 1e-9);
  const g = S.slDominantniPad([[0, 0.5], [0, -0.5], [0.01, 0], [NaN, 1]]);
  assert.ok(g.dosljednost < 0.1, 'greben: suprotni padovi');
  assert.strictEqual(S.slDominantniPad([[0, 0]]), null);
});

t('GPS vodič: bočni otklon i položaj duž linije gledano uzbrdo', () => {
  const lin = { dno: pr(0, -100), vrh: pr(0, 100) }; // uzbrdo = sjever
  let v = S.slVodic(lin, ...pr(4, 0));
  assert.ok(Math.abs(v.bocno - 4) < 0.01 && Math.abs(v.duz - 100) < 0.01 && Math.abs(v.len - 200) < 0.01, 'istočno = desno');
  v = S.slVodic(lin, ...pr(-7, -120));
  assert.ok(Math.abs(v.bocno + 7) < 0.01 && v.duz < 0, 'zapadno = lijevo, ispod dna');
});

t('UI: Planiranje ispod Tematske karte, panel, vodič, dijeljenje KML-om', () => {
  const H = R('index.html');
  const i = H.indexOf('id="mc-tematska"'), j = H.indexOf('id="mc-sjekacke"'), k = H.indexOf('<h3>Podaci i karte</h3>');
  assert.ok(i > 0 && j > i && j < k, 'kartica odmah ispod Tematske karte');
  ['id="sjekacke-panel"', 'id="sl-vodic"', 'id="sl-ured"', "'sjekacke-panel']", '<script src="static/js/sjekacke.js">', "USFSjek.izKljuca('m:${m.id}')", "USFSjek.izKljuca('k:${id}')"].forEach(x => assert.ok(H.includes(x), x));
  assert.ok(H.indexOf('<script src="static/js/nagib-poligon.js">') < H.indexOf('<script src="static/js/sjekacke.js">'), 'DEM pomoćne funkcije prije');
  const js = R('static/js/sjekacke.js');
  assert.ok(js.includes("style.pointerEvents = 'none'") && js.includes('_kartaKlikIzvor') && js.includes('name="usf_oznaka"'), 'KML s natpisima linija');
  assert.ok(!H.includes('sl-uvoz') && !H.includes('izOdjela') && !H.includes('Sjekačke partije uzbrdo'), 'bez uvoza, odjela pod centrom i uvodnog opisa');
  assert.ok(H.includes('extData.usf_oznaka') && H.includes('class="kml-oznaka"'), 'Učitaj KML prikazuje natpise stalno');
  assert.ok(R('static/js/nagib-poligon.js').includes('window.npVisinaNa = visinaNa'));
  assert.ok(R('sw.js').includes("'./static/js/sjekacke.js'") && R('android/copy-assets.sh').includes('static/js/sjekacke.js'));
});

(async () => {
  for (const [ime, fn] of testovi) {
    try { await fn(); pass++; console.log('  ✔ ' + ime); } catch (e) { console.error('  ✘ ' + ime + '\n      ' + e.message); process.exitCode = 1; }
  }
  console.log('\n' + pass + ' prošlo, ' + (process.exitCode ? 'IMA PALIH' : '0 palo') + ' — sjekačke linije');
})();
