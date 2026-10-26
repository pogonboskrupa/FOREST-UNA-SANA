const fs = require('fs'), assert = require('assert');
const H = fs.readFileSync('index.html', 'utf8');
// editor oznaka: kartica u tabu Karte ispod KML preglednika, sloj-po-sloj postavke (i za preuzete KML), ne-interaktivni natpisi s ograničenjem
const grid = H.slice(H.indexOf('<div class="karta-hub-grid">'), H.indexOf('<!-- Postavke panel -->'));
assert(grid.indexOf('KML — preglednik poligona') < grid.indexOf('Editor slojeva') && grid.indexOf('Editor slojeva') < grid.indexOf('Tematska GeoPackage karta'), 'ispod KML preglednika');
// editor sloja: kartice Linija / Ispuna / Oznake, klizači providnosti, živi pregled i vraćanje na Odustani
for (const t of ["'〰 Linija'", "'▨ Ispuna'", "'🏷 Oznake'", "'Providnost linije'", "'Providnost ispune'", 'function _kedSvg(', 'uzivo(c, { ...st })', '_kedHubRender()']) assert(H.includes(t), t);
assert(H.includes("if (!r) { primijeni(k.col, k.stil); return; }"), 'Odustani vraća stil sloja');
assert(H.includes('const o0 = { color: o.color') && H.includes('r.l.setStyle(o0)'), 'objekat se vraća iz snimka (setStyle mijenja options)');
assert(H.includes("const _OZN_KEY = 'usf_oznake'") && H.includes('_OZN_MAX = 250') && H.includes('interactive: false'));
assert(H.includes("_oznCfg(k).on") && H.includes("['__naziv', 'Naziv objekta']") && H.includes("'Odjel · odsjek'"));
// PIN dijalog bez dugog objašnjenja
assert(H.includes("await _pinUnos('', 'usf_karte_greske',") && !H.includes('Karte za preuzimanje su zaštićene. Unesi PIN'));
// rezultat prikaza: tekst oznake po izabranom polju
const f = new Function('_odjelOznaka', H.match(/function _oznTekst\(l, cfg\) \{[\s\S]*?\n\}\n/)[0] + '; return _oznTekst;')((l, r) => (l._kmlExtData.ODJEL + ' · ' + l._kmlExtData.ODSJEK));
const l = { _kmlName: 'Odsjek A', _kmlExtData: { ODJEL: '88/1', ODSJEK: '00', GAZ: ' 4111 ' } };
assert.strictEqual(f(l, { polje: '__naziv' }), 'Odsjek A'); assert.strictEqual(f(l, { polje: '__odjel' }), '88/1 · 00'); assert.strictEqual(f(l, { polje: 'GAZ' }), '4111'); assert.strictEqual(f(l, { polje: 'NEMA' }), '');
// kartica u tabu Karte NE nabraja slojeve (samo dugme → lista u editoru); natpisi zadano isključeni; novi fajl = linija + blaga ispuna
assert(grid.includes('onclick="_kedListaOtvori()"') && !grid.includes('ked-hub-red'), 'slojevi tek u editoru');
assert(H.includes("const _oznCfg = k => ({ on: false,"), 'natpisi zadano isključeni');
assert(/const _KML_STIL_NOVI = \{ w: 2, crta: 'puna', op: 90, ispuna: (\d+) \}/.test(H) && +H.match(/_KML_STIL_NOVI = \{[^}]*ispuna: (\d+)/)[1] > 0 && +H.match(/_KML_STIL_NOVI = \{[^}]*ispuna: (\d+)/)[1] <= 20, 'blaga ispuna');
assert(H.includes('const grp = await pkmlAsync(doc, col, undefined, stil);') && H.includes('_kmlSaveContent(file.name, usedText, col, stil);'), 'novi KML dobija i pamti zadani stil');
for (const t of ['data-a="stil"', 'data-a="vid"', 'data-a="zoom"', 'data-a="obj"', "await _kmlPromijeniBoju(id); _kedListaOtvori();"]) assert(H.includes(t), t);
// osvježavanje sloja sa servera zadržava stil; stil ugrađenog sloja se pamti posebno; sloj samo s tačkama ima karticu Boja
assert(H.includes('if (stari) _kmlZadrziStil = { ime, col: stari.col, stil: stari.stil };') && H.includes("const stil = z && z.stil ? { ...z.stil } : { ..._KML_STIL_NOVI };"));
assert(H.includes("localStorage.setItem('usf_stil_ugradjeno'") && fs.readFileSync('static/js/odjeli.js', 'utf8').includes("localStorage.getItem('usf_stil_ugradjeno')"));
assert(H.includes("imaLin || imaPol ? '〰 Linija' : '● Boja', true]"));
console.log('oznake ok');
