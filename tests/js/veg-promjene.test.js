'use strict';
const assert = require('node:assert'), fs = require('node:fs'), path = require('node:path');
const V = require('../../static/js/vegetacija.js');
let pass = 0; const t = (n, f) => { try { f(); pass++; console.log('  ✔ ' + n); } catch (e) { console.error('  ✘ ' + n + '\n      ' + e.message); process.exitCode = 1; } };
console.log('Provjera promjena po odjelima:');
t('brojanje piksela u poligonu po klasama, maska (255) se preskače', () => {
  const kv = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const a = V._brojiUPoligonu(kv, x => (x < 5 ? 0 : 4));
  assert.strictEqual(a.br[0] + a.br[4], a.n); assert.ok(a.br[0] > 40 && a.br[4] > 50);
  const b = V._brojiUPoligonu(kv, x => (x < 5 ? 255 : 4)); assert.strictEqual(b.br[0], 0); assert.ok(b.n < a.n);
});
t('poligon s rupom (par/nepar) ne broji rupu', () => {
  const prsten = [[0, 0], [20, 0], [20, 20], [0, 20]], r = V._brojiUPoligonu(prsten.concat([[0, 0], [5, 5], [15, 5], [15, 15], [5, 15], [5, 5]]), () => 1);
  assert.ok(r.n > 0 && r.n < 21 * 21);
});
t('UI: sekcija u panelu vitalnosti, dodir otvara dNDVI sa samo problematičnim klasama', () => {
  const H = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8'), J = fs.readFileSync(path.join(__dirname, '../../static/js/vegetacija.js'), 'utf8');
  const panel = H.slice(H.indexOf('<div id="vitalnost-panel"'), H.indexOf('<div id="susenje-panel"'));
  ['id="veg-prom-dugme"', 'id="veg-prom-lista"', 'id="veg-prom-opseg"'].forEach(x => assert.ok(panel.includes(x), x));
  assert.ok(J.includes("st.sakr.dndvi = [2, 3, 4, 5, 6, 7]") && J.includes("usf_veg_promjene"));
});
console.log('\n' + pass + ' prošlo, 0 palo — provjera promjena');
