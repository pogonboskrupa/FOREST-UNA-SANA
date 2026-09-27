'use strict';
// Nagib u poligonu: n linija niz padinu (smjer najvećeg pada iz DEM-a) unutar
// nacrtanog / KML / mjerenog poligona — nagib linije = visinska razlika krajeva
// / horizontalna dužina, kao ručno mjerenje. Linije i tjemena se mogu vući.
// Statistika površine iz svih ćelija Copernicus DEM-a (Horn) je dodatak.

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

// ── Linije niz padinu ─────────────────────────────────────────────────
function npDist(a, b) {
  const m = npMetri((a[0] + b[0]) / 2);
  return Math.hypot((b[0] - a[0]) * m.y, (b[1] - a[1]) * m.x);
}
function npPomak(p, azimutDeg, metara) {
  const m = npMetri(p[0]), r = azimutDeg * Math.PI / 180;
  return [p[0] + Math.cos(r) * metara / m.y, p[1] + Math.sin(r) * metara / m.x];
}
// Smjer najvećeg pada (azimut od sjevera) iz visina ±d metara.
function npAzimutPada(hE, hW, hN, hS, d) {
  const dzx = (hE - hW) / (2 * d), dzy = (hN - hS) / (2 * d);
  return { azimut: (Math.atan2(-dzx, -dzy) * 180 / Math.PI + 360) % 360, nagib: Math.atan(Math.hypot(dzx, dzy)) * 180 / Math.PI };
}
function npNagibLinije(h1, h2, dist) {
  const dh = Math.abs(h1 - h2);
  return { st: Math.atan2(dh, dist) * 180 / Math.PI, pct: dist > 0 ? dh / dist * 100 : 0, dh };
}
function npDoRuba(p, ring) {
  const m = npMetri(p[0]); let min = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = (ring[j][1] - p[1]) * m.x, ay = (ring[j][0] - p[0]) * m.y, bx = (ring[i][1] - p[1]) * m.x, by = (ring[i][0] - p[0]) * m.y;
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    min = Math.min(min, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return min;
}
// n polaznih tačaka ravnomjerno po poligonu (najudaljenije jedna od druge,
// ne uz sam rub) — oko svake se povlači linija niz padinu.
function npKandidati(ring) {
  return npMreza(ring, Math.max(5, Math.sqrt(npPovrsina(ring) / 350))).tacke.map(p => ({ p, rub: npDoRuba(p, ring) }));
}
function npSjemena(ring, n, kandidati) {
  let kand = kandidati && kandidati.length ? kandidati.slice() : npKandidati(ring);
  if (!n) return [];
  const maxRub = Math.max(...kand.map(k => k.rub));
  const unutra = kand.filter(k => k.rub >= maxRub * 0.3);
  if (unutra.length >= n) kand = unutra;
  kand.sort((a, b) => b.rub - a.rub);
  const out = [kand[0].p];
  const dmin = kand.map(k => npDist(k.p, out[0]));
  while (out.length < Math.min(n, kand.length)) {
    let bi = 0;
    for (let i = 1; i < kand.length; i++) if (dmin[i] > dmin[bi]) bi = i;
    out.push(kand[bi].p);
    kand.forEach((k, i) => { dmin[i] = Math.min(dmin[i], npDist(k.p, kand[bi].p)); });
  }
  return out;
}
// Linija kroz sjeme u smjeru pada; svaka polovina se skraćuje dok kraj ne uđe u poligon.
function npLinijaKroz(sjeme, azimut, duzina, ring) {
  const kraj = (az) => {
    let d = duzina / 2;
    while (d > 5) { const q = npPomak(sjeme, az, d); if (npUnutra(q[0], q[1], ring)) return q; d *= 0.85; }
    return npPomak(sjeme, az, 5);
  };
  return [kraj((azimut + 180) % 360), kraj(azimut)];
}
// Prati liniju najvećeg pada od tačke: gore do vrha padine, dolje do podnožja
// (staje na grebenu/platou, kad nagib padne ispod ~3°, na rubu poligona ili na
// maksimalnoj dužini). Vraća [vrh, dno]; visinaFn(lat, lon) može biti async.
async function npPratiPad(p, visinaFn, ring, pola, korak = 15) {
  const D = 30;
  const smjer = async q => {
    const [e, w, n, s] = await Promise.all([npPomak(q, 90, D), npPomak(q, 270, D), npPomak(q, 0, D), npPomak(q, 180, D)].map(x => visinaFn(x[0], x[1])));
    return npAzimutPada(e, w, n, s, D);
  };
  const prati = async (gore) => {
    let q = p, h = await visinaFn(p[0], p[1]), predjeno = 0;
    while (predjeno < pola) {
      const g = await smjer(q);
      if (!Number.isFinite(g.azimut) || g.nagib < 1) break;
      const nq = npPomak(q, gore ? (g.azimut + 180) % 360 : g.azimut, korak);
      if (!npUnutra(nq[0], nq[1], ring)) break;
      const nh = await visinaFn(nq[0], nq[1]);
      if (!Number.isFinite(nh) || (gore ? nh - h : h - nh) < korak * 0.05) break;
      q = nq; h = nh; predjeno += korak;
    }
    return q;
  };
  return Promise.all([prati(true), prati(false)]);
}
function npAutoDuzina(povrsina) {
  return Math.max(60, Math.min(300, Math.round(0.45 * Math.sqrt(povrsina) / 10) * 10));
}

if (typeof module !== 'undefined') module.exports = { npUnutra, npPovrsina, npAutoRazmak, npMreza, npStatistika, npNagibIzVisina, npCelije, npDist, npPomak, npAzimutPada, npNagibLinije, npKandidati, npSjemena, npLinijaKroz, npPratiPad, npAutoDuzina };

if (typeof window !== 'undefined' && typeof map !== 'undefined') (function () {
  map.createPane('nagibPolPane');
  map.getPane('nagibPolPane').style.zIndex = '455';
  map.getPane('nagibPolPane').style.pointerEvents = 'none';

  const st = document.createElement('style');
  st.textContent = `
#np-card { position:fixed; left:10px; right:10px; bottom:76px; z-index:700; max-width:440px; margin:0 auto;
  background:rgba(10,20,15,.96); border:1px solid #1f3b2d; border-radius:14px; padding:10px 12px; color:#e2e8f0;
  box-shadow:0 8px 28px rgba(0,0,0,.55); font-size:12.5px; display:none; max-height:50vh; overflow:auto; }
#np-card.show { display:block; }
body.np-open #terrain-map-legend { display:none !important; }
#np-card .np-hdr { display:flex; align-items:center; gap:8px; font-weight:800; font-size:13.5px; cursor:pointer; }
#np-card .np-hdr span { flex:1; }
#np-card .np-hdr button { border:none; background:none; color:#94a3b8; font-size:17px; cursor:pointer; padding:0 4px; }
#np-card.mini .np-tijelo { display:none; }
#np-card .np-sub { color:#94a3b8; font-size:11.5px; margin:4px 0 6px; line-height:1.4; }
#np-card .np-kpi { display:grid; grid-template-columns:1.4fr 1fr 1fr 1fr; gap:6px; margin:6px 0 8px; }
#np-card .np-kpi div { background:#0f1f17; border-radius:8px; padding:6px 4px; text-align:center; }
#np-card .np-kpi b { display:block; font-size:15px; }
#np-card .np-kpi div:first-child b { font-size:17px; color:#fbbf24; }
#np-card .np-kpi small { color:#80958a; font-size:10px; }
#np-card .np-kl { display:grid; grid-template-columns:14px 64px 1fr 58px; align-items:center; gap:6px; padding:2px 0; font-size:11.5px; }
#np-card .np-kl i { width:12px; height:12px; border-radius:3px; }
#np-card .np-kl .bar { height:7px; background:#1e293b; border-radius:4px; overflow:hidden; }
#np-card .np-kl .bar u { display:block; height:100%; }
#np-card .np-kl.off { opacity:.4; }
#np-card .np-kl span:last-child { text-align:right; font-variant-numeric:tabular-nums; }
#np-card .np-povr { margin-top:6px; padding-top:6px; border-top:1px solid #1e293b; color:#94a3b8; font-size:11.5px; }
#np-card .np-broj { display:flex; gap:6px; margin:8px 0 2px; align-items:center; }
#np-card .np-broj span { color:#94a3b8; font-size:11.5px; margin-right:2px; }
#np-card .np-broj button { flex:1; padding:7px 0; border-radius:8px; border:1px solid #334155; background:#0b1220; color:#cbd5e1; font:inherit; font-weight:700; cursor:pointer; }
#np-card .np-broj button.on { background:#854d0e; border-color:#fbbf24; color:#fff; }
#np-card .np-akc { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
#np-card .np-akc button, #np-card .np-akc select { flex:1 1 auto; padding:7px 8px; border-radius:8px; border:1px solid #334155; background:#0b1220; color:#cbd5e1; font:inherit; font-size:12px; cursor:pointer; }
#np-card .np-akc button.on { background:#1e3a5f; border-color:#3b82f6; color:#dbeafe; }
#np-card .np-akc button.glavno { background:#166534; border-color:#22c55e; color:#fff; font-weight:700; }
#np-card .np-nap { color:#80958a; font-size:11px; margin-top:6px; line-height:1.4; }
.np-lbl { display:inline-block; white-space:nowrap; padding:1px 6px; border-radius:9px; border:1.5px solid #0b1220; color:#0b1220; font:700 11px/15px system-ui,sans-serif; box-shadow:0 1px 3px rgba(0,0,0,.55); transform:translate(-50%,-50%); }
.np-lbl.rucno { border-color:#fff; box-shadow:0 0 0 2px #0b1220; }
.np-lbl.skr { opacity:.45; }
.np-e { width:14px; height:14px; border-radius:50%; border:2.5px solid #fff; box-sizing:border-box; box-shadow:0 1px 3px rgba(0,0,0,.6); }
.np-e.vrh { background:#0b1220 !important; }
.np-v { width:16px; height:16px; border-radius:4px; background:#fff; border:2px solid #2563eb; box-sizing:border-box; }
.np-v-crt { width:12px; height:12px; border-radius:50%; background:#60a5fa; border:2px solid #fff; box-sizing:border-box; }`;
  document.head.appendChild(st);

  const card = document.createElement('div');
  card.id = 'np-card';
  document.body.appendChild(card);

  const grp = L.layerGroup().addTo(map);
  let stanje = null; // { ring, poly, linije:[], n, duzina, rubovi, vrhovi, celije, gen }
  let crt = null;    // crtanje poligona { pts, line, mk }
  let dodaj = null;  // ručna linija { prva, mk }

  // ── Visine: Copernicus DEM (bilinearno), inače Terrarium pločica z14
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
  let demP = null;
  const dem = () => demP || (demP = window.USFDem ? USFDem.ucitaj().catch(() => { demP = null; return null; }) : Promise.resolve(null));
  async function visinaNa(la, lo) {
    const d = await dem();
    const h = d ? USFDem.visina(d, la, lo) : null;
    if (h !== null && h !== undefined) return h;
    const n = 256 * 2 ** NP_Z, r = la * Math.PI / 180;
    const px = Math.floor((lo + 180) / 360 * n), py = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
    const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
    return (await plocica(tx, ty))[(py - ty * 256) * 256 + (px - tx * 256)];
  }
  async function smjerPada(p) {
    const D = 45;
    const [e, w, n, s] = await Promise.all([npPomak(p, 90, D), npPomak(p, 270, D), npPomak(p, 0, D), npPomak(p, 180, D)].map(q => visinaNa(q[0], q[1])));
    return npAzimutPada(e, w, n, s, D);
  }
  async function celijeStat(ring) {
    const d = await dem(); if (!d) return null;
    const r = npCelije(d, ring, (ix, iy, lat) => USFDem.nagibEkspozicija(d, ix, iy, lat));
    return r.ukupno >= 3 && r.nagibi.length >= 0.9 * r.ukupno ? r : null;
  }

  const klase = () => (typeof terrainSlopeAktivne !== 'undefined' ? terrainSlopeAktivne : [{ max: Infinity, color: '#22c55e', label: 'sve', on: true }]);
  const klasaOd = v => (typeof terrainSlopeKlasa === 'function' ? terrainSlopeKlasa(v) : null) || klase()[klase().length - 1];
  const fmt = (v, d = 1) => Number(v).toLocaleString('bs-BA', { minimumFractionDigits: d, maximumFractionDigits: d });
  const ikona = (html, w, h) => L.divIcon({ className: '', iconSize: [w, h], iconAnchor: [w / 2, h / 2], html });

  // ── Linija: dvije pomjerive krajnje tačke + oznaka (vuče cijelu liniju)
  function crtajLiniju(l) {
    const k = Number.isFinite(l.st) ? klasaOd(l.st) : null, boja = k ? k.color : '#94a3b8';
    const ll = [l.a, l.b];
    l.okvir.setLatLngs(ll); l.linija.setLatLngs(ll); l.linija.setStyle({ color: boja, opacity: k && k.on === false ? 0.45 : 1 });
    const vrhA = Number.isFinite(l.ha) && Number.isFinite(l.hb) ? l.ha >= l.hb : true;
    l.ma.setLatLng(l.a).setIcon(ikona(`<div class="np-e${vrhA ? ' vrh' : ''}" style="background:${boja}"></div>`, 14, 14));
    l.mb.setLatLng(l.b).setIcon(ikona(`<div class="np-e${vrhA ? '' : ' vrh'}" style="background:${boja}"></div>`, 14, 14));
    const txt = Number.isFinite(l.st) ? `${Math.round(l.st)}° · ${Math.round(l.pct)}%` : '…';
    l.lbl.setLatLng([(l.a[0] + l.b[0]) / 2, (l.a[1] + l.b[1]) / 2])
      .setIcon(L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="np-lbl${l.rucno ? ' rucno' : ''}${k && k.on === false ? ' skr' : ''}" style="background:${boja}">${txt}</div>` }));
  }
  async function izmjeriLiniju(l, gen) {
    try {
      const [ha, hb] = await Promise.all([visinaNa(l.a[0], l.a[1]), visinaNa(l.b[0], l.b[1])]);
      if (!stanje || gen !== stanje.gen) return;
      l.ha = ha; l.hb = hb; l.dist = npDist(l.a, l.b);
      Object.assign(l, npNagibLinije(ha, hb, l.dist));
    } catch (e) { l.st = NaN; }
    crtajLiniju(l);
  }
  function popupLinije(l) {
    if (!Number.isFinite(l.st)) return 'Nema visinskih podataka za ovu liniju.';
    const [vrh, dno] = l.ha >= l.hb ? [l.ha, l.hb] : [l.hb, l.ha];
    return `<b>Nagib ${fmt(l.st)}° (${fmt(l.pct, 0)} %)</b><br>Dužina ${Math.round(l.dist)} m · visinska razlika ${Math.round(l.dh)} m<br>Vrh ${Math.round(vrh)} m → dno ${Math.round(dno)} m${l.rucno ? '<br><i>ručno postavljena / pomjerena</i>' : ''}<br><button onclick="npObrisiLiniju(${l.id})" style="margin-top:6px;padding:4px 8px;border:none;border-radius:6px;background:#dc2626;color:#fff">🗑 Ukloni liniju</button>`;
  }
  let idBr = 0;
  function dodajLiniju(a, b, rucno) {
    const s = stanje, l = { id: ++idBr, a, b, rucno };
    l.okvir = L.polyline([a, b], { pane: 'nagibPolPane', color: '#fff', weight: 7, opacity: 0.75, interactive: false }).addTo(grp);
    l.linija = L.polyline([a, b], { pane: 'nagibPolPane', color: '#94a3b8', weight: 4, interactive: false }).addTo(grp);
    const kraj = (key) => {
      const m = L.marker(l[key], { draggable: true, autoPan: true, zIndexOffset: 600, icon: ikona('<div class="np-e"></div>', 14, 14) }).addTo(grp);
      m.on('drag', () => { const q = m.getLatLng(); l[key] = [q.lat, q.lng]; l.okvir.setLatLngs([l.a, l.b]); l.linija.setLatLngs([l.a, l.b]); });
      m.on('dragend', () => { l.rucno = true; l.st = NaN; crtajLiniju(l); izmjeriLiniju(l, s.gen).then(prikazi); });
      return m;
    };
    l.ma = kraj('a'); l.mb = kraj('b');
    l.lbl = L.marker([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], { draggable: true, autoPan: true, zIndexOffset: 700, icon: ikona('', 0, 0) }).addTo(grp)
      .bindPopup(() => popupLinije(l), { maxWidth: 240 });
    let pocetak = null;
    l.lbl.on('dragstart', () => { pocetak = { m: l.lbl.getLatLng(), a: l.a.slice(), b: l.b.slice() }; });
    l.lbl.on('drag', () => {
      const q = l.lbl.getLatLng(), dy = q.lat - pocetak.m.lat, dx = q.lng - pocetak.m.lng;
      l.a = [pocetak.a[0] + dy, pocetak.a[1] + dx]; l.b = [pocetak.b[0] + dy, pocetak.b[1] + dx];
      l.okvir.setLatLngs([l.a, l.b]); l.linija.setLatLngs([l.a, l.b]); l.ma.setLatLng(l.a); l.mb.setLatLng(l.b);
    });
    l.lbl.on('dragend', () => { l.rucno = true; l.st = NaN; crtajLiniju(l); izmjeriLiniju(l, s.gen).then(prikazi); });
    s.linije.push(l);
    crtajLiniju(l);
    return l;
  }
  function ukloniLiniju(l) {
    [l.okvir, l.linija, l.ma, l.mb, l.lbl].forEach(x => grp.removeLayer(x));
    stanje.linije = stanje.linije.filter(x => x !== l);
  }
  window.npObrisiLiniju = id => { const l = stanje && stanje.linije.find(x => x.id === id); if (l) { map.closePopup(); ukloniLiniju(l); prikazi(); } };

  async function generisi() {
    const s = stanje; s.gen++;
    const gen = s.gen;
    s.celije = null;
    celijeStat(s.ring).then(r => { if (stanje === s && gen === s.gen) { s.celije = r; prikazi(); } });
    s.linije.filter(l => !l.rucno).forEach(ukloniLiniju);
    const pov = npPovrsina(s.ring), duz = s.duzina || npAutoDuzina(pov);
    s.duzinaAkt = duz;
    const auto = Math.max(0, s.n - s.linije.length);
    s.racuna = true; prikazi();
    // Polazne tačke samo na padini (≥3°) — na platou linija nema smisla.
    const kand = npKandidati(s.ring);
    const nagibi = await Promise.all(kand.map(k => smjerPada(k.p).then(g => g.nagib, () => 0)));
    if (!stanje || gen !== s.gen) return;
    const naPadini = kand.filter((k, i) => nagibi[i] >= 3);
    const sjemena = npSjemena(s.ring, auto, naPadini.length >= auto ? naPadini : kand);
    await Promise.all(sjemena.map(async p => {
      let a, b;
      try { [a, b] = await npPratiPad(p, visinaNa, s.ring, duz / 2); } catch (e) {}
      if (!a || npDist(a, b) < 20) { let az = 180; try { const g = await smjerPada(p); if (g.nagib > 0.5) az = g.azimut; } catch (e) {} [a, b] = npLinijaKroz(p, az, duz, s.ring); }
      if (!stanje || gen !== s.gen) return;
      await izmjeriLiniju(dodajLiniju(a, b, false), gen);
    }));
    await Promise.all(s.linije.filter(l => l.rucno && !Number.isFinite(l.st)).map(l => izmjeriLiniju(l, gen)));
    if (stanje !== s || gen !== s.gen) return;
    s.racuna = false; prikazi();
    if (s.linije.length && s.linije.every(l => !Number.isFinite(l.st))) showToast('⚠ Nema visinskih podataka za ovo područje (uključi internet)');
  }

  function rubovi(on) {
    const s = stanje; if (!s) return;
    (s.vrhovi || []).forEach(m => grp.removeLayer(m)); s.vrhovi = [];
    s.rubovi = on;
    if (on) s.vrhovi = s.ring.map((p, i) => {
      const m = L.marker(p, { icon: ikona('<div class="np-v"></div>', 16, 16), draggable: true, zIndexOffset: 1000 }).addTo(grp);
      m.on('drag', () => { const ll = m.getLatLng(); s.ring[i] = [ll.lat, ll.lng]; s.poly.setLatLngs(s.ring); });
      m.on('dragend', () => { generisi(); });
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
    let n = 8; try { n = Number(localStorage.getItem('usf_np_linija')) || 8; } catch (e) {}
    stanje = { ring: r, naziv: naziv || 'Poligon', linije: [], gen: 0, n, duzina: 0, vrhovi: [] };
    stanje.poly = L.polygon(r, { pane: 'nagibPolPane', color: '#3b82f6', weight: 2.5, dashArray: '6 4', fillColor: '#3b82f6', fillOpacity: 0.05, interactive: false }).addTo(grp);
    document.body.classList.add('np-open');
    card.classList.add('show'); card.classList.remove('mini');
    try { map.fitBounds(stanje.poly.getBounds(), { paddingTopLeft: [24, 80], paddingBottomRight: [24, Math.min(400, window.innerHeight * 0.5) + 90], maxZoom: 17 }); } catch (e) {}
    generisi();
  }

  function prekiniDodaj() { if (dodaj) { if (dodaj.mk) grp.removeLayer(dodaj.mk); map.off('click', klikDodaj); dodaj = null; window._npHvataKlik = false; } }
  function zatvori(tiho) {
    if (crt) { map.off('click', crtKlik); crt = null; }
    prekiniDodaj();
    if (stanje) stanje.gen++;
    stanje = null; window._npHvataKlik = false;
    grp.clearLayers();
    if (!tiho) { card.classList.remove('show'); document.body.classList.remove('np-open'); }
  }

  // ── Crtanje poligona
  function crtKlik(e) {
    if (!crt) return;
    crt.pts.push([e.latlng.lat, e.latlng.lng]);
    crt.mk.push(L.marker(e.latlng, { icon: ikona('<div class="np-v-crt"></div>', 12, 12), interactive: false }).addTo(grp));
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

  // ── Ručna linija: dva dodira (vrh i dno)
  function klikDodaj(e) {
    if (!dodaj || !stanje) return;
    const q = [e.latlng.lat, e.latlng.lng];
    if (!dodaj.prva) {
      dodaj.prva = q;
      dodaj.mk = L.marker(q, { icon: ikona('<div class="np-e" style="background:#fbbf24"></div>', 14, 14), interactive: false }).addTo(grp);
      prikazi(); return;
    }
    const a = dodaj.prva; prekiniDodaj();
    izmjeriLiniju(dodajLiniju(a, q, true), stanje.gen).then(prikazi);
    prikazi();
  }

  function csv() {
    if (!stanje || typeof _uCsv !== 'function' || typeof _izvozFajl !== 'function') return;
    const red = stanje.linije.map((l, i) => {
      const [v, d] = l.ha >= l.hb ? [l.a, l.b] : [l.b, l.a];
      return [i + 1, v[0].toFixed(6), v[1].toFixed(6), d[0].toFixed(6), d[1].toFixed(6), Math.round(Math.max(l.ha, l.hb)), Math.round(Math.min(l.ha, l.hb)),
        Math.round(l.dist), Number.isFinite(l.st) ? l.st.toFixed(1) : '', Number.isFinite(l.pct) ? l.pct.toFixed(0) : '', Number.isFinite(l.st) ? klasaOd(l.st).label : '', l.rucno ? 'da' : ''];
    });
    _izvozFajl('nagib_linije_' + new Date().toISOString().slice(0, 10) + '.csv',
      _uCsv(['br', 'vrh_lat', 'vrh_lon', 'dno_lat', 'dno_lon', 'vrh_m', 'dno_m', 'duzina_m', 'nagib_st', 'nagib_pct', 'raspon', 'rucno'], red), 'text/csv', 'Nagib poligona — linije');
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
    const ok = s.linije.filter(l => Number.isFinite(l.st));
    const stat = npStatistika(ok.map(l => l.st), kl, pov);
    const prPct = ok.length ? ok.reduce((a, l) => a + l.pct, 0) / ok.length : NaN;
    const povr = s.celije ? npStatistika(s.celije.nagibi, kl, pov) : null;
    card.innerHTML = `<div class="np-hdr" data-a="mini"><span>📐 ${s.naziv.replace(/[<>&]/g, '')}</span><button data-a="x" aria-label="Zatvori">✕</button></div>
      <div class="np-tijelo">
      <div class="np-sub">${fmt(pov / 10000, 2)} ha · ${s.linije.length} linija niz padinu · do ${s.duzinaAkt} m (od vrha do podnožja padine)${s.racuna ? ' · računam…' : ''}</div>
      ${stat ? `<div class="np-kpi"><div><b>${fmt(stat.sr)}° · ${fmt(prPct, 0)}%</b><small>prosjek linija</small></div><div><b>${fmt(stat.med)}°</b><small>medijan</small></div><div><b>${fmt(stat.min, 0)}°</b><small>min</small></div><div><b>${fmt(stat.max, 0)}°</b><small>max</small></div></div>
      ${stat.poKlasi.map(p => `<div class="np-kl${p.k.on === false ? ' off' : ''}"><i style="background:${p.k.color}"></i><span>${p.k.label}</span><span class="bar"><u style="width:${(p.udio * 100).toFixed(1)}%;background:${p.k.color}"></u></span><span>${p.n} lin.</span></div>`).join('')}` : '<div class="np-sub">Čekam visinske podatke…</div>'}
      ${povr ? `<div class="np-povr">Cijela površina (${povr.n} ćelija DEM 30 m): prosjek <b>${fmt(povr.sr)}°</b>, medijan ${fmt(povr.med)}°, max ${fmt(povr.max, 0)}°</div>` : ''}
      <div class="np-broj"><span>Linija:</span>${[5, 8, 10, 12].map(n => `<button data-a="n" data-n="${n}" class="${n === s.n ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="np-akc">
        <select data-a="duz" aria-label="Dužina linija">${[0, 100, 150, 200, 300].map(d => `<option value="${d}" ${d === s.duzina ? 'selected' : ''}>${d ? 'Najviše ' + d + ' m' : 'Dužina auto'}</option>`).join('')}</select>
        <button data-a="rub" class="${s.rubovi ? 'on' : ''}">✎ Rubovi</button>
        <button data-a="dodaj" class="${dodaj ? 'on' : ''}">+ Linija</button>
        <button data-a="csv">⤓ CSV</button>
      </div>
      <div class="np-nap">${dodaj ? (dodaj.prva ? 'Dodirni kraj linije (dno).' : 'Dodirni početak linije (vrh).') : `Vuci kraj linije da ga pomjeriš, ili oznaku s nagibom da pomjeriš cijelu liniju. Tamni kraj = vrh. Dodir na oznaku: detalji i brisanje.${s.rubovi ? ' Bijela tjemena pomjeraju rub poligona.' : ''}`}</div>
      </div>`;
  }

  card.addEventListener('click', e => {
    const el = e.target.closest('[data-a]'), a = el?.dataset.a;
    if (!a || a === 'duz') return;
    if (a === 'x') { e.stopPropagation(); zatvori(); }
    else if (a === 'mini') card.classList.toggle('mini');
    else if (a === 'undo' && crt) { crt.pts.pop(); grp.removeLayer(crt.mk.pop()); crt.line.setLatLngs(crt.pts.length > 2 ? [...crt.pts, crt.pts[0]] : crt.pts); prikazi(); }
    else if (a === 'kraj') crtZavrsi();
    else if (a === 'n') {
      stanje.n = Number(el.dataset.n);
      try { localStorage.setItem('usf_np_linija', String(stanje.n)); } catch (err) {}
      generisi();
    }
    else if (a === 'rub') rubovi(!stanje.rubovi);
    else if (a === 'dodaj') {
      if (dodaj) prekiniDodaj();
      else { dodaj = { prva: null }; window._npHvataKlik = true; map.on('click', klikDodaj); }
      prikazi();
    }
    else if (a === 'csv') csv();
  });
  card.addEventListener('change', e => {
    if (e.target.dataset.a !== 'duz' || !stanje) return;
    stanje.duzina = Number(e.target.value);
    stanje.linije.filter(l => l.rucno).forEach(ukloniLiniju);
    generisi();
  });
  L.DomEvent.disableClickPropagation(card);
  L.DomEvent.disableScrollPropagation(card);

  window.addEventListener('usf-nagib-klase', () => {
    if (!stanje) return;
    stanje.linije.forEach(crtajLiniju);
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
