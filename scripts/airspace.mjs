#!/usr/bin/env node
/**
 * Class B, C, and D airspace for the app, built once a day (GitHub Actions). The FAA's ArcGIS service
 * shares one request quota among everyone who uses it, and asking it per map view from every browser
 * failed under load (2026-10-29: "Too many requests"); airspace changes only every 56-day chart cycle,
 * so one copy a day is plenty.
 *
 * Writes airspace.json (GeoJSON, simplified to about 50 m). Usage: node scripts/airspace.mjs out/airspace.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const QUERY = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Class_Airspace/FeatureServer/0/query';
const UA = 'weather-map airspace (https://github.com/BooRussia/weather-map)';
const PAGE = 1000;
/** When the shared quota is spent, the service says to wait a minute. */
const RETRY_MS = 65_000;
const TRIES = 6;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function page(offset) {
  const q = new URLSearchParams({
    where: "CLASS IN ('B','C','D')",
    outFields: 'NAME,CLASS,LOWER_VAL,UPPER_VAL,LOWER_CODE,UPPER_CODE',
    outSR: '4326',
    maxAllowableOffset: '0.0005',
    geometryPrecision: '4',
    orderByFields: 'OBJECTID',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE),
    f: 'geojson',
  });
  for (let i = 0; i < TRIES; i++) {
    const res = await fetch(`${QUERY}?${q}`, { headers: { 'User-Agent': UA } });
    const body = await res.json().catch(() => null);
    if (res.ok && body?.features) return body;
    console.error(`page at ${offset}: ${body?.error?.message ?? `HTTP ${res.status}`}; waiting`);
    await wait(RETRY_MS);
  }
  throw new Error(`gave up on the page at ${offset}`);
}

/** The service's features → compact ones: name, class, and floor and ceiling (ft, with what they're measured from). */
export function compact(features) {
  return features
    .filter((f) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
    .map((f) => {
      const p = f.properties ?? {};
      return {
        type: 'Feature',
        geometry: f.geometry,
        properties: { name: p.NAME ?? '', cls: p.CLASS, lo: p.LOWER_VAL ?? 0, hi: p.UPPER_VAL ?? 0, loRef: p.LOWER_CODE ?? '', hiRef: p.UPPER_CODE ?? '' },
      };
    });
}

async function main() {
  const out = process.argv[2] ?? 'out/airspace.json';
  const features = [];
  for (let offset = 0; ; offset += PAGE) {
    const r = await page(offset);
    features.push(...compact(r.features));
    if (r.features.length < PAGE && !r.properties?.exceededTransferLimit) break;
  }
  if (features.length < 100) throw new Error(`only ${features.length} airspace shapes; not publishing`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), type: 'FeatureCollection', features }));
  console.log(`${features.length} airspace shapes`);
}

if (process.argv[1]?.endsWith('airspace.mjs')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
