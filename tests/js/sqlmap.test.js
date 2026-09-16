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

console.log('\n' + pass + ' prošlo, 0 palo — učitaj karta');
