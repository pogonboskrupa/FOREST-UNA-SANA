const assert = require('assert');
const { filtrirajScene } = require('../../static/js/sentinel-scene.js');
const f = (id, dt, cc) => ({ id, properties: { datetime: dt, 'eo:cloud_cover': cc } });
const r = filtrirajScene([
  f('S2A_MSIL2A_20260610_T33TXL', '2026-06-10T10:00:00Z', 12),
  f('S2B_MSIL2A_20260610_T33TXK', '2026-06-10T10:00:00Z', 4),
  f('S2A_MSIL1C_20260612_T33TXL', '2026-06-12T10:00:00Z', 1),
  f('S2A_MSIL2A_20260620_T33TXL', '2026-06-20T10:00:00Z', 55),
  f('S2A_MSIL2A_20260701_T33TXL', '2026-07-01T10:00:00Z', 18),
  { id: 'S2_MSIL2A_x', properties: { datetime: '2026-07-05T10:00:00Z' } }
], 20);
assert.deepStrictEqual(r.map(x => x.datum + ':' + x.cc), ['2026-07-01:18', '2026-06-10:4']);
console.log('sentinel-scene ok');
