# Firebase setup — Una Sana Forest

Aplikacija koristi Firebase (isti projekat kao neka druga tvoja aplikacija —
namjerno, sve kolekcije ove app-e nose prefiks `usf_` da se ne miješaju sa
postojećim podacima). Bez login ekrana: svaki uređaj se prijavljuje anonimno
i dobija stabilan UID, admin pristup se dodjeljuje ručno preko tog UID-a.

## 1. Registruj Web app u postojećem Firebase projektu

Firebase Console → taj projekat → ⚙ Project settings → dolje "Your apps" →
**Add app → Web (`</>`)** → naziv npr. "Una Sana Forest" → **Register app**.
Firebase prikaže `firebaseConfig` objekat — kopiraj ga.

## 2. Zalijepi config u repo

Otvori `static/js/firebase-init.js` i zamijeni:

```js
const FIREBASE_CONFIG = null;
```

sa stvarnim objektom, npr.:

```js
const FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "...firebaseapp.com",
  projectId: "...",
  storageBucket: "...appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
```

`apiKey` u web configu NIJE tajna (identifikuje projekat, ne autorizuje
pristup) — sigurno je da bude u repou, kao i kod svih Firebase web app-ova.

## 3. Uključi Anonymous Authentication

Firebase Console → **Authentication** → **Sign-in method** → **Anonymous** →
Enable. Bez ovoga `signInAnonymously()` u `firebase-init.js` pada sa greškom
i app ostaje bez pristupa Firestore-u (karta/GPS i dalje rade — samo Požari
sekcija ostaje nedostupna).

## 4. Postavi Firestore Security Rules

Firebase Console → **Firestore Database** → **Rules** → zalijepi sadržaj
`firebase/firestore.rules` iz ovog repoa → **Publish**.

## 5. Dodaj sebe kao admina (za FIRMS/GFW/CDSE ključeve)

1. Otvori app (APK ili web), idi na **Postavke** → "Uređaj ID" → **Kopiraj**.
2. Firebase Console → **Firestore Database** → **Start collection** →
   ID kolekcije: `usf_admins`.
3. ID dokumenta: zalijepi UID koji si kopirao. Polje: `active` (boolean) = `true`.
4. Sačuvaj. Taj uređaj sad može mijenjati `usf_pozari_kljucevi` (dolazi u
   Požari sekciji — zadatak #4).

## Konvencija imenovanja

Sve kolekcije ove app-e: prefiks `usf_` (`usf_admins`, `usf_pozari_kljucevi`,
`usf_tragovi`, `usf_pozari_kes`, ...). Nikad ne diraj kolekcije bez tog
prefiksa — pripadaju drugoj aplikaciji u istom projektu.
