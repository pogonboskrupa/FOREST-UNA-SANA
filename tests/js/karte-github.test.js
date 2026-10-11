const fs = require('fs'), assert = require('assert');
const R = f => fs.readFileSync(f, 'utf8');
const l = JSON.parse(R('static/data/karte_github.json'));
assert(l.length >= 2 && l.every(k => k.id && k.naziv && !k.enc));
assert(l.every(k => /^https:\/\/github\.com\/pogonboskrupa\/KARTE\/releases\/download\/[^?#\s]+\.(mbtiles|sqlitedb)$/.test(k.url)), 'samo javni release fajlovi karata');
assert(new Set(l.map(k => k.id)).size === l.length);
// stariji APK-ovi čitaju karte_drive.json — u njoj ne smije biti zapisa bez `enc`
assert(JSON.parse(R('static/data/karte_drive.json')).every(k => k.enc));
const H = R('index.html'), J = R('android/app/src/main/java/ba/spd/usf/forest/MainActivity.java');
assert(H.includes("_DKG_URL") && H.includes('if (k.url) return _dkGhPreuzmi(k)') && H.includes('kljuc || k.url ?'));
assert(J.includes('jeDozvoljenaKarta(url)') && J.includes('https://github.com/pogonboskrupa/KARTE/releases/download/'));
assert(R('sw.js').includes("'./static/data/karte_github.json'") && R('android/copy-assets.sh').includes('static/data/karte_github.json'));
console.log('karte-github ok');
