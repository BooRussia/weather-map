# Product

## Audience
People who want live wind and rain at a glance, mostly on a phone, mostly in the US. The default place is Dunnellon / Ocala, FL, used whenever geolocation is denied or unavailable.

## Purpose
Open the app and see moving wind and rain over a dark map right away, then read the temperature and conditions for one place. Tap the bottom icons to turn the Wind, Rain, Thunder, and Clouds layers on or off. Tap the map to switch the readout to that spot.

## Constraints
- Single screen. No splash, no onboarding, no accounts, no push notifications. The map is the app.
- Website first. The phone is the priority (portrait, one-handed, thumb reach, safe-area insets); desktop must also work well.
- Layer and data logic stays framework-free so a later native app (Swift or a wrapped port) can reuse or mirror it.
- Layers: Wind, Rain, Thunder, and Clouds (live satellite, added at the owner's request on 2026-10-05). Independent toggles. First load: Wind on, Rain on, Thunder off, Clouds off. Layer state is not persisted, so every cold load starts the same way.
- Map style: Dark (default) or Satellite (aerial imagery). Imagery colors: Mono (default) or Color. Falling rain can be turned off to watch only the radar. These settings are remembered.
- Toggling a layer never moves the map camera.
- HUD: place, temperature, one condition line of 12 words or fewer, and a high/low line (owner-requested from the inspiration screenshots, 2026-10-05). Tapping it opens the detail sheet: alerts, next 2 hours of rain, hourly, 7 days, details.
- Map shows active NWS alert areas (warnings and watches, not marine or minor advisories). The radar can loop the last hour.
- Dark mode only in v1.
- Free data, no API keys: NWS api.weather.gov (place, observations, forecast, alerts, radar), Open-Meteo (wind and precipitation fields, CC BY 4.0), NOAA nowCOAST (GOES clouds), and Esri World Imagery (satellite basemap). Attribution is always on screen.
- Apple Maps (MapKit) belongs in the future native iPhone app, where it is free and built in. On the web it would need a paid Apple Developer account and a map-engine swap.
- Open-Meteo free tier is 10k calls/day, non-commercial. One batched grid request per view, throttled and cached.
- Lightning in v1 is approximate (forecast thunderstorm cells plus random strike timing). The app says so in settings.
- Out of scope: hurricane tracking (no UI, no stubs), light mode, accounts, notifications, onboarding.

## Voice
- Plain and short. Present tense. Sentence case, except the place name, which is uppercase.
- The condition line is 12 words or fewer.
- Numbers first: "72°", "Wind SE 9 mph".
- No exclamation marks, no hype, no "Oops". Errors state what happened and what still works.
- Approximations are labelled as approximate.

## Evidence
- The brief: "open to see live wind + rain on a dark map, tap icons to toggle layers, read temp/conditions."
- The brief names a Windy-style reference and SpaceX-level restraint.
- Follow-up from the owner: build the website first, phone is the priority, port to a native app later.
- The owner likes the monochrome look but wants to switch to radar colors (green to red), turn off the falling rain to read the radar, and see satellite, both aerial and live clouds.
- The owner shared screenshots of MyRadar, (Not Boring) Weather, Apple Weather, and another weather app they like and asked to bring over what fits. Take/skip decisions are logged in `docs/inspiration.md`.
- No user research yet. Unknown: real usage split between phone and desktop; assumed phone-first.
