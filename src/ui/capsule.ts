import type { Conditions } from '../data/conditions';
import { dayOutlook } from '../data/dayDetail';
import type { Alert } from '../data/nws';
import type { AppState } from '../state';
import { formatTemp, formatWind } from '../util/units';
import { $, h, svg } from './dom';
import { conditionLine, conditionWord, hiLoLine } from './format';
import { umbrellaIcon, windIcon } from './icons';

/**
 * The glass readout for the selected point: "MY LOCATION" when it is you,
 * the place, the temperature, the condition, Apple's H:/L: line, and chips for today's highest
 * wind and chance of rain.
 */
export function renderCapsule(c: Conditions | null, s: AppState): void {
  $('#cap-kicker').hidden = !s.gps;
  $('#cap-gps').hidden = !s.gps;
  const place = $('#cap-place');
  const temp = $('#cap-temp');
  const cond = $('#cap-cond');
  const hilo = $('#cap-hilo');
  renderChips(c, s);
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

function renderChips(c: Conditions | null, s: AppState): void {
  const today = c?.om?.daily[0];
  const day = today && c?.om ? dayOutlook(c.om.week, today.date, today.precipProbability) : null;
  $('#cap-chips').hidden = !day;
  if (!day) return;
  const wind = $('#cap-wind');
  wind.replaceChildren(svg(windIcon), h('span', {}, formatWind(day.maxWindMph, s.windUnit)));
  wind.setAttribute(
    'aria-label',
    `Highest wind today ${formatWind(day.maxWindMph, s.windUnit)}, gusts to ${formatWind(day.maxGustMph, s.windUnit)}. Show the wind chart.`,
  );
  wind.title = `Max wind today · gusts to ${formatWind(day.maxGustMph, s.windUnit)}`;
  const rain = $('#cap-rain');
  rain.replaceChildren(svg(umbrellaIcon), h('span', {}, `${Math.round(day.pop)}%`));
  rain.setAttribute('aria-label', `${Math.round(day.pop)}% chance of rain today. Show the rain chart.`);
  rain.title = 'Chance of rain today';
}
