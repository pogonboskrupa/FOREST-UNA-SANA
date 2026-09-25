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

console.log('Učitaj karta — MBTiles TMS/XYZ konverzija i bounds parsing:');

t('_sqlTmsY konvertuje XYZ red u TMS red (vertikalni flip)', () => {
  const src = extractFn('_sqlTmsY') + '\nreturn _sqlTmsY;';
  const _sqlTmsY = new Function(src)();
  // Na zoom 3 postoji 8 redova (0..7). XYZ red 0 (vrh) = TMS red 7 (dno).
  assert.strictEqual(_sqlTmsY(3, 0), 7);
  assert.strictEqual(_sqlTmsY(3, 7), 0);
  // Simetrija: primjena dva puta vraća original (flip je involucija).
  assert.strictEqual(_sqlTmsY(5, _sqlTmsY(5, 12)), 12);
});

t('_sqlParseBounds parsira "minLon,minLat,maxLon,maxLat" metadata string', () => {
  const src = "const L = { latLngBounds: (sw, ne) => ({ sw, ne }) };\n" +
    extractFn('_sqlParseBounds') + '\nreturn _sqlParseBounds;';
  const _sqlParseBounds = new Function(src)();
  const b = _sqlParseBounds({ bounds: '16.0,44.7,16.3,44.9' });
  assert.deepStrictEqual(b.sw, [44.7, 16.0]);
  assert.deepStrictEqual(b.ne, [44.9, 16.3]);
});

t('_sqlParseBounds vraća null kad metadata nema bounds ili je neispravan', () => {
  const src = "const L = { latLngBounds: (sw, ne) => ({ sw, ne }) };\n" +
    extractFn('_sqlParseBounds') + '\nreturn _sqlParseBounds;';
  const _sqlParseBounds = new Function(src)();
  assert.strictEqual(_sqlParseBounds({}), null);
  assert.strictEqual(_sqlParseBounds({ bounds: 'nevaljano' }), null);
});

t('brzi izbor karata uključuje aktivnu SQLite/MBTiles kartu', () => {
  assert.ok(HTML.includes('function _sqlmapSyncLayerSwitch()'));
  assert.ok(HTML.includes('data-sqlmap'));
  assert.ok(HTML.includes("btn.textContent = '🗂 ' + r.name"));
});

t('jedinstveni izbor bazne karte migrira stare online/offline postavke', () => {
  const makeStorage = initial => {
    const data = { ...initial };
    return { data, getItem:k => Object.prototype.hasOwnProperty.call(data,k) ? data[k] : null,
      setItem:(k,v) => { data[k]=String(v); }, removeItem:k => { delete data[k]; } };
  };
  const src = "const _BASE_CHOICE_KEY='usf_base_choice_v1';\n" + extractFn('_baseChoiceRead') + '\n' + extractFn('_baseChoiceWrite') + '\nreturn {_baseChoiceRead,_baseChoiceWrite};';
  let storage = makeStorage({ usf_base_layer:'🌐 Protomaps' });
  let api = new Function('localStorage', src)(storage);
  assert.deepStrictEqual(api._baseChoiceRead(), { type:'online', name:'🌐 Protomaps', lastOnline:'🌐 Protomaps' });
  storage = makeStorage({ usf_base_layer:'🌐 Protomaps', usf_sqlmap_active:'teren.mbtiles' });
  api = new Function('localStorage', src)(storage);
  assert.deepStrictEqual(api._baseChoiceRead(), { type:'offline', name:'teren.mbtiles', lastOnline:'🌐 Protomaps' });
});

t('offline izbor čuva posljednju online podlogu za siguran fallback', () => {
  const data = { usf_base_choice_v1:JSON.stringify({type:'online',name:'🛰 Satelit',lastOnline:'🛰 Satelit'}) };
  const storage = { getItem:k => data[k] ?? null, setItem:(k,v) => { data[k]=String(v); }, removeItem:k => { delete data[k]; } };
  const src = "const _BASE_CHOICE_KEY='usf_base_choice_v1';\n" + extractFn('_baseChoiceRead') + '\n' + extractFn('_baseChoiceWrite') + '\nreturn {_baseChoiceRead,_baseChoiceWrite};';
  const api = new Function('localStorage', src)(storage);
  assert.deepStrictEqual(api._baseChoiceWrite('offline','teren.mbtiles'), {type:'offline',name:'teren.mbtiles',lastOnline:'🛰 Satelit'});
});

t('startup vraća samo izabranu offline kartu i ne bira prvu nasumično', () => {
  const restore = extractFn('_sqlmapRestoreAll');
  assert.ok(restore.includes("records.find(r => r.name === choice.name)"));
  assert.ok(!restore.includes('|| _sqlLayers[0]'));
  assert.ok(!restore.includes('for (const rec of records)'));
  assert.ok(HTML.includes("_baseStartupChoice.type === 'offline'"));
  assert.ok(HTML.includes("_baseLoadStatus('⏳ Učitavam ' + target.name"));
});

t('ručni izbor lijeno otvara spremljenu kartu i odmah je aktivira', () => {
  const restore = extractFn('_sqlmapRestoreManual');
  assert.ok(restore.includes('_sqlmapSelect(restored.id, true)'));
  assert.ok(HTML.includes('Ostale velike baze ostaju u IndexedDB'));
});

t('APK koristi nativni MBTiles canvas bez kopiranja cijele baze u JavaScript RAM', () => {
  assert.ok(HTML.includes("typeof AndroidMbtiles !== 'undefined'"));
  assert.ok(HTML.includes('AndroidMbtiles.listMaps()'));
  assert.ok(HTML.includes('const _NativeSqlCanvasLayer = L.GridLayer.extend'));
  assert.ok(HTML.includes('AndroidMbtiles.getTile(this.options.nativeId'));
  assert.ok(HTML.includes("canvas.getContext('2d'"));
  const restore = extractFn('_sqlmapRestoreAll');
  assert.ok(restore.includes('const nativeRecords = _nativeSqlmapRecords()'));
  assert.ok(restore.includes('if (nativeTarget)'));
  assert.ok(restore.indexOf('if (nativeTarget)') < restore.indexOf('await _sqlIdbGetAll()'));
});

// Regresija: maxZoom = najveći zoom fajla je sakrivao cijeli offline sloj čim
// se zumira dalje (siva pozadina). maxZoom mora biti zoom karte, a raspon fajla
// ide u maxNativeZoom/minNativeZoom da se pločice uvećaju/umanje.
t('_sqlZoomOpts: offline karta ostaje vidljiva i preko najvećeg zooma fajla', () => {
  const _sqlZoomOpts = new Function(extractFn('_sqlZoomOpts') + '\nreturn _sqlZoomOpts;')();
  const o = _sqlZoomOpts(12, 13);
  assert.strictEqual(o.maxZoom, 22, 'maxZoom mora biti zoom karte, ne fajla');
  assert.strictEqual(o.maxNativeZoom, 13);
  assert.strictEqual(o.minNativeZoom, 12);
  assert.strictEqual(o.minZoom, 10, 'odzumiranje najviše 2 nivoa ispod fajla');
  assert.strictEqual(_sqlZoomOpts(1, 5).minZoom, 0, 'minZoom ne ide ispod 0');
  const bez = _sqlZoomOpts(undefined, undefined);
  assert.strictEqual(bez.maxNativeZoom, 19); assert.strictEqual(bez.minNativeZoom, 0);
  assert.ok(!/maxZoom:\s*(?:Number\(info\.maxzoom\)|parseInt\(meta\.maxzoom)/.test(HTML), 'offline slojevi ne smiju vezati maxZoom za fajl');
});


// Korisnik traži: izbor/učitavanje offline karte i ponovni ulazak NE mijenjaju poziciju.
t('izbor i uvoz offline karte ne pomjeraju kartu; obuhvat samo na dugme', () => {
  const sel = extractFn('_sqlmapSelect');
  assert.ok(!sel.includes('fitBounds'), '_sqlmapSelect ne smije raditi fitBounds');
  assert.ok(!extractFn('_nativeSqlmapImported').includes('fitBounds'));
  assert.ok(!extractFn('_sqlmapLoadFile').includes('fitBounds'));
  assert.ok(extractFn('_sqlmapZoom').includes('fitBounds'), 'dugme ⤢ Obuhvat i dalje skače na kartu');
  assert.ok(HTML.includes("_sqlmapZoom('${r.id}')\">⤢ Obuhvat"));
  assert.ok(/L\.map\('map', \{[\s\S]{0,400}minZoom: 0,/.test(HTML), 'minZoom karte mora biti eksplicitan (inače ga offline sloj nameće)');
  assert.ok(HTML.includes("localStorage.getItem('usf_last_pos')"), 'start sa zadnje pozicije');
});

t('_sqlmapPokriva: tačka unutar/izvan granica karte, bez granica = pokriva', () => {
  const f = new Function(extractFn('_sqlmapPokriva') + '\nreturn _sqlmapPokriva;')();
  const b = { contains: ll => ll.lat > 44 && ll.lat < 45 };
  assert.strictEqual(f(b, { lat: 44.5 }), true);
  assert.strictEqual(f(b, { lat: 46 }), false);
  assert.strictEqual(f(null, { lat: 46 }), true);
});

console.log('\n' + pass + ' prošlo, 0 palo — učitaj karta');
