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
