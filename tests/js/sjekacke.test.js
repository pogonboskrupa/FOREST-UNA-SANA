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

t('podjela poligona sjekačkom linijom: lijevo/desno gledano uzbrdo, zbir = cijeli', () => {
  const pov = r => { const P = r.map(q => L.u(q[0], q[1])); let a = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += P[j][0] * P[i][1] - P[i][0] * P[j][1]; return Math.abs(a) / 2; };
  // izlomljena linija od juga (dno) do sjevera (vrh): uzbrdo = sjever → desno = istok
  const d = S.slPodijeli(kvadrat, [pr(30, -100), pr(50, 0), pr(30, 100)]);
  assert.ok(Math.abs(pov(d.lijevo) - 38000) < 1 && Math.abs(pov(d.desno) - 22000) < 1, pov(d.lijevo) + ' / ' + pov(d.desno));
  assert.ok(S.slUnutra(pr(100, 0), d.desno) && S.slUnutra(pr(-100, 0), d.lijevo));
  // linija ne dodiruje granicu tačno (GPS): krajevi se prislone na granicu
  const e = S.slPodijeli(kvadrat, [pr(0, -95), pr(0, 96)]);
  assert.ok(Math.abs(pov(e.lijevo) - 30000) < 1 && Math.abs(pov(e.desno) - 30000) < 1);
});

t('drugi pad: strana prema liniji prije/poslije (i bez susjeda na jednoj strani)', () => {
  const linija = x => [pr(x, -100), pr(x, 100)]; // L1..L5 na x = −90, −30, 30, 90 …
  const pod = S.slPodijeli(kvadrat, linija(30)); // podjela po L3 (x = 30), uzbrdo sjever → desno = istok
  const s = S.slZonaStrane(pod, linija(-30), linija(90));
  assert.deepStrictEqual(s, { prije: 'L', poslije: 'D' }, 'L2 (zapad) je lijevo, L4 (istok) desno');
  assert.ok(S.slUnutra(pr(-30, 0), pod[s.prije === 'L' ? 'lijevo' : 'desno']) && S.slUnutra(pr(90, 0), pod[s.poslije === 'L' ? 'lijevo' : 'desno']));
  assert.deepStrictEqual(S.slZonaStrane(pod, null, linija(90)), { prije: 'L', poslije: 'D' }, 'prva linija: samo sljedeća');
  assert.deepStrictEqual(S.slZonaStrane(pod, linija(-30), null), { prije: 'L', poslije: 'D' }, 'zadnja linija: samo prethodna');
  assert.strictEqual(S.slZonaStrane(pod, null, null), null, 'bez susjeda → stari kriterij');
  assert.strictEqual(S.slZonaStrane(null, linija(-30), null), null);
  const J = R('static/js/sjekacke.js');
  assert.ok(J.includes("'⬅ Prema liniji prije — '") && J.includes("'➡ Prema liniji poslije — '") && J.includes('p.zona = { lid, strana: st, smjer,'));
});

t('površina partije uz liniju: od granice do L1, L1–L2 …; brojanje s desna obrnuto', () => {
  assert.deepStrictEqual(S.slSpojiTrake([[1, 2, 0.1], [0.2, 3]]).map(v => +v.toFixed(2)), [1, 2, 0.3, 3], 'rub dijelova je ista partija');
  assert.deepStrictEqual(S.slTrakeULinije([1, 2, 3], false), { poLiniji: [1, 2], ostatak: 3 });
  assert.deepStrictEqual(S.slTrakeULinije([1, 2, 3], true), { poLiniji: [2, 3], ostatak: 1 });
  // stvarna linija koja ne dotiče granicu računa se kao produžena do granice
  const ha = S.slPoljaTeren(kvadrat, [[pr(-90, -80), pr(-90, 70)], [pr(-30, -100), pr(-30, 100)]]);
  assert.ok(Math.abs(ha[0] - 1.2) < 0.05 && Math.abs(ha[1] - 1.2) < 0.05, ha.map(v => v.toFixed(2)).join('/'));
});

t('GPS trag: uprošćavanje čuva oblik, izbacuje šum na pravcu', () => {
  const g = []; for (let y = -100; y <= 100; y += 5) g.push(pr((y % 10 === 0 ? 0.5 : -0.5), y));
  const u = S.slUprosti(g, 2);
  assert.ok(u.length === 2 && Math.abs(S.slDuzina(u) - 200) < 0.5, 'cik-cak ±0,5 m → prava (' + u.length + ')');
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
  ['id="sjekacke-panel"', 'id="sl-vodic"', 'id="sl-ured"', '.sl-strel', '.sl-zona', "'sjekacke-panel']", '<script src="static/js/sjekacke.js">', "USFSjek.izKljuca('m:${m.id}')", "USFSjek.izKljuca('k:${id}')"].forEach(x => assert.ok(H.includes(x), x));
  assert.ok(H.indexOf('<script src="static/js/nagib-poligon.js">') < H.indexOf('<script src="static/js/sjekacke.js">'), 'DEM pomoćne funkcije prije');
  const js = R('static/js/sjekacke.js');
  assert.ok(js.includes("style.pointerEvents = 'none'") && js.includes('_kartaKlikIzvor') && js.includes('name="usf_oznaka"'), 'KML s natpisima linija');
  assert.ok(!H.includes('sl-uvoz') && !H.includes('izOdjela') && !H.includes('Sjekačke partije uzbrdo'), 'bez uvoza, odjela pod centrom i uvodnog opisa');
  assert.ok(H.includes('extData.usf_oznaka') && H.includes('class="kml-oznaka"'), 'Učitaj KML prikazuje natpise stalno');
  assert.ok(R('static/js/nagib-poligon.js').includes('window.npVisinaNa = visinaNa'));
  assert.ok(R('sw.js').includes("'./static/js/sjekacke.js'") && R('android/copy-assets.sh').includes('static/js/sjekacke.js'));
});

t('vodič snima pod zaključanim ekranom (native servis), površina samo u info linije', () => {
  const H = R('index.html'), js = R('static/js/sjekacke.js');
  // zajednički destruktivni bafer: drain predaje tačke svim snimanjima, servis se ne gasi dok ijedno traje
  assert.ok(/function _anyRecOn\(\) \{ return _tragOn \|\| _bgSnimanja\.size > 0; \}/.test(H));
  assert.ok(/if \(!_anyRecOn\(\)\) return;\n  if \(_drainNativeGpsBuffer\._busy/.test(H) && H.includes('_bgPredaj(pts);') && H.includes('_bgPredaj(bufPts);'));
  assert.ok(!/AndroidGps\.setPaused\(_tragPaused\)/.test(H), 'pauza traga ne pauzira servis dok vodič snima');
  assert.ok(js.includes("bg.pocni(BG_ID, 'Sjekačka linija '") && js.includes('vodicPozadinaKraj()') && js.includes('await bg.dopuni()'));
  assert.ok(js.includes("localStorage.getItem(KLJUC_VODIC)"), 'vodič se nastavlja kad Android ubije app');
  assert.ok(js.includes('!vodic.nat && vodicDodaj('), 'u APK-u samo native tačke (bez duplih)');
  assert.ok(!/sl-lbl[^`]*lin\.ha/.test(js) && !/gledano uzbrdo\$\{lin\.ha/.test(js), 'nema ha na karti');
  assert.ok(js.includes("redovi.push(['Partija', fmt(lin.ha, 2) + ' ha'])"), 'ha ostaje u popup-u');
});

// Sintetički DEM za čitanje padina: mreža 40 × 30 ćelija po 20 m, šum ±1,5 m (krošnje)
function teren(f, s = 20, nx = 40, ny = 30) {
  const z = new Float64Array(nx * ny), u = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const x = (i - nx / 2) * s, y = (j - ny / 2) * s; z[j * nx + i] = f(x, y) + Math.sin(i * 7.3 + j * 3.1) * 1.5; u[j * nx + i] = i >= 3 && i < nx - 3 && j >= 3 && j < ny - 3 ? 1 : 0; }
  return S.slPadineMreza(z, nx, ny, s, u, 60);
}
const azBlizu = (a, b, tol = 12) => S.slUgaoRazlika(a, b) <= tol;

t('padine: jednolična padina = jedna, greben = dvije (Z | I), granica tipa greben', () => {
  let r = teren(x => -0.3 * x);
  assert.strictEqual(r.regije.length, 1); assert.ok(azBlizu(r.regije[0].azimut, 90) && Math.abs(r.regije[0].nagibPct - 30) < 3);
  r = teren(x => -0.3 * Math.abs(x));
  assert.strictEqual(r.regije.length, 2);
  assert.deepStrictEqual(r.regije.map(q => Math.round(q.azimut / 90) * 90 % 360).sort((a, b) => a - b), [90, 270]);
  assert.strictEqual(r.granice.length, 1); const g = r.granice[0];
  assert.ok(g.greben > 3 * (g.jarak + 1), 'pad s obje strane od granice → greben');
  assert.ok(g.tacke.every(([i]) => Math.abs(i - 20) <= 1.5), 'granica na hrptu (x = 0)');
});

t('padine: jarak, kupa (3 strane) i dva brda (sjever/jug + greben)', () => {
  let r = teren((x, y) => 0.3 * Math.abs(x) + 0.1 * y);
  assert.strictEqual(r.regije.length, 2); assert.ok(r.granice[0].jarak > 3 * (r.granice[0].greben + 1), 'voda se slijeva → jarak');
  r = teren((x, y) => -0.3 * Math.hypot(x, y));
  assert.ok(r.regije.length >= 3 && r.regije.length <= 4, 'kupa se dijeli na 3–4 ekspozicije');
  r.regije.forEach(q => assert.ok(q.dosljednost > 0.75, 'svaka padina jednolična'));
  r = teren((x, y) => 80 * Math.exp(-((x - 180) ** 2 + y ** 2) / 3e4) + 80 * Math.exp(-((x + 180) ** 2 + y ** 2) / 3e4));
  assert.ok(r.regije.length >= 2 && r.granice.some(g => g.greben > g.jarak));
});

t('padine: male padine (< min ćelija) se spajaju sa susjedom', () => {
  // mala izbočina 3 × 3 ćelije na jednoličnoj padini nije svoja padina
  const r = teren((x, y) => -0.3 * x + (Math.abs(x) < 30 && Math.abs(y) < 30 ? 0.6 * x : 0));
  assert.strictEqual(r.regije.length, 1);
});

t('podjela poligona po granici padina: dva dijela, granica do ruba', () => {
  const geo = [pr(2, -90), pr(-3, -30), pr(1, 30), pr(-2, 92)];
  const reg = [{ id: 0, tacke: [pr(-100, 0), pr(-60, 50), pr(-120, -60)] }, { id: 1, tacke: [pr(100, 0), pr(60, -50), pr(120, 60)] }];
  const r = S.slRazdijeli(kvadrat, reg, [{ a: 0, b: 1, geo, tip: 'greben' }], 30, 0.5);
  assert.strictEqual(r.dijelovi.length, 2);
  const ha = r.dijelovi.map(d => S.slPoljaTeren(d.ring, [])[0]);
  assert.ok(Math.abs(ha[0] + ha[1] - 6) < 0.05 && Math.abs(ha[0] - 3) < 0.15, ha.join('/'));
  const g = r.granice[0].geo;
  assert.ok(S.slDoRuba(g[0], kvadrat) < 0.01 && S.slDoRuba(g[g.length - 1], kvadrat) < 0.01, 'granica produžena do ruba');
  // kraj daleko od ruba (Y-spoj): bez podjele, padine ostaju zajedno
  const r2 = S.slRazdijeli(kvadrat, reg, [{ a: 0, b: 1, geo: geo.slice(0, 2) }], 30, 0.5);
  assert.strictEqual(r2.dijelovi.length, 1);
});

t('granica padina: tačke ćelija → uređena linija od kraja do kraja', () => {
  const tacke = []; for (let k = 0; k < 20; k++) tacke.push([k % 2 ? 1 : -1, k * 10]);
  tacke.sort(() => 0.5 - Math.random());
  const l = S.slGranicaLinija(tacke, 10);
  assert.strictEqual(l.length, 20); assert.ok(Math.abs(l[0][1]) < 1e-9 && Math.abs(l[19][1] - 190) < 1e-9, 'krajevi su krajevi');
  for (let i = 1; i < l.length; i++) assert.ok(l[i][1] > l[i - 1][1], 'redom');
  assert.ok(l.slice(1, -1).every(q => Math.abs(q[0]) < 0.5), 'cik-cak ćelija zaglađen');
});

t('UI: alternativni prikaz (padine) — prekidač, padine bez spajanja partija preko grebena', () => {
  const js = R('static/js/sjekacke.js');
  assert.ok(js.includes('data-a="prikaz" data-v="padine"') && js.includes("p.padine = await citajPadine(p)") && js.includes("'p' + di + ':'"));
  assert.ok(js.includes('partije se ne spajaju preko grebena'), 'svaka padina svoje partije');
  assert.ok(js.includes('<name>Granice padina</name>'), 'KML s granicama padina');
  assert.ok(R('index.html').includes('.sl-prikaz button.on'));
});

t('poligon partije uz liniju: L od prethodne (granice) do linije, D do sljedeće; drugi pad spaja rub', () => {
  const geos = [-90, -30, 30, 90].map(x => [pr(x, -100), pr(x, 100)]), D = [{ ring: kvadrat, geos }];
  const ha = r => S.slPoljaTeren(r, [])[0];
  let r = S.slPartija(D, 0, 0, false, true); assert.strictEqual(r.length, 1); assert.ok(Math.abs(ha(r[0]) - 1.2) < 0.03, 'L1: granica → L1');
  r = S.slPartija(D, 0, 2, false, true); assert.ok(Math.abs(ha(r[0]) - 1.2) < 0.03);
  assert.ok(r[0].every(q => { const x = L.u(q[0], q[1])[0]; return x >= -30.5 && x <= 30.5; }), 'L3: od L2 do L3');
  r = S.slPartija(D, 0, 3, true, true); assert.ok(r[0].every(q => L.u(q[0], q[1])[0] >= 89.5), 'D: od linije do granice desno');
  // dva dijela (drugi pad iza x = 0): prva partija desnog dijela se spaja sa zadnjom lijevog
  const lijevo = [pr(-150, -100), pr(0, -100), pr(0, 100), pr(-150, 100)], desno = [pr(0, -100), pr(150, -100), pr(150, 100), pr(0, 100)];
  const D2 = [{ ring: lijevo, geos: [geos[0]] }, { ring: desno, geos: [geos[3]] }];
  r = S.slPartija(D2, 1, 0, false, true); assert.strictEqual(r.length, 2);
  assert.ok(Math.abs(r.reduce((a, q) => a + ha(q), 0) - 3.6) < 0.05, 'od L1 lijevog dijela do L1 desnog = 180 m × 200 m');
  assert.strictEqual(S.slPartija(D2, 1, 0, false, false).length, 1, 'padine: bez spajanja preko grebena');
});

t('natpisi bez preklapanja i poligon partije na klik linije', () => {
  const js = R('static/js/sjekacke.js');
  assert.ok(js.includes('function postaviNatpise()') && js.includes("else postaviNatpise();"), 'raspored natpisa na svaki zoom');
  assert.ok(!/L\.marker\(lin\.(dno|vrh)/.test(js), 'krajevi linija idu kroz raspored, ne direktno');
  assert.ok(js.includes('prikaziPartiju(p, lin);') && js.includes('slPartija(dd, di, j'), 'klik na liniju crta partiju');
});

t('dijeljenje: spajanje projekata — plan iz novijeg tPlan, stanje linije iz novijeg lin.t', () => {
  const L0 = (id, t, st, x = {}) => ({ id, k: 1, dio: 0, status: st, t, ...x });
  const planer = { id: 'sl_1', naziv: 'O52', tPlan: 100, ring: [], razmak: 60, linije: [L0('a', 50, 'ne'), L0('b', 60, 'ne'), L0('c', 0, 'ne')] };
  const radnik = { id: 'sl_1', naziv: 'O52', tPlan: 100, ring: [], razmak: 60, vidljiv: false, linije: [L0('a', 200, 'gotovo', { stvarna: [[1, 2], [3, 4]], radnik: 'Mujo' }), L0('b', 10, 'rad'), L0('c', 0, 'ne')] };
  let r = S.slSpojiProjekte(planer, radnik);
  assert.strictEqual(r.azurirano, 1); assert.strictEqual(r.planDolazni, false);
  const a = r.p.linije.find(l => l.id === 'a'), b = r.p.linije.find(l => l.id === 'b');
  assert.ok(a.status === 'gotovo' && a.radnik === 'Mujo' && a.stvarna.length === 2, 'ofarbana linija radnika stiže planeru');
  assert.strictEqual(b.status, 'ne', 'starija promjena radnika ne pregazi planera');
  assert.ok(planer.linije[0].status === 'ne', 'ulaz se ne mijenja');
  // planer promijenio raspored (novi tPlan): radnik dobija novi plan, ali zadržava svoju GPS liniju gdje id postoji
  const noviPlan = { ...planer, tPlan: 300, razmak: 50, linije: [L0('a', 50, 'ne'), L0('x', 0, 'ne')] };
  r = S.slSpojiProjekte(radnik, noviPlan);
  assert.ok(r.planDolazni && r.p.razmak === 50 && r.p.linije.length === 2);
  assert.strictEqual(r.p.linije.find(l => l.id === 'a').status, 'gotovo');
  assert.strictEqual(r.p.vidljiv, false, 'vidljivost je lična postavka primaoca');
  // poništena GPS linija (noviji t bez stvarne) briše staru stvarnu
  r = S.slSpojiProjekte(radnik, { ...radnik, linije: [L0('a', 400, 'rad')] });
  assert.ok(!r.p.linije.find(l => l.id === 'a').stvarna);
});

t('padine: bliske linije susjednih padina spajaju se u jednu krivudavu', () => {
  // greben na x = 0: lijeva padina (0) linije od x=-300 do grebena, desna (1) od x=300 do grebena
  const lijevo = y => ({ padina: 0, geo: [pr(-300, y), pr(-150, y + 5), pr(0, y)] }), desno = y => ({ padina: 1, geo: [pr(300, y), pr(0, y)] });
  const lin = [lijevo(0), lijevo(60), lijevo(120), desno(12), desno(75), desno(118), desno(200)], gr = [[pr(0, -100), pr(0, 300)]];
  const lanci = S.slSpojiLinije(lin, gr, 30);
  assert.strictEqual(lanci.length, 4, '3 spojene + 1 bez para');
  assert.strictEqual(lanci.reduce((a, l) => a + l.length, 0), lin.length, 'svaka linija tačno jednom');
  const spoj = lanci.filter(l => l.length === 2);
  assert.strictEqual(spoj.length, 3);
  const parovi = spoj.map(l => l.map(x => x.i).sort((a, b) => a - b).join('-')).sort();
  assert.deepStrictEqual(parovi, ['0-3', '1-4', '2-5'], 'najbliži parovi, svaki kraj jednom');
  const g = S.slSpojiGeo(spoj[0].map(({ i, obrni }) => obrni ? lin[i].geo.slice().reverse() : lin[i].geo));
  const x0 = L.u(g[0][0], g[0][1])[0], x1 = L.u(g[g.length - 1][0], g[g.length - 1][1])[0];
  assert.ok(Math.abs(Math.abs(x0) - 300) < 0.5 && Math.abs(Math.abs(x1) - 300) < 0.5 && Math.sign(x0) !== Math.sign(x1), 'od jednog do drugog ruba preko grebena');
  assert.ok(g.length === 5, 'kratak komad uz granicu ostaje (krajevi 12 m razmaka)');
  // prag 0 / ista padina / daleko od granice → bez spajanja
  assert.ok(S.slSpojiLinije(lin, gr, 0).every(l => l.length === 1));
  assert.ok(S.slSpojiLinije([lijevo(0), lijevo(10)], gr, 30).every(l => l.length === 1), 'ista padina se ne spaja');
  assert.ok(S.slSpojiLinije([lijevo(0), desno(12)], [[pr(500, -100), pr(500, 300)]], 30).every(l => l.length === 1), 'krajevi daleko od granice padina');
  // tri padine oko jedne tačke: lanac bez petlje
  const tri = [{ padina: 0, geo: [pr(-200, 0), pr(0, 0)] }, { padina: 1, geo: [pr(0, 5), pr(200, 0)] }, { padina: 2, geo: [pr(200, 4), pr(5, 3)] }];
  const lt = S.slSpojiLinije(tri, [], 30);
  assert.strictEqual(lt.reduce((a, l) => a + l.length, 0), 3);
  assert.ok(lt.every(l => new Set(l.map(x => x.i)).size === l.length), 'bez ponavljanja (petlje)');
});

t('UI: spajanje linija padina — prekidač, komponente za partiju i brisanje', () => {
  const js = R('static/js/sjekacke.js');
  assert.ok(js.includes('data-a="spoj"') && js.includes("p.spoj = Number(el.dataset.v)"), 'izbor praga u panelu');
  assert.ok(js.includes('await spojiPadine(p, dijelovi, stari)'), 'spaja se poslije površina po padini');
  assert.ok(js.includes('x.vlasnik === lin.id') && js.includes('lin.komp.forEach(c =>'), 'partija i brisanje po komponentama');
  assert.ok(S.slGeo({ spoj: [[1, 1], [2, 2], [3, 3]], dno: [0, 0], vrh: [9, 9] }).length === 3, 'slGeo koristi spojenu geometriju');
  assert.ok(S.slGeo({ geo: [[1, 1], [2, 2]], spoj: [[1, 1], [2, 2], [3, 3]] }).length === 2, 'ručni lom ima prednost');
});

t('dijeljenje: projekat u KML-u, prijem iz drugih aplikacija (Android)', () => {
  const js = R('static/js/sjekacke.js'), H = R('index.html');
  assert.ok(js.includes('<Data name="usf_sjekacke">') && js.includes('usf_fokus') && js.includes('posaljiLiniju'));
  assert.ok(H.includes('await USFSjek.izKml(doc)') && H.includes('async function _dolazniFajl()'));
  const man = R('android/app/src/main/AndroidManifest.xml'), act = R('android/app/src/main/java/ba/spd/usf/forest/MainActivity.java');
  assert.ok(man.includes('android:launchMode="singleTask"') && man.includes('application/vnd.google-earth.kml+xml') && man.includes('android.intent.action.SEND'));
  assert.ok(act.includes('public String uzmiDolazni()') && act.includes('protected void onNewIntent') && act.includes('primiFajl(getIntent())'));
});

(async () => {
  for (const [ime, fn] of testovi) {
    try { await fn(); pass++; console.log('  ✔ ' + ime); } catch (e) { console.error('  ✘ ' + ime + '\n      ' + e.message); process.exitCode = 1; }
  }
  console.log('\n' + pass + ' prošlo, ' + (process.exitCode ? 'IMA PALIH' : '0 palo') + ' — sjekačke linije');
})();
