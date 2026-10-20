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

// 背景は地理院ベクトルタイルの淡色スタイル
const GSI_STYLE = 'https://gsi-cyberjapan.github.io/gsivectortile-mapbox-gl-js/pale.json';

// 配信物の URL（GitHub Pages の base を含める）
const BASE = `${location.origin}${import.meta.env.BASE_URL}`;
const CHOME_URL = new URL('chome.pmtiles', BASE).href;
const STATS_URL = new URL('stats.json', BASE).href;

// ---- 軸と凡例の定義 --------------------------------------------------------
// stats.json の 1 行。工程 7 で列が増える
type Stat = {
  key_code: string;
  pop2015: number | null;
  pop2020: number | null;
  rate: number | null;
  crime_total: number | null; // 2025 年の認知件数（総合計）
  crime_per_1000: number | null; // 人口千人あたり。2020 年人口 100 人未満は null
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
};

// feature-state の値を階級色にする式
function fillColorExpression(axis: AxisDef): ExpressionSpecification {
  const value: ExpressionSpecification = ['feature-state', axis.key];
  const step: ExpressionSpecification = ['step', value, axis.colors[0]];
  axis.stops.forEach((s, i) => step.push(s, axis.colors[i + 1]));
  return ['case', ['==', value, null], NA_COLOR, step];
}

function renderLegend(axis: AxisDef) {
  document.getElementById('legend-title')!.textContent = axis.title;
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
      ' | <a href="https://www.e-stat.go.jp/" target="_blank" rel="noopener">e-Stat</a>（国勢調査 2015・2020 小地域）' +
      ' | <a href="https://www.keishicho.metro.tokyo.lg.jp/about_mpd/jokyo_tokei/jokyo/ninchikensu.html" target="_blank" rel="noopener">警視庁</a>（認知件数 2025）',
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

  const hovered: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false];
  map.addLayer(
    {
      id: 'chome-line',
      type: 'line',
      source: 'chome',
      'source-layer': 'chome',
      paint: {
        'line-color': ['case', hovered, '#000', '#555'],
        // zoom は最上位の interpolate でしか使えないので、ホバー判定は内側に置く
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          8, ['case', hovered, 2, 0.2],
          12, ['case', hovered, 2.5, 0.5],
          14, ['case', hovered, 3, 1.0],
        ],
        'line-opacity': ['case', hovered, 1, 0.7],
      },
    },
    firstSymbol,
  );

  renderLegend(axis);
  setupInteraction();
  setupAxisSwitch();

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
      },
    );
  }
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

// ---- 操作: ホバーで輪郭を強調、クリック（タップ）でポップアップ ------------
function fmt(n: number | null | undefined, unit = ''): string {
  return n === null || n === undefined ? '—' : `${n.toLocaleString('ja-JP')}${unit}`;
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
      </table>
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
  map.on('click', 'chome-fill', (e) => {
    const f = e.features?.[0];
    if (!f) return;
    popup.setLngLat(e.lngLat).setHTML(popupHtml(f)).addTo(map);
  });
}
