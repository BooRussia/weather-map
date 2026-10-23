import { describe, expect, it } from 'vitest';
import { meshLines } from '../src/map/boundaries';

// Two squares side by side: arc 0 is the edge they share, arcs 1 and 2 the rest of each.
const geometries = [
  { type: 'Polygon', arcs: [[0, 1]] },
  { type: 'Polygon', arcs: [[~0, 2]] },
];

describe('state and county lines', () => {
  it('keeps only the borders two shapes share, once', () => {
    const topo = {
      arcs: [
        [
          [1, 0],
          [1, 1],
        ],
        [
          [1, 1],
          [0, 1],
          [0, 0],
          [1, 0],
        ],
        [
          [1, 0],
          [2, 0],
          [2, 1],
          [1, 1],
        ],
      ] as [number, number][][],
      objects: { states: { geometries } },
    };
    expect(meshLines(topo, 'states').coordinates).toEqual([
      [
        [1, 0],
        [1, 1],
      ],
    ]);
  });

  it('decodes quantized, delta-encoded arcs', () => {
    const topo = {
      transform: { scale: [0.5, 0.5] as [number, number], translate: [10, 20] as [number, number] },
      arcs: [
        [
          [2, 0],
          [0, 2],
        ],
        [[0, 0]],
        [[0, 0]],
      ] as [number, number][][],
      objects: { counties: { geometries } },
    };
    expect(meshLines(topo, 'counties').coordinates).toEqual([
      [
        [11, 20],
        [11, 21],
      ],
    ]);
  });
});
