"""Izrez European Forest Disturbance Atlas (EFDA v3) na 5 općina USK.

Izlaz (static/data/):
  efda_opcine.tif   Byte COG, EPSG:3035, 30 m: v = uzrok*50 + (godina-1984), 0 = nema
                    (uzrok 0 = nepoznat, 1..3 prema EFDA metapodacima; godina 1985..2024)
  efda_opcine.json  obuhvat, kodovi, statistika po općini/uzroku/godini (ha)
  opcine5.geojson   pojednostavljene granice općina (WGS84) za obrub na karti
"""
import json
import math
import sys
import unicodedata
import urllib.request

import numpy as np
from osgeo import gdal, ogr, osr

gdal.UseExceptions()

CILJ = {
    'bosanska krupa': 'Bosanska Krupa',
    'bihac': 'Bihać',
    'cazin': 'Cazin',
    'bosanski petrovac': 'Bosanski Petrovac',
    'sanski most': 'Sanski Most',
}
PIKSEL_HA = 30 * 30 / 10000.0
GOD_OD, GOD_DO = 1985, 2024


def norm(s):
    return unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower().strip()


def ucitaj_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'grmec-navigator-efda'})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def granice():
    meta = ucitaj_json('https://www.geoboundaries.org/api/current/gbOpen/BIH/ADM3/')
    gj = ucitaj_json(meta['gjDownloadURL'])
    nadjene = {}
    svi = []
    for f in gj['features']:
        ime = f['properties'].get('shapeName', '')
        svi.append(ime)
        k = norm(ime)
        if k in CILJ:
            nadjene[CILJ[k]] = f['geometry']
    nedostaje = [v for v in CILJ.values() if v not in nadjene]
    if nedostaje:
        print('NEDOSTAJU:', nedostaje)
        print('SVA IMENA:', sorted(svi))
        sys.exit(1)
    return nadjene


def main(latest_tif, agent_tif, izlaz_dir):
    wgs = osr.SpatialReference(); wgs.ImportFromEPSG(4326)
    wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    laea = osr.SpatialReference(); laea.ImportFromEPSG(3035)
    laea.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    u_laea = osr.CoordinateTransformation(wgs, laea)

    opcine = granice()
    geom_laea = {}
    unija = None
    for ime, g in opcine.items():
        og = ogr.CreateGeometryFromJson(json.dumps(g))
        gl = og.Clone(); gl.Transform(u_laea)
        geom_laea[ime] = gl
        unija = gl.Clone() if unija is None else unija.Union(gl)
        print('OPĆINA', ime, round(gl.GetArea() / 1e6, 1), 'km²')

    lat = gdal.Open(latest_tif)
    ag = gdal.Open(agent_tif)
    gt = lat.GetGeoTransform()
    minx, maxx, miny, maxy = unija.GetEnvelope()
    x0 = max(0, int(math.floor((minx - gt[0]) / gt[1])))
    x1 = min(lat.RasterXSize, int(math.ceil((maxx - gt[0]) / gt[1])))
    y0 = max(0, int(math.floor((maxy - gt[3]) / gt[5])))
    y1 = min(lat.RasterYSize, int(math.ceil((miny - gt[3]) / gt[5])))
    w, h = x1 - x0, y1 - y0
    wgt = (gt[0] + x0 * gt[1], gt[1], 0, gt[3] + y0 * gt[5], 0, gt[5])
    print('PROZOR', x0, y0, w, h)

    god = lat.GetRasterBand(1).ReadAsArray(x0, y0, w, h).astype(np.int32)
    uzrok = np.zeros((h, w), np.uint8)
    for i in range(GOD_DO - GOD_OD + 1):
        sel = god == GOD_OD + i
        if not sel.any():
            continue
        b = ag.GetRasterBand(i + 1).ReadAsArray(x0, y0, w, h)
        uzrok[sel] = np.where(b[sel] <= 3, b[sel], 0)

    # Maska po općini (id 1..5) — za izrez i statistiku po općini.
    mem = gdal.GetDriverByName('MEM').Create('', w, h, 1, gdal.GDT_Byte)
    mem.SetGeoTransform(wgt); mem.SetProjection(laea.ExportToWkt())
    ds_v = ogr.GetDriverByName('Memory').CreateDataSource('v')
    sloj = ds_v.CreateLayer('o', laea, ogr.wkbMultiPolygon)
    sloj.CreateField(ogr.FieldDefn('id', ogr.OFTInteger))
    imena = list(geom_laea.keys())
    for idx, ime in enumerate(imena, 1):
        f = ogr.Feature(sloj.GetLayerDefn()); f.SetField('id', idx); f.SetGeometry(geom_laea[ime]); sloj.CreateFeature(f)
    gdal.RasterizeLayer(mem, [1], sloj, options=['ATTRIBUTE=id'])
    op = mem.GetRasterBand(1).ReadAsArray()

    ok = (god >= GOD_OD) & (god <= GOD_DO) & (op > 0)
    out = np.zeros((h, w), np.uint8)
    out[ok] = uzrok[ok].astype(np.int32) * 50 + (god[ok] - (GOD_OD - 1))

    tmp = gdal.GetDriverByName('MEM').Create('', w, h, 1, gdal.GDT_Byte)
    tmp.SetGeoTransform(wgt); tmp.SetProjection(laea.ExportToWkt())
    tmp.GetRasterBand(1).WriteArray(out); tmp.GetRasterBand(1).SetNoDataValue(0)
    gdal.Translate(izlaz_dir + '/efda_opcine.tif', tmp, format='COG',
                   creationOptions=['COMPRESS=DEFLATE', 'LEVEL=9', 'BLOCKSIZE=256', 'OVERVIEW_RESAMPLING=MODE'])

    stat = {}
    for idx, ime in enumerate(imena, 1):
        m = ok & (op == idx)
        po_uzroku = {str(u): round(float(((uzrok == u) & m).sum()) * PIKSEL_HA, 1) for u in range(4)}
        po_godini = {}
        for g in range(GOD_OD, GOD_DO + 1):
            mg = m & (god == g)
            if mg.any():
                po_godini[str(g)] = {str(u): round(float(((uzrok == u) & mg).sum()) * PIKSEL_HA, 1) for u in range(4) if ((uzrok == u) & mg).any()}
        stat[ime] = {'povrsina_km2': round(geom_laea[ime].GetArea() / 1e6, 1),
                     'ukupno_ha': round(float(m.sum()) * PIKSEL_HA, 1), 'po_uzroku_ha': po_uzroku, 'po_godini_ha': po_godini}
        print('STAT', ime, stat[ime]['ukupno_ha'], 'ha', po_uzroku)

    u_wgs = osr.CoordinateTransformation(laea, wgs)
    env = unija.Clone(); env.Transform(u_wgs)
    lo0, lo1, la0, la1 = env.GetEnvelope()
    meta = {
        'izvor': 'European Forest Disturbance Atlas v3.0 (Viana-Soto & Senf), doi:10.5281/zenodo.13333034',
        'godine': [GOD_OD, GOD_DO], 'rezolucija_m': 30, 'epsg': 3035,
        'kodiranje': 'v = uzrok*50 + (godina-1984); 0 = nema poremećaja',
        'uzroci': {'0': 'nepoznat', '1': 'EFDA kod 1', '2': 'EFDA kod 2', '3': 'EFDA kod 3'},
        'obuhvat_wgs84': [la0, lo0, la1, lo1], 'opcine': stat,
    }
    json.dump(meta, open(izlaz_dir + '/efda_opcine.json', 'w'), ensure_ascii=False, indent=1)

    feats = []
    for ime, g in opcine.items():
        og = ogr.CreateGeometryFromJson(json.dumps(g)).SimplifyPreserveTopology(0.0004)
        feats.append({'type': 'Feature', 'properties': {'ime': ime}, 'geometry': json.loads(og.ExportToJson(['COORDINATE_PRECISION=5']))})
    json.dump({'type': 'FeatureCollection', 'features': feats}, open(izlaz_dir + '/opcine5.geojson', 'w'), ensure_ascii=False)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3])
