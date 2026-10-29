import type { HourDetail, PointForecast } from './openmeteo';

/**
 * The day in a sentence or two (owner via the Fire TV session, 2026-10-29: "mostly sunny high of 83
 * with a slight chance of rain after 1pm and a clear overnight"): today's sky and high, when rain is
 * likely or that none is expected, then tonight. From 5 PM it leads with tonight and tomorrow. Parts
 * already past are left out. About 70–110 characters.
 */

/** From this hour (local) the briefing turns to tonight and tomorrow. */
const EVENING = 17;
/** A chance of rain this low isn't worth a mention. */
const MENTION = 20;

/** "slight chance" under 30%, "chance" to 60%, "likely" above. */
export function chanceWord(pct: number): 'slight chance' | 'chance' | 'likely' {
  return pct > 60 ? 'likely' : pct >= 30 ? 'chance' : 'slight chance';
}

/** "1 PM" */
const hourName = (time: string) => {
  const h = Number(time.slice(11, 13));
  return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
};

/** The sky over some hours, by their average cloud cover. */
function skyWord(hours: HourDetail[], day: boolean): string {
  const c = hours.reduce((s, x) => s + x.cloudCover, 0) / Math.max(1, hours.length);
  if (c < 20) return day ? 'sunny' : 'clear';
  if (c < 45) return day ? 'mostly sunny' : 'mostly clear';
  if (c < 70) return 'partly cloudy';
  if (c < 90) return 'mostly cloudy';
  return 'cloudy';
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Storms when the code says thunder (95+), else rain, or snow when it's snowing. */
const wetWord = (hours: HourDetail[]) =>
  hours.some((x) => x.weatherCode >= 95) ? 'storms' : hours.some((x) => (x.weatherCode >= 71 && x.weatherCode <= 77) || x.weatherCode === 85 || x.weatherCode === 86) ? 'snow' : 'rain';

/** When rain is worth a mention in these hours: its word and chance, and the first hour it is; null when it isn't. */
function rainIn(hours: HourDetail[]): { what: string; chance: number; from: HourDetail } | null {
  const first = hours.find((x) => x.precipProbability >= MENTION);
  if (!first) return null;
  const wet = hours.filter((x) => x.precipProbability >= MENTION);
  return { what: wetWord(wet), chance: Math.max(...wet.map((x) => x.precipProbability)), from: first };
}

/** "this morning", "this afternoon", "this evening", "overnight" for an hour of today. */
function partOfDay(time: string): string {
  const h = Number(time.slice(11, 13));
  if (h < 12) return 'this morning';
  if (h < 17) return 'this afternoon';
  if (h < 21) return 'this evening';
  return 'overnight';
}

export function briefing(om: PointForecast, temp: (f: number) => string): string {
  const now = om.current.time;
  const hour = Number(now.slice(11, 13));
  const today = om.daily[0];
  const tomorrow = om.daily[1];
  const at = (date: string, from: number, to: number) => om.week.filter((x) => x.time.slice(0, 10) === date && Number(x.time.slice(11, 13)) >= from && Number(x.time.slice(11, 13)) < to);
  const ahead = (xs: HourDetail[]) => xs.filter((x) => x.time.slice(0, 13) >= now.slice(0, 13));
  // Tonight: from 6 PM (or now) to 6 AM tomorrow.
  const night = ahead([...at(today.date, 18, 24), ...(tomorrow ? at(tomorrow.date, 0, 6) : [])]);
  const nightSky = skyWord(night.length ? night : at(today.date, 21, 24), false);
  const nightRain = rainIn(night);
  const low = tomorrow ? temp(tomorrow.loF) : temp(today.loF);
  const nightText = nightRain && nightRain.chance >= 30 ? `${nightRain.what} ${nightRain.chance > 60 ? 'likely' : 'possible'} tonight` : `${nightSky} tonight`;

  if (hour >= EVENING) {
    // Evening: tonight, then tomorrow.
    const tmr = tomorrow ? at(tomorrow.date, 7, 20) : [];
    const tRain = rainIn(tmr);
    const tSky = skyWord(tmr, true);
    const tomorrowText = tomorrow
      ? tRain
        ? `Tomorrow ${tSky}, high of ${temp(tomorrow.hiF)}, ${tRain.chance > 60 ? `${tRain.what} likely` : `${chanceWord(tRain.chance)} of ${tRain.what}`} after ${hourName(tRain.from.time)}.`
        : `Tomorrow ${tSky} and dry, high of ${temp(tomorrow.hiF)}.`
      : '';
    return `${cap(nightText)}, low of ${low}. ${tomorrowText}`.trim();
  }

  // Daytime: the rest of today, then tonight.
  const rest = ahead(at(today.date, 0, 18));
  const sky = skyWord(rest.filter((x) => x.isDay), true);
  const rain = rainIn(rest);
  const high = temp(today.hiF);
  if (rain && rain.chance > 60) {
    return `${cap(rain.what)} likely ${partOfDay(rain.from.time)}, high of ${high}. ${cap(nightText)}, low of ${low}.`;
  }
  const rainText = rain ? `${cap(chanceWord(rain.chance))} of ${rain.what} after ${hourName(rain.from.time)}` : 'No rain expected';
  return `${cap(sky)}, high of ${high}. ${rainText}, then ${nightText.replace(' tonight', ' overnight')}.`;
}
