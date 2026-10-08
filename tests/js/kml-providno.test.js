const fs = require('fs'), assert = require('assert');
const H = fs.readFileSync('index.html', 'utf8'), O = fs.readFileSync('static/js/odjeli.js', 'utf8');
// _kmlLeafletStil iz index.html, izvučen i izvršen
const src = H.match(/const _KML_CRTA[^\n]*\n/)[0] + H.match(/function _kmlLeafletStil[\s\S]*?\n}\n/)[0];
const f = new Function(src + '; return _kmlLeafletStil;')();
const v = f('Polygon', '#f00', { w: 2, providno: true, ispuna: 35 });
assert.strictEqual(v.opacity, 0); assert.strictEqual(v.fillOpacity, 0.001); // ništa se ne crta, ali fill ostaje za klik
assert.strictEqual(f('Polygon', '#f00', { w: 2 }).opacity, 0.9);
assert.strictEqual(f('LineString', '#f00', { providno: true }).opacity, 0);
assert(H.includes("usf_providno") && H.includes("dug('prov', 1, 'Providno (samo dodir)'"));
// kartica poligona: bez Obriši za poligon, Sačuvaj sliku umjesto Slika (A4)
assert(/!layer\._kmlIsPolygon\) dugmad\.push\(\{ t: '🗑 Obriši'/.test(H));
assert(H.includes("t: '🖼 Sačuvaj sliku', on: `_odjelSlika") && !H.includes("'🖼 Slika (A4)'"));
assert(O.includes('USFSlika.sacuvaj({ cista: true, natpisGore') && O.includes('x.sloj._map'));
console.log('kml-providno ok');
const K = fs.readFileSync('static/js/slika-karte.js', 'utf8');
// slika odjela: samo karta u jednakom okviru, bez teksta; natpis gore po želji; granica odjela s bijelim rubom
assert(/cista \? 36 : 70/.test(K) && /zag = cista \? 36 : 150/.test(K) && /pod = cista \? 36 : 300/.test(K));
assert(K.includes('if (!cista) {\n      // zaglavlje') && K.includes('p.natpis && !cista') && K.includes('opis.natpisGore'));
assert(K.includes("if (p.glavni) { g.setLineDash([]); g.strokeStyle = 'rgba(255,255,255,.9)'"));
assert(O.includes("prompt('Natpis na vrhu slike"));
console.log('slika cista ok');
