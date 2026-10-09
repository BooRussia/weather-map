/** Grid size over the Web Mercator world (about 17 km cells at 30°N). */
export const COVERAGE_SIZE = 2048;
/** Inside this distance of a radar its picture is trusted, km; past the outer one it isn't at all. */
const FULL_KM = 230;
const NONE_KM = 300;

const latToY = (lat: number) => 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI);
const yToLat = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

/**
 * Where the radars reach. Past a few hundred kilometers a radar's beam is
 * kilometers up and overshoots the rain, so "no echo" there means "can't
 * see", not "dry". This grid is 255 within FULL_KM of any radar, fading to 0
 * by NONE_KM; the radar layer fills the rest with satellite rain.
 */
export class RadarCoverage {
  readonly grid = new Uint8Array(COVERAGE_SIZE * COVERAGE_SIZE);
  /** Bumped on every change (the GPU copy re-uploads). */
  version = 0;
  private known = false;
  private openCache = new Map<string, boolean>();

  /** Until the radar list arrives nothing counts as uncovered, so the satellite never paints over a dry radar. */
  get ready(): boolean {
    return this.known;
  }

  setSites(sites: readonly { lon: number; lat: number }[]): void {
    const N = COVERAGE_SIZE;
    this.grid.fill(0);
    for (const s of sites) {
      const kmPerCell = (40075.016686 * Math.cos((s.lat * Math.PI) / 180)) / N;
      const reach = Math.ceil(NONE_KM / kmPerCell) + 1;
      const ci = Math.floor(((s.lon + 180) / 360) * N);
      const cj = Math.floor(latToY(s.lat) * N);
      const cosLat = Math.cos((s.lat * Math.PI) / 180);
      for (let j = Math.max(0, cj - reach); j <= Math.min(N - 1, cj + reach); j++) {
        const lat = yToLat((j + 0.5) / N);
        const dy = (lat - s.lat) * 110.57;
        for (let i = ci - reach; i <= ci + reach; i++) {
          const ii = ((i % N) + N) % N;
          const lon = ((i + 0.5) / N) * 360 - 180;
          const dx = (lon - s.lon) * 111.32 * cosLat;
          const d = Math.hypot(dx, dy);
          if (d >= NONE_KM) continue;
          const t = Math.min(1, (NONE_KM - d) / (NONE_KM - FULL_KM));
          const v = Math.round(255 * t * t * (3 - 2 * t));
          const k = j * N + ii;
          if (v > this.grid[k]) this.grid[k] = v;
        }
      }
    }
    this.known = sites.length > 0;
    this.openCache.clear();
    this.version++;
  }

  /** Whether any of tile z/x/y lies beyond full radar coverage (so it may need satellite rain). */
  open(z: number, x: number, y: number): boolean {
    if (!this.known) return false;
    const key = `${z}/${x}/${y}`;
    const hit = this.openCache.get(key);
    if (hit != null) return hit;
    const N = COVERAGE_SIZE;
    const span = N / 2 ** z;
    const i0 = Math.floor(x * span);
    const j0 = Math.floor(y * span);
    const i1 = Math.min(N - 1, Math.ceil((x + 1) * span) - 1);
    const j1 = Math.min(N - 1, Math.ceil((y + 1) * span) - 1);
    let open = false;
    for (let j = j0; j <= j1 && !open; j++) {
      for (let i = i0; i <= i1; i++) {
        if (this.grid[j * N + i] < 250) {
          open = true;
          break;
        }
      }
    }
    if (this.openCache.size > 4000) this.openCache.clear();
    this.openCache.set(key, open);
    return open;
  }
}
