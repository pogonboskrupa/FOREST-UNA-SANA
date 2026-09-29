"""Granice općina/gradova USK iz OpenStreetMap-a (Overpass) + poređenje sa geoBoundaries.

Izlaz (static/data/):
  opcine_usk_osm.geojson   8 jedinica, pojednostavljeno ~10 m, svojstva ime/tip
  usk_granica_osm.geojson  obris kantona (unija)
Log: površina svake jedinice (OSM vs geoBoundaries), IoU i najveće odstupanje
granice u metrima (Hausdorff), da se vidi koliko je geoBoundaries netačan.
"""
import json
import math
import subprocess
import sys
import time
import urllib.parse
import urllib.request

from osgeo import ogr

OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter',
            'https://maps.mail.ru/osm/tools/overpass/api/interpreter']
USK = ['Bihać', 'Bosanska Krupa', 'Bosanski Petrovac', 'Bužim', 'Cazin', 'Ključ', 'Sanski Most', 'Velika Kladuša']
GRAD = {'Bihać', 'Cazin'}
UPIT = """[out:xml][timeout:300];
rel["boundary"="administrative"]["admin_level"~"^(6)$"]["name"~"Unsko"];
map_to_area->.k;
rel(area.k)["boundary"="administrative"]["admin_level"~"^(7|8)$"];
(._;>;);
out body;"""


def preuzmi():
    for u in OVERPASS:
        for i in range(3):
            try:
                print('OVERPASS', u, flush=True)
                d = urllib.request.urlopen(u, urllib.parse.urlencode({'data': UPIT}).encode(), timeout=400).read()
                if len(d) > 10000:
                    open('/tmp/usk.osm', 'wb').write(d)
                    print('OSM bajtova', len(d))
                    return
                print('premalo podataka', d[:300])
            except Exception as e:  # noqa: BLE001
                print('greška', e); time.sleep(10 * (i + 1))
    raise RuntimeError('Overpass nedostupan')


def norm(s):
    return (s or '').replace('Grad ', '').replace('Općina ', '').replace('Opština ', '').strip()


def main(gb_path, izlaz, izlaz_obris):
    preuzmi()
    subprocess.run(['ogr2ogr', '-f', 'GeoJSON', '/tmp/osm_mp.geojson', '/tmp/usk.osm', 'multipolygons',
                    '-oo', 'CONFIG_FILE=/usr/share/gdal/osmconf.ini'], check=True)
    osm = json.load(open('/tmp/osm_mp.geojson'))
    print('OSM poligona', len(osm['features']))
    for f in osm['features']:
        p = f['properties']
        print('  OSM', p.get('name'), '| admin', p.get('admin_level'), '| boundary', p.get('boundary'), '| other', (p.get('other_tags') or '')[:160])
    gb = {f['properties']['ime']: ogr.CreateGeometryFromJson(json.dumps(f['geometry'])) for f in json.load(open(gb_path))['features']}
    izbor = {}
    for f in osm['features']:
        p = f['properties']
        ime = norm(p.get('name'))
        kand = next((u for u in USK if u == ime or u.lower() == ime.lower()), None)
        if not kand or p.get('boundary') != 'administrative':
            continue
        g = ogr.CreateGeometryFromJson(json.dumps(f['geometry']))
        # admin_level 7 ima prednost (općina/grad); 8 samo ako 7 nema
        if kand not in izbor or (p.get('admin_level') == '7' and izbor[kand][1] != '7'):
            izbor[kand] = (g, p.get('admin_level'))
    nema = [u for u in USK if u not in izbor]
    print('NEDOSTAJE u OSM:', nema)
    km2 = lambda g: g.GetArea() * (111.32 * math.cos(math.radians(44.75))) * 111.13
    feats = []
    for ime in USK:
        if ime not in izbor:
            continue
        g = izbor[ime][0].Buffer(0)
        s = g.SimplifyPreserveTopology(0.0001)
        b = gb.get(ime)
        if b:
            b = b.Buffer(0)
            iou = g.Intersection(b).GetArea() / g.Union(b).GetArea()
            # Hausdorff približno: najveća udaljenost tjemena jedne granice od druge
            def maxd(a, c):
                bd = c.Boundary(); m = 0
                ring = a.Boundary()
                for gi in range(max(1, ring.GetGeometryCount())):
                    r = ring.GetGeometryRef(gi) if ring.GetGeometryCount() else ring
                    for k in range(0, r.GetPointCount(), 3):
                        pt = ogr.Geometry(ogr.wkbPoint); pt.AddPoint_2D(*r.GetPoint_2D(k))
                        m = max(m, pt.Distance(bd))
                return m * 111000
            print('USPOREDBA %-18s OSM %7.1f km²  geoBoundaries %7.1f km²  IoU %.3f  najveće odstupanje ~%5.0f m' % (
                ime, km2(g), km2(b), iou, max(maxd(g, b), maxd(b, g))))
        feats.append({'type': 'Feature', 'properties': {'ime': ime, 'tip': 'grad' if ime in GRAD else 'općina', 'izvor': 'OSM'},
                      'geometry': json.loads(s.ExportToJson())})
    ukupno = sum(km2(izbor[u][0]) for u in izbor)
    print('UKUPNO OSM %.1f km² (službeno ~4125 km²)' % ukupno)
    if nema:
        print('Nisu sve jedinice u OSM-u — izlaz se NE piše'); sys.exit(1)

    def zaokruzi(o):
        if isinstance(o, float):
            return round(o, 5)
        if isinstance(o, list):
            return [zaokruzi(x) for x in o]
        return o
    for f in feats:
        f['geometry']['coordinates'] = zaokruzi(f['geometry']['coordinates'])
    json.dump({'type': 'FeatureCollection', 'izvor': '© OpenStreetMap saradnici (ODbL), admin_level 7, pojednostavljeno ~10 m', 'features': feats},
              open(izlaz, 'w'), ensure_ascii=False, separators=(',', ':'))
    u = None
    for ime in USK:
        u = izbor[ime][0].Buffer(0) if u is None else u.Union(izbor[ime][0].Buffer(0))
    obris = u.SimplifyPreserveTopology(0.0001)
    json.dump({'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {'ime': 'USK'}, 'geometry': json.loads(obris.ExportToJson())}]},
              open(izlaz_obris, 'w'), separators=(',', ':'))


if __name__ == '__main__':
    main(*sys.argv[1:4])
