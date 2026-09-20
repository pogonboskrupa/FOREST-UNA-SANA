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

t('APK koristi nativni MBTiles put bez kopiranja cijele baze u JavaScript RAM', () => {
  assert.ok(HTML.includes("typeof AndroidMbtiles !== 'undefined'"));
  assert.ok(HTML.includes('AndroidMbtiles.listMaps()'));
  assert.ok(HTML.includes("appassets.androidplatform.net/mbtiles/"));
  const restore = extractFn('_sqlmapRestoreAll');
  assert.ok(restore.includes('const nativeRecords = _nativeSqlmapRecords()'));
  assert.ok(restore.includes('if (nativeTarget)'));
  assert.ok(restore.indexOf('if (nativeTarget)') < restore.indexOf('await _sqlIdbGetAll()'));
});

console.log('\n' + pass + ' prošlo, 0 palo — učitaj karta');
