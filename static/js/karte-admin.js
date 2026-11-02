// Lista karata za preuzimanje (GitHub releasei) iz Firestore kolekcije `usf_karte` + uređivanje za admina.
// Čitanje: svako prijavljen (anonimno ok). Upis: samo UID iz `usf_admins` (firebase/firestore.rules) — zaštita je na serveru,
// ime korisnika ništa ne daje. Bez interneta/Firestore-a app koristi static/data/karte_github.json i zadnju zapamćenu listu.
(function (root) {
  'use strict';
  const KOL = 'usf_karte', PREFIKS = 'https://github.com/pogonboskrupa/KARTE/releases/download/';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ok = k => !!(k && k.id && typeof k.url === 'string' && k.url.startsWith(PREFIKS));
  const baza = () => (typeof fbDb !== 'undefined' && fbDb) || null;
  const uid = () => (typeof fbUid !== 'undefined' && fbUid) || null;
  const cekaj = async ms => { const t0 = Date.now(); while (Date.now() - t0 < ms && !(baza() && uid())) await new Promise(r => setTimeout(r, 200)); return !!(baza() && uid()); };
  const istek = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('istek')), ms))]);

  async function ucitaj() {
    try {
      if (!await cekaj(4000)) return null;
      const sn = await istek(baza().collection(KOL).get(), 7000);
      const l = sn.docs.map(d => ({ ...d.data(), id: d.id })).filter(ok).sort((a, b) => (a.redni || 0) - (b.redni || 0));
      return l.length ? l : null;
    } catch (e) { return null; }
  }
  let _admin = null;
  async function jeAdmin() {
    if (_admin !== null) return _admin;
    try {
      if (!await cekaj(4000)) return false;
      const d = await istek(baza().collection('usf_admins').doc(uid()).get(), 6000);
      _admin = !!(d.exists && d.data().active === true);
    } catch (e) { return false; }
    return _admin;
  }

  let ov = null, lista = [], osvjezi = null;
  const zatvori = () => { if (ov) { ov.remove(); ov = null; } };
  const poruka = t => { try { showToast(t); } catch (e) {} };
  async function snimi(k) {
    const { id, ...d } = k;
    await istek(baza().collection(KOL).doc(id).set(d), 8000);
  }
  async function sviZapisi() { const l = await ucitaj(); return l || []; }
  async function obnovi() { lista = await sviZapisi(); crtaj(); if (osvjezi) await osvjezi(); }

  function crtaj() {
    if (!ov) return;
    ov.querySelector('.ka-tijelo').innerHTML = (lista.length ? lista.map((k, i) => `<div class="ka-red" data-i="${i}"><div><b>${esc(k.naziv)}</b><small>${esc(k.opis || '')}${k.mb ? ' · ' + k.mb + ' MB' : ''}</small></div>
      <button data-a="gore" ${i ? '' : 'disabled'} aria-label="Gore">↑</button><button data-a="uredi" aria-label="Uredi">✏</button><button data-a="brisi" class="opasno" aria-label="Obriši">🗑</button></div>`).join('')
      : '<p class="ka-prazno">Lista na serveru je prazna — app koristi ugrađenu listu. Dodaj prvu kartu ili prenesi ugrađenu listu.</p>')
      + '<button class="ka-nova" data-a="nova">＋ Nova karta</button>'
      + (lista.length ? '' : '<button class="ka-nova" data-a="prenesi">⬆ Prenesi ugrađenu listu na server</button>');
  }
  function forma(k) {
    return new Promise(res => {
      const f = document.createElement('div'); f.className = 'ka-ov ka-forma';
      f.innerHTML = `<div class="ka-sheet"><div class="ka-zag"><b>${k.id ? '✏ Uredi kartu' : '＋ Nova karta'}</b><button data-a="x">✕</button></div>
        <label>Naziv<input data-f="naziv" value="${esc(k.naziv)}" placeholder="Karta UNSKO V.1.2"></label>
        <label>Opis<input data-f="opis" value="${esc(k.opis)}" placeholder="server · ŠPD UNSKO SANSKE ŠUME"></label>
        <label>Veličina (MB, nije obavezno)<input data-f="mb" inputmode="numeric" value="${esc(k.mb)}"></label>
        <label>Link na release (…/releases/download/…)<input data-f="url" value="${esc(k.url)}" placeholder="${PREFIKS}V.1.2/KARTA.mbtiles"></label>
        <p class="ka-nap">Release na repou KARTE mora biti objavljen (ne draft). Dozvoljeni su samo linkovi sa pogonboskrupa/KARTE.</p>
        <div class="ka-akc"><button data-a="x">Odustani</button><button class="glavno" data-a="ok">Sačuvaj</button></div></div>`;
      document.body.appendChild(f);
      f.addEventListener('click', e => {
        if (e.target === f) { f.remove(); res(null); return; }
        const a = e.target.closest('[data-a]'); if (!a) return;
        if (a.dataset.a === 'x') { f.remove(); res(null); return; }
        const v = n => f.querySelector('[data-f="' + n + '"]').value.trim();
        const o = { ...k, naziv: v('naziv').slice(0, 60), opis: v('opis').slice(0, 120), url: v('url') };
        const mb = Math.round(Number(v('mb'))); if (mb > 0) o.mb = mb; else delete o.mb;
        if (!o.naziv) { poruka('Upiši naziv'); return; }
        if (!o.url.startsWith(PREFIKS)) { poruka('Link mora počinjati sa ' + PREFIKS); return; }
        f.remove(); res(o);
      });
    });
  }
  async function otvori(cb) {
    if (!await jeAdmin()) { poruka('Nemaš admin pravo (UID nije u usf_admins)'); return; }
    osvjezi = cb; zatvori();
    ov = document.createElement('div'); ov.className = 'ka-ov';
    ov.innerHTML = '<div class="ka-sheet"><div class="ka-zag"><b>⚙ Karte za preuzimanje</b><button data-a="zatvori">✕</button></div><div class="ka-tijelo"></div><p class="ka-nap">Promjene vide svi korisnici čim otvore listu. Sam fajl karte dodaješ kao release na GitHub-u (repo KARTE).</p></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', async e => {
      if (e.target === ov) { zatvori(); return; }
      const a = e.target.closest('[data-a]'); if (!a) return;
      const i = +((a.closest('.ka-red') || {}).dataset || {}).i, k = lista[i];
      try {
        if (a.dataset.a === 'zatvori') zatvori();
        else if (a.dataset.a === 'nova') { const o = await forma({ id: '', naziv: '', opis: 'server · ŠPD UNSKO SANSKE ŠUME', url: PREFIKS }); if (o) { o.id = 'k_' + Date.now().toString(36); o.redni = lista.length ? Math.max(...lista.map(x => x.redni || 0)) + 1 : 1; await snimi(o); poruka('✅ Karta dodana'); await obnovi(); } }
        else if (a.dataset.a === 'uredi' && k) { const o = await forma(k); if (o) { await snimi(o); poruka('✅ Sačuvano'); await obnovi(); } }
        else if (a.dataset.a === 'brisi' && k) { if (await _dlgConfirm('Obrisati „' + k.naziv + '” sa liste? (Fajl na GitHub-u ostaje.)', { danger: true, okLabel: 'Obriši' })) { await istek(baza().collection(KOL).doc(k.id).delete(), 8000); poruka('🗑 Obrisano'); await obnovi(); } }
        else if (a.dataset.a === 'gore' && k && i > 0) { const p = lista[i - 1]; await snimi({ ...k, redni: p.redni || i }); await snimi({ ...p, redni: k.redni || i + 1 }); await obnovi(); }
        else if (a.dataset.a === 'prenesi') {
          const r = await fetch('static/data/karte_github.json', { cache: 'no-store' }); const l = (await r.json()).filter(ok);
          for (let j = 0; j < l.length; j++) await snimi({ ...l[j], redni: j + 1 });
          poruka('✅ Preneseno: ' + l.length); await obnovi();
        }
      } catch (er) { poruka('⚠ Nije sačuvano: ' + (er && er.message === 'istek' ? 'nema veze' : (er && er.code === 'permission-denied' ? 'pravila na serveru nisu objavljena ili nisi admin' : (er && er.message) || 'greška'))); }
    });
    await obnovi();
  }
  root.USFKarteAdmin = { ucitaj, jeAdmin, otvori, ok, PREFIKS };
  if (typeof module !== 'undefined') module.exports = root.USFKarteAdmin;
})(typeof window !== 'undefined' ? window : globalThis);
