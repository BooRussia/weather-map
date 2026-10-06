# Product

## Audience
People who want live wind, rain, and radar at a glance, mostly on a phone (often an iPhone), mostly in the US. The default place is Dunnellon / Ocala, FL, used whenever geolocation is denied or unavailable.

## Purpose
Open the app and see the weather moving over a satellite map right away. Your location is a blue dot. Drag the map and the readout follows whatever is under the center cross; tap the locate button to snap back to you. Search any city or street address. Tap the readout to open a full weather page whose live background matches the weather there.

## Constraints
- Single screen with one full-screen page on top of it. No splash, no onboarding, no accounts, no push notifications. The map is the app.
- Website first. The phone is the priority (portrait, one-handed, safe-area insets); desktop must also work well.
- Look and feel: two themes over one layout (owner, 2026-10-05). **Liquid** (default) is close to Apple's own apps: liquid glass, SF Pro on Apple devices, system colors, live skies. **Classic** keeps the original black-and-amber style. Settings → Appearance switches; the choice is remembered. `DESIGN.md` is the source of truth.
- Layer and data logic stays framework-free so a later native app (Swift or a wrapped port) can reuse or mirror it.
- Selected point: either "you" (GPS, blue dot, locate button filled) or "the map center" (after any drag, tap, or search; the center cross shows). The readout reloads when the map settles, not on every frame.
- Search: cities and street addresses, suggestions as you type, nearby results first.
- Layers live in one popover: Radar, Wind, Lightning, Clouds, Alert areas, Falling rain, map style, radar colors. First load: Satellite map, Color radar, Radar and Wind on, falling rain off. Layer switches reset each visit; map style, colors, units, and sound are remembered.
- Timeline: one play bar scrubs or plays radar from 24 hours ago, through now, into the HRRR forecast (as far as the latest run reaches, about 15–18 hours). Wind and falling-rain particles follow the same hour.
- Weather page: alerts, next 2 hours of rain, hourly, 7 days, and detail tiles (feels like, UV, wind, humidity, sun, visibility, pressure, precipitation) over a live sky that matches current conditions and time of day.
- Desktop (1100px and wider): the weather page docks on the right. Keyboard: Space plays/pauses, ←/→ step an hour, Home returns to now, `/` focuses search.
- Map shows active NWS alert areas (warnings and watches, not marine or minor advisories).
- Dark mode only.
- Free data, no API keys: NWS api.weather.gov (place, observations, forecast, alerts, live radar), Iowa Environmental Mesonet (archived NEXRAD and HRRR forecast radar), Open-Meteo (wind and precipitation fields, point forecast; CC BY 4.0), Photon by Komoot (search and place names; OpenStreetMap data), NOAA nowCOAST (GOES clouds), Esri World Imagery (satellite basemap). Attribution is always on screen.
- Apple Maps (MapKit) belongs in the future native iPhone app, where it is free and built in. On the web it would need a paid Apple Developer account and a map-engine swap.
- Open-Meteo free tier is 10k calls/day, non-commercial. One batched grid request per view, throttled and cached.
- Lightning is approximate (forecast thunderstorm cells plus random strike timing). The app says so in settings.
- Out of scope: hurricane tracking (no UI, no stubs), light mode, accounts, notifications, onboarding.

## Voice
- Plain and short. Present tense. Sentence case. Apple-style card headers in caps ("HOURLY FORECAST").
- The condition line is 12 words or fewer.
- Numbers first: "72°", "H:87° L:76°", "Wind SE 9 mph".
- No exclamation marks, no hype, no "Oops". Errors state what happened and what still works.
- Approximations are labelled as approximate.

## Evidence
- The brief: "open to see live wind + rain on a dark map, tap icons to toggle layers, read temp/conditions."
- Follow-up from the owner: build the website first, phone is the priority, port to a native app later.
- The owner wants radar colors (green to red), the falling rain off by default, and satellite (aerial and live clouds).
- The owner shared screenshots of MyRadar, (Not Boring) Weather, Apple Weather, and another app; take/skip decisions are in `docs/inspiration.md`.
- 2026-10-05: the owner disliked the black-and-amber style and asked for a redesign close to Apple's UI: liquid glass, a weather-matching background behind the menu, a blue location dot, a clear GPS button, a center icon that picks the point while dragging, a city/address search bar, and more expensive, crisp, soft typography.
- No user research yet. Unknown: real usage split between phone and desktop; assumed phone-first.
