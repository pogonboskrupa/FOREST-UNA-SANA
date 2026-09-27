'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const N = require('../../static/js/nagib-poligon.js');
const T = require('../../static/js/terrain-layers.js');
const HTML = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ✔ ' + name); };
console.log('Nagib — rasponi od–do i nagib u poligonu:');

t('rasponi: sortirane granice, od = prethodna granica, zadnji do beskonačnosti', () => {
  const k = T.terrainSlopeNormalize([{ max: 30 }, { max: 10 }, { max: 30 }, { max: 95 }, { max: null }]);
  assert.deepStrictEqual(k.map(x => x.label), ['0–10°', '10–30°', '>30°']);
  assert.strictEqual(k[2].max, Infinity);
  assert.ok(k.every(x => /^#[0-9a-f]{6}$/i.test(x.color) && x.on));
});

t('rasponi: isključen raspon je proziran, korisnička boja ostaje', () => {
  T.terrainSetSlopeKlase([{ max: 20, color: '#123456' }, { max: 40, on: false }, { max: Infinity }]);
  const nag = d => T.terrainColor('slope', Math.tan(d * Math.PI / 180), 0);
  assert.strictEqual(nag(10), '#123456');
  assert.strictEqual(nag(30), null, 'isključen raspon se ne crta');
  assert.ok(nag(60));
  assert.strictEqual(T.terrainSlopeKlasa(30).label, '20–40°');
  T.terrainSetSlopeKlase(null);
  assert.strictEqual(nag(30), '#f97316', 'vraćanje na zadane klase');
});

const ring = [[44.80, 16.10], [44.80, 16.11], [44.81, 16.11], [44.81, 16.10]];

t('poligon: tačka unutra/van i površina (~0,79 × 1,11 km)', () => {
  assert.ok(N.npUnutra(44.805, 16.105, ring));
  assert.ok(!N.npUnutra(44.815, 16.105, ring));
  const a = N.npPovrsina(ring);
  assert.ok(a > 85e4 && a < 90e4, String(a));
});

t('mreža: automatski razmak daje ~80 tačaka, sve unutar; gornja granica 400', () => {
  const a = N.npPovrsina(ring), r = N.npAutoRazmak(a);
  const m = N.npMreza(ring, r);
  assert.ok(m.tacke.length > 50 && m.tacke.length < 120, String(m.tacke.length));
  assert.ok(m.tacke.every(([la, lo]) => N.npUnutra(la, lo, ring)));
  const gusta = N.npMreza(ring, 5);
  assert.ok(gusta.tacke.length <= 400 && gusta.razmak > 5);
  const mali = N.npMreza([[44.8, 16.1], [44.8, 16.10001], [44.80001, 16.1]], 50);
  assert.strictEqual(mali.tacke.length, 1, 'mali poligon dobije bar jednu tačku');
});

t('nagib iz visina: ±10 m pomak, razlika 10 m na 20 m = 26,6°, strana okrenuta zapadu', () => {
  const g = N.npNagibIzVisina(110, 100, 105, 105, 10);
  assert.ok(Math.abs(g.slope - 26.565) < 0.01);
  assert.ok(Math.abs(g.aspect - 270) < 0.01);
  const c = T.terrainGradient((110 - 100) / 20, 0);
  assert.ok(Math.abs(c.slope - g.slope) < 1e-9, 'isti obrazac kao sloj nagiba');
});

t('statistika po rasponima: prosjek, medijan, udio i ha', () => {
  const kl = T.terrainSlopeNormalize([{ max: 15 }, { max: 30 }, { max: Infinity }]);
  const s = N.npStatistika([5, 10, 20, 40, NaN], kl, 40000);
  assert.strictEqual(s.n, 4);
  assert.strictEqual(s.sr, 18.75); assert.strictEqual(s.med, 15);
  assert.deepStrictEqual(s.poKlasi.map(p => p.n), [2, 1, 1]);
  assert.strictEqual(s.poKlasi[0].ha, 2);
});

t('integracija: urednik raspona, dugme u terenu, KML i mjerenje, keš i APK', () => {
  ['id="terrain-slope-editor"', 'onclick="npNacrtaj()"', 'npIzKml(${L.stamp(layer)})', "npIzMjerenja('${m.id}')", '<script src="static/js/nagib-poligon.js">', 'window._npHvataKlik'].forEach(x => assert.ok(HTML.includes(x), x));
  const sw = fs.readFileSync(path.join(__dirname, '../../sw.js'), 'utf8');
  const kop = fs.readFileSync(path.join(__dirname, '../../android/copy-assets.sh'), 'utf8');
  assert.ok(sw.includes("'./static/js/nagib-poligon.js'") && kop.includes('static/js/nagib-poligon.js'));
  const js = fs.readFileSync(path.join(__dirname, '../../static/js/nagib-poligon.js'), 'utf8');
  assert.ok(js.includes("map.createPane('nagibPolPane')") && js.includes("pane: 'nagibPolPane'"), 'pane mora postojati');
  assert.ok(js.includes('draggable: true'), 'tačke i tjemena su pomjerivi');
});

t('statistika iz svih ćelija DEM-a u poligonu (ne samo iz tačaka)', () => {
  const d = { W: 10, H: 10, ox: 16, oy: 45, rx: 0.001, ry: -0.001 };
  const ring = [[44.9975, 16.0025], [44.9975, 16.0075], [44.9925, 16.0075], [44.9925, 16.0025]];
  const r = N.npCelije(d, ring, (ix, iy) => ({ nagib: ix }));
  assert.strictEqual(r.ukupno, 25, '5×5 ćelija s centrom u poligonu');
  assert.deepStrictEqual([...new Set(r.nagibi)].sort((a, b) => a - b), [2, 3, 4, 5, 6]);
  const bez = N.npCelije(d, ring, () => null);
  assert.strictEqual(bez.nagibi.length, 0);
});

t('lokalni DEM: Horn nagib i prednost pred AWS pločicama kad je pločica potpuno pokrivena', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
  const terr = html.slice(html.indexOf('async function _getTerrariumTile'), html.indexOf('function _terrariumDecodeTile'));
  assert.ok(terr.indexOf('terrariumPlocica(z, x, y, true)') < terr.indexOf('caches.open'), 'lokalni DEM prije keša/interneta');
  const dem = fs.readFileSync(path.join(__dirname, '../../static/js/dem-local.js'), 'utf8');
  assert.ok(dem.includes('(8 * mx)') && dem.includes('(8 * my)'), 'Horn 3×3');
  const js = fs.readFileSync(path.join(__dirname, '../../static/js/nagib-poligon.js'), 'utf8');
  assert.ok(js.includes('celijeStat(s.ring)') && js.includes('USFDem.visina(d, la, lo)'), 'linije i površina iz Copernicus DEM-a');
});

t('linije niz padinu: smjer najvećeg pada, nagib linije kao ručno mjerenje', () => {
  const g = N.npAzimutPada(100, 120, 110, 110, 45);
  assert.ok(Math.abs(g.azimut - 90) < 1e-9, 'teren raste prema zapadu → pad prema istoku (90°)');
  const nl = N.npNagibLinije(1250, 1200, 100);
  assert.ok(Math.abs(nl.st - 26.565) < 0.01 && nl.pct === 50 && nl.dh === 50);
  assert.ok(Math.abs(N.npDist([44.8, 16.1], N.npPomak([44.8, 16.1], 37, 250)) - 250) < 0.5, 'pomak i udaljenost u metrima');
});

t('sjemena: tačan broj, unutar poligona, raširena; linija u smjeru pada ostaje u poligonu', () => {
  for (const n of [5, 8, 10, 12]) {
    const sj = N.npSjemena(ring, n);
    assert.strictEqual(sj.length, n);
    assert.ok(sj.every(p => N.npUnutra(p[0], p[1], ring)));
    let min = Infinity;
    for (let i = 0; i < sj.length; i++) for (let j = i + 1; j < sj.length; j++) min = Math.min(min, N.npDist(sj[i], sj[j]));
    assert.ok(min > 150, n + ' linija: sjemena nisu zbijena (' + Math.round(min) + ' m)');
  }
  const [a, b] = N.npLinijaKroz([44.8095, 16.105], 0, 400, ring);
  assert.ok(N.npUnutra(a[0], a[1], ring) && N.npUnutra(b[0], b[1], ring), 'krajevi skraćeni do ruba');
  assert.ok(b[0] > a[0], 'kraj b je u smjeru pada (sjever)');
  assert.strictEqual(N.npAutoDuzina(38e4), 280);
});

t('UI: izbor 5/8/10/12 linija, pomjerivi krajevi i cijela linija, ručna linija, CSV linija', () => {
  const js = fs.readFileSync(path.join(__dirname, '../../static/js/nagib-poligon.js'), 'utf8');
  assert.ok(js.includes('[5, 8, 10, 12]'));
  assert.ok(js.includes("l.lbl.on('drag'") && js.includes("m.on('dragend'"), 'vuku se krajevi i oznaka');
  assert.ok(js.includes("'+ Linija'") || js.includes('+ Linija'));
  assert.ok(js.includes("'nagib_pct'"));
});

t('procenti su glavni prikaz, stepeni u zagradi; sažetak za pohranu', () => {
  assert.ok(Math.abs(N.npPct(45) - 100) < 1e-9 && Math.abs(N.npSt(100) - 45) < 1e-9);
  const sz = N.npSazetak([{ pct: 20, st: N.npSt(20) }, { pct: 40, st: N.npSt(40) }, { pct: NaN, st: NaN }]);
  assert.strictEqual(sz.n, 2); assert.strictEqual(sz.pct, 30); assert.strictEqual(sz.min, 20);
  const js = fs.readFileSync(path.join(__dirname, '../../static/js/nagib-poligon.js'), 'utf8');
  assert.ok(js.includes("`${Math.round(l.pct)} % (${Math.round(l.st)}°)`"), 'oznaka linije: % (°)');
  assert.ok(js.includes("'nagib_pct', 'nagib_st'"), 'CSV: procenat prije stepeni');
});

t('pohrana: dugme Sačuvaj/Ažuriraj, lista s prikazom, CSV, preimenovanjem i brisanjem', () => {
  const js = fs.readFileSync(path.join(__dirname, '../../static/js/nagib-poligon.js'), 'utf8');
  assert.ok(js.includes("'usf_nagib_mjerenja'") && js.includes("data-a=\"sacuvaj\""));
  ['data-sv="prikazi"', 'data-sv="csv"', 'data-sv="ime"', 'data-sv="brisi"'].forEach(x => assert.ok(js.includes(x), x));
  assert.ok(js.includes('pocni(z.ring, z.naziv, z)') && js.includes('if (sacuvano) obnovi(sacuvano); else generisi();'), 'sačuvane linije se vraćaju, ne generišu ponovo');
});

t('sekcija Nagib u Kartama: kartica, panel, prekidač karte, rasponi s %, mjerenje i lista', () => {
  assert.ok(HTML.includes('onclick="openNagibSection()"') && HTML.includes('id="nagib-panel"'));
  const panel = HTML.slice(HTML.indexOf('id="nagib-panel"'), HTML.indexOf('<!-- Custom dialog sheet'));
  ['id="terrain-slope"', 'id="terrain-slope-editor"', 'onclick="npNacrtaj()"', 'id="ng-lista"', 'aria-label="Prozirnost slojeva terena"'].forEach(x => assert.ok(panel.includes(x), x));
  const teren = HTML.slice(HTML.indexOf('<h3>🏔 Analiza terena</h3>'), HTML.indexOf('<h3>📊 Tematska GeoPackage karta</h3>'));
  assert.ok(!teren.includes('terrain-slope'), 'nagib više nije u Analizi terena');
  assert.ok(HTML.includes("'nagib-panel'") , 'panel je u _ALL_PANELS');
  const tjs = fs.readFileSync(path.join(__dirname, '../../static/js/terrain-layers.js'), 'utf8');
  assert.ok(tjs.includes('class="tse-pct"') && tjs.includes('querySelectorAll(\'input[aria-label="Prozirnost slojeva terena"]\')'));
});

(async () => {
  // Greben na lon 16.105 (1200 m), padine 20 % na obje strane; tačka na istočnoj padini.
  const m = 111320 * Math.cos(44.805 * Math.PI / 180);
  const h = (la, lo) => 1200 - 0.2 * Math.abs(lo - 16.105) * m;
  const [vrh, dno] = await N.npPratiPad([44.805, 16.107], h, ring, 400);
  assert.ok(Math.abs(vrh[1] - 16.105) * m < 20, 'vrh linije je na grebenu, ne preko njega');
  assert.ok(dno[1] > 16.107 && dno[1] <= 16.11, 'dno ide niz istočnu padinu do ruba');
  const nl = N.npNagibLinije(h(...vrh), h(...dno), N.npDist(vrh, dno));
  assert.ok(Math.abs(nl.pct - 20) < 0.5, 'linija mjeri stvarni nagib padine (' + nl.pct.toFixed(1) + ' %)');
  pass++; console.log('  ✔ praćenje pada: linija staje na grebenu, mjeri stvarni nagib padine');
  console.log('\n' + pass + ' prošlo, 0 palo — nagib u poligonu');
})().catch(e => { console.error(e); process.exitCode = 1; });
