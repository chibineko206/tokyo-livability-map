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
# data/raw/ に入力を置く（工程ごとに README に追記する）
bash tools/build.sh
```

## 出典

- 地理院タイル（国土地理院）
- 以降の工程で e-Stat、警視庁、国土数値情報、Overture Maps を追記する
