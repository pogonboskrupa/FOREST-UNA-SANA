// Inventura šuma: učitane tačke (KML/KMZ) su centri primjernih ploha s koncentričnim krugovima.
// Svaka ploha ima centar iz fajla (tačna koordinata) i krug radijusa R (zadano 25 m) + opcione
// unutrašnje krugove. „Radi na krugu” prati GPS i stalno pokazuje udaljenost od centra, smjer
// prema centru i da li si unutar R — granica plohe se vidi i bez gledanja u kartu.
// localStorage `usf_inventura`: { r, unutra: [m…], skupovi: [{ id, naziv, vis, tacke: [{ id, n, la, lo, ext, st, t }] }] }.
(function () {
  'use strict';
  const KLJUC = 'usf_inventura';
  const R_ZAD = 25, GRANICA_M = 1.5; // ± oko R se smatra „na granici”
  const MIN_Z_KRUG = 14, MAX_KRUGOVA = 400, MAX_NATPISA = 300;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const toast = t => { if (typeof showToast === 'function') showToast(t); };
  // decimalni zarez ručno — toLocaleString('bs') na nekim WebView-ima vraća tačku
  const fmtM = m => (m >= 1000 ? (m / 1000).toFixed(2).replace('.', ',') + ' km' : (m < 100 ? m.toFixed(1).replace('.', ',') : String(Math.round(m))) + ' m');

  // ── Geodezija (sferna Zemlja; na 25 m greška je ispod centimetra) ──
  const RZ = 6371008.8, rad = x => x * Math.PI / 180, deg = x => x * 180 / Math.PI;
  function udaljenost(la1, lo1, la2, lo2) {
    const dLa = rad(la2 - la1), dLo = rad(lo2 - lo1);
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(dLo / 2) ** 2;
    return 2 * RZ * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function azimut(la1, lo1, la2, lo2) {
    const y = Math.sin(rad(lo2 - lo1)) * Math.cos(rad(la2));
    const x = Math.cos(rad(la1)) * Math.sin(rad(la2)) - Math.sin(rad(la1)) * Math.cos(rad(la2)) * Math.cos(rad(lo2 - lo1));
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }
  const STRANE = ['S', 'SI', 'I', 'JI', 'J', 'JZ', 'Z', 'SZ'];
  const strana = az => STRANE[Math.round(az / 45) % 8];
  function krugTacke(la, lo, r, n = 72) {
    const d = r / RZ, la1 = rad(la), lo1 = rad(lo), out = [];
    for (let i = 0; i <= n; i++) {
      const b = 2 * Math.PI * i / n;
      const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
      const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
      out.push([deg(la2), deg(lo2)]);
    }
    return out;
  }
  function tackaNaKrugu(la, lo, r, az) {
    const d = r / RZ, la1 = rad(la), b = rad(az);
    const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
    return [deg(la2), deg(rad(lo) + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2)))];
  }
  // Položaj u odnosu na plohu radijusa r: unutra / na granici (± GRANICA_M) / vani
  function stanje(d, r) { return d < r - GRANICA_M ? 'unutra' : d <= r + GRANICA_M ? 'granica' : 'vani'; }
  // „7; 12,5” / „7, 12.62” → [7, 12.5, 12.62]: razdvaja „;”, razmak ili „, ” (zarez bez razmaka = decimalni); samo 0 < x < R
  function parsirajKrugove(txt, r) {
    return [...new Set(String(txt || '').trim().split(/\s*;\s*|,\s+|\s+/).map(x => parseFloat(String(x).replace(',', '.'))).filter(x => Number.isFinite(x) && x > 0 && x < r))].sort((a, b) => a - b);
  }

  // ── Stanje ──
  function citaj() {
    try { const v = JSON.parse(localStorage.getItem(KLJUC) || 'null'); if (v && Array.isArray(v.skupovi)) return { r: R_ZAD, unutra: [], odjeli: [], aktOdj: null, ...v }; } catch (e) {}
    return { r: R_ZAD, unutra: [], skupovi: [], odjeli: [], aktOdj: null };
  }
  let S = citaj();
  function pisi() { try { localStorage.setItem(KLJUC, JSON.stringify(S)); return true; } catch (e) { toast('⚠ Nema mjesta za spremanje inventure'); return false; } }
  // Filter poligonom je privremen (samo u memoriji): krugovi izvan nacrtanog poligona se ne crtaju niti hvataju dodir.
  let filt = null;
  function uPoligonu(la, lo, ring) {
    let u = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ai, oi] = ring[i], [aj, oj] = ring[j];
      if ((ai > la) !== (aj > la) && lo < (oj - oi) * (la - ai) / (aj - ai) + oi) u = !u;
    }
    return u;
  }
  const sveTacke = () => S.skupovi.filter(s => s.vis !== false).flatMap(s => s.tacke.map(t => ({ t, s }))).filter(x => !filt || uPoligonu(x.t.la, x.t.lo, filt));
  // ── Odjeli i brojevi krugova: korisnik otvori odjel (u kojem snima) pa krugovima daje brojeve redom kojim ide;
  //    put kretanja = brojevi po redu (strelice između uzastopnih krugova). t.odj = id odjela, t.br = broj (tekst), t.bt = kad je dat.
  const ODJ_BOJE = ['#38bdf8', '#f472b6', '#a3e635', '#fb923c', '#c084fc', '#facc15', '#2dd4bf', '#f87171'];
  const odjel = id => (S.odjeli || []).find(o => o.id === id);
  const brBroj = b => { const n = parseFloat(String(b).replace(',', '.')); return Number.isFinite(n) ? n : Infinity; };
  const poBroju = (a, b) => brBroj(a.br) - brBroj(b.br) || String(a.br).localeCompare(String(b.br), 'bs', { numeric: true });
  const krugoviOdjela = oid => S.skupovi.flatMap(s => s.tacke).filter(t => t.odj === oid && t.br != null && t.br !== '').sort(poBroju);
  function sljedeciBroj(oid) { const n = krugoviOdjela(oid).map(t => brBroj(t.br)).filter(Number.isFinite); return n.length ? Math.floor(Math.max(...n)) + 1 : 1; }
  const nadjiT = id => { for (const s of S.skupovi) { const t = s.tacke.find(x => x.id === id); if (t) return { t, s }; } return null; };
  const gps = () => (typeof lastP !== 'undefined' && lastP && Number.isFinite(lastP.la) ? lastP : null);

  // ── Učitavanje KML/KMZ: tačke (i centri poligona ako fajl ima samo krugove-poligone) ──
  function tackeIzKml(txt) {
    const doc = typeof _kmlParseDoc === 'function' ? _kmlParseDoc(txt) : new DOMParser().parseFromString(txt, 'text/xml');
    const out = [];
    const koord = s => (s || '').trim().split(/\s+/).map(c => c.split(',').map(Number)).filter(p => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    doc.querySelectorAll('Placemark').forEach((pm, i) => {
      const ime = pm.querySelector('name')?.textContent?.trim() || '';
      const ext = typeof _parseKmlExtData === 'function' ? _parseKmlExtData(pm) : {};
      const tc = [...pm.querySelectorAll('Point coordinates')].map(c => koord(c.textContent)[0]).filter(Boolean);
      if (!tc.length) {
        // poligon (npr. već nacrtan krug): centar = prosjek tačaka vanjskog prstena bez zadnje (ponovljene)
        const pr = koord(pm.querySelector('outerBoundaryIs coordinates, Polygon coordinates')?.textContent);
        if (pr.length >= 3) { const p = pr.slice(0, -1); tc.push([p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length]); }
      }
      const oznaka = ime || ext.BROJ || ext.Broj || ext.broj || ext.ID || ext.id || ext.PLOHA || ext.ploha || ('Ploha ' + (i + 1));
      tc.forEach((p, j) => out.push({ id: uid(), n: String(oznaka) + (tc.length > 1 ? '·' + (j + 1) : ''), la: p[1], lo: p[0], ext }));
    });
    return out;
  }
  async function ucitaj(e) {
    const files = [...(e.target.files || [])]; e.target.value = '';
    for (const f of files) {
      try {
        let txt;
        if (/\.kmz$/i.test(f.name)) { if (typeof _kmzExtractKml !== 'function') throw new Error('KMZ nije podržan'); txt = await _kmzExtractKml(await f.arrayBuffer()); }
        else txt = await f.text();
        const tacke = tackeIzKml(txt);
        if (!tacke.length) { toast('⚠ U „' + f.name + '” nema tačaka'); continue; }
        const naziv = f.name.replace(/\.(kml|kmz)$/i, '');
        const stari = S.skupovi.find(s => s.naziv === naziv);
        if (stari) {
          // ponovni uvoz istog fajla: zadrži stanje snimanja po nazivu plohe
          const st = new Map(stari.tacke.map(t => [t.n, t]));
          stari.tacke = tacke.map(t => { const o = st.get(t.n); return o ? { ...t, st: o.st, t: o.t } : t; });
        } else S.skupovi.push({ id: uid(), naziv, vis: true, tacke });
        if (!pisi()) return;
        toast('✅ ' + naziv + ': ' + tacke.length + (tacke.length === 1 ? ' ploha' : ' ploha'));
        zumSkup((stari || S.skupovi[S.skupovi.length - 1]).id, false);
      } catch (err) { toast('⚠ ' + f.name + ': ' + (err.message || err)); }
    }
    crtaj(); render();
  }

  // ── Karta ──
  let grp = null, ren = null, natpisi = null, aktivni = null, aktGrp = null, tajmer = 0;
  function pripremi() {
    if (grp || typeof map === 'undefined') return !!grp;
    map.createPane('inventuraPane'); map.getPane('inventuraPane').style.zIndex = '416'; map.getPane('inventuraPane').style.pointerEvents = 'none';
    ren = L.canvas({ pane: 'inventuraPane', padding: 0.5 });
    grp = L.layerGroup().addTo(map); natpisi = L.layerGroup().addTo(map); aktGrp = L.layerGroup().addTo(map);
    map.on('moveend zoomend', crtaj);
    return true;
  }
  const BOJA = t => (t.st === 'snimljeno' ? '#22c55e' : '#f97316');
  function crtaj() {
    if (!pripremi()) return;
    grp.clearLayers(); natpisi.clearLayers();
    const sve = sveTacke(); if (!sve.length) return;
    const z = map.getZoom(), gr = map.getBounds().pad(0.3), r = S.r;
    let nK = 0, nN = 0;
    for (const { t } of sve) {
      const ll = L.latLng(t.la, t.lo), c = BOJA(t), akt = aktivni === t.id;
      if (z >= MIN_Z_KRUG && nK < MAX_KRUGOVA && gr.contains(ll) && !akt) {
        nK++;
        const k = krugTacke(t.la, t.lo, r);
        L.polygon(k, { renderer: ren, pane: 'inventuraPane', color: '#ffffff', weight: 5, opacity: 0.7, fill: false, interactive: false }).addTo(grp);
        L.polygon(k, { renderer: ren, pane: 'inventuraPane', color: c, weight: 2.5, opacity: 0.95, fillColor: c, fillOpacity: 0.07, interactive: false }).addTo(grp);
        S.unutra.forEach(ru => L.polygon(krugTacke(t.la, t.lo, ru, 48), { renderer: ren, pane: 'inventuraPane', color: c, weight: 1.5, opacity: 0.8, dashArray: '5,5', fill: false, interactive: false }).addTo(grp));
      }
      if (!akt) L.circleMarker(ll, { renderer: ren, pane: 'inventuraPane', radius: z >= MIN_Z_KRUG ? 5 : 4, color: '#ffffff', weight: 2, fillColor: c, fillOpacity: 1, interactive: false }).addTo(grp);
      // natpis = SAMO broj koji je korisnik dao (nazivi iz KML-a se ne prikazuju)
      if (t.br != null && t.br !== '' && z >= 13 && nN < MAX_NATPISA && gr.contains(ll)) {
        nN++;
        const o = odjel(t.odj);
        L.marker(ll, { pane: 'inventuraPane', interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<span class="inv-br" style="--c:${o ? o.boja : '#facc15'}">${esc(t.br)}</span>` }) }).addTo(natpisi);
      }
    }
    crtajPut();
    crtajAktivni();
  }
  // Put kretanja po odjelu: linija između uzastopno obrojčanih krugova i strelica na sredini svakog odsječka
  function crtajPut() {
    if (map.getZoom() < 13) return;
    const vidljivi = new Set(sveTacke().map(x => x.t.id)), gr = map.getBounds().pad(0.5);
    (S.odjeli || []).forEach(o => {
      const k = krugoviOdjela(o.id).filter(t => vidljivi.has(t.id));
      for (let i = 1; i < k.length; i++) {
        const a = k[i - 1], b = k[i];
        if (!gr.contains([a.la, a.lo]) && !gr.contains([b.la, b.lo])) continue;
        L.polyline([[a.la, a.lo], [b.la, b.lo]], { renderer: ren, pane: 'inventuraPane', color: '#111827', weight: 6, opacity: 0.45, interactive: false }).addTo(grp);
        L.polyline([[a.la, a.lo], [b.la, b.lo]], { renderer: ren, pane: 'inventuraPane', color: o.boja, weight: 3, opacity: 0.95, interactive: false }).addTo(grp);
        const pa = map.latLngToLayerPoint([a.la, a.lo]), pb = map.latLngToLayerPoint([b.la, b.lo]);
        if (pa.distanceTo(pb) < 40) continue; // prekratko za strelicu na ovom zumu
        const ug = Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180 / Math.PI;
        L.marker([(a.la + b.la) / 2, (a.lo + b.lo) / 2], { pane: 'inventuraPane', interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<span class="inv-str" style="--c:${o.boja};transform:translate(-50%,-50%) rotate(${ug.toFixed(0)}deg)"></span>` }) }).addTo(natpisi);
      }
    });
  }
  // Aktivna ploha: debeo krug, unutrašnji krugovi s oznakama, križ u centru i linija od mene do centra
  function crtajAktivni() {
    if (!aktGrp) return;
    aktGrp.clearLayers();
    const x = aktivni && nadjiT(aktivni); if (!x) return;
    const { t } = x, r = S.r, c = '#facc15';
    const k = krugTacke(t.la, t.lo, r, 120);
    L.polygon(k, { renderer: ren, pane: 'inventuraPane', color: '#111827', weight: 8, opacity: 0.55, fill: false, interactive: false }).addTo(aktGrp);
    L.polygon(k, { renderer: ren, pane: 'inventuraPane', color: c, weight: 4, opacity: 1, fillColor: c, fillOpacity: 0.1, interactive: false }).addTo(aktGrp);
    const radijusi = [...S.unutra, r];
    radijusi.forEach((ru, i) => {
      if (ru !== r) L.polygon(krugTacke(t.la, t.lo, ru, 72), { renderer: ren, pane: 'inventuraPane', color: c, weight: 2, opacity: 0.95, dashArray: '6,5', fill: false, interactive: false }).addTo(aktGrp);
      // oznake na različitim smjerovima (vanjski krug istok, unutrašnji prema jugoistoku) da se ne preklapaju
      const [la, lo] = tackaNaKrugu(t.la, t.lo, ru, 90 + (radijusi.length - 1 - i) * 40);
      L.marker([la, lo], { pane: 'inventuraPane', interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<span class="inv-r">${String(ru).replace('.', ',')} m</span>` }) }).addTo(aktGrp);
    });
    L.marker([t.la, t.lo], { pane: 'inventuraPane', interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: '<span class="inv-centar"></span>' }) }).addTo(aktGrp);
    const p = gps();
    if (p) L.polyline([[p.la, p.lo], [t.la, t.lo]], { renderer: ren, pane: 'inventuraPane', color: '#ffffff', weight: 3, opacity: 0.95, dashArray: '2,7', lineCap: 'round', interactive: false }).addTo(aktGrp);
  }

  const oznaka = t => { const o = odjel(t.odj); return t.br != null && t.br !== '' ? (o ? o.naziv + ' · ' : '') + 'krug ' + t.br : 'Krug ' + t.n; };
  // ── Rad na krugu: traka s udaljenošću od centra (osvježava se svake sekunde iz GPS-a) ──
  function traka() {
    let el = document.getElementById('inv-rad');
    if (!el) {
      el = document.createElement('div'); el.id = 'inv-rad'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-a]'); if (!b) return;
        const a = b.dataset.a;
        if (a === 'kraj') zavrsi();
        else if (a === 'snim') { snimljeno(aktivni); osvjezi(); }
        else if (a === 'cen') { const x = nadjiT(aktivni); if (x) map.setView([x.t.la, x.t.lo], Math.max(map.getZoom(), 18)); }
        else if (a === 'sljed') sljedeca();
      });
    }
    return el;
  }
  function osvjezi() {
    const x = aktivni && nadjiT(aktivni), el = document.getElementById('inv-rad');
    if (!x || !el) return;
    const { t } = x, r = S.r, p = gps();
    let glavno, klasa = 'ceka', smjer = '', dod = '';
    if (!p) { glavno = '<b class="ir-d">…</b><span class="ir-st">čekam GPS signal</span>'; }
    else {
      const d = udaljenost(p.la, p.lo, t.la, t.lo), st = stanje(d, r), az = azimut(p.la, p.lo, t.la, t.lo);
      klasa = st;
      const opis = st === 'unutra' ? `✓ unutar plohe · do granice ${fmtM(r - d)}` : st === 'granica' ? '◐ na granici plohe' : `✕ izvan plohe · ${fmtM(d - r)} dalje od granice`;
      const h = typeof _compassHeading !== 'undefined' && _compassHeading != null ? _compassHeading : null;
      const rot = h != null ? az - h : az; // strelica gleda sjever; s kompasom strelica pokazuje stvarni smjer; bez njega = azimut od sjevera
      smjer = `<svg class="ir-str" viewBox="0 0 24 24" style="transform:rotate(${rot.toFixed(0)}deg)" aria-hidden="true"><path d="M12 2 20 21 12 16.5 4 21z"/></svg>`;
      glavno = `<b class="ir-d">${fmtM(d)}</b><span class="ir-st">${opis}</span>`;
      dod = `<small>Centar: ${Math.round(az)}° ${strana(az)}${h == null ? ' (od sjevera)' : ''} · GPS ±${Math.round(p.ac || 0)} m${S.unutra.length ? ' · ' + S.unutra.map(ru => (d <= ru ? '●' : '○') + ' ' + String(ru).replace('.', ',')).join('  ') : ''}</small>`;
    }
    el.className = 'inv-rad ' + klasa;
    el.innerHTML = `<div class="ir-gl"><span class="ir-n">◎ ${esc(oznaka(t))} <em>R ${r} m</em></span>${smjer}</div>
      <div class="ir-sr">${glavno}</div>${dod}
      <div class="ir-akc"><button data-a="cen">🎯 Centar</button><button data-a="snim" class="${t.st === 'snimljeno' ? 'ok' : ''}">${t.st === 'snimljeno' ? '✓ Snimljeno' : '☐ Snimljeno'}</button><button data-a="sljed">⏭ Sljedeća</button><button data-a="kraj">✕</button></div>`;
    crtajAktivni();
  }
  function radi(id) {
    const x = nadjiT(id); if (!x) return;
    if (x.s.vis === false) x.s.vis = true;
    aktivni = id; pisi();
    if (typeof gpsOn !== 'undefined' && !gpsOn && typeof startGPS === 'function') startGPS();
    try { map.closePopup(); } catch (e) {}
    if (typeof switchMainTab === 'function') switchMainTab('karta');
    traka(); document.body.classList.add('inv-on');
    clearInterval(tajmer); tajmer = setInterval(osvjezi, 1000);
    const p = gps();
    // obje tačke (ja i centar) u kadru, ili sam krug ako sam daleko/bez GPS-a
    const b = L.latLngBounds(krugTacke(x.t.la, x.t.lo, S.r, 8));
    if (p && udaljenost(p.la, p.lo, x.t.la, x.t.lo) < 400) b.extend([p.la, p.lo]);
    map.fitBounds(b, { padding: [60, 60], maxZoom: 19 });
    crtaj(); osvjezi();
  }
  function zavrsi() {
    aktivni = null; clearInterval(tajmer); tajmer = 0;
    document.getElementById('inv-rad')?.remove(); document.body.classList.remove('inv-on');
    crtaj(); render();
  }
  function snimljeno(id) {
    const x = nadjiT(id); if (!x) return;
    x.t.st = x.t.st === 'snimljeno' ? null : 'snimljeno'; x.t.t = Date.now();
    pisi(); crtaj(); render();
    toast(x.t.st ? '✓ ' + oznaka(x.t) + ' snimljen' : '↺ ' + oznaka(x.t) + ' vraćen na nesnimljeno');
  }
  // najbliža nesnimljena ploha (od GPS-a, inače od centra karte), bez trenutne
  function najbliza(osim) {
    const p = gps(), c = p ? { la: p.la, lo: p.lo } : (() => { const m = map.getCenter(); return { la: m.lat, lo: m.lng }; })();
    let naj = null, nd = Infinity;
    for (const { t } of sveTacke()) { if (t.id === osim || t.st === 'snimljeno') continue; const d = udaljenost(c.la, c.lo, t.la, t.lo); if (d < nd) { nd = d; naj = t; } }
    return naj;
  }
  function sljedeca() { const t = najbliza(aktivni); if (t) radi(t.id); else toast('✓ Sve plohe su snimljene'); }

  // ── Obrojčavanje: dodir na krug u načinu „obrojči” odmah pita broj ──
  let numOn = false;
  function predlogOdjela(la, lo) {
    // najmanji KML poligon ispod kruga (npr. Granice taksacije) → „Odjel 12 · a”
    let naj = null, np = Infinity;
    try {
      (typeof kmlLs !== 'undefined' ? kmlLs : []).forEach(k => _kmlObjekti(k).forEach(l => {
        if (!l._kmlIsPolygon) return;
        const r = _kmlPrsten(l).map(x => [x.lat, x.lng]);
        if (r.length < 3 || !uPoligonu(la, lo, r)) return;
        const b = l.getBounds(), pov = (b.getNorth() - b.getSouth()) * (b.getEast() - b.getWest());
        if (pov < np) { np = pov; naj = l; }
      }));
    } catch (e) {}
    if (!naj) return '';
    const o = typeof _odjelOznaka === 'function' ? _odjelOznaka(naj, naj._kmlName || '') : (naj._kmlName || '');
    return o ? (/^odjel/i.test(o) ? o : 'Odjel ' + o) : '';
  }
  async function noviOdjel(t) {
    const pr = t ? predlogOdjela(t.la, t.lo) : '';
    const v = typeof _dlgPrompt === 'function' ? await _dlgPrompt('Odjel u kojem snimaš krugove (npr. „Odjel 12”). Krugovima ćeš davati brojeve redom kojim ideš.', pr || 'Odjel ', { title: '📋 Novi odjel', okLabel: 'Napravi' }) : prompt('Naziv odjela', pr || 'Odjel ');
    const naziv = String(v == null ? '' : v).trim(); if (!naziv) return null;
    const o = { id: uid(), naziv: naziv.slice(0, 40), boja: ODJ_BOJE[(S.odjeli || []).length % ODJ_BOJE.length], t: Date.now() };
    S.odjeli = [...(S.odjeli || []), o]; S.aktOdj = o.id; pisi();
    return o;
  }
  async function obrojci(id) {
    const x = id && nadjiT(id);
    try { map.closePopup(); } catch (e) {}
    if (!odjel(S.aktOdj)) { if (!await noviOdjel(x && x.t)) return; }
    numOn = true; numTraka();
    if (typeof switchMainTab === 'function') switchMainTab('karta');
    if (x) await imenuj(x.t);
  }
  async function imenuj(t) {
    const o = odjel(S.aktOdj); if (!o) return;
    const sug = t.odj === o.id && t.br != null && t.br !== '' ? t.br : sljedeciBroj(o.id);
    const v = typeof _dlgPrompt === 'function' ? await _dlgPrompt('Broj kruga u „' + o.naziv + '” (prazno = ukloni broj)', String(sug), { title: '🔢 Broj kruga', okLabel: 'Spremi' }) : prompt('Broj kruga', String(sug));
    if (v == null) return;
    const br = String(v).trim().slice(0, 12);
    if (!br) { t.br = null; t.odj = null; t.bt = null; pisi(); crtaj(); render(); numTraka(); toast('Broj uklonjen'); return; }
    const isti = krugoviOdjela(o.id).find(q => q.id !== t.id && String(q.br) === br);
    if (isti) {
      const ok = typeof _dlgConfirm === 'function' ? await _dlgConfirm('Broj ' + br + ' već ima drugi krug u „' + o.naziv + '”. Prebaciti broj na ovaj krug?', { okLabel: 'Prebaci' }) : confirm('Prebaciti broj?');
      if (!ok) return;
      isti.br = null; isti.odj = null; isti.bt = null;
    }
    t.odj = o.id; t.br = br; t.bt = Date.now();
    pisi(); crtaj(); render(); numTraka();
  }
  function ponistiZadnji() {
    const o = odjel(S.aktOdj); if (!o) return;
    const k = krugoviOdjela(o.id).sort((a, b) => (b.bt || 0) - (a.bt || 0))[0]; if (!k) return;
    const br = k.br; k.br = null; k.odj = null; k.bt = null; pisi(); crtaj(); render(); numTraka(); toast('↶ Uklonjen broj ' + br);
  }
  function numTraka() {
    let el = document.getElementById('inv-num');
    const o = odjel(S.aktOdj);
    document.body.classList.toggle('inv-num-on', !!(numOn && o));
    if (!numOn || !o) { el?.remove(); return; }
    if (!el) {
      el = document.createElement('div'); el.id = 'inv-num'; document.body.appendChild(el);
      el.addEventListener('click', async e => {
        const b = e.target.closest('[data-a]'); if (!b) return;
        const a = b.dataset.a;
        if (a === 'kraj') { numOn = false; numTraka(); render(); }
        else if (a === 'vrati') ponistiZadnji();
        else if (a === 'odj') { await odaberiOdjel(); numTraka(); }
      });
    }
    const n = krugoviOdjela(o.id).length;
    el.style.setProperty('--c', o.boja);
    el.innerHTML = `<div class="in-gl"><b>🔢 ${esc(o.naziv)}</b><small>dodirni krug → broj · sljedeći <b>${sljedeciBroj(o.id)}</b> · obrojčano ${n}</small></div>
      <div class="in-akc"><button data-a="odj">📋 Odjel</button><button data-a="vrati" ${n ? '' : 'disabled'}>↶</button><button data-a="kraj" class="ok">✓ Gotovo</button></div>`;
  }
  async function odaberiOdjel() {
    const l = S.odjeli || [];
    const akcije = l.map(o => ({ label: (o.id === S.aktOdj ? '✓ ' : '') + o.naziv + ' (' + krugoviOdjela(o.id).length + ')', value: o.id })).concat([{ label: '＋ Novi odjel', value: '__novi' }]);
    let v = null;
    if (typeof _dlgActions === 'function') { const i = await _dlgActions('Odjel za obrojčavanje', akcije.map(a => ({ label: a.label }))); v = i != null && i >= 0 ? akcije[i] && akcije[i].value : null; }
    if (v === '__novi') await noviOdjel(null); else if (v) { S.aktOdj = v; pisi(); }
    crtaj(); render();
  }
  // ── Filter poligonom: nacrtaj obuhvat, ostaju samo krugovi unutra (privremeno) ──
  async function filtriraj() {
    if (!window.USFPrimka || !USFPrimka.nacrtaj) { toast('⚠ Crtanje nije dostupno'); return; }
    if (!map.getPane('primkaPane')) { map.createPane('primkaPane'); map.getPane('primkaPane').style.zIndex = '414'; map.getPane('primkaPane').style.pointerEvents = 'none'; }
    if (typeof switchMainTab === 'function') switchMainTab('karta');
    const ring = await USFPrimka.nacrtaj({ naslov: '◱ Obuhvat — prikazuju se samo krugovi unutra', boja: '#facc15' });
    if (!ring || ring.length < 3) return;
    filt = ring; crtaj(); render(); filtCip();
    toast('◱ Prikazano ' + sveTacke().length + ' krugova u poligonu');
  }
  function bezFiltera() { filt = null; crtaj(); render(); filtCip(); }
  function filtCip() {
    let el = document.getElementById('inv-filt');
    if (!filt) { el?.remove(); return; }
    if (!el) { el = document.createElement('button'); el.id = 'inv-filt'; el.onclick = bezFiltera; document.body.appendChild(el); }
    el.innerHTML = `◱ Samo u poligonu: ${sveTacke().length} krugova <b>✕</b>`;
  }
  // ── Klik na kartu: unutar kruga (ili blizu centra) otvara karticu plohe ──
  function popupHtml(t, s) {
    const p = gps(), d = p ? udaljenost(p.la, p.lo, t.la, t.lo) : null;
    const red = Object.entries(t.ext || {}).filter(([k, v]) => v !== '' && !/^usf_/.test(k)).slice(0, 12).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
    return `<div class="inv-pop"><b>◎ ${esc(oznaka(t))}</b><small>${esc(s.naziv)} · ${esc(t.n)} · R ${S.r} m${t.st === 'snimljeno' ? ' · ✓ snimljeno' : ''}</small>
      <div class="inv-pop-k">${t.la.toFixed(6)}, ${t.lo.toFixed(6)}${d != null ? ` · od tebe ${fmtM(d)}` : ''}</div>${red ? `<table>${red}</table>` : ''}
      <div class="inv-pop-a"><button class="glavno" onclick="USFInv.radi('${t.id}')">◎ Radi na krugu</button><button onclick="USFInv.snimljeno('${t.id}')">${t.st === 'snimljeno' ? '↺ Nije snimljeno' : '✓ Snimljeno'}</button><button class="inv-pop-br" onclick="USFInv.obrojci('${t.id}')">🔢 ${t.br ? 'Promijeni broj' : 'Obrojči krug'}</button></div></div>`;
  }
  function klikIzvor(ll, kp) {
    if (!grp) return [];
    const out = [];
    for (const { t, s } of sveTacke()) {
      const d = udaljenost(ll.lat, ll.lng, t.la, t.lo);
      if (d > S.r * 1.2 && d > 60) continue;
      const otvori = numOn ? () => imenuj(t) : at => L.popup({ maxWidth: 300, minWidth: 220, className: 'pk-pop' }).setLatLng([t.la, t.lo]).setContent(popupHtml(t, s)).openOn(map);
      const cp = map.latLngToContainerPoint([t.la, t.lo]), dpx = Math.hypot(cp.x - kp.x, cp.y - kp.y);
      if (dpx <= 22) out.push({ vrsta: 'tacka', d: dpx, otvori });
      else if (d <= S.r && map.getZoom() >= MIN_Z_KRUG) {
        const rpx = Math.abs(map.latLngToContainerPoint(krugTacke(t.la, t.lo, S.r, 4)[1]).x - cp.x);
        out.push({ vrsta: 'poligon', pov: Math.PI * rpx * rpx, otvori });
      }
    }
    return out;
  }

  // ── Panel ──
  function zumSkup(id, naKartu = true) {
    const s = S.skupovi.find(x => x.id === id); if (!s || !s.tacke.length) return;
    s.vis = true; pisi();
    const b = L.latLngBounds(s.tacke.map(t => [t.la, t.lo]));
    if (naKartu && typeof switchMainTab === 'function') switchMainTab('karta');
    map.fitBounds(b.pad(0.15), { maxZoom: 17 }); crtaj();
  }
  let trazi = '', otvoren = {};
  function render() {
    const el = document.getElementById('inv-body'); if (!el) return;
    const sve = S.skupovi.flatMap(s => s.tacke), sn = sve.filter(t => t.st === 'snimljeno').length;
    const p = gps(), q = trazi.trim().toLowerCase();
    const mc = document.getElementById('mc-stat-inventura'); if (mc) mc.textContent = sve.length ? sn + '/' + sve.length : '';
    const skupovi = S.skupovi.map(s => {
      const n = s.tacke.length, ns = s.tacke.filter(t => t.st === 'snimljeno').length, otv = otvoren[s.id] || q;
      let l = s.tacke.filter(t => !q || t.n.toLowerCase().includes(q) || oznaka(t).toLowerCase().includes(q));
      if (p) l = l.map(t => ({ t, d: udaljenost(p.la, p.lo, t.la, t.lo) })).sort((a, b) => a.d - b.d).map(x => x.t);
      const redovi = l.slice(0, 200).map(t => `<div class="inv-red${t.st === 'snimljeno' ? ' ok' : ''}${aktivni === t.id ? ' akt' : ''}">
          <i></i><div><b>${t.br ? '<em class="inv-rb" style="--c:' + ((odjel(t.odj) || {}).boja || '#facc15') + '">' + esc(t.br) + '</em>' : ''}${esc(t.br ? oznaka(t) : t.n)}</b><small>${t.st === 'snimljeno' ? '✓ snimljeno' : 'nije snimljeno'}${p ? ' · ' + fmtM(udaljenost(p.la, p.lo, t.la, t.lo)) : ''}</small></div>
          <button onclick="USFInv.snimljeno('${t.id}')" aria-label="Snimljeno">${t.st === 'snimljeno' ? '↺' : '✓'}</button><button class="glavno" onclick="USFInv.radi('${t.id}')">◎ Radi</button></div>`).join('');
      return `<section class="ng-card inv-skup${s.vis === false ? ' skriven' : ''}">
        <div class="inv-sk-gl"><div><h3>📍 ${esc(s.naziv)}</h3><small>${n} ploha · ${ns} snimljeno</small></div>
          <label class="ng-switch" aria-label="Prikaži na karti"><input type="checkbox" ${s.vis !== false ? 'checked' : ''} onchange="USFInv.vidljiv('${s.id}', this.checked)"><span></span></label></div>
        <div class="inv-traka"><u style="width:${n ? Math.round(ns / n * 100) : 0}%"></u></div>
        <div class="inv-sk-a"><button onclick="USFInv.zum('${s.id}')">🔍 Na karti</button><button onclick="USFInv.sklopi('${s.id}')">${otv ? '▾' : '▸'} Plohe</button><button class="brisi" onclick="USFInv.obrisi('${s.id}')" aria-label="Ukloni">🗑</button></div>
        ${otv ? `<div class="inv-lista">${redovi || '<small>Nema ploha za pretragu.</small>'}${l.length > 200 ? '<small>Prikazano 200 — suzi pretragu.</small>' : ''}</div>` : ''}</section>`;
    }).join('');
    el.innerHTML = `<section class="ng-card inv-uvod">
        <h3>◎ Koncentrični krugovi</h3>
        <p>Učitaj KML/KMZ s tačkama — svaka tačka je centar primjerne plohe. Na karti se crta centar i krug od ${S.r} m; dodir na krug → „Radi na krugu” stalno pokazuje udaljenost od centra.</p>
        <label class="inv-uc">📂 Učitaj tačke (KML / KMZ)<input type="file" accept=".kml,.kmz" multiple onchange="USFInv.ucitaj(event)" hidden></label>
        ${sve.length ? `<div class="inv-sum"><div><b>${sve.length}</b><small>ploha</small></div><div><b>${sn}</b><small>snimljeno</small></div><div><b>${sve.length - sn}</b><small>preostalo</small></div></div>
        <button class="karta-hub-action" onclick="USFInv.sljedeca()">⏭ Najbliža nesnimljena ploha</button>` : ''}
      </section>
      <section class="ng-card inv-odj"><h3>🔢 Odjeli i redoslijed krugova</h3>
        <p>Napravi odjel u kojem snimaš, pa dodiruj krugove redom kojim ideš — svaki dobija broj, a na karti strelice pokazuju put od kruga do kruga.</p>
        ${(S.odjeli || []).map(o => { const k = krugoviOdjela(o.id); return `<div class="inv-od${o.id === S.aktOdj ? ' akt' : ''}" style="--c:${o.boja}"><i></i><div><b>${esc(o.naziv)}</b><small>${k.length} obrojčano${k.length ? ' · ' + esc(k[0].br) + ' → ' + esc(k[k.length - 1].br) : ''}</small></div>
          <button onclick="USFInv.odjel('nastavi','${o.id}')">▶ Obrojči</button><button onclick="USFInv.odjel('zum','${o.id}')" aria-label="Na karti">🔍</button><button onclick="USFInv.odjel('ime','${o.id}')" aria-label="Preimenuj">✏</button><button class="brisi" onclick="USFInv.odjel('brisi','${o.id}')" aria-label="Obriši odjel">🗑</button></div>`; }).join('')}
        <button class="karta-hub-action" onclick="USFInv.odjel('novi')">＋ Novi odjel i obrojčavanje</button></section>
      <section class="ng-card inv-flt"><h3>◱ Prikaz samo dijela krugova</h3>
        ${filt ? `<p>Prikazano <b>${sveTacke().length}</b> krugova unutar nacrtanog poligona; ostali su privremeno sakriveni.</p><div class="inv-sk-a"><button onclick="USFInv.filtriraj()">✏ Novi poligon</button><button onclick="USFInv.bezFiltera()">✕ Prikaži sve</button></div>`
          : `<p>Nacrtaj poligon (npr. granicu odjela) — ostaju samo krugovi unutar njega, ostali se privremeno sakriju.</p><button class="karta-hub-action" onclick="USFInv.filtriraj()">✏ Nacrtaj poligon</button>`}</section>
      <section class="ng-card inv-post"><h3>⚙ Krugovi</h3>
        <div class="inv-pr"><label>Radijus plohe <input type="number" min="1" max="200" step="0.01" value="${S.r}" onchange="USFInv.postavi('r', this.value)"> m</label></div>
        <div class="inv-pr"><label>Unutrašnji krugovi <input type="text" inputmode="decimal" placeholder="npr. 7; 12,5" value="${S.unutra.join('; ').replace(/\./g, ',')}" onchange="USFInv.postavi('unutra', this.value)"> m</label></div>
        <small>Unutrašnji krugovi se crtaju isprekidano; u traci „Radi na krugu” ● = unutar tog kruga.</small></section>
      ${S.skupovi.length ? `<input class="kh-trazi" type="search" placeholder="🔎 Traži plohu po oznaci…" value="${esc(trazi)}" oninput="USFInv.trazi(this.value)">` : ''}
      ${skupovi || '<div class="ul-prazno"><b>◎</b>Još nema učitanih ploha.</div>'}`;
  }

  window.USFInv = {
    otvori() { if (typeof _openStubPanel === 'function') _openStubPanel('inventura-panel', 'meni'); render(); crtaj(); },
    ucitaj, radi, zavrsi, snimljeno, sljedeca, render, obrojci, filtriraj, bezFiltera,
    async odjel(a, id) {
      const o = odjel(id);
      if (a === 'novi') { if (await noviOdjel(null)) { numOn = true; numTraka(); if (typeof switchMainTab === 'function') switchMainTab('karta'); toast('🔢 Dodiruj krugove redom kojim ideš'); } }
      else if (!o) return;
      else if (a === 'nastavi') { S.aktOdj = o.id; pisi(); numOn = true; numTraka(); const k = krugoviOdjela(o.id); if (typeof switchMainTab === 'function') switchMainTab('karta'); if (k.length) map.setView([k[k.length - 1].la, k[k.length - 1].lo], Math.max(map.getZoom(), 17)); }
      else if (a === 'zum') { const k = krugoviOdjela(o.id); if (!k.length) { toast('Odjel još nema obrojčanih krugova'); return; } if (typeof switchMainTab === 'function') switchMainTab('karta'); map.fitBounds(L.latLngBounds(k.map(t => [t.la, t.lo])).pad(0.2), { maxZoom: 18 }); }
      else if (a === 'ime') { const v = typeof _dlgPrompt === 'function' ? await _dlgPrompt('Naziv odjela', o.naziv, { title: '✏ Odjel', okLabel: 'Spremi' }) : prompt('Naziv', o.naziv); if (v && v.trim()) { o.naziv = v.trim().slice(0, 40); pisi(); } }
      else if (a === 'brisi') {
        const ok = typeof _dlgConfirm === 'function' ? await _dlgConfirm('Obrisati odjel „' + o.naziv + '” i brojeve njegovih krugova? Krugovi i stanje snimanja ostaju.', { danger: true, okLabel: 'Obriši' }) : confirm('Obrisati?');
        if (!ok) return;
        S.skupovi.forEach(s => s.tacke.forEach(t => { if (t.odj === o.id) { t.odj = null; t.br = null; t.bt = null; } }));
        S.odjeli = S.odjeli.filter(x => x.id !== o.id); if (S.aktOdj === o.id) { S.aktOdj = null; numOn = false; } pisi();
      }
      crtaj(); render(); numTraka();
    },
    zum: id => zumSkup(id, true),
    vidljiv(id, on) { const s = S.skupovi.find(x => x.id === id); if (!s) return; s.vis = !!on; if (!on && aktivni && s.tacke.some(t => t.id === aktivni)) zavrsi(); pisi(); crtaj(); render(); },
    sklopi(id) { otvoren[id] = !otvoren[id]; render(); },
    trazi(v) { trazi = v || ''; render(); const i = document.querySelector('#inv-body .kh-trazi'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } },
    async obrisi(id) {
      const s = S.skupovi.find(x => x.id === id); if (!s) return;
      const ok = typeof _dlgConfirm === 'function' ? await _dlgConfirm('Ukloniti „' + s.naziv + '” (' + s.tacke.length + ' ploha) i stanje snimanja?', { danger: true, okLabel: 'Ukloni' }) : confirm('Ukloniti ' + s.naziv + '?');
      if (!ok) return;
      if (aktivni && s.tacke.some(t => t.id === aktivni)) zavrsi();
      S.skupovi = S.skupovi.filter(x => x.id !== id); pisi(); crtaj(); render();
    },
    postavi(k, v) {
      if (k === 'r') { const r = parseFloat(String(v).replace(',', '.')); if (!(r > 0 && r <= 200)) { toast('⚠ Radijus 1–200 m'); render(); return; } S.r = r; S.unutra = S.unutra.filter(x => x < r); }
      else if (k === 'unutra') S.unutra = parsirajKrugove(v, S.r);
      pisi(); crtaj(); render(); if (aktivni) osvjezi();
    },
    _test: { udaljenost, azimut, stanje, strana, parsirajKrugove, krugTacke, uPoligonu, poBroju }
  };
  if (typeof map !== 'undefined' && typeof L !== 'undefined') {
    setTimeout(() => { crtaj(); render(); }, 0);
    if (typeof _kartaKlikIzvor === 'function') _kartaKlikIzvor(klikIzvor);
  }
})();
