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
