#!/usr/bin/env node
/**
 * Hurricane data for the app, built on a schedule (GitHub Actions) because
 * NHC's storm list and ATCF model files don't allow browser (CORS) requests.
 *
 *   NHC CurrentStorms.json  → active storms (name, intensity, movement, links)
 *   ATCF a-decks (aid_public) → every model's latest track and intensity
 *
 * Writes one compact JSON file. Usage: node scripts/tropical.mjs out/tropical.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';

const STORMS_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const ADECK_URL = (id) => `https://ftp.nhc.noaa.gov/atcf/aid_public/a${id}.dat.gz`;
const UA = 'weather-map tropical data (https://github.com/BooRussia/weather-map)';
/** Model runs more than this much older than the latest cycle are left out. */
const STALE_H = 12;

/**
 * The aids drawn, by group. Early-cycle ("interpolated", *I) versions are
 * shifted to the current cycle, so they're preferred; the raw late-cycle run
 * stands in when there's no interpolated one.
 */
export const GROUPS = {
  official: ['OFCL'],
  consensus: ['TVCN', 'HCCA', 'GFEX', 'TVDG'],
  hurricane: [
    ['HWFI', 'HWRF'],
    ['HMNI', 'HMON'],
    ['HFAI', 'HFSA'],
    ['HFBI', 'HFSB'],
    ['CTCI', 'CTCX'],
  ],
  global: [
    ['AVNI', 'AVNO'],
    ['EMXI', 'EMX'],
    ['UKXI', 'UKX'],
    ['CMCI', 'CMC'],
    ['NVGI', 'NVGM'],
    ['NGXI', 'NGX'],
  ],
  ensembleMean: [
    ['AEMI', 'AEMN'],
    ['CEMI', 'CEMN'],
    ['EEMN', 'EMN'],
  ],
  statistical: ['TABS', 'TABM', 'TABD', 'XTRP', 'CLP5', 'BAMS', 'BAMM', 'BAMD', 'LBAR'],
};
/** Ensemble members: GFS ensemble (AC00, AP01–AP30), ECMWF ensemble if public (EE01–EE50). */
const MEMBER = /^(AC00|AP\d\d|EE\d\d|EN\d\d)$/;

/** "221N" → 22.1, "956W" → -95.6 */
const coord = (s) => {
  const m = /^(\d+)([NSEW])$/.exec(s.trim());
  if (!m) return null;
  const v = Number(m[1]) / 10;
  return m[2] === 'S' || m[2] === 'W' ? -v : v;
};

/** ATCF YYYYMMDDHH → epoch ms. */
const dtg = (s) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10));

/** Each aid's latest run: { init, pts: [[tau, lat, lon, vmaxKt]] }, tau ascending, one point per tau. */
export function parseADeck(text) {
  const runs = new Map(); // tech → Map(init → Map(tau → pt))
  for (const line of text.split('\n')) {
    const f = line.split(',').map((x) => x.trim());
    if (f.length < 9) continue;
    const tech = f[4];
    const init = f[2];
    const tau = Number(f[5]);
    const lat = coord(f[6] ?? '');
    const lon = coord(f[7] ?? '');
    if (!tech || !/^\d{10}$/.test(init) || !Number.isFinite(tau) || tau < 0 || lat == null || lon == null) continue;
    if (lat === 0 && lon === 0) continue;
    const vmax = Number(f[8]) || 0;
    if (!runs.has(tech)) runs.set(tech, new Map());
    const byInit = runs.get(tech);
    if (!byInit.has(init)) byInit.set(init, new Map());
    const byTau = byInit.get(init);
    if (!byTau.has(tau)) byTau.set(tau, [tau, lat, lon, vmax]); // the first line per tau (34-kt radii row)
  }
  const latest = {};
  for (const [tech, byInit] of runs) {
    const init = [...byInit.keys()].sort().pop();
    const pts = [...byInit.get(init).values()].sort((a, b) => a[0] - b[0]);
    if (pts.length >= 2 || tech === 'OFCL') latest[tech] = { init: dtg(init), pts };
  }
  return latest;
}

/** Pick the aids to draw and group them; drop stale runs. */
export function selectModels(latest) {
  // The latest cycle any aid has run.
  const ref = Math.max(...Object.values(latest).map((r) => r.init));
  const fresh = (r) => r && ref - r.init <= STALE_H * 3_600_000;
  const out = [];
  const add = (group, tech, label = tech) => {
    const r = latest[tech];
    if (fresh(r)) out.push({ tech: label, group, init: r.init, pts: r.pts });
  };
  for (const [group, list] of Object.entries(GROUPS)) {
    for (const item of list) {
      if (Array.isArray(item)) {
        const tech = item.find((t) => fresh(latest[t]));
        if (tech) add(group, tech);
      } else add(group, item);
    }
  }
  for (const tech of Object.keys(latest).sort()) if (MEMBER.test(tech)) add('member', tech);
  return out;
}

async function get(url, binary = false) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return binary ? Buffer.from(await res.arrayBuffer()) : res.text();
}

async function main() {
  const outPath = process.argv[2] ?? 'out/tropical.json';
  const list = JSON.parse(await get(STORMS_URL)).activeStorms ?? [];
  const storms = [];
  for (const s of list) {
    const storm = {
      id: s.id,
      bin: s.binNumber,
      name: s.name,
      classification: s.classification,
      intensityKt: Number(s.intensity) || 0,
      pressureMb: Number(s.pressure) || null,
      lat: s.latitudeNumeric,
      lon: s.longitudeNumeric,
      movementDir: s.movementDir ?? null,
      movementKt: s.movementSpeed ?? null,
      updated: s.lastUpdate,
      advisory: s.publicAdvisory?.advNum ?? null,
      advisoryUrl: s.publicAdvisory?.url ?? null,
      discussionUrl: s.forecastDiscussion?.url ?? null,
      models: [],
      modelsError: null,
    };
    try {
      storm.models = selectModels(parseADeck(gunzipSync(await get(ADECK_URL(s.id), true)).toString('latin1')));
    } catch (err) {
      storm.modelsError = String(err.message ?? err);
    }
    storms.push(storm);
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ generated: new Date().toISOString(), storms }));
  console.log(`${storms.length} storm(s): ${storms.map((s) => `${s.id} ${s.name} (${s.models.length} models)`).join(', ') || 'none'}`);
}

// Run when called as a script (tests import the parsers without fetching).
if (process.argv[1]?.endsWith('tropical.mjs')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
