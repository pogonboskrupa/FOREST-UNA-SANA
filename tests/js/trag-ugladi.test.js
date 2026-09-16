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

console.log('Uglačavanje traga — Douglas-Peucker + sažimanje petlji:');

// dst je haversine, nezavisna od DOM-a — sandboxuj je zajedno sa algoritmima
// koji je koriste (dijele isti Function scope preko konkatenacije izvora).
const dstSrc = extractFn('dst');
const dpSrc = extractFn('_dpSimplifyGeo');
const outliersSrc = extractFn('_removeOutliers');
const zbijProlazSrc = extractFn('_zbijPetljeProlaz');
const zbijSrc = extractFn('_zbijPetlje');
const uglObradiSrc = extractFn('_uglObradi');

function buildUgladi() {
  const src = dstSrc + '\n' + dpSrc + '\n' + outliersSrc + '\n' + zbijProlazSrc + '\n' + zbijSrc + '\n' + uglObradiSrc +
    '\nreturn { dst, _dpSimplifyGeo, _removeOutliers, _zbijPetlje, _uglObradi };';
  return new Function(src)();
}

t('_dpSimplifyGeo čuva samo dva kraja prave linije', () => {
  const { _dpSimplifyGeo } = buildUgladi();
  // 5 kolinearnih tačaka duž paralele — trivijalan slučaj, treba ostati [prva, zadnja]
  const pts = [0, 0.0001, 0.0002, 0.0003, 0.0004].map(lo => ({ la: 44.8, lo }));
  const out = _dpSimplifyGeo(pts, 5);
  assert.strictEqual(out.length, 2);
});

t('_zbijPetlje čisti mirovanje-u-mjestu (GPS drift) koje DP ne hvata', () => {
  // Terenska prijava (v3.120.0 u izvornom repou): "vratio sam se istim putem
  // oko 5 metara a uvijek pokaže cik-cak". Simulacija: hodanje 100m, stajanje
  // u mjestu 15 fikseva (GPS drift do ~2.7m oko iste tačke), pa nastavak 111m.
  // Prava dužina puta je ~211m — drift NADUVAVA izmjerenu dužinu jer svaki
  // par susjednih drift-tačaka dodaje par metara koji se nikad nisu prešli.
  const { dst, _dpSimplifyGeo, _zbijPetlje } = buildUgladi();
  const calcL = pts => { let s = 0; for (let i = 1; i < pts.length; i++) s += dst(pts[i-1].la, pts[i-1].lo, pts[i].la, pts[i].lo); return s; };

  const pts = [];
  for (let i = 0; i < 10; i++) pts.push({ la: 44.8 + i * 0.0001, lo: 16.0 }); // ~100m hoda
  let seed = 42; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const cLa = pts[9].la, cLo = pts[9].lo;
  for (let i = 0; i < 15; i++) { const ang = rnd() * 2 * Math.PI, r = rnd() * 0.000025; pts.push({ la: cLa + Math.sin(ang)*r, lo: cLo + Math.cos(ang)*r }); }
  for (let i = 1; i <= 10; i++) pts.push({ la: cLa + i * 0.0001, lo: 16.0 }); // ~111m dalje

  const rawLen = calcL(pts);
  const dpOnlyLen = calcL(_dpSimplifyGeo(pts, 1));
  const zbijLen = calcL(_zbijPetlje(pts, 5));

  // DP sam (eps=1, sitan šum) NE smije značajno popraviti naduvanu dužinu —
  // to je upravo poznata zamka (DP mjeri okomito odstupanje od lokalne
  // tetive, drift-u-mjestu ima malo okomito odstupanje pa DP ga ne prepozna).
  assert.ok(Math.abs(dpOnlyLen - rawLen) < 5, 'DP sam ne smije bitno popraviti naduvanu dužinu: raw=' + rawLen.toFixed(1) + ' dp=' + dpOnlyLen.toFixed(1));
  // _zbijPetlje MORA prepoznati zatvoren+neproduktivan segment (drift) i
  // sažeti ga blizu stvarne pređene dužine (~211m).
  assert.ok(zbijLen < dpOnlyLen - 15, '_zbijPetlje mora značajno smanjiti naduvanu dužinu: dp=' + dpOnlyLen.toFixed(1) + ' zbij=' + zbijLen.toFixed(1));
  assert.ok(Math.abs(zbijLen - 211.5) < 10, 'zbijPetlje dužina treba biti blizu stvarnih ~211.5m: ' + zbijLen.toFixed(1));
});

t('_uglObradi na pravolinijskom hodanju ne mijenja ništa suštinski (dužina ostaje)', () => {
  const { dst, _uglObradi } = buildUgladi();
  const pts = [];
  for (let i = 0; i <= 50; i++) pts.push({ la: 44.8 + i * 0.000018, lo: 16.0 }); // ~2m razmak, ~100m ukupno
  const out = _uglObradi(pts, 5, 1);
  const lenPre = (() => { let s = 0; for (let i = 1; i < pts.length; i++) s += dst(pts[i-1].la, pts[i-1].lo, pts[i].la, pts[i].lo); return s; })();
  const lenPost = (() => { let s = 0; for (let i = 1; i < out.length; i++) s += dst(out[i-1].la, out[i-1].lo, out[i].la, out[i].lo); return s; })();
  assert.ok(Math.abs(lenPre - lenPost) < 1, 'dužina pravog hodanja se ne smije bitno promijeniti: ' + lenPre + ' vs ' + lenPost);
});

t('_tragRegAdd dodaje novi trag na početak registra sa jedinstvenim id/uuid', () => {
  const addSrc = extractFn('_tragRegAdd');
  const fakeMap = { addTo() { return this; } };
  const stubs = `
    let _tragRegistry = [];
    let map = ${JSON.stringify({})};
    const _TRAG_COLORS = ['#f97316'];
    function fmtDateShort(){ return '01.01.2026'; }
    function _genUUID(){ return 'uuid-test'; }
    function _tragRegAddLayer(){}
    function _tragRegSave(){ return true; }
    function _tragRegRender(){}
    ${addSrc}
    return _tragRegAdd;
  `;
  const _tragRegAdd = new Function(stubs)();
  const t1 = _tragRegAdd([[44.8, 16.0, 0]]);
  assert.ok(t1.id.startsWith('trag_'));
  assert.strictEqual(t1.uuid, 'uuid-test');
  assert.strictEqual(t1.visible, true);
});

console.log('\n' + pass + ' prošlo, 0 palo — uglačavanje traga');
