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

t('serija (drain i oporavak poslije pada) preskače crtanje po tački, linija se postavi jednom', () => {
  const add = izvadi('_addTragPoint'), ser = izvadi('_tragDodajSeriju');
  assert.ok(add.indexOf('if (_tragSerija) return;') < add.indexOf('_tragLine.addLatLng'));
  assert.ok(ser.includes('_tragSerija = pts.length > 3') && ser.includes('finally { _tragSerija = false; }'));
  assert.ok(ser.includes('_tragLine.setLatLngs(_tragPts.map('));
  assert.ok(izvadi('_drainNativeGpsBuffer').includes('_tragDodajSeriju(pts,'), 'drain');
  const cc = H.slice(H.indexOf('async function _crashCheck('), H.indexOf('setTimeout(_crashCheck'));
  assert.ok(cc.includes('_tragDodajSeriju(bufPts,') && !/for \(const p of bufPts\)[^\n]*_addTragPoint/.test(cc), 'oporavak');
  assert.ok(!H.includes('_tragCalcLen(_tragPts)'), 'traka i obavijest koriste _tragDuzina');
  assert.ok(!H.includes('JSON.stringify({ pts:_tragPts, ts:Date.now(), lastT:_tragLastT, paused:_tragPaused })'), 'snimak samo kroz _tragSnimak (nosi prekide)');
});

t('prekidi GPS-a: rupa > 60 s se broji, kontinuirano snimanje = 0', () => {
  const env = new Function('const _TRAG_PREKID_S = 60; let _tragPrekidi = { n: 0, maxS: 0, zadFix: 0 };\n' + izvadi('_tragPrekidBiljezi') +
    '\nreturn { b: _tragPrekidBiljezi, pr: () => _tragPrekidi, reset: t => { _tragPrekidi = { n: 0, maxS: 0, zadFix: t }; } };')();
  env.reset(0); for (let t = 2000; t <= 3 * 3600e3; t += 2000) env.b(t);
  assert.deepStrictEqual([env.pr().n, env.pr().maxS], [0, 0], '3 h bez rupe');
  env.reset(0); env.b(30e3); env.b(330e3); env.b(332e3); env.b(390e3);
  assert.deepStrictEqual([env.pr().n, env.pr().maxS], [1, 300], 'rupa 5 min');
  env.b(380e3); assert.strictEqual(env.pr().zadFix, 390e3, 'stariji fiks (serija) ne vraća vrijeme unazad');
  const txt = new Function('return ' + /const _tragPrekidTxt = ([^\n]+);/.exec(H)[1])();
  assert.strictEqual(txt({ n: 0 }), '0'); assert.strictEqual(txt({ n: 2, maxS: 300 }), '2 (najduži 5 min)');
  assert.ok(izvadi('togTragPause').includes('_tragPrekidi.zadFix = Date.now()'), 'pauza se ne broji kao prekid');
  assert.ok(H.includes("redovi.push(['Prekidi GPS-a', _tragPrekidTxt(t.prekidi)])"));
});

t('prije starta provjera prostora; GpsService ne pada na odbijen startForeground', () => {
  assert.ok(H.includes('_gpsStabilizeGate(async () => { await _tragProvjeriProstor(); _fabSnimTragBegin(); })'));
  const G = fs.readFileSync(path.join(__dirname, '../../android/app/src/main/java/ba/spd/usf/forest/GpsService.java'), 'utf8');
  assert.ok(G.includes('private boolean showForegroundNotification') && G.includes('catch (RuntimeException e)'));
  const tr = G.slice(G.indexOf('public void onTaskRemoved'));
  assert.ok(!tr.slice(0, tr.indexOf('\n    }')).includes('showForegroundNotification'), 'onTaskRemoved ne zove startForeground iz pozadine');
});

t('Drive lista ima istek (slab signal), Xiaomi Autostart prečica', () => {
  assert.ok(izvadi('_dkUcitaj').includes('setTimeout(() => ctl.abort(), 8000)'));
  const J = fs.readFileSync(path.join(__dirname, '../../android/app/src/main/java/ba/spd/usf/forest/MainActivity.java'), 'utf8');
  assert.ok(J.includes('public boolean jeXiaomi()') && J.includes('AutoStartManagementActivity'));
  assert.ok(H.includes('id="set-autostart"') && H.includes("localStorage.getItem('usf_autostart_hint')"));
});
console.log(`  ${pass} testova prošlo`);
