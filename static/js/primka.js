// Primka drvne mase. Projekat = sjekački projekat + partije koje primalac preuzima.
// Partija je zelena kad je roba primljena, crvena dok nije (providnost po izboru).
// Unosi m³ po danu i partiji, s podatkom od koga je primljeno. Fotografije zapažanja
// idu u isti IndexedDB kao terenske tačke (USFTacke.dodajFoto). Sve radi offline (localStorage).
(function (root) {
  'use strict';

  const SORTIMENTI = ['Trupci', 'Tehnička oblovina', 'Celulozno drvo', 'Ogrjevno drvo', 'Ostalo'];

  // ── Čiste funkcije (testovi) ───────────────────────────────────────────
  const r2 = v => Math.round(v * 100) / 100;
  function pkSume(pr) {
    const poPartiji = {}, poDanu = {}, poSortimentu = {};
    let ukupno = 0;
    (pr.unosi || []).forEach(u => {
      const m = Number(u.m3) || 0;
      ukupno += m;
      poPartiji[u.lid] = r2((poPartiji[u.lid] || 0) + m);
      poDanu[u.datum] = r2((poDanu[u.datum] || 0) + m);
      if (u.sortiment) poSortimentu[u.sortiment] = r2((poSortimentu[u.sortiment] || 0) + m);
    });
    const lids = Object.keys(pr.partije || {});
    return { ukupno: r2(ukupno), poPartiji, poDanu, poSortimentu, partija: lids.length,
      primljeno: lids.filter(l => pr.partije[l] && pr.partije[l].primljeno).length,
      dana: Object.keys(poDanu).length };
  }
  // CSV (;) za Excel: unosi po danima, zatim zbir po partiji.
  function pkCsv(pr, oznake) {
    const q = v => { const t = String(v ?? ''); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const oz = lid => (oznake && oznake[lid]) || lid, br = v => String(v).replace('.', ',');
    const s = pkSume(pr);
    const red = [['Projekat', pr.naziv], ['Izvođač / od koga', pr.izvodjac || ''], [], ['Datum', 'Partija', 'm3', 'Sortiment', 'Od koga', 'Napomena']];
    (pr.unosi || []).slice().sort((a, b) => a.datum.localeCompare(b.datum)).forEach(u => red.push([u.datum, oz(u.lid), br(u.m3), u.sortiment || '', u.odKoga || '', u.napomena || '']));
    red.push([], ['Partija', 'Status', 'm3 ukupno']);
    Object.keys(pr.partije || {}).forEach(l => red.push([oz(l), pr.partije[l].primljeno ? 'primljeno' : 'neprimljeno', br(s.poPartiji[l] || 0)]));
    red.push([], ['UKUPNO m3', br(s.ukupno)]);
    return '﻿' + red.map(r => r.map(q).join(';')).join('\r\n');
  }
  const pkDanas = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

  if (typeof module !== 'undefined' && module.exports) { module.exports = { pkSume, pkCsv, pkDanas, SORTIMENTI }; return; }

  // ── Pohrana ───────────────────────────────────────────────────────────
  const KLJUC = 'usf_primka';
  const citaj = () => { try { const v = JSON.parse(localStorage.getItem(KLJUC) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  function pisi(l) {
    try { localStorage.setItem(KLJUC, JSON.stringify(l)); return true; }
    catch (e) { showToast('⚠ Primka nije sačuvana — memorija puna'); return false; }
  }
  const nadji = id => citaj().find(p => p.id === id);
  function sacuvaj(pr) { const l = citaj(), i = l.findIndex(x => x.id === pr.id); if (i >= 0) l[i] = pr; else l.unshift(pr); const ok = pisi(l); crtaj(); return ok; }
  const esc = t => (typeof _escHtml === 'function' ? _escHtml(t) : String(t ?? ''));
  const fmt = (v, d = 2) => Number(v || 0).toLocaleString('bs-BA', { minimumFractionDigits: 0, maximumFractionDigits: d });
  let aktivni = null;

  // ── Geometrija partija iz sjekačkih linija (keš dok se projekat ne promijeni) ──
  const geoKes = new Map();
  function partijeGeo(sid) {
    if (!root.USFSjek || !USFSjek.partije) return null;
    const pot = sid + ':' + (localStorage.getItem('usf_sjekacke') || '').length;
    const k = geoKes.get(sid);
    if (k && k.pot === pot) return k.p;
    const p = USFSjek.partije(sid);
    geoKes.set(sid, { pot, p });
    return p;
  }
  const oznakeZa = pr => Object.fromEntries((partijeGeo(pr.sid) || []).map(x => [x.lid, x.oznaka]));

  // ── Karta ─────────────────────────────────────────────────────────────
  map.createPane('primkaPane'); map.getPane('primkaPane').style.zIndex = '412'; map.getPane('primkaPane').style.pointerEvents = 'none';
  const grp = L.layerGroup().addTo(map);
  let poligoni = [], foto = [];
  function crtaj() {
    grp.clearLayers(); poligoni = []; foto = [];
    citaj().filter(pr => pr.vidljiv !== false).forEach(pr => {
      const geo = partijeGeo(pr.sid) || [], prov = (pr.prov ?? 35) / 100;
      geo.filter(g => pr.partije && pr.partije[g.lid] && g.prsteni.length).forEach(g => {
        const ok = !!pr.partije[g.lid].primljeno, c = ok ? '#22c55e' : '#ef4444';
        const l = L.polygon(g.prsteni, { pane: 'primkaPane', color: c, weight: 1.5, opacity: Math.min(1, prov + 0.35), fillColor: c, fillOpacity: prov, fillRule: 'evenodd', interactive: false }).addTo(grp);
        poligoni.push({ pr, g, l });
      });
      (pr.foto || []).filter(f => Number.isFinite(f.la)).forEach(f => {
        const m = L.marker([f.la, f.lo], { pane: 'primkaPane', interactive: false, icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: '<div class="pkm-foto-ik">📷</div>' }) }).addTo(grp);
        foto.push({ pr, f, m });
      });
    });
  }
  if (typeof _kartaKlikIzvor === 'function') _kartaKlikIzvor((ll, kp) => {
    const out = [], lp = map.latLngToLayerPoint(ll);
    poligoni.forEach(({ pr, g, l }) => {
      let u = false; try { u = !!l._containsPoint(lp); } catch (e) {}
      if (u) out.push({ vrsta: 'poligon', pov: _pxPovrsina(g.prsteni[0].map(q => L.latLng(q[0], q[1]))), otvori: at => popupPartija(pr.id, g.lid, at) });
    });
    foto.forEach(({ pr, f }) => out.push({ vrsta: 'tacka', d: kp.distanceTo(map.latLngToContainerPoint([f.la, f.lo])), otvori: () => prikaziFoto(pr.id, f.id) }));
    return out;
  });
  function popupPartija(pid, lid, at) {
    const pr = nadji(pid); if (!pr) return;
    const g = (partijeGeo(pr.sid) || []).find(x => x.lid === lid), s = pkSume(pr), st = pr.partije[lid] || {};
    const unosi = (pr.unosi || []).filter(u => u.lid === lid), zadnji = unosi.map(u => u.datum).sort().pop();
    const redovi = [['Projekat', pr.naziv], ['Površina', g && g.ha != null ? fmt(g.ha) + ' ha' : '—'], ['Primljeno', fmt(s.poPartiji[lid] || 0) + ' m³ (' + unosi.length + ' unosa)'], ['Status', st.primljeno ? '✓ primljena roba' : '✕ nije primljeno']];
    if (zadnji) redovi.push(['Zadnji unos', zadnji]);
    if (st.odKoga || pr.izvodjac) redovi.push(['Od koga', st.odKoga || pr.izvodjac]);
    L.popup({ maxWidth: 300, minWidth: 220, className: 'pk-pop' }).setLatLng(at).setContent(_popKartica({
      ikona: '📦', boja: st.primljeno ? '#22c55e' : '#ef4444', naslov: 'Partija ' + (g ? g.oznaka : ''), tip: 'Primka', redovi, dugmad: [
        { t: '➕ Unos m³', on: `USFPrimka.unos('${pid}','${lid}')`, v: 'glavno' },
        { t: st.primljeno ? '↺ Neprimljeno' : '✓ Primljeno', on: `USFPrimka.status('${pid}','${lid}')` },
        { t: '📂 Projekat', on: `USFPrimka.otvori('${pid}')` }] })).openOn(map);
  }

  // ── Obrasci (list na dnu ekrana) ─────────────────────────────────────
  function obrazac(naslov, tijelo, okTekst) {
    return new Promise(res => {
      document.getElementById('pk-obr')?.remove();
      const el = document.createElement('div'); el.id = 'pk-obr';
      el.innerHTML = `<div class="ks-ov" data-x="0"></div><form class="ks-list"><b>${esc(naslov)}</b>${tijelo}<div class="ks-akc"><button type="button" data-x="0">Odustani</button><button type="submit" class="glavno">${okTekst || '✓ Sačuvaj'}</button></div></form>`;
      document.body.appendChild(el);
      const kraj = v => { el.remove(); res(v); };
      el.addEventListener('click', e => { if (e.target.closest('[data-x="0"]')) kraj(null); });
      el.querySelector('form').addEventListener('submit', e => { e.preventDefault(); kraj(new FormData(e.target)); });
      el.querySelector('input,select')?.focus();
    });
  }
  const polje = (lbl, html) => `<label class="pkm-polje"><span>${lbl}</span>${html}</label>`;

  // ── Akcije ────────────────────────────────────────────────────────────
  async function novi() {
    const sj = root.USFSjek && USFSjek.projekti ? USFSjek.projekti() : [];
    if (!sj.length) { showToast('⚠ Prvo napravi sjekačke linije — primka se vodi po njihovim partijama'); return; }
    const f = await obrazac('📦 Novi projekat primke',
      polje('Naziv', '<input name="naziv" required maxlength="80" placeholder="npr. Odjel 12 — primka 2026">') +
      polje('Sjekački projekat (partije)', `<select name="sid">${sj.map(p => `<option value="${esc(p.id)}">${esc(p.naziv)} · ${p.linija} linija</option>`).join('')}</select>`) +
      polje('Kod koga se prima (izvođač radova)', '<input name="izvodjac" maxlength="80" placeholder="firma ili ime">'), '➡ Dalje: partije');
    if (!f) return;
    const pr = { id: 'pk' + Date.now().toString(36), naziv: String(f.get('naziv')).trim(), sid: String(f.get('sid')), izvodjac: String(f.get('izvodjac') || '').trim(),
      datum: new Date().toISOString(), partije: {}, unosi: [], foto: [], prov: 35, vidljiv: true };
    sacuvaj(pr); aktivni = pr.id;
    await izborPartija(pr.id);
    otvori(pr.id);
  }
  async function izborPartija(pid) {
    const pr = nadji(pid); if (!pr) return;
    const geo = partijeGeo(pr.sid);
    if (!geo) { showToast('⚠ Sjekački projekat više ne postoji'); return; }
    const f = await obrazac('🪓 Partije koje prima — ' + pr.naziv,
      `<div class="pkm-chk-akc"><button type="button" onclick="this.closest('form').querySelectorAll('input[type=checkbox]').forEach(c=>c.checked=true)">Sve</button><button type="button" onclick="this.closest('form').querySelectorAll('input[type=checkbox]').forEach(c=>c.checked=false)">Nijedna</button></div>
      <div class="pkm-chk">${geo.map(g => `<label><input type="checkbox" name="p" value="${esc(g.lid)}" ${pr.partije[g.lid] ? 'checked' : ''}> <b>${esc(g.oznaka)}</b><small>${g.ha != null ? fmt(g.ha) + ' ha' : ''}</small></label>`).join('')}</div>`);
    if (!f) return;
    const izbor = new Set(f.getAll('p'));
    const nove = {};
    izbor.forEach(l => { nove[l] = pr.partije[l] || { primljeno: false }; });
    pr.partije = nove; sacuvaj(pr); render();
    showToast('🪓 ' + izbor.size + ' partija u primci');
  }
  async function unos(pid, lid, uid) {
    const pr = nadji(pid); if (!pr) return;
    map.closePopup();
    const geo = partijeGeo(pr.sid) || [], moje = geo.filter(g => pr.partije[g.lid]);
    if (!moje.length) { showToast('⚠ Projekat nema izabranih partija'); izborPartija(pid); return; }
    const st = uid ? (pr.unosi || []).find(u => u.id === uid) : null;
    const zad = (pr.unosi || [])[0] || {};
    const f = await obrazac(st ? '✏ Izmijeni unos' : '➕ Primljena drvna masa',
      polje('Datum', `<input type="date" name="datum" required value="${esc(st ? st.datum : pkDanas())}">`) +
      polje('Partija', `<select name="lid">${moje.map(g => `<option value="${esc(g.lid)}" ${(st ? st.lid : lid || zad.lid) === g.lid ? 'selected' : ''}>${esc(g.oznaka)}${g.ha != null ? ' · ' + fmt(g.ha) + ' ha' : ''}</option>`).join('')}</select>`) +
      polje('Količina (m³)', `<input type="text" name="m3" required inputmode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" placeholder="npr. 12,5" value="${st ? String(st.m3).replace('.', ',') : ''}">`) +
      polje('Sortiment', `<select name="sortiment"><option value="">—</option>${SORTIMENTI.map(s => `<option ${(st ? st.sortiment : zad.sortiment) === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`) +
      polje('Od koga (izvođač / radnik)', `<input name="odKoga" maxlength="80" value="${esc(st ? st.odKoga || '' : zad.odKoga || pr.izvodjac || '')}">`) +
      polje('Napomena', `<input name="napomena" maxlength="200" value="${esc(st ? st.napomena || '' : '')}">`));
    if (!f) return;
    const m3 = parseFloat(String(f.get('m3')).replace(',', '.'));
    if (!(m3 >= 0)) { showToast('⚠ Neispravna količina'); return; }
    const u = { id: st ? st.id : 'u' + Date.now().toString(36), datum: String(f.get('datum')), lid: String(f.get('lid')), m3: r2(m3),
      sortiment: String(f.get('sortiment') || ''), odKoga: String(f.get('odKoga') || '').trim(), napomena: String(f.get('napomena') || '').trim(), t: Date.now() };
    pr.unosi = (pr.unosi || []).filter(x => x.id !== u.id); pr.unosi.unshift(u);
    sacuvaj(pr); render();
    showToast('📦 ' + fmt(u.m3) + ' m³ · ' + ((geo.find(g => g.lid === u.lid) || {}).oznaka || ''));
  }
  async function obrisiUnos(pid, uid) {
    const pr = nadji(pid); if (!pr) return;
    if (!await _dlgConfirm('Obrisati ovaj unos drvne mase?', { danger: true, okLabel: 'Obriši' })) return;
    pr.unosi = (pr.unosi || []).filter(u => u.id !== uid); sacuvaj(pr); render();
  }
  function status(pid, lid) {
    const pr = nadji(pid); if (!pr || !pr.partije[lid]) return;
    const st = pr.partije[lid]; st.primljeno = !st.primljeno; st.t = Date.now();
    sacuvaj(pr); render(); map.closePopup();
    showToast(st.primljeno ? '✓ Partija primljena (zeleno)' : '↺ Partija vraćena na neprimljeno (crveno)');
  }
  function prov(pid, v) { const pr = nadji(pid); if (!pr) return; pr.prov = Math.max(5, Math.min(90, +v)); sacuvaj(pr); const e = document.getElementById('pk-prov-v'); if (e) e.textContent = pr.prov + ' %'; }
  function vidljiv(pid) { const pr = nadji(pid); if (!pr) return; pr.vidljiv = pr.vidljiv === false; sacuvaj(pr); render(); }
  function naKarti(pid) {
    const pr = nadji(pid); if (!pr) return;
    if (pr.vidljiv === false) { pr.vidljiv = true; sacuvaj(pr); }
    const geo = (partijeGeo(pr.sid) || []).filter(g => pr.partije[g.lid] && g.prsteni.length);
    if (!geo.length) { showToast('⚠ Nema partija za prikaz'); return; }
    const b = L.latLngBounds(geo.flatMap(g => g.prsteni.flat()));
    switchMainTab('karta'); map.fitBounds(b, { padding: [30, 30] });
  }
  async function obrisi(pid) {
    const pr = nadji(pid); if (!pr) return;
    if (!await _dlgConfirm('Obrisati projekat primke „' + pr.naziv + '” sa svim unosima i fotografijama?', { danger: true, okLabel: 'Obriši' })) return;
    for (const f of pr.foto || []) { try { await USFTacke.obrisiFoto(f.id); } catch (e) {} }
    pisi(citaj().filter(p => p.id !== pid)); aktivni = null; crtaj(); render();
  }
  async function izmijeni(pid) {
    const pr = nadji(pid); if (!pr) return;
    const f = await obrazac('✏ Projekat primke', polje('Naziv', `<input name="naziv" required maxlength="80" value="${esc(pr.naziv)}">`) + polje('Kod koga se prima (izvođač radova)', `<input name="izvodjac" maxlength="80" value="${esc(pr.izvodjac || '')}">`) + polje('Bilješka', `<input name="biljeska" maxlength="300" value="${esc(pr.biljeska || '')}">`));
    if (!f) return;
    pr.naziv = String(f.get('naziv')).trim(); pr.izvodjac = String(f.get('izvodjac') || '').trim(); pr.biljeska = String(f.get('biljeska') || '').trim();
    sacuvaj(pr); render();
  }
  // Fotografije zapažanja: pozicija = GPS ako postoji, inače centar karte.
  async function dodajFoto(pid, input) {
    const pr = nadji(pid); if (!pr || !input.files || !input.files.length) return;
    const fajlovi = [...input.files]; input.value = '';
    if (!root.USFTacke || !USFTacke.dodajFoto) { showToast('⚠ Fotografije nisu dostupne'); return; }
    const gps = typeof lastP !== 'undefined' && lastP ? lastP : null, c = map.getCenter();
    const opis = await _dlgPrompt('Zapažanje (opis fotografije)', '', { title: '📷 Zapažanje', okLabel: 'Sačuvaj' });
    let n = 0;
    for (const f of fajlovi) {
      try { const id = await USFTacke.dodajFoto(f); (pr.foto = pr.foto || []).unshift({ id, la: gps ? gps.la : c.lat, lo: gps ? gps.lo : c.lng, gps: !!gps, opis: (opis || '').trim(), datum: new Date().toISOString() }); n++; }
      catch (e) { showToast('⚠ ' + (e.message || 'fotografija nije dodana')); }
    }
    if (n) { sacuvaj(pr); render(); showToast('📷 Dodano ' + n + (gps ? ' (GPS pozicija)' : ' (centar karte)')); }
  }
  async function prikaziFoto(pid, fid) {
    const pr = nadji(pid), f = pr && (pr.foto || []).find(x => x.id === fid); if (!f) return;
    const u = await USFTacke.fotoUrl(fid, true);
    if (u && typeof _slikaPrikazi === 'function') _slikaPrikazi(u, (f.opis || 'Zapažanje') + ' · ' + new Date(f.datum).toLocaleDateString('bs-BA'));
  }
  async function obrisiFoto(pid, fid) {
    const pr = nadji(pid); if (!pr) return;
    if (!await _dlgConfirm('Obrisati fotografiju?', { danger: true, okLabel: 'Obriši' })) return;
    try { await USFTacke.obrisiFoto(fid); } catch (e) {}
    pr.foto = (pr.foto || []).filter(f => f.id !== fid); sacuvaj(pr); render();
  }
  function izvoz(pid) {
    const pr = nadji(pid); if (!pr) return;
    const ime = 'Primka_' + pr.naziv.replace(/[^\wčćšđžČĆŠĐŽ-]+/g, '_') + '.csv';
    if (typeof _izvozFajl === 'function') _izvozFajl(ime, pkCsv(pr, oznakeZa(pr)), 'text/csv', 'Primka: ' + pr.naziv);
  }

  // ── Panel ─────────────────────────────────────────────────────────────
  function render() {
    const el = document.getElementById('pk-sadrzaj'); if (!el) return;
    const sve = citaj(), pr = aktivni && sve.find(p => p.id === aktivni);
    if (!pr) { aktivni = null; el.innerHTML = lista(sve); return; }
    el.innerHTML = detalj(pr);
    el.querySelectorAll('img[data-foto]').forEach(async img => { const u = await USFTacke.fotoUrl(img.dataset.foto, false); if (u) img.src = u; });
  }
  function lista(sve) {
    if (!sve.length) return `<div class="ul-prazno"><b>📦</b>Još nema projekata primke.<br>Primka se vodi po partijama sjekačkih linija.</div>`;
    return sve.map(pr => {
      const s = pkSume(pr), pct = s.partija ? Math.round(s.primljeno / s.partija * 100) : 0;
      return `<div class="pkm-proj" onclick="USFPrimka.otvori('${pr.id}')"><div class="pkm-proj-zag"><b>📦 ${esc(pr.naziv)}</b><small>${esc(pr.izvodjac || 'izvođač nije upisan')} · ${fmt(s.ukupno)} m³ · ${s.dana} dana</small></div>
        <div class="pkm-traka"><u style="width:${pct}%"></u></div><small class="pkm-traka-txt">Primljeno ${s.primljeno} od ${s.partija} partija (${pct} %)</small></div>`;
    }).join('');
  }
  function detalj(pr) {
    const s = pkSume(pr), geo = partijeGeo(pr.sid), sjNaziv = ((root.USFSjek && USFSjek.projekti() || []).find(p => p.id === pr.sid) || {}).naziv;
    const moje = (geo || []).filter(g => pr.partije[g.lid]);
    const haUk = moje.reduce((a, g) => a + (g.ha || 0), 0), haOk = moje.filter(g => pr.partije[g.lid].primljeno).reduce((a, g) => a + (g.ha || 0), 0);
    const oz = Object.fromEntries((geo || []).map(g => [g.lid, g.oznaka]));
    const dani = Object.keys(s.poDanu).sort().reverse();
    const okoD = typeof _okoDugme === 'function' ? _okoDugme(pr.vidljiv !== false) : (pr.vidljiv === false ? 'Prikaži' : 'Sakrij');
    return `<button class="pkm-nazad" onclick="USFPrimka.otvori(null)">‹ Svi projekti</button>
    <section class="ng-card pkm-det"><div class="pkm-det-zag"><div><h3>📦 ${esc(pr.naziv)}</h3><small>${esc(sjNaziv || '⚠ sjekački projekat obrisan')} · kod: ${esc(pr.izvodjac || '—')}${pr.biljeska ? ' · ' + esc(pr.biljeska) : ''}</small></div><button onclick="USFPrimka.izmijeni('${pr.id}')" aria-label="Izmijeni">✏</button></div>
      <div class="ul-sum"><div><b>${fmt(s.ukupno, 1)}</b><small>m³ primljeno</small></div><div><b>${s.primljeno}/${s.partija}</b><small>partija</small></div><div><b>${fmt(haOk, 1)}/${fmt(haUk, 1)}</b><small>ha</small></div><div><b>${s.dana}</b><small>dana</small></div></div>
      <label class="pkm-prov">Providnost ispune <span id="pk-prov-v">${pr.prov ?? 35} %</span><input type="range" min="5" max="90" step="5" value="${pr.prov ?? 35}" oninput="USFPrimka.prov('${pr.id}',this.value)"></label>
      <div class="sl-dug"><button onclick="USFPrimka.naKarti('${pr.id}')">🔍 Na karti</button><button onclick="USFPrimka.vidljiv('${pr.id}')">${okoD}</button><button onclick="USFPrimka.izvoz('${pr.id}')">📤 CSV</button><button class="opasno" onclick="USFPrimka.obrisi('${pr.id}')" aria-label="Obriši projekat">🗑</button></div></section>
    <section class="ng-card"><div class="pkm-sek"><h3>🪓 Partije</h3><button onclick="USFPrimka.partije('${pr.id}')">± Izaberi</button></div>
      <p class="pkm-leg"><i style="--c:#22c55e"></i> primljeno <i style="--c:#ef4444"></i> neprimljeno — dodir na partiju mijenja status</p>
      ${!geo ? '<small>⚠ Sjekački projekat ne postoji — partije se ne mogu prikazati.</small>' : moje.length ? moje.map(g => { const ok = pr.partije[g.lid].primljeno; return `<div class="pkm-red"><button class="pkm-status ${ok ? 'ok' : ''}" onclick="USFPrimka.status('${pr.id}','${g.lid}')">${ok ? '✓' : '✕'}</button><div class="pkm-red-txt"><b>${esc(g.oznaka)}</b><small>${g.ha != null ? fmt(g.ha) + ' ha · ' : ''}${fmt(s.poPartiji[g.lid] || 0)} m³</small></div><button onclick="USFPrimka.unos('${pr.id}','${g.lid}')">➕ m³</button></div>`; }).join('') : '<small>Nijedna partija nije izabrana.</small>'}</section>
    <section class="ng-card"><div class="pkm-sek"><h3>📅 Primljeno po danima</h3><button class="glavno" onclick="USFPrimka.unos('${pr.id}')">➕ Unos</button></div>
      ${dani.length ? dani.map(d => `<div class="pkm-dan"><b>${new Date(d + 'T12:00').toLocaleDateString('bs-BA', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' })}</b><span>${fmt(s.poDanu[d])} m³</span></div>` +
        pr.unosi.filter(u => u.datum === d).map(u => `<div class="pkm-unos"><div><b>${esc(oz[u.lid] || '?')}</b> · ${fmt(u.m3)} m³${u.sortiment ? ' · ' + esc(u.sortiment) : ''}<small>${esc([u.odKoga, u.napomena].filter(Boolean).join(' · '))}</small></div><button onclick="USFPrimka.unos('${pr.id}',null,'${u.id}')" aria-label="Izmijeni">✏</button><button class="brisi" onclick="USFPrimka.obrisiUnos('${pr.id}','${u.id}')" aria-label="Obriši">🗑</button></div>`).join('')).join('')
        : '<small>Još nema unosa.</small>'}
      ${Object.keys(s.poSortimentu).length ? `<p class="pkm-leg">${Object.entries(s.poSortimentu).map(([k, v]) => esc(k) + ': ' + fmt(v) + ' m³').join(' · ')}</p>` : ''}</section>
    <section class="ng-card"><div class="pkm-sek"><h3>📷 Zapažanja iz odjela</h3></div>
      <div class="pkm-fakc"><label class="glavno">📷 Slikaj<input type="file" accept="image/*" capture="environment" hidden onchange="USFPrimka.dodajFoto('${pr.id}',this)"></label><label>🖼 Galerija<input type="file" accept="image/*" multiple hidden onchange="USFPrimka.dodajFoto('${pr.id}',this)"></label></div>
      <div class="pkm-foto">${(pr.foto || []).map(f => `<div class="pkm-f"><img data-foto="${esc(f.id)}" alt="" onclick="USFPrimka.prikaziFoto('${pr.id}','${f.id}')"><small>${esc(f.opis || new Date(f.datum).toLocaleDateString('bs-BA'))}</small><button onclick="USFPrimka.obrisiFoto('${pr.id}','${f.id}')" aria-label="Obriši">✕</button></div>`).join('')}</div></section>`;
  }
  function otvoriPanel() { _openStubPanel('primka-panel', 'meni'); render(); }
  function otvori(pid) { aktivni = pid; map.closePopup(); otvoriPanel(); }

  // Kartica sjekačke linije: partija te linije u primci (dodir u uskoj partiji često pogodi liniju).
  function dugmad(sid, lid) {
    return citaj().filter(pr => pr.sid === sid && pr.partije && pr.partije[lid]).map(pr => ({ t: '📦 Primka' + (pr.partije[lid].primljeno ? ' ✓' : ''), on: `USFPrimka.partijaKartica('${pr.id}','${lid}')` }));
  }
  function partijaKartica(pid, lid) {
    const pr = nadji(pid), g = pr && (partijeGeo(pr.sid) || []).find(x => x.lid === lid); if (!g) return;
    const at = g.prsteni.length ? L.polygon(g.prsteni).getBounds().getCenter() : map.getCenter();
    map.closePopup(); setTimeout(() => popupPartija(pid, lid, at), 50);
  }
  root.USFPrimka = { otvoriPanel, otvori, novi, partije: izborPartija, unos, obrisiUnos, status, prov, vidljiv, naKarti, obrisi, izmijeni, dodajFoto, prikaziFoto, obrisiFoto, izvoz, crtaj, citaj, dugmad, partijaKartica,
    stat() { const l = citaj(); return { n: l.length, m3: r2(l.reduce((a, p) => a + pkSume(p).ukupno, 0)) }; } };
  setTimeout(crtaj, 1200); // poslije sjekačkih linija (geometrija partija)
})(typeof window !== 'undefined' ? window : globalThis);
