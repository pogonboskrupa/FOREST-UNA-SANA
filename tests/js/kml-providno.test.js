const fs = require('fs'), assert = require('assert');
const H = fs.readFileSync('index.html', 'utf8'), O = fs.readFileSync('static/js/odjeli.js', 'utf8');
// _kmlLeafletStil iz index.html, izvučen i izvršen
const src = H.match(/const _KML_CRTA[^\n]*\n/)[0] + H.match(/function _kmlLeafletStil[\s\S]*?\n}\n/)[0];
const f = new Function(src + '; return _kmlLeafletStil;')();
const v = f('Polygon', '#f00', { w: 2, providno: true, ispuna: 35 });
assert.strictEqual(v.opacity, 0); assert.strictEqual(v.fillOpacity, 0.001); // ništa se ne crta, ali fill ostaje za klik
assert.strictEqual(f('Polygon', '#f00', { w: 2 }).opacity, 0.9);
assert.strictEqual(f('LineString', '#f00', { providno: true }).opacity, 0);
assert(H.includes("usf_providno") && H.includes('data-g="providno"') && H.includes('<b>Samo dodir</b>'));
// novi model: providnost linije (op %) i boja ispune odvojena od linije
const n = f('Polygon', '#ff0000', { w: 3, op: 40, ispuna: 25, ispunaBoja: '#00ff00', crta: 'crtatack' });
assert.strictEqual(n.opacity, 0.4); assert.strictEqual(n.fillColor, '#00ff00'); assert.strictEqual(n.fillOpacity, 0.25); assert.strictEqual(n.dashArray, '12,9,1,9'); assert.strictEqual(n.weight, 3);
assert.strictEqual(f('Polygon', '#ff0000', { ispuna: 10 }).fillColor, '#ff0000', 'bez ispunaBoja = boja linije');
// kartica poligona: bez Obriši za poligon, Sačuvaj sliku umjesto Slika (A4)
assert(/!layer\._kmlIsPolygon\) dugmad\.push\(\{ t: '🗑 Obriši'/.test(H));
assert(H.includes("t: '🖼 Sačuvaj sliku', on: `_odjelSlika") && !H.includes("'🖼 Slika (A4)'"));
assert(O.includes('USFSlika.sacuvaj({ cista: true, natpisGore') && O.includes('x.sloj._map'));
console.log('kml-providno ok');
const K = fs.readFileSync('static/js/slika-karte.js', 'utf8');
// slika odjela: samo karta u jednakom okviru, bez teksta; natpis gore po želji; granica odjela s bijelim rubom
assert(/cista \? 36 : 70/.test(K) && /zag = cista \? 36 : 150/.test(K) && /pod = cista \? 36 : 300/.test(K));
assert(K.includes('if (!cista) {\n      // zaglavlje') && K.includes('opis.natpisGore'));
assert(K.includes("if (p.glavni || p.rub) { g.setLineDash([]); g.strokeStyle = 'rgba(255,255,255,.9)'"));
assert(O.includes("prompt('Natpis na vrhu slike"));
console.log('slika cista ok');
