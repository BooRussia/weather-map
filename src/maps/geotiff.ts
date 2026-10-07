/**
 * Just enough GeoTIFF for GeoMet's WCS output: one band of 32-bit floats,
 * uncompressed, in strips, on a longitude/latitude grid placed by a corner
 * tie point and a pixel size. Anything else is rejected rather than misread.
 */
export interface Raster {
  /** Edges of the raster (pixel-is-area): west/north corner and cell size in degrees. */
  west: number;
  north: number;
  dx: number;
  dy: number;
  cols: number;
  rows: number;
  /** Row-major, north row first. */
  values: Float32Array;
}

const TAG = {
  width: 256,
  height: 257,
  bitsPerSample: 258,
  compression: 259,
  stripOffsets: 273,
  samplesPerPixel: 277,
  rowsPerStrip: 278,
  stripByteCounts: 279,
  sampleFormat: 339,
  pixelScale: 33550,
  tiepoint: 33922,
} as const;

export function readGeoTiff(buf: ArrayBuffer): Raster {
  const v = new DataView(buf);
  if (buf.byteLength < 8) throw new Error('not a TIFF');
  const order = String.fromCharCode(v.getUint8(0), v.getUint8(1));
  if (order !== 'II' && order !== 'MM') throw new Error('not a TIFF');
  const le = order === 'II';
  const u16 = (o: number) => v.getUint16(o, le);
  const u32 = (o: number) => v.getUint32(o, le);
  if (u16(2) !== 42) throw new Error('not a classic TIFF');

  const ifd = u32(4);
  const tags = new Map<number, { type: number; count: number; at: number }>();
  for (let i = 0, n = u16(ifd); i < n; i++) {
    const e = ifd + 2 + i * 12;
    tags.set(u16(e), { type: u16(e + 2), count: u32(e + 4), at: e + 8 });
  }
  /** Values of a tag; small ones sit in the entry itself, larger ones at an offset. */
  const read = (tag: number): number[] => {
    const t = tags.get(tag);
    if (!t) return [];
    const size = t.type === 3 ? 2 : t.type === 12 ? 8 : 4;
    const base = t.count * size <= 4 ? t.at : u32(t.at);
    const out: number[] = [];
    for (let i = 0; i < t.count; i++) {
      const o = base + i * size;
      out.push(t.type === 3 ? u16(o) : t.type === 12 ? v.getFloat64(o, le) : u32(o));
    }
    return out;
  };
  const one = (tag: number, fallback: number) => read(tag)[0] ?? fallback;

  const cols = one(TAG.width, 0);
  const rows = one(TAG.height, 0);
  if (one(TAG.compression, 1) !== 1) throw new Error('compressed TIFF');
  if (one(TAG.bitsPerSample, 0) !== 32 || one(TAG.sampleFormat, 1) !== 3 || one(TAG.samplesPerPixel, 1) !== 1) {
    throw new Error('expected one band of float32');
  }
  const scale = read(TAG.pixelScale);
  const tie = read(TAG.tiepoint);
  if (scale.length < 2 || tie.length < 6) throw new Error('no georeference');

  const values = new Float32Array(cols * rows);
  const offsets = read(TAG.stripOffsets);
  const counts = read(TAG.stripByteCounts);
  let k = 0;
  for (let s = 0; s < offsets.length && k < values.length; s++) {
    const n = Math.min(counts[s] / 4, values.length - k);
    for (let i = 0; i < n; i++) values[k++] = v.getFloat32(offsets[s] + i * 4, le);
  }
  // Tie point: raster (i, j) → model (x, y), usually the top-left corner.
  const [i0, j0, , x0, y0] = tie;
  return {
    west: x0 - i0 * scale[0],
    north: y0 + j0 * scale[1],
    dx: scale[0],
    dy: scale[1],
    cols,
    rows,
    values,
  };
}
