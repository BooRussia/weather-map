import { fetchJson } from '../util/http';

/**
 * Airport weather (owner, 2026-10-29: pilot features): METARs and TAFs from the NWS Aviation Weather
 * Center, relayed every 10 minutes by a scheduled job (scripts/aviation.mjs), since aviationweather.gov
 * doesn't allow browser requests.
 */
const AVIATION_URL = 'https://raw.githubusercontent.com/BooRussia/weather-map/aviation';
/** The relay runs every 10 minutes; past this it's late and the app says so. */
export const RELAY_LATE_MIN = 30;
/** A METAR this old is out of date: a station reports at least hourly. */
export const METAR_OLD_MIN = 90;

export type FlightCategory = 'VFR' | 'MVFR' | 'IFR' | 'LIFR' | '';

export interface Metar {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** When it was observed, epoch ms. */
  obs: number;
  category: FlightCategory;
  raw: string;
  tempC: number | null;
  dewC: number | null;
  windDir: number | null;
  windKt: number | null;
  gustKt: number | null;
  /** Statute miles, as reported ("10+", "1/2"). */
  visSM: string | null;
  altimInHg: number | null;
  wx: string;
  /** Cloud layers as METAR writes them: "SCT027 BKN070". */
  sky: string;
  vertVisFt: number | null;
}

export interface Metars {
  /** When the relay last ran, epoch ms. */
  generated: number;
  metars: Metar[];
}

export interface Taf {
  issued: number;
  raw: string;
}

type Row = [string, number, number, number, string, string, ...(number | string | null)[]];

/** Cache-busted to the 5-minute window raw.githubusercontent.com caches for. */
const fresh = () => `?t=${Math.floor(Date.now() / 300_000)}`;

export async function getMetars(signal?: AbortSignal): Promise<Metars> {
  const r = await fetchJson<{ generated: string; metars: Row[] }>(`${AVIATION_URL}/metars.json${fresh()}`, { signal, timeoutMs: 20_000 });
  const cats = new Set(['VFR', 'MVFR', 'IFR', 'LIFR']);
  return {
    generated: Date.parse(r.generated),
    metars: r.metars.map((m) => ({
      id: m[0],
      lat: m[1],
      lon: m[2],
      obs: m[3] * 1000,
      category: (cats.has(m[4]) ? m[4] : '') as FlightCategory,
      raw: m[5],
      tempC: m[6] as number | null,
      dewC: m[7] as number | null,
      windDir: m[8] as number | null,
      windKt: m[9] as number | null,
      gustKt: m[10] as number | null,
      visSM: m[11] as string | null,
      altimInHg: m[12] as number | null,
      wx: (m[13] as string) ?? '',
      sky: (m[14] as string) ?? '',
      vertVisFt: m[15] as number | null,
      name: (m[16] as string) ?? '',
    })),
  };
}

export async function getTafs(signal?: AbortSignal): Promise<{ generated: number; tafs: Record<string, Taf> }> {
  const r = await fetchJson<{ generated: string; tafs: Record<string, [number, string]> }>(`${AVIATION_URL}/tafs.json${fresh()}`, { signal, timeoutMs: 20_000 });
  const tafs: Record<string, Taf> = {};
  for (const [id, [issued, raw]] of Object.entries(r.tafs)) tafs[id] = { issued: issued * 1000, raw };
  return { generated: Date.parse(r.generated), tafs };
}

/** The FAA's flight-category colors: VFR green, MVFR blue, IFR red, LIFR magenta. */
export const CATEGORY_COLOR: Record<FlightCategory, string> = {
  VFR: '#30d158',
  MVFR: '#0a84ff',
  IFR: '#ff453a',
  LIFR: '#e040fb',
  '': '#8e8e93',
};

export const CATEGORY_WORD: Record<FlightCategory, string> = {
  VFR: 'VFR · visual flight rules',
  MVFR: 'MVFR · marginal VFR',
  IFR: 'IFR · instrument flight rules',
  LIFR: 'LIFR · low IFR',
  '': 'No flight category reported',
};

/** The ceiling: the lowest broken or overcast layer, or the vertical visibility into an obscured sky; null when there's none. */
export function ceilingFt(sky: string, vertVisFt: number | null): number | null {
  for (const layer of sky.split(' ')) {
    const m = /^(BKN|OVC|OVX)(\d{3})$/.exec(layer);
    if (m) return Number(m[2]) * 100;
  }
  return vertVisFt;
}

/** "020° at 7 kt, gusts 15", "Variable at 4 kt", "Calm". METAR reports variable wind with direction 0. */
export function windText(m: Pick<Metar, 'windDir' | 'windKt' | 'gustKt'>): string {
  if (m.windKt == null) return 'Not reported';
  if (m.windKt === 0) return 'Calm';
  const dir = m.windDir ? `${String(m.windDir).padStart(3, '0')}°` : 'Variable';
  return `${dir} at ${m.windKt} kt${m.gustKt ? `, gusts ${m.gustKt}` : ''}`;
}

/** A TAF a line per change group, the way pilots read it: before each FM, TEMPO, BECMG, and PROB. */
export function tafLines(raw: string): string[] {
  return raw
    .replace(/\s+(?=(FM\d{6}|TEMPO|BECMG|PROB\d{2})\b)/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** "18:49Z" */
export const zulu = (ms: number) => `${new Date(ms).toISOString().slice(11, 16)}Z`;

/** "14 min ago", "2 h 5 min ago" */
export function ago(ms: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - ms) / 60_000));
  if (min < 60) return `${min} min ago`;
  return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''} ago`;
}
