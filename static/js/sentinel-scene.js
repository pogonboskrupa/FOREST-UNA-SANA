// Sentinel-2 čisti snimci: scene oko centra karte iz CDSE STAC kataloga sa PRAVIM podatkom o oblačnosti (eo:cloud_cover),
// prikaz izabranog dana kao pravih boja preko Sentinel Hub WMS-a (ista CDSE konfiguracija kao Vitalnost, USFVeg.stanje()).
// Oblačnost je za cijelu scenu (~100 km), ne za lokalno mjesto — lokalno može biti drugačije.
(function (root) {
  'use strict';
  const STAC = ['https://catalogue.dataspace.copernicus.eu/stac/collections/SENTINEL-2/items', 'https://catalogue.dataspace.copernicus.eu/stac/collections/sentinel-2-l2a/items'];
  const WMS = 'https://sh.dataspace.copernicus.eu/ogc/wms/';
  const EVAL = '//VERSION=3\nfunction setup(){return{input:["B04","B03","B02","dataMask"],output:{bands:4}}}\nfunction evaluatePixel(s){const g=2.5;return[s.B04*g,s.B03*g,s.B02*g,s.dataMask]}';

  // STAC features → [{datum, cc, id}] samo L2A, oblačnost ≤ prag, jedna (najčistija) scena po danu, najnovije prvo
  function filtrirajScene(items, prag) {
    const po = new Map();
    (items || []).forEach(f => {
      const p = f && f.properties || {}, id = String(f && f.id || '');
      const cc = p['eo:cloud_cover'] != null ? +p['eo:cloud_cover'] : null;
      const l2a = /L2A/i.test(id) || /L2A/i.test(p['processing:level'] || p.processingLevel || '');
      const dat = String(p.datetime || p.start_datetime || '').slice(0, 10);
      if (!l2a || cc == null || !isFinite(cc) || cc > prag || !/^\d{4}-\d{2}-\d{2}$/.test(dat)) return;
      const x = po.get(dat); if (!x || cc < x.cc) po.set(dat, { datum: dat, cc, id });
    });
    return [...po.values()].sort((a, b) => b.datum.localeCompare(a.datum));
  }
  if (typeof module !== 'undefined') module.exports = { filtrirajScene };
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  let scene = [], sloj = null, izabran = null, poruka = '', radi = false;
  const toast = t => { try { showToast(t); } catch (e) {} };
  const opc = { mj: 6, cc: 20 };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function trazi() {
    if (radi) return; radi = true; poruka = '⏳ Tražim scene…'; render();
    try {
      const c = map.getCenter(), d = 0.01, bb = [c.lng - d, c.lat - d, c.lng + d, c.lat + d].map(v => v.toFixed(4)).join(',');
      const kraj = new Date(), poc = new Date(kraj.getTime() - opc.mj * 30.5 * 864e5), f = t => t.toISOString().slice(0, 10);
      let items = null, greska = '';
      for (const u of STAC) {
        try {
          const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 15000);
          const r = await fetch(`${u}?bbox=${bb}&datetime=${f(poc)}T00:00:00Z/${f(kraj)}T23:59:59Z&limit=200`, { signal: ctl.signal }).finally(() => clearTimeout(tm));
          if (!r.ok) { greska = 'HTTP ' + r.status; continue; }
          const j = await r.json(); items = j.features || []; if (items.length) break;
        } catch (e) { greska = e && e.message || 'mreža'; }
      }
      if (items == null) { poruka = '⚠ Katalog nije dostupan (' + greska + ').'; scene = []; }
      else { scene = filtrirajScene(items, opc.cc); poruka = scene.length ? `✓ ${scene.length} čistih dana (oblaci ≤ ${opc.cc} %) u zadnjih ${opc.mj} mj.` : `Nema scena s oblacima ≤ ${opc.cc} % u zadnjih ${opc.mj} mj. — pokušaj duži period ili veći prag.`; }
    } finally { radi = false; render(); }
  }
  function ukloni() { if (sloj) { try { map.removeLayer(sloj); } catch (e) {} sloj = null; } izabran = null; render(); }
  function prikazi(datum) {
    const V = root.USFVeg && USFVeg.stanje && USFVeg.stanje();
    if (!V || !V.id || !V.sloj) { toast('Prvo otključaj CDSE konfiguraciju (PIN) u Vitalnosti'); return; }
    if (!map.getPane('sentinelPane')) { map.createPane('sentinelPane'); const p = map.getPane('sentinelPane'); p.style.zIndex = '213'; p.style.pointerEvents = 'none'; }
    if (sloj) { try { map.removeLayer(sloj); } catch (e) {} }
    sloj = L.tileLayer.wms(WMS + encodeURIComponent(V.id), { layers: V.sloj, format: 'image/png', transparent: true, version: '1.3.0', pane: 'sentinelPane', tileSize: 512, zoomOffset: -1, maxZoom: 18, TIME: datum + '/' + datum, MAXCC: 100, WARNINGS: 'NO', EVALSCRIPT: btoa(EVAL), attribution: 'Copernicus Sentinel-2' }).addTo(map);
    izabran = datum; render();
  }
  function render() {
    document.querySelectorAll('.s2-host').forEach(el => {
      el.innerHTML = `<h3>Sentinel-2 čisti snimci <small>scene s pravim podatkom o oblacima</small></h3>
        <div class="zp-izbor"><label>Period<select onchange="USFS2.opc('mj',this.value)">${[[3, '3 mjeseca'], [6, '6 mjeseci'], [12, '12 mjeseci']].map(([v, n]) => `<option value="${v}"${v === opc.mj ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        <label>Oblaci do<select onchange="USFS2.opc('cc',this.value)">${[5, 10, 20, 30].map(v => `<option value="${v}"${v === opc.cc ? ' selected' : ''}>${v} %</option>`).join('')}</select></label></div>
        <button class="zp-glavno" ${radi ? 'disabled' : ''} onclick="USFS2.trazi()">🔍 Traži čiste scene (centar karte)</button>
        <div class="uk-status">${esc(poruka)}</div>
        <div class="s2-lista">${scene.map(s => `<button type="button" class="${s.datum === izabran ? 'on' : ''}" onclick="USFS2.prikazi('${s.datum}')">${s.datum.split('-').reverse().join('. ')}. <small>☁ ${Math.round(s.cc)} %</small></button>`).join('')}</div>
        ${izabran ? '<button type="button" class="wb-iskljuci" onclick="USFS2.ukloni()">✕ Ukloni snimak s karte</button>' : ''}
        <p class="set-nap">Oblačnost je za cijelu scenu (~100 km), lokalno može biti više. Prikaz troši CDSE kvotu (zahtjev po pločici); treba otključana CDSE konfiguracija iz Vitalnosti.</p>`;
    });
  }
  root.USFS2 = { trazi, prikazi, ukloni, render, opc: (k, v) => { opc[k] = +v; } };
})(typeof window !== 'undefined' ? window : globalThis);
