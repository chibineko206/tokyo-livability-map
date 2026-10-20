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

-- ============================================================
-- crime: 警視庁「区市町村の町丁別、罪種別及び手口別認知件数」令和 7 年（2025 年）の年計
-- 横持ち（市区町丁 + 罪種 37 列）を縦持ちにし、町丁名を e-Stat の表記に正規化して chome と結合する
-- 1 つの町丁名が複数の町丁目に対応するとき（大字単位の行、住居表示前の名前）は 2020 年人口で按分する
-- ============================================================
DELETE FROM chome_alias;
INSERT INTO chome_alias
SELECT crime_name, city_name, chome_name FROM read_csv('tools/chome-alias.csv', all_varchar = true);

-- 表記の正規化: ヶ → ケ、丁目の全角数字 → 漢数字（e-Stat は「二丁目」、警視庁は「２丁目」）
CREATE OR REPLACE TEMP MACRO norm_name(s) AS
  regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
  regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
  regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
  regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    replace(s, 'ヶ', 'ケ'),
    '１０丁目', '十丁目'), '１１丁目', '十一丁目'), '１２丁目', '十二丁目'), '１３丁目', '十三丁目'), '１４丁目', '十四丁目'),
    '１５丁目', '十五丁目'), '１６丁目', '十六丁目'), '１７丁目', '十七丁目'), '１８丁目', '十八丁目'), '１９丁目', '十九丁目'),
    '１丁目', '一丁目'), '２丁目', '二丁目'), '３丁目', '三丁目'), '４丁目', '四丁目'), '５丁目', '五丁目'),
    '６丁目', '六丁目'), '７丁目', '七丁目'), '８丁目', '八丁目'), '９丁目', '九丁目');

CREATE OR REPLACE TEMP TABLE crime_wide AS
SELECT * FROM read_csv('data/raw/keishicho/R7.utf8.csv', header = true, all_varchar = true);

CREATE OR REPLACE TEMP TABLE crime_raw AS
SELECT 市区町丁 AS crime_name, category, CAST(cnt AS INTEGER) AS cnt
FROM (UNPIVOT crime_wide ON COLUMNS(* EXCLUDE (市区町丁)) INTO NAME category VALUE cnt);

-- 町丁名を区市町村名と町丁名に分ける。小計行（「〜計」、区市町村名だけの行）と地域外（他県・海外認知・不明）は除く
CREATE OR REPLACE TEMP TABLE crime_names AS
WITH n AS (
  SELECT DISTINCT 市区町丁 AS crime_name, regexp_replace(市区町丁, '^(西多摩郡|三宅島|八丈島)', '') AS n2
  FROM crime_wide
  WHERE 市区町丁 NOT LIKE '%計' AND 市区町丁 NOT IN ('他県', '海外認知', '不明')
), s AS (
  SELECT crime_name, n2,
         (SELECT city_name FROM (SELECT DISTINCT city_name FROM chome) x
           WHERE starts_with(n2, x.city_name) ORDER BY length(x.city_name) DESC LIMIT 1) AS city_name
  FROM n
)
SELECT crime_name, city_name, norm_name(substr(n2, length(city_name) + 1)) AS town
FROM s WHERE city_name IS NOT NULL AND length(n2) > length(city_name);

-- 対応先の key_code: 名前の一致 → 無ければ chome_alias
CREATE OR REPLACE TEMP TABLE crime_map AS
SELECT n.crime_name, c.key_code
FROM crime_names n JOIN chome c ON c.city_name = n.city_name AND norm_name(c.name) = n.town
WHERE n.crime_name NOT IN (SELECT crime_name FROM chome_alias)
UNION
SELECT a.crime_name, c.key_code
FROM chome_alias a JOIN chome c ON c.city_name = a.city_name AND c.name LIKE a.chome_name;

-- 按分比: 2020 年人口の比。人口が全て 0 か不明なら等分
CREATE OR REPLACE TEMP TABLE crime_share AS
SELECT m.crime_name, m.key_code,
       CASE WHEN sum(coalesce(p.pop, 0)) OVER (PARTITION BY m.crime_name) > 0
            THEN coalesce(p.pop, 0) * 1.0 / sum(coalesce(p.pop, 0)) OVER (PARTITION BY m.crime_name)
            ELSE 1.0 / count(*) OVER (PARTITION BY m.crime_name) END AS share
FROM crime_map m LEFT JOIN population p ON p.key_code = m.key_code AND p.year = 2020;

DELETE FROM crime;
INSERT INTO crime
SELECT s.key_code, 2025, r.category, sum(r.cnt * s.share)
FROM crime_raw r JOIN crime_share s USING (crime_name)
GROUP BY ALL;

SELECT 'crime' AS tbl, count(DISTINCT key_code) AS chome_with_crime,
       round(sum(cnt)) AS total FROM crime WHERE category = '総合計';
-- 結合できなかった町丁名（件数の多い順）。全体に対する割合が 5% 未満であること
SELECT 'crime unmatched' AS chk, count(*) AS names, sum(cnt) AS cnt,
       round(100.0 * sum(cnt) / (SELECT sum(cnt) FROM crime_raw r2 JOIN crime_names USING (crime_name) WHERE category = '総合計'), 2) AS pct
FROM crime_raw r JOIN crime_names USING (crime_name)
WHERE category = '総合計' AND crime_name NOT IN (SELECT crime_name FROM crime_map);
SELECT 'unmatched name' AS chk, crime_name, cnt
FROM crime_raw r JOIN crime_names USING (crime_name)
WHERE category = '総合計' AND crime_name NOT IN (SELECT crime_name FROM crime_map) ORDER BY cnt DESC;

-- ============================================================
-- places: 施設ポイント
--   学校・医療機関・保育所は国土数値情報（P29 学校、P04 医療機関、P14 福祉施設）。座標は JGD2011 緯度経度
--   スーパー・コンビニ・薬局・公園は Overture Maps places（国土数値情報に無い業種だけ）
--   Overture は bbox で取ったので神奈川などがはみ出す。町丁目ポリゴンの中にある点だけ残す
-- ============================================================
DELETE FROM places;

-- P29 学校: 16001 小学校、16002 中学校、16014 義務教育学校 → school。16011 幼稚園 → child_care
INSERT INTO places
SELECT 'ksj-p29-' || row_number() OVER (), 'ksj',
       CASE WHEN P29_003 = 16011 THEN 'child_care' ELSE 'school' END,
       P29_004, geom
FROM st_read('data/raw/ksj/P29-21_13_GML/P29-21_13.geojson')
WHERE P29_003 IN (16001, 16002, 16014, 16011);

-- P04 医療機関: 1 病院、2 診療所 → medical（3 歯科診療所は除く）
INSERT INTO places
SELECT 'ksj-p04-' || row_number() OVER (), 'ksj', 'medical', trim(P04_002), geom
FROM st_read('data/raw/ksj/P04-20_13_GML/P04-20_13_GML/P04-20_13.geojson')
WHERE P04_001 IN (1, 2);

-- P14 福祉施設: 中分類 19013（保育所等）と小分類 805（認定こども園）→ child_care
INSERT INTO places
SELECT 'ksj-p14-' || row_number() OVER (), 'ksj', 'child_care', P14_007,
       ST_Point(CAST(lon AS DOUBLE), CAST(lat AS DOUBLE))
FROM read_csv('data/raw/ksj/P14-15_13_GML/P14-15_13.csv', all_varchar = true)
WHERE P14_005 = '19013' OR P14_006 = '805';

-- Overture: taxonomy.primary で選ぶ
CREATE OR REPLACE TEMP TABLE tokyo AS SELECT ST_Union_Agg(geom) AS geom FROM chome;

INSERT INTO places
SELECT o.id, 'overture',
       CASE WHEN o.category IN ('grocery_store', 'superstore', 'organic_grocery_store') THEN 'supermarket'
            WHEN o.category = 'convenience_store' THEN 'convenience'
            WHEN o.category IN ('pharmacy', 'drugstore') THEN 'drugstore'
            WHEN o.category = 'park' THEN 'park' END AS category,
       o.name, ST_GeomFromText(o.wkt)
FROM read_parquet('data/raw/overture/places-tokyo.parquet') o, tokyo
WHERE o.category IN ('grocery_store', 'superstore', 'organic_grocery_store', 'convenience_store', 'pharmacy', 'drugstore', 'park')
  AND ST_Contains(tokyo.geom, ST_GeomFromText(o.wkt));

SELECT 'places' AS tbl, source, category, count(*) AS n FROM places GROUP BY ALL ORDER BY 2, 3;

-- ============================================================
-- access: 町丁目の重心から直線 1 km（徒歩 15 分の近似）以内の施設数をカテゴリ別に数える
-- 距離は平面直角座標 IX 系（EPSG:6677）に直してメートルで測る。島部は系の外だが近距離なので誤差は無視する
-- ============================================================
CREATE OR REPLACE TEMP TABLE cent AS
SELECT key_code, ST_Transform(ST_Centroid(geom), 'EPSG:4326', 'EPSG:6677', always_xy := true) AS pt FROM chome;
CREATE OR REPLACE TEMP TABLE pl AS
SELECT category, ST_Transform(geom, 'EPSG:4326', 'EPSG:6677', always_xy := true) AS pt FROM places;

DELETE FROM access;
INSERT INTO access
SELECT c.key_code, cat.category, count(p.pt)
FROM cent c
CROSS JOIN (SELECT DISTINCT category FROM places) cat
LEFT JOIN pl p ON p.category = cat.category AND ST_DWithin(c.pt, p.pt, 1000)
GROUP BY ALL;

SELECT 'access' AS tbl, count(*) AS rows, count(DISTINCT key_code) AS chome FROM access;
SELECT 'chome without access' AS chk, count(*) AS n FROM chome WHERE key_code NOT IN (SELECT key_code FROM access);
