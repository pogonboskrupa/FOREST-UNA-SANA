// Otvorenost odjela šumskim kamionskim putem (ŠKP) — sekcija u Projektovanju šumskog puta.
// Raster udaljenosti od puteva (ćelija 15–40 m, propagacija najbližeg izvora u 2 prolaza) za cijelo
// područje jednom, pa za svaki odjel/odsjek scanline: udio površine unutar zone privlačenja, srednja
// udaljenost do puta i gustoća puteva (m/ha). Klasa po udjelu: otvoren / djelimično / neotvoren.
const OTV_KLASE = [
  { k: 'otvoren', t: 'Otvoren', c: '#22c55e' },
  { k: 'djelimicno', t: 'Djelimično otvoren', c: '#facc15' },
  { k: 'neotvoren', t: 'Neotvoren', c: '#ef4444' }
];
const OTV_ZADANO = { zona: 400, pragOtv: 70, pragDj: 30 };

function otvLokalno(lat0, lon0) {
  const ky = 111320, kx = ky * Math.cos(lat0 * Math.PI / 180);
  return { u: (la, lo) => [(lo - lon0) * kx, (la - lat0) * ky], n: (x, y) => [lat0 + y / ky, lon0 + x / kx] };
}
// Raster: putevi [[[x,y],…]] u lokalnim metrima, obuhvat {x0,y0,x1,y1}, ćelija k →
// D (udaljenost do najbližeg puta, m; Infinity bez puta) i Lp (dužina puta u ćeliji, m).
function otvRaster(putevi, ob, k) {
  const nx = Math.max(1, Math.ceil((ob.x1 - ob.x0) / k)), ny = Math.max(1, Math.ceil((ob.y1 - ob.y0) / k)), N = nx * ny;
  const sx = new Float64Array(N).fill(NaN), sy = new Float64Array(N).fill(NaN), D = new Float32Array(N).fill(Infinity), Lp = new Float32Array(N);
  const cel = (x, y) => { const i = Math.floor((x - ob.x0) / k), j = Math.floor((y - ob.y0) / k); return i >= 0 && j >= 0 && i < nx && j < ny ? j * nx + i : -1; };
  for (const P of putevi) for (let s = 1; s < P.length; s++) {
    const a = P[s - 1], b = P[s], d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(d / (k / 3)));
    for (let t = 0; t <= n; t++) {
      const x = a[0] + (b[0] - a[0]) * t / n, y = a[1] + (b[1] - a[1]) * t / n, c = cel(x, y);
      if (c < 0) continue;
      if (t < n) Lp[c] += d / n;
      const cx = ob.x0 + (c % nx + 0.5) * k, cy = ob.y0 + (Math.floor(c / nx) + 0.5) * k, dd = Math.hypot(x - cx, y - cy);
      if (dd < D[c]) { D[c] = dd; sx[c] = x; sy[c] = y; }
    }
  }
  // dva prolaza (naprijed/nazad, 8 susjeda): ćelija preuzima izvor susjeda ako joj je bliži
  const probaj = (c, d) => {
    if (d < 0 || Number.isNaN(sx[d])) return;
    const cx = ob.x0 + (c % nx + 0.5) * k, cy = ob.y0 + (Math.floor(c / nx) + 0.5) * k, dd = Math.hypot(sx[d] - cx, sy[d] - cy);
    if (dd < D[c]) { D[c] = dd; sx[c] = sx[d]; sy[c] = sy[d]; }
  };
  for (let it = 0; it < 2; it++) {
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      if (i > 0) probaj(c, c - 1);
      if (j > 0) { probaj(c, c - nx); if (i > 0) probaj(c, c - nx - 1); if (i < nx - 1) probaj(c, c - nx + 1); }
    }
    for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
      const c = j * nx + i;
      if (i < nx - 1) probaj(c, c + 1);
      if (j < ny - 1) { probaj(c, c + nx); if (i < nx - 1) probaj(c, c + nx + 1); if (i > 0) probaj(c, c + nx - 1); }
    }
  }
  return { D, Lp, nx, ny, k, x0: ob.x0, y0: ob.y0 };
}
// Ćelije čiji je centar unutar poligona (prstenovi [[x,y]…], rupe po pravilu par/nepar) → f(c).
function otvCelijeUnutra(R, prstenovi, f) {
  let ymin = Infinity, ymax = -Infinity;
  prstenovi.forEach(r => r.forEach(q => { if (q[1] < ymin) ymin = q[1]; if (q[1] > ymax) ymax = q[1]; }));
  const j0 = Math.max(0, Math.floor((ymin - R.y0) / R.k)), j1 = Math.min(R.ny - 1, Math.ceil((ymax - R.y0) / R.k));
  for (let j = j0; j <= j1; j++) {
    const y = R.y0 + (j + 0.5) * R.k, xs = [];
    for (const r of prstenovi) for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
      const p = r[a], q = r[b];
      if ((p[1] > y) !== (q[1] > y)) xs.push(p[0] + (y - p[1]) * (q[0] - p[0]) / (q[1] - p[1]));
    }
    xs.sort((a, b) => a - b);
    for (let m = 0; m + 1 < xs.length; m += 2) {
      const i0 = Math.max(0, Math.ceil((xs[m] - R.x0) / R.k - 0.5)), i1 = Math.min(R.nx - 1, Math.floor((xs[m + 1] - R.x0) / R.k - 0.5));
      for (let i = i0; i <= i1; i++) f(j * R.nx + i);
    }
  }
}
function otvKlasa(pct, o) { return pct >= o.pragOtv ? 'otvoren' : pct >= o.pragDj ? 'djelimicno' : 'neotvoren'; }
// Jedan odjel: udio površine ≤ zona (%), srednja udaljenost (m, ćelije bez puta u obuhvatu = 3 km),
// dužina puta u odjelu (m) → gustoća (m/ha); ha = ćelije × k² (za klasu), prava površina ide sa strane.
function otvOdjel(R, prstenovi, o) {
  let n = 0, unutar = 0, sum = 0, put = 0;
  otvCelijeUnutra(R, prstenovi, c => { n++; const d = R.D[c]; if (d <= o.zona) unutar++; sum += Math.min(d, 3000); put += R.Lp[c]; });
  if (!n) return null;
  const ha = n * R.k * R.k / 1e4, pct = Math.round(unutar / n * 1000) / 10;
  return { pct, sr: Math.round(sum / n), put: Math.round(put), gust: Math.round(put / ha * 10) / 10, klasa: otvKlasa(pct, o) };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { OTV_KLASE, OTV_ZADANO, otvLokalno, otvRaster, otvCelijeUnutra, otvOdjel, otvKlasa };

(function () {
  if (typeof window === 'undefined' || typeof L === 'undefined' || typeof map === 'undefined') return;
  const KLJUC = 'usf_otvorenost';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d = 0) => Number(v).toLocaleString('bs-BA', { minimumFractionDigits: d, maximumFractionDigits: d });
  const KL = Object.fromEntries(OTV_KLASE.map(x => [x.k, x]));
  let st = { ...OTV_ZADANO, poligoni: null, putevi: null, prikaz: true, op: 0.45 };
  try { st = { ...st, ...JSON.parse(localStorage.getItem(KLJUC) || '{}') }; } catch (e) {}
  let rez = null, racuna = false;
  const pamti = () => { try { localStorage.setItem(KLJUC, JSON.stringify({ zona: st.zona, pragOtv: st.pragOtv, pragDj: st.pragDj, poligoni: st.poligoni, putevi: st.putevi, prikaz: st.prikaz, op: st.op })); } catch (e) {} };

  map.createPane('otvPane'); map.getPane('otvPane').style.zIndex = '412'; // iznad KML-a (410): boja sloja ne miješa se s klasama map.getPane('otvPane').style.pointerEvents = 'none';
  const grp = L.layerGroup().addTo(map), rend = L.canvas({ pane: 'otvPane' });

  // ── izvori: slojevi s poligonima (odjeli) i s linijama (putevi) + sačuvane projektovane trase ──
  const slojevi = () => (typeof kmlLs !== 'undefined' ? kmlLs : []);
  function obidji(l, f) { if (!l) return; if (l.eachLayer && !l.getLatLngs) { l.eachLayer(x => obidji(x, f)); return; } f(l); }
  const jePoligon = l => l._kmlIsPolygon && l.toGeoJSON;
  const jeLinija = l => l.getLatLngs && !(l instanceof L.Polygon) && !l._kmlIsPoint;
  function brojPo(k, test) { let n = 0; obidji(k.grp, l => { if (test(l)) n++; }); return n; }
  const trase = () => (typeof _rdGetSavedRoutes === 'function' ? _rdGetSavedRoutes() : []);
  function izboriPoligona() { return slojevi().map(k => ({ id: k.name, t: k.name, n: brojPo(k, jePoligon) })).filter(x => x.n); }
  function izboriPuteva() {
    const out = slojevi().map(k => ({ id: k.name, t: k.name, n: brojPo(k, jeLinija) })).filter(x => x.n);
    if (trase().length) out.push({ id: '__trase', t: 'Projektovane trase (sačuvane)', n: trase().length });
    return out;
  }
  function zadaniIzbor() {
    const P = izboriPoligona(), U = izboriPuteva();
    if (!st.poligoni || !P.some(x => x.id === st.poligoni)) st.poligoni = (P.find(x => /odjel|odsjek|taksac|granic/i.test(x.t)) || P.slice().sort((a, b) => b.n - a.n)[0] || {}).id || null;
    st.putevi = (st.putevi || []).filter(id => U.some(x => x.id === id));
    if (!st.putevi.length) st.putevi = U.filter(x => /put|cest|škp|skp|road|kamion|trasa/i.test(x.t) && x.id !== st.poligoni).map(x => x.id);
  }

  async function izracunaj() {
    if (racuna) return;
    zadaniIzbor();
    const sloj = slojevi().find(k => k.name === st.poligoni);
    if (!sloj) { showToast('⚠ Izaberi sloj s poligonima odjela (KML preglednik)'); return; }
    if (!st.putevi.length) { showToast('⚠ Izaberi bar jedan sloj puteva (ŠKP)'); return; }
    racuna = true; render();
    try {
      const pol = []; obidji(sloj.grp, l => { if (jePoligon(l)) pol.push(l); });
      const linije = [];
      st.putevi.forEach(id => {
        if (id === '__trase') { trase().forEach(r => { if (r.pts && r.pts.length > 1) linije.push(r.pts.map(p => [p.la, p.lo])); }); return; }
        const k = slojevi().find(x => x.name === id); if (!k) return;
        obidji(k.grp, l => { if (!jeLinija(l)) return; const ll = l.getLatLngs(), dijelovi = Array.isArray(ll[0]) ? ll : [ll]; dijelovi.forEach(d => { if (d.length > 1) linije.push(d.map(q => [q.lat, q.lng])); }); });
      });
      // obuhvat poligona + zona (put malo van odjela i dalje otvara rub)
      let s = 90, n = -90, w = 180, e = -180;
      pol.forEach(l => { const b = l.getBounds(); s = Math.min(s, b.getSouth()); n = Math.max(n, b.getNorth()); w = Math.min(w, b.getWest()); e = Math.max(e, b.getEast()); });
      const Lc = otvLokalno((s + n) / 2, (w + e) / 2), [xa, ya] = Lc.u(s, w), [xb, yb] = Lc.u(n, e), m = st.zona * 1.5;
      const ob = { x0: xa - m, y0: ya - m, x1: xb + m, y1: yb + m }, pov = (ob.x1 - ob.x0) * (ob.y1 - ob.y0), k = Math.max(15, Math.min(60, Math.sqrt(pov / 2.5e6)));
      status('⏳ Raster udaljenosti od puteva…');
      await new Promise(r => setTimeout(r, 30));
      const R = otvRaster(linije.map(P => P.map(q => Lc.u(q[0], q[1]))), ob, k);
      const out = [];
      for (let i = 0; i < pol.length; i++) {
        if (i % 60 === 0) { status(`⏳ Otvorenost odjela… ${i}/${pol.length}`); await new Promise(r => setTimeout(r, 0)); }
        const l = pol[i], g = l.toGeoJSON().geometry, poligoni = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
        const prst = poligoni.flat().map(r => r.map(([lo, la]) => Lc.u(la, lo)));
        const o = otvOdjel(R, prst, st); if (!o) continue;
        out.push({ ...o, ime: l._kmlName || 'Poligon ' + (i + 1), ha: Math.round(turf.area(l.toGeoJSON()) / 1e3) / 10, l });
      }
      rez = { red: out, putevi: linije, k: Math.round(k), linija: linije.length, putKm: Math.round(linije.reduce((a, P) => { let d = 0; for (let j = 1; j < P.length; j++) d += map.distance(P[j - 1], P[j]); return a + d; }, 0) / 100) / 10, t: Date.now() };
      if (!linije.length) showToast('⚠ U izabranim slojevima nema linija puteva');
      st.prikaz = true; pamti(); crtaj();
    } catch (e) { showToast('⚠ Otvorenost: ' + e.message); }
    finally { racuna = false; status(''); render(); }
  }
  function status(t) { const el = document.getElementById('otv-status'); if (el) el.textContent = t || ''; }

  function crtaj() {
    grp.clearLayers();
    if (!rez || !st.prikaz) return;
    rez.red.forEach(r => {
      const c = KL[r.klasa].c;
      L.polygon(r.l.getLatLngs(), { pane: 'otvPane', renderer: rend, color: '#0b1220', weight: 0.8, opacity: 0.55, fillColor: c, fillOpacity: st.op, interactive: false }).addTo(grp);
    });
    // ŠKP iznad ispune (tamni rub + svijetla linija), da se vidi koji put otvara odjel
    (rez.putevi || []).forEach(P => {
      L.polyline(P, { pane: 'otvPane', renderer: rend, color: '#0b1220', weight: 4.5, opacity: 0.85, interactive: false }).addTo(grp);
      L.polyline(P, { pane: 'otvPane', renderer: rend, color: '#fef3c7', weight: 2, opacity: 1, interactive: false }).addTo(grp);
    });
  }
  function sazetak() {
    const z = Object.fromEntries(OTV_KLASE.map(x => [x.k, { n: 0, ha: 0 }]));
    rez.red.forEach(r => { z[r.klasa].n++; z[r.klasa].ha += r.ha; });
    const uk = rez.red.reduce((a, r) => a + r.ha, 0) || 1;
    return { z, uk };
  }
  function render() {
    const el = document.getElementById('otv-sekcija'); if (!el) return;
    zadaniIzbor();
    const P = izboriPoligona(), U = izboriPuteva();
    if (!P.length) { el.innerHTML = '<div class="otv-nap">Učitaj poligone odjela/odsjeka u <b>KML pregledniku</b> (npr. „Granice taksacije”) i sloj puteva (ŠKP) kao KML/SHP linije — ili sačuvaj projektovanu trasu.</div>'; return; }
    let h = `<label class="otv-in"><span>Odjeli / odsjeci</span><select data-o="poligoni">${P.map(x => `<option value="${esc(x.id)}"${x.id === st.poligoni ? ' selected' : ''}>${esc(x.t)} (${x.n})</option>`).join('')}</select></label>
      <div class="otv-lbl">Putevi (ŠKP)</div>${U.length ? U.map(x => `<label class="otv-chk"><input type="checkbox" data-o="put" value="${esc(x.id)}"${st.putevi.includes(x.id) ? ' checked' : ''}> ${esc(x.t)} <small>${x.n} ${x.id === '__trase' ? 'trasa' : 'linija'}</small></label>`).join('') : '<div class="otv-nap">Nema slojeva s linijama — učitaj ŠKP kao KML/SHP u KML pregledniku.</div>'}
      <div class="otv-grid"><label class="otv-in"><span>Zona privlačenja (m)</span><input type="number" inputmode="numeric" min="50" max="2000" step="50" data-o="zona" value="${st.zona}"></label>
      <label class="otv-in"><span>Otvoren od (%)</span><input type="number" inputmode="numeric" min="1" max="100" data-o="pragOtv" value="${st.pragOtv}"></label>
      <label class="otv-in"><span>Djelimično od (%)</span><input type="number" inputmode="numeric" min="0" max="99" data-o="pragDj" value="${st.pragDj}"></label></div>
      <small class="otv-nap">Klasa po udjelu površine odjela koja je bliže od zone privlačenja nekom putu (udaljenost vazdušnom linijom).</small>
      <button class="ng-glavno" data-o="racunaj"${racuna ? ' disabled' : ''}>${racuna ? '⏳ Računam…' : '🛣 Izračunaj otvorenost'}</button><div id="otv-status" class="otv-nap"></div>`;
    if (rez) {
      const { z, uk } = sazetak();
      h += `<div class="otv-traka">${OTV_KLASE.map(x => z[x.k].ha ? `<i style="flex:${z[x.k].ha};background:${x.c}"></i>` : '').join('')}</div>
        <div class="otv-leg">${OTV_KLASE.map(x => `<div><i style="background:${x.c}"></i><b>${x.t}</b><span>${z[x.k].n} · ${fmt(z[x.k].ha, 1)} ha · ${fmt(z[x.k].ha / uk * 100)} %</span></div>`).join('')}</div>
        <div class="otv-nap">${rez.red.length} poligona · ${fmt(uk, 1)} ha · putevi ${fmt(rez.putKm, 1)} km (${fmt(rez.putKm * 1000 / uk, 1)} m/ha) · raster ${rez.k} m</div>
        <label class="otv-chk"><input type="checkbox" data-o="prikaz"${st.prikaz ? ' checked' : ''}> Prikaži na karti</label>
        ${st.prikaz ? `<label class="otv-op">Providnost <input type="range" min="10" max="85" step="5" data-o="op" value="${Math.round(st.op * 100)}"><b>${Math.round(st.op * 100)} %</b></label>` : ''}
        <details class="otv-lista"><summary>Neotvoreni i djelimično otvoreni (${rez.red.filter(r => r.klasa !== 'otvoren').length})</summary>
        ${rez.red.filter(r => r.klasa !== 'otvoren').sort((a, b) => a.pct - b.pct || b.ha - a.ha).slice(0, 200).map(r => `<button class="otv-red" data-o="zum" data-i="${rez.red.indexOf(r)}"><i style="background:${KL[r.klasa].c}"></i><b>${esc(r.ime)}</b><span>${fmt(r.pct)} % · ${fmt(r.ha, 1)} ha · Ø ${r.sr >= 3000 ? '> 3 km' : fmt(r.sr) + ' m'}</span></button>`).join('')}</details>
        <div class="rd-akc"><button data-o="csv">⤓ CSV</button><button data-o="kml">⤓ KML</button></div>`;
    }
    el.innerHTML = h;
  }
  function izvoz(f) {
    if (!rez) return;
    const naziv = 'otvorenost_' + new Date().toISOString().slice(0, 10);
    if (f === 'csv') {
      const kol = ['odjel', 'klasa', 'povrsina_ha', 'udio_u_zoni_pct', 'srednja_udaljenost_m', 'put_u_odjelu_m', 'gustoca_m_ha'];
      const redovi = rez.red.map(r => [r.ime, KL[r.klasa].t, r.ha, r.pct, r.sr, r.put, r.gust]);
      _izvozFajl(naziv + '.csv', _uCsv(kol, redovi), 'text/csv', 'Otvorenost odjela ŠKP-om');
    } else {
      const fc = { type: 'FeatureCollection', features: rez.red.map(r => ({ type: 'Feature', geometry: r.l.toGeoJSON().geometry, properties: { naziv: r.ime, klasa: KL[r.klasa].t, povrsina_ha: r.ha, udio_u_zoni_pct: r.pct, srednja_udaljenost_m: r.sr, gustoca_m_ha: r.gust, _boja: KL[r.klasa].c } })) };
      _izvozFajl(naziv + '.kml', _gjUKml(fc, 'Otvorenost odjela ŠKP (zona ' + st.zona + ' m)'), 'application/vnd.google-earth.kml+xml', 'Otvorenost odjela ŠKP-om');
    }
  }
  function veza() {
    const el = document.getElementById('otv-sekcija'); if (!el || el._veza) return; el._veza = 1;
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-o]'); if (!b || b.tagName === 'INPUT' || b.tagName === 'SELECT') return;
      const a = b.dataset.o;
      if (a === 'racunaj') izracunaj();
      else if (a === 'csv' || a === 'kml') izvoz(a);
      else if (a === 'zum') { const r = rez && rez.red[Number(b.dataset.i)]; if (r) { if (typeof switchMainTab === 'function') switchMainTab('karta'); map.fitBounds(r.l.getBounds(), { padding: [30, 30], maxZoom: 16 }); } }
    });
    el.addEventListener('change', e => {
      const t = e.target, a = t.dataset && t.dataset.o; if (!a) return;
      if (a === 'poligoni') st.poligoni = t.value;
      else if (a === 'put') st.putevi = [...el.querySelectorAll('[data-o="put"]:checked')].map(x => x.value);
      else if (['zona', 'pragOtv', 'pragDj'].includes(a)) { const v = Number(t.value); if (Number.isFinite(v)) st[a] = Math.max(a === 'zona' ? 50 : 0, Math.min(a === 'zona' ? 2000 : 100, v)); if (st.pragDj > st.pragOtv) st.pragDj = st.pragOtv; }
      else if (a === 'prikaz') { st.prikaz = t.checked; crtaj(); }
      else if (a === 'op') { st.op = Number(t.value) / 100; crtaj(); }
      // promjena pragova ne traži novi raster: klasa iz već izračunatog udjela
      if ((a === 'pragOtv' || a === 'pragDj') && rez) { rez.red.forEach(r => { r.klasa = otvKlasa(r.pct, st); }); crtaj(); }
      if (['poligoni', 'put', 'zona'].includes(a) && rez) { rez = null; grp.clearLayers(); }
      pamti(); render();
    });
  }
  // kartica poligona: red s otvorenošću ako je izračunata
  function zaSloj(l) { if (!rez) return null; const r = rez.red.find(x => x.l === l); return r ? { k: r.klasa, t: KL[r.klasa].t, pct: r.pct, sr: r.sr, gust: r.gust, c: KL[r.klasa].c } : null; }
  window.USFOtv = { render: () => { veza(); render(); }, izracunaj, zaSloj, crtaj };
})();
