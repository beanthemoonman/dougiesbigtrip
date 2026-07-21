import wasm from 'vite-plugin-wasm';
import { defineConfig } from 'vitest/config';

// E2E tests spawn the real Rust server and drive it over a WebSocket. They must
// NOT share the parallel unit pool: a single server thread starves under 35-way
// load and the wall-clock round timing flakes. Run one file at a time, one fork.
export default defineConfig({
  plugins: [wasm()],
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.e2e.ts'],
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 20000,
    hookTimeout: 15000,
  },
});
