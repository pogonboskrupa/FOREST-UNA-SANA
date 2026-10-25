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
  assert.ok(HTML.includes("'primka-panel'") && HTML.includes('<script src="static/js/primka.js">'));
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
  // izbor poligona dolazi ISKLJUČIVO iz sloja granica taksacije (samo za odabir); stari izbori (mjerenja, bilo koji KML, kartica poligona) ne postoje
  assert.ok(!HTML.includes('USFPrimka.izKljuca') && !HTML.includes("_odsAkcija(\\'primka\\')") && !HTML.includes('USFPrimka.izPrstena') && !HTML.includes('id="pr-izvor"'));
  const prk = R('static/js/primka.js');
  assert.ok(!/izvori\(|izIzvora|izKljuca|izPrstena|_msrRegistry/.test(prk), 'nema starog izbora');
  assert.ok(prk.includes('_kmlPoligoniOdabir()') && HTML.includes('data-a="izb-novi"') && HTML.includes('id="pr-izbor"'), 'izbor poligona iz sloja granica taksacije');
  assert.ok(!HTML.includes('novi-crtez') && !prk.includes('novi-crtez') && !prk.includes("svrha === 'odjel'") && !/Nacrtaj granice odjela/.test(HTML + prk), 'dugme „Nacrtaj granice odjela” uklonjeno');
});

t('zajednički alat za crtanje i zbir po radniku', () => {
  const pr = R('static/js/primka.js');
  assert.ok(pr.includes('nacrtaj(opc) {') && pr.includes('if (cb) { cb(ring); return; }'));
  const z = P._zbir({ ring: kv(44.88, 16.15, 0.01), dijelovi: [{ prst: [], ha: 2, status: 'primljeno', radnik: 'Mujo', m3: 10 }, { prst: [], ha: 1, status: 'neprimljeno', radnik: 'Mujo' }] });
  assert.deepStrictEqual(z.radnici, { Mujo: { p: 2, n: 1, s: 0, m3: 10 } });
  assert.ok(!R('static/js/sjekacke.js').includes('posjeceno'), 'Posječeno po radnicima izbačeno iz Sjekačkih linija');
});

t('rad bez poligona: dio se veže uz KML odjel ispod njega ili „Bez odjela”; odjel i dio su klikabilni (prednost u pikselima)', () => {
  const pr = R('static/js/primka.js');
  assert.ok(HTML.includes('data-a="brzi"') && pr.includes("if (a === 'brzi') { brziDio(); return; }"));
  assert.ok(pr.includes("l.find(p => !prsteni(p).length) || napravi(null, 'Bez odjela', null, true)") && pr.includes('_odjelOznaka(l'), 'naziv odjela iz atributa ODJEL · ODSJEK');
  assert.ok(pr.includes('pov: pxPov(d.prst)') && pr.includes('pov: pxPov([r]) * 0.98') && pr.includes('_pxPovrsina(r.map('), 'ista mjera kao KML (pikseli), odjel primke ispred istog KML poligona');
  assert.ok(pr.includes('function popupOdjel(') && pr.includes('USFPrimka.sakrij(') && pr.includes('USFPrimka.obrisi('), 'kartica odjela: označi, otvori, sakrij, obriši');
  const z = P._zbir({ ring: null, dijelovi: [{ prst: [kv(44.88, 16.15, 0.002)], ha: 1.5, status: 'primljeno' }] });
  assert.strictEqual(z.odjel, 0); assert.strictEqual(z.primljeno, 1.5); assert.strictEqual(z.neoznaceno, 0);
});

t('Granice taksacije: „samo za odabir poligona” (zadano, ne čuva se), izbor odjela s odsjecima, aktivan projekat', () => {
  const pr = R('static/js/primka.js');
  assert.ok(HTML.includes('const _KML_POLIGONSKI = /granice\\s+taksacije/i;') && HTML.includes('samoOdabir: _kmlJePoligonski(file.name)') && HTML.includes('samoOdabir: _kmlJePoligonski(name)'), 'zadano uključeno pri svakom učitavanju/pokretanju');
  assert.ok(!/_kmlMetaPisi[^\n]*samoOdabir|samoOdabir[^\n]*localStorage/.test(HTML), 'isključenje se ne čuva');
  assert.ok(HTML.includes('function _kmlPrimijeniPrikaz(k)') && HTML.includes('_kmlPrimijeniPrikaz(k);') && !/k\.grp\.addTo\(map\); else map\.removeLayer\(k\.grp\)/.test(HTML), 'sloj na karti samo kad nije „samo za odabir”');
  assert.ok(HTML.includes('onchange="_kmlSamoOdabir(\'${k.id}\', this.checked)"') && HTML.includes('<b>Samo za odabir poligona</b>'), 'checkbox na kartici sloja');
  assert.ok(pr.includes('function napraviIzPoligona(') && pr.includes('const prsteni = p =>') && pr.includes("localStorage.getItem(AKT_KLJUC)"), 'projekat iz više poligona, aktivan se pamti');
  assert.ok(pr.includes("const akt = aktivni && nadji(aktivni);") && pr.includes('rs.flatMap(r => isijeci(ring, r))'), 'dio pripada aktivnom odjelu (siječe se po njegovim poligonima)');
  const dva = { poligoni: [{ ring: kv(44.88, 16.15, 0.005) }, { ring: kv(44.88, 16.16, 0.005) }], dijelovi: [] };
  assert.ok(Math.abs(P._zbir(dva).odjel - 2 * P._haDijela([kv(44.88, 16.15, 0.005)])) < 0.05, 'površina odjela = zbir odsjeka');
});

t('poligoni se prikazuju na karti pri pravljenju projekta; liste su sklopive (zadano sklopljene)', () => {
  const pr = R('static/js/primka.js'), sj = R('static/js/sjekacke.js');
  assert.ok(pr.includes('function izbCrtaj()') && pr.includes("map.on('moveend', izbCrtaj)") && pr.includes('function izbKlik(e)') && HTML.includes('.pr-izb-lab'), 'pregled poligona na karti + odabir dodirom');
  assert.ok(pr.includes('data-a="izb-karta"') && pr.includes('data-a="izb-zoom"') && pr.includes('izbGotovo()') && pr.includes('izbLista()'), 'odabir na karti, zumiranje na odjel, povratak na listu');
  assert.ok(pr.includes('const det = (k, naslov, sadrzaj, klasa)') && /<details class="pr-det"[^`]*\$\{otvoreno\.has\(k\) \? ' open' : ''\}/.test(pr), 'Primka: <details> zadano sklopljen');
  assert.ok(pr.includes("det(p.id + ':pol'") && pr.includes('<details class="pr-dio"') && pr.includes("otvoreno.add(pid + ':d:' + did)"), 'dijelovi i poligoni odjela sklopivi');
  assert.ok(sj.includes('<details class="sl-det" data-det="lin:${p.id}"') && sj.includes("otvoreno.has('lin:' + p.id) ? ' open' : ''"), 'Sjekačke: lista linija sklopiva, zadano sklopljena');
  assert.ok(/addEventListener\('toggle'/.test(pr) && /addEventListener\('toggle'/.test(sj), 'otvoreno stanje se pamti između iscrtavanja');
});

t('tri klase (primljeno / neprimljeno / šumski red), dock na karti, odabir odmah na mapi', () => {
  const pr = R('static/js/primka.js');
  assert.ok(/sumskired: \{ t: 'Popraviti šumski red'/.test(pr) && pr.includes("const REDOSLIJED = ['primljeno', 'neprimljeno', 'sumskired']"), 'tri klase');
  const d = { poligoni: [{ ring: kv(44.88, 16.15, 0.005) }], dijelovi: [
    { prst: [kv(44.88, 16.15, 0.001)], ha: 1, status: 'primljeno', m3: 5 }, { prst: [kv(44.88, 16.15, 0.001)], ha: 2, status: 'sumskired', m3: 1, radnik: 'A' },
    { prst: [kv(44.88, 16.15, 0.001)], ha: 3, status: 'nepoznato' }] };
  const z = P._zbir(d);
  assert.strictEqual(z.primljeno, 1); assert.strictEqual(z.sumskired, 2); assert.strictEqual(z.neprimljeno, 3); assert.strictEqual(z.nSr, 1); assert.strictEqual(z.radnici.A.s, 2);
  assert.ok(Math.abs(z.oznaceno - 6) < 1e-9, 'oznaceno = zbir klasa');
  assert.ok(pr.includes("window.USFPrimka = {") && ['dockOtvori', 'dockZatvori', 'crtajStatus', 'dockSrGotovo', 'razlog', 'popravljeno', 'izbCijeli'].every(f => pr.includes(f)), 'API docka');
  assert.ok(pr.includes("if (a === 'izb-novi') { izborOtvori(); izbPocetniPogled(); izbNaKarti(); return; }"), 'novi projekat odmah na mapu');
  assert.ok(/zoomProjekat\(p\); crtaj\(\); render\(\); dockOtvori\(p\.id\)/.test(pr) && !/function napraviIzPoligona[\s\S]*?otvoriPanel/.test(pr.slice(pr.indexOf('function napraviIzPoligona'), pr.indexOf('// ── KML ──'))), 'poslije pravljenja ostaje na karti uz dock');
  assert.ok(pr.includes("d.status = 'primljeno'; d.popravljeno = Date.now()"), '„Popravljeno” prebacuje u primljeno i pamti datum');
  assert.ok(HTML.includes('#pr-dock') && HTML.includes('body.pr-dock #pr-dock') && HTML.includes('html.desk #pr-dock') && HTML.includes('.pr-donut') && HTML.includes('.pr-kpi') && HTML.includes('.pr-badge'), 'stil: dock, donut, KPI, značke');
  assert.ok(pr.includes('id="pr-dock"') || pr.includes("el.id = 'pr-dock'"), 'dock element');
});

console.log('\n' + pass + ' prošlo, 0 palo — primka');
