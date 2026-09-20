'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const mainActivity = fs.readFileSync(path.join(root, 'android/app/src/main/java/ba/spd/usf/forest/MainActivity.java'), 'utf8');

function fn(name) {
  let start = html.indexOf('async function ' + name + '(');
  if (start < 0) start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'nije nađena funkcija ' + name);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error('nezatvorena funkcija ' + name);
}

{
  const removed = [], cleared = [];
  const context = {
    wid: 0, gpsOn: true, lastP: { la: 1, lo: 2 }, posMk: { id:'marker' }, posCr: { id:'circle' },
    _gpsAlt:true, _compassConeOn:false, _radiusOn:true,
    navigator:{ geolocation:{ clearWatch:id => cleared.push(id) } },
    map:{ removeLayer:layer => removed.push(layer.id) },
    _clearRadiusRings(){}, _updGpsSwitch(){}, _locCenterRefresh(){},
    document:{ getElementById(){ return { textContent:'' }; } }
  };
  const stopGPS = new Function(...Object.keys(context), fn('stopGPS') + '; return stopGPS;')(...Object.values(context));
  // Funkcija mijenja leksičke varijable u svom kontekstu; nuspojave su dovoljne
  // da dokažu watch-id 0 i uklanjanje oba Leaflet sloja.
  stopGPS();
  assert.deepEqual(cleared, [0]);
  assert.deepEqual(removed, ['marker', 'circle']);
}

assert.match(html, /if \(typeof bmp\.close === 'function'\) bmp\.close\(\)/);
assert.match(html, /navigator\.storage\.persist\(\)/);
assert.match(sw, /\.then\(async resp =>[\s\S]*await c\.put\(event\.request, rc\)/);
assert.ok((sw.match(/event\.waitUntil\(/g) || []).length >= 7,
  'SW async lifecycle mora biti vezan za install/activate/message/click događaje');
assert.match(sw, /return clients\[0\]\.focus\(\)/);
assert.match(sw, /return self\.clients\.openWindow\('\.\/'\)/);
assert.ok((mainActivity.match(/requestBackgroundLocationIfNeeded\(\);/g) || []).length >= 2,
  'pozadinska lokacija se mora tražiti i poslije granta i kad je precizna lokacija već odobrena');

console.log('Core runtime: GPS cleanup, bitmap release, persistent storage and SW lifecycle passed');
