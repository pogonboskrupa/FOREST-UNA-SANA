// Terenske tačke s fotografijama — potpuno offline. Podaci o tačkama u
// localStorage (mali), fotografije u IndexedDB (smanjene na 1600 px + minijatura).
// Izvoz u KMZ (KML + fotografije) koji otvaraju Google Earth, QGIS i ova app.
(function (root) {
  'use strict';

  const KLJUC = 'usf_tacke';
  const KATEGORIJE = [
    { k: 'stablo', t: 'Suho / oštećeno stablo', ik: '🌲', boja: '#f59e0b' },
    { k: 'steta', t: 'Šteta (vjetar, snijeg, potkornjak)', ik: '⚠️', boja: '#ef4444' },
    { k: 'sjeca', t: 'Sječa / panj', ik: '🪓', boja: '#a855f7' },
    { k: 'put', t: 'Put / vlaka / propust', ik: '🛣️', boja: '#94a3b8' },
    { k: 'voda', t: 'Izvor / voda', ik: '💧', boja: '#38bdf8' },
    { k: 'granica', t: 'Granica / oznaka', ik: '📍', boja: '#22c55e' },
    { k: 'ostalo', t: 'Ostalo', ik: '📌', boja: '#e2e8f0' }
  ];
  // map (const) i lastP (let) su globalni leksički, NE svojstva window-a
  // (window.map je <div id="map">).
  const gp = () => (typeof lastP !== 'undefined' ? lastP : null);
  const imaKartu = () => typeof map !== 'undefined' && !!map && typeof map.getContainer === 'function';
  const kat = k => KATEGORIJE.find(x => x.k === k) || KATEGORIJE[KATEGORIJE.length - 1];
  const FOTO_MAX = 1600, MINI_MAX = 360;

  // ── Pohrana ──────────────────────────────────────────────────────────
  function citaj() { try { const v = JSON.parse(localStorage.getItem(KLJUC) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function pisi(l) {
    try { localStorage.setItem(KLJUC, JSON.stringify(l)); return true; }
    catch (e) { if (typeof showToast === 'function') showToast('⚠ Nema mjesta za pohranu tačaka'); return false; }
  }
  let _dbP = null;
  function db() {
    if (!_dbP) _dbP = new Promise((res, rej) => {
      const r = indexedDB.open('usf_foto', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('puna'); r.result.createObjectStore('mini'); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return _dbP;
  }
  async function idb(store, mod, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction(store, mod), st = tx.objectStore(store);
      let out; const r = fn(st); if (r) r.onsuccess = () => { out = r.result; };
      tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
    });
  }
  const _urlKes = new Map();
  async function fotoUrl(id, puna) {
    const k = (puna ? 'p:' : 'm:') + id;
    if (_urlKes.has(k)) return _urlKes.get(k);
    const blob = await idb(puna ? 'puna' : 'mini', 'readonly', st => st.get(id)).catch(() => null);
    if (!blob) return null;
    const u = URL.createObjectURL(blob); _urlKes.set(k, u); return u;
  }
  async function obrisiFoto(id) {
    ['p:', 'm:'].forEach(p => { const u = _urlKes.get(p + id); if (u) { URL.revokeObjectURL(u); _urlKes.delete(p + id); } });
    await idb('puna', 'readwrite', st => st.delete(id)).catch(() => {});
    await idb('mini', 'readwrite', st => st.delete(id)).catch(() => {});
  }

  // Smanjenje uz ispravnu orijentaciju (EXIF) — telefon snima 4000 px i 5 MB.
  async function smanji(file, max, kvalitet) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) {
      bmp = await new Promise((res, rej) => { const i = new Image(); const u = URL.createObjectURL(file); i.onload = () => { URL.revokeObjectURL(u); res(i); }; i.onerror = () => { URL.revokeObjectURL(u); rej(new Error('fotografija se ne može pročitati')); }; i.src = u; });
    }
    const w = bmp.width, h = bmp.height, s = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return new Promise(res => c.toBlob(res, 'image/jpeg', kvalitet));
  }
  async function dodajFoto(file) {
    const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const [puna, mini] = await Promise.all([smanji(file, FOTO_MAX, 0.82), smanji(file, MINI_MAX, 0.72)]);
    if (!puna || !mini) throw new Error('fotografija nije obrađena');
    await idb('puna', 'readwrite', st => st.put(puna, id));
    await idb('mini', 'readwrite', st => st.put(mini, id));
    return id;
  }

  // ── Karta ────────────────────────────────────────────────────────────
  let grp = null;
  function ikona(t) {
    const k = kat(t.kat), n = (t.foto || []).length;
    return L.divIcon({ className: '', iconSize: [34, 42], iconAnchor: [17, 40],
      html: `<div class="tk-mk" style="--c:${k.boja}"><span>${k.ik}</span>${n ? `<b>${n}</b>` : ''}</div>` });
  }
  function crtaj() {
    if (!imaKartu()) return;
    if (!grp) {
      map.createPane('tackePane');
      map.getPane('tackePane').style.zIndex = '462';
      // Klik ide kroz zajednički _kartaKlikIzvor — DOM markeri ne hvataju dodir.
      map.getPane('tackePane').style.pointerEvents = 'none';
      grp = L.layerGroup().addTo(map);
    }
    grp.clearLayers();
    citaj().filter(t => t.vis !== false).forEach(t => L.marker([t.la, t.lo], { pane: 'tackePane', icon: ikona(t), interactive: false, keyboard: false }).addTo(grp));
    const st = document.getElementById('mc-stat-tacke');
    const n = citaj().length;
    if (st) st.textContent = n ? n + (n === 1 ? ' tačka' : n < 5 ? ' tačke' : ' tačaka') : '';
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDatum = iso => { try { return new Date(iso).toLocaleString('bs-BA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
  function udaljenost(t) {
    const p = gp(); if (!p) return null;
    const d = L.latLng(p.la, p.lo).distanceTo([t.la, t.lo]);
    return d >= 1000 ? (d / 1000).toFixed(2) + ' km' : Math.round(d) + ' m';
  }
  function popupHtml(t) {
    const k = kat(t.kat), redovi = [['Vrsta', k.t], ['Koordinate', t.la.toFixed(6) + ', ' + t.lo.toFixed(6)]];
    if (typeof root.wgsToMGI5 === 'function') { try { const m = wgsToMGI5(t.la, t.lo); if (m) redovi.push(['MGI 5', 'Y ' + Math.round(m[0] ?? m.y) + ', X ' + Math.round(m[1] ?? m.x)]); } catch (e) {} }
    if (t.al > 0) redovi.push(['Nadmorska visina', Math.round(t.al) + ' m' + (t.alDem ? ' (DEM)' : '')]);
    if (Number.isFinite(t.ac)) redovi.push(['GPS tačnost', '±' + Math.round(t.ac) + ' m']);
    const ud = udaljenost(t); if (ud) redovi.push(['Od mene', ud]);
    const foto = (t.foto || []).map(id => `<img class="pk-slika tk-foto" data-foto="${id}" alt="Fotografija">`).join('');
    return _popKartica({ ikona: k.ik, boja: k.boja, naslov: t.naziv, tip: 'Terenska tačka', meta: fmtDatum(t.datum), redovi,
      opis: t.opis ? esc(t.opis).replace(/\n/g, '<br>') : '', vise: foto ? `<div class="tk-galerija">${foto}</div>` : '',
      dugmad: [
        { t: '✏ Uredi', on: `USFTacke.uredi('${t.id}')`, v: 'glavno' },
        { t: '📷 Dodaj foto', on: `USFTacke.uredi('${t.id}',true)` },
        { t: '⤓ KMZ', on: `USFTacke.izvozKmz(['${t.id}'])` },
        { t: '🗑 Briši', on: `USFTacke.obrisi('${t.id}')`, v: 'opasno' }
      ] });
  }
  async function popuniMini(el) {
    if (!el) return;
    for (const img of el.querySelectorAll('img[data-foto]')) {
      if (img.src) continue;
      const u = await fotoUrl(img.dataset.foto, false);
      if (u) img.src = u; else { img.alt = 'Fotografija nedostaje'; img.classList.add('nema'); }
    }
  }
  function otvoriPopup(t) {
    map.closePopup();
    const pop = L.popup({ maxWidth: 300, minWidth: 230, className: 'pk-pop', offset: [0, -30] }).setLatLng([t.la, t.lo]).setContent(popupHtml(t)).openOn(map);
    popuniMini(pop.getElement());
  }

  // ── Uređivač (donji list preko cijelog ekrana) ──────────────────────
  let ured = null; // { t, novo, foto:[], obrisane:[] }
  function sheet() {
    let el = document.getElementById('tk-sheet');
    if (el) return el;
    el = document.createElement('div'); el.id = 'tk-sheet';
    el.innerHTML = `<div class="tk-ov" data-a="otkazi"></div><div class="tk-list" role="dialog" aria-label="Terenska tačka">
      <div class="tk-hdr"><b id="tk-naslov">Nova tačka</b><button data-a="otkazi" aria-label="Zatvori">✕</button></div>
      <div class="tk-tijelo">
        <label class="tk-pol">Naziv<input id="tk-naziv" maxlength="80" autocomplete="off"></label>
        <div class="tk-pol">Vrsta<div id="tk-kat" class="tk-kat"></div></div>
        <label class="tk-pol">Bilješka<textarea id="tk-opis" rows="3" maxlength="2000" placeholder="npr. prsni promjer, vrsta, stanje, šta treba uraditi…"></textarea></label>
        <div class="tk-pol">Fotografije <small id="tk-fbroj"></small>
          <div id="tk-foto" class="tk-foto-grid"></div>
          <div class="tk-foto-akc"><label class="tk-btn glavno">📷 Kamera<input type="file" accept="image/*" capture="environment" data-a="kamera" hidden></label><label class="tk-btn">🖼 Galerija<input type="file" accept="image/*" multiple data-a="galerija" hidden></label></div>
        </div>
        <div class="tk-pol tk-poz"><span id="tk-poz"></span><button class="tk-btn" data-a="gps">🎯 Na moju poziciju</button></div>
      </div>
      <div class="tk-dno"><button class="tk-btn opasno" data-a="obrisi" id="tk-obrisi">🗑</button><button class="tk-btn" data-a="otkazi">Otkaži</button><button class="tk-btn glavno" data-a="sacuvaj">💾 Sačuvaj</button></div>
    </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'otkazi') zatvoriUred(); else if (a === 'sacuvaj') sacuvaj(); else if (a === 'obrisi' && ured && !ured.novo) obrisi(ured.t.id, true);
      else if (a === 'gps') naMojuPoziciju(); else if (a === 'ukloni') { const id = e.target.closest('[data-id]').dataset.id; ured.foto = ured.foto.filter(x => x !== id); if (!ured.nove.includes(id)) ured.obrisane.push(id); fotoGrid(); }
      else if (a === 'vidi') { const id = e.target.closest('[data-id]').dataset.id; fotoUrl(id, true).then(u => u && _slikaPrikazi(u, document.getElementById('tk-naziv').value)); }
      const k = e.target.closest('[data-kat]'); if (k && ured) { ured.t.kat = k.dataset.kat; katChips(); }
    });
    el.addEventListener('change', async e => {
      const inp = e.target; if (!inp.files || !inp.files.length || !ured) return;
      const fs = [...inp.files]; inp.value = '';
      const n0 = ured.foto.length;
      document.getElementById('tk-fbroj').textContent = 'obrađujem ' + fs.length + '…';
      for (const f of fs) {
        try { const id = await dodajFoto(f); ured.foto.push(id); ured.nove.push(id); }
        catch (err) { if (typeof showToast === 'function') showToast('⚠ ' + (err.message || 'fotografija nije dodana')); }
      }
      fotoGrid();
      if (ured.foto.length > n0 && typeof showToast === 'function') showToast('📷 Dodano ' + (ured.foto.length - n0) + ' fotografija');
    });
    return el;
  }
  function katChips() {
    document.getElementById('tk-kat').innerHTML = KATEGORIJE.map(k => `<button type="button" data-kat="${k.k}" class="${ured.t.kat === k.k ? 'on' : ''}" style="--c:${k.boja}"><span>${k.ik}</span>${esc(k.t)}</button>`).join('');
  }
  async function fotoGrid() {
    const g = document.getElementById('tk-foto');
    g.innerHTML = ured.foto.map(id => `<div class="tk-f" data-id="${id}"><img data-a="vidi" data-foto="${id}" alt=""><button data-a="ukloni" aria-label="Ukloni fotografiju">✕</button></div>`).join('');
    document.getElementById('tk-fbroj').textContent = ured.foto.length ? '(' + ured.foto.length + ')' : '';
    popuniMini(g);
  }
  function pozTxt() {
    const t = ured.t;
    document.getElementById('tk-poz').innerHTML = `${t.la.toFixed(6)}, ${t.lo.toFixed(6)}${Number.isFinite(t.ac) ? ` · <b>±${Math.round(t.ac)} m</b>` : ''}${t.al > 0 ? ` · ${Math.round(t.al)} m n.v.${t.alDem ? ' (DEM)' : ''}` : ''}`;
  }
  function naMojuPoziciju() {
    const p = gp();
    if (!p) { if (typeof showToast === 'function') showToast('⚠ Nema GPS pozicije — uključi GPS'); return; }
    Object.assign(ured.t, { la: p.la, lo: p.lo, al: p.al, ac: p.ac }); pozTxt();
  }
  function otvoriUred(t, novo, odmahFoto) {
    const el = sheet();
    ured = { t: { ...t }, novo, foto: Array.isArray(t.foto) ? [...t.foto] : [], nove: [], obrisane: [] };
    document.getElementById('tk-naslov').textContent = novo ? 'Nova terenska tačka' : 'Uredi tačku';
    document.getElementById('tk-naziv').value = t.naziv || '';
    document.getElementById('tk-opis').value = t.opis || '';
    document.getElementById('tk-obrisi').style.display = novo ? 'none' : '';
    katChips(); fotoGrid(); pozTxt();
    el.classList.add('show');
    map.closePopup();
    if (odmahFoto) setTimeout(() => el.querySelector('input[data-a="kamera"]').click(), 60);
  }
  async function zatvoriUred() {
    if (ured) for (const id of ured.nove) await obrisiFoto(id); // nesačuvane nove fotografije
    ured = null;
    document.getElementById('tk-sheet')?.classList.remove('show');
  }
  async function sacuvaj() {
    if (!ured) return;
    const t = ured.t;
    t.naziv = document.getElementById('tk-naziv').value.trim() || kat(t.kat).t;
    t.opis = document.getElementById('tk-opis').value.trim();
    t.foto = ured.foto.slice();
    const l = citaj(), i = l.findIndex(x => x.id === t.id);
    if (i >= 0) l[i] = t; else l.unshift(t);
    if (!pisi(l)) return;
    for (const id of ured.obrisane) await obrisiFoto(id);
    ured.nove = []; const novo = ured.novo;
    ured = null;
    document.getElementById('tk-sheet')?.classList.remove('show');
    crtaj(); renderLista();
    if (typeof showToast === 'function') showToast((novo ? '📍 Sačuvano: ' : '✅ Ažurirano: ') + t.naziv + (t.foto.length ? ' · ' + t.foto.length + ' foto' : ''));
  }

  // ── Javni API ────────────────────────────────────────────────────────
  function nova(la, lo, dod) {
    const p = gp();
    // gps/foto su zastavice, ne polja tačke — foto:true bi pregazio listu fotografija
    const { gps, foto: odmahFoto, ...ostalo } = dod || {};
    const t = { id: 'tk' + Date.now().toString(36), datum: new Date().toISOString(), kat: 'stablo', naziv: '', opis: '', vis: true,
      la, lo, ...ostalo, foto: [] };
    if (p && gps) Object.assign(t, { al: p.al, ac: p.ac });
    otvoriUred(t, true, !!odmahFoto);
    // GPS često ne daje visinu (0) — uzmi je iz ugrađenog DEM-a (offline u 5 općina).
    if (!(t.al > 0) && typeof _msrFetchElev === 'function') _msrFetchElev(t.la, t.lo).then(h => {
      if (ured && ured.t.id === t.id && Number.isFinite(h)) { ured.t.al = h; ured.t.alDem = true; pozTxt(); }
    }).catch(() => {});
  }
  function naGps(foto) {
    const p = gp();
    if (!p) { if (typeof showToast === 'function') showToast('⚠ Nema GPS pozicije — uključi GPS ili izaberi mjesto na karti'); return false; }
    nova(p.la, p.lo, { gps: true, foto });
    return true;
  }
  let _biraj = false;
  function naKarti() {
    _biraj = true; root._npHvataKlik = true;
    if (typeof showToast === 'function') showToast('👆 Dodirni kartu na mjesto tačke');
    map.getContainer().style.cursor = 'crosshair';
    map.once('click', e => { _biraj = false; root._npHvataKlik = false; map.getContainer().style.cursor = ''; nova(e.latlng.lat, e.latlng.lng); });
  }
  async function dodaj() {
    if (typeof _dlgActions !== 'function') { naGps(); return; }
    const izbor = await _dlgActions('📍 Nova terenska tačka', [
      { label: '📷 Slikaj na mojoj GPS poziciji' }, { label: '🎯 Tačka na mojoj GPS poziciji' },
      { label: '👆 Izaberi mjesto na karti' }, { label: '➕ U centru karte' }]);
    if (izbor === 0) naGps(true); else if (izbor === 1) naGps(false);
    else if (izbor === 2) naKarti(); else if (izbor === 3) { const c = map.getCenter(); nova(c.lat, c.lng); }
  }
  async function obrisi(id, izUreda) {
    const l = citaj(), t = l.find(x => x.id === id); if (!t) return;
    const ok = typeof _dlgConfirm === 'function' ? await _dlgConfirm('Obrisati tačku "' + t.naziv + '"' + ((t.foto || []).length ? ' i ' + t.foto.length + ' fotografija' : '') + '?', { title: 'Obriši tačku', danger: true, okLabel: 'Obriši' }) : true;
    if (!ok) return;
    for (const f of t.foto || []) await obrisiFoto(f);
    pisi(l.filter(x => x !== t));
    if (izUreda) { ured = null; document.getElementById('tk-sheet')?.classList.remove('show'); }
    map.closePopup(); crtaj(); renderLista();
  }
  function uredi(id, foto) { const t = citaj().find(x => x.id === id); if (t) otvoriUred(t, false, foto); }
  function zoom(id) {
    const t = citaj().find(x => x.id === id); if (!t) return;
    if (typeof switchMainTab === 'function') switchMainTab('karta');
    map.setView([t.la, t.lo], Math.max(map.getZoom(), 17));
    setTimeout(() => otvoriPopup(t), 350);
  }
  function prikazi(id) { const l = citaj(), t = l.find(x => x.id === id); if (!t) return; t.vis = t.vis === false; pisi(l); crtaj(); renderLista(); }

  // ── Lista (panel) ────────────────────────────────────────────────────
  function renderLista() {
    const el = document.getElementById('tacke-lista'); if (!el) return;
    const l = citaj();
    const br = document.getElementById('tacke-broj'); if (br) br.textContent = l.length ? '(' + l.length + ')' : '';
    el.innerHTML = l.length ? l.map(t => {
      const k = kat(t.kat), ud = udaljenost(t);
      return `<div class="tk-red${t.vis === false ? ' skriven' : ''}">
        <div class="tk-mini" style="--c:${k.boja}">${(t.foto || []).length ? `<img data-foto="${t.foto[0]}" alt="">` : `<span>${k.ik}</span>`}</div>
        <div class="tk-info"><b>${esc(t.naziv)}</b><small>${esc(k.t)} · ${fmtDatum(t.datum)}${(t.foto || []).length ? ' · 📷 ' + t.foto.length : ''}${ud ? ' · ' + ud : ''}</small></div>
        <div class="tk-red-akc"><button onclick="USFTacke.zoom('${t.id}')">🗺 Karta</button><button onclick="USFTacke.uredi('${t.id}')">✏ Uredi</button><button onclick="USFTacke.prikazi('${t.id}')">${t.vis === false ? '○ Skrivena' : '● Na karti'}</button></div>
      </div>`;
    }).join('') : '<div class="treg-empty">Još nema terenskih tačaka.<br>Dodaj ih dugmetom 📍 na karti — sa fotografijom ili bez.</div>';
    popuniMini(el);
  }
  function otvoriListu() {
    if (typeof _ALL_PANELS !== 'undefined') _ALL_PANELS.forEach(id => document.getElementById(id)?.classList.remove('show'));
    renderLista(); document.getElementById('tacke-panel')?.classList.add('show');
  }
  function zatvoriListu() { document.getElementById('tacke-panel')?.classList.remove('show'); }

  // ── KMZ izvoz (ZIP bez kompresije: JPEG se ionako ne sabija) ─────────
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(fajlovi) {
    const enc = new TextEncoder(), dijelovi = [], cd = []; let off = 0;
    for (const [ime, podaci] of fajlovi) {
      const nb = enc.encode(ime), crc = crc32(podaci), lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, podaci.length, true); lh.setUint32(22, podaci.length, true); lh.setUint16(26, nb.length, true);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, podaci.length, true); ch.setUint32(24, podaci.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, off, true);
      dijelovi.push(new Uint8Array(lh.buffer), nb, podaci); cd.push(new Uint8Array(ch.buffer), nb);
      off += 30 + nb.length + podaci.length;
    }
    const cdLen = cd.reduce((s, x) => s + x.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, fajlovi.length, true); e.setUint16(10, fajlovi.length, true); e.setUint32(12, cdLen, true); e.setUint32(16, off, true);
    return new Blob([...dijelovi, ...cd, new Uint8Array(e.buffer)], { type: 'application/vnd.google-earth.kmz' });
  }
  const xml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const kmlBoja = hex => { const h = hex.replace('#', ''); return 'ff' + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2); };
  async function izvozKmz(ids) {
    const sve = citaj(), l = ids ? sve.filter(t => ids.includes(t.id)) : sve;
    if (!l.length) { if (typeof showToast === 'function') showToast('Nema tačaka za izvoz'); return; }
    if (typeof showToast === 'function') showToast('⏳ Pakujem KMZ…');
    const fajlovi = [];
    const stilovi = KATEGORIJE.map(k => `<Style id="${k.k}"><IconStyle><color>${kmlBoja(k.boja)}</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/wht-circle.png</href></Icon></IconStyle></Style>`).join('');
    const pm = [];
    for (const t of l) {
      const slike = [];
      for (const id of t.foto || []) {
        const b = await idb('puna', 'readonly', st => st.get(id)).catch(() => null);
        if (b) { fajlovi.push(['files/' + id + '.jpg', new Uint8Array(await b.arrayBuffer())]); slike.push(`<img src="files/${id}.jpg" width="480"><br>`); }
      }
      const k = kat(t.kat);
      const opis = `<b>${xml(k.t)}</b><br>${xml(fmtDatum(t.datum))}${Number.isFinite(t.ac) ? ' · GPS ±' + Math.round(t.ac) + ' m' : ''}<br>${xml(t.opis).replace(/\n/g, '<br>')}<br>${slike.join('')}`;
      const ext = [['vrsta', k.t], ['datum', t.datum], ['biljeska', t.opis], ['gps_tacnost_m', Number.isFinite(t.ac) ? Math.round(t.ac) : ''], ['visina_m', t.al > 0 ? Math.round(t.al) : ''], ['fotografija', (t.foto || []).length]];
      pm.push(`<Placemark><name>${xml(t.naziv)}</name><styleUrl>#${k.k}</styleUrl><description><![CDATA[${opis}]]></description><ExtendedData>${ext.map(([n, v]) => `<Data name="${n}"><value>${xml(v)}</value></Data>`).join('')}</ExtendedData><Point><coordinates>${t.lo},${t.la}${t.al > 0 ? ',' + Math.round(t.al) : ''}</coordinates></Point></Placemark>`);
    }
    const naziv = l.length === 1 ? l[0].naziv : 'Terenske tačke ' + new Date().toLocaleDateString('bs-BA');
    const kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(naziv)}</name>${stilovi}\n${pm.join('\n')}\n</Document></kml>`;
    fajlovi.unshift(['doc.kml', new TextEncoder().encode(kml)]);
    const ime = naziv.normalize('NFKD').replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').slice(0, 50) + '.kmz';
    if (typeof _izvozFajl === 'function') _izvozFajl(ime, zip(fajlovi), 'application/vnd.google-earth.kmz', naziv);
  }

  // Klik na kartu: tačke imaju prednost (vrsta 'tacka'); vrh igle je ~24 px iznad koordinate.
  function registruj() {
    if (typeof _kartaKlikIzvor !== 'function') return;
    _kartaKlikIzvor((ll, kp) => citaj().filter(t => t.vis !== false).map(t => {
      const p = map.latLngToContainerPoint([t.la, t.lo]);
      const d = Math.min(kp.distanceTo(p), kp.distanceTo(L.point(p.x, p.y - 24)));
      return { vrsta: 'tacka', d: Math.max(0, d - 6), otvori: () => otvoriPopup(t) };
    }));
  }

  root.USFTacke = { KATEGORIJE, citaj, dodaj, nova, naGps, naKarti, uredi, obrisi, zoom, prikazi, izvozKmz, otvoriListu, zatvoriListu, fotoUrl, crtaj, zip, crc32, renderLista };
  if (typeof module !== 'undefined') module.exports = { zip, crc32, KATEGORIJE };
  if (typeof L !== 'undefined' && imaKartu()) { registruj(); crtaj(); renderLista(); }
})(typeof window !== 'undefined' ? window : globalThis);
