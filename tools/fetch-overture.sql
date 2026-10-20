-- Overture Maps の places を S3 から東京都（本土）の範囲だけ取り出して data/raw/overture/ に置く
-- 全球分（約 11 GB）は落とさず、bbox 列の条件で Parquet の行グループを絞る。所要 5〜10 分
-- 実行: duckdb -f tools/fetch-overture.sql（build.sh はファイルが無いときだけ実行する）
INSTALL httpfs; LOAD httpfs;
INSTALL spatial; LOAD spatial;
SET s3_region = 'us-west-2';

COPY (
  SELECT id,
         names.primary        AS name,
         basic_category,
         taxonomy.primary     AS category,
         taxonomy.hierarchy   AS hierarchy,
         operating_status,
         confidence,
         ST_AsText(geometry)  AS wkt
  FROM read_parquet('s3://overturemaps-us-west-2/release/2026-09-23.1/theme=places/type=place/*')
  WHERE bbox.xmin BETWEEN 138.94 AND 139.95   -- 東京都本土。島部は含めない
    AND bbox.ymin BETWEEN 35.49 AND 35.90
) TO 'data/raw/overture/places-tokyo.parquet';
