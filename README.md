# 東京の住環境マップ

東京都の町丁目ごとに「人口の増減・犯罪の発生率・生活施設の近さ」を重ねて見られる静的 Web 地図。個人開発のお試し。

- 背景地図: 国土地理院ベクトルタイル（借り物）
- 主題データ: 町丁目ポリゴンと施設ポイントを PMTiles にして GitHub Pages から配信
- データの正: `data/work.duckdb`（DuckDB。`tools/build.sh` で再生成）

## 開発

```bash
npm install
npm run dev        # http://localhost:5173/tokyo-livability-map/
npm run build      # dist/ に出力。main への push で GitHub Pages に配られる
```

## データの再生成

```bash
brew install duckdb tippecanoe pmtiles
# data/raw/ に入力を置く（下表）
bash tools/build.sh
```

| 入力 | 置き場所 | 取得元 |
|---|---|---|
| 小地域境界 2020（東京都、世界測地系緯度経度、Shape） | `data/raw/estat2020/r2ka13.{shp,shx,dbf,prj}` | e-Stat 境界データ: `https://www.e-stat.go.jp/gis/statmap-search/data?dlserveyId=A002005212020&code=13&coordSys=1&format=shape&downloadType=5&datum=2011` を展開 |

`build.sh` の流れ: `00-schema.sql`（テーブル定義）→ `dbf2csv.py`（Shift_JIS の DBF を UTF-8 CSV に）→ `00-load.sql`（取り込み）→ `01-chome.sql`（GeoJSON 書き出し）→ tippecanoe（`public/chome.pmtiles`）。

テーブル（`data/work.duckdb`）: `chome`（町丁目ポリゴン）、`population`、`chome_alias`、`crime`、`places`、`access`。

## 出典

- 地理院タイル（国土地理院）
- 「政府統計の総合窓口（e-Stat）」の境界データ（2020 年国勢調査 小地域）
- 以降の工程で警視庁、国土数値情報、Overture Maps を追記する
