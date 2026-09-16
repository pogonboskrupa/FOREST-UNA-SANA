// =====================================================================
// FIREBASE INIT — Una Sana Forest
// ---------------------------------------------------------------------
// Bez login ekrana (korisnička odluka): svaki uređaj se prijavljuje
// ANONIMNO (Firebase Anonymous Auth) čim ima interneta — dobija stabilan
// UID bez ijednog polja za unos. Security Rules zatim dozvoljavaju čitanje
// svima (i anonimnim korisnicima), a upis admin-only podataka (FIRMS/GFW/
// CDSE ključevi) samo UID-ovima upisanim u usf_admins kolekciju — vidi
// firebase/firestore.rules i firebase/README.md za postupak dodavanja admina.
//
// FIREBASE_CONFIG je namjerno prazan dok se ne dobije stvarna konfiguracija
// iz Firebase Console (Project settings → Your apps → Web app). Do tada se
// init tiho preskače — app radi normalno bez Firebase-a (karta/GPS/trag ne
// zavise od backend-a), samo Požari sekcija ostaje "u izradi".
// =====================================================================
const FIREBASE_CONFIG = null; // TODO: zalijepi firebaseConfig objekat iz Firebase Console

let fbApp = null, fbAuth = null, fbDb = null, fbUid = null;

async function _fbInit() {
  if (!FIREBASE_CONFIG) return; // konfiguracija još nije postavljena
  if (typeof firebase === 'undefined') return; // SDK nije učitan (offline prvi put)
  try {
    fbApp = firebase.initializeApp(FIREBASE_CONFIG);
    fbAuth = firebase.auth();
    fbDb = firebase.firestore();
    // Perzistentan lokalni keš — offline-first čitanje kad nema interneta
    // (Firestore SDK ionako radi offline-first, ovo samo produžava keš preko restart-a).
    try { await fbDb.enablePersistence({ synchronizeTabs: true }); } catch(e) { /* više tabova/nepodržano — nastavi bez perzistencije */ }
    fbAuth.onAuthStateChanged(user => {
      if (user) { fbUid = user.uid; _fbOnReady(); }
    });
    if (!fbAuth.currentUser) await fbAuth.signInAnonymously();
  } catch(e) {
    console.error('Firebase init greška:', e);
  }
}

// Pozovi kad je UID dostupan — Postavke panel ga prikazuje da ga korisnik
// može poslati administratoru za dodavanje u usf_admins (vidi firebase/README.md).
function _fbOnReady() {
  const el = document.getElementById('set-uid-txt');
  if (el) el.textContent = fbUid;
}

_fbInit();
