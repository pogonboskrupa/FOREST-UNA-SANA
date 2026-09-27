'use strict';
// Nagib u poligonu: mreža tačaka unutar nacrtanog / KML / mjerenog poligona,
// nagib svake tačke iz istog DEM-a kao sloj nagiba (Terrarium z14, offline
// lokalni DEM), statistika po korisničkim rasponima. Tačke i tjemena se mogu
// vući — poslije pomjeranja se nagib i statistika preračunaju.

const NP_Z = 14;
const NP_MAX_TACAKA = 400;

function npMetri(lat0) {
  return { y: 111320, x: 111320 * Math.cos(lat0 * Math.PI / 180) };
}
// ring: [[lat, lon], ...] bez ponovljenog prvog tjemena
function npUnutra(la, lo, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ya, xa] = ring[i], [yb, xb] = ring[j];
    if ((ya > la) !== (yb > la) && lo < (xb - xa) * (la - ya) / (yb - ya) + xa) ins = !ins;
  }
  return ins;
}
function npPovrsina(ring) {
  if (ring.length < 3) return 0;
  const m = npMetri(ring.reduce((s, p) => s + p[0], 0) / ring.length);
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][1] * m.x * ring[i][0] * m.y - ring[i][1] * m.x * ring[j][0] * m.y;
  return Math.abs(a) / 2;
}
// ~80 tačaka po poligonu, zaokruženo na 5 m, 15–250 m.
function npAutoRazmak(povrsina) {
  return Math.max(15, Math.min(250, Math.round(Math.sqrt(povrsina / 80) / 5) * 5 || 15));
}
function npMreza(ring, razmak) {
  const la = ring.map(p => p[0]), lo = ring.map(p => p[1]);
  const s = Math.min(...la), n = Math.max(...la), w = Math.min(...lo), e = Math.max(...lo);
  const m = npMetri((s + n) / 2);
  let r = razmak;
  for (;;) {
    const dy = r / m.y, dx = r / m.x, out = [];
    for (let y = s + dy / 2; y < n; y += dy)
      for (let x = w + dx / 2; x < e; x += dx) if (npUnutra(y, x, ring)) out.push([y, x]);
    if (out.length <= NP_MAX_TACAKA) {
      if (!out.length) out.push([la.reduce((a, b) => a + b) / la.length, lo.reduce((a, b) => a + b) / lo.length]);
      return { tacke: out, razmak: r };
    }
    r = Math.ceil(r * Math.sqrt(out.length / NP_MAX_TACAKA) / 5) * 5;
  }
}
function npStatistika(nagibi, klase, povrsina) {
  const v = nagibi.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const n = v.length, mid = n >> 1;
  return {
    n, sr: v.reduce((a, b) => a + b, 0) / n, med: n % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2, min: v[0], max: v[n - 1],
    poKlasi: klase.map((k, i) => {
      const od = i ? klase[i - 1].max : 0, c = v.filter(x => x >= od && x < k.max).length;
      return { k, n: c, udio: c / n, ha: povrsina * c / n / 10000 };
    })
  };
}
// Nagib/ekspozicija iz visina: get(px, py) daje visinu globalnog piksela,
// korak 2 piksela (~14 m na z14) da se izbjegne stepenasti upsample 30 m DEM-a.
function npNagibIzVisina(e, w, s, n, razmakM) {
  const dx = (e - w) / (2 * razmakM), dy = (s - n) / (2 * razmakM);
  const slope = Math.atan(Math.hypot(dx, dy)) * 180 / Math.PI;
  const aspect = (Math.atan2(-dx, dy) * 180 / Math.PI + 360) % 360;
  return { slope, aspect };
}

// Nagib svih ćelija DEM-a čiji je centar u poligonu (statistika po površini,
// ne samo po prikazanim tačkama). nagibFn(ix, iy, lat) → {nagib} | null.
function npCelije(d, ring, nagibFn) {
  const la = ring.map(p => p[0]), lo = ring.map(p => p[1]);
  const x0 = Math.max(1, Math.floor((Math.min(...lo) - d.ox) / d.rx)), x1 = Math.min(d.W - 2, Math.ceil((Math.max(...lo) - d.ox) / d.rx));
  const y0 = Math.max(1, Math.floor((Math.max(...la) - d.oy) / d.ry)), y1 = Math.min(d.H - 2, Math.ceil((Math.min(...la) - d.oy) / d.ry));
  const nagibi = []; let ukupno = 0;
  for (let iy = y0; iy <= y1; iy++) {
    const lat = d.oy + (iy + 0.5) * d.ry;
    for (let ix = x0; ix <= x1; ix++) {
      if (!npUnutra(lat, d.ox + (ix + 0.5) * d.rx, ring)) continue;
      ukupno++;
      const g = nagibFn(ix, iy, lat);
      if (g) nagibi.push(g.nagib);
    }
  }
  return { nagibi, ukupno };
}

if (typeof module !== 'undefined') module.exports = { npUnutra, npPovrsina, npAutoRazmak, npMreza, npStatistika, npNagibIzVisina, npCelije };

if (typeof window !== 'undefined' && typeof map !== 'undefined') (function () {
  map.createPane('nagibPolPane');
  map.getPane('nagibPolPane').style.zIndex = '455';
  map.getPane('nagibPolPane').style.pointerEvents = 'none';

  const st = document.createElement('style');
  st.textContent = `
#np-card { position:fixed; left:10px; right:10px; bottom:76px; z-index:700; max-width:440px; margin:0 auto;
  background:rgba(10,20,15,.96); border:1px solid #1f3b2d; border-radius:14px; padding:10px 12px; color:#e2e8f0;
  box-shadow:0 8px 28px rgba(0,0,0,.55); font-size:12.5px; display:none; max-height:52vh; overflow:auto; }
#np-card.show { display:block; }
body.np-open #terrain-map-legend { display:none !important; }
#np-card .np-hdr { display:flex; align-items:center; gap:8px; font-weight:800; font-size:13.5px; cursor:pointer; }
#np-card .np-hdr span { flex:1; }
#np-card .np-hdr button { border:none; background:none; color:#94a3b8; font-size:17px; cursor:pointer; padding:0 4px; }
#np-card.mini .np-tijelo { display:none; }
#np-card .np-sub { color:#94a3b8; font-size:11.5px; margin:4px 0 6px; }
#np-card .np-kpi { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin:6px 0 8px; }
#np-card .np-kpi div { background:#0f1f17; border-radius:8px; padding:6px 4px; text-align:center; }
#np-card .np-kpi b { display:block; font-size:15px; }
#np-card .np-kpi small { color:#80958a; font-size:10px; }
#np-card .np-kl { display:grid; grid-template-columns:14px 64px 1fr 40px 56px; align-items:center; gap:6px; padding:2px 0; font-size:11.5px; }
#np-card .np-kl i { width:12px; height:12px; border-radius:3px; }
#np-card .np-kl .bar { height:7px; background:#1e293b; border-radius:4px; overflow:hidden; }
#np-card .np-kl .bar u { display:block; height:100%; }
#np-card .np-kl.off { opacity:.4; }
#np-card .np-kl span:nth-child(4), #np-card .np-kl span:nth-child(5) { text-align:right; font-variant-numeric:tabular-nums; }
#np-card .np-akc { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
#np-card .np-akc button, #np-card .np-akc select { flex:1 1 auto; padding:7px 8px; border-radius:8px; border:1px solid #334155; background:#0b1220; color:#cbd5e1; font:inherit; font-size:12px; cursor:pointer; }
#np-card .np-akc button.on { background:#1e3a5f; border-color:#3b82f6; color:#dbeafe; }
#np-card .np-akc button.glavno { background:#166534; border-color:#22c55e; color:#fff; font-weight:700; }
#np-card .np-nap { color:#80958a; font-size:11px; margin-top:6px; line-height:1.4; }
.np-t { min-width:24px; height:17px; padding:0 3px; border-radius:9px; border:1.5px solid #0b1220; color:#0b1220; font:700 10.5px/15px system-ui,sans-serif; text-align:center; box-shadow:0 1px 3px rgba(0,0,0,.5); box-sizing:border-box; }
.np-t.rucno { border-color:#fff; box-shadow:0 0 0 2px #0b1220; }
.np-t.skr, .np-d.skr { opacity:.35; }
.np-d { width:12px; height:12px; border-radius:50%; border:1.5px solid #0b1220; box-sizing:border-box; box-shadow:0 1px 2px rgba(0,0,0,.5); }
.np-d.rucno { border:2px solid #fff; }
.np-v { width:16px; height:16px; border-radius:4px; background:#fff; border:2px solid #2563eb; box-sizing:border-box; }
.np-v-crt { width:12px; height:12px; border-radius:50%; background:#60a5fa; border:2px solid #fff; box-sizing:border-box; }`;
  document.head.appendChild(st);

  const card = document.createElement('div');
  card.id = 'np-card';
  document.body.appendChild(card);

  const grp = L.layerGroup().addTo(map);
  let stanje = null; // { ring, poly, tacke:[{la,lo,nagib,eksp,h,rucno,m}], razmak, rucniRazmak, rubovi, gen }
  let crt = null;    // { pts:[], line, mk:[] }
  let dodaj = false;

  // ── DEM: Terrarium pločice (keš, offline lokalni DEM kroz _getTerrariumTile)
  const plocice = new Map();
  function plocica(x, y) {
    const n = 2 ** NP_Z; x = (x % n + n) % n; y = Math.max(0, Math.min(n - 1, y));
    const k = x + '/' + y;
    if (!plocice.has(k)) {
      const p = (async () => {
        const b = await _getTerrariumTile(NP_Z, x, y);
        if (!b) throw new Error('nema DEM pločice');
        const v = _terrariumDecodeTile(b); if (b.close) b.close(); return v;
      })();
      plocice.set(k, p); p.catch(() => plocice.delete(k));
      if (plocice.size > 64) plocice.delete(plocice.keys().next().value);
    }
    return plocice.get(k);
  }
  async function visinaPx(px, py) {
    const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
    const t = await plocica(tx, ty);
    return t[(py - ty * 256) * 256 + (px - tx * 256)];
  }
  let demP = null;
  const dem = () => demP || (demP = window.USFDem ? USFDem.ucitaj().catch(() => { demP = null; return null; }) : Promise.resolve(null));
  async function nagibNa(la, lo) {
    const d = await dem();
    const c = d && USFDem.celija(d, la, lo);
    const g = c && USFDem.nagibEkspozicija(d, c.ix, c.iy, la);
    if (g) return { nagib: g.nagib, eksp: g.eksp, h: USFDem.visina(d, la, lo), izvor: 'dem' };
    return nagibTerrarium(la, lo);
  }
  // Statistika iz svih 30 m ćelija u poligonu; null ako DEM ne pokriva ≥90 %.
  async function celijeStat(ring) {
    const d = await dem(); if (!d) return null;
    const r = npCelije(d, ring, (ix, iy, lat) => USFDem.nagibEkspozicija(d, ix, iy, lat));
    return r.ukupno >= 3 && r.nagibi.length >= 0.9 * r.ukupno ? r : null;
  }
  async function nagibTerrarium(la, lo) {
    const n = 256 * 2 ** NP_Z;
    const px = Math.floor((lo + 180) / 360 * n);
    const r = la * Math.PI / 180;
    const py = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
    const m = 40075016.686 * Math.cos(r) / n;
    const [e, w, s, nn, h] = await Promise.all([visinaPx(px + 2, py), visinaPx(px - 2, py), visinaPx(px, py + 2), visinaPx(px, py - 2), visinaPx(px, py)]);
    const g = npNagibIzVisina(e, w, s, nn, 2 * m);
    return { nagib: g.slope, eksp: g.aspect, h };
  }

  const klase = () => (typeof terrainSlopeAktivne !== 'undefined' ? terrainSlopeAktivne : [{ max: Infinity, color: '#22c55e', label: 'sve', on: true }]);
  const klasaOd = v => (typeof terrainSlopeKlasa === 'function' ? terrainSlopeKlasa(v) : null) || klase()[klase().length - 1];
  const EKSP = ['S', 'SI', 'I', 'JI', 'J', 'JZ', 'Z', 'SZ'];
  const fmt = (v, d = 1) => Number(v).toLocaleString('bs-BA', { minimumFractionDigits: d, maximumFractionDigits: d });

  // Kad su tačke na ekranu bliže od ~34 px, broj se ne stane — tada tačkica, broj u popupu.
  function kompaktno() {
    if (!stanje || !stanje.razmak) return false;
    const mpp = 40075016.686 * Math.cos(map.getCenter().lat * Math.PI / 180) / (256 * 2 ** map.getZoom());
    return stanje.razmak / mpp < 34;
  }
  function ikonaTacke(t) {
    const k = Number.isFinite(t.nagib) ? klasaOd(t.nagib) : null;
    if (kompaktno()) return L.divIcon({ className: '', iconSize: [12, 12], iconAnchor: [6, 6],
      html: `<div class="np-d${t.rucno ? ' rucno' : ''}${k && k.on === false ? ' skr' : ''}" style="background:${k ? k.color : '#64748b'}"></div>` });
    if (!k) return L.divIcon({ className: '', iconSize: [24, 17], iconAnchor: [12, 8], html: '<div class="np-t" style="background:#64748b">…</div>' });
    return L.divIcon({ className: '', iconSize: [28, 17], iconAnchor: [14, 8],
      html: `<div class="np-t${t.rucno ? ' rucno' : ''}${k.on === false ? ' skr' : ''}" style="background:${k.color}">${Math.round(t.nagib)}°</div>` });
  }
  function popupTacke(t) {
    if (!Number.isFinite(t.nagib)) return 'Nagib nije dostupan (nema DEM-a za ovu tačku).';
    return `<b>Nagib ${fmt(t.nagib)}°</b> (${fmt(Math.tan(t.nagib * Math.PI / 180) * 100, 0)} %)<br>Ekspozicija: ${t.nagib <= 2 ? 'ravno' : EKSP[Math.floor((t.eksp + 22.5) / 45) % 8]}<br>Visina: ${Number.isFinite(t.h) ? Math.round(t.h) + ' m' : '—'}${t.rucno ? '<br><i>ručno postavljena / pomjerena</i>' : ''}<br><small>${t.la.toFixed(6)}, ${t.lo.toFixed(6)}</small>`;
  }
  async function izmjeri(t, gen) {
    try { Object.assign(t, await nagibNa(t.la, t.lo)); } catch (e) { t.nagib = NaN; }
    if (!stanje || gen !== stanje.gen) return;
    t.m.setIcon(ikonaTacke(t));
  }
  function dodajTacku(la, lo, rucno) {
    const t = { la, lo, nagib: undefined, rucno };
    t.m = L.marker([la, lo], { icon: ikonaTacke(t), draggable: true, autoPan: true, zIndexOffset: rucno ? 500 : 0 })
      .bindPopup(() => popupTacke(t), { maxWidth: 220 }).addTo(grp);
    t.m.on('dragend', async () => {
      const ll = t.m.getLatLng(); t.la = ll.lat; t.lo = ll.lng; t.rucno = true; t.nagib = undefined;
      t.m.setIcon(ikonaTacke(t)); await izmjeri(t, stanje.gen); prikazi();
    });
    stanje.tacke.push(t);
    return t;
  }

  async function uzorkuj() {
    const s = stanje; s.gen++;
    const gen = s.gen;
    s.celije = null;
    celijeStat(s.ring).then(r => { if (stanje === s && gen === s.gen) { s.celije = r; prikazi(); } });
    s.tacke.filter(t => !t.rucno).forEach(t => grp.removeLayer(t.m));
    s.tacke = s.tacke.filter(t => t.rucno);
    const pov = npPovrsina(s.ring);
    const mr = npMreza(s.ring, s.rucniRazmak || npAutoRazmak(pov));
    s.razmak = mr.razmak;
    const nove = mr.tacke.map(([la, lo]) => dodajTacku(la, lo, false));
    s.racuna = true; prikazi();
    for (let i = 0; i < nove.length; i += 24) {
      await Promise.all(nove.slice(i, i + 24).map(t => izmjeri(t, gen)));
      if (gen !== s.gen || stanje !== s) return;
      s.gotovo = i + 24; prikazi();
    }
    await Promise.all(s.tacke.filter(t => t.rucno && t.nagib === undefined).map(t => izmjeri(t, gen)));
    if (gen !== s.gen || stanje !== s) return;
    s.racuna = false; prikazi();
    if (s.tacke.every(t => !Number.isFinite(t.nagib))) showToast('⚠ Nema visinskih podataka za ovo područje (uključi internet ili preuzmi pločice)');
  }

  function rubovi(on) {
    const s = stanje; if (!s) return;
    (s.vrhovi || []).forEach(m => grp.removeLayer(m)); s.vrhovi = [];
    s.rubovi = on;
    if (on) s.vrhovi = s.ring.map((p, i) => {
      const m = L.marker(p, { icon: L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8], html: '<div class="np-v"></div>' }), draggable: true, zIndexOffset: 1000 }).addTo(grp);
      m.on('drag', () => { const ll = m.getLatLng(); s.ring[i] = [ll.lat, ll.lng]; s.poly.setLatLngs(s.ring); });
      m.on('dragend', () => { uzorkuj(); });
      return m;
    });
    prikazi();
  }

  function pocni(ring, naziv) {
    zatvori(true);
    const r = ring.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (r.length > 2 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
    if (r.length < 3) { showToast('⚠ Poligon treba najmanje 3 tjemena'); return; }
    map.closePopup();
    stanje = { ring: r, naziv: naziv || 'Poligon', tacke: [], gen: 0, rucniRazmak: 0, vrhovi: [] };
    stanje.poly = L.polygon(r, { pane: 'nagibPolPane', color: '#3b82f6', weight: 2.5, dashArray: '6 4', fillColor: '#3b82f6', fillOpacity: 0.06, interactive: false }).addTo(grp);
    document.body.classList.add('np-open');
    card.classList.add('show'); card.classList.remove('mini');
    try { map.fitBounds(stanje.poly.getBounds(), { paddingTopLeft: [24, 80], paddingBottomRight: [24, Math.min(420, window.innerHeight * 0.52) + 90], maxZoom: 17 }); } catch (e) {}
    uzorkuj();
  }

  function zatvori(tiho) {
    if (crt) { map.off('click', crtKlik); crt = null; }
    if (stanje) stanje.gen++;
    stanje = null; dodaj = false; window._npHvataKlik = false;
    grp.clearLayers();
    if (!tiho) { card.classList.remove('show'); document.body.classList.remove('np-open'); }
  }

  // ── Crtanje poligona na karti
  function crtKlik(e) {
    if (!crt) return;
    crt.pts.push([e.latlng.lat, e.latlng.lng]);
    crt.mk.push(L.marker(e.latlng, { icon: L.divIcon({ className: '', iconSize: [12, 12], iconAnchor: [6, 6], html: '<div class="np-v-crt"></div>' }), interactive: false }).addTo(grp));
    crt.line.setLatLngs(crt.pts.length > 2 ? [...crt.pts, crt.pts[0]] : crt.pts);
    prikazi();
  }
  function crtaj() {
    zatvori(true);
    if (typeof switchMainTab === 'function') switchMainTab('karta');
    crt = { pts: [], mk: [], line: L.polyline([], { pane: 'nagibPolPane', color: '#60a5fa', weight: 2.5, dashArray: '5 5', interactive: false }).addTo(grp) };
    window._npHvataKlik = true;
    map.on('click', crtKlik);
    document.body.classList.add('np-open');
    card.classList.add('show'); card.classList.remove('mini');
    prikazi();
  }
  function crtZavrsi() {
    if (!crt || crt.pts.length < 3) return;
    const pts = crt.pts.slice();
    map.off('click', crtKlik); crt = null; window._npHvataKlik = false;
    pocni(pts, 'Nacrtani poligon');
  }

  function klikDodaj(e) {
    if (!dodaj || !stanje) return;
    dodaj = false; window._npHvataKlik = false; map.off('click', klikDodaj);
    const t = dodajTacku(e.latlng.lat, e.latlng.lng, true);
    izmjeri(t, stanje.gen).then(prikazi);
    prikazi();
  }

  function csv() {
    if (!stanje || typeof _uCsv !== 'function' || typeof _izvozFajl !== 'function') return;
    const red = stanje.tacke.map((t, i) => [i + 1, t.la.toFixed(6), t.lo.toFixed(6), Number.isFinite(t.nagib) ? t.nagib.toFixed(1) : '',
      Number.isFinite(t.nagib) ? (t.nagib <= 2 ? 'ravno' : EKSP[Math.floor((t.eksp + 22.5) / 45) % 8]) : '', Number.isFinite(t.h) ? Math.round(t.h) : '',
      Number.isFinite(t.nagib) ? klasaOd(t.nagib).label : '', t.rucno ? 'da' : '']);
    _izvozFajl('nagib_poligon_' + new Date().toISOString().slice(0, 10) + '.csv',
      _uCsv(['br', 'lat', 'lon', 'nagib_st', 'ekspozicija', 'visina_m', 'raspon', 'rucno'], red), 'text/csv', 'Nagib poligona');
  }

  function prikazi() {
    if (crt) {
      card.innerHTML = `<div class="np-hdr"><span>📐 Crtaj poligon</span><button data-a="x" aria-label="Zatvori">✕</button></div>
        <div class="np-sub">Dodiruj kartu na tjemena poligona (${crt.pts.length}).</div>
        <div class="np-akc"><button data-a="undo" ${crt.pts.length ? '' : 'disabled'}>↶ Ukloni zadnje</button><button data-a="kraj" class="glavno" ${crt.pts.length >= 3 ? '' : 'disabled'}>✓ Izračunaj nagib</button></div>`;
      return;
    }
    const s = stanje; if (!s) return;
    const pov = npPovrsina(s.ring), kl = klase();
    const stat = npStatistika(s.celije ? s.celije.nagibi : s.tacke.map(t => t.nagib), kl, pov);
    const izvor = s.celije ? `statistika iz ${s.celije.nagibi.length} ćelija Copernicus DEM 30 m` : 'statistika iz prikazanih tačaka (AWS Terrarium)';
    const gotovo = s.racuna ? Math.min(s.gotovo || 0, s.tacke.length) : 0;
    const gustine = [0, 20, 40, 80, 150];
    card.innerHTML = `<div class="np-hdr" data-a="mini"><span>📐 ${s.naziv.replace(/[<>&]/g, '')}</span><button data-a="x" aria-label="Zatvori">✕</button></div>
      <div class="np-tijelo">
      <div class="np-sub">${fmt(pov / 10000, 2)} ha · ${s.tacke.length} tačaka · razmak ${s.razmak} m${s.racuna ? ' · računam ' + gotovo + '/' + s.tacke.length + '…' : ''}<br>${izvor}</div>
      ${stat ? `<div class="np-kpi"><div><b>${fmt(stat.sr)}°</b><small>prosjek</small></div><div><b>${fmt(stat.med)}°</b><small>medijan</small></div><div><b>${fmt(stat.min, 0)}°</b><small>min</small></div><div><b>${fmt(stat.max, 0)}°</b><small>max</small></div></div>
      ${stat.poKlasi.map(p => `<div class="np-kl${p.k.on === false ? ' off' : ''}"><i style="background:${p.k.color}"></i><span>${p.k.label}</span><span class="bar"><u style="width:${(p.udio * 100).toFixed(1)}%;background:${p.k.color}"></u></span><span>${fmt(p.udio * 100, 0)} %</span><span>${fmt(p.ha, 2)} ha</span></div>`).join('')}` : '<div class="np-sub">Čekam visinske podatke…</div>'}
      <div class="np-akc">
        <select data-a="gust" aria-label="Razmak tačaka">${gustine.map(g => `<option value="${g}" ${g === s.rucniRazmak ? 'selected' : ''}>${g ? 'Razmak ' + g + ' m' : 'Razmak auto'}</option>`).join('')}</select>
        <button data-a="rub" class="${s.rubovi ? 'on' : ''}">✎ Rubovi</button>
        <button data-a="dodaj" class="${dodaj ? 'on' : ''}">+ Tačka</button>
        <button data-a="csv">⤓ CSV</button>
      </div>
      <div class="np-nap">${dodaj ? 'Dodirni kartu gdje želiš novu tačku.' : `${s.celije ? 'Statistika je iz cijele površine; tačke služe za provjeru na terenu. ' : ''}Vuci tačku da je pomjeriš${s.rubovi ? ', ili bijelo tjeme da pomjeriš rub (sve se preračuna)' : ''}. Ručne tačke imaju bijeli rub.`}</div>
      </div>`;
  }

  card.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a || a === 'gust') return;
    if (a === 'x') { e.stopPropagation(); zatvori(); }
    else if (a === 'mini') card.classList.toggle('mini');
    else if (a === 'undo' && crt) { crt.pts.pop(); grp.removeLayer(crt.mk.pop()); crt.line.setLatLngs(crt.pts.length > 2 ? [...crt.pts, crt.pts[0]] : crt.pts); prikazi(); }
    else if (a === 'kraj') crtZavrsi();
    else if (a === 'rub') rubovi(!stanje.rubovi);
    else if (a === 'dodaj') {
      dodaj = !dodaj; window._npHvataKlik = dodaj;
      if (dodaj) map.on('click', klikDodaj); else map.off('click', klikDodaj);
      prikazi();
    }
    else if (a === 'csv') csv();
  });
  card.addEventListener('change', e => {
    if (e.target.dataset.a !== 'gust' || !stanje) return;
    stanje.rucniRazmak = Number(e.target.value); uzorkuj();
  });
  L.DomEvent.disableClickPropagation(card);
  L.DomEvent.disableScrollPropagation(card);

  let bioKompakt = null;
  map.on('zoomend', () => {
    if (!stanje) return;
    const k = kompaktno(); if (k === bioKompakt) return;
    bioKompakt = k; stanje.tacke.forEach(t => t.m.setIcon(ikonaTacke(t)));
  });
  window.addEventListener('usf-nagib-klase', () => {
    if (!stanje) return;
    stanje.tacke.forEach(t => t.m.setIcon(ikonaTacke(t)));
    prikazi();
  });

  window.npNacrtaj = crtaj;
  window.npIzKml = id => {
    let sloj = null;
    (typeof kmlLs !== 'undefined' ? kmlLs : []).forEach(k => k.grp && k.grp.eachLayer(function walk(l) {
      if (L.stamp(l) === id) sloj = l; else if (l.eachLayer) l.eachLayer(walk);
    }));
    if (!sloj) { showToast('⚠ Poligon nije pronađen'); return; }
    let ll = sloj.getLatLngs();
    while (Array.isArray(ll[0])) ll = ll[0];
    pocni(ll.map(p => [p.lat, p.lng]), sloj._kmlName || 'KML poligon');
  };
  window.npIzMjerenja = id => {
    const m = (typeof _msrRegistry !== 'undefined' ? _msrRegistry : []).find(x => x.id === id);
    if (!m) { showToast('⚠ Mjerenje nije pronađeno'); return; }
    pocni(m.pts.map(p => [p.lat, p.lng]), m.name || 'Mjerenje');
  };
})();
