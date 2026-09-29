"""Zimski (bez lišća) Sentinel-2 mozaik za Unsko-sanski kanton → XYZ pločice.

Zimi listopadna šuma nema lišća: četinarske kulture (tamnozelene) se jasno
odvajaju od bukve/hrasta (sivo-smeđe), a vidljivi su putevi, vlake i sječine
ispod krošnji. Izvor: ESA Copernicus Sentinel-2 L2A (Microsoft Planetary
Computer STAC, bez ključa). Dec–mart, 6 zima; po pikselu se odbacuju oblaci,
sjene oblaka i snijeg (SCL), pa se uzima medijan.

Izlaz:
  static/data/zima/{z}/{x}/{y}.webp  — pločice z8–z14 (samo unutar USK)
  static/data/zima.json              — obuhvat, zoom, broj scena, datumi
Env PROBA=1: samo jedan blok, bez pločica (provjera izvora).
"""
import datetime as dt
import json
import os
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from osgeo import gdal, ogr, osr

gdal.UseExceptions()
for k, v in {'GDAL_DISABLE_READDIR_ON_OPEN': 'EMPTY_DIR', 'CPL_VSIL_CURL_ALLOWED_EXTENSIONS': '.tif',
             'GDAL_HTTP_MULTIRANGE': 'YES', 'GDAL_HTTP_MERGE_CONSECUTIVE_RANGES': 'YES',
             'GDAL_HTTP_MAX_RETRY': '6', 'GDAL_HTTP_RETRY_DELAY': '4', 'GDAL_CACHEMAX': '512',
             'VSI_CACHE': 'TRUE'}.items():
    gdal.SetConfigOption(k, v)

STAC = 'https://planetarycomputer.microsoft.com/api/stac/v1/search'
SAS = 'https://planetarycomputer.microsoft.com/api/sas/v1/token/sentinel-2-l2a'
PROBA = os.environ.get('PROBA') == '1'
RES = 10.0
BLOK = 2048
PO_PLOCICI = int(os.environ.get('PO_PLOCICI', '12'))
MJESECI = {12, 1, 2, 3}
DOBRI_SCL = {2, 4, 5, 6, 7}   # tamna područja, vegetacija, tlo, voda, neklasif.
SNIJEG_SCL = 11


def post(url, body):
    req = urllib.request.Request(url, json.dumps(body).encode(), {'Content-Type': 'application/json'})
    for i in range(6):
        try:
            return json.load(urllib.request.urlopen(req, timeout=120))
        except Exception as e:  # noqa: BLE001
            print('STAC ponovo', i, e); time.sleep(5 * (i + 1))
    raise RuntimeError('STAC nedostupan')


def scene(bbox):
    body = {'collections': ['sentinel-2-l2a'], 'bbox': bbox, 'limit': 500,
            'datetime': '2019-12-01T00:00:00Z/2025-03-31T23:59:59Z',
            'query': {'eo:cloud_cover': {'lt': 25}}}
    out, r = [], post(STAC, body)
    while True:
        out += r['features']
        nxt = next((l for l in r.get('links', []) if l.get('rel') == 'next'), None)
        if not nxt:
            break
        r = post(nxt['href'], nxt.get('body', body))
    zima = [f for f in out if dt.datetime.fromisoformat(f['properties']['datetime'][:19]).month in MJESECI]
    po = {}
    for f in zima:
        p = f['properties']
        po.setdefault(p.get('s2:mgrs_tile'), []).append(f)
    izbor = []
    for t, fs in sorted(po.items()):
        fs.sort(key=lambda f: f['properties'].get('eo:cloud_cover', 99) + f['properties'].get('s2:snow_ice_percentage', 99))
        izbor += fs[:PO_PLOCICI]
        print('MGRS', t, 'zimskih', len(fs), 'izabrano', min(len(fs), PO_PLOCICI),
              [(f['properties']['datetime'][:10], round(f['properties'].get('eo:cloud_cover', -1), 1),
                round(f['properties'].get('s2:snow_ice_percentage', -1), 1)) for f in fs[:PO_PLOCICI]])
    print('SCENA ukupno', len(out), 'zimskih', len(zima), 'izabrano', len(izbor))
    return izbor


def ofset(f):
    pb = f['properties'].get('s2:processing_baseline') or '0'
    try:
        return 1000 if float(pb) >= 4.0 else 0
    except ValueError:
        return 0


def citaj(href, granice, sirina, visina, srs, alg):
    try:
        d = gdal.Warp('', '/vsicurl/' + href, format='MEM', outputBounds=granice, width=sirina, height=visina,
                      dstSRS=srs, resampleAlg=alg, dstNodata=0)
        return d.GetRasterBand(1).ReadAsArray()
    except Exception as e:  # noqa: BLE001
        print('  čitanje neuspjelo', href.split('?')[0][-60:], e)
        return None


def main(granica, izlaz_dir, izlaz_json):
    g = ogr.Open(granica); lyr = g.GetLayer(0); feat = lyr.GetNextFeature(); geom = feat.GetGeometryRef().Clone()
    wgs = osr.SpatialReference(); wgs.ImportFromEPSG(4326); wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    utm = osr.SpatialReference(); utm.ImportFromEPSG(32633); utm.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    minx, maxx, miny, maxy = geom.GetEnvelope()
    bbox = [minx, miny, maxx, maxy]
    gu = geom.Clone(); gu.Transform(osr.CoordinateTransformation(wgs, utm))
    ux0, ux1, uy0, uy1 = gu.GetEnvelope()
    ux0, uy0 = np.floor(ux0 / RES) * RES - 200, np.floor(uy0 / RES) * RES - 200
    ux1, uy1 = np.ceil(ux1 / RES) * RES + 200, np.ceil(uy1 / RES) * RES + 200
    W, H = int((ux1 - ux0) / RES), int((uy1 - uy0) / RES)
    print('MREŽA UTM33 10 m', W, 'x', H)

    token = json.load(urllib.request.urlopen(SAS, timeout=60))['token']
    izbor = scene(bbox)
    srs = 'EPSG:32633'
    out = gdal.GetDriverByName('GTiff').Create('/tmp/zima16.tif', W, H, 3, gdal.GDT_UInt16,
                                               ['TILED=YES', 'COMPRESS=ZSTD', 'BIGTIFF=YES'])
    out.SetGeoTransform((ux0, RES, 0, uy1, 0, -RES)); out.SetProjection(utm.ExportToWkt())
    for b in range(3):
        out.GetRasterBand(b + 1).SetNoDataValue(0)
    blokovi = [(bx, by) for by in range(0, H, BLOK) for bx in range(0, W, BLOK)]
    datumi = set()
    t0 = time.time()
    for n, (bx, by) in enumerate(blokovi):
        bw, bh = min(BLOK, W - bx), min(BLOK, H - by)
        gr = (ux0 + bx * RES, uy1 - (by + bh) * RES, ux0 + (bx + bw) * RES, uy1 - by * RES)
        ring = ogr.Geometry(ogr.wkbLinearRing)
        for x, y in [(gr[0], gr[1]), (gr[2], gr[1]), (gr[2], gr[3]), (gr[0], gr[3]), (gr[0], gr[1])]:
            ring.AddPoint_2D(x, y)
        poly = ogr.Geometry(ogr.wkbPolygon); poly.AddGeometry(ring)
        if not poly.Intersects(gu):
            continue
        pw = poly.Clone(); pw.Transform(osr.CoordinateTransformation(utm, wgs))
        e = pw.GetEnvelope()
        stavke = [f for f in izbor if f['bbox'][0] < e[1] and f['bbox'][2] > e[0] and f['bbox'][1] < e[3] and f['bbox'][3] > e[2]]

        def jedna(f):
            a = f['assets']
            scl = citaj(a['SCL']['href'] + '?' + token, gr, bw, bh, srs, 'near')
            if scl is None or not np.isin(scl, list(DOBRI_SCL) + [SNIJEG_SCL]).any():
                return None
            kan = []
            for k in ('B04', 'B03', 'B02'):
                x = citaj(a[k]['href'] + '?' + token, gr, bw, bh, srs, 'bilinear')
                if x is None:
                    return None
                kan.append(np.clip(x.astype(np.int32) - ofset(f), 0, 20000).astype(np.uint16))
            return f['properties']['datetime'][:10], scl, np.stack(kan)

        with ThreadPoolExecutor(6) as ex:
            rez = [r for r in ex.map(jedna, stavke) if r is not None]
        if not rez:
            print('BLOK', n, 'bez scena'); continue
        scl = np.stack([r[1] for r in rez]); rgb = np.stack([r[2] for r in rez]).astype(np.float32)
        dobar = np.isin(scl, list(DOBRI_SCL)) & (rgb[:, 0] > 0)
        snijeg = (scl == SNIJEG_SCL) & (rgb[:, 0] > 0)
        rgb_d = np.where(dobar[:, None], rgb, np.nan)
        with np.errstate(all='ignore'):
            med = np.nanmedian(rgb_d, axis=0)
            rup = np.isnan(med[0])
            if rup.any():  # nigdje bez snijega → snijeg, bolje nego rupa
                med_s = np.nanmedian(np.where(snijeg[:, None], rgb, np.nan), axis=0)
                med = np.where(rup[None], med_s, med)
        med = np.nan_to_num(med, nan=0).astype(np.uint16)
        for b in range(3):
            out.GetRasterBand(b + 1).WriteArray(med[b], bx, by)
        datumi.update(r[0] for r in rez)
        pokr = float((med[0] > 0).mean())
        print('BLOK', n + 1, '/', len(blokovi), 'scena', len(rez), 'bez oblaka/snijega %.0f%%' % (100 * dobar.any(0).mean()),
              'pokriveno %.0f%%' % (100 * pokr), '%.0fs' % (time.time() - t0), flush=True)
        if PROBA:
            break
    out.FlushCache(); out = None
    if PROBA:
        print('PROBA gotova'); return

    # Rastezanje: zimska refleksija je niska (0–0,15) → 2–98 percentil, blaga gama.
    d = gdal.Open('/tmp/zima16.tif')
    uz = gdal.Translate('', d, format='MEM', width=W // 20, height=H // 20)
    s = np.stack([uz.GetRasterBand(b + 1).ReadAsArray() for b in range(3)]).astype(np.float32)
    v = s[:, s[0] > 0]
    lo, hi = float(np.percentile(v, 2)), float(np.percentile(v, 98.5))
    print('RASTEZANJE', lo, hi)
    gdal.Translate('/tmp/zima8.vrt', d, format='VRT', outputType=gdal.GDT_Byte,
                   scaleParams=[[lo, hi, 1, 255]] * 3, exponents=[0.8] * 3, noData=0)
    gdal.Warp('/tmp/zima_cut.tif', '/tmp/zima8.vrt', cutlineDSName=granica, dstAlpha=True, dstSRS='EPSG:3857',
              xRes=9.55, yRes=9.55, resampleAlg='bilinear', creationOptions=['TILED=YES', 'COMPRESS=DEFLATE'],
              multithread=True, warpOptions=['NUM_THREADS=ALL_CPUS'])
    subprocess.run(['gdal2tiles.py', '--xyz', '-z', '8-14', '-r', 'bilinear', '-w', 'none', '--processes=4',
                    '--tiledriver=WEBP', '--webp-quality=78', '/tmp/zima_cut.tif', izlaz_dir], check=True)
    broj, vel = 0, 0
    for kor, _, fs in os.walk(izlaz_dir):
        for f in fs:
            if f.endswith('.webp'):
                broj += 1; vel += os.path.getsize(os.path.join(kor, f))
    dat = sorted(datumi)
    json.dump({'izvor': 'Copernicus Sentinel-2 L2A (ESA), Microsoft Planetary Computer', 'rezolucija_m': 10,
               'zoom': [8, 14], 'obuhvat': bbox, 'scena': len(dat), 'od': dat[0] if dat else None, 'do': dat[-1] if dat else None,
               'mjeseci': 'decembar–mart', 'pločica': broj, 'mb': round(vel / 1e6, 1)},
              open(izlaz_json, 'w'), ensure_ascii=False, indent=1)
    print('PLOČICE', broj, 'MB', round(vel / 1e6, 1))


if __name__ == '__main__':
    main(*sys.argv[1:4])
