// Podloge Unsko-sanskog kantona u Šumarstvu — sve iz static/data (APK), offline:
//   granice općina/gradova (geoBoundaries), pedološka karta (HWSD v2, FAO-90/WRB),
//   zimski Sentinel-2 mozaik bez lišća (XYZ WebP pločice z8–14).
(function (root) {
  'use strict';
  const FAJL = { granice: 'static/data/opcine_usk.geojson', tlo: 'static/data/tlo_usk.tif', tloJson: 'static/data/tlo_usk.json', zima: 'static/data/zima.json' };
  const KLJUC = 'usf_usk_slojevi';
  const BOJE_OPC = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#14b8a6', '#a855f7', '#ef4444', '#eab308'];
  const PROZIRNO = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  const imaKartu = () => typeof map !== 'undefined' && !!map && typeof map.getContainer === 'function';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtBr = (v, d = 0) => Number(v).toLocaleString('bs-BA', { minimumFractionDigits: d, maximumFractionDigits: d });

  const st = (() => {
    const pod = { granice: { on: false, ispuna: true, op: 22, nazivi: true }, tlo: { on: false, op: 55 }, zima: { on: false, op: 100 } };
    try { const s = JSON.parse(localStorage.getItem(KLJUC) || '{}'); for (const k in pod) Object.assign(pod[k], s[k] || {}); } catch (e) {}
    return pod;
  })();
  const pamti = () => { try { localStorage.setItem(KLJUC, JSON.stringify(st)); } catch (e) {} };

  function panovi() {
    if (map.getPane('ukZimaPane')) return;
    // Zimski snimak je podloga (odmah iznad offline karte 210), granice i tlo
    // iznad podloge a ispod tragova (410); nazivi iznad svega tematskog.
    [['ukZimaPane', 212], ['ukTloPane', 395], ['ukGranicePane', 405], ['ukNaziviPane', 468]].forEach(([p, z]) => {
      map.createPane(p); map.getPane(p).style.zIndex = String(z); map.getPane(p).style.pointerEvents = 'none';
    });
  }

  // ── Granice općina/gradova ───────────────────────────────────────────
  let gj = null, gLista = [], gSloj = null, gHalo = null, gNazivi = null;
  async function granice() {
    if (!gj) gj = fetch(FAJL.granice).then(r => { if (!r.ok) throw new Error('nema granica općina'); return r.json(); });
    return gj;
  }
  function stilOpc(f) {
    const i = gLista.indexOf(f.properties.ime);
    return { pane: 'ukGranicePane', color: '#fde68a', weight: 2.2, opacity: 0.95, fill: st.granice.ispuna, fillColor: BOJE_OPC[i % BOJE_OPC.length], fillOpacity: st.granice.op / 100, interactive: false };
  }
  async function crtajGranice() {
    if (gSloj) { map.removeLayer(gSloj); map.removeLayer(gHalo); map.removeLayer(gNazivi); gSloj = gHalo = gNazivi = null; }
    if (!st.granice.on) return;
    const d = await granice();
    gLista = d.features.map(f => f.properties.ime);
    gHalo = L.geoJSON(d, { style: () => ({ pane: 'ukGranicePane', color: '#0b1220', weight: 5.5, opacity: 0.55, fill: false, interactive: false }) }).addTo(map);
    gSloj = L.geoJSON(d, { style: stilOpc }).addTo(map);
    gNazivi = L.layerGroup(d.features.map(f => {
      const c = L.geoJSON(f).getBounds().getCenter();
      const ta = turfTacka(f) || c;
      return L.marker(ta, { pane: 'ukNaziviPane', interactive: false, keyboard: false,
        icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<span class="uk-naziv${f.properties.tip === 'grad' ? ' grad' : ''}">${esc(f.properties.ime)}</span>` }) });
    }));
    if (st.granice.nazivi) gNazivi.addTo(map);
  }
  // Tačka sigurno unutar poligona (za naziv) — centar obuhvata zna pasti van (Ključ, Krupa).
  function turfTacka(f) {
    try { if (typeof turf !== 'undefined') { const p = turf.pointOnFeature(f); return [p.geometry.coordinates[1], p.geometry.coordinates[0]]; } } catch (e) {}
    return null;
  }
  function legendaGranica() {
    const el = document.getElementById('uk-granice-leg'); if (!el || !gLista.length) return;
    granice().then(d => {
      el.innerHTML = d.features.map((f, i) => {
        const ha = typeof turf !== 'undefined' ? turf.area(f) / 10000 : 0;
        return `<div class="uk-leg-red"><i style="background:${BOJE_OPC[i % BOJE_OPC.length]}"></i><span>${esc(f.properties.ime)}${f.properties.tip === 'grad' ? ' <small>grad</small>' : ''}</span><b>${ha ? fmtBr(ha / 100, 0) + ' km²' : ''}</b></div>`;
      }).join('');
    });
  }

  // ── Pedološka karta ──────────────────────────────────────────────────
  let tloP = null, tloSloj = null;
  function tloPodaci() {
    if (!tloP) tloP = (async () => {
      const [G, meta] = await Promise.all([root.USFDeadtrees.ucitajLib(), fetch(FAJL.tloJson).then(r => { if (!r.ok) throw new Error('nema pedološke karte'); return r.json(); })]);
      const r = await fetch(FAJL.tlo); if (!r.ok) throw new Error('nema pedološke karte');
      const img = await (await G.fromArrayBuffer(await r.arrayBuffer())).getImage(0);
      const [ox, oy] = img.getOrigin(), [rx, ry] = img.getResolution();
      const data = (await img.readRasters({ samples: [0], interleave: false }))[0];
      const jed = new Map(meta.jedinice.map(j => [j.kod, j]));
      return { meta, jed, data, W: img.getWidth(), H: img.getHeight(), ox, oy, rx, ry };
    })();
    tloP.catch(() => { tloP = null; });
    return tloP;
  }
  const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  // Raster je u stepenima (EPSG:4326); karta je Mercator — svaki red slike se
  // preslika sa svoje geografske širine, pa granice jedinica ostaju na mjestu.
  function tloSlika(c) {
    const S = 4, W = c.W * S, lat0 = c.oy + c.H * c.ry, lat1 = c.oy;
    const my = la => Math.log(Math.tan(Math.PI / 4 + la * Math.PI / 360));
    const m0 = my(lat0), m1 = my(lat1), H = Math.round(c.H * S * 1.4);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'), out = ctx.createImageData(W, H), px = out.data;
    const boje = new Map([...c.jed].map(([k, j]) => [k, hexRgb(j.boja)]));
    for (let y = 0; y < H; y++) {
      const m = m1 - (y + 0.5) / H * (m1 - m0), la = (2 * Math.atan(Math.exp(m)) - Math.PI / 2) * 180 / Math.PI;
      const sy = Math.floor((la - c.oy) / c.ry); if (sy < 0 || sy >= c.H) continue;
      for (let x = 0; x < W; x++) {
        const v = c.data[sy * c.W + Math.floor(x / S)], b = v && boje.get(v); if (!b) continue;
        const o = (y * W + x) * 4; px[o] = b[0]; px[o + 1] = b[1]; px[o + 2] = b[2]; px[o + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
    return { url: cv.toDataURL(), granice: [[lat0, c.ox], [lat1, c.ox + c.W * c.rx]] };
  }
  async function crtajTlo() {
    if (tloSloj) { map.removeLayer(tloSloj); tloSloj = null; }
    if (!st.tlo.on) return;
    try {
      const c = await tloPodaci(), s = tloSlika(c);
      tloSloj = L.imageOverlay(s.url, s.granice, { pane: 'ukTloPane', opacity: st.tlo.op / 100, interactive: false, className: 'uk-tlo' }).addTo(map);
      legendaTla(c);
    } catch (e) { status('uk-tlo-status', '⚠ ' + e.message); }
  }
  function tloNa(c, lat, lng) {
    const x = Math.floor((lng - c.ox) / c.rx), y = Math.floor((lat - c.oy) / c.ry);
    if (x < 0 || y < 0 || x >= c.W || y >= c.H) return null;
    return c.jed.get(c.data[y * c.W + x]) || null;
  }
  function legendaTla(c) {
    const el = document.getElementById('uk-tlo-leg'); if (!el) return;
    el.innerHTML = c.meta.jedinice.map(j => `<div class="uk-leg-red"><i style="background:${j.boja}"></i><span>${esc(j.naziv)}<small>${esc(j.fao90)}</small></span><b>${fmtBr(j.udio * 100, j.udio < 0.01 ? 1 : 0)} %</b></div>`).join('') +
      `<p class="uk-izvor">${esc(c.meta.izvor)}. Klasifikacija: ${esc(c.meta.klasifikacija)}. Mjerilo ~1:1 000 000 — pregledna karta, ne zamjenjuje terensko kartiranje odjela.</p>`;
  }
  function tloPopup(j, c) {
    const redovi = Object.entries(j.svojstva || {});
    redovi.unshift(['FAO-90', j.fao90], ['WRB', j.wrb], ['Udio u USK', fmtBr(j.udio * 100, 1) + ' % (' + fmtBr(j.ha) + ' ha)']);
    const komp = (j.komponente || []).map(k => `<div class="uk-komp"><b>${k.udio} %</b><span>${esc(k.naziv || k.fao90)}</span></div>`).join('');
    return _popKartica({ ikona: '🟫', boja: j.boja, naslov: j.naziv, tip: 'Pedološka jedinica', meta: 'HWSD v2', redovi,
      vise: komp ? `<div class="uk-komp-nasl">Sastav jedinice (gornji sloj dominantnog tla gore)</div><div class="uk-komp-lista">${komp}</div>` : '' });
  }

  // ── Zimski snimak (sloj u static/js/zima.js; ovdje prikaz i preuzimanje) ──
  let zimaMeta = null, zimaSloj = null;
  async function crtajZimu() {
    if (zimaSloj) { map.removeLayer(zimaSloj); zimaSloj = null; }
    if (!st.zima.on) return;
    try {
      if (!zimaMeta) zimaMeta = await fetch(FAJL.zima).then(r => { if (!r.ok) throw new Error('zimski snimak još nije u aplikaciji'); return r.json(); });
      const man = await root.USKZima.manifest();
      const [w, s, e, n] = zimaMeta.obuhvat;
      zimaSloj = root.USKZima.napraviSloj({ pane: 'ukZimaPane', ugrMax: man.ugradjeno[1], bounds: L.latLngBounds([s, w], [n, e]).pad(0.02), opacity: st.zima.op / 100 }).addTo(map);
      status('uk-zima-status', `${zimaMeta.scena} zimskih snimaka (${zimaMeta.mjeseci}), ${zimaMeta.od} – ${zimaMeta.do}`);
      zimaUi();
    } catch (err) { status('uk-zima-status', '⚠ ' + err.message); }
  }
  const ZOOM_OPIS = { 12: 'z12 · ~38 m (pregled šume)', 13: 'z13 · ~19 m (odjeli, veće sječine)', 14: 'z14 · 10 m (puna rezolucija, vlake)' };
  async function zimaUi() {
    const Z = root.USKZima, selP = document.getElementById('zp-pod'), selZ = document.getElementById('zp-zoom');
    if (!Z || !selP) return;
    const man = await Z.manifest(), s = Z.stanje();
    if (!selP.options.length) {
      selP.innerHTML = man.podrucja.map(p => `<option value="${p.id}">${esc(p.naziv)}${p.tip === 'grad' ? ' (grad)' : ''}</option>`).join('');
      selZ.innerHTML = [12, 13, 14].map(z => `<option value="${z}" ${z === 14 ? 'selected' : ''}>${ZOOM_OPIS[z]}</option>`).join('');
    }
    const p = man.podrucja.find(x => x.id === selP.value), doZ = Number(selZ.value), imam = s[p.id] || 11;
    const b = Z.velicina(p, imam, doZ), btn = document.getElementById('zp-preuzmi');
    btn.disabled = Z.u_toku() || b === 0;
    btn.textContent = b === 0 ? '✓ Već preuzeto do z' + imam : '⬇ Preuzmi · ' + Z.mb(b);
    const lista = document.getElementById('zp-lista');
    const red = Object.entries(s).map(([id, z]) => {
      const q = man.podrucja.find(x => x.id === id); if (!q) return '';
      return `<div class="zp-stavka"><div><b>${esc(q.naziv)}</b><small>do z${z} · ${Z.mb(Z.velicina(q, 11, z))} · radi bez interneta</small></div><button onclick="USKSlojevi.zimaPrikazi('${id}')" aria-label="Prikaži na karti">🗺</button><button class="opasno" onclick="USKSlojevi.zimaObrisi('${id}')" aria-label="Obriši paket">🗑</button></div>`;
    }).join('');
    const ukupno = await Z.zauzece();
    lista.innerHTML = red ? `<div class="zp-nasl">Preuzeto na uređaju · ${Z.mb(ukupno)}</div>${red}` : '<div class="zp-prazno">Još ništa nije preuzeto. Bez paketa se detalj (z12–14) učitava s interneta dok ima veze, a offline se vidi pregled do z11.</div>';
  }
  async function zimaPreuzmi() {
    const Z = root.USKZima, id = document.getElementById('zp-pod').value, doZ = Number(document.getElementById('zp-zoom').value);
    const box = document.getElementById('zp-napredak'), traka = box.querySelector('u'), txt = box.querySelector('span');
    box.hidden = false; document.getElementById('zp-preuzmi').disabled = true;
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {}
    try {
      await Z.preuzmi(id, doZ, (f, t) => { traka.style.width = Math.round(f * 100) + '%'; txt.textContent = t; });
      if (typeof showToast === 'function') showToast('❄ Zimski snimak preuzet — radi bez interneta');
      if (zimaSloj) zimaSloj.redraw();
    } catch (e) {
      const prekid = e && e.name === 'AbortError';
      txt.textContent = prekid ? 'Prekinuto — završeni nivoi ostaju sačuvani' : '⚠ ' + (e.message || e) + (navigator.onLine === false ? ' (nema interneta)' : '');
      if (typeof showToast === 'function') showToast(prekid ? 'Preuzimanje prekinuto' : '⚠ Preuzimanje nije uspjelo');
    }
    setTimeout(() => { if (!Z.u_toku()) box.hidden = true; }, 2500);
    zimaUi();
  }
  async function zimaObrisi(id) {
    const man = await root.USKZima.manifest(), p = man.podrucja.find(x => x.id === id);
    const ok = typeof _dlgConfirm === 'function' ? await _dlgConfirm('Obrisati preuzeti zimski snimak: ' + (p ? p.naziv : id) + '?', { title: 'Obriši paket', danger: true, okLabel: 'Obriši' }) : true;
    if (!ok) return;
    await root.USKZima.obrisi(id);
    if (zimaSloj) zimaSloj.redraw();
    zimaUi();
  }
  async function zimaPrikazi(id) {
    const man = await root.USKZima.manifest(), p = man.podrucja.find(x => x.id === id); if (!p) return;
    if (!st.zima.on) prekidac('zima', true);
    if (typeof switchMainTab === 'function') switchMainTab('karta');
    const [w, s, e, n] = p.obuhvat; map.fitBounds([[s, w], [n, e]]);
  }

  function status(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
  function uiSync() {
    for (const k of ['granice', 'tlo', 'zima']) {
      document.getElementById('uk-' + k + '-switch')?.classList.toggle('on', !!st[k].on);
      const o = document.getElementById('uk-' + k + '-opts'); if (o) o.style.display = st[k].on ? '' : 'none';
      const r = document.getElementById('uk-' + k + '-op'); if (r) r.value = st[k].op;
    }
    const i = document.getElementById('uk-ispuna'); if (i) i.checked = st.granice.ispuna;
    const n = document.getElementById('uk-nazivi'); if (n) n.checked = st.granice.nazivi;
  }
  const CRTAJ = { granice: () => crtajGranice().then(legendaGranica).catch(e => status('uk-granice-status', '⚠ ' + e.message)), tlo: crtajTlo, zima: crtajZimu };
  function prekidac(k, on) {
    st[k].on = on === undefined ? !st[k].on : !!on; pamti(); uiSync(); CRTAJ[k]();
  }
  function prozirnost(k, v) {
    st[k].op = Number(v); pamti();
    if (k === 'granice' && gSloj) gSloj.setStyle(stilOpc);
    if (k === 'tlo' && tloSloj) tloSloj.setOpacity(st.tlo.op / 100);
    if (k === 'zima' && zimaSloj) zimaSloj.setOpacity(st.zima.op / 100);
  }
  function ispuna(on) { st.granice.ispuna = !!on; pamti(); if (gSloj) gSloj.setStyle(stilOpc); }
  function nazivi(on) { st.granice.nazivi = !!on; pamti(); if (gNazivi) { if (on) gNazivi.addTo(map); else map.removeLayer(gNazivi); } }

  function registruj() {
    if (typeof _kartaKlikIzvor !== 'function') return;
    // Općina: poligon (najmanji pobjeđuje, pa odjel/KML iznad nje ima prednost).
    _kartaKlikIzvor((ll) => {
      if (!st.granice.on || !gSloj) return [];
      const out = [];
      gSloj.eachLayer(l => {
        const f = l.feature;
        if (!l.getBounds().contains(ll)) return;
        const tacka = typeof turf !== 'undefined' ? turf.booleanPointInPolygon([ll.lng, ll.lat], f) : true;
        if (!tacka) return;
        out.push({ vrsta: 'poligon', pov: 1e9, otvori: at => {
          const ha = typeof turf !== 'undefined' ? turf.area(f) / 10000 : 0;
          const i = gLista.indexOf(f.properties.ime);
          L.popup({ maxWidth: 300, minWidth: 220, className: 'pk-pop' }).setLatLng(at).setContent(_popKartica({
            ikona: '🏛', boja: BOJE_OPC[i % BOJE_OPC.length], naslov: f.properties.ime, tip: f.properties.tip === 'grad' ? 'Grad' : 'Općina', meta: 'Unsko-sanski kanton',
            redovi: [['Površina', fmtBr(ha / 100, 1) + ' km² (' + fmtBr(ha) + ' ha)']] })).openOn(map);
        } });
      });
      return out;
    });
    // Tlo: uvijek zadnje (ispod svega), samo kad je sloj uključen.
    _kartaKlikIzvor((ll) => {
      if (!st.tlo.on || !tloP) return [];
      return [{ vrsta: 'poligon', pov: 1e12, otvori: async at => {
        const c = await tloPodaci(), j = tloNa(c, at.lat, at.lng);
        if (j) L.popup({ maxWidth: 310, minWidth: 230, className: 'pk-pop' }).setLatLng(at).setContent(tloPopup(j, c)).openOn(map);
      } }];
    });
  }

  root.USKSlojevi = { zimaUi, zimaPreuzmi, zimaObrisi, zimaPrikazi, prekidac, prozirnost, ispuna, nazivi, stanje: () => JSON.parse(JSON.stringify(st)), tloPodaci, tloNa };
  if (typeof L !== 'undefined' && imaKartu()) {
    panovi(); registruj(); uiSync();
    for (const k of ['granice', 'tlo', 'zima']) if (st[k].on) CRTAJ[k]();
  }
})(typeof window !== 'undefined' ? window : globalThis);
