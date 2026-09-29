"""Pedološka karta za Unsko-sanski kanton (granica iz static/data/usk_granica.geojson).

Izvor: ISRIC SoilGrids 2.0 (Poggio i sar. 2021), WRB "MostProbable" 250 m —
referentne grupe tala po World Reference Base, klasifikaciji koju je FAO
razvio iz legende FAO-UNESCO karte tala svijeta. Licenca CC BY 4.0.

Izlaz (static/data/):
  tlo_usk.tif   Byte COG, EPSG:4326, ~250 m: kod klase (0 = nema/van USK)
  tlo_usk.json  legenda samo za klase prisutne u USK: naziv, boja, ha, udio
"""
import json
import sys
import urllib.request

import numpy as np
from osgeo import gdal

gdal.UseExceptions()
gdal.SetConfigOption('GDAL_HTTP_MAX_RETRY', '5')
gdal.SetConfigOption('GDAL_HTTP_RETRY_DELAY', '3')
IZVOR = '/vsicurl/https://files.isric.org/soilgrids/latest/data/wrb/MostProbable.vrt'
LEGENDE = [
    'https://files.isric.org/soilgrids/latest/data/wrb/MostProbable.qml',
    'https://files.isric.org/soilgrids/latest/data/wrb/MostProbable.sld',
]
# WRB 2006 referentne grupe — bosanski nazivi (FAO/WRB terminologija u regiji).
BS = {
    'Acrisols': 'Akrisoli', 'Albeluvisols': 'Albeluvisoli', 'Alisols': 'Alisoli', 'Andosols': 'Andosoli',
    'Arenosols': 'Arenosoli', 'Calcisols': 'Kalcisoli', 'Cambisols': 'Kambisoli (smeđa tla)',
    'Chernozems': 'Černozemi', 'Cryosols': 'Kriosoli', 'Durisols': 'Durisoli', 'Ferralsols': 'Feralsoli',
    'Fluvisols': 'Fluvisoli (aluvijalna tla)', 'Gleysols': 'Glejsoli (glejna tla)', 'Gypsisols': 'Gipsisoli',
    'Histosols': 'Histosoli (tresetna tla)', 'Kastanozems': 'Kastanozemi', 'Leptosols': 'Leptosoli (plitka tla)',
    'Lixisols': 'Liksisoli', 'Luvisols': 'Luvisoli (lesivirana tla)', 'Nitisols': 'Nitisoli',
    'Phaeozems': 'Feozemi', 'Planosols': 'Planosoli (pseudoglej)', 'Plinthosols': 'Plintosoli',
    'Podzols': 'Podzoli', 'Regosols': 'Regosoli', 'Solonchaks': 'Solončaci', 'Solonetz': 'Soloneci',
    'Stagnosols': 'Stagnosoli (pseudoglej)', 'Umbrisols': 'Umbrisoli', 'Vertisols': 'Vertisoli',
    'Technosols': 'Tehnosoli', 'Anthrosols': 'Antrosoli', 'Retisols': 'Retisoli',
}


def legenda_iz_trake(b):
    imena = b.GetCategoryNames() or []
    ct = b.GetColorTable()
    out = {}
    n = max(len(imena), ct.GetCount() if ct else 0)
    for i in range(n):
        naziv = imena[i] if i < len(imena) else ''
        boja = ct.GetColorEntry(i) if ct and i < ct.GetCount() else None
        if naziv or boja:
            out[i] = {'wrb': naziv, 'boja': '#%02x%02x%02x' % boja[:3] if boja else None}
    return out


def legenda_iz_qml():
    import re
    for u in LEGENDE:
        try:
            t = urllib.request.urlopen(u, timeout=60).read().decode('utf-8', 'replace')
        except Exception as e:  # noqa: BLE001
            print('LEGENDA', u, 'greška', e)
            continue
        print('LEGENDA', u, len(t), 'znakova; početak:', t[:400].replace('\n', ' '))
        out = {}
        for m in re.finditer(r'<(?:paletteEntry|item)[^>]*?(?:value|quantity)="(\d+)"[^>]*?/?>', t):
            s = m.group(0)
            v = int(m.group(1))
            lab = re.search(r'label="([^"]*)"', s)
            col = re.search(r'color="(#[0-9a-fA-F]{6})', s)
            out[v] = {'wrb': lab.group(1) if lab else '', 'boja': col.group(1).lower() if col else None}
        if out:
            return out
    return {}


def main(granica, izlaz_tif, izlaz_json):
    info = gdal.Info(IZVOR, format='json')
    b0 = info['bands'][0]
    print('IZVOR', info['size'], info['coordinateSystem']['wkt'][:120], 'tip', b0.get('type'), 'nodata', b0.get('noDataValue'))
    ds = gdal.Open(IZVOR)
    leg = legenda_iz_trake(ds.GetRasterBand(1))
    print('LEGENDA iz trake:', len(leg), list(leg.items())[:6])
    if sum(1 for v in leg.values() if v['wrb']) < 5:
        dodatno = legenda_iz_qml()
        print('LEGENDA iz QML/SLD:', len(dodatno), list(dodatno.items())[:6])
        for k, v in dodatno.items():
            leg.setdefault(k, {}).update({x: y for x, y in v.items() if y})

    # 1/400° ≈ 280 m (lat) × 200 m (lon) — blizu izvornih 250 m, bez gubitka klasa.
    rez = gdal.Warp('/vsimem/tlo.tif', IZVOR, dstSRS='EPSG:4326', cutlineDSName=granica, cropToCutline=True,
                    xRes=1 / 400, yRes=1 / 400, resampleAlg='near', dstNodata=255, outputType=gdal.GDT_Byte,
                    multithread=True, warpOptions=['NUM_THREADS=ALL_CPUS'])
    a = rez.GetRasterBand(1).ReadAsArray()
    ok = a != 255
    kodovi, broj = np.unique(a[ok], return_counts=True)
    gt = rez.GetGeoTransform()
    lat_c = gt[3] + gt[5] * a.shape[0] / 2
    piksel_ha = abs(gt[1] * 111320 * np.cos(np.radians(lat_c)) * gt[5] * 111132) / 10000
    ukupno = broj.sum()
    print('VELIČINA', a.shape, 'klasa u USK:', len(kodovi), 'piksel ha', round(piksel_ha, 2))
    out = np.where(ok, a + 1, 0).astype(np.uint8)  # 0 = nema; kod = vrijednost + 1
    mem = gdal.GetDriverByName('MEM').Create('', rez.RasterXSize, rez.RasterYSize, 1, gdal.GDT_Byte)
    mem.SetGeoTransform(gt); mem.SetProjection(rez.GetProjection())
    mem.GetRasterBand(1).WriteArray(out); mem.GetRasterBand(1).SetNoDataValue(0)
    gdal.Translate(izlaz_tif, mem, format='COG', creationOptions=['COMPRESS=DEFLATE', 'LEVEL=9', 'BLOCKSIZE=256', 'OVERVIEWS=NONE'])

    klase = []
    for k, n in sorted(zip(kodovi.tolist(), broj.tolist()), key=lambda x: -x[1]):
        l = leg.get(k, {})
        wrb = l.get('wrb') or ('klasa ' + str(k))
        grupa = next((g for g in BS if g.lower() in wrb.lower()), None)
        klase.append({'kod': k + 1, 'wrb': wrb, 'naziv': BS.get(grupa, wrb) if grupa else wrb,
                      'boja': l.get('boja') or '#999999', 'ha': round(n * piksel_ha), 'udio': round(n / ukupno, 4)})
        print('KLASA', k, wrb, l.get('boja'), n, round(100 * n / ukupno, 1), '%')
    json.dump({'izvor': 'ISRIC SoilGrids 2.0 — WRB MostProbable, 250 m (CC BY 4.0)', 'klasifikacija': 'WRB 2006 (FAO; nasljednik FAO-UNESCO legende)',
               'klase': klase}, open(izlaz_json, 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main(*sys.argv[1:4])
