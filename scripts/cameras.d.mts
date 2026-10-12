/** Types for scripts/cameras.mjs (imported by the tests). */
export interface Site511 {
  id: string;
  host: string;
  name: string;
  agency: string;
  refresh: number;
}
export const SITES_511: Site511[];
export function placeName(label: string): string;
export function roadLine(roadway: string, direction: string): string;
export function labels(title: string, sub: string): [string, string];
