/// <reference types="node" />
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
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
