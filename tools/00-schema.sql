-- data/work.duckdb のテーブル定義。何度実行しても同じ結果になる
-- 実行: duckdb data/work.duckdb -f tools/00-schema.sql
INSTALL spatial;
LOAD spatial;

-- 町丁目ポリゴン（e-Stat 小地域境界、2020 年調査）。ジオメトリは EPSG:4326
CREATE TABLE IF NOT EXISTS chome (
  key_code  VARCHAR PRIMARY KEY, -- e-Stat の町丁目コード 11 桁
  city_name VARCHAR,             -- 区市町村名
  name      VARCHAR,             -- 町丁目名
  geom      GEOMETRY
);

-- 国勢調査 人口（小地域）
CREATE TABLE IF NOT EXISTS population (
  key_code VARCHAR,
  year     INTEGER,
  pop      INTEGER,
  PRIMARY KEY (key_code, year)
);

-- 警視庁の町丁目名 → e-Stat の町丁目名の手作り対応表（表記の正規化だけでは結合できない分）
-- chome_name の末尾の % は前方一致（警視庁が大字単位、e-Stat がその下の字単位のとき）
-- 中身は tools/chome-alias.csv。取り込みのたびに入れ直すので CREATE OR REPLACE
CREATE OR REPLACE TABLE chome_alias (
  crime_name VARCHAR PRIMARY KEY, -- 警視庁 CSV の「市区町丁」そのまま
  city_name  VARCHAR,
  chome_name VARCHAR
);

-- 警視庁 町丁別・罪種別 認知件数（縦持ち）
-- 1 つの町丁名が複数の町丁目に対応するときは 2020 年人口で按分するので cnt は小数
CREATE OR REPLACE TABLE crime (
  key_code VARCHAR,
  year     INTEGER,
  category VARCHAR, -- 警視庁 CSV の列名そのまま（総合計 / 凶悪犯計 / 粗暴犯計 / ... 37 列）
  cnt      DOUBLE,
  PRIMARY KEY (key_code, year, category)
);

-- 施設ポイント。source は 'ksj'（国土数値情報）か 'overture'
CREATE TABLE IF NOT EXISTS places (
  id       VARCHAR PRIMARY KEY,
  source   VARCHAR,
  category VARCHAR, -- school / hospital / child_care / supermarket など
  name     VARCHAR,
  geom     GEOMETRY
);

-- 町丁目の重心から 1 km 以内のカテゴリ別施設数
CREATE TABLE IF NOT EXISTS access (
  key_code VARCHAR,
  category VARCHAR,
  cnt      INTEGER,
  PRIMARY KEY (key_code, category)
);

-- ビュー stats: 配信する町丁目ごとの数値。工程 7 で列を足す
-- rate は 2015 → 2020 の増減率（%）。2015 の人口が 100 人未満か不明なら NULL（比較不可）
-- crime_per_1000 は 2025 年の認知件数（総合計）÷ 2020 年人口 × 1000。人口 100 人未満は NULL
-- （皇居・公園・埋立地で発生率が極端になるのを防ぐ。件数 crime_total は人口に関わらず出す）
CREATE OR REPLACE VIEW stats AS
WITH p AS (
  SELECT key_code,
         max(pop) FILTER (WHERE year = 2015) AS pop2015,
         max(pop) FILTER (WHERE year = 2020) AS pop2020
  FROM population GROUP BY key_code
), cr AS (
  SELECT key_code, sum(cnt) AS crime_total
  FROM crime WHERE year = 2025 AND category = '総合計' GROUP BY key_code
)
SELECT c.key_code,
       p.pop2015,
       p.pop2020,
       CASE WHEN p.pop2015 >= 100 AND p.pop2020 IS NOT NULL
            THEN round((p.pop2020 - p.pop2015) * 100.0 / p.pop2015, 1) END AS rate,
       round(cr.crime_total, 1) AS crime_total,
       CASE WHEN p.pop2020 >= 100 AND cr.crime_total IS NOT NULL
            THEN round(cr.crime_total * 1000.0 / p.pop2020, 1) END AS crime_per_1000
FROM chome c LEFT JOIN p USING (key_code) LEFT JOIN cr USING (key_code);
