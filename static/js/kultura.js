// Označi kulturu (automatski): u izabranom poligonu odjela traži tamnozelene (četinarske) površine u ZIMSKOM Sentinel-2 snimku
// (static/js/zima.js, z14 ≈ 7 m/px) — zimi bukva/hrast nemaju lišća (svijetlo sivo-smeđe), a četinari ostaju tamnozeleni.
// Postupak: zaglađene RGB osobine (tamnoća + zelenilo) → Otsu prag unutar poligona → većinski filter → uklanjanje sitnih mrlja →
// konture (rupe se čuvaju) → ublaženo/pojednostavljeno → KML. Procjena iz slike, ne taksacija: sjena sjeverne padine je također tamna.
(function (root) {
  'use strict';

  // ── Čista matematika (testira se u Node-u) ──────────────────────────
  function box(src, w, h, r) {
    const t = new Float32Array(w * h), o = new Float32Array(w * h), n = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      let s = 0; for (let x = -r; x <= r; x++) s += src[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) { t[y * w + x] = s / n; s += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)]; }
    }
    for (let x = 0; x < w; x++) {
      let s = 0; for (let y = -r; y <= r; y++) s += t[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) { o[y * w + x] = s / n; s += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x]; }
    }
    return o;
  }
  const zagladi = (a, w, h, r) => box(box(a, w, h, r), w, h, r);

  // Osobina po pikselu: viša = tamnije i zelenije (kultura). Vraća Float32Array (z-ocjena unutar poligona).
  function osobina(rgba, w, h, unutra) {
    const N = w * h, Y = new Float32Array(N), G = new Float32Array(N);
    for (let i = 0; i < N; i++) { const R = rgba[i * 4], g = rgba[i * 4 + 1], B = rgba[i * 4 + 2]; Y[i] = 0.3 * R + 0.59 * g + 0.11 * B; G[i] = (g - R) / (g + R + 8); }
    const y = zagladi(Y, w, h, 2), g = zagladi(G, w, h, 2);
    let n = 0, sy = 0, sg = 0, qy = 0, qg = 0;
    for (let i = 0; i < N; i++) if (unutra[i]) { n++; sy += y[i]; sg += g[i]; qy += y[i] * y[i]; qg += g[i] * g[i]; }
    if (n < 10) return null;
    const my = sy / n, mg = sg / n, dy = Math.sqrt(Math.max(1e-6, qy / n - my * my)), dg = Math.sqrt(Math.max(1e-6, qg / n - mg * mg));
    const f = new Float32Array(N);
    for (let i = 0; i < N; i++) f[i] = 0.5 * (-(y[i] - my) / dy) + 0.5 * ((g[i] - mg) / dg);
    return f;
  }
  function otsu(f, unutra) {
    const B = 64; let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < f.length; i++) if (unutra[i]) { if (f[i] < lo) lo = f[i]; if (f[i] > hi) hi = f[i]; }
    if (!(hi > lo)) return lo;
    const h = new Float64Array(B); let n = 0;
    for (let i = 0; i < f.length; i++) if (unutra[i]) { h[Math.min(B - 1, Math.floor((f[i] - lo) / (hi - lo) * B))]++; n++; }
    let sum = 0; for (let i = 0; i < B; i++) sum += i * h[i];
    let wb = 0, sb = 0, best = 0, bt = B / 2;
    for (let t = 0; t < B; t++) { wb += h[t]; if (!wb) continue; const wf = n - wb; if (!wf) break; sb += t * h[t]; const mb = sb / wb, mf = (sum - sb) / wf, v = wb * wf * (mb - mf) * (mb - mf); if (v > best) { best = v; bt = t + 1; } }
    return lo + bt / B * (hi - lo);
  }
  function vecinski(m, w, h, unutra) {
    const o = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!unutra[i]) continue;
      let s = 0, c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; c++; s += m[yy * w + xx]; }
      o[i] = s * 2 > c ? 1 : 0;
    }
    return o;
  }
  // Komponente vrijednosti v (4-susjedstvo) manje od minPx se prebace u 1−v; ne dira rub koji dodiruje van poligona za v=0 (pozadina)
  function ukloniSitno(m, w, h, minPx, v) {
    const vid = new Uint8Array(w * h), st = [];
    for (let s = 0; s < w * h; s++) {
      if (vid[s] || m[s] !== v) continue;
      const k = []; st.push(s); vid[s] = 1;
      while (st.length) {
        const i = st.pop(); k.push(i); const x = i % w, y = (i / w) | 0;
        if (x > 0 && !vid[i - 1] && m[i - 1] === v) { vid[i - 1] = 1; st.push(i - 1); }
        if (x < w - 1 && !vid[i + 1] && m[i + 1] === v) { vid[i + 1] = 1; st.push(i + 1); }
        if (y > 0 && !vid[i - w] && m[i - w] === v) { vid[i - w] = 1; st.push(i - w); }
        if (y < h - 1 && !vid[i + w] && m[i + w] === v) { vid[i + w] = 1; st.push(i + w); }
      }
      if (k.length < minPx) k.forEach(i => { m[i] = 1 - v; });
    }
  }
  // → { maska, prag, udio }; opc: pomak (z-jedinice, + = više kulture), minPx
  function klasifikuj(rgba, w, h, unutra, opc) {
    opc = opc || {};
    // statistika i prag iz ŠIREG okvira (okolina odjela), ne samo iz poligona — odjel sav od bukve ne smije se prepoloviti
    const kont = opc.kont || unutra;
    const f = osobina(rgba, w, h, kont); if (!f) return null;
    const prag = otsu(f, kont) - (opc.pomak || 0);
    let m = new Uint8Array(w * h);
    for (let i = 0; i < m.length; i++) m[i] = unutra[i] && f[i] > prag ? 1 : 0;
    m = vecinski(vecinski(m, w, h, unutra), w, h, unutra);
    const minPx = Math.max(4, opc.minPx || 40);
    ukloniSitno(m, w, h, minPx, 1);
    ukloniSitno(m, w, h, Math.max(4, minPx >> 1), 0);
    for (let i = 0; i < m.length; i++) if (!unutra[i]) m[i] = 0;
    let a = 0, b = 0; for (let i = 0; i < m.length; i++) if (unutra[i]) { b++; a += m[i]; }
    return { maska: m, prag, udio: b ? a / b : 0, px: a };
  }

  // Konture maske: petlje u koordinatama piksela, vanjske (površina > 0) i rupe (< 0)
  function konture(m, w, h) {
    const f = (x, y) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] === 1;
    const izl = new Map(), K = (x, y) => y * (w + 1) + x;
    const dodaj = (x0, y0, x1, y1) => { const k = K(x0, y0); (izl.get(k) || izl.set(k, []).get(k)).push([x1, y1]); };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      if (!f(x, y - 1)) dodaj(x, y, x + 1, y);
      if (!f(x + 1, y)) dodaj(x + 1, y, x + 1, y + 1);
      if (!f(x, y + 1)) dodaj(x + 1, y + 1, x, y + 1);
      if (!f(x - 1, y)) dodaj(x, y + 1, x, y);
    }
    const petlje = [];
    for (const [k0, l0] of izl) {
      while (l0.length) {
        const sx = k0 % (w + 1), sy = (k0 / (w + 1)) | 0, p = [[sx, sy]]; let cx = sx, cy = sy, dx = 0, dy = 0;
        for (let it = 0; it < 4 * w * h + 8; it++) {
          const lst = izl.get(K(cx, cy)); if (!lst || !lst.length) break;
          let j = 0;
          if (lst.length > 1 && (dx || dy)) { // desno skretanje ima prednost (razdvaja dijagonalne dodire)
            const rx = -dy, ry = dx; const r = lst.findIndex(e => e[0] - cx === rx && e[1] - cy === ry); if (r >= 0) j = r;
          }
          const e = lst.splice(j, 1)[0]; dx = e[0] - cx; dy = e[1] - cy; cx = e[0]; cy = e[1];
          if (cx === sx && cy === sy) break; p.push([cx, cy]);
        }
        if (p.length >= 4) petlje.push(p);
      }
    }
    return petlje;
  }
  const povrsina = p => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
  function chaikin(p) {
    const o = []; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; o.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]); }
    return o;
  }
  function dp(p, tol) {
    if (p.length < 5) return p;
    const rek = (a, b, out) => {
      let mx = 0, mi = -1; const A = p[a], B = p[b], dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1e-9;
      for (let i = a + 1; i < b; i++) { const d = Math.abs((p[i][0] - A[0]) * dy - (p[i][1] - A[1]) * dx) / L; if (d > mx) { mx = d; mi = i; } }
      if (mx > tol) { rek(a, mi, out); out.push(p[mi]); rek(mi, b, out); }
    };
    const out = [p[0]]; rek(0, p.length - 1, out); out.push(p[p.length - 1]); return out;
  }
  const uPrstenu = (x, y, r) => { let u = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) u = !u; return u; };
  // petlje → [{ vanjski, rupe[] }] (pikselne koordinate, uglađeno)
  function poligoni(petlje) {
    const gl = p => { const c = dp(chaikin(chaikin(p)), 0.45); return c.length >= 4 ? c : p; };
    const van = [], rup = [];
    petlje.forEach(p => (povrsina(p) > 0 ? van : rup).push(gl(p)));
    const o = van.map(v => ({ vanjski: v, rupe: [], pov: Math.abs(povrsina(v)) }));
    rup.forEach(r => { const c = o.filter(q => uPrstenu(r[0][0], r[0][1], q.vanjski)).sort((a, b) => a.pov - b.pov)[0]; if (c) c.rupe.push(r); });
    return o;
  }
  const KML_ESC = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  // polys: [{vanjski:[[lon,lat]…], rupe:[…]}]
  function kml(naziv, polys, ha, opis) {
    const prs = r => { const q = r.map(p => p[0].toFixed(7) + ',' + p[1].toFixed(7) + ',0'); q.push(q[0]); return q.join(' '); };
    const g = polys.map(p => `<Polygon><outerBoundaryIs><LinearRing><coordinates>${prs(p.vanjski)}</coordinates></LinearRing></outerBoundaryIs>${p.rupe.map(r => `<innerBoundaryIs><LinearRing><coordinates>${prs(r)}</coordinates></LinearRing></innerBoundaryIs>`).join('')}</Polygon>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${KML_ESC(naziv)}</name>\n<Style id="kultura"><LineStyle><color>ff1f6b14</color><width>2</width></LineStyle><PolyStyle><color>5914b422</color></PolyStyle></Style>\n<Placemark><name>${KML_ESC(naziv)}</name><description>${KML_ESC(opis || '')}</description><styleUrl>#kultura</styleUrl><ExtendedData><Data name="usf_vrsta"><value>kultura</value></Data><Data name="povrsina_ha"><value>${ha.toFixed(2)}</value></Data></ExtendedData><MultiGeometry>${g}</MultiGeometry></Placemark></Document></kml>`;
  }
  const api = { klasifikuj, konture, poligoni, kml, povrsina };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window === 'undefined' || typeof document === 'undefined') { root.USFKulturaMat = api; return; }

  // ── Prikaz i tok (preglednik) ───────────────────────────────────────
  const toast = t => { try { showToast(t); } catch (e) {} };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const merc = { x: (lon, z) => (lon + 180) / 360 * Math.pow(2, z) * 256, y: (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z) * 256; } };
  const lon = (X, z) => X / (256 * Math.pow(2, z)) * 360 - 180;
  const lat = (Y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * Y / (256 * Math.pow(2, z))))) * 180 / Math.PI;
  let S = null, prev = null;

  function maskaPoligona(ring, z, x0, y0, w, h) {
    const px = ring.map(q => [merc.x(q[1], z) - x0, merc.y(q[0], z) - y0]), m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const yy = y + 0.5, xs = [];
      for (let i = 0, j = px.length - 1; i < px.length; j = i++) { const a = px[i], b = px[j]; if ((a[1] > yy) !== (b[1] > yy)) xs.push(a[0] + (yy - a[1]) * (b[0] - a[0]) / (b[1] - a[1])); }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(w - 1, Math.floor(xs[k + 1] - 0.5)); x++) m[y * w + x] = 1;
    }
    return m;
  }
  async function snimak(ring) {
    const Z = root.USKZima; if (!Z || !Z.blobPlocice) throw new Error('zimski snimak nije dostupan');
    for (const z of [14, 13, 12]) {
      const xs = ring.map(q => merc.x(q[1], z)), ys = ring.map(q => merc.y(q[0], z));
      const M = 160, x0 = Math.floor(Math.min(...xs)) - M, x1 = Math.ceil(Math.max(...xs)) + M, y0 = Math.floor(Math.min(...ys)) - M, y1 = Math.ceil(Math.max(...ys)) + M;
      const tx0 = Math.floor(x0 / 256), tx1 = Math.floor(x1 / 256), ty0 = Math.floor(y0 / 256), ty1 = Math.floor(y1 / 256), n = (tx1 - tx0 + 1) * (ty1 - ty0 + 1);
      if (n > 49) continue;
      const w = x1 - x0 + 1, h = y1 - y0 + 1, cv = document.createElement('canvas'); cv.width = w; cv.height = h; const c = cv.getContext('2d', { willReadFrequently: true });
      let ima = 0;
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        const b = await Z.blobPlocice(z, tx, ty, 11); if (!b) continue;
        const bmp = await createImageBitmap(b); c.drawImage(bmp, tx * 256 - x0, ty * 256 - y0); if (bmp.close) bmp.close(); ima++;
      }
      if (ima >= n * 0.85) return { z, x0, y0, w, h, rgba: c.getImageData(0, 0, w, h).data };
      if (z === 14 && ima === 0) throw new Error('nema zimskog snimka za ovaj odjel — preuzmi detalj z14 (Šumarstvo → zimski snimak)');
    }
    throw new Error('zimski snimak je nepotpun za ovaj odjel — preuzmi detalj z14');
  }
  function izracunaj() {
    const opc = { pomak: S.pomak, minPx: Math.round(S.minHa * 1e4 / (S.pxm * S.pxm)) };
    const r = klasifikuj(S.rgba, S.w, S.h, S.unutra, { ...opc, kont: S.kont });
    if (!r) throw new Error('premalo piksela u poligonu');
    const pol = poligoni(konture(r.maska, S.w, S.h)).map(p => ({
      vanjski: p.vanjski.map(q => [lon(S.x0 + q[0], S.z), lat(S.y0 + q[1], S.z)]), rupe: p.rupe.map(rp => rp.map(q => [lon(S.x0 + q[0], S.z), lat(S.y0 + q[1], S.z)]))
    }));
    S.rez = { pol, ha: r.px * S.pxm * S.pxm / 1e4, udio: r.udio };
  }
  function crtaj() {
    if (prev) { try { map.removeLayer(prev); } catch (e) {} prev = null; }
    if (!map.getPane('kulturaPane')) { map.createPane('kulturaPane'); const p = map.getPane('kulturaPane'); p.style.zIndex = '417'; p.style.pointerEvents = 'none'; }
    const gj = { type: 'MultiPolygon', coordinates: S.rez.pol.map(p => [p.vanjski.concat([p.vanjski[0]]), ...p.rupe.map(r => r.concat([r[0]]))]) };
    prev = L.geoJSON(S.rez.pol.length ? { type: 'Feature', geometry: gj } : { type: 'FeatureCollection', features: [] }, { pane: 'kulturaPane', interactive: false, style: { color: '#fde047', weight: 2, fillColor: '#16a34a', fillOpacity: 0.45 } }).addTo(map);
    const el = document.getElementById('kult-sheet'); if (!el) return;
    el.querySelector('.kt-inf').innerHTML = S.rez.pol.length ? `<b>${S.rez.ha.toFixed(1).replace('.', ',')} ha</b> kulture · ${Math.round(S.rez.udio * 100)} % odjela · ${S.rez.pol.length} površ.` : 'Nije pronađena tamnozelena površina — pokušaj veću osjetljivost.';
  }
  function sheet() {
    let el = document.getElementById('kult-sheet');
    if (!el) {
      el = document.createElement('div'); el.id = 'kult-sheet';
      el.innerHTML = `<div class="kt-naz"></div><div class="kt-inf"></div>
        <label>Osjetljivost <input type="range" id="kt-pom" min="-10" max="10" step="1" value="0"><small id="kt-pomv">0</small></label>
        <label>Najmanja površina <select id="kt-min"><option value="0.1">0,1 ha</option><option value="0.3">0,3 ha</option><option value="0.5">0,5 ha</option><option value="1">1 ha</option></select></label>
        <div class="kt-akc"><button class="zp-glavno" onclick="USFKultura.sacuvaj()">💾 Sačuvaj KML</button><button onclick="USFKultura.posalji()">📤 Pošalji</button><button onclick="USFKultura.odbaci()">✕ Odbaci</button></div>
        <p class="set-nap">Procjena iz zimskog snimka (tamnozeleno = četinari). Sjena na sjevernim padinama može se pogrešno uzeti kao kultura — provjeri na terenu.</p>`;
      document.body.appendChild(el);
      el.querySelector('#kt-pom').addEventListener('input', e => { el.querySelector('#kt-pomv').textContent = e.target.value; S.pomak = +e.target.value * 0.1; clearTimeout(sheet.t); sheet.t = setTimeout(() => { try { izracunaj(); crtaj(); } catch (er) { toast('⚠ ' + er.message); } }, 200); });
      el.querySelector('#kt-min').addEventListener('change', e => { S.minHa = +e.target.value; try { izracunaj(); crtaj(); } catch (er) { toast('⚠ ' + er.message); } });
    }
    return el;
  }
  const imeOdjela = P => (typeof _odjelOznaka === 'function' ? _odjelOznaka(P) : '') || [P.odjel && 'Odjel ' + P.odjel, P.odsjek, P.naziv].filter(Boolean).join(' · ') || P.sloj;
  async function obradi(P) {
    kraj(); odbaci();
    toast('⏳ Učitavam zimski snimak…');
    try {
      const s = await snimak(P.ring);
      const unutra = maskaPoligona(P.ring, s.z, s.x0, s.y0, s.w, s.h);
      const kont = new Uint8Array(unutra.length);
      for (let i = 0; i < unutra.length; i++) { kont[i] = s.rgba[i * 4 + 3] >= 128 ? 1 : 0; if (!kont[i]) unutra[i] = 0; }
      const cl = P.ring.reduce((a, q) => a + q[0], 0) / P.ring.length;
      S = { P, ...s, unutra, kont, pxm: 40075016.686 / (256 * Math.pow(2, s.z)) * Math.cos(cl * Math.PI / 180), pomak: 0, minHa: 0.3, naziv: imeOdjela(P) };
      izracunaj();
      const el = sheet(); el.querySelector('.kt-naz').textContent = '🌲 Kultura — ' + S.naziv + (s.z < 14 ? ` (grublji snimak z${s.z})` : ''); el.querySelector('#kt-pom').value = 0; el.querySelector('#kt-pomv').textContent = '0'; el.querySelector('#kt-min').value = '0.3'; el.hidden = false;
      crtaj();
      try { const lls = P.ring.map(q => L.latLng(q[0], q[1])); map.fitBounds(L.latLngBounds(lls).pad(0.15)); } catch (e) {}
      if (typeof switchMainTab === 'function') switchMainTab('karta');
    } catch (e) { toast('⚠ ' + (e && e.message || e)); S = null; }
  }
  function fajl() {
    const naz = 'Kultura – ' + S.naziv;
    return { ime: naz + '.kml', sadrzaj: kml(naz, S.rez.pol, S.rez.ha, `Automatska procjena iz zimskog Sentinel-2 snimka (z${S.z}); ${S.rez.ha.toFixed(1)} ha, ${Math.round(S.rez.udio * 100)} % odjela. Provjeri na terenu.`) };
  }
  function sacuvaj() {
    if (!S || !S.rez.pol.length) { toast('Nema površine za spremanje'); return; }
    const f = fajl();
    try { _kmlLoadFile(new File([f.sadrzaj], f.ime, { type: 'application/vnd.google-earth.kml+xml' })); toast('✓ KML sloj „' + f.ime.replace(/\.kml$/, '') + '” dodan'); } catch (e) { toast('⚠ ' + e.message); return; }
    odbaci();
  }
  function posalji() {
    if (!S || !S.rez.pol.length) { toast('Nema površine za slanje'); return; }
    const f = fajl(); if (typeof _izvozFajl === 'function') _izvozFajl(f.ime, f.sadrzaj, 'application/vnd.google-earth.kml+xml', f.ime);
  }
  function odbaci() { if (prev) { try { map.removeLayer(prev); } catch (e) {} prev = null; } const el = document.getElementById('kult-sheet'); if (el) el.hidden = true; S = null; }

  // ── Izbor odjela dodirom na karti ───────────────────────────────────
  let izb = null; // { grp, klik, moveend }
  const uRingu = (la, lo, r) => { let u = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > lo) !== (r[j][1] > lo) && la < (r[j][0] - r[i][0]) * (lo - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) u = !u; return u; };
  const bbPov = r => { let a = 90, b = -90, c = 180, d = -180; r.forEach(q => { a = Math.min(a, q[0]); b = Math.max(b, q[0]); c = Math.min(c, q[1]); d = Math.max(d, q[1]); }); return (b - a) * (d - c); };
  function crtajIzbor() {
    if (!izb) return;
    izb.grp.clearLayers();
    if (map.getZoom() < 11) { toast('Približi kartu da se vide odjeli'); return; }
    const gr = map.getBounds().pad(0.1);
    (typeof _kmlPoligoniOdabir === 'function' ? _kmlPoligoniOdabir() : []).filter(P => P.ring.some(q => gr.contains(q))).slice(0, 500).forEach(P => {
      L.polygon(P.ring, { pane: 'kulturaPane', interactive: false, color: '#fde047', weight: 1.5, dashArray: '6 4', fillColor: '#fde047', fillOpacity: 0.06 }).addTo(izb.grp);
    });
  }
  function kraj() {
    if (izb) { try { map.getContainer().removeEventListener('click', izb.klik, true); map.off('moveend', izb.moveend); map.removeLayer(izb.grp); } catch (e) {} izb = null; }
    const t = document.getElementById('kult-traka'); if (t) t.remove();
  }
  function otvori() {
    kraj(); odbaci();
    const sve = typeof _kmlPoligoniOdabir === 'function' ? _kmlPoligoniOdabir() : [];
    if (!sve.length) { toast('Nema poligona. Učitaj „Granice taksacije” (Karte → Granice odjela).'); return; }
    if (!map.getPane('kulturaPane')) { map.createPane('kulturaPane'); const p = map.getPane('kulturaPane'); p.style.zIndex = '417'; p.style.pointerEvents = 'none'; }
    if (typeof switchMainTab === 'function') switchMainTab('karta');
    const klik = e => {
      if (e.target.closest && e.target.closest('#kult-traka, .leaflet-control, #map-fabs, #zoom-grp, #layer-btn')) return;
      e.stopImmediatePropagation(); e.preventDefault();
      const ll = map.mouseEventToLatLng(e), nadjeni = sve.filter(P => uRingu(ll.lat, ll.lng, P.ring)).sort((a, b) => bbPov(a.ring) - bbPov(b.ring));
      if (!nadjeni.length) { toast('Tu nema odjela — dodirni unutar žutog poligona'); return; }
      const P = nadjeni[0]; kraj(); obradi(P);
    };
    izb = { grp: L.layerGroup().addTo(map), klik, moveend: crtajIzbor };
    map.getContainer().addEventListener('click', klik, true); map.on('moveend', crtajIzbor);
    const t = document.createElement('div'); t.id = 'kult-traka'; t.innerHTML = '<span>🌲 Dodirni odjel na karti</span><button type="button" onclick="USFKultura.zatvori()">✕ Odustani</button>'; document.body.appendChild(t);
    crtajIzbor();
  }
  root.USFKultura = { otvori, zatvori: kraj, _mat: api, sacuvaj, posalji, odbaci };
})(typeof window !== 'undefined' ? window : globalThis);
