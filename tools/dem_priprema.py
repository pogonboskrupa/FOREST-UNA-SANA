"""Copernicus DEM GLO-30 izrezan na 5 općina USK (granice iz static/data/opcine5.geojson).

Izlaz: static/data/dem_opcine.tif — Int16 COG, EPSG:4326, 1" (~30 m), metri
zaokruženi na 1 m, NoData -32768 van općina. Aplikacija iz njega pravi
Terrarium pločice kad nema interneta (nagib, ekspozicija, sjenčenje, profil).
"""
import sys

import numpy as np
from osgeo import gdal

gdal.UseExceptions()
BAZA = '/vsicurl/https://copernicus-dem-30m.s3.amazonaws.com/'
PLOCICE = [f'Copernicus_DSM_COG_10_N{la:02d}_00_E{lo:03d}_00_DEM' for la in (44, 45) for lo in (15, 16)]


def main(granice, izlaz):
    izvori = [BAZA + p + '/' + p + '.tif' for p in PLOCICE]
    for u in izvori:
        print('IZVOR', u, gdal.Info(u, format='json')['size'])
    vrt = gdal.BuildVRT('/vsimem/dem.vrt', izvori)
    rez = gdal.Warp('/vsimem/izrez.tif', vrt, cutlineDSName=granice, cropToCutline=True,
                    dstNodata=-32768, outputType=gdal.GDT_Float32, resampleAlg='bilinear',
                    xRes=1 / 3600, yRes=1 / 3600, targetAlignedPixels=True)
    b = rez.GetRasterBand(1)
    a = b.ReadAsArray()
    ok = a > -1000
    out = np.full(a.shape, -32768, np.int16)
    out[ok] = np.round(a[ok]).astype(np.int16)
    print('VELIČINA', rez.RasterXSize, rez.RasterYSize, 'min/max', int(out[ok].min()), int(out[ok].max()), 'validno %', round(100 * ok.mean(), 1))
    mem = gdal.GetDriverByName('MEM').Create('', rez.RasterXSize, rez.RasterYSize, 1, gdal.GDT_Int16)
    mem.SetGeoTransform(rez.GetGeoTransform()); mem.SetProjection(rez.GetProjection())
    mem.GetRasterBand(1).WriteArray(out); mem.GetRasterBand(1).SetNoDataValue(-32768)
    gdal.Translate(izlaz, mem, format='COG',
                   creationOptions=['COMPRESS=DEFLATE', 'PREDICTOR=2', 'LEVEL=9', 'BLOCKSIZE=256', 'OVERVIEWS=NONE'])


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
