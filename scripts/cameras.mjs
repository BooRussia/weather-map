#!/usr/bin/env node
/**
 * Traffic cameras for the app, built on a schedule (GitHub Actions): the state
 * DOTs' camera lists don't allow browser (CORS) requests, and they change
 * slowly, so this collects them once a day into one compact file. The images
 * and streams themselves are always live: the app loads them straight from
 * each DOT.
 *
 *   511 sites (one platform, many states): /List/GetData/Cameras, 100 a page
 *   Caltrans: one JSON per district (cwwp2.dot.ca.gov)
 *
 * Live video is kept only where the DOT serves it openly (HLS any site may
 * play: Caltrans, Nevada, Wisconsin, Louisiana). Florida, Georgia, and
 * Pennsylvania lock theirs to their own sites (a token and their page as the
 * referrer); there the app shows the DOT's snapshot and links to its site.
 *
 * Usage: node scripts/cameras.mjs out/cameras.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const UA = 'weather-map traffic cameras (https://github.com/BooRussia/weather-map)';
const PAGE = 100;

/** 511 sites: host, short name, agency, how often the DOT refreshes a snapshot (s). */
export const SITES_511 = [
  { id: 'fl', host: 'fl511.com', name: 'FL511', agency: 'Florida DOT', refresh: 60 },
  { id: 'ga', host: '511ga.org', name: '511GA', agency: 'Georgia DOT', refresh: 60 },
  { id: 'la', host: '511la.org', name: '511LA', agency: 'Louisiana DOTD', refresh: 10 },
  { id: 'az', host: 'az511.gov', name: 'AZ511', agency: 'Arizona DOT', refresh: 30 },
  { id: 'ut', host: 'udottraffic.utah.gov', name: 'UDOT Traffic', agency: 'Utah DOT', refresh: 60 },
  { id: 'nv', host: 'nvroads.com', name: 'NVRoads', agency: 'Nevada DOT', refresh: 30 },
  { id: 'wi', host: '511wi.gov', name: '511WI', agency: 'Wisconsin DOT', refresh: 10 },
  { id: 'pa', host: 'www.511pa.com', name: '511PA', agency: 'PennDOT', refresh: 60 },
  { id: 'ct', host: 'ctroads.org', name: 'CTroads', agency: 'Connecticut DOT', refresh: 30 },
  { id: 'ne', host: 'newengland511.org', name: 'New England 511', agency: 'Maine, New Hampshire, and Vermont DOTs', refresh: 10 },
  { id: 'id', host: '511.idaho.gov', name: 'Idaho 511', agency: 'Idaho Transportation Department', refresh: 60 },
  { id: 'ak', host: '511.alaska.gov', name: 'Alaska 511', agency: 'Alaska DOT&PF', refresh: 30 },
];
const CALTRANS_DISTRICTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Stream hosts that want a per-viewer token (their own sites fetch it), whatever the camera's flag says. */
const TOKEN_HOSTS = /(divas\.cloud|arcadis-ivds\.com)/i;

async function getJson(url, headers = {}, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.json();
    } catch (e) {
      if (i + 1 >= tries) throw e;
      await sleep(2000 * (i + 1));
    }
  }
}

const round = (v) => Math.round(v * 1e5) / 1e5;
const tidy = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * A camera's place from a DOT's own label: their codes left off ("ALPH-0050: ", Florida's
 * "0517N_75_", Connecticut's "CAM 147 "), underscores as spaces, "@" as "at", a trailing mile
 * marker spelled out ("M052" → "MM 52").
 */
export function placeName(label) {
  let s = tidy(String(label ?? '').replace(/_/g, ' '));
  s = s.replace(/^[A-Z]{2,6}-?\d{1,5}[A-Z]?\s*:\s*/, ''); // "ALPH-0050: "
  s = s.replace(/^\d{3,5}[NSEW] \d+[A-Z]? (?=\S)/, ''); // "0517N 75 "
  s = s.replace(/^CAM \d+ /i, ''); // "CAM 147 "
  s = s.replace(/\s*@\s*/g, ' at ').replace(/\bM0*(\d+)$/, 'MM $1');
  return tidy(s);
}

/** "I-75 · Northbound": the road and the way the camera faces, when the DOT says. */
export function roadLine(roadway, direction) {
  const dir = tidy(direction);
  const parts = [placeName(roadway), dir && !/^(unknown|none|n\/a|all directions)$/i.test(dir) ? dir : ''].filter(Boolean);
  return parts.join(' · ');
}

/** A title and the line under it, without saying the same thing twice. */
export function labels(title, sub) {
  if (sub === title) return [title, ''];
  // "I-10" over "I-10 at Terrace Ave.": the longer one is the title.
  if (sub.startsWith(title) && sub.length > title.length + 3 && !sub.slice(title.length).startsWith(' · ')) return [sub, ''];
  return [title, sub];
}

/** One 511 site's cameras: [lat, lon, source, title, subtitle, views]; a view is [imageId, video URL or 0]. */
async function from511(site, sourceIndex) {
  const out = [];
  for (let start = 0; ; start += PAGE) {
    const query = JSON.stringify({
      columns: [{ data: null, name: '' }, { name: 'sortOrder', s: true }],
      order: [{ column: 1, dir: 'asc' }],
      start,
      length: PAGE,
      search: { value: '' },
    });
    const url = `https://${site.host}/List/GetData/Cameras?${new URLSearchParams({ query, lang: 'en-US' })}`;
    const page = await getJson(url, { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' });
    const rows = page.data ?? [];
    for (const c of rows) {
      const m = /POINT \((-?[\d.]+) (-?[\d.]+)\)/.exec(c.latLng?.geography?.wellKnownText ?? '');
      if (!m) continue;
      const views = (c.images ?? [])
        .filter((i) => !i.disabled && !i.blocked && i.imageUrl)
        .map((i) => {
          const id = (/\/map\/Cctv\/(\d+)/.exec(i.imageUrl) ?? [])[1];
          const open = i.videoUrl && !i.isVideoAuthRequired && !i.videoDisabled && /mpegurl/i.test(i.videoType ?? '') && !TOKEN_HOSTS.test(i.videoUrl);
          return id ? [Number(id), open ? i.videoUrl : 0] : null;
        })
        .filter(Boolean);
      if (!views.length) continue;
      const [title, sub] = labels(placeName(c.location || c.images?.[0]?.description) || placeName(c.roadway) || 'Traffic camera', roadLine(c.roadway, c.direction));
      out.push([round(Number(m[2])), round(Number(m[1])), sourceIndex, title, sub, views]);
    }
    // Some sites send short pages mid-list: go by the total they report, not the page's length.
    if (!rows.length || start + PAGE >= (page.recordsTotal ?? 0)) break;
    await sleep(150);
  }
  return out;
}

/** California, district by district: each camera's current image and (most) a live stream. */
async function fromCaltrans(sourceIndex) {
  const out = [];
  for (const d of CALTRANS_DISTRICTS) {
    const dd = String(d).padStart(2, '0');
    let json;
    try {
      json = await getJson(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${dd}.json`);
    } catch (e) {
      console.warn(`Caltrans district ${d}: ${e.message}`);
      continue;
    }
    for (const { cctv: c } of json.data ?? []) {
      if (!c || c.inService !== 'true') continue;
      const lat = Number(c.location?.latitude);
      const lon = Number(c.location?.longitude);
      const img = c.imageData?.static?.currentImageURL;
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !img) continue;
      const video = /^https:.*\.m3u8$/.test(c.imageData?.streamingVideoURL ?? '') ? c.imageData.streamingVideoURL : 0;
      // "I-110 : (196) Avenue 26 Off Ramp" → "Avenue 26 Off Ramp"
      const label = tidy(c.location?.locationName).replace(/^.*?:\s*(\(\d+\)\s*)?/, '') || tidy(c.location?.locationName);
      const sub = [roadLine(c.location?.route, c.location?.direction), tidy(c.location?.nearbyPlace)].filter(Boolean).join(' · ');
      out.push([round(lat), round(lon), sourceIndex, label, sub, [[img, video]]]);
    }
  }
  return out;
}

async function main() {
  const file = process.argv[2] ?? 'out/cameras.json';
  const sources = [];
  const cams = [];
  for (const site of SITES_511) {
    const i = sources.length;
    sources.push({ id: site.id, name: site.name, agency: site.agency, site: `https://${site.host}/`, img: `https://${site.host}/map/Cctv/{id}`, refresh: site.refresh });
    try {
      const got = await from511(site, i);
      cams.push(...got);
      console.log(`${site.name}: ${got.length} cameras, ${got.filter((c) => c[5].some((v) => v[1])).length} with open video`);
    } catch (e) {
      console.warn(`${site.name}: ${e.message}`);
    }
  }
  const ca = sources.length;
  sources.push({ id: 'ca', name: 'Caltrans', agency: 'California DOT', site: 'https://quickmap.dot.ca.gov/', img: '{id}', refresh: 120 });
  const got = await fromCaltrans(ca);
  cams.push(...got);
  console.log(`Caltrans: ${got.length} cameras, ${got.filter((c) => c[5].some((v) => v[1])).length} with open video`);

  // Drop sources that came back empty (the app never lists them).
  const used = new Set(cams.map((c) => c[2]));
  const keep = sources.map((s, i) => (used.has(i) ? i : -1)).filter((i) => i >= 0);
  const remap = new Map(keep.map((old, i) => [old, i]));
  const out = { generated: new Date().toISOString(), sources: keep.map((i) => sources[i]), cams: cams.map((c) => [c[0], c[1], remap.get(c[2]), c[3], c[4], c[5]]) };
  if (out.cams.length < 1000) throw new Error(`only ${out.cams.length} cameras: not publishing`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out));
  console.log(`${out.cams.length} cameras from ${out.sources.length} sources → ${file}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
