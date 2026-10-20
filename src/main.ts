import {
  Map as MapLibreMap,
  AttributionControl,
  NavigationControl,
  addProtocol,
  setWorkerUrl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Protocol } from 'pmtiles';
import './style.css';

// maplibre-gl 6 は Worker を別ファイルから import.meta.url 相対で読むため、
// Vite でバンドルすると見つからない。Vite に Worker を束ねさせ、その URL を渡す
setWorkerUrl(maplibreWorkerUrl);

// PMTiles を pmtiles:// スキームで読めるようにする（工程 2 以降で使う）
const protocol = new Protocol();
addProtocol('pmtiles', protocol.tile);

// 背景は地理院ベクトルタイルの淡色スタイル
const GSI_STYLE = 'https://gsi-cyberjapan.github.io/gsivectortile-mapbox-gl-js/pale.json';

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
      '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
  }),
);
map.addControl(new NavigationControl({ showCompass: false }), 'top-left');

map.on('load', () => {
  console.log('map loaded');
});
