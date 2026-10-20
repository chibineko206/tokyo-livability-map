import {
  Map as MapLibreMap,
  AttributionControl,
  NavigationControl,
  Popup,
  addProtocol,
  setWorkerUrl,
  type ExpressionSpecification,
  type MapGeoJSONFeature,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Protocol } from 'pmtiles';
import './style.css';

// maplibre-gl 6 は Worker を別ファイルから import.meta.url 相対で読むため、
// Vite でバンドルすると見つからない。Vite に Worker を束ねさせ、その URL を渡す
setWorkerUrl(maplibreWorkerUrl);

// PMTiles を pmtiles:// スキームで読めるようにする
const protocol = new Protocol();
addProtocol('pmtiles', protocol.tile);

// 背景は地理院ベクトルタイルの淡色スタイル。切り替えで地理院の航空写真（ラスター）を上に重ねる
const GSI_STYLE = 'https://gsi-cyberjapan.github.io/gsivectortile-mapbox-gl-js/pale.json';
const GSI_PHOTO_TILES = 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg';

// 配信物の URL（GitHub Pages の base を含める）
const BASE = `${location.origin}${import.meta.env.BASE_URL}`;
const CHOME_URL = new URL('chome.pmtiles', BASE).href;
const PLACES_URL = new URL('places.pmtiles', BASE).href;
const STATS_URL = new URL('stats.json', BASE).href;

// ---- 軸と凡例の定義 --------------------------------------------------------
// stats.json の 1 行（tools/00-schema.sql のビュー stats と同じ列）
type Stat = {
  key_code: string;
  pop2015: number | null;
  pop2020: number | null;
  rate: number | null;
  crime_total: number | null; // 2025 年の認知件数（総合計）
  crime_per_1000: number | null; // 人口千人あたり。2020 年人口 100 人未満は null
  access_score: number | null; // 施設の近さ 0〜7（カテゴリごとに中央値で頭打ちした比の和）
  school: number | null; // 以下、重心から 1 km 以内の施設数
  child_care: number | null;
  medical: number | null;
  supermarket: number | null;
  convenience: number | null;
  drugstore: number | null;
  park: number | null;
  score?: number | null; // 総合スコア 0〜100。ブラウザ内で重みから計算する（stats.json には無い）
};

type AxisDef = {
  key: keyof Stat; // feature-state に載せる値
  title: string;
  stops: number[]; // 階級の境界（昇順）
  colors: string[]; // stops.length + 1 色
  labels: string[]; // colors と同数
  naLabel: string; // NULL のときの説明
};

const NA_COLOR = '#d9d9d9';

const AXES: Record<string, AxisDef> = {
  // 人口増減は両側に意味があるので発散型（ColorBrewer RdBu）
  rate: {
    key: 'rate',
    title: '人口増減 2015 → 2020（%）',
    stops: [-10, -3, 3, 10],
    colors: ['#ca0020', '#f4a582', '#f7f7f7', '#92c5de', '#0571b0'],
    labels: ['-10% 以下', '-10 〜 -3%', '-3 〜 +3%', '+3 〜 +10%', '+10% 以上'],
    naLabel: '比較不可（2015 年に 100 人未満、または区画の変更）',
  },
  // 犯罪発生率は大きいほど悪いので順次型（ColorBrewer YlOrRd）。境界は中央値 4.5、90% 点 14 を目安にした
  crime: {
    key: 'crime_per_1000',
    title: '犯罪発生率 2025（人口千人あたりの認知件数）',
    stops: [2, 4, 8, 16],
    colors: ['#ffffb2', '#fecc5c', '#fd8d3c', '#f03b20', '#bd0026'],
    labels: ['2 未満', '2 〜 4', '4 〜 8', '8 〜 16', '16 以上'],
    naLabel: 'データなし、または 2020 年人口 100 人未満',
  },
  // 施設の近さは大きいほど良いので順次型（ColorBrewer YlGn）
  access: {
    key: 'access_score',
    title: '施設の近さ（重心から 1 km 以内、0〜7）',
    stops: [2, 4, 5.5, 6.5],
    colors: ['#ffffcc', '#c2e699', '#78c679', '#31a354', '#006837'],
    labels: ['2 未満', '2 〜 4', '4 〜 5.5', '5.5 〜 6.5', '6.5 以上'],
    naLabel: 'データなし',
  },
  // 総合スコアは 3 軸の百分位（0〜1）を重み付き平均し 0〜100 にしたもの。順次型（ColorBrewer PuBu）
  score: {
    key: 'score',
    title: '総合スコア（3 軸の百分位の重み付き平均、0〜100）',
    stops: [20, 40, 60, 80],
    colors: ['#f1eef6', '#bdc9e1', '#74a9cf', '#2b8cbe', '#045a8d'],
    labels: ['20 未満', '20 〜 40', '40 〜 60', '60 〜 80', '80 以上'],
    naLabel: 'いずれかの軸が比較不可・データなし',
  },
};

// ---- 総合スコア ------------------------------------------------------------
// 3 軸を百分位（0〜1。外れ値の影響を受けない）に直し、重み付き平均する。犯罪は少ないほど良いので反転する
type ScoreAxis = 'rate' | 'crime_per_1000' | 'access_score';
const SCORE_AXES: { key: ScoreAxis; label: string; higherIsBetter: boolean }[] = [
  { key: 'rate', label: '人口増減', higherIsBetter: true },
  { key: 'crime_per_1000', label: '治安（犯罪発生率の低さ）', higherIsBetter: false },
  { key: 'access_score', label: '施設の近さ', higherIsBetter: true },
];

// key_code → 各軸の百分位（0〜1、無ければ null）
const percentiles = new Map<string, Record<ScoreAxis, number | null>>();

function computePercentiles(rows: Stat[]) {
  for (const axis of SCORE_AXES) {
    const vals = rows.map((r) => r[axis.key]).filter((v): v is number => v !== null && v !== undefined);
    const sorted = [...vals].sort((a, b) => a - b);
    const n = sorted.length;
    // 同じ値は同じ百分位にする（下側の個数 ÷ n）
    const rankOf = (v: number) => {
      let lo = 0, hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] < v) lo = mid + 1; else hi = mid;
      }
      return n > 1 ? lo / (n - 1) : 0;
    };
    for (const r of rows) {
      const v = r[axis.key];
      const entry = percentiles.get(r.key_code) ?? { rate: null, crime_per_1000: null, access_score: null };
      entry[axis.key] = v === null || v === undefined ? null : axis.higherIsBetter ? rankOf(v) : 1 - rankOf(v);
      percentiles.set(r.key_code, entry);
    }
  }
}

function readWeights(): Record<ScoreAxis, number> {
  const w = { rate: 0, crime_per_1000: 0, access_score: 0 };
  for (const el of document.querySelectorAll<HTMLInputElement>('input[name="weight"]')) {
    w[el.dataset.axis as ScoreAxis] = Number(el.value);
    el.nextElementSibling!.textContent = el.value;
  }
  return w;
}

// 3 軸がそろっている町丁目だけスコアを付ける。重みの合計が 0 なら全て null
function computeScore(p: Record<ScoreAxis, number | null>, w: Record<ScoreAxis, number>): number | null {
  const total = w.rate + w.crime_per_1000 + w.access_score;
  if (total === 0 || p.rate === null || p.crime_per_1000 === null || p.access_score === null) return null;
  const s = (p.rate * w.rate + p.crime_per_1000 * w.crime_per_1000 + p.access_score * w.access_score) / total;
  return Math.round(s * 100);
}

function applyScores() {
  const w = readWeights();
  for (const [key_code, p] of percentiles) {
    map.setFeatureState({ source: 'chome', sourceLayer: 'chome', id: key_code }, { score: computeScore(p, w) });
  }
}

function setupWeights() {
  let pending = false;
  for (const el of document.querySelectorAll<HTMLInputElement>('input[name="weight"]')) {
    el.addEventListener('input', () => {
      // スライダーは連続して動くので、描画 1 回につき 1 回だけ再計算する
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; applyScores(); });
    });
  }
}

// 施設カテゴリ（places.pmtiles の category 属性）の表示名と色。stats の列名（1 km 以内の数）と同じキー
const PLACE_CATEGORIES: Record<string, { label: string; color: string }> = {
  school: { label: '小中学校', color: '#1b9e77' },
  child_care: { label: '保育所・幼稚園', color: '#66a61e' },
  medical: { label: '病院・診療所', color: '#e7298a' },
  supermarket: { label: 'スーパー', color: '#d95f02' },
  convenience: { label: 'コンビニ', color: '#e6ab02' },
  drugstore: { label: '薬局・ドラッグストア', color: '#7570b3' },
  park: { label: '公園', color: '#a6761d' },
};
const PLACES_MIN_ZOOM = 13;

// feature-state の値を階級色にする式
function fillColorExpression(axis: AxisDef): ExpressionSpecification {
  const value: ExpressionSpecification = ['feature-state', axis.key];
  const step: ExpressionSpecification = ['step', value, axis.colors[0]];
  axis.stops.forEach((s, i) => step.push(s, axis.colors[i + 1]));
  return ['case', ['==', value, null], NA_COLOR, step];
}

function fillLegend(ul: HTMLElement, items: readonly (readonly [string, string])[], shape: 'box' | 'dot') {
  ul.innerHTML = '';
  for (const [color, label] of items) {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = shape === 'dot' ? 'swatch dot' : 'swatch';
    sw.style.background = color;
    li.append(sw, label);
    ul.append(li);
  }
}

function renderLegend(axis: AxisDef) {
  document.getElementById('legend-title')!.textContent = axis.title;
  const items = axis.colors.map((c, i) => [c, axis.labels[i]] as const).concat([[NA_COLOR, axis.naLabel]]);
  fillLegend(document.getElementById('legend')!, items, 'box');
}

function renderPlacesLegend() {
  const items = Object.values(PLACE_CATEGORIES).map((c) => [c.color, c.label] as const);
  fillLegend(document.getElementById('places-legend')!, items, 'dot');
}

// ---- 地図 ------------------------------------------------------------------
const mobile = matchMedia('(max-width: 640px)');

const map = new MapLibreMap({
  container: 'map',
  style: GSI_STYLE,
  center: [139.7671, 35.6812], // 東京駅
  zoom: 11,
  minZoom: 8,
  maxZoom: 16,
  hash: true, // URL に #ズーム/緯度/経度 を持たせ、表示位置を共有できるようにする
  attributionControl: false,
});

map.addControl(
  new AttributionControl({
    compact: mobile.matches, // スマホでは「i」ボタンに畳む（ポップアップと重なるため）
    customAttribution:
      '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>' +
      ' | <a href="https://www.e-stat.go.jp/" target="_blank" rel="noopener">e-Stat</a>（国勢調査 2015・2020 小地域）' +
      ' | <a href="https://www.keishicho.metro.tokyo.lg.jp/about_mpd/jokyo_tokei/jokyo/ninchikensu.html" target="_blank" rel="noopener">警視庁</a>（認知件数 2025）' +
      ' | <a href="https://nlftp.mlit.go.jp/ksj/" target="_blank" rel="noopener">国土数値情報</a>（学校・医療機関・福祉施設）' +
      ' | <a href="https://overturemaps.org/" target="_blank" rel="noopener">Overture Maps</a>（places、CDLA Permissive 2.0）',
  }),
  mobile.matches ? 'top-right' : 'bottom-right', // スマホでは下部シートとポップアップから離す
);
map.addControl(new NavigationControl({ showCompass: false }), 'top-left');

// 開発時だけ、ブラウザのコンソールや Playwright から地図を触れるようにする
if (import.meta.env.DEV) (window as unknown as { __map: MapLibreMap }).__map = map;

map.on('load', async () => {
  // 主題レイヤーは背景の道路・建物より上、注記（地名・駅名）より下に入れる。
  // 地理院のスタイルは line / fill と symbol が交互に並ぶので、「最後の line / fill の直後の symbol」を境にする
  // （最初の symbol の手前だと道路の下になり、市街地で塗りが細切れに見え、ホバーの輪郭も道路に隠れる）
  const layers = map.getStyle().layers;
  const lastDrawn = Math.max(-1, ...layers.map((l, i) => (l.type === 'symbol' ? -1 : i)));
  const firstSymbol = layers.slice(lastDrawn + 1).find((l) => l.type === 'symbol')?.id;

  // 航空写真は淡色地図の道路・建物を覆い、町丁目の塗りと注記はその上に残す。既定は非表示
  map.addSource('gsi-photo', {
    type: 'raster',
    tiles: [GSI_PHOTO_TILES],
    tileSize: 256,
    maxzoom: 18,
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html#seamlessphoto" target="_blank" rel="noopener">地理院タイル（全国最新写真）</a>',
  });
  map.addLayer({ id: 'gsi-photo', type: 'raster', source: 'gsi-photo', layout: { visibility: 'none' } }, firstSymbol);

  map.addSource('chome', {
    type: 'vector',
    url: `pmtiles://${CHOME_URL}`,
    promoteId: { chome: 'key_code' }, // setFeatureState が地物を特定するために必要
  });

  const axis = AXES.rate;

  map.addLayer(
    {
      id: 'chome-fill',
      type: 'fill',
      source: 'chome',
      'source-layer': 'chome',
      paint: {
        'fill-color': fillColorExpression(axis),
        'fill-opacity': 0.45, // 背景の道路や写真が透けて見える程度
      },
    },
    firstSymbol,
  );

  const hovered: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false];
  map.addLayer(
    {
      id: 'chome-line',
      type: 'line',
      source: 'chome',
      'source-layer': 'chome',
      paint: {
        'line-color': ['case', hovered, '#000', '#333'],
        // zoom は最上位の interpolate でしか使えないので、ホバー判定は内側に置く
        // 通常の輪郭は太い道路（高速道路）の上でも見える太さにする
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          8, ['case', hovered, 2, 0.3],
          12, ['case', hovered, 2.5, 0.8],
          14, ['case', hovered, 3, 1.5],
          16, ['case', hovered, 3.5, 2],
        ],
        'line-opacity': ['case', hovered, 1, 0.8],
      },
    },
    firstSymbol,
  );

  // 施設は町丁目の上、注記の下。ズーム 13 以上でだけ出す
  map.addSource('places', { type: 'vector', url: `pmtiles://${PLACES_URL}` });
  const matchArgs: unknown[] = ['match', ['get', 'category']];
  for (const [key, c] of Object.entries(PLACE_CATEGORIES)) matchArgs.push(key, c.color);
  matchArgs.push('#999');
  const categoryColor = matchArgs as ExpressionSpecification;
  map.addLayer(
    {
      id: 'places-circle',
      type: 'circle',
      source: 'places',
      'source-layer': 'places',
      minzoom: PLACES_MIN_ZOOM,
      paint: {
        'circle-color': categoryColor,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 4, 16, 7],
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 1,
      },
    },
    firstSymbol,
  );

  renderLegend(axis);
  renderPlacesLegend();
  setupInteraction();
  setupAxisSwitch();
  setupPlacesToggle();
  setupBasemapSwitch();
  setupSheet();

  // 数値はタイルに焼かず、stats.json を feature-state で載せる（更新時にタイルを作り直さないため）
  const rows: Stat[] = await (await fetch(STATS_URL)).json();
  for (const s of rows) {
    map.setFeatureState(
      { source: 'chome', sourceLayer: 'chome', id: s.key_code },
      {
        rate: s.rate,
        pop2015: s.pop2015,
        pop2020: s.pop2020,
        crime_total: s.crime_total,
        crime_per_1000: s.crime_per_1000,
        access_score: s.access_score,
        school: s.school,
        child_care: s.child_care,
        medical: s.medical,
        supermarket: s.supermarket,
        convenience: s.convenience,
        drugstore: s.drugstore,
        park: s.park,
      },
    );
  }
  computePercentiles(rows);
  setupWeights();
  applyScores();
  console.log(`map loaded: stats ${rows.length} rows`);
});

// ---- 軸の切り替え ----------------------------------------------------------
function setupAxisSwitch() {
  for (const el of document.querySelectorAll<HTMLInputElement>('input[name="axis"]')) {
    el.addEventListener('change', () => {
      const axis = AXES[el.value];
      if (!axis) return;
      map.setPaintProperty('chome-fill', 'fill-color', fillColorExpression(axis));
      renderLegend(axis);
    });
  }
}

function setupBasemapSwitch() {
  for (const el of document.querySelectorAll<HTMLInputElement>('input[name="basemap"]')) {
    el.addEventListener('change', () => {
      map.setLayoutProperty('gsi-photo', 'visibility', el.value === 'photo' ? 'visible' : 'none');
    });
  }
}

function setupPlacesToggle() {
  const el = document.getElementById('places-toggle') as HTMLInputElement;
  const hint = document.getElementById('places-hint')!;
  const apply = () => {
    map.setLayoutProperty('places-circle', 'visibility', el.checked ? 'visible' : 'none');
    hint.hidden = !el.checked || map.getZoom() >= PLACES_MIN_ZOOM;
  };
  el.addEventListener('change', apply);
  map.on('zoomend', apply);
  apply();
}

// ---- スマホの下部シート -----------------------------------------------------

function collapseSheet() {
  const panel = document.getElementById('panel')!;
  panel.classList.remove('expanded');
  panel.scrollTop = 0; // 畳んだときに見出しが見えるよう、スクロールを先頭に戻す
  document.getElementById('sheet-toggle')!.setAttribute('aria-expanded', 'false');
}

function setupSheet() {
  const panel = document.getElementById('panel')!;
  const btn = document.getElementById('sheet-toggle')!;
  btn.addEventListener('click', () => {
    if (!mobile.matches) return; // PC では見出しのまま
    if (panel.classList.contains('expanded')) collapseSheet();
    else {
      panel.classList.add('expanded');
      btn.setAttribute('aria-expanded', 'true');
    }
  });
}

// ---- 操作: ホバーで輪郭を強調、クリック（タップ）でポップアップ ------------
function fmt(n: number | null | undefined, unit = ''): string {
  return n === null || n === undefined ? '—' : `${n.toLocaleString('ja-JP')}${unit}`;
}

// 「小中学校 6・保育所 11・…」の形で 1 km 以内の施設数を並べる
function placesSummary(s: Partial<Stat>): string {
  return Object.entries(PLACE_CATEGORIES)
    .map(([key, c]) => `${c.label} ${fmt(s[key as keyof Stat] as number | null)}`)
    .join('・');
}

// 3 軸の百分位を三角形のレーダーにする（1 点に畳んだスコアだけでなく、どの軸が効いているかを見せる）
function radarSvg(p: Record<ScoreAxis, number | null> | undefined): string {
  if (!p) return '';
  const R = 32, cx = 60, cy = 46;
  const pts = SCORE_AXES.map((a, i) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
    return { v: p[a.key] ?? 0, x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang), label: a.label.split('（')[0] };
  });
  const poly = (k: number) => pts.map((q) => `${cx + (q.x - cx) * k},${cy + (q.y - cy) * k}`).join(' ');
  const val = pts.map((q) => `${cx + (q.x - cx) * q.v},${cy + (q.y - cy) * q.v}`).join(' ');
  const labels = pts
    .map((q, i) => {
      const anchor = i === 0 ? 'middle' : i === 1 ? 'start' : 'end';
      const dy = i === 0 ? -4 : 10;
      return `<text x="${q.x}" y="${q.y + dy}" text-anchor="${anchor}" font-size="9">${q.label} ${Math.round(q.v * 100)}</text>`;
    })
    .join('');
  return `<svg class="radar" viewBox="0 0 120 92" width="150" height="115">
    <polygon points="${poly(1)}" fill="none" stroke="#ccc"/><polygon points="${poly(0.5)}" fill="none" stroke="#e5e5e5"/>
    <polygon points="${val}" fill="rgba(43,140,190,0.35)" stroke="#2b8cbe"/>${labels}</svg>`;
}

function popupHtml(f: MapGeoJSONFeature): string {
  const p = f.properties as { key_code: string; city_name: string; name: string | null };
  const s = f.state as Partial<Stat>;
  const title = p.name ? `${p.city_name} ${p.name}` : `${p.city_name}（名称なし）`;
  const rate = s.rate === null || s.rate === undefined ? '比較不可' : `${s.rate > 0 ? '+' : ''}${s.rate}%`;
  const hasCrime = s.crime_total !== null && s.crime_total !== undefined;
  const crimeRate = s.crime_per_1000 === null || s.crime_per_1000 === undefined ? '—' : `${s.crime_per_1000}`;
  // 繁華街・オフィス街は居住人口が少なく、来訪者の分も件数に入るので発生率が極端になる
  const fewResidents = hasCrime && ((s.pop2020 ?? 0) < 100 || (s.crime_per_1000 ?? 0) >= 30);
  const notes = [`町丁目コード ${p.key_code}`];
  if (!hasCrime) notes.push('犯罪: 警視庁の表に無い町丁目');
  if (fewResidents) notes.push('居住人口が少ないため発生率は参考値（来訪者の分も件数に入る）');
  return `
    <div class="popup">
      <div class="popup-title">${title}</div>
      <table>
        <tr><th>人口 2015</th><td>${fmt(s.pop2015, ' 人')}</td></tr>
        <tr><th>人口 2020</th><td>${fmt(s.pop2020, ' 人')}</td></tr>
        <tr><th>増減率</th><td>${rate}</td></tr>
        <tr><th>認知件数 2025</th><td>${fmt(s.crime_total, ' 件')}</td></tr>
        <tr><th>千人あたり</th><td>${crimeRate}</td></tr>
        <tr><th>施設の近さ</th><td>${fmt(s.access_score)} / 7</td></tr>
        <tr><th>総合スコア</th><td>${fmt(s.score)}</td></tr>
      </table>
      ${radarSvg(percentiles.get(p.key_code))}
      <div class="popup-places">1 km 以内: ${placesSummary(s)}</div>
      <div class="popup-note">${notes.join('<br>')}</div>
    </div>`;
}

function setupInteraction() {
  const src = { source: 'chome', sourceLayer: 'chome' };
  let hoveredId: string | number | null = null;

  const clearHover = () => {
    if (hoveredId !== null) {
      map.setFeatureState({ ...src, id: hoveredId }, { hover: false });
      hoveredId = null;
    }
  };

  // PC のみ: スマホはホバーが無いのでタップのポップアップだけになる
  map.on('mousemove', 'chome-fill', (e) => {
    const f = e.features?.[0];
    if (!f || f.id === hoveredId) return;
    clearHover();
    hoveredId = f.id ?? null;
    if (hoveredId !== null) map.setFeatureState({ ...src, id: hoveredId }, { hover: true });
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'chome-fill', () => {
    clearHover();
    map.getCanvas().style.cursor = '';
  });

  const popup = new Popup({ closeButton: true, maxWidth: '280px' });
  map.on('click', (e) => {
    collapseSheet(); // タップしたらシートは畳む（地図を広く使い、ポップアップが隠れないようにする）
    // 施設の点が町丁目の上にあるので、点が当たればそちらを優先する
    const place = map.queryRenderedFeatures(e.point, { layers: ['places-circle'] })[0];
    if (place) {
      const p = place.properties as { category: string; name: string | null };
      const cat = PLACE_CATEGORIES[p.category]?.label ?? p.category;
      popup
        .setLngLat(e.lngLat)
        .setHTML(`<div class="popup"><div class="popup-title">${p.name ?? '名称不明'}</div><div class="popup-note">${cat}</div></div>`)
        .addTo(map);
      return;
    }
    const f = map.queryRenderedFeatures(e.point, { layers: ['chome-fill'] })[0];
    if (!f) return;
    popup.setLngLat(e.lngLat).setHTML(popupHtml(f)).addTo(map);
  });
  map.on('mouseenter', 'places-circle', () => (map.getCanvas().style.cursor = 'pointer'));
}
