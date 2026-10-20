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
| 小地域境界 2020（東京都、世界測地系緯度経度、Shape。属性 `JINKO` が 2020 年人口） | `data/raw/estat2020/r2ka13.{shp,shx,dbf,prj}` | e-Stat 境界データ: `https://www.e-stat.go.jp/gis/statmap-search/data?dlserveyId=A002005212020&code=13&coordSys=1&format=shape&downloadType=5&datum=2011` を展開 |
| 2015 年国勢調査 小地域 人口総数（東京都、表 T000848） | `data/raw/tblT000848/tblT000848C13.txt` | e-Stat 統計データ: `https://www.e-stat.go.jp/gis/statmap-search/data?statsId=T000848&code=13&downloadType=2` を展開 |
| 警視庁 区市町村の町丁別、罪種別及び手口別認知件数（令和 7 年の年計、CSV） | `data/raw/keishicho/R7.csv` | `https://www.keishicho.metro.tokyo.lg.jp/about_mpd/jokyo_tokei/jokyo/ninchikensu.html` の「令和7年 … CSVファイル」 |
| 国土数値情報 学校 P29（2021）、医療機関 P04（2020）、福祉施設 P14（2015）。東京都 | `data/raw/ksj/P29-21_13_GML/`、`P04-20_13_GML/`、`P14-15_13_GML/`（zip を展開） | `https://nlftp.mlit.go.jp/ksj/gml/data/P29/P29-21/P29-21_13_GML.zip`、`.../P04/P04-20/P04-20_13_GML.zip`、`.../P14/P14-15/P14-15_13_GML.zip` |
| Overture Maps places（2026-09-23.1、東京都本土の bbox） | `data/raw/overture/places-tokyo.parquet` | `tools/fetch-overture.sql` が S3 から取り出す（`build.sh` はファイルが無いときだけ実行。5〜10 分） |

注意: 統計表の URL の `code=13` は小地域（ファイル名 `C13`）では東京都だが、同じ ID 系列でもメッシュの表（`S` / `H` / `Q`）ではメッシュ番号の意味になる。取得したら先頭の `KEY_CODE` が `13` で始まることを確かめる。

`build.sh` の流れ: `00-schema.sql`（テーブル定義）→ `dbf2csv.py` / `shp2csv.py`（Shift_JIS の DBF・Shape を UTF-8 CSV に）→ `00-load.sql`（取り込み）→ `01-chome.sql` + tippecanoe（`public/chome.pmtiles`）→ `02-stats.sql`（`public/stats.json`）→ `03-places.sql` + tippecanoe（`public/places.pmtiles`）。

テーブル（`data/work.duckdb`）: `chome`（町丁目ポリゴン）、`population`、`chome_alias`、`crime`、`places`、`access`。ビュー `stats` が配信する数値（`stats.json` の元）。

### 警視庁の町丁名と e-Stat の町丁目の突合

警視庁の CSV は「千代田区飯田橋１丁目」のように区市町村名と町丁名がつながった 1 列で、丁目は全角数字。e-Stat は「飯田橋一丁目」。`00-load.sql` で次の順に対応させる。

1. 区市町村名を最長一致で切り出す（「西多摩郡」「三宅島」「八丈島」の接頭は落とす）。小計行（「〜計」、区市町村名だけの行）と「他県」「海外認知」「不明」は除く
2. 「ヶ → ケ」「２丁目 → 二丁目」に正規化して名前で結合する
3. それでも合わない名前は `tools/chome-alias.csv`（`crime_name` = CSV の表記そのまま、`city_name`、`chome_name` = e-Stat の名前。末尾 `%` で前方一致）で対応させる。住居表示の実施で 2020 年の境界に無い名前（町田市南大谷 N 丁目 → 南大谷）や、警視庁が大字単位の行（日の出町大字平井 → 大字平井〜 16 区画）がここに入る
4. 1 つの町丁名が複数の町丁目に対応するときは 2020 年人口で按分する（`crime.cnt` は小数）

突合できない名前は `00-load.sql` の実行時に一覧で出る（2025 年分は 14 名、185 件、全体の 0.19%。昭島市代官山、町田市藤の台、「以下不詳」など）。

### 施設のカテゴリ

| `places.category` | 出所 | 選び方 |
|---|---|---|
| `school` | 国土数値情報 P29 | 学校分類 16001 小学校、16002 中学校、16014 義務教育学校 |
| `child_care` | P29 + P14 | P29 16011 幼稚園、P14 中分類 19013（保育所等）と小分類 805（認定こども園） |
| `medical` | P04 | 1 病院、2 診療所（歯科は除く） |
| `supermarket` | Overture | `taxonomy.primary` が `grocery_store` / `superstore` / `organic_grocery_store` |
| `convenience` | Overture | `convenience_store` |
| `drugstore` | Overture | `pharmacy` / `drugstore` |
| `park` | Overture | `park` |

Overture は bbox で取るので、町丁目ポリゴンの中にある点だけ残す。分類の精度は出所に依る（弁当店が `grocery_store` に入る、など）。

## 出典

- 地理院タイル（国土地理院）
- 「政府統計の総合窓口（e-Stat）」の境界データ（2020 年国勢調査 小地域）と 2015 年国勢調査 小地域集計
- 警視庁「区市町村の町丁別、罪種別及び手口別認知件数」（令和 7 年）
- 国土数値情報（学校データ、医療機関データ、福祉施設データ）国土交通省
- Overture Maps Foundation の places データ（CDLA Permissive 2.0）
