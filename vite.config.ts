import wasm from 'vite-plugin-wasm';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [wasm()],
  // The admin screen calls the API same-origin (nginx proxies /api/ in the
  // compose stack); dev needs the same shape, pointed at the server's API_BIND.
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:9877',
    },
  },
  build: {
    target: 'esnext',
  },
});
