#!/bin/bash
# Kopira web fajlove u android/app/src/main/assets/
# Pokrenuti iz korijenskog direktorija projekta: bash android/copy-assets.sh

set -e

ASSETS_DIR="android/app/src/main/assets"

rm -rf "$ASSETS_DIR"
mkdir -p "$ASSETS_DIR"
mkdir -p "$ASSETS_DIR/static"
mkdir -p "$ASSETS_DIR/geo"

# Glavni fajlovi
cp index.html "$ASSETS_DIR/"
cp manifest.json "$ASSETS_DIR/"
cp sw.js "$ASSETS_DIR/"

# Ikone
cp icon-192.png "$ASSETS_DIR/"
cp icon-512.png "$ASSETS_DIR/"
cp apple-touch-icon.png "$ASSETS_DIR/"

# GeoJSON / KML podaci (opciono, ne ruši build ako fajl ne postoji)
cp -r geo/* "$ASSETS_DIR/geo/" 2>/dev/null || true
cp -r static/* "$ASSETS_DIR/static/" 2>/dev/null || true

echo "Assets kopirani u $ASSETS_DIR/"
echo "Ukupna velicina: $(du -sh $ASSETS_DIR | cut -f1)"
