#!/usr/bin/env node
/**
 * Airport weather for the app, built on a schedule (GitHub Actions) because aviationweather.gov's
 * data doesn't allow browser (CORS) requests (owner, 2026-10-29: pilot features).
 *
 *   metars.cache.csv.gz          → every station's latest METAR, decoded fields, and flight category
 *   tafs.cache.xml.gz            → every TAF in force
 *   stations.cache.json.gz       → the stations' names
 *   api airsigmet, gairmet        → SIGMETs and G-AIRMETs (icing, turbulence, IFR, obscured mountains, wind shear)
 *   aircraftreports.cache.csv.gz → pilot reports (PIREPs)
 *   tfr.faa.gov                  → temporary flight restrictions, their shapes and kinds
 *
 * Writes metars.json, tafs.json, and advisories.json into the given folder. Usage: node scripts/aviation.mjs out
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const CACHE = 'https://aviationweather.gov/data/cache';
const API = 'https://aviationweather.gov/api/data';
const TFR_SHAPES = 'https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=TFR:V_TFR_LOC&outputFormat=application/json&srsname=EPSG:4326';
const TFR_LIST = 'https://tfr.faa.gov/tfrapi/getTfrList';
/** The G-AIRMET hazards drawn; the freezing-level lines are left out (the winds-aloft card has the freezing level). */
const GAIRMET_HAZARDS = new Set(['IFR', 'MT_OBSC', 'ICE', 'TURB-HI', 'TURB-LO', 'LLWS', 'SFC_WND']);
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

/** Rings of [lon, lat] (rounded) from the API's coordinate lists; null when there's no area. */
const ring = (coords) => {
  const r = (coords ?? []).map((c) => [+Number(c.lon).toFixed(3), +Number(c.lat).toFixed(3)]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  return r.length >= 3 ? r : null;
};

/** US SIGMETs and AIRMETs as given: kind, hazard, altitudes (ft), valid times (epoch s), the text, and the area. */
export function parseAirSigmets(list) {
  return list
    .map((x) => ({
      kind: x.airSigmetType ?? 'SIGMET',
      hazard: x.hazard ?? '',
      severity: x.severity ?? null,
      lo: x.altitudeLow1 ?? null,
      hi: x.altitudeHi1 ?? null,
      from: x.validTimeFrom ?? null,
      to: x.validTimeTo ?? null,
      raw: x.rawAirSigmet ?? '',
      area: ring(x.coords),
    }))
    .filter((x) => x.area);
}

/** G-AIRMET areas valid now: hazard, severity, base and top (hundreds of ft, or SFC / FZL), the freezing levels for icing, and times. */
export function parseGairmets(list) {
  return list
    .filter((x) => GAIRMET_HAZARDS.has(x.hazard) && (x.geometryType ?? x.geom) === 'AREA')
    .map((x) => ({
      hazard: x.hazard,
      severity: x.severity ?? null,
      dueTo: x.due_to ?? null,
      base: x.base ?? null,
      top: x.top ?? null,
      fzlBase: x.fzlbase ?? null,
      fzlTop: x.fzltop ?? null,
      valid: Date.parse(x.validTime) / 1000,
      expires: x.expireTime ?? null,
      product: x.product ?? '',
      area: ring(x.coords),
    }))
    .filter((x) => x.area);
}

/**
 * Pilot reports (not airline position reports) → [time (epoch s), lat, lon, alt ft MSL, aircraft, turbulence, icing, raw, urgent]:
 * turbulence and icing as reported ("MOD", "LGT-MOD"), with their type.
 */
export function parsePireps(csv) {
  const lines = csv.split('\n').filter((l) => l.trim());
  const head = csvFields(lines[0]);
  const at = (name) => head.indexOf(name);
  const col = {
    time: at('observation_time'),
    lat: at('latitude'),
    lon: at('longitude'),
    alt: at('altitude_ft_msl'),
    ac: at('aircraft_ref'),
    tbType: at('turbulence_type'),
    tb: at('turbulence_intensity'),
    icType: at('icing_type'),
    ic: at('icing_intensity'),
    kind: at('report_type'),
    raw: at('raw_text'),
  };
  const out = [];
  for (const line of lines.slice(1)) {
    const f = csvFields(line);
    if (f[col.kind] !== 'PIREP') continue;
    const t = Date.parse(f[col.time]);
    const lat = num(f[col.lat]);
    const lon = num(f[col.lon]);
    if (!Number.isFinite(t) || lat == null || lon == null) continue;
    const raw = (f[col.raw] ?? '').trim();
    out.push([
      Math.round(t / 1000),
      +lat.toFixed(3),
      +lon.toFixed(3),
      num(f[col.alt]),
      f[col.ac] || '',
      [f[col.tb], f[col.tbType]].filter(Boolean).join(' '),
      [f[col.ic], f[col.icType]].filter(Boolean).join(' '),
      raw,
      /\bUUA\b/.test(raw.slice(0, 12)),
    ]);
  }
  return out;
}

/** TFR shapes joined to the list's kind and description, by NOTAM number ("6/4240"). */
export function joinTfrs(shapes, list) {
  const byId = new Map(list.map((t) => [t.notam_id, t]));
  return (shapes.features ?? [])
    .map((f) => {
      const id = String(f.properties?.NOTAM_KEY ?? '').split('-')[0];
      const meta = byId.get(id);
      const geom = f.geometry;
      if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) return null;
      const round = (c) => c.map((p) => (typeof p[0] === 'number' ? [+p[0].toFixed(4), +p[1].toFixed(4)] : round(p)));
      return {
        id,
        kind: meta?.type ?? f.properties?.LEGAL ?? '',
        title: meta?.description ?? f.properties?.TITLE ?? '',
        state: f.properties?.STATE ?? '',
        geometry: { type: geom.type, coordinates: round(geom.coordinates) },
      };
    })
    .filter(Boolean);
}

async function getText(url, gz = false) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return (gz ? gunzipSync(buf) : buf).toString('utf8');
}

const get = (url) => getText(url, true);

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
  // The advisories: each source on its own, so one that's down doesn't take the others with it.
  const settle = async (what, fn) => {
    try {
      return await fn();
    } catch (err) {
      console.error(`${what}: ${err.message ?? err}`);
      return null;
    }
  };
  const [sigmets, gairmets, pireps, tfrs] = await Promise.all([
    settle('SIGMETs', async () => parseAirSigmets(JSON.parse(await getText(`${API}/airsigmet?format=json`)))),
    settle('G-AIRMETs', async () => parseGairmets(JSON.parse(await getText(`${API}/gairmet?format=json`)))),
    settle('PIREPs', async () => parsePireps(await get(`${CACHE}/aircraftreports.cache.csv.gz`))),
    settle('TFRs', async () => joinTfrs(JSON.parse(await getText(TFR_SHAPES)), JSON.parse(await getText(TFR_LIST)))),
  ]);
  const generated = new Date().toISOString();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'metars.json'), JSON.stringify({ generated, metars }));
  writeFileSync(join(dir, 'tafs.json'), JSON.stringify({ generated, tafs }));
  writeFileSync(join(dir, 'advisories.json'), JSON.stringify({ generated, sigmets, gairmets, pireps, tfrs }));
  console.log(
    `${metars.length} METARs, ${Object.keys(tafs).length} TAFs, ${sigmets?.length ?? '–'} SIGMETs, ${gairmets?.length ?? '–'} G-AIRMETs, ${pireps?.length ?? '–'} PIREPs, ${tfrs?.length ?? '–'} TFRs`,
  );
}

// Run when called as a script (tests import the parsers without fetching).
if (process.argv[1]?.endsWith('aviation.mjs')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
