'use strict';
// Inventura šuma: geodezija udaljenosti/azimuta, stanje u odnosu na granicu plohe i čitanje unutrašnjih krugova.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const SRC0 = fs.readFileSync(path.join(__dirname, '../../static/js/inventura.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
let pass = 0;
const t = (ime, fn) => { fn(); pass++; console.log('  ✓ ' + ime); };
console.log('Inventura šuma:');

const win = {};
new Function('window', 'localStorage', SRC0)(win, { getItem: () => null, setItem() {} });
const T = win.USFInv._test;

t('udaljenost: 25 m sjeverno i istočno', () => {
  const dLa = 25 / 111195.08; // 1° geografske širine na sferi R = 6371008,8 m
  assert.ok(Math.abs(T.udaljenost(44.8, 16.0, 44.8 + dLa, 16.0) - 25) < 0.01);
  const dLo = 25 / (111195.08 * Math.cos(44.8 * Math.PI / 180));
  assert.ok(Math.abs(T.udaljenost(44.8, 16.0, 44.8, 16.0 + dLo) - 25) < 0.01);
});

t('azimut prema centru i strana svijeta', () => {
  assert.ok(Math.abs(T.azimut(44.8, 16.0, 44.81, 16.0) - 0) < 0.01);
  assert.ok(Math.abs(T.azimut(44.8, 16.0, 44.8, 16.01) - 90) < 0.1);
  assert.strictEqual(T.strana(225), 'JZ'); assert.strictEqual(T.strana(359), 'S');
});

t('stanje u odnosu na granicu (± 1,5 m)', () => {
  assert.strictEqual(T.stanje(10, 25), 'unutra');
  assert.strictEqual(T.stanje(24, 25), 'granica');
  assert.strictEqual(T.stanje(26.4, 25), 'granica');
  assert.strictEqual(T.stanje(27, 25), 'vani');
});

t('krug je stvarno R metara od centra', () => {
  const k = T.krugTacke(44.8, 16.0, 25, 36);
  assert.strictEqual(k.length, 37);
  k.forEach(([la, lo]) => assert.ok(Math.abs(T.udaljenost(44.8, 16.0, la, lo) - 25) < 0.01));
});

t('unutrašnji krugovi: decimalni zarez, razdvajanje, samo < R', () => {
  assert.deepStrictEqual(T.parsirajKrugove('7; 12,5', 25), [7, 12.5]);
  assert.deepStrictEqual(T.parsirajKrugove('7, 12.62 30', 25), [7, 12.62]);
  assert.deepStrictEqual(T.parsirajKrugove('12,5 7 7', 25), [7, 12.5]);
  assert.deepStrictEqual(T.parsirajKrugove('', 25), []);
});

t('filter poligonom i redoslijed brojeva krugova', () => {
  const ring = [[44, 16], [44, 16.01], [44.01, 16.01], [44.01, 16]];
  assert.ok(T.uPoligonu(44.005, 16.005, ring)); assert.ok(!T.uPoligonu(44.02, 16.005, ring));
  const k = [{ br: '10' }, { br: '2' }, { br: '1' }, { br: '2a' }].sort(T.poBroju).map(x => x.br);
  assert.deepStrictEqual(k, ['1', '2', '2a', '10']);
});

t('Meni: Inventura odmah ispod Projektovanja puta, panel registrovan, skripta u sw.js', () => {
  const put = HTML.indexOf('id="mc-put"'), inv = HTML.indexOf('id="mc-inventura"'), tem = HTML.indexOf('id="mc-tematska"');
  assert.ok(put > 0 && inv > put && tem > inv);
  assert.ok(HTML.includes("'inventura-panel'];") && HTML.includes('<script src="static/js/inventura.js">'));
  assert.ok(fs.readFileSync(path.join(__dirname, '../../sw.js'), 'utf8').includes('./static/js/inventura.js'));
  assert.ok(fs.readFileSync(path.join(__dirname, '../../android/copy-assets.sh'), 'utf8').includes('static/js/inventura.js'));
});

console.log(`inventura: ${pass} ok`);
