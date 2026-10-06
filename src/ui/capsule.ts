import type { Conditions } from '../data/conditions';
import type { Alert } from '../data/nws';
import type { AppState } from '../state';
import { formatTemp } from '../util/units';
import { $ } from './dom';
import { conditionLine, conditionWord, hiLoLine } from './format';

/**
 * The glass readout for the selected point: "MY LOCATION" when it is you,
 * the place, the temperature, the condition, and Apple's H:/L: line.
 */
export function renderCapsule(c: Conditions | null, s: AppState): void {
  $('#cap-kicker').hidden = !s.gps;
  $('#cap-gps').hidden = !s.gps;
  const place = $('#cap-place');
  const temp = $('#cap-temp');
  const cond = $('#cap-cond');
  const hilo = $('#cap-hilo');
  if (!c) {
    place.textContent = 'Locating';
    temp.textContent = '--°';
    cond.textContent = '';
    hilo.textContent = '';
    return;
  }
  place.textContent = c.place ?? 'Locating';
  temp.textContent = c.tempF != null ? formatTemp(c.tempF, s.tempUnit) : '--°';
  // Liquid shows Apple's short condition; Classic keeps the original wind-inclusive line.
  cond.textContent = c.failed
    ? 'Weather unavailable. Map still works.'
    : s.theme === 'classic'
      ? conditionLine(c, s.windUnit)
      : conditionWord(c);
  hilo.textContent = hiLoLine(c, s);
  $('#capsule').setAttribute(
    'aria-label',
    `${s.gps ? 'My location, ' : ''}${c.place ?? 'Selected point'}, ${temp.textContent}, ${cond.textContent}, ${hilo.textContent}. Open weather details.`,
  );
}

/** The alert pill: the most severe alert's name, plus a count when there are more. */
export function renderAlertPill(alerts: Alert[]): void {
  const pill = $<HTMLButtonElement>('#alert-pill');
  if (!alerts.length) {
    pill.hidden = true;
    return;
  }
  const more = alerts.length > 1 ? ` +${alerts.length - 1}` : '';
  $('#alert-pill-text').textContent = `${alerts[0].event}${more}`;
  pill.setAttribute('aria-label', `${alerts.length} active alert${alerts.length > 1 ? 's' : ''}: ${alerts[0].event}. Open details.`);
  pill.hidden = false;
}
