#!/usr/bin/env python3
"""Shape の DBF を UTF-8 の CSV に落とす。

DuckDB 同梱の GDAL は文字コード変換を持たないため、Shift_JIS の属性（町丁目名）は
このスクリプトで別に読み出し、KEY_CODE で結合する。標準ライブラリだけで動く。

使い方: python3 tools/dbf2csv.py <in.dbf> <out.csv> [encoding=cp932]
"""
import csv
import struct
import sys


def read_dbf(path, encoding):
    with open(path, 'rb') as f:
        header = f.read(32)
        n_records = struct.unpack('<I', header[4:8])[0]
        header_len = struct.unpack('<H', header[8:10])[0]
        record_len = struct.unpack('<H', header[10:12])[0]

        fields = []
        while True:
            desc = f.read(32)
            if desc[0] == 0x0D:
                break
            name = desc[:11].split(b'\x00')[0].decode('ascii')
            ftype = chr(desc[11])
            length = desc[16]
            fields.append((name, ftype, length))

        f.seek(header_len)
        for _ in range(n_records):
            rec = f.read(record_len)
            if len(rec) < record_len:
                break
            if rec[0:1] == b'*':  # 削除済み
                continue
            pos = 1
            row = []
            for name, ftype, length in fields:
                raw = rec[pos:pos + length]
                pos += length
                row.append(raw.decode(encoding, errors='replace').strip())
            yield [f[0] for f in fields], row


def main():
    src, dst = sys.argv[1], sys.argv[2]
    encoding = sys.argv[3] if len(sys.argv) > 3 else 'cp932'
    with open(dst, 'w', newline='', encoding='utf-8') as out:
        writer = csv.writer(out)
        wrote_header = False
        n = 0
        for names, row in read_dbf(src, encoding):
            if not wrote_header:
                writer.writerow(names)
                wrote_header = True
            writer.writerow(row)
            n += 1
    print(f'{dst}: {n} rows')


if __name__ == '__main__':
    main()
