"""Pedološka karta za Unsko-sanski kanton (granica static/data/usk_granica.geojson).

Izvor: HWSD v2.0 — Harmonized World Soil Database (FAO & IIASA, 2023), 30"
(~1 km). Za Evropu se zasniva na Evropskoj bazi tala 1:1 000 000 (nacionalne
karte tala, za BiH jugoslavenske), sa FAO-90 klasifikacijom (nasljednik
FAO-UNESCO legende karte tala svijeta) i WRB. Svaka kartografska jedinica
(SMU) ima više komponenti tla sa udjelom i svojstvima po slojevima.

Izlaz (static/data/):
  tlo_usk.tif   UInt16 COG, EPSG:4326, 30": indeks jedinice (0 = van USK)
  tlo_usk.json  jedinice: dominantno tlo (FAO-90, WRB), komponente, svojstva
                gornjeg sloja dominantne komponente, površina u USK, boja
"""
import csv
import io
import json
import os
import re
import subprocess
import sys
import urllib.request
import zipfile

import numpy as np
from osgeo import gdal

gdal.UseExceptions()
BAZA = 'https://s3.eu-west-1.amazonaws.com/data.gaezdev.aws.fao.org/HWSD/'
RASTER_ZIP, DB_ZIP = 'HWSD2_RASTER.zip', 'HWSD2_DB.zip'
QML = 'https://files.isric.org/soilgrids/latest/data/wrb/MostProbable.qml'
BS = {
    'Acrisols': 'Akrisoli', 'Albeluvisols': 'Albeluvisoli', 'Alisols': 'Alisoli', 'Andosols': 'Andosoli',
    'Arenosols': 'Arenosoli', 'Calcisols': 'Kalcisoli', 'Cambisols': 'Kambisoli (smeđa tla)',
    'Chernozems': 'Černozemi', 'Fluvisols': 'Fluvisoli (aluvijalna tla)', 'Gleysols': 'Glejsoli (glejna tla)',
    'Histosols': 'Histosoli (tresetna tla)', 'Kastanozems': 'Kastanozemi', 'Leptosols': 'Leptosoli (plitka, kamenita tla)',
    'Luvisols': 'Luvisoli (lesivirana tla)', 'Phaeozems': 'Feozemi', 'Planosols': 'Planosoli (pseudoglej)',
    'Podzols': 'Podzoli', 'Regosols': 'Regosoli (nerazvijena tla)', 'Stagnosols': 'Stagnosoli (pseudoglej)',
    'Umbrisols': 'Umbrisoli (humusna kisela tla)', 'Vertisols': 'Vertisoli', 'Technosols': 'Tehnosoli',
    'Anthrosols': 'Antrosoli', 'Retisols': 'Retisoli', 'Podzoluvisols': 'Podzoluvisoli', 'Rendzinas': 'Rendzine',
    'Lithosols': 'Litosoli (kamenjar)', 'Rankers': 'Rankeri', 'Solonchaks': 'Solončaci', 'Solonetz': 'Soloneci',
    'Nitisols': 'Nitisoli', 'Plinthosols': 'Plintosoli', 'Ferralsols': 'Feralsoli', 'Gypsisols': 'Gipsisoli',
    'Durisols': 'Durisoli', 'Cryosols': 'Kriosoli', 'Lixisols': 'Liksisoli',
}
# Domaći nazivi (približni ekvivalenti u pedologiji BiH) za FAO-90 jedinice.
DOMACE = {
    'Chromic Cambisols': 'Kalkokambisol (smeđe tlo na krečnjaku)', 'Dystric Cambisols': 'Distrični kambisol (kiselo smeđe tlo)',
    'Eutric Cambisols': 'Eutrični kambisol (eutrično smeđe tlo)', 'Chromic Luvisols': 'Luvisol (lesivirano tlo)',
    'Haplic Luvisols': 'Luvisol (lesivirano tlo)', 'Vertic Luvisols': 'Vertični luvisol', 'Calcaric Fluvisols': 'Fluvisol (karbonatno aluvijalno tlo)',
    'Dystric Fluvisols': 'Distrični fluvisol (aluvij)', 'Eutric Fluvisols': 'Eutrični fluvisol (aluvij)',
    'Rendzic Leptosols': 'Rendzina / kalkomelanosol (plitko tlo na krečnjaku)', 'Lithic Leptosols': 'Litosol (kamenjar)',
    'Umbric Leptosols': 'Ranker (umbrični leptosol)', 'Eutric Vertisols': 'Vertisol (smonica)', 'Calcic Gleysols': 'Glej (karbonatni)',
    'Haplic Acrisols': 'Akrisol', 'Dystric Podzoluvisols': 'Podzoluvisol', 'Calcaric Regosols': 'Karbonatni regosol',
    'Urban, mining, etc.': 'Naselja, kopovi i sl.',
}
TEKSTURA = {'Clay loam': 'glinasta ilovača', 'Loam': 'ilovača', 'Clay (light)': 'laka glina', 'Clay (heavy)': 'teška glina',
            'Silty clay': 'praškasta glina', 'Sandy loam': 'pjeskovita ilovača', 'Silt loam': 'praškasta ilovača',
            'Sandy clay loam': 'pjeskovito-glinasta ilovača', 'Silty clay loam': 'praškasto-glinasta ilovača',
            'Sandy clay': 'pjeskovita glina', 'Loamy sand': 'ilovasti pijesak', 'Sand': 'pijesak', 'Silt': 'prah'}
DRENAZA = {'Excessively drained': 'pretjerano dreniran', 'Somewhat excessively drained': 'jako dreniran', 'Well drained': 'dobro dreniran',
           'Moderately well drained': 'umjereno dobro dreniran', 'Imperfectly drained': 'nepotpuno dreniran',
           'Poorly drained': 'slabo dreniran (vlažno)', 'Very poorly drained': 'vrlo slabo dreniran (mokro)'}
DUBINA = {'Deep': 'duboko (> 100 cm)', 'Moderately Deep': 'srednje duboko (< 100 cm)', 'Shallow': 'plitko (< 50 cm)', 'Very shallow': 'vrlo plitko (< 30 cm)'}
BOJE_FAO = {'Chromic Cambisols': '#c2410c', 'Dystric Cambisols': '#eab308', 'Eutric Cambisols': '#f59e0b', 'Chromic Luvisols': '#9333ea',
            'Haplic Luvisols': '#c084fc', 'Calcaric Fluvisols': '#0ea5e9', 'Rendzic Leptosols': '#65a30d', 'Lithic Leptosols': '#a8a29e',
            'Eutric Vertisols': '#475569', 'Urban, mining, etc.': '#6b7280'}


def svijetlija(hexc, f=0.45):
    r, g, b = (int(hexc[i:i + 2], 16) for i in (1, 3, 5))
    return '#%02x%02x%02x' % tuple(round(c + (255 - c) * f) for c in (r, g, b))


def cisto(tekst, rjecnik):
    t = ' '.join(str(tekst).split())
    for k, v in rjecnik.items():
        if t.lower().startswith(k.lower()):
            return v
    return t


RUCNE_BOJE = {'Rendzinas': '#d9c27a', 'Lithosols': '#c9c9c9', 'Rankers': '#8c7a5b', 'Podzoluvisols': '#c7a2d6'}


def preuzmi(ime):
    if not os.path.exists(ime):
        print('PREUZIMAM', BAZA + ime, flush=True)
        urllib.request.urlretrieve(BAZA + ime, ime)
    print('ZIP', ime, os.path.getsize(ime), zipfile.ZipFile(ime).namelist()[:20])
    zipfile.ZipFile(ime).extractall('hwsd')


def tabela(mdb, ime):
    t = subprocess.run(['mdb-export', mdb, ime], capture_output=True, check=True).stdout.decode('utf-8', 'replace')
    return list(csv.DictReader(io.StringIO(t)))


def kljuc(red, *mog):
    for m in mog:
        for k in red:
            if k.upper() == m.upper():
                return k
    return None


def boje_grupa():
    try:
        t = urllib.request.urlopen(QML, timeout=60).read().decode('utf-8', 'replace')
        return {m.group(2): m.group(1).lower() for m in re.finditer(r'color="(#[0-9a-fA-F]{6})[^"]*"[^>]*label="([A-Za-z]+)"', t)} | \
               {m.group(1): m.group(2).lower() for m in re.finditer(r'label="([A-Za-z]+)"[^>]*color="(#[0-9a-fA-F]{6})', t)}
    except Exception as e:  # noqa: BLE001
        print('QML boje nedostupne', e)
        return {}


def main(granica, izlaz_tif, izlaz_json):
    granica, izlaz_tif, izlaz_json = (os.path.abspath(x) for x in (granica, izlaz_tif, izlaz_json))
    os.makedirs('/tmp/hwsd_rad', exist_ok=True); os.chdir('/tmp/hwsd_rad')
    preuzmi(RASTER_ZIP); preuzmi(DB_ZIP)
    fajlovi = [os.path.join(k, f) for k, _, fs in os.walk('hwsd') for f in fs]
    print('FAJLOVI', fajlovi)
    ras = next(f for f in fajlovi if f.lower().endswith(('.bil', '.tif')))
    mdb = next(f for f in fajlovi if f.lower().endswith(('.mdb', '.accdb')))
    print('RASTER', ras, gdal.Info(ras, format='json')['size'], 'MDB', mdb)
    tabele = subprocess.run(['mdb-tables', '-1', mdb], capture_output=True, check=True).stdout.decode().split()
    print('TABELE', tabele)

    rez = gdal.Warp('/vsimem/t.tif', ras, cutlineDSName=granica, cropToCutline=True, dstNodata=0,
                    resampleAlg='near', outputType=gdal.GDT_UInt16, xRes=1 / 120, yRes=1 / 120, targetAlignedPixels=True)
    a = rez.GetRasterBand(1).ReadAsArray()
    ok = a > 0
    ids, broj = np.unique(a[ok], return_counts=True)
    gt = rez.GetGeoTransform()
    lat_c = gt[3] + gt[5] * a.shape[0] / 2
    piksel_ha = abs(gt[1] * 111320 * np.cos(np.radians(lat_c)) * gt[5] * 111132) / 10000
    print('USK', a.shape, 'jedinica', len(ids), dict(zip(ids.tolist(), broj.tolist())))

    ime_t = lambda *m: next((t for t in tabele if t.upper() in [x.upper() for x in m]), None)
    t_slo = ime_t('HWSD2_LAYERS')
    t_smu = ime_t('HWSD2_SMU')
    slojevi = tabela(mdb, t_slo) if t_slo else []
    smu = tabela(mdb, t_smu) if t_smu else []
    if slojevi:
        print('KOLONE slojevi', list(slojevi[0].keys()))
    if smu:
        print('KOLONE smu', list(smu[0].keys()))
    rjecnici = {}
    for t in tabele:
        if t.upper().startswith('D_'):
            try:
                red = tabela(mdb, t)
                if red:
                    kk, kv = kljuc(red[0], 'CODE', 'ID'), kljuc(red[0], 'VALUE', 'DESCRIPTION', 'NAME')
                    if kk and kv:
                        rjecnici[t.upper()[2:]] = {r[kk]: r[kv] for r in red}
            except Exception as e:  # noqa: BLE001
                print('rječnik', t, e)
    print('RJEČNICI', {k: list(v.items())[:3] for k, v in rjecnici.items()})

    def prevod(polje, v):
        for ime in (polje, polje.split('_')[0]):
            if ime.upper() in rjecnici and v in rjecnici[ime.upper()]:
                return rjecnici[ime.upper()][v]
        return v

    k_id = kljuc(slojevi[0], 'HWSD2_SMU_ID') if slojevi else None
    jedinice = {int(i): {'komponente': []} for i in ids.tolist()}
    for r in slojevi:
        try:
            sid = int(float(r[k_id]))
        except (TypeError, ValueError):
            continue
        if sid not in jedinice:
            continue
        lay = r.get(kljuc(r, 'LAYER') or '', '')
        if lay and lay.upper() not in ('D1', '1'):
            continue
        komp = {}
        for polje in ('SEQUENCE', 'SHARE', 'WRB4', 'WRB2', 'FAO90', 'ROOT_DEPTH', 'DRAINAGE', 'TEXTURE_USDA',
                      'COARSE', 'SAND', 'SILT', 'CLAY', 'PH_WATER', 'ORG_CARBON', 'BULK', 'TOPDEP', 'BOTDEP'):
            k = kljuc(r, polje)
            if k is not None and r[k] not in ('', None):
                komp[polje] = r[k]
        jedinice[sid]['komponente'].append(komp)
    boje = boje_grupa()
    print('BOJE grupa', list(boje.items())[:8])
    izlaz = []
    for n, (sid, c) in enumerate(sorted(zip(ids.tolist(), broj.tolist()), key=lambda x: -x[1])):
        ks = sorted(jedinice[sid]['komponente'], key=lambda k: -float(k.get('SHARE', 0) or 0))
        kom = []
        for k in ks:
            fao = prevod('FAO90', k.get('FAO90', ''))
            wrb = prevod('WRB2', k.get('WRB2', '')) if k.get('WRB2') else prevod('WRB4', k.get('WRB4', ''))
            kom.append({'udio': round(float(k.get('SHARE', 0) or 0)), 'fao90': fao, 'wrb': wrb})
        dom = ks[0] if ks else {}
        naziv_eng = (kom[0]['wrb'] or kom[0]['fao90']) if kom else 'nepoznato'
        grupa = next((g for g in sorted(BS, key=len, reverse=True) if g.lower()[:-1] in naziv_eng.lower()), None)
        sv = {}
        def ok(v):
            try:
                return v not in (None, '') and float(v) >= 0
            except ValueError:
                return bool(v)
        if ok(dom.get('ROOT_DEPTH')): sv['Dubina tla'] = cisto(prevod('ROOT_DEPTH', dom['ROOT_DEPTH']).split('(')[0], DUBINA)
        if ok(dom.get('TEXTURE_USDA')): sv['Tekstura'] = cisto(prevod('TEXTURE_USDA', dom['TEXTURE_USDA']), TEKSTURA)
        if ok(dom.get('DRAINAGE')): sv['Drenaža'] = cisto(prevod('DRAINAGE', dom['DRAINAGE']), DRENAZA)
        if ok(dom.get('PH_WATER')): sv['pH (H₂O)'] = ('%.1f' % float(dom['PH_WATER'])).replace('.', ',')
        if ok(dom.get('COARSE')): sv['Skelet'] = str(round(float(dom['COARSE']))) + ' %'
        if ok(dom.get('CLAY')): sv['Glina / pijesak'] = str(round(float(dom['CLAY']))) + ' / ' + str(round(float(dom.get('SAND') or 0))) + ' %'
        if ok(dom.get('ORG_CARBON')): sv['Organski ugljik'] = ('%.1f' % float(dom['ORG_CARBON'])).replace('.', ',') + ' %'
        fao0 = kom[0]['fao90'] if kom else ''
        naziv = DOMACE.get(fao0) or BS.get(grupa, naziv_eng)
        if kom and kom[0]['udio'] <= 60 and len(kom) > 1:
            naziv += ' — kompleks s ' + (DOMACE.get(kom[1]['fao90']) or kom[1]['fao90']).split(' (')[0].lower()
        boja = BOJE_FAO.get(fao0) or boje.get(grupa) or RUCNE_BOJE.get(grupa) or '#999999'
        while boja in [j['boja'] for j in izlaz]:
            boja = svijetlija(boja)
        for k in kom:
            k['naziv'] = DOMACE.get(k['fao90']) or k['fao90']
        izlaz.append({'kod': n + 1, 'smu': sid, 'naziv': naziv, 'wrb': kom[0]['wrb'] if kom else '',
                      'fao90': fao0, 'grupa': grupa or '',
                      'boja': boja,
                      'komponente': kom[:5], 'svojstva': sv, 'ha': round(c * piksel_ha), 'udio': round(c / broj.sum(), 4)})
        print('JEDINICA', sid, izlaz[-1]['naziv'], '|', izlaz[-1]['fao90'], '|', izlaz[-1]['wrb'], '|', round(100 * c / broj.sum(), 1), '%', sv, kom[:3])
    # raster: SMU id → redni kod (Byte-friendly, stabilan redoslijed po površini)
    mapa = {j['smu']: j['kod'] for j in izlaz}
    out = np.zeros(a.shape, np.uint16)
    for sid, kod in mapa.items():
        out[a == sid] = kod
    mem = gdal.GetDriverByName('MEM').Create('', rez.RasterXSize, rez.RasterYSize, 1, gdal.GDT_UInt16)
    mem.SetGeoTransform(gt); mem.SetProjection(rez.GetProjection())
    mem.GetRasterBand(1).WriteArray(out); mem.GetRasterBand(1).SetNoDataValue(0)
    gdal.Translate(izlaz_tif, mem, format='COG', creationOptions=['COMPRESS=DEFLATE', 'LEVEL=9', 'BLOCKSIZE=256', 'OVERVIEWS=NONE'])
    json.dump({'izvor': 'HWSD v2.0 — Harmonized World Soil Database (FAO & IIASA, 2023), 30″ (~1 km); Evropa: ESDB 1:1 000 000',
               'klasifikacija': 'FAO-90 (nasljednik FAO-UNESCO legende) i WRB', 'jedinice': izlaz},
              open(izlaz_json, 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main(*sys.argv[1:4])
