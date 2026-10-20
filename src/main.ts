import {
  Map as MapLibreMap,
  AttributionControl,
  NavigationControl,
  addProtocol,
  setWorkerUrl,
  type ExpressionSpecification,
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

// 背景は地理院ベクトルタイルの淡色スタイル
const GSI_STYLE = 'https://gsi-cyberjapan.github.io/gsivectortile-mapbox-gl-js/pale.json';

// 配信物の URL（GitHub Pages の base を含める）
const BASE = `${location.origin}${import.meta.env.BASE_URL}`;
const CHOME_URL = new URL('chome.pmtiles', BASE).href;
const STATS_URL = new URL('stats.json', BASE).href;

// ---- 軸と凡例の定義 --------------------------------------------------------
// stats.json の 1 行。工程 5・7 で列が増える
type Stat = {
  key_code: string;
  pop2015: number | null;
  pop2020: number | null;
  rate: number | null;
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
};

// feature-state の値を階級色にする式
function fillColorExpression(axis: AxisDef): ExpressionSpecification {
  const value: ExpressionSpecification = ['feature-state', axis.key];
  const step: ExpressionSpecification = ['step', value, axis.colors[0]];
  axis.stops.forEach((s, i) => step.push(s, axis.colors[i + 1]));
  return ['case', ['==', value, null], NA_COLOR, step];
}

function renderLegend(axis: AxisDef) {
  const ul = document.getElementById('legend')!;
  ul.innerHTML = '';
  const items = axis.colors.map((c, i) => [c, axis.labels[i]] as const).concat([[NA_COLOR, axis.naLabel]]);
  for (const [color, label] of items) {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = color;
    li.append(sw, label);
    ul.append(li);
  }
}

// ---- 地図 ------------------------------------------------------------------
const map = new MapLibreMap({
  container: 'map',
  style: GSI_STYLE,
  center: [139.7671, 35.6812], // 東京駅
  zoom: 11,
  minZoom: 8,
  maxZoom: 16,
  attributionControl: false,
});

map.addControl(
  new AttributionControl({
    compact: false,
    customAttribution:
      '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>' +
      ' | <a href="https://www.e-stat.go.jp/" target="_blank" rel="noopener">e-Stat</a>（国勢調査 2015・2020 小地域）',
  }),
);
map.addControl(new NavigationControl({ showCompass: false }), 'top-left');

map.on('load', async () => {
  // 背景の注記（symbol レイヤー）より下に主題レイヤーを入れる
  const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;

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
        'fill-opacity': 0.6,
      },
    },
    firstSymbol,
  );

  map.addLayer(
    {
      id: 'chome-line',
      type: 'line',
      source: 'chome',
      'source-layer': 'chome',
      paint: {
        'line-color': '#555',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.2, 12, 0.5, 14, 1.0],
        'line-opacity': 0.7,
      },
    },
    firstSymbol,
  );

  renderLegend(axis);

  // 数値はタイルに焼かず、stats.json を feature-state で載せる（更新時にタイルを作り直さないため）
  const rows: Stat[] = await (await fetch(STATS_URL)).json();
  for (const s of rows) {
    map.setFeatureState(
      { source: 'chome', sourceLayer: 'chome', id: s.key_code },
      { rate: s.rate, pop2015: s.pop2015, pop2020: s.pop2020 },
    );
  }
  console.log(`map loaded: stats ${rows.length} rows`);
});
