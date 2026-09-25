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

console.log('Šumarstvo — Hansen/GFW tile URL-ovi:');

t('_sumUrl gradi pokrivac 2000 URL sa pragom krošnje', () => {
  const src = "const _SUM_TCD_THRESH = 30;\nconst _SUM_LOSS_OD = 2001, _SUM_LOSS_DO = 2025;\n"
    + extractFn('_sumUrl') + '\nreturn _sumUrl;';
  const _sumUrl = new Function(src)();
  const url = _sumUrl('pokrivac');
  assert.ok(url.startsWith('https://tiles.globalforestwatch.org/umd_tree_cover_density_2000/'));
  assert.ok(url.includes('{z}/{x}/{y}.png'), 'mora biti XYZ tile šablon za L.tileLayer');
  assert.ok(url.includes('tree_cover_density_threshold=30'));
});

t('_sumUrl gradi gubitak 2001-2025 URL sa opsegom godina (Hansen v1.13)', () => {
  const src = "const _SUM_TCD_THRESH = 30;\nconst _SUM_LOSS_OD = 2001, _SUM_LOSS_DO = 2025;\n"
    + extractFn('_sumUrl') + '\nreturn _sumUrl;';
  const _sumUrl = new Function(src)();
  const url = _sumUrl('gubitak');
  assert.ok(url.startsWith('https://tiles.globalforestwatch.org/umd_tree_cover_loss/'));
  assert.ok(url.includes('start_year=2001'));
  assert.ok(url.includes('end_year=2025'));
  assert.ok(HTML.includes('_SUM_LOSS_DO = 2025'), 'aplikacija traži i 2025.');
});

t('_sumUrl gradi rast URL bez dodatnih parametara (Hansen gain je fiksno 2000-2012)', () => {
  const src = "const _SUM_TCD_THRESH = 30;\nconst _SUM_LOSS_OD = 2001, _SUM_LOSS_DO = 2025;\n"
    + extractFn('_sumUrl') + '\nreturn _sumUrl;';
  const _sumUrl = new Function(src)();
  const url = _sumUrl('rast');
  assert.ok(url.startsWith('https://tiles.globalforestwatch.org/umd_tree_cover_gain/'));
});

t('_sumUrl vraća null za nepoznat ključ sloja', () => {
  const src = "const _SUM_TCD_THRESH = 30;\nconst _SUM_LOSS_OD = 2001, _SUM_LOSS_DO = 2025;\n"
    + extractFn('_sumUrl') + '\nreturn _sumUrl;';
  const _sumUrl = new Function(src)();
  assert.strictEqual(_sumUrl('nepostojeci'), null);
});

// Regresija: bez pane-a L.tileLayer ide u tilePane (z 200), ispod offline
// SQLitedb/MBTiles podloge (offlineBasePane, z 210) — gubitak se ne vidi.
t('Šumarstvo slojevi su u vlastitom pane-u IZNAD offline podloge', () => {
  const z = name => {
    const m = HTML.match(new RegExp("getPane\\('" + name + "'\\)\\.style\\.zIndex\\s*=\\s*(\\d+)"));
    assert.ok(m, 'nije nađen zIndex za pane ' + name);
    return Number(m[1]);
  };
  assert.match(HTML, /const _SUM_OPTS = \{[^}]*pane:\s*'sumarstvoPane'/, '_SUM_OPTS mora postaviti pane');
  assert.ok(z('sumarstvoPane') > z('offlineBasePane'), 'sumarstvoPane mora biti iznad offlineBasePane');
  assert.ok(z('sumarstvoPane') < z('pozariPane'), 'požari moraju ostati iznad šumarstva');
});

console.log('\n' + pass + ' prošlo, 0 palo — šumarstvo');
