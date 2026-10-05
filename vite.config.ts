import { defineConfig } from 'vitest/config';

export default defineConfig({
  // MapLibre's worker is an ES module; bundle it as one.
  worker: { format: 'es' },
  server: { host: true },
  build: {
    // MapLibre GL is most of the bundle (~800 kB min, ~250 kB gzip); that's expected for a vector map.
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
