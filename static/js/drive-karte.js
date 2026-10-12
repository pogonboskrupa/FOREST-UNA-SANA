// Drive karte za preuzimanje uz PIN. Drive fajl ID je šifrovan AES-256-GCM ključem izvedenim
// iz PIN-a (PBKDF2-SHA256), pa ni repo ni app ne pokazuju link. Isti kod koriste app (WebCrypto
// u WebView-u), alat tools/karta_drive_dodaj.mjs i testovi (Node webcrypto).
// Iskreno: 4 cifre + javni repo = šifra se može razbiti grubom silom; brava za radoznale.
(function (root) {
  'use strict';
  const SOL = 'usf-karte-v1', ITER = 250000;
  const KLJUC_LS = 'usf_karte_kljuc';
  const subtle = () => (root.crypto && root.crypto.subtle) || require('node:crypto').webcrypto.subtle;
  const randomIv = () => { const iv = new Uint8Array(12); ((root.crypto && root.crypto.getRandomValues) ? root.crypto : require('node:crypto').webcrypto).getRandomValues(iv); return iv; };
  const uB64 = u8 => typeof Buffer !== 'undefined' ? Buffer.from(u8).toString('base64') : btoa(String.fromCharCode.apply(null, u8));
  const izB64 = s => typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(s, 'base64')) : Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function kljucIzPina(pin) {
    const s = subtle(), mat = await s.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(SOL), iterations: ITER }, mat, 256));
  }
  const aes = raw => subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  async function sifruj(raw, obj) {
    const iv = randomIv(), ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, await aes(raw), new TextEncoder().encode(JSON.stringify(obj))));
    const out = new Uint8Array(iv.length + ct.length); out.set(iv); out.set(ct, iv.length);
    return uB64(out);
  }
  async function desifruj(raw, enc) { // null = pogrešan ključ / oštećeno
    try {
      const b = izB64(enc), pt = await subtle().decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, await aes(raw), b.slice(12));
      return JSON.parse(new TextDecoder().decode(pt));
    } catch (e) { return null; }
  }
  // Drive link (…/file/d/<ID>/view, …?id=<ID>, ili sam ID) → ID
  function driveId(link) {
    const s = String(link || '').trim();
    const m = /\/d\/([\w-]{20,})/.exec(s) || /[?&]id=([\w-]{20,})/.exec(s) || /^([\w-]{20,})$/.exec(s);
    return m ? m[1] : null;
  }
  // confirm=t preskače Drive stranicu "fajl je prevelik za provjeru virusa"
  const urlPreuzimanja = id => 'https://drive.usercontent.google.com/download?id=' + encodeURIComponent(id) + '&export=download&confirm=t';

  // ── PIN koji se mijenja svaki mjesec ──
  // Svaki zapis nosi `encm`: { 'm2026-10': šifrat, 'm2026-11': … } — isti Drive ID šifrovan PIN-om za taj mjesec; poslije zadnjeg mjeseca važi zadnji PIN.
  // App uzima šifrat tekućeg mjeseca, pa PIN iz prošlog mjeseca ne otključava ništa novo, a već preuzete karte
  // ostaju na telefonu (ne traže PIN). Ključevi mjeseci NISU PIN. Format PIN-a (npr. tokeni YY/MM) zna samo vlasnik
  // i daje ga alatu preko USF_PIN_FORMAT — nikad se ne commituje.
  const mjesecKljuc = (d = new Date()) => 'm' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const pinIzFormata = (format, d = new Date()) => String(format).replace(/YYYY/g, String(d.getFullYear())).replace(/YY/g, String(d.getFullYear()).slice(-2)).replace(/MM/g, String(d.getMonth() + 1).padStart(2, '0'));
  // n mjeseci od datuma `od`: { mjesecKljuc: šifrat(PIN tog mjeseca) }
  async function sifrujMjesecno(obj, format, od = new Date(), n = 13) {
    const out = {};
    for (let i = 0; i < n; i++) {
      const d = new Date(od.getFullYear(), od.getMonth() + i, 1);
      out[mjesecKljuc(d)] = await sifruj(await kljucIzPina(pinIzFormata(format, d)), obj);
    }
    return out;
  }
  // Poslije zadnjeg unaprijed pripremljenog mjeseca PIN ostaje onaj zadnji (ne ističe): kljucZa vraća ključ šifrata koji važi za datum d.
  function kljucZa(zapis, d = new Date()) {
    const mj = zapis && zapis.encm ? Object.keys(zapis.encm).sort() : [];
    if (!mj.length) return null;
    const k = mjesecKljuc(d);
    if (zapis.encm[k]) return k;
    return k > mj[mj.length - 1] ? mj[mj.length - 1] : null; // 'mGGGG-MM' se poredi leksikografski
  }
  const encZaMjesec = (zapis, d = new Date()) => { const k = kljucZa(zapis, d); return k ? zapis.encm[k] : null; };

  const api = { SOL, ITER, KLJUC_LS, mjesecKljuc, pinIzFormata, sifrujMjesecno, kljucZa, encZaMjesec, kljucIzPina, sifruj, desifruj, driveId, urlPreuzimanja, uB64, izB64 };
  root.USFDriveKarte = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
