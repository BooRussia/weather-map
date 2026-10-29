/** Types for scripts/aviation.mjs (the scheduled airport-weather job), for tests. */
export type MetarRow = [
  id: string,
  lat: number,
  lon: number,
  obs: number,
  category: string,
  raw: string,
  tempC: number | null,
  dewC: number | null,
  windDir: number | null,
  windKt: number | null,
  gustKt: number | null,
  visSM: string | null,
  altimInHg: number | null,
  wx: string,
  sky: string,
  vertVisFt: number | null,
];
export function csvFields(line: string): string[];
export function parseMetars(csv: string, now?: number): MetarRow[];
export function parseTafs(xml: string): Record<string, [issued: number, raw: string]>;
export function stationNames(list: { id?: string; icaoId?: string | null; site?: string; state?: string }[]): Record<string, string>;
export interface AirSigmet {
  kind: string;
  hazard: string;
  severity: number | null;
  lo: number | null;
  hi: number | null;
  from: number | null;
  to: number | null;
  raw: string;
  area: [number, number][];
}
export interface Gairmet {
  hazard: string;
  severity: string | null;
  dueTo: string | null;
  base: string | null;
  top: string | null;
  fzlBase: string | null;
  fzlTop: string | null;
  valid: number;
  expires: number | null;
  product: string;
  area: [number, number][];
}
export type PirepRow = [time: number, lat: number, lon: number, altFt: number | null, aircraft: string, turbulence: string, icing: string, raw: string, urgent: boolean];
export function parseAirSigmets(list: unknown[]): AirSigmet[];
export function parseGairmets(list: unknown[]): Gairmet[];
export function parsePireps(csv: string): PirepRow[];
export function joinTfrs(shapes: unknown, list: { notam_id: string; type?: string; description?: string }[]): { id: string; kind: string; title: string; state: string; geometry: unknown }[];
