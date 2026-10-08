'use strict';
// Odjeli (granice iz geo/odjeli.kml ili KML-a učitanog kroz "Učitaj KML"):
// izvještaj po odjelu, praćenje novih GFW alarma u odjelima i izvoz podataka
// (požari, sušenje, poremećaji, izvještaj) u KML / GeoJSON / CSV.
// Oslanja se na globalne funkcije iz index.html (kmlLs, pkml, _poziPlohe…).

// ── Izvoz ────────────────────────────────────────────────────────────
const _IZVOZ_MIME = { kml: 'application/vnd.google-earth.kml+xml', geojson: 'application/geo+json', csv: 'text/csv' };

function _xmlEsc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function _kmlBoja(hex, alfa) { const h = String(hex || '#f97316').replace('#', ''); return (alfa || 'ff') + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2); }
function _kmlKoord(ring) { return ring.map(c => Number(c[0]).toFixed(6) + ',' + Number(c[1]).toFixed(6)).join(' '); }
function _kmlGeom(g) {
  if (!g) return '';
  if (g.type === 'Point') return `<Point><coordinates>${Number(g.coordinates[0]).toFixed(6)},${Number(g.coordinates[1]).toFixed(6)}</coordinates></Point>`;
  if (g.type === 'Polygon') return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${_kmlKoord(g.coordinates[0])}</coordinates></LinearRing></outerBoundaryIs>`
    + g.coordinates.slice(1).map(r => `<innerBoundaryIs><LinearRing><coordinates>${_kmlKoord(r)}</coordinates></LinearRing></innerBoundaryIs>`).join('') + '</Polygon>';
  if (g.type === 'MultiPolygon') return '<MultiGeometry>' + g.coordinates.map(p => _kmlGeom({ type: 'Polygon', coordinates: p })).join('') + '</MultiGeometry>';
  return '';
}
// GeoJSON FeatureCollection → KML; svojstva idu u ExtendedData (čita ih i QGIS),
// `_boja` (ako postoji) postaje stil, a `naziv` ime placemarka.
function _gjUKml(fc, naziv) {
  const pm = (fc.features || []).map(f => {
    const p = f.properties || {};
    const stil = p._boja ? `<Style><LineStyle><color>${_kmlBoja(p._boja)}</color><width>2</width></LineStyle><PolyStyle><color>${_kmlBoja(p._boja, '66')}</color></PolyStyle></Style>` : '';
    const ext = Object.entries(p).filter(([k]) => !k.startsWith('_'))
      .map(([k, v]) => `<Data name="${_xmlEsc(k)}"><value>${_xmlEsc(v)}</value></Data>`).join('');
    return `<Placemark><name>${_xmlEsc(p.naziv ?? '')}</name>${stil}<ExtendedData>${ext}</ExtendedData>${_kmlGeom(f.geometry)}</Placemark>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${_xmlEsc(naziv)}</name>\n${pm}\n</Document></kml>`;
}
// UTF-8 BOM da Excel ispravno prikaže č/ć/š/ž; zarez kao separator, tačka za decimale (QGIS).
function _uCsv(kolone, redovi) {
  const e = v => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '\ufeff' + [kolone, ...redovi].map(r => r.map(e).join(',')).join('\n');
}
function _izvozFajl(fname, sadrzaj, mime, naslov) {
  // Binarni sadržaj (KMZ sa fotografijama) kao Blob: base64 kroz FileReader.
  if (sadrzaj instanceof Blob) {
    if (typeof AndroidShare !== 'undefined' && AndroidShare.shareFile) {
      const fr = new FileReader();
      fr.onload = () => { try { AndroidShare.shareFile(fname, 'data:' + mime + ';base64,' + String(fr.result).split(',')[1], naslov, naslov); } catch (e) { showToast('⚠ Dijeljenje nije uspjelo'); } };
      fr.readAsDataURL(sadrzaj); return;
    }
  } else if (typeof AndroidShare !== 'undefined' && AndroidShare.shareFile) {
    try { AndroidShare.shareFile(fname, 'data:' + mime + ';base64,' + btoa(unescape(encodeURIComponent(sadrzaj))), naslov, naslov); return; } catch (e) {}
  }
  const file = new File([sadrzaj], fname, { type: mime });
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: naslov }).catch(() => {});
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = fname; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  showToast('📥 Preuzeto: ' + fname);
}
function _izvozDugmad(sta, formati) {
  const oz = { kml: 'KML', geojson: 'GeoJSON', csv: 'CSV' };
  return `<div class="izvoz-red"><span>⤓ Izvoz</span>${(formati || ['kml', 'geojson', 'csv']).map(f => `<button onclick="_izvoz('${sta}','${f}')">${oz[f]}</button>`).join('')}</div>`;
}
async function _izvoz(sta, format) {
  try {
    const d = await _izvozPodaci(sta);
    if (!d || !d.fc.features.length && !(d.csv && d.csv.redovi.length)) { showToast('Nema podataka za izvoz u ovom prikazu'); return; }
    const baza = d.naziv.normalize('NFKD').replace(/[^\w\-]+/g, '_').replace(/_+/g, '_') + '_' + new Date().toISOString().slice(0, 10);
    if (format === 'kml') _izvozFajl(baza + '.kml', _gjUKml(d.fc, d.naziv), _IZVOZ_MIME.kml, d.naziv);
    else if (format === 'geojson') _izvozFajl(baza + '.geojson', JSON.stringify(d.fc), _IZVOZ_MIME.geojson, d.naziv);
    else _izvozFajl(baza + '.csv', _uCsv(d.csv.kolone, d.csv.redovi), _IZVOZ_MIME.csv, d.naziv);
  } catch (e) { showToast('⚠ Izvoz nije uspio: ' + (e && e.message || e)); }
}
const _fc = features => ({ type: 'FeatureCollection', features });
const _datum = ms => (isFinite(ms) && ms > 0 ? new Date(ms).toISOString().slice(0, 10) : '');
const _r1 = v => Math.round(v * 10) / 10;

async function _izvozPodaci(sta) {
  if (sta === 'pozari') return _izvozPozari();
  if (sta === 'susenje') return _izvozSusenje();
  if (sta === 'poremecaji') return _izvozPoremecaji();
  if (sta === 'odjel') return _izvozOdjel();
  return null;
}
function _izvozPozari() {
  const godisnje = (_poziOn ? _povGodOznaceneGodine() : []).flatMap(g => _povGodPodaci[g]?.evts || []);
  const pts = _poziBezDuplikata([..._poziPrikazaneGrupe(), ...godisnje].flatMap(g => g.pts || []));
  const plohe = pts.length && typeof turf !== 'undefined' ? _poziPlohe(pts) : [];
  const f = plohe.map(({ f: pl, naj }, i) => ({ type: 'Feature', geometry: pl.geometry,
    properties: { naziv: 'Ploha ' + (i + 1), tip: 'procijenjena opožarena ploha', ha: _r1(turf.area(pl) / 1e4), najnovija_detekcija: _datum(naj), _boja: '#d99a32' } }));
  const redovi = pts.slice().sort((a, b) => String(b.dt).localeCompare(String(a.dt))).map(p => {
    f.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lo, p.la] },
      properties: { naziv: String(p.dt).slice(0, 16).replace('T', ' '), tip: 'satelitska detekcija', satelit: p.sat || '', pouzdanost: _poziPouzdanost(p.conf).txt, frp_mw: isFinite(p.frp) ? p.frp : '', odjel: _odjelNaTacki(p.la, p.lo)?.ime || '' } });
    return [String(p.dt).slice(0, 10), String(p.dt).slice(11, 16), p.la.toFixed(5), p.lo.toFixed(5), p.sat || '', _poziPouzdanost(p.conf).txt, isFinite(p.frp) ? p.frp : '', _odjelNaTacki(p.la, p.lo)?.ime || ''];
  });
  return { naziv: 'Pozari', fc: _fc(f), csv: { kolone: ['datum', 'vrijeme_utc', 'lat', 'lon', 'satelit', 'pouzdanost', 'frp_mw', 'odjel'], redovi } };
}
function _izvozSusenje() {
  const r = typeof _sumProjRez !== 'undefined' ? _sumProjRez : null;
  if (!r || !r.lista || !r.lista.length) return null;
  const f = r.lista.map((p, i) => ({ type: 'Feature',
    geometry: { type: 'Polygon', coordinates: p.rings.map(ring => { const c = ring.map(([la, lo]) => [lo, la]); return c.concat([c[0]]); }) },
    properties: { naziv: 'Parcela ' + (i + 1), ha: _r1(p.ha), udio_suhog_pct: Math.round(p.udio * 100), ekvivalent_suhog_ha: _r1(p.suhoHa), godina: r.god, prag_pct: r.prag, _boja: '#f59e0b' } }));
  const redovi = f.map(x => { const c = turf.centroid(x).geometry.coordinates;
    return [x.properties.naziv, x.properties.ha, x.properties.udio_suhog_pct, x.properties.ekvivalent_suhog_ha, r.god, r.prag, c[1].toFixed(5), c[0].toFixed(5), _odjelNaTacki(c[1], c[0])?.ime || '']; });
  return { naziv: 'Susenje_parcele', fc: _fc(f), csv: { kolone: ['parcela', 'ha', 'udio_suhog_pct', 'ekvivalent_suhog_ha', 'godina', 'prag_pct', 'lat', 'lon', 'odjel'], redovi } };
}
// Poremećaji u vidljivom dijelu karte (trenutni filter) → poligoni po uzroku.
async function _izvozPoremecaji() {
  const c = await USFEfda.ucitaj();
  const inv = proj4(USFDeadtrees.projDef(3035), 'EPSG:4326').forward;
  const b = map.getBounds();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  [[b.getWest(), b.getSouth()], [b.getEast(), b.getSouth()], [b.getWest(), b.getNorth()], [b.getEast(), b.getNorth()]].forEach(([lo, la]) => {
    const [X, Y] = c.fwd([lo, la]); const px = (X - c.ox) / c.rx, py = (Y - c.oy) / c.ry;
    minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
  });
  const x0 = Math.max(0, Math.floor(minX)), y0 = Math.max(0, Math.floor(minY));
  const x1 = Math.min(c.W, Math.ceil(maxX)), y1 = Math.min(c.H, Math.ceil(maxY));
  const ww = x1 - x0, wh = y1 - y0;
  if (ww <= 0 || wh <= 0) return null;
  if (ww * wh > 2.5e6) throw new Error('približi kartu (najviše ~45×45 km odjednom)');
  const filter = _sumPorFilter(), f = [];
  for (const u of [1, 2, 3, 0]) {
    if (!filter.uzroci.has(u)) continue;
    const mask = new Uint8Array(ww * wh), god = new Int16Array(ww * wh);
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
      const v = c.data[(y0 + y) * c.W + x0 + x], d = USFEfda.dekodiraj(v);
      if (d && d.uzrok === u && USFEfda.boja(v, filter)) { mask[y * ww + x] = 1; god[y * ww + x] = d.godina; }
    }
    const par = USFDeadtrees.oznaciParcele(mask, ww, wh, 1);
    if (!par.n) continue;
    const gOd = new Int16Array(par.n + 1).fill(9999), gDo = new Int16Array(par.n + 1);
    for (let i = 0; i < ww * wh; i++) { const l = par.lab[i]; if (l) { if (god[i] < gOd[l]) gOd[l] = god[i]; if (god[i] > gDo[l]) gDo[l] = god[i]; } }
    const ids = []; for (let id = 1; id <= par.n; id++) if (par.broj[id] >= 2) ids.push(id);
    const ob = USFDeadtrees.obrisi(par.lab, ww, wh, ids);
    const uz = USFEfda.UZROCI[u];
    ids.forEach(id => {
      const rings = (ob.get(id) || []).map(r => { const cc = r.map(([x, y]) => inv([c.ox + (x0 + x) * c.rx, c.oy + (y0 + y) * c.ry])); return cc.concat([cc[0]]); });
      if (!rings.length) return;
      f.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: rings },
        properties: { naziv: uz.naziv + ' ' + gOd[id] + (gDo[id] !== gOd[id] ? '–' + gDo[id] : ''), uzrok: uz.naziv, ha: _r1(par.broj[id] * 0.09), godina_od: gOd[id], godina_do: gDo[id], _boja: '#' + uz.boja.map(v => v.toString(16).padStart(2, '0')).join('') } });
    });
  }
  const redovi = f.map(x => { const cc = turf.centroid(x).geometry.coordinates; const p = x.properties;
    return [p.uzrok, p.ha, p.godina_od, p.godina_do, cc[1].toFixed(5), cc[0].toFixed(5), _odjelNaTacki(cc[1], cc[0])?.ime || '']; });
  return { naziv: 'Poremecaji_sume', fc: _fc(f), csv: { kolone: ['uzrok', 'ha', 'godina_od', 'godina_do', 'lat', 'lon', 'odjel'], redovi } };
}

// ── Odjeli: ugrađeni geo/odjeli.kml + KML-ovi iz "Učitaj KML" ────────────
async function _odjeliUcitajUgradjene() {
  try {
    if (typeof kmlLs === 'undefined' || kmlLs.some(k => k._ugradjeno)) return;
    const r = await fetch('geo/odjeli.kml');
    if (!r.ok) return;
    const doc = new DOMParser().parseFromString(await r.text(), 'text/xml');
    const grp = pkml(doc, '#e2e8f0');
    grp.addTo(map);
    kmlLs.push({ id: 'kml_odjeli_ugradjeno', name: 'Odjeli (ugrađeno)', grp, col: '#e2e8f0', vis: true, _ugradjeno: true });
    _kmlRegRender();
  } catch (e) {}
}
let _odjeliKes = null, _odjeliKesKljuc = '';
function _odjeliSvi() {
  if (typeof kmlLs === 'undefined') return [];
  const kljuc = kmlLs.map(k => k.id).join('|');
  if (_odjeliKes && _odjeliKesKljuc === kljuc) return _odjeliKes;
  const out = [];
  const walk = (l, izvor) => {
    if (!l) return;
    if (l._kmlIsPolygon && l.toGeoJSON) { try { out.push({ ime: l._kmlName || izvor, izvor, sloj: l, gj: l.toGeoJSON(), bbox: null }); } catch (e) {} return; }
    if (l.eachLayer) { try { l.eachLayer(x => walk(x, izvor)); } catch (e) {} }
  };
  kmlLs.forEach(k => walk(k.grp, k.name));
  out.forEach(o => { o.bbox = turf.bbox(o.gj); });
  _odjeliKes = out; _odjeliKesKljuc = kljuc;
  return out;
}
function _odjelKljuc(o) { return o.izvor + '|' + o.ime; }
function _odjelNaTacki(la, lo) {
  if (typeof turf === 'undefined') return null;
  const t = [lo, la];
  return _odjeliSvi().find(o => lo >= o.bbox[0] && lo <= o.bbox[2] && la >= o.bbox[1] && la <= o.bbox[3] && turf.booleanPointInPolygon(t, o.gj)) || null;
}
const _uBbox = (b, lo, la) => lo >= b[0] && lo <= b[2] && la >= b[1] && la <= b[3];

// ── Izvještaj odjela ─────────────────────────────────────────────────
// Nagib u izvještaju je u PROCENTIMA (tan × 100); klase i boje iste kao karta nagiba (terrainSlopeClasses).
const _odjPct = st => Math.tan(st * Math.PI / 180) * 100;
const _ODJ_STRANE = ['S', 'SI', 'I', 'JI', 'J', 'JZ', 'Z', 'SZ'];
// Ruža ekspozicije: 8 isječaka, dužina po udjelu (eksp[0..7] u %).
function _odjRuza(eksp) {
  const mx = Math.max(1, ...eksp.slice(0, 8)), R = 34, c = 46;
  const t = (az, r) => [(c + Math.sin(az * Math.PI / 180) * r).toFixed(1), (c - Math.cos(az * Math.PI / 180) * r).toFixed(1)].join(',');
  const isj = eksp.slice(0, 8).map((v, i) => { if (!v) return ''; const r = 4 + (R - 4) * v / mx, a = i * 45; return `<polygon points="${t(0, 0)} ${t(a - 20, r)} ${t(a, r)} ${t(a + 20, r)}" fill="${v === mx ? '#fbbf24' : '#4ade80'}" fill-opacity=".85"/>`; }).join('');
  const kr = [R / 2, R].map(r => `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#334155" stroke-width=".8"/>`).join('');
  const sl = _ODJ_STRANE.map((n, i) => { const [x, y] = t(i * 45, R + 8).split(','); return `<text x="${x}" y="${y}" font-size="${n.length > 1 ? 7 : 8.5}" fill="#94a3b8" text-anchor="middle" dominant-baseline="central">${n}</text>`; }).join('');
  return `<svg class="om-ruza" viewBox="0 0 92 92" width="92" height="92" aria-label="Ruža ekspozicije">${kr}${isj}${sl}</svg>`;
}
async function _odjelTeren(gj) {
  const d = await USFDem.ucitaj();
  const [w, s, e, n] = turf.bbox(gj);
  const x0 = Math.max(0, Math.floor((w - d.ox) / d.rx)), x1 = Math.min(d.W, Math.ceil((e - d.ox) / d.rx));
  const y0 = Math.max(0, Math.floor((n - d.oy) / d.ry)), y1 = Math.min(d.H, Math.ceil((s - d.oy) / d.ry));
  const korak = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, (x1 - x0) * (y1 - y0)) / 20000)));
  let broj = 0, hMin = Infinity, hMax = -Infinity, hSum = 0, nSum = 0, sek = 0;
  const klase = new Array(terrainSlopeClasses.length).fill(0), eksp = new Array(9).fill(0), nagibi = [];
  for (let iy = y0; iy < y1; iy += korak) {
    const lat = d.oy + (iy + 0.5) * d.ry;
    for (let ix = x0; ix < x1; ix += korak) {
      const h = d.data[iy * d.W + ix];
      if (h === USFDem.NODATA) continue;
      if (!turf.booleanPointInPolygon([d.ox + (ix + 0.5) * d.rx, lat], gj)) continue;
      const ne = USFDem.nagibEkspozicija(d, ix, iy, lat);
      if (!ne) continue;
      const pc = _odjPct(ne.nagib);
      broj++; hSum += h; nSum += pc; nagibi.push(pc); sek += 1 / Math.cos(ne.nagib * Math.PI / 180);
      if (h < hMin) hMin = h; if (h > hMax) hMax = h;
      klase[terrainSlopeClasses.findIndex(k => pc < k.max)]++;
      eksp[ne.nagib < 5 ? 8 : Math.floor((ne.eksp + 22.5) / 45) % 8]++;
    }
  }
  if (!broj) return { greska: 'odjel je van područja lokalnog DEM-a (5 općina)' };
  const pct = a => a.map(v => Math.round(v / broj * 100)), ep = pct(eksp);
  nagibi.sort((a, b) => a - b);
  const kv = q => _r1(nagibi[Math.min(nagibi.length - 1, Math.floor(q * nagibi.length))]), dom = ep.slice(0, 8).indexOf(Math.max(...ep.slice(0, 8)));
  // nagib* u %; stvarna (nagibna) površina = horizontalna × prosjek 1/cos(nagib)
  return { hMin, hMax, hSr: Math.round(hSum / broj), nagibSr: _r1(nSum / broj), nagibP10: kv(0.1), nagibP90: kv(0.9), nagibMax: _r1(nagibi[nagibi.length - 1]),
    faktor: sek / broj, klase: pct(klase), eksp: ep, dom: ep[dom] ? _ODJ_STRANE[dom] : null, domPct: ep[dom] || 0 };
}
async function _odjelPoremecaji(gj) {
  const c = await USFEfda.ucitaj();
  const inv = proj4(USFDeadtrees.projDef(3035), 'EPSG:4326').forward;
  const [w, s, e, n] = turf.bbox(gj);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  [[w, s], [e, s], [w, n], [e, n]].forEach(([lo, la]) => { const [X, Y] = c.fwd([lo, la]); const px = (X - c.ox) / c.rx, py = (Y - c.oy) / c.ry;
    minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py); });
  const po = { 0: { ha: 0, ha10: 0, zadnja: 0 }, 1: { ha: 0, ha10: 0, zadnja: 0 }, 2: { ha: 0, ha10: 0, zadnja: 0 }, 3: { ha: 0, ha10: 0, zadnja: 0 } };
  let unutra = false;
  for (let y = Math.max(0, Math.floor(minY)); y < Math.min(c.H, Math.ceil(maxY)); y++) for (let x = Math.max(0, Math.floor(minX)); x < Math.min(c.W, Math.ceil(maxX)); x++) {
    unutra = true;
    const d = USFEfda.dekodiraj(c.data[y * c.W + x]);
    if (!d) continue;
    if (!turf.booleanPointInPolygon(inv([c.ox + (x + 0.5) * c.rx, c.oy + (y + 0.5) * c.ry]), gj)) continue;
    const t = po[d.uzrok];
    t.ha += 0.09; if (d.godina >= 2015) t.ha10 += 0.09; if (d.godina > t.zadnja) t.zadnja = d.godina;
  }
  if (!unutra) return { greska: 'odjel je van 5 općina pokrivenih slojem poremećaja' };
  Object.values(po).forEach(t => { t.ha = _r1(t.ha); t.ha10 = _r1(t.ha10); });
  return { po, ukupno: _r1(po[0].ha + po[1].ha + po[2].ha + po[3].ha) };
}
function _odjelPozari(o) {
  const godisnje = _povGodDostupneGodine().flatMap(g => _povGodPodaci[g]?.evts || []);
  const od = Date.now() - 365 * 86400000;
  const pts = _poziBezDuplikata([...(_poziEvts || []), ...godisnje].flatMap(g => g.pts || []))
    .filter(p => Date.parse(p.dt) >= od && _uBbox(o.bbox, p.lo, p.la) && turf.booleanPointInPolygon([p.lo, p.la], o.gj));
  if (!pts.length) return { broj: 0, detekcija: 0 };
  const t = pts.map(p => Date.parse(p.dt));
  return { broj: _poziVremenskiKlasteri(pts).length, detekcija: pts.length, prva: Math.min(...t), zadnja: Math.max(...t), ha: _r1(_poziPovrsinaGrupe({ pts })) };
}
async function _odjelSusenje(gj) {
  const god = (_SUM_LAYERS.susenje && _SUM_LAYERS.susenje.options.godina) || USFDeadtrees.GODINE[USFDeadtrees.GODINE.length - 1];
  const [w, s, e, n] = turf.bbox(gj);
  const r = await USFDeadtrees.procitajPodrucje(god, { latMin: s, latMax: n, lonMin: w, lonMax: e }, 400);
  if (!r) return { greska: 'nema podataka o sušenju za ovo područje' };
  let suma = 0, broj = 0, ha20 = 0, haSve = 0;
  for (let y = 0; y < r.wh; y++) for (let x = 0; x < r.ww; x++) {
    const v = r.data[y * r.ww + x];
    if (v === r.nodata) continue;
    const [la, lo] = r.uLatLng(x + 0.5, y + 0.5);
    if (!turf.booleanPointInPolygon([lo, la], gj)) continue;
    const pa = _sumPikselM2(r.uLatLng, x, y) / 1e4;
    broj++; suma += v; haSve += pa; if (v >= 51) ha20 += pa;
  }
  if (!broj) return { greska: 'nema podataka o sušenju za ovaj odjel' };
  return { god, ha20: _r1(ha20), udioSr: Math.round(suma / broj / 255 * 100), pokriveno: _r1(haSve) };
}

let _odjelAkt = null, _odjelRez = null;
function _odjelModal() {
  let m = document.getElementById('odjel-modal');
  if (!m) {
    m = document.createElement('div'); m.id = 'odjel-modal';
    m.innerHTML = '<div class="om-card"><div id="odjel-modal-body"></div></div>';
    m.addEventListener('click', e => { if (e.target === m) _odjelZatvori(); });
    document.body.appendChild(m);
  }
  return m;
}
function _odjelZatvori() { const m = document.getElementById('odjel-modal'); if (m) m.classList.remove('show'); }
// Slika odjela u razmjeri: odjel istaknut, susjedni poligoni istog sloja u obuhvatu tanko s nazivima.
// Oznaka za sliku: ODJEL (+ ODSJEK) iz atributa KML-a; bez atributa ostaje naziv objekta.
function _odjelOznaka(sloj, rezerva) {
  const ext = (sloj && sloj._kmlExtData) || {}, uzmi = k => { const kk = Object.keys(ext).find(x => x.toUpperCase() === k); return kk && ext[kk] != null ? String(ext[kk]).trim() : ''; };
  const odj = uzmi('ODJEL'), ods = uzmi('ODSJEK');
  return odj ? odj + (ods ? ' · ' + ods : '') : rezerva;
}
function _odjelSlika(stamp, gj, ime) {
  if (!window.USFSlika) { showToast('⚠ Izvoz slike nije dostupan'); return; }
  const o = stamp != null ? _odjeliSvi().find(x => x.sloj && L.stamp(x.sloj) === stamp) : null;
  const g = o ? o.gj : gj, naziv = o ? o.ime : ime || 'Odjel'; if (!g) return;
  const prsteni = gg => { const geo = gg.geometry || gg; return (geo.type === 'MultiPolygon' ? geo.coordinates : [geo.coordinates]).map(p => p[0].map(([lo, la]) => [la, lo])); };
  const glavni = prsteni(g).map((ring, i) => ({ ring, boja: '#000000', sirina: 9, crta: [30, 14], ispuna: 'rgba(15,23,42,.07)', glavni: true, natpis: i ? '' : _odjelOznaka(o && o.sloj, naziv) }));
  const b = turf.bbox(g), m = Math.max(b[2] - b[0], b[3] - b[1]) * 0.6, susj = [];
  // granice iz karte: svi poligoni slojeva koji su trenutno na karti (i providni), ne samo isti sloj
  if (o) _odjeliSvi().filter(x => x !== o && x.sloj._map && x.bbox[0] < b[2] + m && x.bbox[2] > b[0] - m && x.bbox[1] < b[3] + m && x.bbox[3] > b[1] - m).slice(0, 400)
    .forEach(x => prsteni(x.gj).forEach((ring, i) => susj.push({ ring, boja: '#000000', sirina: 9, crta: [30, 14], rub: true, natpis: i ? '' : _odjelOznaka(x.sloj, x.ime) })));
  const ha = _r1(turf.area(g) / 1e4);
  let obim = null; try { obim = Math.round(turf.length(turf.polygonToLine(g), { units: 'kilometers' }) * 100) / 100; } catch (e) {}
  // slika bez teksta: korisnik po želji upiše broj odjela koji ide gore u sredinu (prazno = bez natpisa, Odustani = ništa)
  const natpisGore = prompt('Natpis na vrhu slike (npr. broj odjela).\nOstavi prazno za sliku bez ikakvog teksta:', '');
  if (natpisGore === null) return;
  USFSlika.sacuvaj({ cista: true, natpisGore: natpisGore.trim(), naslov: '📊 ' + (/^odjel/i.test(naziv) ? naziv : 'Odjel ' + naziv), ime: 'odjel_' + naziv, podnaslov: o ? o.izvor : '', poligoni: susj.concat(glavni),
    legenda: [{ boja: '#000000', t: 'odjel', tip: 'isprek' }].concat(susj.length ? [{ boja: '#000000', t: 'granice iz karte (susjedni odjeli/odsjeci)', tip: 'isprek' }] : []),
    info: ['Površina ' + String(ha).replace('.', ',') + ' ha' + (obim != null ? ' · obim ' + String(obim).replace('.', ',') + ' km' : '')] });
}
async function _odjelIzvjestaj(stamp) {
  const o = _odjeliSvi().find(x => L.stamp(x.sloj) === stamp);
  if (o) return _odjelIzvjestajZa(o);
}
// Izvještaj za proizvoljnu geometriju (npr. više spojenih odsjeka jednog odjela).
function _odjelIzvjestajGj(gj, ime, izvor) {
  if (!gj) return;
  return _odjelIzvjestajZa({ ime, izvor: izvor || 'spojeni odsjeci', sloj: null, gj, bbox: turf.bbox(gj) });
}
async function _odjelIzvjestajZa(o) {
  try { map.closePopup(); } catch (e) {}
  _odjelAkt = o;
  _odjelRez = { ime: o.ime, izvor: o.izvor, ha: _r1(turf.area(o.gj) / 1e4), ucitava: true };
  try { _odjelRez.obim = Math.round(turf.length(turf.polygonToLine(o.gj), { units: 'kilometers' }) * 100) / 100; } catch (e) {}
  try { const [lo, la] = turf.centroid(o.gj).geometry.coordinates, m = typeof wgsToMGI5 === 'function' ? wgsToMGI5(la, lo) : null; _odjelRez.centar = m ? 'MGI5 Y ' + m.y + ', X ' + m.x : la.toFixed(5) + ', ' + lo.toFixed(5); } catch (e) {}
  _odjelModal().classList.add('show');
  _odjelRender();
  const [teren, por] = await Promise.all([
    _odjelTeren(o.gj).catch(e => ({ greska: e.message })),
    _odjelPoremecaji(o.gj).catch(e => ({ greska: e.message }))
  ]);
  if (_odjelAkt !== o) return;
  Object.assign(_odjelRez, { teren, por, poz: _odjelPozari(o), alarmi: _odjelAlarmiIzKesa(o), ucitava: false });
  _odjelRender();
}
async function _odjelSusenjeRacunaj() {
  const o = _odjelAkt; if (!o) return;
  _odjelRez.sus = { ucitava: true }; _odjelRender();
  const s = await _odjelSusenje(o.gj).catch(e => ({ greska: 'potreban internet (' + (e && e.message || 'greška') + ')' }));
  if (_odjelAkt === o) { _odjelRez.sus = s; _odjelRender(); }
}
function _odjelRender() {
  const el = document.getElementById('odjel-modal-body'), r = _odjelRez;
  if (!el || !r) return;
  const kartica = (naslov, sadrzaj) => `<div class="om-sek"><div class="om-nas">${naslov}</div>${sadrzaj}</div>`;
  const red = (l, v) => `<div class="om-red"><span>${l}</span><b>${v}</b></div>`;
  const greska = g => `<div class="om-gr">${_escHtml(g)}</div>`;
  const cekaj = '<div class="om-gr">⏳ računam…</div>';
  const T = r.teren && !r.teren.greska ? r.teren : null, fmt1 = v => String(v).replace('.', ',');
  const kpi = (v, l) => `<div class="om-kpi"><b>${v}</b><small>${l}</small></div>`;
  const kpis = `<div class="om-kpis">${kpi(fmt1(r.ha) + ' ha', 'površina')}${kpi(T ? fmt1(_r1(r.ha * T.faktor)) + ' ha' : '…', 'stvarna (po nagibu)')}${kpi(T ? fmt1(T.nagibSr) + ' %' : '…', 'prosječan nagib')}${kpi(r.obim != null ? fmt1(r.obim) + ' km' : '—', 'obim')}</div>`;
  let teren = cekaj;
  if (r.teren) teren = r.teren.greska ? greska(r.teren.greska)
    : red('Prosječan nagib', `<span class="om-v">${fmt1(T.nagibSr)} %</span>`)
      + red('Raspon nagiba (80 % površine)', `${fmt1(T.nagibP10)} – ${fmt1(T.nagibP90)} %`) + red('Najstrmije', fmt1(T.nagibMax) + ' %')
      + `<div class="om-traka">${terrainSlopeClasses.map((k, i) => T.klase[i] ? `<i style="flex:${T.klase[i]};background:${k.color}" title="${k.label}"></i>` : '').join('')}</div>`
      + `<div class="om-leg">${terrainSlopeClasses.map((k, i) => `<span><i style="background:${k.color}"></i>${k.label} <b>${T.klase[i]} % pov.</b></span>`).join('')}</div>`
      + `<div class="om-dva"><div>${red('Nadmorska visina', `${T.hMin}–${T.hMax} m`) + red('Prosječna visina', T.hSr + ' m') + red('Visinska razlika', (T.hMax - T.hMin) + ' m')
        + red('Dominantna ekspozicija', T.dom ? `${T.dom} (${T.domPct} %)` : 'ravno') + (T.eksp[8] ? red('Ravno (< 9 %)', T.eksp[8] + ' %') : '')}</div>${_odjRuza(T.eksp)}</div>`;
  let por = cekaj;
  if (r.por) por = r.por.greska ? greska(r.por.greska)
    : `<table class="om-tab"><tr><th>Uzrok</th><th>1985–2024</th><th>od 2015.</th><th>zadnji</th></tr>${[3, 1, 2].map(u => `<tr><td>${USFEfda.UZROCI[u].naziv}</td><td>${r.por.po[u].ha} ha</td><td>${r.por.po[u].ha10} ha</td><td>${r.por.po[u].zadnja || '—'}</td></tr>`).join('')}<tr><td><b>Ukupno</b></td><td><b>${r.por.ukupno} ha</b></td><td></td><td></td></tr></table>`;
  let poz = cekaj;
  if (r.poz) poz = !r.poz.broj ? '<div class="om-gr">Nema detekcija požara u učitanim podacima (zadnjih 12 mjeseci).</div>'
    : red('Požara', r.poz.broj) + red('Detekcija', r.poz.detekcija) + red('Period', _datum(r.poz.prva) + ' – ' + _datum(r.poz.zadnja)) + red('Procjena iz piksela', '~' + r.poz.ha + ' ha');
  const sus = !r.sus ? `<button class="om-btn" onclick="_odjelSusenjeRacunaj()">Izračunaj (treba internet)</button>`
    : r.sus.ucitava ? cekaj : r.sus.greska ? greska(r.sus.greska)
    : red('Godina', r.sus.god) + red('Udio suhog ≥ 20 %', r.sus.ha20 + ' ha') + red('Prosječan udio suhog', r.sus.udioSr + ' %');
  const al = r.alarmi || [];
  const alarmi = !_odjelPracen(_odjelAkt) ? '<div class="om-gr">Uključi praćenje da se provjeravaju novi GFW alarmi za ovaj odjel.</div>'
    : !al.length ? '<div class="om-gr">Nema alarma u zadnjih 30 dana.</div>'
    : red('Alarma (30 dana)', al.length) + red('Zadnji', String(al[0].dt).slice(0, 10));
  el.innerHTML = `<div class="om-head"><div><div class="om-ime">📊 ${_escHtml(r.ime)}</div><div class="om-pod">${_escHtml(r.izvor)}${r.centar ? ' · centar ' + r.centar : ''}</div></div><button class="om-x" onclick="_odjelZatvori()">✕</button></div>
    ${kpis}${kartica('⛰ Teren', teren)}${kartica('🪵 Poremećaji šume (Landsat)', por)}${kartica('🔥 Požari — zadnjih 12 mjeseci', poz)}${kartica('🟨 Sušenje', sus)}${kartica('🔔 Nove promjene (GFW alarmi)', alarmi)}
    <div class="om-akcije"><button class="om-btn" onclick="_odjelSlikaAkt()">🖼 Sačuvaj sliku</button><button class="om-btn ${_odjelPracen(_odjelAkt) ? 'on' : ''}" onclick="_odjelPratiToggle()">${_odjelPracen(_odjelAkt) ? '🔔 Praćen — isključi' : '🔔 Prati odjel'}</button></div>
    ${_izvozDugmad('odjel', ['kml', 'csv'])}`;
}
function _odjelSlikaAkt() { const o = _odjelAkt; if (o) _odjelSlika(o.sloj ? L.stamp(o.sloj) : null, o.gj, o.ime); }
function _izvozOdjel() {
  const r = _odjelRez, o = _odjelAkt;
  if (!r || !o) return null;
  const s = [['odjel', r.ime], ['izvor', r.izvor], ['povrsina_ha', r.ha]];
  if (r.obim != null) s.push(['obim_km', r.obim]);
  if (r.centar) s.push(['centar', r.centar]);
  if (r.teren && !r.teren.greska) {
    s.push(['povrsina_stvarna_ha', _r1(r.ha * r.teren.faktor)], ['visina_min_m', r.teren.hMin], ['visina_max_m', r.teren.hMax], ['visina_sr_m', r.teren.hSr],
      ['nagib_sr_pct', r.teren.nagibSr], ['nagib_p10_pct', r.teren.nagibP10], ['nagib_p90_pct', r.teren.nagibP90], ['nagib_max_pct', r.teren.nagibMax], ['ekspozicija_dominantna', r.teren.dom || 'ravno']);
    terrainSlopeClasses.forEach((k, i) => s.push(['nagib_' + k.label.replace(' %', '').replace('>', 'preko_') + 'pct_udio', r.teren.klase[i]]));
    ['S', 'SI', 'I', 'JI', 'J', 'JZ', 'Z', 'SZ', 'ravno'].forEach((t, i) => s.push(['ekspozicija_' + t + '_pct', r.teren.eksp[i]]));
  }
  if (r.por && !r.por.greska) [3, 1, 2].forEach(u => { const n = USFEfda.UZROCI[u].naziv; s.push([n + ' 1985-2024 ha', r.por.po[u].ha], [n + ' od 2015 ha', r.por.po[u].ha10], [n + ' zadnja godina', r.por.po[u].zadnja || '']); });
  if (r.poz) s.push(['pozari_12mj_broj', r.poz.broj], ['pozari_12mj_detekcija', r.poz.detekcija], ['pozari_12mj_ha', r.poz.ha ?? 0]);
  if (r.sus && !r.sus.greska && !r.sus.ucitava) s.push(['susenje_godina', r.sus.god], ['susenje_20pct_ha', r.sus.ha20], ['susenje_udio_sr_pct', r.sus.udioSr]);
  if (r.alarmi) s.push(['gfw_alarmi_30_dana', r.alarmi.length]);
  const props = { naziv: r.ime, _boja: '#e2e8f0' };
  s.forEach(([k, v]) => { props[k] = v; });
  return { naziv: /^odjel/i.test(r.ime) ? r.ime : 'Odjel ' + r.ime, fc: _fc([{ type: 'Feature', geometry: o.gj.geometry, properties: props }]), csv: { kolone: ['pokazatelj', 'vrijednost'], redovi: s } };
}

// ── Praćenje odjela: novi GFW integrisani alarmi (DIST-ALERT, 30 m) ─────
const _ODJ_PRATI_KEY = 'usf_odjeli_praceni', _ODJ_ALARM_KEY = 'usf_odjeli_alarmi', _ODJ_PROVJERA_KEY = 'usf_odjeli_provjera';
const _ODJ_INTERVAL_MS = 6 * 3600 * 1000;
function _odjeliPraceni() { try { return JSON.parse(localStorage.getItem(_ODJ_PRATI_KEY) || '[]'); } catch (e) { return []; } }
function _odjelPracen(o) { return !!o && _odjeliPraceni().includes(_odjelKljuc(o)); }
function _odjeliAlarmKes() { try { return JSON.parse(localStorage.getItem(_ODJ_ALARM_KEY) || '{}'); } catch (e) { return {}; } }
function _odjelAlarmiIzKesa(o) {
  const od = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  return ((_odjeliAlarmKes()[_odjelKljuc(o)] || {}).pts || []).filter(p => String(p.dt).slice(0, 10) >= od);
}
function _odjelPratiToggle() {
  const o = _odjelAkt; if (!o) return;
  const k = _odjelKljuc(o), set = new Set(_odjeliPraceni());
  if (set.has(k)) set.delete(k); else set.add(k);
  try { localStorage.setItem(_ODJ_PRATI_KEY, JSON.stringify([...set])); } catch (e) {}
  _odjelRender();
  if (set.has(k)) { showToast('🔔 Odjel ' + o.ime + ' se prati'); _odjeliProvjeriAlarme(true); }
}
// GFW integrated-alerts JSON → tačke istog oblika kao požari (la/lo/dt/conf).
function _gfwAlarmParse(txt) {
  let j;
  try { j = JSON.parse(txt); } catch (e) { return []; }
  return (j && Array.isArray(j.data) ? j.data : []).map(r => ({
    la: parseFloat(r.latitude), lo: parseFloat(r.longitude),
    dt: String(r.gfw_integrated_alerts__date || '').slice(0, 10) + 'T00:00:00Z',
    conf: String(r.gfw_integrated_alerts__confidence || '').trim()
  })).filter(p => isFinite(p.la) && isFinite(p.lo));
}
function _odjeliAlarmUrl(b, od) {
  const sql = 'SELECT longitude, latitude, gfw_integrated_alerts__date, gfw_integrated_alerts__confidence FROM results'
    + " WHERE gfw_integrated_alerts__date >= '" + od + "'"
    + ' AND latitude >= ' + b[1].toFixed(4) + ' AND latitude <= ' + b[3].toFixed(4)
    + ' AND longitude >= ' + b[0].toFixed(4) + ' AND longitude <= ' + b[2].toFixed(4)
    + ' ORDER BY gfw_integrated_alerts__date DESC LIMIT 5000';
  return 'https://data-api.globalforestwatch.org/dataset/gfw_integrated_alerts/latest/query/json?sql=' + encodeURIComponent(sql);
}
// Svaki odjel pamti datum zadnjeg javljenog alarma; prva provjera samo
// postavlja početno stanje (bez obavijesti za stare alarme).
function _odjeliNoviAlarmi(kes, k, pts) {
  const st = kes[k] || { pts: [], vidjeno: null };
  const svi = new Map(st.pts.map(p => [p.la + ',' + p.lo + ',' + p.dt, p]));
  pts.forEach(p => svi.set(p.la + ',' + p.lo + ',' + p.dt, { la: p.la, lo: p.lo, dt: p.dt, conf: p.conf }));
  const lista = [...svi.values()].sort((a, b) => String(b.dt).localeCompare(String(a.dt))).slice(0, 300);
  const noviji = st.vidjeno ? lista.filter(p => String(p.dt) > st.vidjeno) : [];
  kes[k] = { pts: lista, vidjeno: lista.length ? String(lista[0].dt) : st.vidjeno };
  return noviji;
}
let _odjeliProvjeraTece = false;
async function _odjeliProvjeriAlarme(rucno) {
  if (_odjeliProvjeraTece) return;
  const praceni = _odjeliPraceni();
  if (!praceni.length) { if (rucno) showToast('Nema praćenih odjela'); return; }
  const kljuc = (typeof _poziKljucevi !== 'undefined' && (_poziKljucevi.gfw || '').trim()) || '';
  if (!kljuc) { if (rucno) showToast('⚠ Praćenje treba GFW ključ (Požari → Napredni izvori)'); return; }
  if (navigator.onLine === false) { if (rucno) showToast('📡 Nema interneta — provjera kasnije'); return; }
  const pol = _odjeliSvi().filter(o => praceni.includes(_odjelKljuc(o)));
  if (!pol.length) { if (rucno) showToast('⚠ Praćeni odjeli nisu učitani (KML)'); return; }
  _odjeliProvjeraTece = true;
  try {
    const b = turf.bbox(turf.featureCollection(pol.map(o => o.gj)));
    const od = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const r = await _poziDohvatiJedan('GFW alarmi (odjeli)', _odjeliAlarmUrl(b, od), 30000,
      { headers: { 'x-api-key': kljuc }, parser: _gfwAlarmParse, provjera: /"data"\s*:/ });
    if (!r.ok) { if (rucno) showToast('⚠ Provjera alarma: ' + r.greska); return; }
    const kes = _odjeliAlarmKes(), novi = [];
    pol.forEach(o => {
      const unutra = r.pts.filter(p => _uBbox(o.bbox, p.lo, p.la) && turf.booleanPointInPolygon([p.lo, p.la], o.gj));
      const n = _odjeliNoviAlarmi(kes, _odjelKljuc(o), unutra);
      if (n.length) novi.push({ o, n });
    });
    try { localStorage.setItem(_ODJ_ALARM_KEY, JSON.stringify(kes)); localStorage.setItem(_ODJ_PROVJERA_KEY, String(Date.now())); } catch (e) {}
    if (novi.length) {
      const naslov = novi.length === 1 ? '🪓 Nova promjena šume — odjel ' + novi[0].o.ime : '🪓 Nove promjene šume u ' + novi.length + ' odjela';
      const tijelo = novi.map(x => x.o.ime + ': ' + x.n.length + ' alarm(a), zadnji ' + String(x.n[0].dt).slice(0, 10)).join(' · ');
      _odjeliObavijest(naslov, tijelo);
    } else if (rucno) showToast('✓ Nema novih promjena u praćenim odjelima');
  } finally {
    _odjeliProvjeraTece = false;
    if (_odjelAkt && _odjelRez && !_odjelRez.ucitava) { _odjelRez.alarmi = _odjelAlarmiIzKesa(_odjelAkt); _odjelRender(); }
  }
}
function _odjeliObavijest(naslov, tijelo) {
  if (typeof _poziNotifNativnoDostupan === 'function' && _poziNotifNativnoDostupan()) { try { AndroidNotif.show(naslov, tijelo); } catch (e) {} }
  else if ('Notification' in window && Notification.permission === 'granted') {
    const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (sw) sw.postMessage({ type: 'show-pozar-notification', naslov, tijelo });
  }
  showToast(naslov);
}
function _odjeliAutoProvjera() {
  const zadnja = Number(localStorage.getItem(_ODJ_PROVJERA_KEY)) || 0;
  if (Date.now() - zadnja >= _ODJ_INTERVAL_MS) _odjeliProvjeriAlarme(false);
}

if (typeof window !== 'undefined' && typeof map !== 'undefined') {
  _odjeliUcitajUgradjene();
  setTimeout(_odjeliAutoProvjera, 30000);
  setInterval(_odjeliAutoProvjera, 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) _odjeliAutoProvjera(); });
}
if (typeof module !== 'undefined') module.exports = { _gjUKml, _uCsv, _kmlGeom, _odjeliNoviAlarmi, _odjeliAlarmUrl, _gfwAlarmParse };
