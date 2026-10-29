#!/usr/bin/env node
/**
 * Airport weather for the app, built on a schedule (GitHub Actions) because aviationweather.gov's
 * data doesn't allow browser (CORS) requests (owner, 2026-10-29: pilot features).
 *
 *   metars.cache.csv.gz    → every station's latest METAR, decoded fields, and flight category
 *   tafs.cache.xml.gz      → every TAF in force
 *   stations.cache.json.gz → the stations' names
 *
 * Writes metars.json and tafs.json into the given folder. Usage: node scripts/aviation.mjs out
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const CACHE = 'https://aviationweather.gov/data/cache';
const UA = 'weather-map airport weather (https://github.com/BooRussia/weather-map)';
/** METARs older than this are left out (a station that's stopped reporting). */
const STALE_H = 3;

/** One CSV line → fields, honoring double quotes (raw METARs are quoted). */
export function csvFields(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const num = (s) => (s === '' || s == null ? null : Number.isFinite(Number(s)) ? Number(s) : null);

/**
 * The METAR cache's CSV → compact rows:
 * [id, lat, lon, obs (epoch s), category, raw, tempC, dewC, windDir, windKt, gustKt, visSM, altimInHg, wx, sky, vertVisFt]
 * `sky` is the layers as METAR writes them ("FEW040 BKN090"); visibility "10+" stays a string.
 */
export function parseMetars(csv, now = Date.now()) {
  const lines = csv.split('\n').filter((l) => l.trim());
  const head = csvFields(lines[0]);
  const at = (name) => head.indexOf(name);
  const skyCols = head.flatMap((h, i) => (h === 'sky_cover' ? [i] : []));
  const col = {
    raw: at('raw_text'),
    id: at('station_id'),
    time: at('observation_time'),
    lat: at('latitude'),
    lon: at('longitude'),
    temp: at('temp_c'),
    dew: at('dewpoint_c'),
    wdir: at('wind_dir_degrees'),
    wspd: at('wind_speed_kt'),
    wgst: at('wind_gust_kt'),
    vis: at('visibility_statute_mi'),
    altim: at('altim_in_hg'),
    wx: at('wx_string'),
    cat: at('flight_category'),
    vv: at('vert_vis_ft'),
  };
  const rows = [];
  for (const line of lines.slice(1)) {
    const f = csvFields(line);
    const t = Date.parse(f[col.time]);
    const lat = num(f[col.lat]);
    const lon = num(f[col.lon]);
    if (!f[col.id] || !Number.isFinite(t) || lat == null || lon == null || now - t > STALE_H * 3_600_000) continue;
    const sky = skyCols
      .map((c) => (f[c] ? `${f[c]}${f[c + 1] ? String(Math.round(Number(f[c + 1]) / 100)).padStart(3, '0') : ''}` : ''))
      .filter(Boolean)
      .join(' ');
    rows.push([
      f[col.id],
      +lat.toFixed(4),
      +lon.toFixed(4),
      Math.round(t / 1000),
      f[col.cat] || '',
      f[col.raw],
      num(f[col.temp]),
      num(f[col.dew]),
      num(f[col.wdir]),
      num(f[col.wspd]),
      num(f[col.wgst]),
      f[col.vis] || null,
      num(f[col.altim]),
      f[col.wx] || '',
      sky,
      num(f[col.vv]),
    ]);
  }
  return rows;
}

/** The TAF cache's XML → { id: [issued (epoch s), raw] }; the latest issue per station. */
export function parseTafs(xml) {
  const out = {};
  for (const m of xml.matchAll(/<TAF>([\s\S]*?)<\/TAF>/g)) {
    const t = m[1];
    const id = /<station_id>([^<]+)<\/station_id>/.exec(t)?.[1];
    const raw = /<raw_text><!\[CDATA\[([\s\S]*?)\]\]><\/raw_text>/.exec(t)?.[1] ?? /<raw_text>([^<]*)<\/raw_text>/.exec(t)?.[1];
    const issued = Date.parse(/<issue_time>([^<]+)<\/issue_time>/.exec(t)?.[1] ?? '');
    if (!id || !raw || !Number.isFinite(issued)) continue;
    const s = Math.round(issued / 1000);
    if (!out[id] || out[id][0] < s) out[id] = [s, raw.trim()];
  }
  return out;
}

/** Station names by ICAO id: "Ocala Intl, FL". */
export function stationNames(list) {
  const out = {};
  for (const s of list) {
    const id = s.icaoId ?? s.id;
    if (!id || !s.site) continue;
    out[id] = s.state ? `${s.site}, ${s.state}` : s.site;
  }
  return out;
}

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
}

async function main() {
  const dir = process.argv[2] ?? 'out';
  const [csv, xml, stations] = await Promise.all([
    get(`${CACHE}/metars.cache.csv.gz`),
    get(`${CACHE}/tafs.cache.xml.gz`),
    get(`${CACHE}/stations.cache.json.gz`).catch(() => '[]'),
  ]);
  const names = stationNames(JSON.parse(stations));
  const metars = parseMetars(csv).map((r) => [...r, names[r[0]] ?? '']);
  const tafs = parseTafs(xml);
  const generated = new Date().toISOString();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'metars.json'), JSON.stringify({ generated, metars }));
  writeFileSync(join(dir, 'tafs.json'), JSON.stringify({ generated, tafs }));
  console.log(`${metars.length} METARs, ${Object.keys(tafs).length} TAFs`);
}

// Run when called as a script (tests import the parsers without fetching).
if (process.argv[1]?.endsWith('aviation.mjs')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
