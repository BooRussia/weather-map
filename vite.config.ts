/// <reference types="node" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // GitHub Pages serves the site from /<repo>/; the Pages workflow sets BASE_PATH.
  // Netlify, Vercel, and local dev serve from the root.
  base: process.env.BASE_PATH ?? '/',
  // MapLibre's worker is an ES module; bundle it as one.
  worker: { format: 'es' },
  server: { host: true },
  build: {
    // MapLibre GL is most of the bundle (~800 kB min, ~250 kB gzip); that's expected for a vector map.
    chunkSizeWarningLimit: 1200,
    // The app, and the banner alone for TV home screens (tv.html).
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        tv: fileURLToPath(new URL('./tv.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
