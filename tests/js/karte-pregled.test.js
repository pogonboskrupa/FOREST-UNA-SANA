const fs = require('fs'), assert = require('assert');
const H = fs.readFileSync('index.html', 'utf8');
assert(H.includes('id="kh-pregled"') && H.includes('id="kh-offline-kartica"') && H.includes('id="kh-server"') && H.includes('id="kh-b-kml"'));
const f = H.slice(H.indexOf('function _khStat() {'), H.indexOf('function _khKmlTrazi()'));
// pregled: podloga, offline, KML, slojevi; isključi samo kad ima slojeva praćenja šume; svaki dodir vodi negdje
for (const t of ['openUcitajKartuSection()', '_khKmlTrazi()', '_tematskiIskljuci()', 'offline podloga', 'uključenih slojeva']) assert(f.includes(t), t);
assert(/\.kh-pl\.on/.test(H) && /\.kh-bedz/.test(H) && /@media \(min-width:700px\) \{ \.kh-pregled/.test(H));
console.log('karte-pregled ok');
