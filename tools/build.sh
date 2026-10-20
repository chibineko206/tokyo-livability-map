#!/usr/bin/env bash
# data/raw/ の入力から public/ の配信物を作り直す。
# 前提: brew install duckdb tippecanoe pmtiles
set -euo pipefail
cd "$(dirname "$0")/.."

DB=data/work.duckdb
mkdir -p data/raw data/out public

echo "== 0. スキーマ"
duckdb "$DB" -f tools/00-schema.sql

# 工程 2 以降で有効にする
# echo "== 1. 取り込み"
# for f in data/raw/*.sjis.csv; do iconv -f SHIFT_JIS -t UTF-8 "$f" > "${f%.sjis.csv}.csv"; done
# duckdb "$DB" -f tools/00-load.sql
#
# echo "== 2. 町丁目 → PMTiles"
# duckdb "$DB" -f tools/01-chome.sql
# tippecanoe -o public/chome.pmtiles -l chome -Z8 -z14 \
#   --detect-shared-borders --simplification=10 --force data/out/chome.geojson
#
# echo "== 3. stats.json"
# duckdb "$DB" -f tools/02-stats.sql
#
# echo "== 4. 施設 → PMTiles"
# duckdb "$DB" -f tools/03-places.sql
# tippecanoe -o public/places.pmtiles -l places -Z11 -z15 \
#   --drop-densest-as-needed --force data/out/places.geojson

echo "== done"
duckdb "$DB" -c "SHOW TABLES"
