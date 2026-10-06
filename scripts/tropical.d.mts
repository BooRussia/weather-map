/** Types for scripts/tropical.mjs (the scheduled hurricane-data job), for tests. */
export type Point = [tau: number, lat: number, lon: number, vmaxKt: number];
export interface Run {
  init: number;
  pts: Point[];
}
export const GROUPS: Record<string, (string | string[])[]>;
export function parseADeck(text: string): Record<string, Run>;
export function selectModels(latest: Record<string, Run>): { tech: string; group: string; init: number; pts: Point[] }[];
