-- chome テーブルを tippecanoe 用の GeoJSON に書き出す（属性は最小限）
-- 実行: duckdb data/work.duckdb -f tools/01-chome.sql
LOAD spatial;

COPY (
  SELECT key_code, city_name, name, geom
  FROM chome
  ORDER BY key_code
) TO 'data/out/chome.geojson'
WITH (FORMAT gdal, DRIVER 'GeoJSON', LAYER_CREATION_OPTIONS 'RFC7946=YES');
