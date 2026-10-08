'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const I = require('../../static/js/ikone.js');
const R = f => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');

let pass = 0;
const t = (ime, fn) => { fn(); pass++; console.log('  ✔ ' + ime); };
console.log('Ikone u sjekačkim linijama (motorna pila umjesto sjekire):');

t('svaka ikona je valjan inline SVG (currentColor, 24×24), nepoznata daje prazan string', () => {
  for (const n of Object.keys(I.USFIK_SADRZAJ)) {
    const s = I.USFIk(n, 20);
    assert.ok(s.startsWith('<svg class="ik" viewBox="0 0 24 24" width="20" height="20"') && s.includes('stroke="currentColor"') && s.endsWith('</svg>'), n);
    assert.strictEqual((s.match(/</g) || []).length, (s.match(/>/g) || []).length, n + ' uravnotežene oznake');
  }
  assert.strictEqual(I.USFIk('nema-takve'), '');
});

t('pila: čisti path-ovi za canvas (naslov slike A4), oko-off ima masku pa nema canvas path', () => {
  assert.ok(I.USFIkPath('pila').startsWith('M5 12h9v4.5'), 'path pile');
  assert.strictEqual(I.USFIkPath('oko-off'), '');
});

t('sjekačke linije: nema više sjekire ni emoji dugmadi, ikone iz ikone.js; ostatak aplikacije ne diran', () => {
  const sj = R('static/js/sjekacke.js'), H = R('index.html');
  assert.ok(!sj.includes('🪓'), 'nema 🪓 u sjekacke.js');
  // dugmad i zaglavlja bez emojija; ostaju samo toast poruke, natpisi na karti i naslov dijaloga (tekst, ne HTML)
  sj.split('\n').filter(l => /<button|t: ik\(|class="sl-v-nasl"|<h2|sl-proj-zag/.test(l) && !/showToast/.test(l))
    .forEach(l => { for (const e of ['🧭', '📤', '🗑', '🖼', '🔗', '⛰', '🔀', '✂', '✏', '🙈', '📍', '🎯']) assert.ok(!l.includes(e), e + ' u: ' + l.trim().slice(0, 80)); });
  for (const n of ['pila', 'vodi', 'ok', 'lom', 'ponisti', 'razdvoji', 'salji', 'smece', 'slika', 'oko', 'oko-off', 'planina', 'spoj', 'lepeza', 'upozorenje', 'lokacija'])
    assert.ok(sj.includes("ik('" + n + "'"), 'koristi ' + n);
  assert.ok(H.includes('<span data-ik="pila" data-ikv="22"></span> Sjekačke linije') && !H.includes('<h2>🪓 Sjekačke linije</h2>'));
  // izvan sekcije sjekira ostaje (dugmad u karticama poligona, terenske tačke, obavijesti)
  assert.ok(H.includes("t: '🪓 Sjekačke linije', on: `USFSjek.izKljuca('k:${id}')`") && R('static/js/tacke.js').includes("ik: '🪓'") && R('static/js/odjeli.js').includes('🪓 Nova promjena šume'));
  assert.ok(H.includes('<span data-ik="poligon" data-ikv="19"></span> Nacrtaj granicu odjela') && !H.includes('✏ Nacrtaj granicu'));
  assert.ok(H.includes('<script src="static/js/ikone.js"></script>\n<script src="static/js/sjekacke.js"></script>'), 'ikone.js prije sjekacke.js');
  assert.ok(R('sw.js').includes("'./static/js/ikone.js'") && R('android/copy-assets.sh').includes('static/js/ikone.js'));
  assert.ok(R('static/js/slika-karte.js').includes('new Path2D(USFIkPath(opis.ikona))') && sj.includes("USFSlika[sacuvaj ? 'sacuvaj' : 'podijeli']({ ikona: 'pila', naslov: p.naziv"));
});

t('globalna imena ikone.js se ne sudaraju s index.html', () => {
  const H = R('index.html');
  [...R('static/js/ikone.js').matchAll(/^(?:const|let|function)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1])
    .forEach(i => assert.ok(!new RegExp('(?:const|let|function)\\s+' + i + '\\b').test(H), 'sudar imena: ' + i));
});

console.log('\n' + pass + ' prošlo, 0 palo — sjekačke ikone');
