import { defineConfig } from 'vite';

// GitHub Pages はリポジトリ名がパスに入るため base を固定する
export default defineConfig({
  base: '/tokyo-livability-map/',
  // maplibre-gl 6 は Worker を別ファイル（maplibre-gl-worker.mjs）から import.meta.url で読む。
  // 開発サーバーの事前バンドルに含めると相対 URL が壊れて "Worker failed to load" になるので除外する
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
});
