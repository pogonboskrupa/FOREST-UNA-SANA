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
  // Udio „oblaka” u RGBA podacima pločice: svijetli (> 195) slabo zasićeni (raspon kanala < 28) pikseli; transparentni se ne broje.
  // Snijeg se broji isto — i on zaklanja šumu, pa je za pregled stanja šume jednako loš snimak.
  function udioOblaka(d) {
    let n = 0, o = 0;
    for (let i = 0; i + 3 < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      n++;
      const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mn > 195 && mx - mn < 28) o++;
    }
    return n ? o / n : null;
  }
  const PRAG_OBLAKA = 0.15;
  if (typeof module !== 'undefined') module.exports = { poGodinama, parsirajKonfig, urlZa, udioOblaka };
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  let lista = null, sloj = null, st = { godina: null, id: null, datum: null, op: 100 };
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
  // Oblačnost izdanja na mjestu u centru karte: jedna pločica po izdanju, mjeri se na canvasu (Esri pločice imaju CORS).
  // Wayback nema podatak o oblacima, pa se procjena radi iz same slike; null = nije moguće izmjeriti (mreža/CORS) → ne krije se.
  const oblaci = new Map();
  function plocicaCentra() {
    const z = Math.max(10, Math.min(15, Math.round(map.getZoom()))), c = map.getCenter(), n = Math.pow(2, z);
    const x = Math.floor((c.lng + 180) / 360 * n), la = c.lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n);
    return { z, x, y };
  }
  function izmjeriOblake(id, t) {
    const k = id + ':' + t.z + ':' + t.x + ':' + t.y;
    if (oblaci.has(k)) return oblaci.get(k);
    const p = new Promise(res => {
      const im = new Image(); im.crossOrigin = 'anonymous';
      const tm = setTimeout(() => res(null), 8000);
      im.onload = () => { clearTimeout(tm); try { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); x.drawImage(im, 0, 0, 128, 128); res(udioOblaka(x.getImageData(0, 0, 128, 128).data)); } catch (e) { res(null); } };
      im.onerror = () => { clearTimeout(tm); res(null); };
      im.src = urlZa(id).replace('{z}', t.z).replace('{y}', t.y).replace('{x}', t.x);
    });
    oblaci.set(k, p); return p;
  }
  let ocjena = { god: null, rez: null, tece: false };
  async function ocijeniGodinu(g) {
    const e = godine().find(x => x.godina === g); if (!e || typeof map === 'undefined') return;
    const t = plocicaCentra(); ocjena = { god: g, rez: null, tece: true }; render();
    const izm = [];
    for (let i = 0; i < e.svi.length; i += 4) izm.push(...await Promise.all(e.svi.slice(i, i + 4).map(async x => [x[1], await izmjeriOblake(x[1], t)])));
    if (ocjena.god !== g) return;
    ocjena = { god: g, rez: new Map(izm), tece: false };
    // izabrano izdanje je preoblačno → najnovije čisto
    const dobra = e.svi.filter(x => { const u = ocjena.rez.get(x[1]); return u == null || u <= PRAG_OBLAKA; });
    if (dobra.length && !dobra.some(x => x[1] === st.id)) { postavi(g, dobra[dobra.length - 1][1]); return; }
    render();
  }
  const godine = () => poGodinama(lista || [], 10, new Date().getFullYear());

  function paneSloj() {
    if (!map.getPane('waybackPane')) { map.createPane('waybackPane'); map.getPane('waybackPane').style.zIndex = '212'; map.getPane('waybackPane').style.pointerEvents = 'none'; }
  }
  function uklonisloj() { if (sloj) { try { map.removeLayer(sloj); } catch (e) {} sloj = null; } }
  function postavi(g, id) {
    const e = godine().find(x => x.godina === g);
    if (!e) return;
    const izdanje = (id && e.svi.find(x => x[1] === +id)) || [e.datum, e.id];
    paneSloj(); uklonisloj();
    st.godina = g; st.id = izdanje[1]; st.datum = izdanje[0];
    sloj = L.tileLayer(urlZa(st.id), { pane: 'waybackPane', maxNativeZoom: 19, maxZoom: 22, opacity: st.op / 100, keepBuffer: 2, updateWhenIdle: true, updateWhenZooming: false, attribution: 'Esri World Imagery Wayback' }).addTo(map);
    osvjezi();
    if (!id && ocjena.god !== g) ocijeniGodinu(g);
  }
  // Izdanje (datum) unutar izabrane godine
  function izdanje(id) { if (st.godina) postavi(st.godina, id); }
  function iskljuci() { uklonisloj(); st.godina = null; st.id = null; st.datum = null; osvjezi(); }
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
    if (e) { b.querySelector('b').textContent = '🕰 ' + e.godina; b.querySelector('small').textContent = 'izdanje ' + (st.datum || e.datum); }
    render();
  }
  function izborDatuma() {
    const e = godine().find(x => x.godina === st.godina); if (!e) return '';
    const o = ocjena.god === e.godina ? ocjena : null, rez = o && o.rez;
    if (o && o.tece) return '<p class="set-nap">☁ Provjeravam oblačnost snimaka na ovom mjestu…</p>';
    const dobra = rez ? e.svi.filter(x => { const u = rez.get(x[1]); return u == null || u <= PRAG_OBLAKA; }) : e.svi;
    const lista = (dobra.length ? dobra : e.svi).slice().reverse();
    const nap = !rez ? `${e.svi.length} izdanja u ${e.godina}.`
      : dobra.length ? `Prikazani samo čisti snimci (oblaci/snijeg ≤ ${Math.round(PRAG_OBLAKA * 100)} %): ${dobra.length} od ${e.svi.length}.`
      : `⚠ Svi snimci iz ${e.godina} imaju puno oblaka/snijega na ovom mjestu — prikazani su svi. Pokušaj drugu godinu.`;
    const oz = x => { const u = rez && rez.get(x[1]); return u == null ? '' : ' · ☁ ' + Math.round(u * 100) + ' %'; };
    return `<label class="wb-dat">Datum snimka (izdanje)<select onchange="USFWayback.izdanje(this.value)">${lista.map(x => `<option value="${x[1]}"${x[1] === st.id ? ' selected' : ''}>${x[0].split('-').reverse().join('. ')}.${oz(x)}</option>`).join('')}</select><small>${nap}</small></label>
      <button type="button" class="wb-iskljuci" onclick="USFWayback.ocijeni()">☁ Provjeri oblačnost za centar karte</button>`;
  }
  function render() {
    const g = godine();
    document.querySelectorAll('.wb-host').forEach(el => {
      const naslov = st.godina ? 'Prikazano: ' + st.godina : 'Esri Wayback · zadnjih 10 godina';
      const glava = el.dataset.kompakt
        ? `<h3>Satelitski snimci po godinama <small>${naslov}</small></h3>`
        : `<div class="kg-top"><i>🕰</i><div><h3>Satelitski snimci po godinama</h3><p class="kh-stat">${naslov}</p></div></div>`;
      el.innerHTML = glava + (g.length ? `<div class="wb-cipovi">${g.map(x => `<button type="button" class="${x.godina === st.godina ? 'on' : ''}" onclick="USFWayback.postavi(${x.godina})">${x.godina}</button>`).join('')}</div>
      ${st.godina ? izborDatuma() : ''}
      <label class="wb-op">Providnost <input type="range" min="20" max="100" step="5" value="${st.op}" oninput="USFWayback.opacity(this.value)"><span>${st.op} %</span></label>
      ${st.godina ? '<button type="button" class="wb-iskljuci" onclick="USFWayback.iskljuci()">✕ Isključi snimak</button>' : ''}
      <p class="set-nap">Najnovije izdanje u izabranoj godini. Ako to područje te godine nije snimano, vidi se starija scena. Treba internet; pregledane pločice ostaju sačuvane.</p>` : '<p class="set-nap">Lista izdanja se učitava…</p>');
    });
  }
  async function pokreni() { render(); await ucitajListu(); render(); }
  root.USFWayback = { ocijeni: () => { ocjena = { god: null, rez: null, tece: false }; oblaci.clear(); return st.godina && ocijeniGodinu(st.godina); }, postavi, izdanje, iskljuci, korak, opacity, render: pokreni, godine: () => godine() };
})(typeof window !== 'undefined' ? window : globalThis);
