// Slika odjela / projekta sjekačkih linija u RAZMJERI (A4, 200 dpi, PNG) za izvoz i dijeljenje.
// Crta se vektorski na vlastiti canvas (podloge s interneta bi „zaprljale” canvas i ne bi se mogle
// izvesti, a snimak ekrana nema tačnu razmjeru): reljef i izohipse iz lokalnog DEM-a (USFDem, 5 općina),
// poligoni, linije s oznakama, mjerilo, sjever, legenda, podaci. Razmjera je standardna (1:2 500, 1:5 000…)
// i tačna pri štampi na A4; cijeli objekat uvijek stane na stranicu.
const SLK_DPI = 200;
const SLK_RAZMJERE = [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 12500, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000, 150000, 200000];

// Najmanja standardna razmjera pri kojoj obuhvat (m) stane u kartu (px) uz rub 6 %.
function slkRazmjera(sirM, visM, mapWpx, mapHpx, dpi = SLK_DPI) {
  const mPoPx = 0.0254 / dpi, potrebna = Math.max(sirM / (mapWpx * mPoPx), visM / (mapHpx * mPoPx)) * 1.06;
  return SLK_RAZMJERE.find(r => r >= potrebna) || Math.ceil(potrebna / 50000) * 50000;
}
// Mjerilo: okrugla dužina (m) koja na slici zauzima ~maxPx.
function slkMjerilo(mPoPx, maxPx) {
  const max = mPoPx * maxPx, k = [1, 2, 2.5, 5];
  let best = 10;
  for (let e = 1; e <= 6; e++) for (const f of k) { const v = f * 10 ** e; if (v <= max) best = v; }
  return best;
}
// Interval izohipsi po visinskoj razlici: ~10–25 linija.
function slkInterval(dH) { return [2, 5, 10, 20, 25, 50, 100].find(i => dH / i <= 25) || 200; }
// Izohipse: mreža visina z (nx × ny, NaN = nema) → segmenti [[x1,y1,x2,y2,nivo]] u koordinatama mreže (marching squares).
function slkIzohipse(z, nx, ny, interval) {
  const out = [];
  let mn = Infinity, mx = -Infinity;
  for (const v of z) if (Number.isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; }
  if (!Number.isFinite(mn)) return out;
  for (let h = Math.ceil(mn / interval) * interval; h <= mx; h += interval) {
    for (let j = 0; j + 1 < ny; j++) for (let i = 0; i + 1 < nx; i++) {
      const a = z[j * nx + i], b = z[j * nx + i + 1], c = z[(j + 1) * nx + i + 1], d = z[(j + 1) * nx + i];
      if (![a, b, c, d].every(Number.isFinite)) continue;
      const ivice = [], t = (p, q) => (h - p) / (q - p);
      if ((a < h) !== (b < h)) ivice.push([i + t(a, b), j]);
      if ((b < h) !== (c < h)) ivice.push([i + 1, j + t(b, c)]);
      if ((d < h) !== (c < h)) ivice.push([i + t(d, c), j + 1]);
      if ((a < h) !== (d < h)) ivice.push([i, j + t(a, d)]);
      for (let k = 0; k + 1 < ivice.length; k += 2) out.push([ivice[k][0], ivice[k][1], ivice[k + 1][0], ivice[k + 1][1], h]);
    }
  }
  return out;
}

// Zoom pločica za sliku: rezolucija karte (m/px na zoomu z, 256 px svijet) najbliža rezoluciji slike,
// unutar [zMin, zMax] sloja; ako bi pločica bilo previše (> maxPl), zoom se smanjuje.
function slkZoom(mPoPx, lat, zMin, zMax, sirPx, visPx, maxPl = 160) {
  const r0 = 156543.03392 * Math.cos(lat * Math.PI / 180);
  let z = Math.round(Math.log2(r0 / mPoPx));
  z = Math.max(zMin, Math.min(zMax, z));
  while (z > zMin) { const f = (r0 / 2 ** z) / mPoPx, n = (sirPx / (256 * f) + 2) * (visPx / (256 * f) + 2); if (n <= maxPl) break; z--; }
  return z;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { slkZoom, slkRazmjera, slkMjerilo, slkInterval, slkIzohipse, SLK_RAZMJERE };

(function () {
  if (typeof window === 'undefined') return;
  const fmt = (v, d = 0) => Number(v).toLocaleString('bs-BA', { minimumFractionDigits: d, maximumFractionDigits: d });
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  // ── Podloga: slojevi pločica koji su TRENUTNO na karti (offline .sqlitedb/MBTiles, online, tematski) ──
  // Pločice daje sam sloj (createTile) — isti put kao na ekranu (keš, most, sql.js), na zoomu prema
  // razmjeri slike; zalijepe se na svoje koordinate. Podloga ide na zaseban canvas: ako server nema CORS
  // (canvas „zaprljan”), odbacuje se i slika ostaje s reljefom.
  function slojeviPodloge() {
    if (typeof map === 'undefined') return [];
    const out = [];
    map.eachLayer(l => {
      if (!(l instanceof L.GridLayer) || !l._map || l.options.opacity === 0 || typeof l.createTile !== 'function') return;
      const pane = map.getPane(l.options.pane || 'tilePane'); if (pane && getComputedStyle(pane).display === 'none') return;
      out.push({ l, z: Number((pane && getComputedStyle(pane).zIndex) || 0) * 1000 + (Number(l.options.zIndex) || 0) });
    });
    return out.sort((a, b) => a.z - b.z).map(x => x.l);
  }
  function imeSloja(l) {
    const rec = typeof _sqlLayers !== 'undefined' ? _sqlLayers.find(x => x.layer === l) : null;
    if (rec) return rec.name.replace(/\.(sqlitedb|mbtiles)$/i, '');
    const a = String(l.options.attribution || '').replace(/<[^>]+>/g, '').replace(/&copy;|©/g, '©').trim();
    return a ? a.slice(0, 60) : '';
  }
  function plocica(l, x, y, z) {
    return new Promise(res => {
      let gotovo = false; const kraj = el => { if (!gotovo) { gotovo = true; clearTimeout(t); res(el); } };
      const t = setTimeout(() => kraj(null), 9000);
      try {
        const coords = L.point(x, y); coords.z = z;
        const stari = l._tileZoom; l._tileZoom = z; // TileLayer.getTileUrl čita zoom iz _tileZoom
        let el;
        try { el = l.createTile(coords, (err, tile) => { const e2 = tile || el; if (!e2) return kraj(null); if (e2.tagName === 'IMG' && !e2.complete) { e2.onload = () => kraj(e2); e2.onerror = () => kraj(null); } else kraj(err ? null : e2); }); }
        finally { l._tileZoom = stari; }
        if (el && el.tagName === 'IMG' && !el.crossOrigin && el.src && /^https?:/.test(el.src) && !el.src.startsWith(location.origin)) {
          // obični L.TileLayer bez CORS-a: ponovo s crossOrigin (inače bi zaprljao canvas)
          el.crossOrigin = 'anonymous'; const src = el.src; el.src = ''; el.src = src;
        }
      } catch (e) { kraj(null); }
    });
  }
  async function crtajPodlogu(g, mapX, mapY, mapW, mapH, mPoPx, c, px) {
    const slojevi = slojeviPodloge(); if (!slojevi.length) return null;
    const cv = document.createElement('canvas'); cv.width = mapW; cv.height = mapH;
    const pg = cv.getContext('2d'), crs = map.options.crs, imena = [];
    const ll0 = (x, y) => [c[0] - (y - mapH / 2) * mPoPx / 111320, c[1] + (x - mapW / 2) * mPoPx / (111320 * Math.cos(c[0] * Math.PI / 180))];
    let nacrtano = 0;
    for (const l of slojevi) {
      const o = l.options, ts = typeof l.getTileSize === 'function' ? l.getTileSize().x : 256;
      const zMin = o.minNativeZoom != null ? o.minNativeZoom : (o.minZoom || 0), zMax = o.maxNativeZoom != null ? o.maxNativeZoom : (o.maxZoom != null ? o.maxZoom : 19);
      const z = slkZoom(mPoPx * 256 / ts, c[0], zMin, zMax, mapW, mapH);
      const nw = crs.latLngToPoint(L.latLng(...ll0(0, 0)), z), se = crs.latLngToPoint(L.latLng(...ll0(mapW, mapH)), z);
      const x0 = Math.floor(nw.x / ts), x1 = Math.floor(se.x / ts), y0 = Math.floor(nw.y / ts), y1 = Math.floor(se.y / ts), n = 2 ** z;
      const zadaci = [];
      for (let ty = Math.max(0, y0); ty <= Math.min(n - 1, y1); ty++) for (let tx = x0; tx <= x1; tx++) zadaci.push([((tx % n) + n) % n, ty, tx]);
      if (!zadaci.length || zadaci.length > 400) continue;
      const el = await Promise.all(zadaci.map(([x, y]) => plocica(l, x, y, z)));
      pg.globalAlpha = o.opacity != null ? o.opacity : 1;
      let ok = 0;
      zadaci.forEach(([x, y, tx], i) => {
        const e = el[i]; if (!e || (e.tagName === 'IMG' && !e.naturalWidth)) return;
        const a = crs.pointToLatLng(L.point(tx * ts, y * ts), z), b = crs.pointToLatLng(L.point((tx + 1) * ts, (y + 1) * ts), z);
        const [ax, ay] = px(a.lat, a.lng), [bx, by] = px(b.lat, b.lng);
        try { pg.drawImage(e, ax - mapX, ay - mapY, bx - ax + 0.6, by - ay + 0.6); ok++; } catch (er) {}
      });
      pg.globalAlpha = 1;
      if (ok) { nacrtano += ok; const ime = imeSloja(l); if (ime && !imena.includes(ime)) imena.push(ime); }
    }
    if (!nacrtano) return null;
    try { pg.getImageData(0, 0, 1, 1); } catch (e) { return null; } // zaprljan (bez CORS-a) — bez podloge
    g.drawImage(cv, mapX, mapY);
    return { imena };
  }

  // opis: { naslov, podnaslov, ime (fajl), poligoni:[{ring:[[lat,lon]…], boja, sirina, ispuna, crta, natpis, glavni}],
  //   linije:[{geo:[[lat,lon]…], boja, sirina, crta, oznaka, oznakaVrh}], legenda:[{boja, t, tip:'linija'|'ploha'|'isprek'}], info:[string] }
  async function napravi(opis) {
    const glavni = opis.poligoni.filter(p => p.glavni);
    const sve = (glavni.length ? glavni.flatMap(p => p.ring) : opis.poligoni.flatMap(p => p.ring)).concat((opis.linije || []).flatMap(l => l.geo));
    if (!sve.length) throw new Error('nema geometrije');
    const la = sve.map(q => q[0]), lo = sve.map(q => q[1]);
    const c = [(Math.min(...la) + Math.max(...la)) / 2, (Math.min(...lo) + Math.max(...lo)) / 2];
    const ky = 111320, kx = ky * Math.cos(c[0] * Math.PI / 180);
    const sirM = (Math.max(...lo) - Math.min(...lo)) * kx, visM = (Math.max(...la) - Math.min(...la)) * ky;
    const polozeno = sirM > visM * 1.15, W = polozeno ? 2339 : 1654, H = polozeno ? 1654 : 2339;
    // cista: samo karta u jednakom bijelom okviru, bez teksta (natpis gore po želji korisnika)
    const cista = !!opis.cista, M = cista ? 36 : 70, zag = cista ? 36 : 150, pod = cista ? 36 : 300, mapX = M, mapY = zag, mapW = W - 2 * M, mapH = H - zag - pod;
    const R = slkRazmjera(sirM, visM, mapW, mapH), mPoPx = R * 0.0254 / SLK_DPI;
    const px = (lat, lon) => [mapX + mapW / 2 + (lon - c[1]) * kx / mPoPx, mapY + mapH / 2 - (lat - c[0]) * ky / mPoPx];
    const ll = (x, y) => [c[0] - (y - mapY - mapH / 2) * mPoPx / ky, c[1] + (x - mapX - mapW / 2) * mPoPx / kx];

    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.save(); g.beginPath(); g.rect(mapX, mapY, mapW, mapH); g.clip();
    g.fillStyle = '#f4f7f2'; g.fillRect(mapX, mapY, mapW, mapH);

    // podloga s karte; bez nje reljef: sjenčenje + izohipse iz lokalnog DEM-a (samo ako pokriva centar)
    let podl = null;
    if (opis.podloga !== false) { try { podl = await crtajPodlogu(g, mapX, mapY, mapW, mapH, mPoPx, c, px); } catch (e) { podl = null; } }
    let relj = null;
    try {
      if (!podl && window.USFDem && USFDem.uObuhvatu && USFDem.uObuhvatu(await USFDem.ucitaj(), c[0], c[1])) {
        const d = await USFDem.ucitaj(), korak = 8, nx = Math.ceil(mapW / korak) + 1, ny = Math.ceil(mapH / korak) + 1, z = new Float64Array(nx * ny).fill(NaN);
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const q = ll(mapX + i * korak, mapY + j * korak), h = USFDem.visina(d, q[0], q[1]); if (h != null && Number.isFinite(h)) z[j * nx + i] = h; }
        const img = g.createImageData(mapW, mapH), mK = korak * mPoPx;
        for (let j = 0; j + 1 < ny; j++) for (let i = 0; i + 1 < nx; i++) {
          const a = z[j * nx + i], b = z[j * nx + i + 1], e = z[(j + 1) * nx + i]; if (![a, b, e].every(Number.isFinite)) continue;
          const dx = (b - a) / mK, dy = (a - e) / mK, nrm = Math.hypot(dx, dy, 1), osv = (-dx * -0.5 + -dy * 0.5 + 0.7071) / nrm / 1.2247; // svjetlo SZ, 45°
          const s = Math.max(0, Math.min(1, osv)), v = Math.round(255 - (1 - s) * 70);
          for (let y = j * korak; y < Math.min(mapH, (j + 1) * korak); y++) for (let x = i * korak; x < Math.min(mapW, (i + 1) * korak); x++) { const o = (y * mapW + x) * 4; img.data[o] = v - 6; img.data[o + 1] = v; img.data[o + 2] = v - 10; img.data[o + 3] = 255; }
        }
        const tmp = document.createElement('canvas'); tmp.width = mapW; tmp.height = mapH; tmp.getContext('2d').putImageData(img, 0, 0);
        g.globalAlpha = 0.55; g.drawImage(tmp, mapX, mapY); g.globalAlpha = 1;
        let mn = Infinity, mx = -Infinity; for (const v of z) if (Number.isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
        const iv = slkInterval(mx - mn);
        g.lineCap = 'round';
        for (const [x1, y1, x2, y2, h] of slkIzohipse(z, nx, ny, iv)) {
          const glavna = h % (iv * 5) === 0;
          g.strokeStyle = glavna ? 'rgba(146,84,30,.75)' : 'rgba(170,110,50,.45)'; g.lineWidth = glavna ? 2.2 : 1.1;
          g.beginPath(); g.moveTo(mapX + x1 * korak, mapY + y1 * korak); g.lineTo(mapX + x2 * korak, mapY + y2 * korak); g.stroke();
        }
        relj = { iv, mn: Math.round(mn), mx: Math.round(mx) };
      }
    } catch (e) {}

    const put = ring => { g.beginPath(); ring.forEach((q, i) => { const [x, y] = px(q[0], q[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); };
    // poligoni: prvo okolni (tanko), pa glavni
    for (const p of opis.poligoni.slice().sort((a, b) => (a.glavni ? 1 : 0) - (b.glavni ? 1 : 0))) {
      put(p.ring); g.closePath();
      if (p.ispuna) { g.fillStyle = p.ispuna; g.fill('evenodd'); }
      // granica glavnog poligona dobija bijeli rub — ne gubi se na tamnoj/šarenoj podlozi
      if (p.glavni) { g.setLineDash([]); g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = (p.sirina || 2) + (p.sirina >= 8 ? 8 : 6); g.lineJoin = 'round'; g.stroke(); }
      g.setLineDash(p.crta || []); g.strokeStyle = p.boja || '#334155'; g.lineWidth = p.sirina || 2; g.lineJoin = 'round'; g.stroke(); g.setLineDash([]);
    }
    // linije s tamnim rubom
    for (const l of opis.linije || []) {
      put(l.geo); g.lineJoin = 'round'; g.lineCap = 'round';
      if (!l.bezRuba) { g.strokeStyle = 'rgba(15,23,42,.85)'; g.lineWidth = (l.sirina || 4) + 3.5; g.setLineDash([]); g.stroke(); }
      put(l.geo); g.strokeStyle = l.boja || '#f59e0b'; g.lineWidth = l.sirina || 4; g.setLineDash(l.crta || []); g.stroke(); g.setLineDash([]);
    }
    // natpisi: poligoni u centru, linije na dnu (van kraja) i vrhu; bez preklapanja
    const zauzeto = [], sijece = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    const natpis = (t, x, y, vel, boja, okvir) => {
      g.font = `700 ${vel}px ${FONT}`; const w = g.measureText(t).width + 14, h = vel + 10, box = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
      if (zauzeto.some(z => sijece(z, box))) return false; zauzeto.push(box);
      g.fillStyle = okvir || 'rgba(255,255,255,.88)'; g.strokeStyle = boja; g.lineWidth = 2;
      g.beginPath(); if (g.roundRect) g.roundRect(box[0], box[1], w, h, 6); else g.rect(box[0], box[1], w, h); g.fill(); g.stroke();
      g.fillStyle = '#0f172a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, x, y + 1); return true;
    };
    for (const l of opis.linije || []) {
      if (!l.oznaka || l.geo.length < 2) continue;
      for (const [kraj, susj, t] of [[l.geo[0], l.geo[1], l.oznaka], [l.geo[l.geo.length - 1], l.geo[l.geo.length - 2], l.oznakaVrh]]) {
        if (!t) continue;
        const [x, y] = px(kraj[0], kraj[1]), [sx, sy] = px(susj[0], susj[1]), d = Math.hypot(x - sx, y - sy) || 1;
        for (const r of [26, 46, 66]) if (natpis(t, x + (x - sx) / d * r, y + (y - sy) / d * r, 22, l.boja || '#f59e0b')) break;
      }
    }
    for (const p of opis.poligoni) if (p.natpis && !cista) {
      const xs = p.ring.map(q => px(q[0], q[1])), cx = xs.reduce((a, q) => a + q[0], 0) / xs.length, cy = xs.reduce((a, q) => a + q[1], 0) / xs.length;
      natpis(p.natpis, cx, cy, p.glavni ? 26 : 19, p.boja || '#334155', p.glavni ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,.7)');
    }
    g.restore();
    g.strokeStyle = '#0f172a'; g.lineWidth = 3; g.strokeRect(mapX, mapY, mapW, mapH);

    // sjever
    const nx0 = mapX + mapW - 60, ny0 = mapY + 70;
    g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(nx0, ny0, 44, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0f172a'; g.beginPath(); g.moveTo(nx0, ny0 - 34); g.lineTo(nx0 + 16, ny0 + 18); g.lineTo(nx0, ny0 + 8); g.lineTo(nx0 - 16, ny0 + 18); g.closePath(); g.fill();
    if (!cista) { g.font = `800 22px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('S', nx0, ny0 + 32); }
    if (cista && opis.natpisGore) {
      g.font = `800 56px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      const w = g.measureText(opis.natpisGore).width + 56, x0 = mapX + mapW / 2 - w / 2, y0 = mapY + 22;
      g.fillStyle = 'rgba(255,255,255,.92)'; g.beginPath(); if (g.roundRect) g.roundRect(x0, y0, w, 84, 14); else g.rect(x0, y0, w, 84); g.fill();
      g.fillStyle = '#0f172a'; g.fillText(opis.natpisGore, mapX + mapW / 2, y0 + 44);
    }

    if (!cista) {
      // zaglavlje
      g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = '#0f172a';
      let nx = M;
      if (opis.ikona && typeof USFIkPath === 'function' && USFIkPath(opis.ikona)) { // ikona iz ikone.js (Path2D), ne emoji
        g.save(); g.translate(M, 36); g.scale(2.1, 2.1); g.lineWidth = 2; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#b45309';
        g.stroke(new Path2D(USFIkPath(opis.ikona))); g.restore(); nx = M + 62;
      }
      g.font = `800 44px ${FONT}`; g.fillText(opis.naslov || 'Karta', nx, 78);
      g.font = `500 24px ${FONT}`; g.fillStyle = '#475569'; g.fillText(opis.podnaslov || '', M, 118);
      g.textAlign = 'right'; g.fillStyle = '#0f172a'; g.font = `800 40px ${FONT}`; g.fillText('R 1:' + fmt(R), W - M, 78);
      g.font = `500 20px ${FONT}`; g.fillStyle = '#475569'; g.fillText('razmjera pri štampi A4' + (polozeno ? ' (položeno)' : ''), W - M, 112);

      // podnožje: mjerilo, legenda, podaci
      const fy = mapY + mapH + 46, duz = slkMjerilo(mPoPx, mapW * 0.3), dpx = duz / mPoPx;
      g.textAlign = 'left';
      for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#0f172a'; g.fillRect(M + i * dpx / 4, fy, dpx / 4, 14); }
      g.strokeStyle = '#0f172a'; g.lineWidth = 2; g.strokeRect(M, fy, dpx, 14);
      g.fillStyle = '#0f172a'; g.font = `600 20px ${FONT}`; g.textBaseline = 'top';
      g.fillText('0', M - 6, fy + 22); g.textAlign = 'right'; g.fillText(duz >= 1000 ? fmt(duz / 1000, duz % 1000 ? 1 : 0) + ' km' : fmt(duz) + ' m', M + dpx + 12, fy + 22);
      g.textAlign = 'left';
      let ly = fy + 64, lx = M;
      const leg = (opis.legenda || []).slice();
      if (relj) leg.push({ boja: 'rgba(146,84,30,.8)', t: 'izohipse ' + relj.iv + ' m (' + relj.mn + '–' + relj.mx + ' m)', tip: 'linija' });
      g.font = `500 21px ${FONT}`; g.textBaseline = 'middle';
      for (const s of leg) {
        const w = g.measureText(s.t).width + 70;
        if (lx + w > W - M) { lx = M; ly += 36; }
        if (s.tip === 'ploha') { g.fillStyle = s.boja; g.fillRect(lx, ly - 10, 34, 20); g.strokeStyle = '#334155'; g.lineWidth = 1; g.strokeRect(lx, ly - 10, 34, 20); }
        else { g.strokeStyle = s.boja; g.lineWidth = 5; g.setLineDash(s.tip === 'isprek' ? [10, 6] : []); g.beginPath(); g.moveTo(lx, ly); g.lineTo(lx + 34, ly); g.stroke(); g.setLineDash([]); }
        g.fillStyle = '#0f172a'; g.fillText(s.t, lx + 44, ly); lx += w;
      }
      ly += 44; g.fillStyle = '#334155'; g.font = `500 21px ${FONT}`;
      (opis.info || []).forEach((t, i) => g.fillText(t, M, ly + i * 30));
      g.textAlign = 'right'; g.fillStyle = '#94a3b8'; g.font = `500 18px ${FONT}`;
      g.fillText('Grmeč Navigator · ' + new Date().toLocaleDateString('bs-BA') + (podl && podl.imena.length ? ' · podloga: ' + podl.imena.join(', ') : '') + (relj ? ' · DEM Copernicus 30 m' : ''), W - M, H - 30);
    }

    return await new Promise((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('slika nije napravljena'))), 'image/png'));
  }
  const imeFajla = opis => (opis.ime || opis.naslov || 'karta').replace(/[^\w\-čćžšđČĆŽŠĐ]+/g, '_').slice(0, 60) + '.png';
  async function podijeli(opis) {
    try {
      showToast('🖼 Pravim sliku…');
      const b = await napravi(opis);
      _izvozFajl(imeFajla(opis), b, 'image/png', opis.naslov || 'Karta');
    } catch (e) { showToast('⚠ Slika: ' + e.message); }
  }
  // Sprema odmah u Downloads: APK preko AndroidDownload (MediaStore), desktop/PWA preko <a download>.
  async function sacuvaj(opis) {
    try {
      showToast('🖼 Pravim sliku…');
      const b = await napravi(opis), ime = imeFajla(opis);
      if (window.AndroidDownload && AndroidDownload.save) {
        const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
        AndroidDownload.save(ime, url);
        return;
      }
      const u = URL.createObjectURL(b), a = document.createElement('a');
      a.href = u; a.download = ime; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 10000);
      showToast('✅ Sačuvano u Downloads: ' + ime);
    } catch (e) { showToast('⚠ Slika: ' + e.message); }
  }
  window.USFSlika = { napravi, podijeli, sacuvaj };
})();
