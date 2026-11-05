const assert = require('assert');
const K = require('../../static/js/kultura.js');
const W = 60, H = 60, rgba = new Uint8ClampedArray(W * H * 4), unutra = new Uint8Array(W * H).fill(1);
let s = 12345; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4, kul = x >= 15 && x < 45 && y >= 15 && y < 45 && !(x >= 25 && x < 35 && y >= 25 && y < 35);
  const n = (rnd() - 0.5) * 10;
  // kultura: tamno zelena; ostalo: svijetlo sivo-smeđe
  rgba[i] = (kul ? 20 : 90) + n; rgba[i + 1] = (kul ? 48 : 85) + n; rgba[i + 2] = (kul ? 22 : 75) + n; rgba[i + 3] = 255;
}
const r = K.klasifikuj(rgba, W, H, unutra, { minPx: 20 });
const tacno = 30 * 30 - 100;
assert.ok(Math.abs(r.px - tacno) / tacno < 0.12, 'površina kulture ' + r.px + ' vs ' + tacno);
const pol = K.poligoni(K.konture(r.maska, W, H));
assert.strictEqual(pol.length, 1, 'jedna površina');
assert.strictEqual(pol[0].rupe.length, 1, 'rupa se čuva');
const kml = K.kml('Test', [{ vanjski: [[16, 44], [16.1, 44], [16.1, 44.1]], rupe: [] }], 1.5, 'x');
assert.ok(kml.includes('<MultiGeometry>') && kml.includes('povrsina_ha'));
console.log('kultura ok');
