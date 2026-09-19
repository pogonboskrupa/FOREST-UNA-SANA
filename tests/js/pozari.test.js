'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

function extractFn(name) {
  let start = HTML.indexOf('async function ' + name + '(');
  if (start < 0) start = HTML.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'nije nađena funkcija ' + name);
  let i = HTML.indexOf('{', start), depth = 0;
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}' && --depth === 0) return HTML.slice(start, i + 1);
  }
  throw new Error('nezatvorena funkcija ' + name);
}

let pass = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { console.error('  ✘ ' + name + '\n      ' + e.message); process.exitCode = 1; }
}

console.log('Požari — CSV parsiranje, pouzdanost, grupisanje detekcija:');

const dstSrc = extractFn('dst');

t('_poziParseCsv čita FIRMS VIIRS CSV zaglavlje i redove', () => {
  const src = extractFn('_poziParseCsv') + '\nreturn _poziParseCsv;';
  const _poziParseCsv = new Function(src)();
  const csv = 'latitude,longitude,acq_date,acq_time,satellite,confidence,frp,daynight,instrument\n' +
    '44.8000,16.0000,2026-09-15,1234,N,n,12.3,D,VIIRS\n' +
    '44.8010,16.0010,2026-09-15,0130,N,h,45.6,N,VIIRS';
  const pts = _poziParseCsv(csv);
  assert.strictEqual(pts.length, 2);
  assert.strictEqual(pts[0].la, 44.8);
  assert.strictEqual(pts[0].lo, 16.0);
  assert.strictEqual(pts[0].dt, '2026-09-15T12:34:00Z');
  assert.strictEqual(pts[1].noc, true); // daynight 'N' → noć
  assert.strictEqual(pts[0].rez, 375); // VIIRS, ne MODIS
});

t('_poziParseCsv vraća prazno za tekst koji nije FIRMS CSV (nedostaju kolone)', () => {
  const src = extractFn('_poziParseCsv') + '\nreturn _poziParseCsv;';
  const _poziParseCsv = new Function(src)();
  assert.deepStrictEqual(_poziParseCsv('<html>error page</html>'), []);
  assert.deepStrictEqual(_poziParseCsv(''), []);
});

t('_poziPouzdanost normalizuje VIIRS slovni i MODIS brojčani kod', () => {
  const src = extractFn('_poziPouzdanost') + '\nreturn _poziPouzdanost;';
  const _poziPouzdanost = new Function(src)();
  assert.strictEqual(_poziPouzdanost('h').rang, 3);
  assert.strictEqual(_poziPouzdanost('l').rang, 1);
  assert.strictEqual(_poziPouzdanost('85').rang, 3);
  assert.strictEqual(_poziPouzdanost('30').rang, 1);
});

t('_poziGrupisi spaja bliske detekcije (isti požar, više satelita) u jednu grupu', () => {
  const src = dstSrc + '\n' +
    "function _poziLinijskePrepreke(){return [];}\n" +
    "function _poziPragIzmedju(a,b,prag){return prag;}\n" +
    extractFn('_poziSatelit') + '\n' + extractFn('_poziPouzdanost') + '\n' + extractFn('_poziDanUTC') + '\n' + extractFn('_poziGrupisi') +
    '\nreturn _poziGrupisi;';
  const _poziGrupisi = new Function(src)();
  // Dvije tačke ~50m razmaknute (isti požar, dva satelita) + jedna udaljena
  // tačka ~5km dalje (drugi, nepovezan požar).
  const pts = [
    { la: 44.8000, lo: 16.0000, dt: '2026-09-15T01:00:00Z', sat: 'N', conf: 'h', frp: 10 },
    { la: 44.8004, lo: 16.0000, dt: '2026-09-15T02:00:00Z', sat: '1', conf: 'n', frp: 12 },
    { la: 44.8450, lo: 16.0450, dt: '2026-09-15T01:30:00Z', sat: 'N', conf: 'l', frp: 5 }
  ];
  const grupe = _poziGrupisi(pts, 450);
  assert.strictEqual(grupe.length, 2, 'blisko treba spojiti, udaljeno ostaje odvojeno');
  const veca = grupe.find(g => g.broj === 2);
  assert.ok(veca, 'grupa od dvije bliske detekcije mora postojati');
  assert.strictEqual(veca.sateliti.length, 2);
});

t('_poziGrupisi NE spaja detekcije udaljenije od praga (dva odvojena požara)', () => {
  const src = dstSrc + '\n' +
    "function _poziLinijskePrepreke(){return [];}\n" +
    "function _poziPragIzmedju(a,b,prag){return prag;}\n" +
    extractFn('_poziSatelit') + '\n' + extractFn('_poziPouzdanost') + '\n' + extractFn('_poziDanUTC') + '\n' + extractFn('_poziGrupisi') +
    '\nreturn _poziGrupisi;';
  const _poziGrupisi = new Function(src)();
  const pts = [
    { la: 44.80, lo: 16.00, dt: '2026-09-15T01:00:00Z', sat: 'N', conf: 'h', frp: 10 },
    { la: 44.90, lo: 16.10, dt: '2026-09-15T01:00:00Z', sat: 'N', conf: 'h', frp: 10 }
  ];
  const grupe = _poziGrupisi(pts, 450);
  assert.strictEqual(grupe.length, 2);
  assert.ok(grupe.every(g => g.broj === 1));
});

t('_poziGrupisi prekida požar kad ista lokacija nema uzastopnu dnevnu aktivnost', () => {
  const src = dstSrc + '\n' +
    "function _poziLinijskePrepreke(){return [];}\nfunction _poziPragIzmedju(a,b,prag){return prag;}\n" +
    extractFn('_poziSatelit') + '\n' + extractFn('_poziPouzdanost') + '\n' + extractFn('_poziDanUTC') + '\n' + extractFn('_poziGrupisi') + '\nreturn _poziGrupisi;';
  const fn = new Function(src)();
  const samePlace = [
    { la:44.80, lo:16.00, dt:'2026-09-01T09:00:00Z', sat:'N', conf:'h' },
    { la:44.8002, lo:16.00, dt:'2026-09-02T10:00:00Z', sat:'N', conf:'h' },
    { la:44.8001, lo:16.00, dt:'2026-09-05T10:00:00Z', sat:'N', conf:'h' }
  ];
  const grupe = fn(samePlace, 450);
  assert.strictEqual(grupe.length, 2, 'prekid 3 dana mora biti novi požar');
  assert.deepStrictEqual(grupe.map(g => g.broj).sort(), [1,2]);
});

t('_poziParseGfwJson svodi GFW JSON odgovor na isti oblik tačke kao FIRMS CSV', () => {
  const src = extractFn('_poziParseGfwJson') + '\nreturn _poziParseGfwJson;';
  const _poziParseGfwJson = new Function(src)();
  const json = JSON.stringify({ data: [
    { longitude: 16.0, latitude: 44.8, alert__date: '2026-09-15', alert__time_utc: '01:23:00', confidence__cat: 'high' },
    { longitude: 16.01, latitude: 44.81, alert__date: '2026-09-15', alert__time_utc: '1405', confidence__cat: 'nominal' }
  ] });
  const pts = _poziParseGfwJson(json);
  assert.strictEqual(pts.length, 2);
  assert.strictEqual(pts[0].la, 44.8);
  assert.strictEqual(pts[0].lo, 16.0);
  assert.strictEqual(pts[0].dt, '2026-09-15T01:23:00Z');
  assert.strictEqual(pts[0].sat, 'VIIRS (GFW)');
  assert.ok(Number.isNaN(pts[0].frp), 'GFW ne vraća FRP — mora ostati NaN, ne 0');
  assert.strictEqual(pts[1].dt, '2026-09-15T14:05:00Z');
});

t('_poziParseGfwJson vraća prazno za neispravan/nedostajući JSON', () => {
  const src = extractFn('_poziParseGfwJson') + '\nreturn _poziParseGfwJson;';
  const _poziParseGfwJson = new Function(src)();
  assert.deepStrictEqual(_poziParseGfwJson('<html>error</html>'), []);
  assert.deepStrictEqual(_poziParseGfwJson('{}'), []);
});

t('_poziGfwUrl gradi bbox oko referentne tačke i SQL upit kao query string', () => {
  const src = "const _POZ_RADIUS_KM = 100;\n" + extractFn('_poziGfwUrl') + '\nreturn _poziGfwUrl;';
  const _poziGfwUrl = new Function(src)();
  const url = _poziGfwUrl('24h', { la: 44.8, lo: 16.0 });
  assert.ok(url.startsWith('https://data-api.globalforestwatch.org/dataset/nasa_viirs_fire_alerts/latest/query/json?sql='));
  const sql = decodeURIComponent(url.split('sql=')[1]);
  assert.ok(sql.includes('latitude >='), 'mora ograničiti bbox po latitude');
  assert.ok(sql.includes('longitude >='), 'mora ograničiti bbox po longitude');
  assert.ok(/LIMIT \d+/.test(sql));
});

t('_poziPixelHa računa poznatu površinu piksela (VIIRS 375m i MODIS 1km)', () => {
  const src = extractFn('_poziPixelHa') + '\nreturn _poziPixelHa;';
  const _poziPixelHa = new Function(src)();
  assert.ok(Math.abs(_poziPixelHa(375) - 14.0625) < 0.001);
  assert.strictEqual(_poziPixelHa(1000), 100);
});

t('_poziPovrsinaGrupe dedupira detekcije iz ISTOG piksela (više satelita/preleta)', () => {
  const src = extractFn('_poziPixelHa') + '\nconst _POZ_HOTSPOT_FAKTOR=0.35;\n' + extractFn('_poziProcijenjeniHa') + '\n' + extractFn('_poziPovrsinaGrupe') + '\nreturn _poziPovrsinaGrupe;';
  const _poziPovrsinaGrupe = new Function(src)();
  // Dvije detekcije ~15m razmaknute (isti fizički piksel, viđen 2x) → 1 piksel.
  const isti = { pts: [
    { la: 44.8000, lo: 16.0000, rez: 375 },
    { la: 44.80013, lo: 16.00013, rez: 375 }
  ] };
  assert.ok(Math.abs(_poziPovrsinaGrupe(isti) - 14.0625 * 0.35) < 0.001, 'blisko = isti piksel, ne smije se duplo brojati');
  // Dvije detekcije daleko razmaknute (različiti pikseli) → 2 piksela.
  const razlicito = { pts: [
    { la: 44.8000, lo: 16.0000, rez: 375 },
    { la: 44.8100, lo: 16.0100, rez: 375 }
  ] };
  assert.ok(Math.abs(_poziPovrsinaGrupe(razlicito) - 14.0625 * 2 * 0.35) < 0.001, 'daleko = odvojeni pikseli, moraju se sabrati');
  assert.strictEqual(_poziPovrsinaGrupe({ pts: [] }), 0);
});

t('_poziPovrsinaJedinstvena ne sabira isti piksel dvaput kroz više požarnih grupa', () => {
  const src = extractFn('_poziPixelHa') + '\nconst _POZ_HOTSPOT_FAKTOR=0.35;\n' + extractFn('_poziProcijenjeniHa') + '\n' + extractFn('_poziPovrsinaGrupe') + '\n'
    + extractFn('_poziPovrsinaJedinstvena') + '\nreturn _poziPovrsinaJedinstvena;';
  const fn = new Function(src)();
  const p = { la:44.8000, lo:16.0000, rez:375 };
  const skoroIsti = { la:44.80005, lo:16.00005, rez:375 };
  assert.ok(Math.abs(fn([{ pts:[p] }, { pts:[skoroIsti] }]) - 14.0625 * 0.35) < 0.001);
});

t('_poziPovrsTxt formatira hektare (decimala ispod 100, zaokruženo iznad)', () => {
  const src = extractFn('_poziPovrsTxt') + '\nreturn _poziPovrsTxt;';
  const _poziPovrsTxt = new Function(src)();
  assert.strictEqual(_poziPovrsTxt(0), '0 ha');
  assert.strictEqual(_poziPovrsTxt(14.0625), '14.1 ha');
  assert.strictEqual(_poziPovrsTxt(1234), '1.234 ha');
});

t('_povGodUrl gradi kanton-bbox+cijela-godina SQL upit kao query string', () => {
  const src = "const _USK_BBOX = { latMin: 44.30, latMax: 45.30, lonMin: 15.60, lonMax: 16.90 };\n"
    + extractFn('_poziGfwKantonUrl') + '\n' + extractFn('_povGodUrl') + '\nreturn _povGodUrl;';
  const _povGodUrl = new Function(src)();
  const url = _povGodUrl(2026);
  assert.ok(url.startsWith('https://data-api.globalforestwatch.org/dataset/nasa_viirs_fire_alerts/latest/query/json?sql='));
  const sql = decodeURIComponent(url.split('sql=')[1]);
  assert.ok(sql.includes("alert__date >= '2026-01-01'"), 'mora tražiti od 1. januara te godine');
  assert.ok(sql.includes("alert__date <= '2026-12-31'"), 'mora završiti 31. decembra iste godine');
  assert.ok(sql.includes('latitude >= 44.300'), 'mora koristiti FIKSAN kanton bbox, ne radijus oko ref tačke');
  assert.ok(sql.includes('LIMIT 5000'));
});

t('_poziGfw30Url traži zadnjih 30 dana unutar kanton bbox-a', () => {
  const src = "const _USK_BBOX = { latMin: 44.30, latMax: 45.30, lonMin: 15.60, lonMax: 16.90 };\n"
    + extractFn('_poziGfwKantonUrl') + '\n' + extractFn('_poziGfw30Url') + '\nreturn _poziGfw30Url;';
  const _poziGfw30Url = new Function(src)();
  const url = _poziGfw30Url();
  const sql = decodeURIComponent(url.split('sql=')[1]);
  const od = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  assert.ok(sql.includes("alert__date >= '" + od + "'"), 'mora tražiti tačno 30 dana unazad');
  assert.ok(sql.includes('latitude >= 44.300'), 'mora koristiti kanton bbox');
});

t('_povGodGrupisiPoMjesecu raspoređuje grupe po mjesecu zadnje detekcije i sabira površinu', () => {
  const src = extractFn('_poziPixelHa') + '\nconst _POZ_HOTSPOT_FAKTOR=0.35;\n' + extractFn('_poziProcijenjeniHa') + '\n' + extractFn('_poziPovrsinaGrupe') + '\n' + extractFn('_povGodGrupisiPoMjesecu') + '\nreturn _povGodGrupisiPoMjesecu;';
  const _povGodGrupisiPoMjesecu = new Function(src)();
  const grupe = [
    { zadnji: Date.parse('2026-03-15T10:00:00Z'), pts: [{ la: 44.80, lo: 16.00, rez: 375 }] },
    { zadnji: Date.parse('2026-03-20T10:00:00Z'), pts: [{ la: 44.90, lo: 16.10, rez: 375 }] },
    { zadnji: Date.parse('2026-07-01T10:00:00Z'), pts: [{ la: 45.00, lo: 16.20, rez: 1000 }] }
  ];
  const mjeseci = _povGodGrupisiPoMjesecu(grupe);
  assert.strictEqual(mjeseci.length, 2);
  assert.strictEqual(mjeseci[0].mjesec, 2); // mart = index 2
  assert.strictEqual(mjeseci[0].broj, 2);
  assert.ok(Math.abs(mjeseci[0].ha - 14.0625 * 2 * 0.35) < 0.001);
  assert.strictEqual(mjeseci[1].mjesec, 6); // juli = index 6
  assert.strictEqual(mjeseci[1].broj, 1);
  assert.ok(Math.abs(mjeseci[1].ha - 100 * 0.35) < 0.001);
});

t('_poziSimEligible: samo veći požari praćeni 3 uzastopna dana', () => {
  const src = extractFn('_poziDanUTC') + '\n' + extractFn('_poziDaniUzastopni') + '\n' + extractFn('_poziSimDani') + '\n' + extractFn('_poziSimEligible') + '\nreturn _poziSimEligible;';
  const _poziSimEligible = new Function(src)();
  const kratak = { broj:2, pts:[{dt:'2026-07-01T00:00:00Z'},{dt:'2026-07-02T00:00:00Z'}] };
  const dug = { broj:3, pts:[{dt:'2026-07-01T00:00:00Z'},{dt:'2026-07-02T00:00:00Z'},{dt:'2026-07-03T00:00:00Z'}] };
  const prekid = { broj:3, pts:[{dt:'2026-07-01T00:00:00Z'},{dt:'2026-07-02T00:00:00Z'},{dt:'2026-07-05T00:00:00Z'}] };
  assert.strictEqual(_poziSimEligible(kratak), false);
  assert.strictEqual(_poziSimEligible(dug), true);
  assert.strictEqual(_poziSimEligible(prekid), false);
});

t('_poziSimDani vraća distinktne UTC dane hronološki', () => {
  const src = extractFn('_poziSimDani') + '\nreturn _poziSimDani;';
  const _poziSimDani = new Function(src)();
  const g = { pts: [
    { dt: '2026-07-03T10:00:00Z' },
    { dt: '2026-07-01T05:00:00Z' },
    { dt: '2026-07-01T22:00:00Z' }, // isti dan kao gornji — ne smije se duplirati
    { dt: '2026-07-02T00:00:00Z' }
  ] };
  assert.deepStrictEqual(_poziSimDani(g), ['2026-07-01', '2026-07-02', '2026-07-03']);
});

t('_poziSimPodaciZaDan je kumulativan — dan N sadrži sve detekcije zaključno sa tim danom', () => {
  const src = extractFn('_poziPixelHa') + '\nconst _POZ_HOTSPOT_FAKTOR=0.35;\n' + extractFn('_poziProcijenjeniHa') + '\n' + extractFn('_poziPovrsinaGrupe') + '\n' +
    extractFn('_poziSimDani') + '\n' + extractFn('_poziSimPodaciZaDan') + '\nreturn _poziSimPodaciZaDan;';
  const _poziSimPodaciZaDan = new Function(src)();
  const g = { pts: [
    { la: 44.80, lo: 16.00, dt: '2026-07-01T05:00:00Z', rez: 375 },
    { la: 44.85, lo: 16.05, dt: '2026-07-02T05:00:00Z', rez: 375 },
    { la: 44.90, lo: 16.10, dt: '2026-07-04T05:00:00Z', rez: 375 }
  ] };
  const dan0 = _poziSimPodaciZaDan(g, 0);
  assert.strictEqual(dan0.pts.length, 1);
  assert.strictEqual(dan0.dan, '2026-07-01');
  const dan1 = _poziSimPodaciZaDan(g, 1);
  assert.strictEqual(dan1.pts.length, 2, 'dan 2 mora sadržati i dan 1');
  const dan2 = _poziSimPodaciZaDan(g, 2);
  assert.strictEqual(dan2.pts.length, 3, 'zadnji dan mora sadržati sve detekcije');
  assert.ok(dan2.ha > dan1.ha, 'kumulativna površina mora rasti sa danima');
});

t('_poziOpozGrupisiPoStarosti raspoređuje tačke po ISTIM bandovima kao markeri (_POZ_MK_STAROST)', () => {
  const src = "const _POZ_MK_STAROST = [{id:'h6',maxH:6,fill:'#fdba74'},{id:'h24',maxH:24,fill:'#fb923c'},{id:'d3',maxH:72,fill:'#c2410c'},{id:'st',maxH:Infinity,fill:'#292524'}];\n" +
    extractFn('_poziMkStarost') + '\n' + extractFn('_poziOpozGrupisiPoStarosti') + '\nreturn _poziOpozGrupisiPoStarosti;';
  const _poziOpozGrupisiPoStarosti = new Function(src)();
  const now = Date.now();
  const pts = [
    { la: 44.8, lo: 16.0, dt: new Date(now - 2 * 3600000).toISOString() },   // 2h -> h6
    { la: 44.8, lo: 16.0, dt: new Date(now - 10 * 3600000).toISOString() },  // 10h -> h24
    { la: 44.8, lo: 16.0, dt: new Date(now - 5 * 86400000).toISOString() }   // 5 dana -> st
  ];
  const bands = _poziOpozGrupisiPoStarosti(pts);
  assert.strictEqual(bands.h6.length, 1);
  assert.strictEqual(bands.h24.length, 1);
  assert.strictEqual(bands.st.length, 1);
  assert.strictEqual(bands.d3, undefined);
});

t('_poziOpozBufKm daje veći poluprečnik za MODIS (1km) nego VIIRS (375m)', () => {
  const src = extractFn('_poziPixelHa') + '\nconst _POZ_HOTSPOT_FAKTOR=0.35;\n' + extractFn('_poziProcijenjeniHa') + '\n' + extractFn('_poziOpozBufKm') + '\nreturn _poziOpozBufKm;';
  const _poziOpozBufKm = new Function(src)();
  const viirs = _poziOpozBufKm(375), modis = _poziOpozBufKm(1000);
  assert.ok(modis > viirs);
  assert.ok(viirs > 0.10 && viirs < 0.15, 'VIIRS poluprečnik van očekivanog opsega: ' + viirs);
});

t('_poziOpozGeom pravi buffer poligon oko tačaka (koristi pravi turf iz static/libs)', () => {
  const turf = require(path.join(__dirname, '../../static/libs/turf.min.js'));
  const src = extractFn('_poziPixelHa') + '\nconst _POZ_HOTSPOT_FAKTOR=0.35;\n' + extractFn('_poziProcijenjeniHa') + '\n' + extractFn('_poziOpozBufKm') + '\n' + extractFn('_poziOpozGeom') + '\nreturn _poziOpozGeom;';
  const _poziOpozGeom = new Function('turf', src)(turf);
  // Jedna tačka — mora vratiti buffer poligon (Polygon/MultiPolygon) oko nje.
  const geomJedna = _poziOpozGeom([{ la: 44.8, lo: 16.0, rez: 375 }]);
  assert.ok(geomJedna, 'jedna tačka mora dati geometriju (buffer kruga)');
  assert.match(geomJedna.geometry.type, /Polygon/);
  // Tri razmaknute tačke ostaju zasebni krugovi; praznine se ne popunjavaju hullom.
  const geomTri = _poziOpozGeom([
    { la: 44.80, lo: 16.00, rez: 375 }, { la: 44.81, lo: 16.01, rez: 375 }, { la: 44.80, lo: 16.02, rez: 375 }
  ]);
  assert.ok(geomTri, 'tri tačke moraju dati geometriju zasebnih piksela');
  if (geomTri.type === 'FeatureCollection') assert.strictEqual(geomTri.features.length, 3);
  else assert.match(geomTri.geometry.type, /Polygon/);
  // Prazan niz / nepostojeći turf → bez pucanja, vraća null.
  assert.strictEqual(_poziOpozGeom([]), null);
});

t('_povGodDostupneGodine nudi tekuću i četiri prethodne godine', () => {
  const src = extractFn('_povGodDostupneGodine') + '\nreturn _povGodDostupneGodine;';
  const fn = new Function('_POV_GOD_BROJ_GODINA', src)(5);
  assert.deepStrictEqual(fn(2026), [2022, 2023, 2024, 2025, 2026]);
  assert.deepStrictEqual(fn(2028), [2024, 2025, 2026, 2027, 2028]);
});

t('_povGodBoja razlikuje svježe, sedmične, tekuće i prošlogodišnje plohe', () => {
  const src = extractFn('_povGodBoja') + '\nreturn _povGodBoja;';
  const fn = new Function('_POZ_GOD_BOJA_OVE','_POZ_GOD_BOJA_PROSLE',src)('#eab308','#64748b');
  const sada = Date.now(), godina = new Date().getUTCFullYear();
  assert.strictEqual(fn({ zadnji:sada - 2*3600000 }, godina), '#dc2626');
  assert.strictEqual(fn({ zadnji:sada - 3*86400000 }, godina), '#f97316');
  assert.strictEqual(fn({ zadnji:sada - 30*86400000 }, godina), '#eab308');
  assert.strictEqual(fn({ zadnji:Date.UTC(godina-1,5,1) }, godina-1), '#64748b');
});

t('projekcija plohe je uključena po defaultu i stari završni tekst je uklonjen', () => {
  assert.ok(HTML.includes("return v === null ? true : v === '1'"));
  assert.ok(!HTML.includes('Površina je gruba procjena iz vrelih piksela'));
  assert.ok(HTML.includes('id="poz-god-izbor"'));
});

t('EFFIS šira procjena se migrira na isključeno, a GFW ključ se čeka prije godišnjeg učitavanja', () => {
  assert.ok(HTML.includes("_poziEffisState.opozareno = false"));
  assert.ok(HTML.includes('EFFIS NRT plohe (šira procjena)'));
  assert.ok(HTML.includes("layers: 'nrt.ba.poly.season'"), 'mora koristiti postojeći EFFIS sezonski sloj, ne uklonjeni modis.ba');
  assert.ok(HTML.includes("layers: 'modis.hs.month'"), 'mora imati EFFIS satelitske detekcije za zadnjih 30 dana');
  assert.ok(HTML.includes("_poziEffisState.detekcije = true"), 'satelitske detekcije moraju biti uključene pri prvom ulasku');
  const fn = extractFn('openPozariSection');
  assert.ok(fn.startsWith('async function'), 'otvaranje Požara mora čekati GFW ključ');
  assert.ok(fn.indexOf('await _poziKljucUcitaj()') < fn.indexOf('_povGodLoadGodina'), 'ključ mora doći prije godišnjeg dohvata');
});

t('_uskUnutar prihvata tačke unutar Unsko-sanskog kantona, odbija van njega', () => {
  const src = extractFn('_uskUnutar') + '\nreturn _uskUnutar;';
  const _uskUnutar = new Function('_USK_BBOX', src)({ latMin: 44.30, latMax: 45.30, lonMin: 15.60, lonMax: 16.90 });
  assert.strictEqual(_uskUnutar(44.8, 16.0), true, 'Bihać okolina mora biti unutar');
  assert.strictEqual(_uskUnutar(43.8, 18.4), false, 'Sarajevo mora biti van kantona');
  assert.strictEqual(_uskUnutar(44.8, 20.0), false, 'daleko istočno mora biti van');
});

t('_poziHistSpojiIzvore dedupira isti požar viđen u dva izvora (blizu = ista grupa)', () => {
  const src = dstSrc + '\nconst _POZ_GRUPA_M = 450;\n' + extractFn('_poziHistSpojiIzvore') + '\nreturn _poziHistSpojiIzvore;';
  const _poziHistSpojiIzvore = new Function(src)();
  const a = { la: 44.80, lo: 16.00, broj: 3 };
  const bIsti = { la: 44.8001, lo: 16.0001, broj: 5 }; // ista lokacija, drugi izvor, više detekcija
  const cDaleko = { la: 44.95, lo: 16.30, broj: 2 };
  const spojeno = _poziHistSpojiIzvore([[a], [bIsti, cDaleko]]);
  assert.strictEqual(spojeno.length, 2, 'a i bIsti se moraju spojiti u jednu grupu, cDaleko ostaje zasebna');
  assert.strictEqual(spojeno[0].broj, 5, 'zadržava se verzija sa VIŠE detekcija (potpunija)');
});

t('_poziHistSortiraj sortira po blizini/vremenu/jačini', () => {
  const src = extractFn('_poziHistSortiraj') + '\nreturn _poziHistSortiraj;';
  const _poziHistSortiraj = new Function(src)();
  const grupe = [
    { d: 5000, zadnji: 100, frpMax: 2 },
    { d: 1000, zadnji: 300, frpMax: 9 },
    { d: 9000, zadnji: 200, frpMax: 5 }
  ];
  assert.deepStrictEqual(_poziHistSortiraj(grupe, 'blizina').map(g => g.d), [1000, 5000, 9000]);
  assert.deepStrictEqual(_poziHistSortiraj(grupe, 'vrijeme').map(g => g.zadnji), [300, 200, 100]);
  assert.deepStrictEqual(_poziHistSortiraj(grupe, 'jacina').map(g => g.frpMax), [9, 5, 2]);
});

t('Pregled ima godišnje KPI kartice, a godišnja lista je samo u Historiji', () => {
  assert.ok(HTML.includes('id="poz-god-kpi"'), 'nedostaje godišnji KPI blok');
  assert.ok(HTML.includes('Kompletna evidencija od 2026. godine'), 'Historija mora sadržati godišnju evidenciju');
  assert.ok(!HTML.includes('id="poz-god-body"'), 'stara godišnja lista ne smije ostati u Pregledu');
});

console.log('\n' + pass + ' prošlo, 0 palo — požari');
