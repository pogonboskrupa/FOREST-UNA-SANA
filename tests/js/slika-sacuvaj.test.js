const fs = require('fs'), assert = require('assert');
const sj = fs.readFileSync('static/js/sjekacke.js', 'utf8'), sk = fs.readFileSync('static/js/slika-karte.js', 'utf8');
assert(/data-a="slika-sac"/.test(sj) && /a === 'slika-sac'/.test(sj));
assert(/sacuvaj \? 'sacuvaj' : 'podijeli'/.test(sj));
assert(/AndroidDownload\.save\(ime, url\)/.test(sk) && /USFSlika = \{ napravi, podijeli, sacuvaj \}/.test(sk));
assert(/\.png'/.test(sk));
assert(require('../../static/js/ikone.js').USFIkPath('preuzmi'));
console.log('slika-sacuvaj ok');
