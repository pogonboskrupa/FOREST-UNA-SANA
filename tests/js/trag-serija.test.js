'use strict';
// Snimanje traga na sporijem telefonu: paket iz native bafera (sat pod zaključanim
// ekranom) ne smije crtati liniju i računati dužinu po tački (O(n²) ⇒ app zamrzne).
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const H = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
let pass = 0;
const t = (ime, fn) => { fn(); pass++; console.log('  ✓ ' + ime); };
console.log('Trag — serija iz native bafera:');

const izvadi = ime => { const i = H.indexOf('function ' + ime + '('); return H.slice(i, H.indexOf('\n}', i) + 2); };
const dst = (a, b, c, d) => Math.hypot(a - c, b - d);

t('inkrementalna dužina = puna dužina, reset na novi niz i skraćenje', () => {
  const env = new Function('dst', 'let _tragPts = [];\nconst _tragDuzKes = { pts: null, n: 0, d: 0 };\n' + izvadi('_tragDuzina') +
    '\nreturn { set: p => { _tragPts = p; }, d: _tragDuzina };')(dst);
  const pts = []; for (let i = 0; i < 50; i++) pts.push([i, i % 3, 0, i, 5]);
  const puna = a => a.slice(1).reduce((s, p, i) => s + dst(a[i][0], a[i][1], p[0], p[1]), 0);
  env.set(pts.slice(0, 10)); env.d();
  const a = pts.slice(0, 10); env.set(a); env.d(); for (const p of pts.slice(10)) a.push(p);
  assert.ok(Math.abs(env.d() - puna(pts)) < 1e-9, 'dopisivanje');
  a.length = 5; assert.ok(Math.abs(env.d() - puna(a)) < 1e-9, 'skraćen niz');
  const b = pts.slice(20, 30); env.set(b); assert.ok(Math.abs(env.d() - puna(b)) < 1e-9, 'novi niz');
});

t('drain: serija preskače crtanje po tački, linija se postavi jednom', () => {
  const add = izvadi('_addTragPoint'), drain = izvadi('_drainNativeGpsBuffer');
  assert.ok(add.indexOf('if (_tragSerija) return;') < add.indexOf('_tragLine.addLatLng'));
  assert.ok(drain.includes('_tragSerija = pts.length > 3') && drain.includes('finally { _tragSerija = false; }'));
  assert.ok(drain.includes('_tragLine.setLatLngs(_tragPts.map('));
  assert.ok(!H.includes('_tragCalcLen(_tragPts)'), 'traka i obavijest koriste _tragDuzina');
});

t('Drive lista ima istek (slab signal), Xiaomi Autostart prečica', () => {
  assert.ok(izvadi('_dkUcitaj').includes('setTimeout(() => ctl.abort(), 8000)'));
  const J = fs.readFileSync(path.join(__dirname, '../../android/app/src/main/java/ba/spd/usf/forest/MainActivity.java'), 'utf8');
  assert.ok(J.includes('public boolean jeXiaomi()') && J.includes('AutoStartManagementActivity'));
  assert.ok(H.includes('id="set-autostart"') && H.includes("localStorage.getItem('usf_autostart_hint')"));
});
console.log(`  ${pass} testova prošlo`);
