// Satelitski snimci po godinama (Esri World Imagery Wayback): arhiva izdanja podloge od 2014. Za izabranu godinu koristi se ZADNJE izdanje
// te godine (Wayback prikaže najnovije snimke koje su do tada postojale — ako područje te godine nije snimano, vidi se starija scena).
// Lista izdanja: živo s Esri konfiguracije (CORS), rezerva static/data/wayback_izdanja.json i zadnja zapamćena. Pločice treba internet
// (pregledane se trajno keširaju u service workeru — vidi sw.js).
(function (root) {
  'use strict';
  const CFG = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json';
  const URL = 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/{id}/{z}/{y}/{x}';
  const LS_KEY = 'usf_wb', LS_LISTA = 'usf_wb_lista';

  // [[datum, id], …] → { godina: {datum, id, svi:[[datum,id]…]} } za zadnjih `n` godina (najnovija prva)
  function poGodinama(lista, n, tekuca) {
    const po = {};
    (lista || []).forEach(([dat, id]) => { const g = +String(dat).slice(0, 4); if (g) (po[g] = po[g] || []).push([dat, id]); });
    const out = [];
    for (let g = tekuca; g > tekuca - n; g--) {
      const sv = (po[g] || []).slice().sort((a, b) => a[0].localeCompare(b[0]));
      if (sv.length) out.push({ godina: g, datum: sv[sv.length - 1][0], id: sv[sv.length - 1][1], svi: sv });
    }
    return out;
  }
  function parsirajKonfig(obj) {
    return Object.entries(obj || {}).map(([id, v]) => { const m = /(\d{4}-\d{2}-\d{2})/.exec(v && v.itemTitle || ''); return m ? [m[1], +id] : null; }).filter(Boolean).sort((a, b) => a[0].localeCompare(b[0]));
  }
  const urlZa = id => URL.replace('{id}', id);
  if (typeof module !== 'undefined') module.exports = { poGodinama, parsirajKonfig, urlZa };
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  let lista = null, sloj = null, st = { godina: null, id: null, op: 100 };
  try { Object.assign(st, JSON.parse(localStorage.getItem(LS_KEY) || '{}'), { godina: null, id: null }); } catch (e) {}
  const pamti = () => { try { localStorage.setItem(LS_KEY, JSON.stringify({ op: st.op })); } catch (e) {} };
  const toast = t => { try { showToast(t); } catch (e) {} };

  async function ucitajListu() {
    if (lista) return lista;
    try {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 7000);
      const r = await fetch(CFG, { signal: ctl.signal }).finally(() => clearTimeout(tm));
      if (r.ok) { const l = parsirajKonfig(await r.json()); if (l.length > 20) { lista = l; try { localStorage.setItem(LS_LISTA, JSON.stringify(l)); } catch (e) {} return lista; } }
    } catch (e) {}
    try { const z = JSON.parse(localStorage.getItem(LS_LISTA) || 'null'); if (z && z.length > 20) return (lista = z); } catch (e) {}
    try { const r = await fetch('static/data/wayback_izdanja.json'); if (r.ok) return (lista = await r.json()); } catch (e) {}
    return (lista = []);
  }
  const godine = () => poGodinama(lista || [], 10, new Date().getFullYear());

  function paneSloj() {
    if (!map.getPane('waybackPane')) { map.createPane('waybackPane'); map.getPane('waybackPane').style.zIndex = '212'; map.getPane('waybackPane').style.pointerEvents = 'none'; }
  }
  function uklonisloj() { if (sloj) { try { map.removeLayer(sloj); } catch (e) {} sloj = null; } }
  function postavi(g) {
    const e = godine().find(x => x.godina === g);
    if (!e) return;
    paneSloj(); uklonisloj();
    st.godina = g; st.id = e.id;
    sloj = L.tileLayer(urlZa(e.id), { pane: 'waybackPane', maxNativeZoom: 19, maxZoom: 22, opacity: st.op / 100, keepBuffer: 2, updateWhenIdle: true, updateWhenZooming: false, attribution: 'Esri World Imagery Wayback' }).addTo(map);
    osvjezi();
  }
  function iskljuci() { uklonisloj(); st.godina = null; st.id = null; osvjezi(); }
  function korak(d) {
    const l = godine().map(x => x.godina).sort((a, b) => a - b); if (!l.length) return;
    const i = l.indexOf(st.godina); const n = i < 0 ? l[l.length - 1] : l[Math.max(0, Math.min(l.length - 1, i + d))];
    postavi(n);
  }
  function opacity(v) { st.op = Math.max(20, Math.min(100, +v || 100)); pamti(); if (sloj) sloj.setOpacity(st.op / 100); }

  function traka() {
    let b = document.getElementById('wb-traka');
    if (!b) {
      b = document.createElement('div'); b.id = 'wb-traka'; b.hidden = true;
      b.innerHTML = '<button type="button" data-a="-">◀</button><div class="wb-god"><b></b><small></small></div><button type="button" data-a="+">▶</button><button type="button" data-a="x" aria-label="Isključi">✕</button>';
      b.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (!a) return; if (a.dataset.a === 'x') iskljuci(); else korak(a.dataset.a === '-' ? -1 : 1); });
      document.body.appendChild(b);
    }
    return b;
  }
  function osvjezi() {
    const b = traka(), e = godine().find(x => x.godina === st.godina);
    b.hidden = !e;
    if (e) { b.querySelector('b').textContent = '🕰 ' + e.godina; b.querySelector('small').textContent = 'izdanje ' + e.datum; }
    render();
  }
  function render() {
    const g = godine();
    document.querySelectorAll('.wb-host').forEach(el => {
      const naslov = st.godina ? 'Prikazano: ' + st.godina : 'Esri Wayback · zadnjih 10 godina';
      const glava = el.dataset.kompakt
        ? `<h3>Satelitski snimci po godinama <small>${naslov}</small></h3>`
        : `<div class="kg-top"><i>🕰</i><div><h3>Satelitski snimci po godinama</h3><p class="kh-stat">${naslov}</p></div></div>`;
      el.innerHTML = glava + (g.length ? `<div class="wb-cipovi">${g.map(x => `<button type="button" class="${x.godina === st.godina ? 'on' : ''}" onclick="USFWayback.postavi(${x.godina})">${x.godina}</button>`).join('')}</div>
      <label class="wb-op">Providnost <input type="range" min="20" max="100" step="5" value="${st.op}" oninput="USFWayback.opacity(this.value)"><span>${st.op} %</span></label>
      ${st.godina ? '<button type="button" class="wb-iskljuci" onclick="USFWayback.iskljuci()">✕ Isključi snimak</button>' : ''}
      <p class="set-nap">Najnovije izdanje u izabranoj godini. Ako to područje te godine nije snimano, vidi se starija scena. Treba internet; pregledane pločice ostaju sačuvane.</p>` : '<p class="set-nap">Lista izdanja se učitava…</p>');
    });
  }
  async function pokreni() { render(); await ucitajListu(); render(); }
  root.USFWayback = { postavi, iskljuci, korak, opacity, render: pokreni, godine: () => godine() };
})(typeof window !== 'undefined' ? window : globalThis);
