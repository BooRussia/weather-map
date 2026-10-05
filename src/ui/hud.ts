import type { Conditions } from '../data/conditions';
import type { Alert } from '../data/nws';
import type { AppState } from '../state';
import { limitWords, sentenceCase } from '../util/text';
import { compass8, formatTemp, formatWind, mphToKmh, type WindUnit } from '../util/units';
import { $ } from './dom';

const MAX_CONDITION_WORDS = 12;

/** "Partly cloudy · Wind SE 9 mph, gusts 21" — always 12 words or fewer. */
export function conditionLine(c: Pick<Conditions, 'condition' | 'windMph' | 'windFromDeg' | 'gustMph'>, unit: WindUnit): string {
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

export function renderHud(c: Conditions | null, s: AppState): void {
  const place = $('#hud-place');
  const temp = $('#hud-temp');
  const cond = $('#hud-cond');
  if (!c) {
    place.textContent = 'Locating';
    temp.textContent = '--°';
    cond.textContent = '';
    return;
  }
  place.textContent = c.place ?? 'Locating';
  temp.textContent = c.tempF != null ? formatTemp(c.tempF, s.tempUnit) : '--°';
  cond.textContent = c.failed ? 'Weather data unavailable. Map still works.' : conditionLine(c, s.windUnit);
  $('#hud-readout').setAttribute(
    'aria-label',
    `${c.place ?? 'Current location'}, ${temp.textContent} ${cond.textContent}. Open forecast.`,
  );
}

/** Amber tag: the top alert's event name, plus a count when there are more. */
export function renderAlertTag(alerts: Alert[]): void {
  const tag = $<HTMLButtonElement>('#alert-tag');
  if (!alerts.length) {
    tag.hidden = true;
    tag.textContent = '';
    return;
  }
  const more = alerts.length > 1 ? ` +${alerts.length - 1}` : '';
  tag.textContent = `${alerts[0].event}${more}`;
  tag.setAttribute('aria-label', `${alerts.length} active alert${alerts.length > 1 ? 's' : ''}: ${alerts[0].event}. Open details.`);
  tag.hidden = false;
}
