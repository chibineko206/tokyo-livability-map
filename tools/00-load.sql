-- data/raw/ の入力を work.duckdb のテーブルに取り込む。何度実行しても同じ結果になる
-- 実行: duckdb data/work.duckdb -f tools/00-load.sql
LOAD spatial;

-- ============================================================
-- chome: e-Stat 小地域境界（2020 年調査、東京都、JGD2011 緯度経度 = EPSG:6668）
-- 形と KEY_CODE は Shape から、名前は dbf2csv.py で UTF-8 にした CSV から読む
-- ============================================================
CREATE OR REPLACE TEMP TABLE shp AS
SELECT KEY_CODE AS key_code, HCODE AS hcode, geom
FROM st_read('data/raw/estat2020/r2ka13.shp');

CREATE OR REPLACE TEMP TABLE attr AS
SELECT KEY_CODE AS key_code, CITY_NAME AS city_name, S_NAME AS name
FROM read_csv('data/raw/estat2020/r2ka13.attr.csv', all_varchar = true)
GROUP BY ALL;

DELETE FROM chome;
INSERT INTO chome
SELECT
  s.key_code,
  any_value(a.city_name),
  any_value(a.name),
  ST_Union_Agg(s.geom)      -- 同じ町丁目が複数ポリゴンに分かれている分を 1 地物にまとめる
FROM shp s
LEFT JOIN attr a USING (key_code)
WHERE s.hcode = 8101        -- 町丁・字等のみ（8154 = 水面調査区を除く）
  AND length(s.key_code) >= 9 -- 2 桁（所属未定地）を除く
GROUP BY s.key_code;

SELECT 'chome' AS tbl, count(*) AS rows, count(*) FILTER (WHERE name IS NULL) AS no_name FROM chome;

-- ============================================================
-- population: 2015 は e-Stat 小地域 T000848（人口総数）、2020 は境界ファイルの JINKO（行ごとに分かれているので合計）
-- 2015 の秘匿処理（HTKSYORI=2、値は 'X'）は NULL にする。'-' は 0
-- ============================================================
DELETE FROM population;

-- HYOSYO: 1 = 市区町村、2 = 大字（丁目の小計を含む）、3 = 丁目。葉の行だけ入れる
-- （丁目を持つ大字の小計行は除く。丁目を持たない大字は 2020 の 9 桁キーと対応する）
CREATE OR REPLACE TEMP TABLE pop2015_raw AS
SELECT KEY_CODE AS key_code, HYOSYO AS hyosyo, TRY_CAST(replace(T000848001, '-', '0') AS INTEGER) AS pop
FROM read_csv('data/raw/tblT000848/tblT000848C13.utf8.csv', all_varchar = true)
WHERE KEY_CODE <> '';

INSERT INTO population
SELECT key_code, 2015, pop FROM pop2015_raw
WHERE hyosyo = '3'
   OR (hyosyo = '2' AND key_code NOT IN (SELECT substr(key_code, 1, 9) FROM pop2015_raw WHERE hyosyo = '3'));

INSERT INTO population
SELECT KEY_CODE, 2020, sum(TRY_CAST(JINKO AS INTEGER))
FROM read_csv('data/raw/estat2020/r2ka13.attr.csv', all_varchar = true)
WHERE HCODE = '8101' AND length(KEY_CODE) >= 9
GROUP BY KEY_CODE;

SELECT 'population' AS tbl, year, count(*) AS rows, sum(pop) AS total FROM population GROUP BY year ORDER BY year;
-- 境界（2020）にあって 2015 の表に無い町丁目の数。比較不可として NULL になる
SELECT 'chome without 2015' AS chk, count(*) AS n
FROM chome c LEFT JOIN population p ON p.key_code = c.key_code AND p.year = 2015
WHERE p.key_code IS NULL OR p.pop IS NULL;
