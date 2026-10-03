'use strict';
// Sjekačke linije: paralelne linije unutar poligona sječe na razmaku od ~2 visine
// stabla. Podrazumijevano idu UZ PADINU (smjer najvećeg pada iz DEM-a): svaki
// radnik ide uzbrdo u svom polju, a susjed mu je uvijek bočno na ≥ 2 visine
// stabla — nikad iznad/ispod. Linije su prave (dominantan pad poligona); azimut
// se može ručno okrenuti. Razmak po izohipsi je horizontalan, pa nema korekcije
// za nagib; u modu "po izohipsi" razmak je mjeren niz padinu i preračunava se.
// Na terenu: GPS vodi radnika duž linije ("← 3 m do linije") dok farba stabla.

const SL_E = 6371008.8;
function slLokalno(lat0, lon0) {
  const ky = Math.PI / 180 * SL_E, kx = ky * Math.cos(lat0 * Math.PI / 180);
  return { u: (la, lo) => [(lo - lon0) * kx, (la - lat0) * ky], n: (x, y) => [lat0 + y / ky, lon0 + x / kx] };
}
// Smjer (jedinični, istok/sjever) za azimut od sjevera u stepenima.
const slSmjer = az => { const r = az * Math.PI / 180; return [Math.sin(r), Math.cos(r)]; };
function slPovrsinaXY(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return Math.abs(a) / 2; }

// Presjek prave {o + t·d} s poligonom (lokalni metri): parovi [t0, t1] unutra.
function slPresjek(poly, o, d) {
  const ts = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i], ex = b[0] - a[0], ey = b[1] - a[1];
    const den = d[0] * ey - d[1] * ex; if (Math.abs(den) < 1e-12) continue;
    const ax = a[0] - o[0], ay = a[1] - o[1];
    const t = (ax * ey - ay * ex) / den, s = (ax * d[1] - ay * d[0]) / den;
    if (s >= 0 && s < 1) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const out = []; for (let k = 0; k + 1 < ts.length; k += 2) if (ts[k + 1] - ts[k] > 0.5) out.push([ts[k], ts[k + 1]]);
  return out;
}
// Sutherland–Hodgman: dio poligona gdje je (p·n) između a i b.
function slTraka(poly, n, a, b) {
  const rez = (pts, f) => {
    const o = [];
    for (let i = 0; i < pts.length; i++) {
      const P = pts[i], Q = pts[(i + 1) % pts.length], fp = f(P), fq = f(Q);
      if (fp >= 0) o.push(P);
      if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); o.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]); }
    }
    return o;
  };
  const dot = p => p[0] * n[0] + p[1] * n[1];
  return rez(rez(poly, p => dot(p) - a), p => b - dot(p));
}

// Širine polja preko poprečne širine poligona W. Prva linija je tačno `razmak`
// od ruba. Ako bi zadnje polje bilo preusko (< 75 % razmaka), zadnjih k polja
// (2–4) se malo suzi da sva budu ≥ 80 % razmaka; ako ni to ne ide, ostatak se
// raspodijeli na zadnja 3 polja (malo šira, bez dodatne linije).
function slRaspored(W, razmak, optimizuj) {
  const m = Math.floor(W / razmak + 1e-9), r = W - m * razmak;
  let sir = Array(m).fill(razmak); if (r > 0.5) sir.push(r);
  let info = null;
  if (optimizuj !== false && m >= 1 && r > 0.5 && r < 0.75 * razmak) {
    let ok = null;
    for (let k = 2; k <= Math.min(4, m + 1) && !ok; k++) { const w = (W - (m + 1 - k) * razmak) / k; if (w >= 0.8 * razmak) ok = { k, w }; }
    if (ok) { sir = Array(m + 1 - ok.k).fill(razmak).concat(Array(ok.k).fill(ok.w)); info = { nacin: 'suzeno', k: ok.k, w: ok.w, ostatak: r }; }
    else { const k = Math.min(3, m), w = razmak + r / k; sir = Array(m - k).fill(razmak).concat(Array(k).fill(w)); info = { nacin: 'prošireno', k, w, ostatak: r }; }
  }
  return { sir, info };
}

// ring [[lat,lon]…], azPada (° od sjevera, nizbrdo), razmak (m horizontalno).
// mod 'pad': linije u smjeru pada; 'izohipsa': linije poprijeko, razmak niz padinu
// (nagibSt → horizontalni razmak = razmak·cos(nagib)).
function slLinije(ring, azPada, razmak, mod, nagibSt, optimizuj) {
  const lat0 = ring.reduce((s, p) => s + p[0], 0) / ring.length, lon0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const L = slLokalno(lat0, lon0), poly = ring.map(p => L.u(p[0], p[1]));
  const pad = slSmjer(azPada);
  const izo = mod === 'izohipsa';
  // d = smjer linije, n = smjer razmicanja (lijevo→desno gledano uzbrdo kod 'pad')
  const d = izo ? [pad[1], -pad[0]] : pad, n = izo ? [-pad[0], -pad[1]] : [-pad[1], pad[0]];
  const cos = izo ? Math.cos((nagibSt || 0) * Math.PI / 180) : 1, korak = razmak * cos;
  const proj = poly.map(p => p[0] * n[0] + p[1] * n[1]), min = Math.min(...proj), max = Math.max(...proj);
  const rs = slRaspored(max - min, korak, optimizuj);
  const granice = [min]; rs.sir.forEach(w => granice.push(granice[granice.length - 1] + w));
  granice[granice.length - 1] = max;
  const linije = [], polja = [];
  for (let k = 1; k + 1 < granice.length; k++) {
    const off = granice[k], o = [n[0] * off, n[1] * off];
    slPresjek(poly, o, d).forEach(([t0, t1], dio) => {
      // kod 'pad' d gleda nizbrdo: veći t = niže. dno je kraj s većim t.
      const A = [o[0] + d[0] * t1, o[1] + d[1] * t1], B = [o[0] + d[0] * t0, o[1] + d[1] * t0];
      linije.push({ br: k, dio, dno: L.n(A[0], A[1]), vrh: L.n(B[0], B[1]), duz: t1 - t0, off });
    });
  }
  for (let i = 0; i + 1 < granice.length; i++) {
    const tr = slTraka(poly, n, granice[i], granice[i + 1]);
    polja.push({ br: i + 1, ha: tr.length > 2 ? slPovrsinaXY(tr) / 1e4 : 0, sirina: (granice[i + 1] - granice[i]) / cos });
  }
  const info = rs.info ? { ...rs.info, w: rs.info.w / cos, ostatak: rs.info.ostatak / cos } : null;
  return { linije, polja, korak, ha: slPovrsinaXY(poly) / 1e4, opt: info };
}

// Dominantan pad iz vektora gradijenta (dzx, dzy u m/m, istok/sjever) po tačkama.
// dosljednost = |zbir| / zbir |v| (1 = jednolična padina, ~0 = greben/vrtača).
function slDominantniPad(grad) {
  let sx = 0, sy = 0, sm = 0, sn = 0, n = 0;
  for (const [gx, gy] of grad) {
    if (!Number.isFinite(gx) || !Number.isFinite(gy)) continue;
    sx += -gx; sy += -gy; const m = Math.hypot(gx, gy); sm += m; sn += Math.atan(m) * 180 / Math.PI; n++;
  }
  if (!n || !sm) return null;
  return { azimut: (Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360, dosljednost: Math.hypot(sx, sy) / sm, nagibSt: sn / n };
}

// Bočni otklon i položaj duž linije (gledano uzbrdo, od dna).
function slVodic(lin, la, lo) {
  const L = slLokalno(lin.dno[0], lin.dno[1]), v = L.u(la, lo), vrh = L.u(lin.vrh[0], lin.vrh[1]);
  const len = Math.hypot(vrh[0], vrh[1]) || 1, u = [vrh[0] / len, vrh[1] / len];
  const duz = v[0] * u[0] + v[1] * u[1], desno = v[0] * u[1] - v[1] * u[0];
  return { duz, len, bocno: desno }; // bocno > 0: radnik je desno od linije → linija mu je lijevo
}

if (typeof module !== 'undefined' && module.exports) module.exports = { slLinije, slRaspored, slPresjek, slTraka, slDominantniPad, slVodic, slLokalno };

(function () {
  if (typeof window === 'undefined' || typeof L === 'undefined' || typeof map === 'undefined') return;
  const KLJUC = 'usf_sjekacke';
  const STATUS = { ne: { t: 'nije', c: '#f59e0b' }, rad: { t: 'u radu', c: '#38bdf8' }, gotovo: { t: 'ofarbano', c: '#22c55e' } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d = 0) => Number(v).toLocaleString('bs-BA', { minimumFractionDigits: d, maximumFractionDigits: d });
  const citaj = () => { try { const v = JSON.parse(localStorage.getItem(KLJUC) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const pisi = l => { try { localStorage.setItem(KLJUC, JSON.stringify(l)); return true; } catch (e) { showToast('⚠ Nema mjesta za čuvanje'); return false; } };

  map.createPane('sjekackePane'); map.getPane('sjekackePane').style.zIndex = '415'; map.getPane('sjekackePane').style.pointerEvents = 'none';
  const grp = L.layerGroup().addTo(map);
  let aktivni = null, vodic = null; // vodic: { pid, lid, t }

  // ── Izvori poligona ───────────────────────────────────────────────────
  function izvori() {
    const out = [];
    (typeof _msrRegistry !== 'undefined' ? _msrRegistry : []).filter(m => m.mode === 'area' && m.pts && m.pts.length >= 3)
      .forEach(m => out.push({ k: 'm:' + m.id, t: '📏 ' + (m.name || 'Površina'), ring: () => m.pts.map(p => [p.lat, p.lng]) }));
    (typeof kmlLs !== 'undefined' ? kmlLs : []).forEach(k => k && k.grp && k.grp.eachLayer(function walk(l) {
      if (l.eachLayer && !l.getLatLngs) { l.eachLayer(walk); return; }
      if (!l._kmlIsPolygon) return;
      out.push({ k: 'k:' + L.stamp(l), t: '🗺 ' + (l._kmlName || 'KML poligon'), ring: () => { let ll = l.getLatLngs(); while (Array.isArray(ll[0])) ll = ll[0]; return ll.map(p => [p.lat, p.lng]); } });
    }));
    return out;
  }
  function odjelPodCentrom() {
    if (typeof _odjelNaTacki !== 'function') return null;
    const c = map.getCenter(), o = _odjelNaTacki(c.lat, c.lng); if (!o) return null;
    const g = o.gj.geometry || o.gj, polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
    const t = [c.lng, c.lat];
    const p = polys.find(pp => typeof turf === 'undefined' || turf.booleanPointInPolygon(t, { type: 'Polygon', coordinates: pp })) || polys[0];
    return { naziv: o.ime || 'Odjel', ring: p[0].slice(0, -1).map(([lo, la]) => [la, lo]) };
  }

  // ── DEM: dominantan pad poligona ─────────────────────────────────────
  async function padPoligona(ring) {
    if (typeof window.npVisinaNa !== 'function' || typeof npMreza !== 'function') return null;
    const pov = npPovrsina(ring), { tacke } = npMreza(ring, Math.max(20, Math.sqrt(pov / 60)));
    const D = 45, grad = [];
    for (let i = 0; i < tacke.length; i += 8) {
      const dio = tacke.slice(i, i + 8);
      const r = await Promise.all(dio.map(async p => {
        try {
          const [e, w, n, s] = await Promise.all([npPomak(p, 90, D), npPomak(p, 270, D), npPomak(p, 0, D), npPomak(p, 180, D)].map(q => npVisinaNa(q[0], q[1])));
          return [(e - w) / (2 * D), (n - s) / (2 * D)];
        } catch (err) { return [NaN, NaN]; }
      }));
      grad.push(...r);
    }
    return slDominantniPad(grad);
  }
  async function visina(p) { try { const h = await npVisinaNa(p[0], p[1]); return Number.isFinite(h) ? Math.round(h) : null; } catch (e) { return null; } }

  // ── Projekat ─────────────────────────────────────────────────────────
  async function napravi(ring, naziv) {
    if (!ring || ring.length < 3) { showToast('⚠ Poligon nije ispravan'); return; }
    status('⏳ Računam smjer pada iz DEM-a…');
    const pad = await padPoligona(ring);
    const p = { id: 'sl_' + Date.now().toString(36), naziv: naziv || 'Sječa', datum: new Date().toISOString(), ring, razmak: 60, mod: 'pad',
      az: pad ? Math.round(pad.azimut) : 0, azDem: pad ? Math.round(pad.azimut) : null, dosljednost: pad ? pad.dosljednost : null, nagibSt: pad ? pad.nagibSt : 0, linije: [] };
    if (!pad) showToast('⚠ Nema DEM-a za ovo područje — postavi azimut pada ručno');
    await generisi(p);
    const l = citaj(); l.unshift(p); pisi(l);
    aktivni = p.id; crtaj(); render(); zoom(p.id);
  }
  async function generisi(p) {
    const r = slLinije(p.ring, p.az, p.razmak, p.mod, p.nagibSt, p.opt !== false);
    const stari = new Map((p.linije || []).map(x => [x.br + '.' + x.dio, x]));
    p.linije = r.linije.map(x => { const s = stari.get(x.br + '.' + x.dio) || {}; return { ...x, id: x.br + '.' + x.dio, status: s.status || 'ne', radnik: s.radnik || '' }; });
    p.polja = r.polja; p.ha = r.ha; p.korak = r.korak; p.optInfo = r.opt;
    status('⏳ Visine krajeva linija…');
    for (const x of p.linije) { x.hDno = await visina(x.dno); x.hVrh = await visina(x.vrh); }
    status('');
  }
  function nadji(id) { return citaj().find(x => x.id === id); }
  function sacuvaj(p) { const l = citaj(), i = l.findIndex(x => x.id === p.id); if (i >= 0) l[i] = p; else l.unshift(p); return pisi(l); }

  // ── Karta ────────────────────────────────────────────────────────────
  function oznaka(lin) { return 'L' + lin.br + (lin.dio ? String.fromCharCode(97 + lin.dio) : ''); }
  function crtaj() {
    grp.clearLayers();
    citaj().filter(p => p.vidljiv !== false).forEach(p => {
      const akt = p.id === aktivni;
      L.polygon(p.ring, { pane: 'sjekackePane', color: '#fde68a', weight: akt ? 2.5 : 1.5, dashArray: '6 4', fill: false, interactive: false }).addTo(grp);
      p.linije.forEach(lin => {
        const s = STATUS[lin.status] || STATUS.ne, vodi = vodic && vodic.pid === p.id && vodic.lid === lin.id;
        L.polyline([lin.dno, lin.vrh], { pane: 'sjekackePane', color: '#0b1220', weight: vodi ? 9 : 6, opacity: 0.55, interactive: false }).addTo(grp);
        L.polyline([lin.dno, lin.vrh], { pane: 'sjekackePane', color: s.c, weight: vodi ? 5 : 3, opacity: 1, interactive: false }).addTo(grp);
        if (akt || vodi || map.getZoom() >= 15) {
          // broj na oba kraja: radnik koji kreće odozdo i onaj koji provjerava s vrha vide istu oznaku
          L.circleMarker(lin.dno, { pane: 'sjekackePane', radius: 4, color: '#fff', weight: 1.5, fillColor: s.c, fillOpacity: 1, interactive: false }).addTo(grp);
          L.marker(lin.dno, { pane: 'sjekackePane', interactive: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<span class="sl-lbl" style="--c:${s.c}">${oznaka(lin)}</span>` }) }).addTo(grp);
          L.marker(lin.vrh, { pane: 'sjekackePane', interactive: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<span class="sl-lbl vrh" style="--c:${s.c}">${oznaka(lin)} ▲</span>` }) }).addTo(grp);
        }
      });
    });
  }
  let zZadnji = map.getZoom();
  map.on('zoomend', () => { const z = map.getZoom(); if ((z >= 15) !== (zZadnji >= 15)) crtaj(); zZadnji = z; });
  if (typeof _kartaKlikIzvor === 'function') _kartaKlikIzvor((ll, kp) => {
    const out = [];
    citaj().filter(p => p.vidljiv !== false).forEach(p => p.linije.forEach(lin => {
      out.push({ vrsta: 'linija', d: _pxDoLinije(kp, [L.latLng(lin.dno[0], lin.dno[1]), L.latLng(lin.vrh[0], lin.vrh[1])]), otvori: at => popup(p, lin, at) });
    }));
    return out;
  });
  function popup(p, lin, at) {
    const s = STATUS[lin.status] || STATUS.ne;
    const redovi = [['Dužina', fmt(lin.duz) + ' m'], ['Dno → vrh', (lin.hDno != null ? lin.hDno + ' m' : '—') + ' → ' + (lin.hVrh != null ? lin.hVrh + ' m' : '—')], ['Status', s.t]];
    if (lin.radnik) redovi.push(['Radnik', lin.radnik]);
    L.popup({ maxWidth: 290, minWidth: 220, className: 'pk-pop' }).setLatLng(at).setContent(_popKartica({
      ikona: '🪓', boja: s.c, naslov: oznaka(lin) + ' · ' + p.naziv, tip: 'Sjekačka linija', meta: 'razmak ' + p.razmak + ' m', redovi,
      dugmad: [{ t: '🧭 Vodi me', on: `USFSjek.vodi('${p.id}','${lin.id}')`, v: 'glavno' }, { t: '✓ Ofarbano', on: `USFSjek.status('${p.id}','${lin.id}','gotovo')` }]
    })).openOn(map);
  }

  // ── GPS vodič ────────────────────────────────────────────────────────
  function vodi(pid, lid) {
    map.closePopup();
    const p = nadji(pid), lin = p && p.linije.find(x => x.id === lid); if (!lin) return;
    if (typeof gpsOn !== 'undefined' && !gpsOn && typeof startGPS === 'function') startGPS();
    if (vodic) clearInterval(vodic.t);
    vodic = { pid, lid, t: setInterval(vodicOsvjezi, 1000) };
    if (lin.status === 'ne') { lin.status = 'rad'; sacuvaj(p); }
    document.body.classList.add('sl-vodi');
    crtaj(); render(); vodicOsvjezi();
    map.fitBounds(L.latLngBounds([lin.dno, lin.vrh]).pad(0.25), { maxZoom: 18 });
  }
  function vodicKraj() { if (vodic) clearInterval(vodic.t); vodic = null; document.body.classList.remove('sl-vodi'); crtaj(); render(); }
  function vodicOsvjezi() {
    const el = document.getElementById('sl-vodic'); if (!el || !vodic) return;
    const p = nadji(vodic.pid), lin = p && p.linije.find(x => x.id === vodic.lid); if (!lin) { vodicKraj(); return; }
    const gps = typeof lastP !== 'undefined' && lastP && Number.isFinite(lastP.la) ? lastP : null;
    let glavno = '📍 Čekam GPS…', sporedno = '', boja = '#64748b';
    if (gps) {
      const v = slVodic(lin, gps.la, gps.lo), b = Math.abs(v.bocno), tol = Math.max(3, Math.min(8, (gps.ac || 5) * 0.8));
      boja = b <= tol ? '#22c55e' : b <= 15 ? '#f59e0b' : '#ef4444';
      glavno = b <= tol ? '✓ Na liniji' : (v.bocno > 0 ? '← ' : '') + fmt(b, b < 10 ? 1 : 0) + ' m do linije' + (v.bocno < 0 ? ' →' : '');
      sporedno = v.duz < -5 ? fmt(-v.duz) + ' m ispod dna linije' : v.duz > v.len + 5 ? fmt(v.duz - v.len) + ' m iznad vrha — linija završena' : fmt(Math.max(0, v.duz)) + ' / ' + fmt(v.len) + ' m uzbrdo';
      sporedno += ' · GPS ±' + fmt(gps.ac || 0) + ' m';
    }
    el.style.setProperty('--c', boja);
    el.innerHTML = `<div class="sl-v-nasl">🪓 ${esc(oznaka(lin))} · ${esc(p.naziv)} <small>gledano uzbrdo</small></div><div class="sl-v-glavno">${glavno}</div><div class="sl-v-sporedno">${sporedno}</div>
      <div class="sl-v-dug"><button onclick="USFSjek.status('${p.id}','${lin.id}','gotovo')">✓ Ofarbano</button><button onclick="USFSjek.vodicKraj()">✕ Zatvori</button></div>`;
  }

  // ── Crtanje poligona: dodirom na kartu ili obilaskom granice s GPS-om ──
  let crt = null; // { pts:[[la,lo]], sloj }
  function crtPocni() {
    if (crt) return;
    crt = { pts: [], sloj: L.layerGroup().addTo(map) };
    window._npHvataKlik = true; map.on('click', crtKlik);
    document.body.classList.add('sl-crta'); switchMainTab('karta'); crtOsvjezi();
  }
  function crtKlik(e) { crt.pts.push([e.latlng.lat, e.latlng.lng]); crtOsvjezi(); }
  function crtGps() {
    const g = typeof lastP !== 'undefined' && lastP && Number.isFinite(lastP.la) ? lastP : null;
    if (!g) { if (typeof gpsOn !== 'undefined' && !gpsOn && typeof startGPS === 'function') startGPS(); showToast('📍 Čekam GPS — pokušaj za koju sekundu'); return; }
    crt.pts.push([g.la, g.lo]); crtOsvjezi(); showToast('📍 Tačka ' + crt.pts.length + ' (±' + fmt(g.ac || 0) + ' m)');
  }
  function crtKraj() { if (!crt) return; map.removeLayer(crt.sloj); map.off('click', crtKlik); window._npHvataKlik = false; crt = null; document.body.classList.remove('sl-crta'); }
  function crtOsvjezi() {
    if (!crt) return;
    crt.sloj.clearLayers();
    if (crt.pts.length > 1) L.polygon(crt.pts, { pane: 'sjekackePane', color: '#fde68a', weight: 2.5, dashArray: '6 4', fillOpacity: 0.08, interactive: false }).addTo(crt.sloj);
    crt.pts.forEach((q, i) => L.circleMarker(q, { pane: 'sjekackePane', radius: i ? 5 : 7, color: '#0b1220', weight: 2, fillColor: '#fde68a', fillOpacity: 1, interactive: false }).addTo(crt.sloj));
    const el = document.getElementById('sl-crt'); if (!el) return;
    const ha = crt.pts.length > 2 && typeof npPovrsina === 'function' ? npPovrsina(crt.pts) / 1e4 : 0;
    el.innerHTML = `<div class="sl-v-nasl">🪓 Granica sječe <small>dodirni kartu ili idi granicom i dodaj 📍</small></div>
      <div class="sl-v-sporedno">${crt.pts.length} tačaka${ha ? ' · ' + fmt(ha, 2) + ' ha' : ''}</div>
      <div class="sl-v-dug"><button onclick="USFSjek.crtGps()">📍 Moja pozicija</button><button onclick="USFSjek.crtVrati()">↶</button><button onclick="USFSjek.crtZavrsi()">✓ Gotovo</button><button onclick="USFSjek.crtOdustani()">✕</button></div>`;
  }
  function crtZavrsi() {
    if (!crt || crt.pts.length < 3) { showToast('Treba bar 3 tačke granice'); return; }
    const ring = crt.pts.slice(), br = citaj().length + 1;
    crtKraj();
    const naziv = (prompt('Naziv sječe (odjel/odsjek):', 'Sječa ' + br) || '').trim() || 'Sječa ' + br;
    _openStubPanel('sjekacke-panel', 'meni'); napravi(ring, naziv.slice(0, 60));
  }

  // ── UI panel ─────────────────────────────────────────────────────────
  function status(t) { const el = document.getElementById('sl-status'); if (el) el.textContent = t; }
  function izvoriUi() {
    const s = document.getElementById('sl-izvor'); if (!s) return;
    const lista = izvori();
    s.innerHTML = '<option value="">— izaberi poligon —</option>' + lista.map(x => `<option value="${esc(x.k)}">${esc(x.t)}</option>`).join('');
  }
  function render() {
    izvoriUi();
    const el = document.getElementById('sl-lista'); if (!el) return;
    const l = citaj();
    const st = document.getElementById('mc-stat-sjekacke'); if (st) st.textContent = l.length ? String(l.length) : '';
    if (!l.length) { el.innerHTML = '<div class="treg-empty">Nema projekata. Izaberi poligon iznad.</div>'; return; }
    el.innerHTML = l.map(p => {
      const otv = p.id === aktivni, gotovo = p.linije.filter(x => x.status === 'gotovo').length;
      const dos = p.dosljednost != null && p.dosljednost < 0.6 ? `<div class="sl-upoz">⚠ Pad u poligonu nije jednoličan (${Math.round(p.dosljednost * 100)} %) — greben ili vrtača; razmisli o podjeli poligona.</div>` : '';
      const tijelo = !otv ? '' : `
        <div class="sl-param">
          <label>Širina polja <span><input type="number" min="10" max="200" step="5" value="${p.razmak}" data-a="razmak" data-id="${p.id}"> m</span><small>razmak linija ≈ 2 visine stabla</small></label>
          <div class="sl-cipovi">${[40, 50, 60, 70, 80].map(v => `<button data-a="raz" data-v="${v}" data-id="${p.id}" class="${v === p.razmak ? 'on' : ''}">${v} m</button>`).join('')}</div>
          <label class="sl-chk"><input type="checkbox" data-a="opt" data-id="${p.id}"${p.opt !== false ? ' checked' : ''}> Optimizuj zadnje polje <small>ako bi bilo uže od ¾ širine</small></label>
          <label>Smjer pada <span><button data-a="az-" data-id="${p.id}">−5°</button><input type="number" min="0" max="359" value="${p.az}" data-a="az" data-id="${p.id}">°<button data-a="az+" data-id="${p.id}">+5°</button></span><small>${p.azDem != null ? 'DEM: ' + p.azDem + '° (' + strana(p.azDem) + '), nagib ~' + Math.round(p.nagibSt) + '°' : 'bez DEM-a'}</small></label>
          <label>Linije <select data-a="mod" data-id="${p.id}"><option value="pad"${p.mod === 'pad' ? ' selected' : ''}>uz padinu (polja uzbrdo)</option><option value="izohipsa"${p.mod === 'izohipsa' ? ' selected' : ''}>po izohipsi</option></select></label>
        </div>${dos}${p.optInfo ? `<div class="sl-info">↔ Zadnje polje bi bilo ${fmt(p.optInfo.ostatak)} m — ${p.optInfo.nacin === 'suzeno' ? 'zadnja ' + p.optInfo.k + ' polja su sužena na ' + fmt(p.optInfo.w) + ' m' : 'ostatak je raspoređen na zadnja ' + p.optInfo.k + ' polja (' + fmt(p.optInfo.w) + ' m)'}.</div>` : ''}
        <div class="sl-polja">${(p.polja || []).map(f => `<span>P${f.br}<b>${fmt(f.ha, 2)} ha</b><small>${fmt(f.sirina)} m</small></span>`).join('')}</div>
        <div class="sl-lin">${p.linije.map(lin => { const s = STATUS[lin.status] || STATUS.ne; return `<div class="sl-lin-red">
          <b style="--c:${s.c}">${oznaka(lin)}</b><span>${fmt(lin.duz)} m${lin.hDno != null && lin.hVrh != null ? ' · ' + lin.hDno + '→' + lin.hVrh + ' m' : ''}</span>
          <input placeholder="radnik" value="${esc(lin.radnik)}" data-a="radnik" data-id="${p.id}" data-l="${lin.id}" maxlength="24">
          <button data-a="st" data-id="${p.id}" data-l="${lin.id}" style="--c:${s.c}">${s.t}</button>
          <button data-a="vodi" data-id="${p.id}" data-l="${lin.id}">🧭</button></div>`; }).join('')}</div>
        <div class="sl-dug"><button data-a="kml" data-id="${p.id}">⤓ KML za radnike</button><button data-a="vid" data-id="${p.id}">${p.vidljiv === false ? '👁 Prikaži' : '🙈 Sakrij'}</button><button data-a="brisi" data-id="${p.id}" class="opasno">🗑</button></div>`;
      return `<div class="sl-proj${otv ? ' otv' : ''}"><div class="sl-proj-zag" data-a="otvori" data-id="${p.id}"><b>🪓 ${esc(p.naziv)}</b><small>${fmt(p.ha || 0, 2)} ha · ${p.linije.length} linija · ${p.razmak} m · ofarbano ${gotovo}/${p.linije.length}</small></div>${tijelo}</div>`;
    }).join('');
  }
  const STRANE = ['S', 'SI', 'I', 'JI', 'J', 'JZ', 'Z', 'SZ'];
  const strana = az => STRANE[Math.round(az / 45) % 8]; // ekspozicija = smjer u kojem padina gleda (= smjer pada)
  function zoom(id) { const p = nadji(id); if (p) try { map.fitBounds(L.latLngBounds(p.ring), { padding: [30, 30], maxZoom: 17 }); } catch (e) {} }

  async function akcija(el) {
    const a = el.dataset.a, p = nadji(el.dataset.id); if (!p) return;
    if (a === 'otvori') { aktivni = aktivni === p.id ? null : p.id; crtaj(); render(); if (aktivni) zoom(p.id); return; }
    if (a === 'az-' || a === 'az+') { p.az = (p.az + (a === 'az+' ? 5 : -5) + 360) % 360; await generisi(p); }
    else if (a === 'raz') { p.razmak = Number(el.dataset.v); await generisi(p); }
    else if (a === 'st') { const lin = p.linije.find(x => x.id === el.dataset.l), red = ['ne', 'rad', 'gotovo']; lin.status = red[(red.indexOf(lin.status) + 1) % 3]; }
    else if (a === 'vodi') { switchMainTab('karta'); vodi(p.id, el.dataset.l); return; }
    else if (a === 'kml') { izvozKml(p); return; }
    else if (a === 'vid') p.vidljiv = p.vidljiv === false;
    else if (a === 'brisi') { if (!confirm('Obrisati projekat "' + p.naziv + '"?')) return; pisi(citaj().filter(x => x.id !== p.id)); if (vodic && vodic.pid === p.id) vodicKraj(); crtaj(); render(); return; }
    sacuvaj(p); crtaj(); render();
  }
  async function promjena(el) {
    const a = el.dataset.a, p = nadji(el.dataset.id); if (!p) return;
    if (a === 'radnik') { const lin = p.linije.find(x => x.id === el.dataset.l); lin.radnik = el.value.trim().slice(0, 24); sacuvaj(p); return; }
    if (a === 'razmak') p.razmak = Math.max(10, Math.min(200, Number(el.value) || 60));
    if (a === 'az') p.az = ((Math.round(Number(el.value)) || 0) % 360 + 360) % 360;
    if (a === 'mod') p.mod = el.value === 'izohipsa' ? 'izohipsa' : 'pad';
    if (a === 'opt') p.opt = !!el.checked;
    await generisi(p); sacuvaj(p); crtaj(); render();
  }

  // ── Dijeljenje među radnicima: KML (linije + projekat u ExtendedData) ──
  function izvozKml(p) {
    const x = s => typeof _xmlEsc === 'function' ? _xmlEsc(s) : esc(s);
    const k = q => q[1].toFixed(7) + ',' + q[0].toFixed(7);
    const lin = p.linije.map(l => `<Placemark><name>${x(oznaka(l))}</name><description>${x(fmt(l.duz) + ' m · ' + (STATUS[l.status] || STATUS.ne).t + (l.radnik ? ' · ' + l.radnik : ''))}</description><styleUrl>#lin</styleUrl><LineString><coordinates>${k(l.dno)} ${k(l.vrh)}</coordinates></LineString></Placemark>`).join('');
    const proj = JSON.stringify({ v: 1, naziv: p.naziv, ring: p.ring, razmak: p.razmak, az: p.az, mod: p.mod, nagibSt: p.nagibSt, opt: p.opt !== false, linije: p.linije.map(l => ({ id: l.id, status: l.status, radnik: l.radnik })) });
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${x('Sjekačke linije · ' + p.naziv)}</name>
<ExtendedData><Data name="usf_sjekacke"><value>${x(proj)}</value></Data></ExtendedData>
<Style id="lin"><LineStyle><color>ff0b9ef5</color><width>3</width></LineStyle></Style>
<Style id="pol"><LineStyle><color>ff8ae6fd</color><width>2</width></LineStyle><PolyStyle><fill>0</fill></PolyStyle></Style>
<Placemark><name>${x(p.naziv)}</name><styleUrl>#pol</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>${p.ring.concat([p.ring[0]]).map(k).join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
${lin}</Document></kml>`;
    _izvozFajl('sjekacke_' + p.naziv.normalize('NFKD').replace(/[^\w-]+/g, '_') + '.kml', kml, 'application/vnd.google-earth.kml+xml', 'Sjekačke linije');
  }
  async function uvoz(file) {
    if (!file) return;
    try {
      const txt = file.name.toLowerCase().endsWith('.kmz') && typeof _kmzExtractKml === 'function' ? await _kmzExtractKml(await file.arrayBuffer()) : await file.text();
      const doc = new DOMParser().parseFromString(txt, 'text/xml');
      const d = [...doc.getElementsByTagName('Data')].find(n => n.getAttribute('name') === 'usf_sjekacke');
      if (d) {
        const j = JSON.parse(d.getElementsByTagName('value')[0].textContent);
        if (!Array.isArray(j.ring) || j.ring.length < 3 || !j.ring.every(q => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite))) throw new Error('neispravan poligon');
        const p = { id: 'sl_' + Date.now().toString(36), naziv: String(j.naziv || 'Sječa').slice(0, 60), datum: new Date().toISOString(), ring: j.ring,
          razmak: Math.max(10, Math.min(200, Number(j.razmak) || 60)), az: ((Number(j.az) || 0) % 360 + 360) % 360, azDem: null, mod: j.mod === 'izohipsa' ? 'izohipsa' : 'pad', nagibSt: Number(j.nagibSt) || 0, opt: j.opt !== false,
          linije: (j.linije || []).map(l => ({ id: String(l.id), br: parseInt(l.id, 10) || 0, dio: parseInt(String(l.id).split('.')[1], 10) || 0, status: STATUS[l.status] ? l.status : 'ne', radnik: String(l.radnik || '').slice(0, 24) })) };
        await generisi(p); // iste postavke ⇒ iste linije na svakom telefonu
        const l = citaj(); l.unshift(p); pisi(l); aktivni = p.id; crtaj(); render(); zoom(p.id);
        showToast('🪓 Uvezen projekat: ' + p.naziv); return;
      }
      const pm = doc.getElementsByTagName('Polygon')[0];
      if (!pm) throw new Error('KML nema poligon');
      const ring = pm.getElementsByTagName('coordinates')[0].textContent.trim().split(/\s+/).map(c => c.split(',').map(Number)).filter(c => c.length >= 2 && c.every(Number.isFinite)).map(([lo, la]) => [la, lo]);
      if (ring.length > 3 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
      await napravi(ring, file.name.replace(/\.km[lz]$/i, ''));
    } catch (e) { showToast('⚠ Uvoz nije uspio: ' + e.message); }
  }

  window.USFSjek = {
    otvori() { _openStubPanel('sjekacke-panel', 'meni'); aktivni = aktivni || (citaj()[0] || {}).id || null; crtaj(); render(); },
    izIzvora() { const k = document.getElementById('sl-izvor')?.value, s = izvori().find(x => x.k === k); if (!s) { showToast('Izaberi poligon s liste'); return; } napravi(s.ring(), s.t.replace(/^\S+\s/, '')); },
    izOdjela() { const o = odjelPodCentrom(); if (!o) { showToast('⚠ Pod centrom karte nema odjela (geo/odjeli.kml)'); return; } napravi(o.ring, o.naziv); },
    izKljuca(k) { map.closePopup(); const s = izvori().find(x => x.k === k); if (!s) { showToast('⚠ Poligon nije pronađen'); return; } _openStubPanel('sjekacke-panel', 'meni'); napravi(s.ring(), s.t.replace(/^\S+\s/, '')); },
    uvoz, vodi, vodicKraj, crtPocni, crtGps, crtZavrsi,
    crtVrati() { if (crt) { crt.pts.pop(); crtOsvjezi(); } },
    crtOdustani() { crtKraj(); },
    status(pid, lid, s) { const p = nadji(pid), lin = p && p.linije.find(x => x.id === lid); if (!lin || !STATUS[s]) return; lin.status = s; sacuvaj(p); map.closePopup(); if (s === 'gotovo' && vodic && vodic.lid === lid) { vodicKraj(); showToast('✓ ' + oznaka(lin) + ' ofarbana'); } crtaj(); render(); }
  };
  const panel = document.getElementById('sjekacke-panel');
  if (panel) {
    panel.addEventListener('click', e => { const el = e.target.closest('[data-a]'); if (el && el.tagName !== 'INPUT' && el.tagName !== 'SELECT') akcija(el); });
    panel.addEventListener('change', e => { const el = e.target.closest('[data-a]'); if (el) promjena(el); });
  }
  crtaj(); render();
})();
