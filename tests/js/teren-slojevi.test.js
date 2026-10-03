'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const R = f => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
const HTML = R('index.html');
const T = require('../../static/js/tacke.js');

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
const testovi = [];
const t = (name, fn) => testovi.push([name, fn]);

console.log('Terenske tačke, fotografije i podloge USK:');

t('CRC32 i KMZ (ZIP) iz terenskih tačaka čita i uvoz KML-a', async () => {
  assert.strictEqual(T.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  const F = new Function(['_zipUlazi', '_zipIzvuci', '_kmzExtractKml'].map(extractFn).join('\n') + '\nreturn { _zipUlazi, _zipIzvuci, _kmzExtractKml };')();
  const foto = new Uint8Array([0xFF, 0xD8, 0xFF, 1, 2, 3]);
  const buf = await T.zip([['doc.kml', new TextEncoder().encode('<kml><name>Tačka š</name></kml>')], ['files/f1.jpg', foto]]).arrayBuffer();
  const u = F._zipUlazi(buf);
  assert.deepStrictEqual(u.map(x => x.ime), ['doc.kml', 'files/f1.jpg']);
  assert.ok((await F._kmzExtractKml(buf)).includes('Tačka š'), 'UTF-8 naziv');
  assert.deepStrictEqual([...await F._zipIzvuci(buf, u[1])], [...foto]);
});

t('tačke: kategorije, globalni map/lastP (ne window.map = <div id="map">), klik kroz zajednički izvor', () => {
  const js = R('static/js/tacke.js');
  assert.ok(T.KATEGORIJE.length >= 6 && T.KATEGORIJE.every(k => /^#[0-9a-f]{6}$/i.test(k.boja)));
  const kod = js.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/root\.map\b|root\.lastP\b|window\.map\b/.test(kod), 'map i lastP su leksički globalni');
  assert.ok(js.includes("typeof lastP !== 'undefined' ? lastP : null") && js.includes("_kartaKlikIzvor((ll, kp) => citaj()"));
  assert.ok(js.includes("map.getPane('tackePane').style.pointerEvents = 'none'"), 'DOM igle ne hvataju dodir');
  assert.ok(js.includes("imageOrientation: 'from-image'") && js.includes('FOTO_MAX = 1600'), 'smanjenje uz EXIF orijentaciju');
  assert.ok(js.includes("indexedDB.open('usf_foto', 1)"), 'fotografije u IndexedDB');
  assert.ok(js.includes('capture="environment"'), 'kamera direktno');
});

t('tačke: UI — dugme na karti, Moja lokacija, traka snimanja, meni, panel, izvoz binarnog KMZ-a', () => {
  ['id="ab-tacka"', 'USFTacke.naGps(true)', 'id="rb-tacka"', 'id="mc-tacke"', 'id="tacke-panel"', "'tacke-panel'", '<script src="static/js/tacke.js">'].forEach(x => assert.ok(HTML.includes(x), x));
  assert.ok(R('static/js/odjeli.js').includes('if (sadrzaj instanceof Blob)'), '_izvozFajl prima Blob');
  assert.ok(/USFTacke\.fotoUrl\(img\.dataset\.foto, true\)/.test(HTML), 'pregled otvara punu fotografiju, ne minijaturu');
});

t('APK: birač slika nudi kameru (FileProvider) i vraća fotografiju', () => {
  const j = R('android/app/src/main/java/ba/spd/usf/forest/MainActivity.java');
  assert.ok(j.includes('isImageChooser(fileChooserParams)') && j.includes('MediaStore.ACTION_IMAGE_CAPTURE') && j.includes('MediaStore.EXTRA_OUTPUT'));
  assert.ok(j.includes('fileChooserParams.isCaptureEnabled()'), 'capture → odmah kamera');
  assert.ok(j.includes('results == null && cameraUri != null') && j.includes('f.length() > 0'), 'rezultat kamere iz fajla');
  assert.ok(R('android/app/src/main/res/xml/filepaths.xml').includes('<cache-path'), 'cache/foto preko FileProvidera');
});

t('podloge USK: podaci u APK-u i SW-u, vlastiti pane-ovi iznad offline podloge', () => {
  const g = JSON.parse(R('static/data/opcine_usk.geojson'));
  assert.deepStrictEqual(g.features.map(f => f.properties.ime).sort(), ['Bihać', 'Bosanska Krupa', 'Bosanski Petrovac', 'Bužim', 'Cazin', 'Ključ', 'Sanski Most', 'Velika Kladuša']);
  const tlo = JSON.parse(R('static/data/tlo_usk.json'));
  const zbir = tlo.jedinice.reduce((s, j) => s + j.udio, 0);
  assert.ok(Math.abs(zbir - 1) < 0.01 && tlo.jedinice.every(j => j.naziv && /^#[0-9a-f]{6}$/i.test(j.boja)), 'legenda tla');
  assert.strictEqual(new Set(tlo.jedinice.map(j => j.boja)).size, tlo.jedinice.length, 'svaka jedinica svoja boja');
  assert.ok(fs.statSync(path.join(__dirname, '../../static/data/tlo_usk.tif')).size > 500);
  const js = R('static/js/usk-slojevi.js');
  assert.ok(/\['ukZimaPane', 212\]/.test(js) && /\['ukTloPane', 395\]/.test(js) && /\['ukGranicePane', 405\]/.test(js), 'pane-ovi iznad offlineBasePane (210)');
  assert.ok(js.includes("style.pointerEvents = 'none'") && js.includes('_kartaKlikIzvor'), 'klik kroz zajednički izvor');
  const sw = R('sw.js'), kop = R('android/copy-assets.sh');
  ['static/js/usk-slojevi.js', 'static/js/tacke.js', 'static/data/opcine_usk.geojson', 'static/data/tlo_usk.tif', 'static/data/tlo_usk.json'].forEach(f => {
    assert.ok(sw.includes("'./" + f + "'"), 'SW: ' + f); assert.ok(kop.includes(f), 'APK: ' + f);
  });
  ['id="uk-granice-switch"', 'id="uk-tlo-switch"', 'id="uk-zima-switch"', '<script src="static/js/usk-slojevi.js">'].forEach(x => assert.ok(HTML.includes(x), x));
});

t('zimski snimak: pločice z8–14 unutar USK, metapodaci, sloj iznad offline podloge', () => {
  const z = JSON.parse(R('static/data/zima.json'));
  assert.deepStrictEqual(z.zoom, [8, 14]);
  assert.ok(z.scena >= 10 && z.pločica > 1000, 'dovoljno scena i pločica');
  const dir = path.join(__dirname, '../../static/data/zima');
  const man = JSON.parse(R('static/data/zima_paketi.json'));
  for (let k = z.zoom[0]; k <= z.zoom[1]; k++) assert.strictEqual(fs.existsSync(path.join(dir, String(k))), k <= man.ugradjeno[1], 'ugrađen samo pregled do z' + man.ugradjeno[1] + ' (zoom ' + k + ')');
  assert.strictEqual(man.podrucja.length, 9, 'cijeli kanton + 8 općina/gradova');
  for (const p of man.podrucja) for (const zz of ['12', '13', '14']) assert.ok(p.pojasevi[zz].bajtova > 0 && p.pojasevi[zz].fajl === p.id + '_z' + zz + '.zip', p.id + ' z' + zz);
  assert.ok(/^https:\/\/raw\.githubusercontent\.com\//.test(man.baza), 'paketi sa raw.githubusercontent.com (CORS *)');
  const f = path.join(dir, '10/558/369.webp'), b = fs.readFileSync(f);
  assert.ok(b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP', 'WebP pločica');
  const js = R('static/js/usk-slojevi.js');
  assert.ok(js.includes('root.USKZima.napraviSloj(') && js.includes("onclick=\"USKSlojevi.zimaObrisi('${id}')\""));
  const zj = R('static/js/zima.js');
  assert.ok(zj.includes("caches.match(kljuc(z, x, y))") && zj.includes('_zipUlazi(buf)') && zj.includes("caches.delete(KES + id)"), 'paketi u Cache Storage, brisanje po području');
  assert.ok(zj.includes('for (let z = c.z, k = 0; z >= Z_MIN; z--, k++)'), 'nedostajući nivo → uvećan grublji');
  assert.ok(zj.includes('setTimeout(() => ctl.abort(), 6000)') && zj.includes('vezaLosa()'), 'online pločice s rokom, preskoči na slaboj vezi');
  ['id="zp-pod"', 'id="zp-zoom"', 'id="zp-preuzmi"', 'USKZima.prekini()', '<script src="static/js/zima.js">'].forEach(x => assert.ok(HTML.includes(x), x));
});

t('centar karte i razmjera: bijela tačka uvijek, sitnije od 1:20 000 oznake umjesto etiketa', () => {
  assert.ok(/#loc-center-dot \{[^}]*background:#fff/.test(HTML) && !/#loc-center-dot \{[^}]*display:none/.test(HTML), 'stalna bijela tačka');
  assert.ok(HTML.includes('const RAZMJERA_SITNA = 20000;') && HTML.includes("map.on('zoomend', _razmjeraOsvjezi)"));
  assert.ok(HTML.includes("_razmjeraTacka(latlngs, color, 'tragMsrLines').addTo(_msrPinLayer)"), 'mjerenja: oznaka na sitnoj razmjeri');
  const np = R('static/js/nagib-poligon.js');
  assert.ok(np.includes('body.razmjera-sitna .np-sv-lbl { display:none; }') && np.includes("_razmjeraTacka(z.ring, boja, 'nagibSvPane')"), 'nagib: etiketa ne prekriva poligon');
  const i = HTML.indexOf('function _razmjera()'), j = HTML.indexOf('<script src="static/js/nagib-poligon.js">');
  assert.ok(i > 0 && j > i, 'nagib-poligon.js se učitava poslije _razmjeraOznake');
});

(async () => {
  for (const [ime, fn] of testovi) {
    try { await fn(); pass++; console.log('  ✔ ' + ime); }
    catch (e) { console.error('  ✘ ' + ime + '\n      ' + e.message); process.exitCode = 1; }
  }
  console.log('\n' + pass + ' prošlo, ' + (process.exitCode ? 'IMA PALIH' : '0 palo') + ' — terenske tačke i podloge USK');
})();
