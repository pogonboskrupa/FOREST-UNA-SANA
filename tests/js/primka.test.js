'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const R = f => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
const HTML = R('index.html');
globalThis.window = globalThis;
globalThis.turf = require('../../static/libs/turf.min.js');
const ls = {};
globalThis.localStorage = { getItem: k => ls[k] ?? null, setItem: (k, v) => { ls[k] = String(v); } };
require('../../static/js/primka.js');
const P = globalThis.USFPrimka;

let pass = 0;
const t = (ime, fn) => { fn(); pass++; console.log('  ✔ ' + ime); };
console.log('Primka (realizacija izvedbenih projekata):');

const kv = (la, lo, d) => [[la, lo], [la, lo + d], [la + d, lo + d], [la + d, lo]];

t('Meni: sektor „Realizacija izvedbenih projekata” odmah ispod Praćenja šume, s Primkom i Sjekačkim linijama', () => {
  const grupe = [...HTML.matchAll(/<section class="meni-grp">\s*<h3>([^<]+)<\/h3>([\s\S]*?)<\/section>/g)].map(m => ({ h: m[1], ids: [...m[2].matchAll(/id="(mc-[a-z]+)"/g)].map(x => x[1]) }));
  const i = grupe.findIndex(g => g.h === 'Realizacija izvedbenih projekata');
  assert.ok(i > 0 && grupe[i - 1].h === 'Praćenje šume');
  assert.deepStrictEqual(grupe[i].ids, ['mc-primka', 'mc-sjekacke']);
  assert.ok(!grupe.find(g => g.h === 'Planiranje').ids.includes('mc-sjekacke'), 'Sjekačke više nisu u Planiranju');
  assert.ok(HTML.includes("'primka-panel'];") && HTML.includes('<script src="static/js/primka.js">'));
  assert.ok(R('sw.js').includes("'./static/js/primka.js'") && R('android/copy-assets.sh').includes('static/js/primka.js'));
});

t('površina dijela: prsten ~ km², rupa (par/nepar) se oduzima', () => {
  const a = P._haDijela([kv(44.88, 16.15, 0.01)]);
  assert.ok(Math.abs(a - 88.0) < 1.5, 'oko 88 ha na 44,9° N: ' + a);
  const sRupom = P._haDijela([kv(44.88, 16.15, 0.01), kv(44.883, 16.153, 0.002).reverse()]);
  assert.ok(sRupom < a && sRupom > a * 0.9);
  assert.ok(P._unutar(44.885, 16.155, [kv(44.88, 16.15, 0.01)]) && !P._unutar(44.884, 16.154, [kv(44.88, 16.15, 0.01), kv(44.883, 16.153, 0.002)]), 'tačka u rupi nije u dijelu');
});

t('nacrtani dio se siječe po granici odjela; izvan odjela = prazno', () => {
  const odjel = kv(44.88, 16.15, 0.01);
  const pola = P._isijeci(kv(44.875, 16.155, 0.01), odjel);
  assert.ok(Math.abs(P._haDijela(pola) - P._haDijela([odjel]) / 4) < 0.5, 'četvrtina odjela');
  assert.deepStrictEqual(P._isijeci(kv(44.95, 16.3, 0.005), odjel), []);
});

t('prednost ručnog dijela: preklop se oduzima, potpuno prekriven dio nestaje', () => {
  const partija = { prst: [kv(44.88, 16.15, 0.01)] };
  const r = P._oduzmi(partija, [kv(44.88, 16.15, 0.005)]);
  assert.ok(Math.abs(P._haDijela(r) - P._haDijela(partija.prst) * 0.75) < 0.5);
  assert.strictEqual(P._oduzmi({ prst: [kv(44.881, 16.151, 0.002)] }, [kv(44.88, 16.15, 0.01)]), null);
});

t('zbir: primljeno / neprimljeno / neoznačeno i m³', () => {
  const p = { ring: kv(44.88, 16.15, 0.01), dijelovi: [
    { prst: [kv(44.88, 16.15, 0.005)], ha: 22, status: 'primljeno', m3: 120.5 },
    { prst: [kv(44.885, 16.15, 0.005)], ha: 22, status: 'neprimljeno', m3: 30 }] };
  const z = P._zbir(p);
  assert.strictEqual(z.primljeno, 22); assert.strictEqual(z.neprimljeno, 22); assert.strictEqual(z.m3p, 120.5); assert.strictEqual(z.m3n, 30);
  assert.ok(Math.abs(z.neoznaceno - (z.odjel - 44)) < 1e-9 && z.neoznaceno > 0);
});

t('KML: projekat u ExtendedData usf_primka; uvoz prije običnog KML sloja; Sjekačke daju partije', () => {
  const pr = R('static/js/primka.js'), sj = R('static/js/sjekacke.js');
  assert.ok(pr.includes('<Data name="usf_primka">') && pr.includes("querySelector('ExtendedData Data[name=\"usf_primka\"] value')"));
  assert.ok(HTML.includes('USFPrimka.izKml(doc)'));
  assert.ok(/USFSjek = \{[\s\S]*partije,[\s\S]*projekti:/.test(sj), 'USFSjek.partije / projekti');
  assert.ok(sj.includes('function obrisPartije(') && sj.includes('const prst = obrisPartije(p, lin, D, dd);'), 'isti obris kao prikaz partije na klik');
  assert.ok(pr.includes("map.createPane('primkaPane')") && pr.includes("style.pointerEvents = 'none'") && pr.includes('_kartaKlikIzvor'));
  assert.ok(HTML.includes("USFPrimka.izKljuca('k:${id}')") && HTML.includes("_odsAkcija(\\'primka\\')"), 'iz kartice poligona i više odsjeka');
});

t('posječeno po radnicima: spajanje telefona po id-u (novije pobjeđuje, brisanje putuje), Primka preuzima po radniku', () => {
  const { slSpojiProjekte } = require('../../static/js/sjekacke.js');
  const lok = { id: 'p', tPlan: 1, linije: [], posjeceno: [{ id: 'a', radnik: 'Mujo', prst: [kv(44.88, 16.15, 0.002)], ha: 3, t: 10 }] };
  const dol = { id: 'p', tPlan: 1, linije: [], posjeceno: [{ id: 'a', radnik: 'Mujo', obrisan: true, t: 20 }, { id: 'b', radnik: 'Haso', prst: [kv(44.882, 16.15, 0.002)], ha: 3, t: 15 }] };
  const r = slSpojiProjekte(lok, dol).p.posjeceno;
  assert.deepStrictEqual(r.map(d => d.id + (d.obrisan ? '✗' : '')).sort(), ['a✗', 'b']);
  assert.ok(slSpojiProjekte(lok, { ...dol, posjeceno: [{ id: 'a', radnik: 'Mujo', obrisan: true, t: 5 }] }).p.posjeceno[0].prst, 'starije brisanje ne gazi noviji dio');
  const sj = R('static/js/sjekacke.js'), pr = R('static/js/primka.js');
  assert.ok(sj.includes('for (const d of posjeceno(q)) { if (!prst) break; prst = g.oduzmi({ prst }, d.prst); }'), 'već označeno ostaje, novi dio dobija ostatak');
  assert.ok(sj.includes("localStorage.getItem('usf_sjek_radnik')") && sj.includes("localStorage.getItem('usf_korisnik')"), 'ime iz Postavki / zadnje upisano');
  assert.ok(sj.includes('posjeceno(pid) {') && pr.includes('USFSjek.posjeceno(sid)') && pr.includes("'Posječeno · '"), 'Primka preuzima dijelove radnika');
  assert.ok(pr.includes('nacrtaj(opc) {') && pr.includes('if (cb) { cb(ring); return; }'), 'zajednički alat za crtanje');
  const z = P._zbir({ ring: kv(44.88, 16.15, 0.01), dijelovi: [{ prst: [], ha: 2, status: 'primljeno', radnik: 'Mujo', m3: 10 }, { prst: [], ha: 1, status: 'neprimljeno', radnik: 'Mujo' }] });
  assert.deepStrictEqual(z.radnici, { Mujo: { p: 2, n: 1, m3: 10 } });
});

console.log('\n' + pass + ' prošlo, 0 palo — primka');
