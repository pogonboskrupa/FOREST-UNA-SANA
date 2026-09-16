#!/bin/bash
# Pokrenite ovaj script JEDNOM da generišete RELEASE potpisni ključ za APK.
# Čuvajte keystore.jks na sigurnom — bez njega ne možete updatovati aplikaciju!
# Debug ključ (android/app/unasanaforest-debug.keystore) je već fiksan i u repou —
# ovo je SAMO za release potpis, van repoa (USF_* env varijable u CI).

set -e

KEYSTORE="unasanaforest-release.jks"
ALIAS="unasanaforest"

echo "=== Generisanje release keystore-a za UNA SANA FOREST APK ==="
keytool -genkeypair \
  -keystore "$KEYSTORE" \
  -alias "$ALIAS" \
  -keyalg RSA \
  -keysize 2048 \
  -validity 9125 \
  -dname "CN=Una Sana Forest, OU=Pozari, O=Pogon Boskrupa, L=Bihac, ST=USK, C=BA"

echo ""
echo "=== SHA-256 fingerprint ==="
keytool -list -v \
  -keystore "$KEYSTORE" \
  -alias "$ALIAS" \
  | grep "SHA256:" \
  | awk '{print $2}'

echo ""
echo "Keystore sačuvan u: $KEYSTORE"
echo "Podesite CI (USF_KEYSTORE/USF_STORE_PASSWORD/USF_KEY_ALIAS/USF_KEY_PASSWORD)."
