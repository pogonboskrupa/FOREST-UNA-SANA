'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/build-apk.yml'), 'utf8');
const builder = fs.readFileSync(path.join(root, 'android/build-apk.ps1'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const activity = fs.readFileSync(path.join(root, 'android/app/src/main/java/ba/spd/usf/forest/MainActivity.java'), 'utf8');

assert.match(workflow, /APP_VERSION=.*sed/);
assert.match(workflow, /tag_name: v\$\{\{ env\.APP_VERSION \}\}/);
assert.doesNotMatch(workflow, /v1\.2\.4/);
assert.match(builder, /\[string\]\$Branch\s*=\s*"codex-forest"/);
assert.match(builder, /ValidateSet\("codex-forest", "apk-build-v1"\)/);
assert.match(index, /_rdResultLayer = L\.polyline\([^\n]+pane:\s*'tragMsrLines'/);
assert.match(index, /const poly = L\.polyline\([^\n]+pane:\s*'tragMsrLines'/);
assert.match(index, /id="set-update-progress"/);
assert.match(index, /function _azurirajStatus\(msg, pct, phase, downloaded, total\)/);
assert.match(activity, /\.apk\.part|apk\.getName\(\) \+ "\.part"/);
assert.match(activity, /postUpdate\("downloading"/);
assert.match(activity, /getPackageArchiveInfo/);

console.log('Release/build provjere: 11 prošlo, 0 palo');
