import type { Conditions } from '../data/conditions';
import type { AppState } from '../state';
import { limitWords, sentenceCase } from '../util/text';
import { compass8, formatTemp, formatWind, mphToKmh, type WindUnit } from '../util/units';

const MAX_CONDITION_WORDS = 12;

/** "Partly cloudy · Wind SE 9 mph, gusts 21" — always 12 words or fewer. */
export function conditionLine(
  c: Pick<Conditions, 'condition' | 'windMph' | 'windFromDeg' | 'gustMph'>,
  unit: WindUnit,
): string {
  const parts: string[] = [];
  if (c.condition) parts.push(sentenceCase(c.condition));
  if (c.windMph != null) {
    if (c.windMph < 1) parts.push('Calm');
    else {
      let wind = `Wind ${c.windFromDeg != null ? `${compass8(c.windFromDeg)} ` : ''}${formatWind(c.windMph, unit)}`;
      if (c.gustMph != null && c.gustMph - c.windMph >= 8) {
        const g = unit === 'kmh' ? mphToKmh(c.gustMph) : c.gustMph;
        wind += `, gusts ${Math.round(g)}`;
      }
      parts.push(wind);
    }
  }
  return limitWords(parts.join(' · '), MAX_CONDITION_WORDS);
}

/** Apple's format: "H:87° L:76°" from today's high/low. */
export function hiLoLine(c: Conditions, s: AppState): string {
  const today = c.om?.daily[0];
  if (!today) return '';
  return `H:${formatTemp(today.hiF, s.tempUnit)}  L:${formatTemp(today.loF, s.tempUnit)}`;
}

/** Condition word(s) only, sentence case: "Mostly cloudy". */
export function conditionWord(c: Conditions): string {
  return c.condition ? sentenceCase(c.condition) : '';
}

/** NWS text is hard-wrapped near 70 columns; keep paragraph breaks, drop the rest. */
export function reflow(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((para) => para.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

/** "Wednesday Night" -> "Wed night"; "This Afternoon" -> "This afternoon". */
export function shortPeriodName(name: string): string {
  const m = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)( Night)?$/.exec(name);
  if (m) return m[1].slice(0, 3) + (m[2] ? ' night' : '');
  return sentenceCase(name);
}

/** "8:00 PM" today, "Tue 8:00 PM" otherwise. */
export function timeShort(d: Date): string {
  const today = d.toDateString() === new Date().toDateString();
  return d.toLocaleString(
    undefined,
    today ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' },
  );
}

export function rateText(mmH: number, s: AppState): string {
  return s.tempUnit === 'F' ? `${(mmH / 25.4).toFixed(2)} in/h` : `${mmH.toFixed(1)} mm/h`;
}

export function visibilityText(m: number, s: AppState): string {
  if (s.tempUnit === 'C') return m >= 10_000 ? '10+ km' : `${(m / 1000).toFixed(m < 3000 ? 1 : 0)} km`;
  const mi = m / 1609.344;
  return mi >= 10 ? '10+ mi' : `${mi.toFixed(mi < 3 ? 1 : 0)} mi`;
}

/** mm → "0.42″" or "11 mm". */
export function amountText(mm: number, s: AppState): string {
  if (s.tempUnit === 'C') return `${Math.round(mm)} mm`;
  const inch = mm / 25.4;
  return inch < 0.01 ? '0″' : `${inch < 1 ? inch.toFixed(2).replace(/^0/, '') : inch.toFixed(1)}″`;
}
