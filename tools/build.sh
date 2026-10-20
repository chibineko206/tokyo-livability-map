#!/usr/bin/env bash
# data/raw/ の入力から public/ の配信物を作り直す。
# 前提: brew install duckdb tippecanoe pmtiles
set -euo pipefail
cd "$(dirname "$0")/.."

DB=data/work.duckdb
mkdir -p data/raw data/out public

echo "== 0. スキーマ"
duckdb "$DB" -f tools/00-schema.sql

echo "== 1. 取り込み"
# e-Stat 境界の DBF は Shift_JIS。DuckDB 同梱の GDAL は変換できないので Python で UTF-8 CSV にする
python3 tools/dbf2csv.py data/raw/estat2020/r2ka13.dbf data/raw/estat2020/r2ka13.attr.csv
# e-Stat の統計表 CSV は Shift_JIS。DuckDB の read_csv は読めないので UTF-8 に変換してから読む
iconv -f CP932 -t UTF-8 data/raw/tblT000848/tblT000848C13.txt > data/raw/tblT000848/tblT000848C13.utf8.csv
# 警視庁の認知件数 CSV も Shift_JIS
iconv -f CP932 -t UTF-8 data/raw/keishicho/R7.csv > data/raw/keishicho/R7.utf8.csv
duckdb "$DB" -f tools/00-load.sql

echo "== 2. 町丁目 → PMTiles"
duckdb "$DB" -f tools/01-chome.sql
tippecanoe -q -o public/chome.pmtiles -l chome -Z8 -z14 \
  --detect-shared-borders --simplification=10 --force data/out/chome.geojson
pmtiles show public/chome.pmtiles | head -12

echo "== 3. stats.json"
duckdb "$DB" -f tools/02-stats.sql
ls -la public/stats.json

# 工程 6 以降で有効にする
#
# echo "== 4. 施設 → PMTiles"
# duckdb "$DB" -f tools/03-places.sql
# tippecanoe -o public/places.pmtiles -l places -Z11 -z15 \
#   --drop-densest-as-needed --force data/out/places.geojson

echo "== done"
duckdb "$DB" -c "SHOW TABLES"
