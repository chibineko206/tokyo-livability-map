#!/usr/bin/env python3
"""ポイントの Shape ファイルを UTF-8 CSV にする（属性は Shift_JIS）。標準ライブラリのみ。
DuckDB 同梱の GDAL は DBF の文字コードを変換できないので、国土数値情報の Shape はこれで読む。
使い方: python3 tools/shp2csv.py in.shp out.csv  → 属性列 + lon, lat
"""
import csv
import struct
import sys

from dbf2csv import read_dbf  # 同じディレクトリ


def read_points(path):
    with open(path, 'rb') as f:
        f.seek(32)
        shape_type = struct.unpack('<i', f.read(4))[0]
        if shape_type != 1:
            sys.exit(f'{path}: shape type {shape_type} is not Point(1)')
        f.seek(100)
        while True:
            header = f.read(8)
            if len(header) < 8:
                break
            length = struct.unpack('>i', header[4:])[0] * 2
            body = f.read(length)
            if struct.unpack('<i', body[:4])[0] == 1:
                yield struct.unpack('<dd', body[4:20])
            else:  # Null shape
                yield (None, None)


def main():
    src, dst = sys.argv[1], sys.argv[2]
    recs = list(read_dbf(src[:-4] + '.dbf', 'cp932'))
    fields, rows = recs[0][0], [r for _, r in recs]
    points = list(read_points(src))
    if len(points) != len(rows):
        sys.exit(f'record count mismatch: shp {len(points)} dbf {len(rows)}')
    with open(dst, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(fields + ['lon', 'lat'])
        for r, (x, y) in zip(rows, points):
            w.writerow(r + [x, y])
    print(f'{dst}: {len(rows)} rows', file=sys.stderr)


if __name__ == '__main__':
    main()
