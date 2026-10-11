const fs = require('fs'), assert = require('assert');
const sj = fs.readFileSync('static/js/sjekacke.js', 'utf8');
assert(sj.includes('data-a="sve-vid"') && sj.includes('data-a="sve-brisi"') && sj.includes('Sakrij sve') && sj.includes('Prikaži sve'));
// zajedničke radnje se obrađuju prije nadji(el.dataset.id) — dugmad nemaju data-id
assert(sj.indexOf("a === 'sve-vid'") < sj.indexOf('const p = nadji(el.dataset.id); if (!p) return;\n    if (![\'otvori\''));
assert(/confirm\('Obrisati SVE projekte/.test(sj) && sj.includes('pisi([]); aktivni = null;'));
assert(sj.includes('const sviSkriveni = l.every(x => x.vidljiv === false)'));
console.log('sjekacke-sve ok');
