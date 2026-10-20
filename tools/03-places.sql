-- places を GeoJSON に書き出す（tippecanoe の入力）
-- 実行: duckdb data/work.duckdb -f tools/03-places.sql
LOAD spatial;
COPY (SELECT category, name, geom FROM places ORDER BY category, id)
TO 'data/out/places.geojson' WITH (FORMAT gdal, DRIVER 'GeoJSON', LAYER_CREATION_OPTIONS 'RFC7946=YES');
