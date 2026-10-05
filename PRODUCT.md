# Product

## Audience
People who want live wind and rain at a glance, mostly on a phone, mostly in the US. The default place is Dunnellon / Ocala, FL, used whenever geolocation is denied or unavailable.

## Purpose
Open the app and see moving wind and rain over a dark map right away, then read the temperature and conditions for one place. Tap the bottom icons to turn the Wind, Rain, and Thunder layers on or off. Tap the map to switch the readout to that spot.

## Constraints
- Single screen. No splash, no onboarding, no accounts, no push notifications. The map is the app.
- Website first. The phone is the priority (portrait, one-handed, thumb reach, safe-area insets); desktop must also work well.
- Layer and data logic stays framework-free so a later native app (Swift or a wrapped port) can reuse or mirror it.
- v1 layers: Wind, Rain, Thunder only. Independent toggles. First load: Wind on, Rain on, Thunder off. Layer state is not persisted, so every cold load starts the same way.
- Toggling a layer never moves the map camera.
- Dark mode only in v1.
- Free data, no API keys: NWS api.weather.gov (place, observations, forecast, alerts, radar) and Open-Meteo (wind and precipitation fields, CC BY 4.0). Attribution is always on screen.
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
- No user research yet. Unknown: real usage split between phone and desktop; assumed phone-first.
