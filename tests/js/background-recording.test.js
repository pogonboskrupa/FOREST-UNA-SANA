'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function fn(name) {
  let start = html.indexOf('async function ' + name + '(');
  if (start < 0) start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw Error(name);
}
(async () => {
  const data = new Map();
  const context = vm.createContext({
    _tragOn:true, _tragPaused:false, _tragPts:[], _tragLastT:100,
    _onPLastFixTs:99999, _nativeReplayLast:{trag:100}, _CRASH_TRAG_KEY:'snapshot',
    AndroidGps:{readNativeBuffer() {}}, _crashCheck:{_busy:false},
    _nativeBufUzmi:()=>[{la:44,lo:16,ac:5,t:101},{la:44.001,lo:16,ac:5,t:102}],
    _nativeBufPotvrdi:()=>data.set('ack',true),
    showToast:()=>{}, localStorage:{setItem:(k,v)=>data.set(k,v)}
  });
  vm.runInContext(fn('_crashSaveTrag') + '\n' + fn('_drainNativeGpsBuffer') + `
    function _addTragPoint(la,lo,ac,al,sp,t) { _tragPts.push([la,lo,al,t]); _tragLastT=t; }
  `, context);
  assert.equal(vm.runInContext('_crashSaveTrag()', context), true);
  assert.equal(JSON.parse(data.get('snapshot')).pts.length, 0, 'session persisted before first fix');
  await vm.runInContext('_drainNativeGpsBuffer()', context);
  assert.equal(context._tragPts.length, 2, 'new foreground fix must not discard background points');
  await vm.runInContext('_drainNativeGpsBuffer()', context);
  assert.equal(context._tragPts.length, 2, 'repeated batch must not duplicate fixes');
  data.delete('ack');
  context.localStorage.setItem = () => { throw Error('quota'); };
  assert.equal(await vm.runInContext('_drainNativeGpsBuffer()', context), false);
  assert.equal(data.has('ack'), false, 'failed persistence retains recovery journal');
  for (const match of html.matchAll(/<script\b[^>]*src="([^"?]+)"/g)) {
    if (!match[1].startsWith('http')) assert.ok(fs.statSync(path.join(root, match[1])).size > 0);
  }
  assert.ok(html.includes('([la, lo, al, t, ac]) => ({ la, lo, al, t, ac })'),
    'završno spremanje traga mora sačuvati vrijeme i tačnost GPS tačaka');
  assert.ok(html.includes('p.t, p.ac]'), 'registru traga se predaju vrijeme i tačnost');
  assert.match(fn('_tragToKml'), /Number\.isFinite\(p\[2\]\)/,
    'KML izvoz mora koristiti snimljenu nadmorsku visinu');
  console.log('Background recording: empty-session recovery, gap replay, dedup, quota retention and bundled scripts passed');
})().catch(e => { console.error(e); process.exitCode=1; });
