"""Paketi zimskog snimka za preuzimanje u aplikaciji (po području i nivou zooma).

Ulaz: static/data/zima/{z}/{x}/{y}.webp (tools/zima_priprema.py), granice
static/data/opcine_usk.geojson. Izlaz: paketi/zima/{id}_z{12,13,14}.zip (ZIP bez
kompresije — WebP se ne sabija) i static/data/zima_paketi.json (manifest koji
aplikacija nosi). Paket sadrži samo pločice koje sijeku područje (bez praznih).
Aplikacija ih preuzima sa raw.githubusercontent.com (CORS *) ove grane.
"""
import json
import math
import os
import sys
import zipfile

from osgeo import ogr

SLUG = {'Bihać': 'bihac', 'Bosanska Krupa': 'bosanska-krupa', 'Bosanski Petrovac': 'bosanski-petrovac', 'Bužim': 'buzim',
        'Cazin': 'cazin', 'Ključ': 'kljuc', 'Sanski Most': 'sanski-most', 'Velika Kladuša': 'velika-kladusa'}
BAZA = 'https://raw.githubusercontent.com/pogonboskrupa/FOREST-UNA-SANA/claude/practical-pasteur-p2npth/paketi/zima/'


def plocica(z, x, y):
    n = 2 ** z
    la = lambda yy: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * yy / n))))
    w, e, s, nn = x / n * 360 - 180, (x + 1) / n * 360 - 180, la(y + 1), la(y)
    return ogr.CreateGeometryFromWkt(f'POLYGON(({w} {s},{e} {s},{e} {nn},{w} {nn},{w} {s}))')


def main(tiles, granice, izlaz, manifest):
    os.makedirs(izlaz, exist_ok=True)
    g = json.load(open(granice))
    geo = [(SLUG[f['properties']['ime']], f['properties']['ime'], f['properties'].get('tip', 'općina'),
            ogr.CreateGeometryFromJson(json.dumps(f['geometry'])).Buffer(0)) for f in g['features']]
    usk = geo[0][3]
    for _, _, _, x in geo[1:]:
        usk = usk.Union(x)
    pod = [('usk', 'Cijeli kanton', 'kanton', usk)] + geo
    man = {'verzija': 1, 'izvor': 'Copernicus Sentinel-2 L2A (ESA) — zimski mozaik, 10 m', 'baza': BAZA, 'ugradjeno': [8, 11], 'podrucja': []}
    for pid, naziv, tip, gm in pod:
        e = gm.GetEnvelope()
        z_ = {'id': pid, 'naziv': naziv, 'tip': tip, 'obuhvat': [round(e[0], 5), round(e[2], 5), round(e[1], 5), round(e[3], 5)], 'pojasevi': {}}
        for z in (12, 13, 14):
            fs = sorted(f'{z}/{x}/{f}' for x in os.listdir(f'{tiles}/{z}') for f in os.listdir(f'{tiles}/{z}/{x}')
                        if f.endswith('.webp') and plocica(z, int(x), int(f.split('.')[0])).Intersects(gm))
            zp = f'{izlaz}/{pid}_z{z}.zip'
            with zipfile.ZipFile(zp, 'w', zipfile.ZIP_STORED) as zf:
                for f in fs:
                    zf.write(f'{tiles}/{f}', f)
            z_['pojasevi'][str(z)] = {'fajl': f'{pid}_z{z}.zip', 'plocica': len(fs), 'bajtova': os.path.getsize(zp)}
        man['podrucja'].append(z_)
        print(pid, {k: (v['plocica'], round(v['bajtova'] / 1e6, 2)) for k, v in z_['pojasevi'].items()}, flush=True)
    json.dump(man, open(manifest, 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main(*sys.argv[1:5])
