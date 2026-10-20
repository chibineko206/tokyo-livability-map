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

-- 警視庁の町丁目名 → key_code の手作り対応表（名前で結合できない分だけ）
CREATE TABLE IF NOT EXISTS chome_alias (
  city_name  VARCHAR,
  crime_name VARCHAR,
  key_code   VARCHAR,
  PRIMARY KEY (city_name, crime_name)
);

-- 警視庁 町丁別・罪種別 認知件数（縦持ち）
CREATE TABLE IF NOT EXISTS crime (
  key_code VARCHAR,
  year     INTEGER,
  category VARCHAR, -- 凶悪犯 / 粗暴犯 / 侵入窃盗 / 非侵入窃盗 / その他
  cnt      INTEGER
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

-- ビュー stats は工程 3 で定義し、工程 5・7 で列を足す

-- ビュー stats: 配信する町丁目ごとの数値。工程 5・7 で列を足す
-- rate は 2015 → 2020 の増減率（%）。2015 の人口が 100 人未満か不明なら NULL（比較不可）
CREATE OR REPLACE VIEW stats AS
WITH p AS (
  SELECT key_code,
         max(pop) FILTER (WHERE year = 2015) AS pop2015,
         max(pop) FILTER (WHERE year = 2020) AS pop2020
  FROM population GROUP BY key_code
)
SELECT c.key_code,
       p.pop2015,
       p.pop2020,
       CASE WHEN p.pop2015 >= 100 AND p.pop2020 IS NOT NULL
            THEN round((p.pop2020 - p.pop2015) * 100.0 / p.pop2015, 1) END AS rate
FROM chome c LEFT JOIN p USING (key_code);
