// Primka drvnih sortimenata (Realizacija izvedbenih projekata): po odjelu se označavaju dijelovi
// gdje je roba (drvna masa, sortimenti) PRIMLJENA, a gdje NIJE. Dijelovi se crtaju dodirom/GPS-om
// (isječeni po granici odjela) ili se preuzimaju partije iz Sjekačkih linija (s radnikom).
// localStorage `usf_primka`; KML izvoz nosi cijeli projekat (ExtendedData usf_primka) pa ga drugi
// telefon otvori ili spoji (novija izmjena dijela pobjeđuje, ključ = id dijela).
(function () {
  'use strict';
  const KLJUC = 'usf_primka';
  // Tri stanja dijela odjela; boja UVIJEK ide uz ikonu i naziv (nikad sama). „Popraviti šumski red” = sječa gotova, ali teren
  // nije uredan (ostaci, vlake, podmladak…) — ima razloge (`d.razlozi`), rok (`d.rok`) i „Popravljeno” (`d.popravljeno`).
  const STATUS = {
    primljeno: { t: 'Primljeno', k: 'Primljeno', c: '#22c55e', ik: '✓' },
    neprimljeno: { t: 'Neprimljeno', k: 'Neprimljeno', c: '#ef4444', ik: '✕' },
    sumskired: { t: 'Popraviti šumski red', k: 'Šumski red', c: '#f59e0b', ik: '⚠' }
  };
  const REDOSLIJED = ['primljeno', 'neprimljeno', 'sumskired'];
  const RAZLOZI = { ostaci: 'Ostaci sječe neočišćeni', vlake: 'Vlake / putevi oštećeni', podmladak: 'Oštećen podmladak / stabla', panjevi: 'Visoki panjevi', sortimenti: 'Sortimenti ostali u šumi', otpad: 'Otpad / ulje / gorivo' };
  const kljucStatusa = d => (d && STATUS[d.status] ? d.status : 'neprimljeno');
  const stat = d => STATUS[kljucStatusa(d)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : 0).toLocaleString('bs', { minimumFractionDigits: d, maximumFractionDigits: d });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const toast = t => { if (typeof showToast === 'function') showToast(t); };
  const uBase64 = t => btoa(unescape(encodeURIComponent(t)));
  const izBase64 = t => decodeURIComponent(escape(atob(t)));

  // ── Geometrija (prsten = [[lat, lon], …]; dio = više prstenova, pravilo par/nepar) ──
  function m2Prstena(r) { // predznak po orijentaciji, lokalni metri oko prve tačke
    if (!r || r.length < 3) return 0;
    const la0 = r[0][0] * Math.PI / 180, kx = 111320 * Math.cos(la0), ky = 110574;
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][1] * kx) * (r[i][0] * ky) - (r[i][1] * kx) * (r[j][0] * ky);
    return a / 2;
  }
  // Rupe imaju suprotnu orijentaciju od vanjskog prstena → zbir predznaka = stvarna površina.
  const haDijela = prst => Math.abs((prst || []).reduce((s, r) => s + m2Prstena(r), 0)) / 1e4;
  // Granica odjela: jedan nacrtani prsten (p.ring) ILI poligoni odabrani iz sloja granica taksacije (p.poligoni — odjel
  // može imati više odsjeka/poligona). Bez ičega = rad „bez odjela”.
  const prsteni = p => (p && p.poligoni && p.poligoni.length ? p.poligoni.map(x => x.ring) : p && p.ring ? [p.ring] : []);
  function unutarPrstena(la, lo, r) {
    let u = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [ai, oi] = r[i], [aj, oj] = r[j];
      if ((ai > la) !== (aj > la) && lo < (oj - oi) * (la - ai) / (aj - ai) + oi) u = !u;
    }
    return u;
  }
  const unutar = (la, lo, prst) => (prst || []).reduce((u, r) => (unutarPrstena(la, lo, r) ? !u : u), false);
  // Dio isječen po granici odjela (turf v6 intersect); bez turf-a ili pri grešci ostaje nacrtani prsten.
  function isijeci(ring, odjel) {
    if (typeof turf === 'undefined' || !turf.intersect) return [ring];
    try {
      const gj = r => { const c = r.map(q => [q[1], q[0]]); c.push(c[0]); return turf.polygon([c]); };
      const x = turf.intersect(gj(ring), gj(odjel));
      if (!x || !x.geometry) return [];
      const poli = x.geometry.type === 'MultiPolygon' ? x.geometry.coordinates : [x.geometry.coordinates];
      return poli.flatMap(pl => pl.map(rr => rr.slice(0, -1).map(c => [c[1], c[0]])));
    } catch (e) { return [ring]; }
  }

  // prst (par/nepar) ↔ turf: dubina prstena = koliko ga drugih sadrži; parna = vanjski, neparna = rupa u roditelju.
  function uTurf(prst) {
    const rs = (prst || []).filter(r => r.length >= 3), dub = rs.map((r, i) => rs.reduce((n, o, j) => n + (j !== i && unutarPrstena(r[0][0], r[0][1], o) ? 1 : 0), 0));
    const c = r => { const x = r.map(q => [q[1], q[0]]); x.push(x[0]); return x; };
    const poli = [];
    rs.forEach((r, i) => { if (dub[i] % 2 === 0) poli.push({ r, rupe: [] }); });
    rs.forEach((r, i) => {
      if (dub[i] % 2 === 0) return;
      const rod = poli.filter(pl => unutarPrstena(r[0][0], r[0][1], pl.r)).sort((a, b) => Math.abs(m2Prstena(a.r)) - Math.abs(m2Prstena(b.r)))[0];
      if (rod) rod.rupe.push(r);
    });
    if (!poli.length) return null;
    return turf.multiPolygon(poli.map(pl => [c(pl.r), ...pl.rupe.map(c)]));
  }
  const izTurf = g => {
    if (!g || !g.geometry) return [];
    const poli = g.geometry.type === 'MultiPolygon' ? g.geometry.coordinates : g.geometry.type === 'Polygon' ? [g.geometry.coordinates] : [];
    return poli.flatMap(pl => pl.map(rr => rr.slice(0, -1).map(c => [c[1], c[0]]))).filter(r => r.length >= 3 && Math.abs(m2Prstena(r)) > 1);
  };
  // Oduzmi `prst` od dijela; null = dio je potpuno prekriven. Bez turf-a dio ostaje kakav jeste.
  function oduzmi(d, prst) {
    if (typeof turf === 'undefined' || !turf.difference) return d.prst;
    try { const a = uTurf(d.prst), b = uTurf(prst); if (!a || !b) return d.prst; const r = izTurf(turf.difference(a, b)); return r.length ? r : null; }
    catch (e) { return d.prst; }
  }
  // Ručno nacrtan dio ima prednost: preklop se oduzima od partija i starijih dijelova
  // (tako se dio partije može označiti posebno, a hektari se ne broje dvaput).
  function primijeniPrednost(p, prst, osim) {
    p.dijelovi = (p.dijelovi || []).flatMap(d => {
      if (d === osim) return [d];
      const r = oduzmi(d, prst);
      if (r === d.prst) return [d];
      if (!r) return [];
      d.prst = r; d.ha = haDijela(r); d.t = Date.now(); return [d];
    });
  }

  // ── Pohrana ──
  const citaj = () => { try { const v = JSON.parse(localStorage.getItem(KLJUC) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const pisi = l => { try { localStorage.setItem(KLJUC, JSON.stringify(l)); return true; } catch (e) { toast('⚠ Nema mjesta za čuvanje'); return false; } };
  const nadji = id => citaj().find(p => p.id === id) || null;
  function sacuvaj(p) { const l = citaj(), i = l.findIndex(x => x.id === p.id); if (i >= 0) l[i] = p; else l.unshift(p); p.t = Date.now(); return pisi(l); }
  function zbir(p) {
    const odjel = prsteni(p).reduce((a, r) => a + haDijela([r]), 0);
    const s = { odjel, primljeno: 0, neprimljeno: 0, sumskired: 0, m3p: 0, m3n: 0, m3s: 0, nSr: 0, nDij: 0, radnici: {} };
    (p.dijelovi || []).forEach(d => {
      const ha = Number.isFinite(d.ha) ? d.ha : haDijela(d.prst), k = kljucStatusa(d), m3 = Number(d.m3) || 0;
      s.nDij++;
      if (k === 'primljeno') { s.primljeno += ha; s.m3p += m3; }
      else if (k === 'sumskired') { s.sumskired += ha; s.m3s += m3; s.nSr++; }
      else { s.neprimljeno += ha; s.m3n += m3; }
      if (d.radnik) { const r = s.radnici[d.radnik] = s.radnici[d.radnik] || { p: 0, n: 0, s: 0, m3: 0 }; r[k === 'primljeno' ? 'p' : k === 'sumskired' ? 's' : 'n'] += ha; r.m3 += m3; }
    });
    s.oznaceno = s.primljeno + s.neprimljeno + s.sumskired;
    s.neoznaceno = Math.max(0, odjel - s.oznaceno);
    return s;
  }

  // ── Karta ──
  let grp = null;
  function pane() {
    if (map.getPane('primkaPane')) return;
    map.createPane('primkaPane'); map.getPane('primkaPane').style.zIndex = '414'; map.getPane('primkaPane').style.pointerEvents = 'none';
  }
  function crtaj() {
    pane();
    if (!grp) grp = L.layerGroup().addTo(map);
    grp.clearLayers();
    const z = map.getZoom();
    citaj().filter(p => p.vidljiv !== false).forEach(p => {
      const akt = p.id === aktivni;
      prsteni(p).forEach(r => L.polygon(r, { pane: 'primkaPane', color: '#f8fafc', weight: akt ? 2.5 : 1.6, dashArray: '7 5', fill: false, interactive: false }).addTo(grp));
      (p.dijelovi || []).forEach(d => {
        const st = stat(d), sr = kljucStatusa(d) === 'sumskired';
        L.polygon(d.prst, { pane: 'primkaPane', color: st.c, weight: sr ? 2.4 : 1.6, dashArray: sr ? '7 5' : null, fillColor: st.c, fillOpacity: akt ? (sr ? 0.3 : 0.38) : 0.24, fillRule: 'evenodd', interactive: false }).addTo(grp);
        // značka ikona + površina (uz boju, da stanje nije samo bojom) kad je zumirano
        if (akt && z >= 16) { const c = tackaDijela(d.prst); if (c) L.marker(c, { pane: 'primkaPane', interactive: false, icon: L.divIcon({ className: 'pr-badge', html: `<span style="--c:${st.c}">${st.ik} ${fmt(Number.isFinite(d.ha) ? d.ha : haDijela(d.prst), 2)} ha</span>`, iconSize: [84, 22], iconAnchor: [42, 11] }) }).addTo(grp); }
      });
    });
    const st = document.getElementById('mc-stat-primka'); if (st) { const n = citaj().length; st.textContent = n ? String(n) : ''; }
  }
  function popup(p, d, at) {
    const st = stat(d), k = kljucStatusa(d), ha = Number.isFinite(d.ha) ? d.ha : haDijela(d.prst);
    const redovi = [['Status', st.ik + ' ' + st.t], ['Površina', fmt(ha, 2) + ' ha']];
    if (k === 'sumskired') {
      const r = (d.razlozi || []).map(x => RAZLOZI[x]).filter(Boolean);
      if (r.length) redovi.push(['Popraviti', r.join(', ')]);
      if (d.rok) redovi.push(['Rok', new Date(d.rok).toLocaleDateString('bs')]);
    }
    if (d.popravljeno) redovi.push(['Popravljeno', new Date(d.popravljeno).toLocaleDateString('bs')]);
    if (d.m3) redovi.push(['Drvna masa', fmt(d.m3, 2) + ' m³']);
    if (d.brPrimke) redovi.push(['Br. primke', d.brPrimke]);
    if (d.sortimenti) redovi.push(['Sortimenti', d.sortimenti]);
    if (d.radnik) redovi.push(['Radnik', d.radnik]);
    if (d.datum) redovi.push(['Datum', new Date(d.datum).toLocaleDateString('bs')]);
    if (d.napomena) redovi.push(['Napomena', d.napomena]);
    const a = `'${p.id}','${d.id}'`;
    const dug = REDOSLIJED.map(x => ({ t: STATUS[x].ik + ' ' + STATUS[x].k, on: `USFPrimka.status(${a},'${x}')`, v: k === x ? 'on' : '' }));
    if (k === 'sumskired') dug.push({ t: '✓ Popravljeno', on: `USFPrimka.popravljeno(${a})` });
    dug.push({ t: '📷 Slikaj ovdje', on: `USFPrimka.tackaOvdje('${p.id}',${at.lat},${at.lng},true)` }, { t: '📍 Dodaj tačku', on: `USFPrimka.tackaOvdje('${p.id}',${at.lat},${at.lng},false)` },
      { t: '✏ Uredi', on: `USFPrimka.uredi(${a})` }, { t: '🗑', on: `USFPrimka.obrisiDio(${a})`, v: 'opasno' });
    const html = typeof _popKartica === 'function' ? _popKartica({ ikona: st.ik, boja: st.c, naslov: d.naziv || 'Dio odjela', tip: 'Primka', meta: p.naziv, redovi, dugmad: dug }) : esc(d.naziv);
    L.popup({ maxWidth: 300, minWidth: 230, className: 'pk-pop' }).setLatLng(at).setContent(html).openOn(map);
  }
  // Terenska tačka (USFTacke) na mjestu dodira u odjelu: „Slikaj” odmah otvara kameru, „Dodaj tačku” pita o čemu se radi.
  // Vrste su postojeće kategorije tačaka, pa tačka ide i u Tačke i fotografije i u KMZ izvoz.
  const TACKA_VRSTE = [['red', '⚠️ Loš šumski red'], ['sjeca', '🪓 Bespravna sječa'], ['vlaka', '🛣️ Silazak sa vlake'], ['suho', '🌲 Suho, prelomljeno, izvala'], ['potkornjak', '🪲 Potkornjak'], ['ostalo', '📌 Ostalo']];
  async function tackaOvdje(pid, la, lo, foto) {
    if (typeof USFTacke === 'undefined' || !USFTacke.nova) { toast('⚠ Terenske tačke nisu dostupne'); return; }
    const p = nadji(pid); map.closePopup();
    let kat = 'ostalo';
    if (!foto) {
      if (typeof _dlgActions !== 'function') return;
      const i = await _dlgActions('📍 O čemu se radi?', TACKA_VRSTE.map(v => ({ label: v[1] })));
      if (i == null || !TACKA_VRSTE[i]) return;
      kat = TACKA_VRSTE[i][0];
    }
    const naz = foto ? 'Fotografija' : (TACKA_VRSTE.find(v => v[0] === kat) || [0, ''])[1].replace(/^\S+\s/, '');
    USFTacke.nova(la, lo, { kat, naziv: naz + (p ? ' · ' + p.naziv : ''), foto: !!foto });
  }
  // Kartica odjela (dodir na odjel van označenih dijelova): zbir i radnje — bez nje nacrtani odjel nije bio klikabilan.
  function popupOdjel(p, at) {
    const z = zbir(p), a = `'${p.id}'`;
    const html = typeof _popKartica === 'function' ? _popKartica({ ikona: '🪵', boja: '#34d399', naslov: p.naziv, tip: 'Primka · odjel', meta: fmt(z.odjel, 2) + ' ha', redovi: [
      ['✓ Primljeno', fmt(z.primljeno, 2) + ' ha' + (z.m3p ? ' · ' + fmt(z.m3p, 1) + ' m³' : '')],
      ['✕ Neprimljeno', fmt(z.neprimljeno, 2) + ' ha' + (z.m3n ? ' · ' + fmt(z.m3n, 1) + ' m³' : '')],
      ['⚠ Šumski red', fmt(z.sumskired, 2) + ' ha' + (z.nSr ? ' · ' + z.nSr + ' dij.' : '')],
      ['Neoznačeno', fmt(z.neoznaceno, 2) + ' ha'], ['Dijelova', String(z.nDij)]], dugmad: [
      { t: '✏ Označi dio', on: `USFPrimka.dockOtvori(${a})`, v: 'glavno' }, { t: '📷 Slikaj ovdje', on: `USFPrimka.tackaOvdje(${a},${at.lat},${at.lng},true)` },
      { t: '📍 Dodaj tačku', on: `USFPrimka.tackaOvdje(${a},${at.lat},${at.lng},false)` }, { t: '📋 Otvori', on: `USFPrimka.otvoriProjekat(${a})` },
      { t: '🙈 Sakrij', on: `USFPrimka.sakrij(${a})` }, { t: '🗑', on: `USFPrimka.obrisi(${a})`, v: 'opasno' }] }) : esc(p.naziv);
    L.popup({ maxWidth: 300, minWidth: 220, className: 'pk-pop' }).setLatLng(at).setContent(html).openOn(map);
  }
  // Prednost dodira = površina u PIKSELIMA ekrana, kao kod KML-a/mjerenja (_pxPovrsina) — s m² je KML odjel
  // uvijek pobjeđivao pa nacrtani dio nije bio klikabilan.
  const pxPov = prst => typeof _pxPovrsina === 'function' ? prst.reduce((s, r) => s + _pxPovrsina(r.map(q => L.latLng(q[0], q[1]))), 0) : haDijela(prst) * 1e4;
  if (typeof _kartaKlikIzvor === 'function') _kartaKlikIzvor(ll => {
    const out = [];
    citaj().filter(p => p.vidljiv !== false).forEach(p => {
      (p.dijelovi || []).forEach(d => {
        if (unutar(ll.lat, ll.lng, d.prst)) out.push({ vrsta: 'poligon', pov: pxPov(d.prst), otvori: at => popup(p, d, at) });
      });
      // odjel malo „manji” od istog KML poligona → kartica primke ima prednost nad karticom KML-a
      const r = prsteni(p).find(x => unutarPrstena(ll.lat, ll.lng, x));
      if (r) out.push({ vrsta: 'poligon', pov: pxPov([r]) * 0.98, otvori: at => popupOdjel(p, at) });
    });
    return out;
  });

  // ── Bez poligona: dio se nacrta, a odjel se prepozna po KML poligonu (najmanji koji sadrži dio) ──
  function tackaDijela(prst) {
    const r = (prst || []).slice().sort((a, b) => Math.abs(m2Prstena(b)) - Math.abs(m2Prstena(a)))[0];
    if (!r) return null;
    try { if (typeof turf !== 'undefined' && turf.pointOnFeature) { const c = r.map(q => [q[1], q[0]]); c.push(c[0]); const t = turf.pointOnFeature(turf.polygon([c])).geometry.coordinates; return [t[1], t[0]]; } } catch (e) {}
    return r.reduce((a, q) => [a[0] + q[0] / r.length, a[1] + q[1] / r.length], [0, 0]);
  }
  function odjelPod(prst) {
    const t = tackaDijela(prst); if (!t || typeof kmlLs === 'undefined') return null;
    let naj = null;
    kmlLs.forEach(k => k && k.grp && k.grp.eachLayer(function walk(l) {
      if (l.eachLayer && !l.getLatLngs) { l.eachLayer(walk); return; }
      if (!l._kmlIsPolygon) return;
      let ll = l.getLatLngs(); while (Array.isArray(ll[0]) && Array.isArray(ll[0][0])) ll = ll[0];
      const ring = (Array.isArray(ll[0]) ? ll[0] : ll).map(q => [q.lat, q.lng]);
      if (ring.length < 3 || !unutarPrstena(t[0], t[1], ring)) return;
      const ha = haDijela([ring]);
      if (!naj || ha < naj.ha) naj = { ring, ha, ime: (typeof _odjelOznaka === 'function' ? _odjelOznaka(l, '') : '') || l._kmlName || 'Odjel', sloj: k.name };
    }));
    return naj;
  }
  // Projekat za prepoznati odjel: isti naziv i tačka unutar njegove granice; inače novi (ili „Bez odjela”).
  function projekatZa(odj, t) {
    const l = citaj();
    if (!odj) return l.find(p => !prsteni(p).length) || napravi(null, 'Bez odjela', null, true);
    return l.find(p => p.naziv === odj.ime && prsteni(p).some(r => unutarPrstena(t[0], t[1], r))) || napravi(odj.ring, odj.ime, { sloj: odj.sloj }, true);
  }
  // Izbor klase (primljeno / neprimljeno / šumski red) pri crtanju bez docka
  async function pitajStatus(naslov) {
    const i = typeof _dlgActions === 'function' ? await _dlgActions(naslov, REDOSLIJED.map(k => ({ label: STATUS[k].ik + ' ' + STATUS[k].t }))) : 0;
    return i >= 0 && i < REDOSLIJED.length ? REDOSLIJED[i] : null;
  }
  const porukaDijela = (k, d, p) => toast(STATUS[k].ik + ' ' + STATUS[k].t + ' · ' + fmt(d.ha, 2) + ' ha' + (p ? ' → ' + p.naziv : ''));
  async function brziDio() {
    const akt = aktivni && nadji(aktivni);
    if (akt) { dockOtvori(akt.id); return; }
    const ring = await window.USFPrimka.nacrtaj({ naslov: '🪵 Dio — odjel se prepoznaje sam' });
    if (!ring) return;
    const prst = [ring], odj = odjelPod(prst), t = tackaDijela(prst);
    const k = await pitajStatus('Dio (' + fmt(haDijela(prst), 2) + ' ha)' + (odj ? ' · ' + odj.ime : ' · odjel nije prepoznat'));
    if (!k) return;
    const p = projekatZa(odj, t);
    porukaDijela(k, dodajDio(p, prst, k), p);
  }
  function dodajDio(p, prst, st) {
    const k = STATUS[st] ? st : 'neprimljeno';
    const d = { id: uid(), naziv: 'Dio ' + ((p.dijelovi || []).length + 1), prst, ha: haDijela(prst), status: k, m3: null, brPrimke: '', sortimenti: '', radnik: '', napomena: '', datum: k === 'primljeno' ? Date.now() : null, t: Date.now() };
    if (k === 'sumskired') { d.razlozi = [...dockSr]; d.rok = null; d.popravljeno = null; }
    primijeniPrednost(p, prst, null);
    (p.dijelovi = p.dijelovi || []).push(d); aktivni = p.id; sacuvaj(p); crtaj(); render(); dockRender();
    return d;
  }

  // ── Dock na karti: veliki gumbi klase (primljeno / neprimljeno / šumski red) + razlozi za šumski red ──
  let dock = null; // id projekta
  const dockSr = new Set();
  function dockEl() {
    let el = document.getElementById('pr-dock');
    if (!el) { el = document.createElement('div'); el.id = 'pr-dock'; document.body.appendChild(el); }
    return el;
  }
  function dockRender() {
    const el = document.getElementById('pr-dock'), p = dock && nadji(dock);
    if (!p) { if (el) el.remove(); document.body.classList.remove('pr-dock'); return; }
    document.body.classList.toggle('pr-dock', !crt && !(izbor && izbor.mapa));
    const z = zbir(p), e = dockEl(), draw = !!crt;
    e.innerHTML = `<div class="prd-zag"><b>🪵 ${esc(p.naziv)}</b><span>${fmt(z.oznaceno, 2)} / ${fmt(z.odjel, 2)} ha označeno</span><button onclick="USFPrimka.dockZatvori()" title="Zatvori">✕</button></div>
      <div class="prd-gumbi">${REDOSLIJED.map(k => `<button style="--c:${STATUS[k].c}" onclick="USFPrimka.crtajStatus('${k}')"><i>${STATUS[k].ik}</i><span>${STATUS[k].k}</span><small>${fmt(z[k], 2)} ha</small></button>`).join('')}</div>
      <div class="prd-sr"><small>Šumski red — šta popraviti:</small>${Object.entries(RAZLOZI).map(([k, t]) => `<button class="${dockSr.has(k) ? 'on' : ''}" onclick="USFPrimka.dockSrGotovo('${k}')">${esc(t)}</button>`).join('')}</div>
      <div class="prd-pod"><button onclick="USFPrimka.izbCijeli('${p.id}')">▣ Cijeli odjel…</button><button onclick="USFPrimka.otvoriProjekat('${p.id}')">📋 Pregled</button></div>`;
    e.style.display = draw ? 'none' : '';
  }
  function dockOtvori(pid) {
    if (!nadji(pid)) return;
    map.closePopup(); aktivni = pid; dock = pid;
    if (typeof switchMainTab === 'function') switchMainTab('karta');
    crtaj(); render(); dockRender();
  }
  function dockZatvori() { dock = null; dockRender(); }
  function crtajStatus(k) {
    const p = dock && nadji(dock); if (!p || !STATUS[k] || crt) return;
    crtPocni('dio', p.id, { status: k, boja: STATUS[k].c, naslov: STATUS[k].ik + ' ' + STATUS[k].t + ' · ' + p.naziv });
    dockRender();
  }

  // ── Crtanje (granica odjela ili dio) ──
  let crt = null;
  function crtBar() {
    let el = document.getElementById('pr-crt');
    if (!el) { el = document.createElement('div'); el.id = 'pr-crt'; document.body.appendChild(el); }
    return el;
  }
  function crtPocni(svrha, pid, opc) {
    if (crt) return;
    crt = { svrha, pid, pts: [], sloj: L.layerGroup().addTo(map), ...(opc || {}) };
    window._npHvataKlik = true; map.on('click', crtKlik);
    document.body.classList.add('pr-crta'); if (typeof switchMainTab === 'function') switchMainTab('karta'); crtOsvjezi();
  }
  function crtKlik(e) { crt.pts.push([e.latlng.lat, e.latlng.lng]); crtOsvjezi(); }
  function crtGps() {
    const g = typeof lastP !== 'undefined' && lastP && Number.isFinite(lastP.la) ? lastP : null;
    if (!g) { if (typeof gpsOn !== 'undefined' && !gpsOn && typeof startGPS === 'function') startGPS(); toast('📍 Čekam GPS — pokušaj za koju sekundu'); return; }
    crt.pts.push([g.la, g.lo]); crtOsvjezi(); toast('📍 Tačka ' + crt.pts.length + ' (±' + fmt(g.ac || 0) + ' m)');
  }
  function crtKraj() { if (!crt) return; if (crt.cb) { const cb = crt.cb; crt.cb = null; cb(null); } map.removeLayer(crt.sloj); map.off('click', crtKlik); window._npHvataKlik = false; crt = null; document.body.classList.remove('pr-crta'); dockRender(); }
  function crtOsvjezi() {
    if (!crt) return;
    const c = crt.boja || '#38bdf8';
    crtBar().style.setProperty('--c', c);
    crt.sloj.clearLayers();
    if (crt.pts.length > 1) L.polygon(crt.pts, { pane: 'primkaPane', color: c, weight: 2.5, dashArray: '6 4', fillOpacity: 0.1, interactive: false }).addTo(crt.sloj);
    crt.pts.forEach((q, i) => L.circleMarker(q, { pane: 'primkaPane', radius: i ? 5 : 7, color: '#0b1220', weight: 2, fillColor: c, fillOpacity: 1, interactive: false }).addTo(crt.sloj));
    const ha = crt.pts.length > 2 ? haDijela([crt.pts]) : 0;
    crtBar().innerHTML = `<div class="sl-v-nasl">${crt.naslov ? esc(crt.naslov) : '🪵 Dio odjela'} <small>dodirni kartu ili idi granicom i dodaj tačku</small></div>
      <div class="sl-v-sporedno">${crt.pts.length} tačaka${ha ? ' · ' + fmt(ha, 2) + ' ha' : ''}</div>
      <div class="sl-v-dug"><button onclick="USFPrimka.crtGps()">📍 Moja pozicija</button><button onclick="USFPrimka.crtVrati()">↶</button><button onclick="USFPrimka.crtZavrsi()">✓ Gotovo</button><button onclick="USFPrimka.crtOdustani()">✕</button></div>`;
  }
  async function crtZavrsi() {
    if (!crt || crt.pts.length < 3) { toast('Treba bar 3 tačke'); return; }
    const { pid, status } = crt, ring = crt.pts.slice(), cb = crt.cb;
    crt.cb = null; crtKraj();
    if (cb) { cb(ring); return; }
    const p = nadji(pid); if (!p) return;
    const rs = prsteni(p), prst = rs.length ? rs.flatMap(r => isijeci(ring, r)) : [ring];
    if (!prst.length) { toast('⚠ Nacrtani dio je izvan granice odjela'); dockRender(); return; }
    const k = status || await pitajStatus('Dio (' + fmt(haDijela(prst), 2) + ' ha)');
    if (!k) { dockRender(); return; }
    porukaDijela(k, dodajDio(p, prst, k));
  }

  // ── Projekti ──
  const AKT_KLJUC = 'usf_primka_aktivni';
  let aktivni = null; try { aktivni = localStorage.getItem(AKT_KLJUC) || null; } catch (e) {}
  const pamtiAktivni = () => { try { if (aktivni) localStorage.setItem(AKT_KLJUC, aktivni); else localStorage.removeItem(AKT_KLJUC); } catch (e) {} };
  // tiho = pravi ga brzi dio (karta ostaje, bez panela i zumiranja)
  function napravi(ring, naziv, extra, tiho) {
    const p = { id: uid(), naziv: String(naziv || 'Odjel').slice(0, 60), ring: ring || null, dijelovi: [], vidljiv: true, t: Date.now(), ...(extra || {}) };
    sacuvaj(p); aktivni = p.id;
    if (tiho) return p;
    otvoriPanel(); crtaj(); render();
    try { map.fitBounds(L.latLngBounds(ring), { padding: [30, 30], maxZoom: 17 }); } catch (e) {}
    toast('🪵 Primka „' + p.naziv + '” — ' + fmt(haDijela([ring]), 2) + ' ha');
    return p;
  }
  const obuhvat = p => { const r = prsteni(p); return r.length ? r.flat() : (p.dijelovi || []).flatMap(d => d.prst.flat()); };
  function zoomProjekat(p) { if (typeof switchMainTab === 'function') switchMainTab('karta'); try { map.fitBounds(L.latLngBounds(obuhvat(p)), { padding: [30, 30], maxZoom: 17 }); } catch (e) {} }
  // Partije sjekačkih linija postaju dijelovi (zadano neprimljeno). Ponovni uvoz osvježi oblik i
  // radnika, a status, m³ i primka ostaju (ključ = linija).
  async function uvezPartije(pid, sjekId) {
    const p = nadji(pid); if (!p || !window.USFSjek || !USFSjek.partije) return;
    let sid = sjekId || p.sjekId;
    if (!sid) {
      const lista = USFSjek.projekti().filter(s => s.linija);
      if (!lista.length) { toast('Nema projekata sjekačkih linija'); return; }
      const sr = obuhvat(p), sredina = sr.reduce((a, q) => [a[0] + q[0] / sr.length, a[1] + q[1] / sr.length], [0, 0]);
      lista.sort((a, b) => (unutarPrstena(sredina[0], sredina[1], b.ring) ? 1 : 0) - (unutarPrstena(sredina[0], sredina[1], a.ring) ? 1 : 0));
      const i = typeof _dlgActions === 'function' ? await _dlgActions('Partije iz projekta', lista.map(s => ({ label: '🪓 ' + s.naziv + ' · ' + s.linija + ' linija' }))) : 0;
      if (!(i >= 0 && i < lista.length)) return;
      sid = lista[i].id;
    }
    const par = USFSjek.partije(sid);
    if (!par.length) { toast('⚠ Projekat nema partija (napravi linije)'); return; }
    const po = new Map((p.dijelovi || []).filter(d => d.izvor).map(d => [d.izvor, d]));
    let novih = 0;
    par.forEach(x => {
      const kljuc = sid + ':' + x.lid, prst = x.prst, ha = Number.isFinite(x.ha) ? x.ha : haDijela(prst), s = po.get(kljuc);
      const ime = 'Partija ' + x.oznaka;
      if (s) { s.prst = prst; s.ha = ha; s.naziv = ime; if (x.radnik) s.radnik = x.radnik; s.t = Date.now(); return; }
      novih++;
      (p.dijelovi = p.dijelovi || []).push({ id: uid(), izvor: kljuc, naziv: ime, prst, ha, status: 'neprimljeno', m3: null, brPrimke: '', sortimenti: '', radnik: x.radnik || '', napomena: '', datum: null, t: Date.now() });
    });
    // ručno nacrtani dijelovi ostaju na snazi i poslije (ponovnog) uvoza partija
    const rucni = (p.dijelovi || []).filter(d => !d.izvor);
    p.dijelovi = p.dijelovi.flatMap(d => {
      if (!d.izvor) return [d];
      let r = d.prst;
      for (const m of rucni) { const x = oduzmi({ prst: r }, m.prst); if (!x) return []; r = x; }
      if (r !== d.prst) { d.prst = r; d.ha = haDijela(r); }
      return [d];
    });
    p.sjekId = sid; sacuvaj(p); crtaj(); render();
    toast('🪓 Partije: ' + par.length + (novih < par.length ? ' (' + (par.length - novih) + ' osvježeno)' : ''));
  }

  // ── Novi projekat: izbor jednog ili više poligona (odjel = više odsjeka) iz sloja granica taksacije ──
  // Izvor je samo sloj „samo za odabir poligona” (index.html `_kmlPoligoniOdabir`); projekat dobija sve izabrane poligone,
  // postaje AKTIVAN, i svaki označeni dio se veže uz njega.
  let izbor = null; // { lista, sel:Set, otv:Set, trazi, mapa }
  let izbSloj = null;
  const bb = r => r.reduce((b, q) => [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[0]), Math.max(b[3], q[1])], [90, 180, -90, -180]);
  // Poligoni za odabir se prikazuju NA KARTI (sloj taksacije je inače skriven): tanke konture svih u pogledu, označeni
  // istaknuti, oznake odjel·odsjek kad je zumirano. Zumiraj ≥ 11 (iznad toga ih ima previše — crtaju se samo označeni).
  function izbCrtaj() {
    if (izbSloj) { try { map.removeLayer(izbSloj); } catch (e) {} izbSloj = null; }
    if (!izbor || !izbor.lista.length) return;
    pane();
    const g = izbSloj = L.layerGroup().addTo(map), z = map.getZoom(), v = map.getBounds();
    const vidi = x => x.bb[2] >= v.getSouth() && x.bb[0] <= v.getNorth() && x.bb[3] >= v.getWest() && x.bb[1] <= v.getEast();
    const crtati = izbor.lista.filter(x => izbor.sel.has(x.kljuc) || (z >= 11 && vidi(x))).slice(0, 900);
    crtati.forEach(x => {
      const sel = izbor.sel.has(x.kljuc);
      L.polygon(x.ring, { pane: 'primkaPane', color: sel ? '#34d399' : '#fde68a', weight: sel ? 2.5 : 1.2, fillColor: '#34d399', fillOpacity: sel ? 0.4 : 0.03, interactive: false }).addTo(g);
    });
    if (z >= 14) crtati.filter(vidi).slice(0, 120).forEach(x => {
      const c = x.ring.reduce((a, q) => [a[0] + q[0] / x.ring.length, a[1] + q[1] / x.ring.length], [0, 0]);
      L.marker(c, { pane: 'primkaPane', interactive: false, icon: L.divIcon({ className: 'pr-izb-lab' + (izbor.sel.has(x.kljuc) ? ' sel' : ''), html: esc((x.odjel || '') + (x.odsjek ? ' · ' + x.odsjek : '') || x.naziv), iconSize: [80, 16], iconAnchor: [40, 8] }) }).addTo(g);
    });
  }
  function izbKlik(e) {
    if (!izbor) return;
    let naj = null;
    izbor.lista.forEach(x => { if (e.latlng.lat >= x.bb[0] && e.latlng.lat <= x.bb[2] && e.latlng.lng >= x.bb[1] && e.latlng.lng <= x.bb[3] && unutarPrstena(e.latlng.lat, e.latlng.lng, x.ring) && (!naj || x.ha < naj.ha)) naj = x; });
    if (!naj) return;
    izbor.sel.has(naj.kljuc) ? izbor.sel.delete(naj.kljuc) : izbor.sel.add(naj.kljuc);
    izbCrtaj(); izbBar();
  }
  function izbBar() {
    if (!izbor || !izbor.mapa) return;
    const sel = ukIzbor(), ha = sel.reduce((a, x) => a + x.ha, 0);
    crtBar().style.setProperty('--c', '#34d399');
    crtBar().innerHTML = `<div class="sl-v-nasl">🗺 Odaberi odjel / odsjek dodirom na karti <small>dodir uključuje/isključuje poligon</small></div>
      <div class="sl-v-sporedno">${sel.length} ${sel.length === 1 ? 'poligon' : 'poligona'} · ${fmt(ha, 2)} ha${map.getZoom() < 11 ? ' · zumiraj bliže da se vide poligoni' : ''}</div>
      <div class="sl-v-dug pr-izbd"><button onclick="USFPrimka.izbGotovo()" ${sel.length ? '' : 'disabled'}>✓ Napravi projekat</button><button onclick="USFPrimka.izbLista()">☰ Lista</button><button onclick="USFPrimka.izbOdustani()">✕</button></div>`;
  }
  function izbMapaKraj() {
    if (!izbor || !izbor.mapa) return;
    izbor.mapa = false; window._npHvataKlik = false; map.off('click', izbKlik);
    document.body.classList.remove('pr-crta'); crtBar().innerHTML = '';
  }
  function izbZatvori() { izbMapaKraj(); izbor = null; map.off('moveend', izbCrtaj); izbCrtaj(); }
  function izbNaKarti() {
    if (!izbor || crt) return;
    dockZatvori(); map.closePopup();
    izbor.mapa = true; window._npHvataKlik = true; map.on('click', izbKlik);
    document.body.classList.add('pr-crta'); if (typeof switchMainTab === 'function') switchMainTab('karta');
    izbCrtaj(); izbBar();
  }
  const ukIzbor = () => izbor.lista.filter(x => izbor.sel.has(x.kljuc));
  function izborOtvori() {
    const lista = (typeof _kmlPoligoniOdabir === 'function' ? _kmlPoligoniOdabir() : []).map(x => ({ ...x, ha: haDijela([x.ring]) }));
    lista.sort((a, b) => (parseInt(a.odjel, 10) || 1e9) - (parseInt(b.odjel, 10) || 1e9) || String(a.odjel).localeCompare(String(b.odjel), 'bs') || String(a.odsjek).localeCompare(String(b.odsjek), 'bs'));
    lista.forEach(x => { x.bb = bb(x.ring); });
    izbor = { lista, sel: new Set(), otv: new Set(), trazi: '' };
    map.off('moveend', izbCrtaj); map.on('moveend', izbCrtaj);
    render(); izbCrtaj();
  }
  // Na kartu odmah: ako je zumirano predaleko za konture (< 11), zumiraj na poligone u pogledu / sve poligone sloja
  function izbPocetniPogled() {
    if (!izbor || !izbor.lista.length || map.getZoom() >= 11) return;
    const v = map.getBounds(), u = izbor.lista.filter(x => x.bb[2] >= v.getSouth() && x.bb[0] <= v.getNorth() && x.bb[3] >= v.getWest() && x.bb[1] <= v.getEast());
    try { map.fitBounds(L.latLngBounds((u.length ? u : izbor.lista).flatMap(x => x.ring)), { padding: [30, 30], maxZoom: 12 }); } catch (e) {}
    if (map.getZoom() < 11) map.setZoom(11);
  }
  function grupe() {
    const m = new Map();
    izbor.lista.forEach(x => { const o = x.odjel || '—'; (m.get(o) || m.set(o, []).get(o)).push(x); });
    return m;
  }
  function izborRender() {
    const el = document.getElementById('pr-izbor'); if (!el) return;
    if (!izbor) { el.innerHTML = ''; el.hidden = true; return; }
    el.hidden = false;
    if (!izbor.lista.length) {
      el.innerHTML = `<div class="pr-izb"><div class="pr-izb-zag"><b>Nema poligona za odabir</b></div><p class="uk-izvor">Učitaj sloj „Granice taksacije” (Karte → KML preglednik → ☁ Poligoni za preuzimanje). Sloj je automatski „samo za odabir poligona”.</p><div class="sl-dug"><button data-a="izb-odustani">Zatvori</button></div></div>`;
      return;
    }
    el.innerHTML = `<div class="pr-izb"><div class="pr-izb-zag"><b>Odaberi odjel / odsjeke</b><small>${izbor.lista.length} poligona · „${esc(izbor.lista[0].sloj)}”</small></div>
      <input id="pr-izb-trazi" type="search" placeholder="Traži odjel ili odsjek (npr. 68)…" value="${esc(izbor.trazi)}" autocomplete="off">
      <div id="pr-izb-lista"></div><div id="pr-izb-saz"></div></div>`;
    izborLista();
  }
  function izborLista() {
    const el = document.getElementById('pr-izb-lista'), saz = document.getElementById('pr-izb-saz'); if (!el || !izbor) return;
    const q = izbor.trazi.trim().toLowerCase(), MAX = 40;
    let gr = [...grupe()].filter(([o, a]) => !q || a.some(x => (o + ' ' + x.odsjek + ' ' + x.naziv).toLowerCase().includes(q)));
    const ukupnoGr = gr.length; gr = gr.slice(0, MAX);
    el.innerHTML = gr.map(([o, a]) => {
      const bro = a.filter(x => izbor.sel.has(x.kljuc)).length, ha = a.reduce((s, x) => s + x.ha, 0), otv = izbor.otv.has(o) || (q && a.length > 1 && gr.length <= 3);
      return `<div class="pr-izb-odj"><label><input type="checkbox" data-a="izb-odjel" data-o="${esc(o)}" data-n="${bro}/${a.length}" ${bro === a.length ? 'checked' : ''}> <b>Odjel ${esc(o)}</b><span>${a.length} ${a.length === 1 ? 'poligon' : 'odsjeka'} · ${fmt(ha, 2)} ha${bro && bro < a.length ? ' · izabrano ' + bro : ''}</span></label><button data-a="izb-zoom" data-o="${esc(o)}" title="Prikaži na karti">🔍</button>${a.length > 1 ? `<button data-a="izb-otv" data-o="${esc(o)}">${otv ? '▾' : '▸'}</button>` : ''}</div>
        ${otv ? `<div class="pr-izb-ods">${a.map(x => `<label><input type="checkbox" data-a="izb-pol" data-k="${esc(x.kljuc)}" ${izbor.sel.has(x.kljuc) ? 'checked' : ''}> <b>${esc(x.odsjek || x.naziv || '—')}</b><span>${fmt(x.ha, 2)} ha</span></label>`).join('')}</div>` : ''}`;
    }).join('') + (ukupnoGr > MAX ? `<p class="uk-izvor">… još ${ukupnoGr - MAX} odjela — suzi pretragu.</p>` : '') + (!ukupnoGr ? '<p class="uk-izvor">Nema rezultata.</p>' : '');
    el.querySelectorAll('input[data-a="izb-odjel"]').forEach(i => { const [b, u] = i.dataset.n.split('/').map(Number); i.indeterminate = b > 0 && b < u; });
    const sel = ukIzbor(), ha = sel.reduce((s, x) => s + x.ha, 0);
    izbCrtaj();
    if (saz) saz.innerHTML = `<div class="sl-dug"><button data-a="izb-karta">🗺 Odaberi na karti</button></div><div class="sl-dug"><button class="zp-glavno" data-a="izb-gotovo" ${sel.length ? '' : 'disabled'}>Napravi projekat${sel.length ? ' · ' + sel.length + ' poligon' + (sel.length === 1 ? '' : 'a') + ' · ' + fmt(ha, 2) + ' ha' : ''}</button><button data-a="izb-odustani">Odustani</button></div>`;
  }
  function izborAkcija(el) {
    const a = el.dataset.a, o = el.dataset.o;
    if (a === 'izb-novi') { izborOtvori(); izbPocetniPogled(); izbNaKarti(); return; }
    if (!izbor) return;
    if (a === 'izb-odustani') { izbZatvori(); render(); return; }
    if (a === 'izb-karta') { izbNaKarti(); return; }
    if (a === 'izb-zoom') { const gr = (grupe().get(o) || []); try { map.fitBounds(L.latLngBounds(gr.flatMap(x => x.ring)), { padding: [30, 30], maxZoom: 16 }); } catch (e) {} if (typeof switchMainTab === 'function') switchMainTab('karta'); izbCrtaj(); return; }
    if (a === 'izb-otv') { izbor.otv.has(o) ? izbor.otv.delete(o) : izbor.otv.add(o); izborLista(); return; }
    if (a === 'izb-odjel') { (grupe().get(o) || []).forEach(x => (el.checked ? izbor.sel.add(x.kljuc) : izbor.sel.delete(x.kljuc))); izborLista(); return; }
    if (a === 'izb-pol') { el.checked ? izbor.sel.add(el.dataset.k) : izbor.sel.delete(el.dataset.k); izborLista(); return; }
    if (a === 'izb-gotovo') { const sel = ukIzbor(); if (sel.length) napraviIzPoligona(sel); }
  }
  function imeProjekta(sel) {
    const po = new Map(); sel.forEach(x => { const o = x.odjel || '—'; (po.get(o) || po.set(o, []).get(o)).push(x); });
    const sviPo = grupe();
    return [...po].map(([o, a]) => 'Odjel ' + o + (a.length < (sviPo.get(o) || []).length ? ' · ' + a.map(x => x.odsjek || x.naziv).filter(Boolean).join(', ') : '')).join(' + ').slice(0, 60);
  }
  // Poslije pravljenja projekta ostaje se NA KARTI: zumira na odabrane poligone i otvara dock za označavanje.
  function napraviIzPoligona(sel) {
    const p = { id: uid(), naziv: imeProjekta(sel), ring: null, poligoni: sel.map(x => ({ ring: x.ring, odjel: x.odjel, odsjek: x.odsjek, naziv: x.naziv, sloj: x.sloj })), dijelovi: [], vidljiv: true, t: Date.now() };
    sacuvaj(p); aktivni = p.id; izbZatvori();
    zoomProjekat(p); crtaj(); render(); dockOtvori(p.id);
    toast('🪵 „' + p.naziv + '” — ' + fmt(zbir(p).odjel, 2) + ' ha. Odaberi klasu i označi dio na karti.');
    return p;
  }

  // ── KML ──
  function izvozKml(p) {
    if (typeof _izvozFajl !== 'function') { toast('⚠ Izvoz nije dostupan'); return; }
    const x = s => typeof _xmlEsc === 'function' ? _xmlEsc(s) : esc(s);
    const k = q => q[1].toFixed(7) + ',' + q[0].toFixed(7);
    const pr = r => `<LinearRing><coordinates>${r.concat([r[0]]).map(k).join(' ')}</coordinates></LinearRing>`;
        const z = zbir(p);
    const dij = (p.dijelovi || []).map(d => {
      const ha = Number.isFinite(d.ha) ? d.ha : haDijela(d.prst), polja = { status: stat(d).t, popraviti: (d.razlozi || []).map(r => RAZLOZI[r]).filter(Boolean).join(', '), rok: d.rok ? new Date(d.rok).toLocaleDateString('bs') : '', popravljeno: d.popravljeno ? new Date(d.popravljeno).toLocaleDateString('bs') : '', povrsina_ha: fmt(ha, 2), m3: d.m3 || '', br_primke: d.brPrimke, sortimenti: d.sortimenti, radnik: d.radnik, napomena: d.napomena };
      // svaki prsten kao poseban poligon (par/nepar bi u KML-u tražio rupe po vanjskom prstenu)
      const geo = d.prst.length === 1 ? `<Polygon><outerBoundaryIs>${pr(d.prst[0])}</outerBoundaryIs></Polygon>` : `<MultiGeometry>${d.prst.map(r => `<Polygon><outerBoundaryIs>${pr(r)}</outerBoundaryIs></Polygon>`).join('')}</MultiGeometry>`;
      return `<Placemark><name>${x(d.naziv)}</name><styleUrl>#${{ primljeno: 'pr', sumskired: 'sr' }[kljucStatusa(d)] || 'ne'}</styleUrl><ExtendedData>${Object.entries(polja).filter(([, v]) => v).map(([a, v]) => `<Data name="${a}"><value>${x(v)}</value></Data>`).join('')}</ExtendedData>${geo}</Placemark>`;
    }).join('\n');
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${x('Primka · ' + p.naziv)}</name>
<ExtendedData><Data name="usf_primka"><value>${uBase64(JSON.stringify(p))}</value></Data></ExtendedData>
<Style id="odj"><LineStyle><color>fffafaf8</color><width>3</width></LineStyle><PolyStyle><fill>0</fill></PolyStyle></Style>
<Style id="pr"><LineStyle><color>ff5ec522</color><width>2</width></LineStyle><PolyStyle><color>665ec522</color></PolyStyle></Style>
<Style id="ne"><LineStyle><color>ff4444ef</color><width>2</width></LineStyle><PolyStyle><color>664444ef</color></PolyStyle></Style>
<Style id="sr"><LineStyle><color>ff0b9ef5</color><width>3</width></LineStyle><PolyStyle><color>660b9ef5</color></PolyStyle></Style>
<Placemark><name>${x(p.naziv)}</name><description>${x('Primljeno ' + fmt(z.primljeno, 2) + ' ha · neprimljeno ' + fmt(z.neprimljeno, 2) + ' ha · šumski red ' + fmt(z.sumskired, 2) + ' ha · neoznačeno ' + fmt(z.neoznaceno, 2) + ' ha')}</description><styleUrl>#odj</styleUrl>${prsteni(p).length ? `<MultiGeometry>${prsteni(p).map(r => `<Polygon><outerBoundaryIs>${pr(r)}</outerBoundaryIs></Polygon>`).join('')}</MultiGeometry>` : ''}</Placemark>
${dij}
</Document></kml>`;
    _izvozFajl('primka_' + p.naziv.normalize('NFKD').replace(/[^\w-]+/g, '_') + '.kml', kml, 'application/vnd.google-earth.kml+xml', 'Primka · ' + p.naziv + ' — otvori u Grmeč Navigator');
  }
  // Primljen KML: otvori kao projekat ili spoji s postojećim (po dijelu pobjeđuje novija izmjena `t`).
  async function izKml(doc) {
    const el = doc.querySelector('ExtendedData Data[name="usf_primka"] value'); if (!el) return false;
    let dol; try { dol = JSON.parse(izBase64(el.textContent.trim())); } catch (e) { return false; }
    if (!dol || !dol.id || !(dol.ring === null || dol.ring === undefined || Array.isArray(dol.ring)) || !Array.isArray(dol.dijelovi)) return false;
    const lok = nadji(dol.id), prim = dol.dijelovi.filter(d => d.status === 'primljeno').length;
    if (!confirm('„' + dol.naziv + '” — primka (' + dol.dijelovi.length + ' dijelova, primljeno ' + prim + ').\n\n' +
      (lok ? 'Spojiti s tvojim projektom? Novije izmjene pobjeđuju.' : 'Otvoriti kao projekat primke?') + '\n\nOdustani = prikaži samo kao KML sloj.')) return false;
    let p = dol;
    if (lok) {
      const m = new Map(lok.dijelovi.map(d => [d.id, d]));
      dol.dijelovi.forEach(d => { const s = m.get(d.id); if (!s || (d.t || 0) > (s.t || 0)) m.set(d.id, d); });
      p = { ...lok, dijelovi: [...m.values()] };
    }
    sacuvaj(p); aktivni = p.id; otvoriPanel(); crtaj(); render();
    try { map.fitBounds(L.latLngBounds(obuhvat(p)), { padding: [30, 30], maxZoom: 17 }); } catch (e) {}
    return true;
  }

  // ── Panel ──
  function otvoriPanel() { if (typeof _openStubPanel === 'function') _openStubPanel('primka-panel', 'meni'); }
  // Prsten (donut) = udio označenih klasa u površini odjela; centar = % označeno. Boja nikad sama: ikona + naziv + ha u legendi.
  function donutHtml(z) {
    const uk = Math.max(z.odjel, z.oznaceno) || 1, R = 40, C = 2 * Math.PI * R, GAP = 2;
    let off = 0;
    const seg = [...REDOSLIJED.map(k => [STATUS[k].c, z[k]]), ['rgba(148,163,184,.28)', z.neoznaceno]].filter(x => x[1] > 0).map(([c, v]) => {
      const dužina = Math.max(0, C * v / uk - GAP), o = off; off += C * v / uk;
      return `<circle cx="50" cy="50" r="${R}" fill="none" stroke="${c}" stroke-width="11" stroke-dasharray="${dužina.toFixed(2)} ${(C - dužina).toFixed(2)}" stroke-dashoffset="${(-o).toFixed(2)}" transform="rotate(-90 50 50)"/>`;
    }).join('');
    const pct = Math.round(100 * z.oznaceno / uk);
    return `<svg class="pr-donut" viewBox="0 0 100 100" role="img" aria-label="${pct}% odjela označeno"><circle cx="50" cy="50" r="${R}" fill="none" stroke="rgba(148,163,184,.12)" stroke-width="11"/>${seg}<text x="50" y="49" text-anchor="middle" class="pr-d-v">${pct}%</text><text x="50" y="62" text-anchor="middle" class="pr-d-l">označeno</text></svg>`;
  }
  function legendaHtml(z) {
    const red = REDOSLIJED.map(k => `<div class="pr-leg" style="--c:${STATUS[k].c}"><i>${STATUS[k].ik}</i><b>${STATUS[k].t}</b><span>${fmt(z[k], 2)} ha${z['m3' + (k === 'primljeno' ? 'p' : k === 'neprimljeno' ? 'n' : 's')] ? ' · ' + fmt(z['m3' + (k === 'primljeno' ? 'p' : k === 'neprimljeno' ? 'n' : 's')], 1) + ' m³' : ''}</span></div>`);
    red.push(`<div class="pr-leg" style="--c:#94a3b8"><i>○</i><b>Neoznačeno</b><span>${fmt(z.neoznaceno, 2)} ha</span></div>`);
    return `<div class="pr-legende">${red.join('')}</div>`;
  }
  const danas = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const istekao = d => kljucStatusa(d) === 'sumskired' && d.rok && d.rok < danas();
  function trakaHtml(z, p) {
    const otvoreniSr = (p.dijelovi || []).filter(d => kljucStatusa(d) === 'sumskired'), kasni = otvoreniSr.filter(istekao).length;
    const popr = (p.dijelovi || []).filter(d => d.popravljeno).length;
    const kpi = [['m³ primljeno', fmt(z.m3p, 1)], ['Dijelova', String(z.nDij)], ['Za popraviti', String(otvoreniSr.length), otvoreniSr.length ? 'sr' : ''], kasni ? ['Rok istekao', String(kasni), 'ne'] : ['Popravljeno', String(popr), popr ? 'pr' : '']];
    return `<div class="pr-hero">${donutHtml(z)}${legendaHtml(z)}</div>
      <div class="pr-kpi">${kpi.map(([l, v, c]) => `<div class="${c || ''}"><b>${v}</b><span>${l}</span></div>`).join('')}</div>
      ${Object.keys(z.radnici || {}).length ? `<div class="pr-radnici">${Object.entries(z.radnici).sort((a, b) => a[0].localeCompare(b[0], 'bs')).map(([r, v]) => `<span>👷 <b>${esc(r)}</b> ✓ ${fmt(v.p, 2)} · ✕ ${fmt(v.n, 2)}${v.s ? ' · ⚠ ' + fmt(v.s, 2) : ''} ha${v.m3 ? ' · ' + fmt(v.m3, 1) + ' m³' : ''}</span>`).join('')}</div>` : ''}`;
  }
  const dDat = t => new Date(t).toLocaleDateString('bs');
  const isoDatum = t => { if (!t) return ''; const d = new Date(t), m = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + m(d.getMonth() + 1) + '-' + m(d.getDate()); };
  function dioHtml(p, d) {
    const k = kljucStatusa(d), s = STATUS[k], ha = Number.isFinite(d.ha) ? d.ha : haDijela(d.prst), a = `data-id="${p.id}" data-d="${d.id}"`, key = p.id + ':d:' + d.id;
    const pills = (k === 'sumskired' ? (d.razlozi || []).map(r => RAZLOZI[r]).filter(Boolean).map(t => `<em>${esc(t)}</em>`).join('') : '')
      + (istekao(d) ? '<em class="ne">Rok istekao</em>' : '') + (d.popravljeno ? `<em class="pr">Popravljeno ${dDat(d.popravljeno)}</em>` : '');
    return `<details class="pr-dio" id="pr-dio-${d.id}" data-det="${esc(key)}"${otvoreno.has(key) ? ' open' : ''} style="--c:${s.c}">
      <summary><i class="pr-ik">${s.ik}</i><span class="pr-ime">${esc(d.naziv)}</span><span class="pr-ha">${fmt(ha, 2)} ha${d.m3 ? ' · ' + fmt(d.m3, 1) + ' m³' : ''}</span></summary>
      ${pills ? `<div class="pr-pills">${pills}</div>` : ''}
      <div class="pr-dio-tijelo">
      <div class="pr-dio-zag"><input value="${esc(d.naziv)}" data-a="naziv" ${a} maxlength="40"><button data-a="dio-zoom" ${a} title="Na karti">🔍</button><button data-a="dio-brisi" ${a} class="opasno" title="Obriši dio">🗑</button></div>
      <div class="pr-seg">${REDOSLIJED.map(x => `<button data-a="st" data-s="${x}" ${a} style="--c:${STATUS[x].c}" class="${k === x ? 'on' : ''}">${STATUS[x].ik} ${STATUS[x].k}</button>`).join('')}</div>
      ${k === 'sumskired' ? `<div class="pr-razlozi">${Object.entries(RAZLOZI).map(([r, t]) => `<button data-a="razlog" data-r="${r}" ${a} class="${(d.razlozi || []).includes(r) ? 'on' : ''}">${esc(t)}</button>`).join('')}</div>
        <div class="pr-polja"><label>Rok za popravak<input type="date" value="${isoDatum(d.rok)}" data-a="rok" ${a}></label><button class="pr-popr" data-a="popravljeno" ${a}>✓ Popravljeno</button></div>` : ''}
      <div class="pr-polja">
        <label>m³<input type="number" inputmode="decimal" min="0" step="0.01" value="${d.m3 ?? ''}" data-a="m3" ${a}></label>
        <label>Br. primke<input value="${esc(d.brPrimke)}" data-a="brPrimke" ${a} maxlength="30"></label>
        <label>Radnik<input value="${esc(d.radnik)}" data-a="radnik" ${a} maxlength="30"></label>
        <label>Sortimenti<input value="${esc(d.sortimenti)}" data-a="sortimenti" ${a} maxlength="80" placeholder="npr. F/L, ogrjev"></label>
        <label class="pr-sir">Napomena<input value="${esc(d.napomena)}" data-a="napomena" ${a} maxlength="120"></label>
      </div>${d.datum && k === 'primljeno' ? `<small class="pr-dat">Primljeno ${dDat(d.datum)}</small>` : ''}
      </div>
    </details>`;
  }
  // Filter dijelova po klasi (samo u memoriji; panel se iznova crta)
  let filter = 'svi';
  function filterHtml(p) {
    const br = k => (p.dijelovi || []).filter(d => kljucStatusa(d) === k).length;
    return `<div class="pr-chips"><button data-a="filter" data-f="svi" class="${filter === 'svi' ? 'on' : ''}">Svi <b>${(p.dijelovi || []).length}</b></button>${REDOSLIJED.map(k => `<button data-a="filter" data-f="${k}" style="--c:${STATUS[k].c}" class="${filter === k ? 'on' : ''}">${STATUS[k].ik} ${STATUS[k].k} <b>${br(k)}</b></button>`).join('')}</div>`;
  }
  // Aktivan projekat = sve što se označi u Primki (dio odjela) pripada njemu; bez aktivnog odjel se prepoznaje po KML-u ispod dijela.
  function aktivniBar() {
    const a = aktivni && nadji(aktivni), el = document.getElementById('pr-akt'), tx = document.getElementById('pr-brzi-txt');
    if (tx) tx.textContent = a ? '✏ Označi dio u: ' + a.naziv : '✏ Nacrtaj dio (odjel se prepoznaje sam)';
    if (!el) return;
    el.className = 'pr-akt' + (a ? ' on' : '');
    el.innerHTML = a ? `<b>▶ Aktivan odjel: ${esc(a.naziv)}</b><span>Sve što označiš pripada njemu.</span><button data-a="deaktiviraj">Isključi</button>`
      : `<span>Nema aktivnog odjela — odaberi ga ispod ili dodirni projekat. Dio se tada veže uz odjel ispod njega (ili „Bez odjela”).</span>`;
  }
  // Sklopive liste (<details>) — zadano SKLOPLJENE; otvorene se pamte u memoriji jer se panel iznova crta pri svakoj izmjeni.
  const otvoreno = new Set();
  const det = (k, naslov, sadrzaj, klasa) => `<details class="pr-det" data-det="${esc(k)}"${otvoreno.has(k) ? ' open' : ''}><summary>${naslov}</summary><div class="${klasa}">${sadrzaj}</div></details>`;
  function poligoniHtml(p) {
    if (!(p.poligoni && p.poligoni.length)) return '';
    const rows = p.poligoni.map((x, i) => `<div class="pr-pol-red"><b>${esc((x.odjel ? 'Odjel ' + x.odjel : '') + (x.odsjek ? ' · ' + x.odsjek : '') || x.naziv || 'Poligon ' + (i + 1))}</b><span>${fmt(haDijela([x.ring]), 2)} ha</span><button data-a="pol-zoom" data-id="${p.id}" data-i="${i}" title="Na karti">🔍</button></div>`).join('');
    return det(p.id + ':pol', `▣ Poligoni odjela <small>${p.poligoni.length} · ${fmt(zbir(p).odjel, 2)} ha</small>`, rows, 'pr-pol');
  }
  const osnova = z => Math.max(z.odjel, z.oznaceno) || 0;
  const pctHtml = z => { const o = osnova(z); if (!o || !z.nDij) return ''; const v = Math.round(100 * z.primljeno / o); return `<span class="pr-pct" style="--c:${v >= 100 ? '#22c55e' : v >= 50 ? '#84cc16' : '#f59e0b'}">${v} %</span>`; };
  const miniZbir = z => z.nDij ? `<div class="pr-mini">${REDOSLIJED.filter(k => z[k] > 0).map(k => `<span style="--c:${STATUS[k].c}"><i></i>${fmt(z[k], 2)} ha</span>`).join('')}${z.neoznaceno > 0.005 ? `<span class="pr-mini-n">neoznačeno ${fmt(z.neoznaceno, 2)} ha</span>` : ''}</div>` : '';
  let projQ = '';
  // Pregled svih projekata: broj, površina, udio primljenog i šta čeka popravak — iznad liste.
  function ukupnoHtml(l) {
    let od = 0, pr = 0, ne = 0, sr = 0, nsr = 0, kasni = 0;
    l.forEach(p => { const z = zbir(p); od += osnova(z); pr += z.primljeno; ne += z.neprimljeno; sr += z.sumskired; (p.dijelovi || []).forEach(d => { if (kljucStatusa(d) === 'sumskired') { nsr++; if (istekao(d)) kasni++; } }); });
    const v = od ? Math.round(100 * pr / od) : 0;
    return `<section class="pr-ukupno"><div class="pr-uk-kpi">
        <div><b>${l.length}</b><span>${l.length === 1 ? 'projekat' : 'projekata'}</span></div><div><b>${fmt(od, 1)}</b><span>ha ukupno</span></div>
        <div class="pr"><b>${v} %</b><span>primljeno</span></div><div class="${nsr ? 'sr' : ''}"><b>${nsr}</b><span>${kasni ? kasni + ' kasni' : 'za popraviti'}</span></div></div>
      <div class="pr-traka">${[['primljeno', pr], ['neprimljeno', ne], ['sumskired', sr]].map(([k, x]) => `<i style="width:${(100 * x / (od || 1)).toFixed(1)}%;background:${STATUS[k].c}"></i>`).join('')}</div>
      ${l.length > 4 ? `<input type="search" id="pr-trazi" placeholder="Traži odjel…" value="${esc(projQ)}" aria-label="Traži projekat">` : ''}</section><div id="pr-projekti"></div>`;
  }
  function projektiHtml(l) {
    const q = projQ.trim().toLowerCase(), r = q ? l.filter(p => String(p.naziv || '').toLowerCase().includes(q)) : l;
    return r.length ? projektiKartice(r) : '<div class="treg-empty">Nema projekata za ovu pretragu.</div>';
  }
  function projektiKartice(l) {
    return l.map(p => {
      const z = zbir(p), akt = p.id === aktivni, n = (p.dijelovi || []).length;
      const dij = (p.dijelovi || []).filter(d => filter === 'svi' || kljucStatusa(d) === filter);
      return `<section class="ng-card pr-proj${akt ? ' akt' : ''}">
        <div class="pr-proj-zag" data-a="aktiviraj" data-id="${p.id}"><div class="pr-proj-nasl"><b>🪵 ${esc(p.naziv)}</b>${pctHtml(z)}</div><small>${prsteni(p).length ? fmt(z.odjel, 2) + ' ha' + (prsteni(p).length > 1 ? ' · ' + prsteni(p).length + ' poligona' : '') : 'bez granice odjela'} · ${n} ${n === 1 ? 'dio' : 'dijelova'}${p.sjekId ? ' · partije' : ''}${akt ? '' : ' · dodirni za otvaranje'}</small></div>
        ${akt ? trakaHtml(z, p) : `<div class="pr-traka">${REDOSLIJED.map(k => `<i style="width:${(100 * z[k] / (Math.max(z.odjel, z.oznaceno) || 1)).toFixed(1)}%;background:${STATUS[k].c}"></i>`).join('')}</div>${miniZbir(z)}`}
        ${akt ? `<div class="sl-dug"><button class="zp-glavno" data-a="dock" data-id="${p.id}">✏ Označi dio na karti</button><button data-a="partije" data-id="${p.id}">Partije iz sjekačkih</button></div>
        ${poligoniHtml(p)}
        ${n ? filterHtml(p) : ''}
        <div class="pr-dijelovi">${dij.map(d => dioHtml(p, d)).join('') || `<p class="uk-izvor">${n ? 'Nema dijelova u ovoj klasi.' : 'Dodirni „Označi dio na karti”, odaberi klasu — <b style="color:#22c55e">primljeno</b>, <b style="color:#ef4444">neprimljeno</b> ili <b style="color:#f59e0b">popraviti šumski red</b> — i nacrtaj dio odjela.'}</p>`}</div>
        <div class="sl-dug"><button data-a="kml" data-id="${p.id}">📤 Podijeli (KML)</button><button data-a="zoom" data-id="${p.id}">🔍 Na karti</button><button data-a="vid" data-id="${p.id}">${p.vidljiv !== false ? '🙈 Sakrij' : '👁 Prikaži'}</button><button data-a="brisi" data-id="${p.id}" class="opasno" title="Obriši projekat">🗑</button></div>` : ''}
      </section>`;
    }).join('');
  }
  function render() {
    aktivniBar(); izborRender();
    const el = document.getElementById('pr-lista'); if (!el) return;
    const l = citaj();
    if (aktivni && !l.some(p => p.id === aktivni)) aktivni = null;
    pamtiAktivni();
    if (!l.length) { el.innerHTML = ''; return; }
    el.innerHTML = ukupnoHtml(l);
    document.getElementById('pr-projekti').innerHTML = projektiHtml(l);
  }
  function polje(el) {
    const p = nadji(el.dataset.id), d = p && (p.dijelovi || []).find(x => x.id === el.dataset.d); if (!d) return;
    const k = el.dataset.a, v = el.value.trim();
    if (k === 'rok') { const t = v ? Date.parse(v + 'T12:00:00') : NaN; d.rok = Number.isFinite(t) ? t : null; }
    else if (k === 'm3') { const n = Number(v.replace(',', '.')); d.m3 = v === '' || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 100) / 100; }
    else if (['naziv', 'brPrimke', 'radnik', 'sortimenti', 'napomena'].includes(k)) d[k] = v.slice(0, k === 'napomena' ? 120 : 80);
    else return;
    d.t = Date.now(); sacuvaj(p);
    // change dolazi i na blur (dodir na drugo dugme) — novi HTML tek poslije tog događaja
    if (k === 'm3' || k === 'rok') setTimeout(() => { render(); crtaj(); }, 0);
  }
  function postaviStatus(pid, did, k) {
    const p = nadji(pid), d = p && (p.dijelovi || []).find(x => x.id === did); if (!d || !STATUS[k]) return;
    d.status = k; d.datum = k === 'primljeno' ? (d.datum || Date.now()) : null; d.t = Date.now();
    if (k === 'sumskired') { d.razlozi = d.razlozi || []; d.popravljeno = null; }
    sacuvaj(p); crtaj(); render(); dockRender();
  }
  // Šumski red popravljen: dio prelazi u „primljeno”, a datum popravka ostaje zapisan (razlozi se čuvaju kao historija)
  function popravljeno(pid, did) {
    const p = nadji(pid), d = p && (p.dijelovi || []).find(x => x.id === did); if (!d) return;
    d.status = 'primljeno'; d.popravljeno = Date.now(); d.datum = d.datum || Date.now(); d.t = Date.now();
    sacuvaj(p); map.closePopup(); crtaj(); render(); dockRender(); toast('✓ Šumski red popravljen — dio je primljen');
  }
  function razlog(pid, did, r) {
    const p = nadji(pid), d = p && (p.dijelovi || []).find(x => x.id === did); if (!d || !RAZLOZI[r]) return;
    const a = d.razlozi = d.razlozi || [], i = a.indexOf(r); if (i >= 0) a.splice(i, 1); else a.push(r);
    d.t = Date.now(); sacuvaj(p); render();
  }
  async function akcija(el) {
    const a = el.dataset.a, p = el.dataset.id ? nadji(el.dataset.id) : null;
    if (a === 'deaktiviraj') { aktivni = null; crtaj(); render(); return; }
    if (a.startsWith('izb-')) { izborAkcija(el); return; }
    if (a === 'brzi') { brziDio(); return; }
    if (a === 'filter') { filter = el.dataset.f; render(); return; }
    if (!p) return;
    if (a === 'aktiviraj') { aktivni = aktivni === p.id ? null : p.id; crtaj(); render(); return; }
    if (a === 'dock') { dockOtvori(p.id); return; }
    if (a === 'partije') { uvezPartije(p.id); return; }
    if (a === 'kml') { izvozKml(p); return; }
    if (a === 'zoom') { zoomProjekat(p); return; }
    if (a === 'vid') { p.vidljiv = p.vidljiv === false; sacuvaj(p); crtaj(); render(); return; }
    if (a === 'brisi') { if (!confirm('Obrisati primku „' + p.naziv + '” sa svim dijelovima?')) return; pisi(citaj().filter(x => x.id !== p.id)); if (dock === p.id) dock = null; crtaj(); render(); dockRender(); return; }
    if (a === 'pol-zoom') { const x = (p.poligoni || [])[Number(el.dataset.i)]; if (x) { if (typeof switchMainTab === 'function') switchMainTab('karta'); try { map.fitBounds(L.latLngBounds(x.ring), { padding: [40, 40], maxZoom: 17 }); } catch (e) {} } return; }
    const d = (p.dijelovi || []).find(x => x.id === el.dataset.d); if (!d) return;
    if (a === 'st') { postaviStatus(p.id, d.id, el.dataset.s); return; }
    if (a === 'razlog') { razlog(p.id, d.id, el.dataset.r); return; }
    if (a === 'popravljeno') { popravljeno(p.id, d.id); return; }
    if (a === 'dio-zoom') { if (typeof switchMainTab === 'function') switchMainTab('karta'); try { map.fitBounds(L.latLngBounds(d.prst.flat()), { padding: [40, 40], maxZoom: 18 }); } catch (e) {} return; }
    if (a === 'dio-brisi') { if (!confirm('Obrisati „' + d.naziv + '”?')) return; p.dijelovi = p.dijelovi.filter(x => x.id !== d.id); sacuvaj(p); crtaj(); render(); }
  }

  window.USFPrimka = {
    dockOtvori, dockZatvori, crtajStatus, tackaOvdje,
    dockSrGotovo(r) { if (!RAZLOZI[r]) return; dockSr.has(r) ? dockSr.delete(r) : dockSr.add(r); dockRender(); },
    razlog, popravljeno,
    // Cijeli odjel jednom klasom (npr. sve primljeno): dio = poligoni projekta
    async izbCijeli(pid) {
      const p = nadji(pid), rs = p && prsteni(p); if (!rs || !rs.length) { toast('Projekat nema granicu odjela'); return; }
      const k = await pitajStatus('Cijeli odjel (' + fmt(zbir(p).odjel, 2) + ' ha)'); if (!k) return;
      porukaDijela(k, dodajDio(p, rs.map(r => r.slice()), k), p);
    },
    otvori() { otvoriPanel(); if (aktivni && !nadji(aktivni)) aktivni = null; crtaj(); render(); },
    izbPocni() { izborOtvori(); izbPocetniPogled(); izbNaKarti(); },
    izbGotovo() { const sel = izbor ? ukIzbor() : []; if (sel.length) napraviIzPoligona(sel); },
    izbLista() { if (!izbor) return; izbMapaKraj(); crtBar().innerHTML = ''; otvoriPanel(); render(); },
    izbOdustani() { izbZatvori(); render(); },
    brziDio, crtajDio(pid) { map.closePopup(); crtPocni('dio', pid); },
    otvoriProjekat(pid) { map.closePopup(); aktivni = pid; otvoriPanel(); crtaj(); render(); },
    sakrij(pid) { map.closePopup(); const p = nadji(pid); if (!p) return; p.vidljiv = false; sacuvaj(p); crtaj(); render(); toast('🙈 „' + p.naziv + '” sakriven — Primka → Prikaži'); },
    obrisi(pid) { const p = nadji(pid); if (!p || !confirm('Obrisati primku „' + p.naziv + '” sa svim dijelovima?')) return; map.closePopup(); pisi(citaj().filter(x => x.id !== pid)); crtaj(); render(); },
    _odjelPod: odjelPod,
    status(pid, did, s) { map.closePopup(); postaviStatus(pid, did, s); },
    uredi(pid, did) { map.closePopup(); aktivni = pid; filter = 'svi'; otvoreno.add(pid + ':d:' + did); otvoriPanel(); render(); setTimeout(() => document.getElementById('pr-dio-' + did)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60); },
    obrisiDio(pid, did) { const p = nadji(pid); if (!p || !confirm('Obrisati ovaj dio?')) return; map.closePopup(); p.dijelovi = (p.dijelovi || []).filter(x => x.id !== did); sacuvaj(p); crtaj(); render(); },
    crtGps, crtZavrsi, crtVrati() { if (crt) { crt.pts.pop(); crtOsvjezi(); } }, crtOdustani: crtKraj,
    izKml, uvezPartije,
    // za testove
    // Nacrtaj prsten na karti (dodir/GPS); Promise → [[la, lo]…] ili null (odustao).
    nacrtaj(opc) { return new Promise(res => { if (crt) { res(null); return; } crtPocni('vanjski', null, { ...(opc || {}), cb: res }); }); },
    geo: { ha: haDijela, unutar, isijeci, oduzmi },
    _haDijela: haDijela, _unutar: unutar, _zbir: zbir, _isijeci: isijeci, _oduzmi: oduzmi
  };
  const panel = typeof document !== 'undefined' && document.getElementById('primka-panel');
  if (panel) {
    panel.addEventListener('click', e => { const el = e.target.closest('[data-a]'); if (el && el.tagName !== 'INPUT' && el.tagName !== 'SELECT') akcija(el); });
    panel.addEventListener('change', e => { const el = e.target.closest('input[data-a]'); if (!el) return; if (el.dataset.a.startsWith('izb-')) izborAkcija(el); else polje(el); });
    panel.addEventListener('toggle', e => { const d = e.target; if (d && d.dataset && d.dataset.det) { if (d.open) otvoreno.add(d.dataset.det); else otvoreno.delete(d.dataset.det); } }, true);
    panel.addEventListener('input', e => { if (e.target.id === 'pr-izb-trazi' && izbor) { izbor.trazi = e.target.value; izborLista(); } else if (e.target.id === 'pr-trazi') { projQ = e.target.value; const c = document.getElementById('pr-projekti'); if (c) c.innerHTML = projektiHtml(citaj()); } });
  }
  if (typeof map !== 'undefined' && map && map.getContainer) { crtaj(); render(); }
})();
