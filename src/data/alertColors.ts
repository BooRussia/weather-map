/**
 * NWS hazard colors (weather.gov's map legend), keyed by VTEC phenomenon and
 * significance ("TO.W" = tornado warning). The standard everyone reads
 * alerts by, so a red outline means tornado warning at a glance.
 */
const COLORS: Record<string, string> = {
  'TO.W': '#ff0000',
  'SV.W': '#ffa500',
  'EW.W': '#ff8c00',
  'FF.W': '#8b0000',
  'FA.W': '#00ff00',
  'FL.W': '#00ff00',
  'HU.W': '#dc143c',
  'TR.W': '#b22222',
  'SS.W': '#b524f7',
  'TY.W': '#dc143c',
  'WS.W': '#ff69b4',
  'BZ.W': '#ff4500',
  'IS.W': '#8b008b',
  'LE.W': '#008b8b',
  'EH.W': '#c71585',
  'XH.W': '#c71585',
  'HT.W': '#c71585',
  'HW.W': '#daa520',
  'FW.W': '#ff1493',
  'DS.W': '#ffe4c4',
  'EC.W': '#0000ff',
  'WC.W': '#b0c4de',
  'TO.A': '#ffff00',
  'SV.A': '#db7093',
  'FF.A': '#2e8b57',
  'FA.A': '#2e8b57',
  'FL.A': '#2e8b57',
  'HU.A': '#ff00ff',
  'TR.A': '#f08080',
  'SS.A': '#db7ff7',
  'TY.A': '#ff00ff',
  'WS.A': '#4682b4',
  'BZ.A': '#adff2f',
  'EH.A': '#800000',
  'XH.A': '#800000',
  'HW.A': '#b8860b',
  'FW.A': '#ffdead',
};

const FALLBACK = { W: '#ff9f0a', A: '#b4b4be' };

export function alertColor(phenom: string, sig: string): string {
  return COLORS[`${phenom}.${sig}`] ?? (sig === 'W' ? FALLBACK.W : FALLBACK.A);
}

/** The same table as a MapLibre expression over features with `phenom` and `sig`. */
export function alertColorExpression(): unknown[] {
  const cases: unknown[] = [];
  for (const [key, color] of Object.entries(COLORS)) cases.push(key, color);
  return ['match', ['concat', ['get', 'phenom'], '.', ['get', 'sig']], ...cases, ['case', ['==', ['get', 'sig'], 'W'], FALLBACK.W, FALLBACK.A]];
}
