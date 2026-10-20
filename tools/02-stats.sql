-- ビュー stats を public/stats.json（オブジェクトの配列）に書き出す
-- 実行: duckdb data/work.duckdb -f tools/02-stats.sql
COPY (
  SELECT * FROM stats ORDER BY key_code
) TO 'public/stats.json' WITH (FORMAT json, ARRAY true);
