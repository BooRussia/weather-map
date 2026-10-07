# Design

Locked. Every surface reads this file. Do not restyle per screen.

On 2026-10-05 the owner asked for an Apple-like redesign (liquid glass, Apple's system colors, rounded corners, spring motion, live weather backgrounds) and then chose to keep the original black-and-amber language as a second theme. There are two themes over one layout:

- **Liquid** (default): everything in the sections below.
- **Classic**: the original language, defined under "Classic theme" at the end. Same layout and components; only the tokens change.

Liquid intentionally allows glass, several semantic colors, one rounded radius family, and motion longer than 200ms; those are owner decisions, not drift. Anything not written here is still out. Settings → Appearance switches themes; the choice is remembered.

## Color
- background: #000000 (behind the map and the weather page while they load)
- foreground: #ffffff (primary label)
- muted: rgba(235, 235, 245, 0.62) (secondary label)
- hairline: rgba(255, 255, 255, 0.14) (separators inside glass)
- accent: #0a84ff (system blue: your location, selected state, links)
- accent-on: #ffffff

Semantic colors (Apple dark-mode system palette), each with one job:
- `cyan` #64d2ff: precipitation (chance %, next-hours bars, rain icons' drops)
- `yellow` #ffd60a: sun, lightning bolt, warning icon
- `orange` #ff9f0a: NWS alert areas on the map and the alert pill's icon; severe trip hazards
- Hurricanes use hazard-data colors (the same exception as radar): the Saffir–Simpson scale for intensity (TD #5ebaff, TS #00faf4, 1 #ffffcc, 2 #ffe775, 3 #ffc140, 4 #ff8f20, 5 #ff6060); NHC watch/warning colors on the coast (hurricane warning red, watch pink, tropical-storm warning blue, watch yellow); one color per model group (official white and boldest, consensus yellow, hurricane models coral, global cyan, ensemble means purple, statistical gray, ensemble members faint white); outlook areas yellow / orange / red by odds; wind field yellow (34 kt) / orange (50 kt) / red (64 kt); wind-speed odds a light-to-deep ramp from 5% up; sea temperature in NASA's own palette at 55% opacity.
- Trip hazards reuse these: orange for severe, yellow for caution, cyan dots for light rain; the route line is the accent.
- Temperature ramp for range bars only: ≤32° #5e5cf0, 45° #0a84ff, 55° #64d2ff, 65° #30d158, 75° #ffd60a, 85° #ff9f0a, ≥95° #ff453a.
- UV ramp for the UV bar only: green → yellow → orange → red → purple.
- Radar is drawn smooth, like TV-weather radar: reflectivity is decoded from IEM tiles, blurred at screen resolution, and recolored. Color: nothing below light rain (~11 dBZ), translucent greens, then yellow (~40 dBZ), orange, red (~52), magenta. Mono: white at rising opacity. The legend shows the Color ramp.

- Weather maps (added at the owner's request, 2026-10-06, after Windy's): one colored variable at a time under borders, radar, wind, and labels, the same imagery exception as radar. Each has its own ramp: wind and gusts calm blue → teal → green → yellow → orange → red → magenta → near-white; temperature lavender (cold) → blue → teal → green → yellow → orange → red → deep red; rain the radar's greens to magenta, nothing below a trace; clouds and fog white at rising opacity; humidity brown → green → blue; pressure purple → blue → green → yellow → red; waves and swell like wind; sea temperature blue → green → yellow at 80 °F → red; air quality the EPA's AQI colors; snow pale blue → blue → violet; infrared satellite clear where warm, gray to white cloud, then blue, cyan, green, yellow, red, magenta for the coldest tops. Drawn smooth (a cubic spline over the data, faded where data runs out), about 85% opaque.

No other hues. Weather-page skies use the gradients listed under Materials; they are backgrounds, not UI color.

## Type
- text: SF Pro on Apple devices (the browser's system font there), Inter Variable with optical sizing everywhere else (self-hosted). Stack: `-apple-system, BlinkMacSystemFont, "Inter Variable", sans-serif`. Named here on purpose; it is not an unchosen default.
- mono: None
- sizes: hero 96px weight 200 (weather-page temperature) / display 64px weight 200 (map capsule temperature) / title 20px weight 500 / body 17px / callout 15px / footnote 13px / caption 12px uppercase weight 600, tracking 0.04em (card headers, like Apple's "HOURLY FORECAST")

Crisp and soft: antialiased, `optimizeLegibility`, tight negative tracking on large numbers (−0.03em), proportional figures on hero numbers, tabular figures where numbers stack in columns. Text on glass is white or `muted`; never gray on a colored fill.

## Radius
- family: all-soft
- value: 22 (cards, sheets, popovers, the search field and the timeline card)
- exception: Fully round on circular controls only: icon buttons, the location dot, switch knobs, and the scrubber handle.

Controls inside a card that need a smaller curve (segmented controls, list rows) use 12, the inner radius of a 22 card with 10px padding. That follows from the family; it is not a second one.

## Space
- base: 4px

## Motion
- duration: 200ms for state changes (switches, hover, pressed); 420ms for sheets and the weather page.
- easing: `cubic-bezier(0.32, 0.72, 0, 1)` (Apple's sheet curve) for sheets and the page; `ease-out` for everything else. No bounce, no elastic, no overshoot.
- Live layers (wind, rain, lightning, radar timeline) and weather-page skies animate continuously: they are content. Wind is short comets, like Windy's: each particle a straight streak along the wind, about 0.2 s of travel (4–20 px, so stronger wind draws longer), tapering from a round, brighter, 1.6 px head to a fine transparent tail, 35–80% white by speed; each fades in over 0.4 s and out over 0.6 s, so nothing pops. Timeline playback glides through 15-minute radar frames at one hour per second, crossfading each frame into the next (constant combined coverage, so nothing pulses) and never advancing onto a frame that hasn't loaded. On open it autoplays a short loop (−1 h to +1 h at half speed, a 1.2 s hold on the last frame) until the timeline is touched; reduced motion skips it.
- The location dot's halo pulses (2s, ease-out): it is the one decorative loop, and it says "this is live".
- `prefers-reduced-motion`: UI transitions drop to none, skies hold a still frame, the halo stops. Map data layers keep running.

## Materials
- Glass (liquid): `backdrop-filter: blur(24px) saturate(180%)` over the live map, fill `rgba(30, 30, 34, 0.42)`, a 1px border that is brighter at the top (`rgba(255,255,255,0.28)` fading to `0.06`), an inner top highlight, and a soft shadow (`0 10px 30px rgba(0,0,0,0.35)`). Thick glass (sheets, popovers): fill `0.62`.
- Glass sits only on chrome that floats over the map or the sky: search, capsule, controls, timeline card, popovers, sheets, weather-page cards. Never glass on glass: a card inside a glass sheet is a plain inset group.
- Weather-page skies (top → bottom): clear day `#2c7be5 → #6cb8f0`, clear night `#070b1f → #1d2a4a`, cloudy day `#5f6f84 → #9aa9bb`, cloudy night `#151c28 → #2b3545`, rain `#323f50 → #5a6a7d`, storm `#141a24 → #34404f`, snow `#7f8b99 → #c3ccd6`, fog `#8a9098 → #bcc2c8`. Effects drawn over them: sun glow, stars, drifting clouds, rain streaks, snow, fog bands, lightning flashes.

## Surfaces
- The map is full-bleed. Floating chrome is glass.
- The weather page (opened from the capsule) is Apple Weather's main screen: a live sky for the current weather behind a scrolling column of glass cards. Full screen on phones; a docked right column (400px) at 1100px and wider.
- The live sky is a fragment shader (2D fallback without WebGL 2): procedural clouds lit from the sun's side (scattered puffs when mostly clear, half the sky when partly cloudy with blue between, a textured blanket when overcast), the sun on its real arc from sunrise (low left) to sunset (low right) with a small disc and soft glow, golden-hour warmth near either end, civil twilight, stars and the moon in its current phase at night, three depths of rain streaks, snow in three depths with drift, low rolling fog, and storms whose lightning lights the clouds from inside with an occasional bolt. Scene changes ease over about a second; it renders at CSS resolution, ~30 fps, and holds still for reduced motion.
- No nested cards. Inside a card, separate with hairlines and space.

## Components
- Search field: glass pill-shaped field (radius 22), magnifier, placeholder "Search city or address", results in a glass popover beneath it.
- Weather capsule: glass card, top-left under search: place (with a small location arrow when it is your GPS location), temperature (display), condition, `H:87° L:76°`. Tapping opens the weather page.
- Alert pill: glass, under the capsule, orange ⚠ + event name. Shown only while an NWS alert is active at the selected point.
- Map controls: one glass column, top-right: layers, locate, trip weather, and the hurricane tracker, separated by hairlines. Locate is filled blue while the map follows you; the hurricane mark is orange while hurricanes are on. Turning hurricanes on there opens the storm panel (or says none are active); tapping again hides them.
- Location dot: 16px `accent` circle, 3px white ring, soft shadow, pulsing halo.
- Center reticle: thin white cross with a gap and a soft shadow, at the map's visual center whenever the selected point is "wherever the map is centered". Dragging shows it; the readout updates when the map settles. Hidden while "Weather follows the map" is off.
- Layers drawer (like Windy's menu): thick glass, on the right from the top to the bottom safe area (360px, narrower on phones so the map shows at the left), sliding in with the sheet curve, a "Map layers" title and a round close button. Inside: "On the map" first — switches for Radar, Wind, Lightning, Clouds, Hurricanes (with its options), Alert areas. Then "Weather map": a three-column grid of thumbnails (None first), each a small procedural preview drawn with that map's own ramp over a dark sea-and-land ground, inner radius, the chosen one ringed in the accent with its label in the accent (Classic: white); picking one on a phone closes the drawer. Then "Map and radar": map style (Satellite / Dark), radar colors (Color / Mono), Falling rain. Then the Settings row.
- Map legend: while a weather map is on, a row at the bottom of the timeline card under a hairline: the map's name with its value at the selected point (footnote, value semibold), then the unit and an 8px color bar with tick values in the user's units.
- Trip weather: thick glass panel. Phones: bottom panel over the timeline (max 64% height) that folds into a one-line summary under the search bar; wide screens: a 380px column on the left under the search bar. Inside: From / To fields in a group with suggestions inline, a Now / Later segmented control (Later: a date-time field), "Each day" (Nonstop / 8 h / 10 h / 12 h) and "Mornings" (7 / 8 / 9 AM, hidden for Nonstop) as compact segmented controls, one accent button; then the route line ("Ocala → Atlanta", time, distance, arrival), a verdict card, hazard cards (icon tile in the level color, title, where and when, detail and source), dimmed cards for hazards on the route but not while you pass, and the stops list (time with the zone on a small second line when it differs from the device's, level dot, place wrapping to two lines, flags, glyph, temperature, chance of rain), one list per day under "Day 2 · Wed, Oct 7" headings on multi-day drives. A night row has a faint fill, a moon in place of the dot, a "Night 1" caption, the town, evening → morning weather, and when you leave. Nights on the map are dark dots ringed in white. On the map: the route in the accent over a dark casing, stops as dots in their level color, ends larger with an accent ring.
- Storm pill: like the alert pill, under the readout, a hurricane mark in orange and "Nine · Depression" or "2 tropical systems". Storm panel (the sheet): a storm picker when there are several, the category with its color dot, a 2×2 of max wind / pressure / moving / center, the advisory line with links, NHC's forecast rows (time, category dot, stage, wind), an intensity chart (wind over days with Saffir–Simpson lines, one line per model, official boldest), model-group switches with a color swatch and the aids in each, NHC's graphics as a sideways strip of thumbnails with captions (each opens full size; missing ones drop out), and "Show on map". Satellite sits under the advisory line: a Color / Infrared segmented control, the square image in an inner-radius frame, and a dark pill "Play loop · about 8 MB" at its top left (the loop downloads only on request). In the layers menu, Hurricanes' row has a chevron that opens its options inline, indented to the row's label, with nested options (ensemble members) one step further; wide controls (wind odds) sit under their label. On the map: the storm's disc in its category color under a white hurricane symbol and its name.
- Timeline card: glass, bottom: round play button, time ("Now", "Tue 3:15 PM") with kind ("Live radar", "Radar · −3 h", "Forecast radar · +2 h 15 min", "Loading radar" while waiting on the network; with the radar off it names what the timeline moves instead: the weather map, "Temperature · +2 h", or "Wind"), radar legend in Color mode, a scrubber with a white round handle that glides during playback and snaps to 15-minute frames when dragged, observed hours bright and forecast hours dim, scale labels.
- Weather-page cards (glass, radius 22, 16px padding, caption headers with a small icon): alert, next 2 hours (cyan bars), hourly (horizontal strip, sunrise/sunset cells), 7 days (temperature-ramp range bars with a white "now" dot), then a two-column grid of detail tiles: feels like, UV (ramp bar), wind (compass), humidity, sunset/sunrise (arc), visibility, pressure (gauge), precipitation.
- Settings sheet: thick glass, iOS grouped rows.
- Credits: footnote text, `muted`, bottom-left under the timeline card.

## Classic theme

The original language (2026-10-05 v1), kept as a theme. Same layout and components as Liquid; these tokens replace Liquid's.

- Color: background #000000, foreground #f0f0fa, muted #8a8a96, hairline #2a2a2a, accent #f5a623 (an active NWS alert only: the alert pill and alert areas on the map), accent-on #000000. No other hues: the location dot is white with a black ring, weather glyphs are `foreground` line icons, precipitation and temperature bars are `foreground`, the radar legend and Color radar remain the documented imagery exception.
- Type: IBM Plex Sans (self-hosted, 300/400/500). Sizes: display 72px weight 300 / body 16px / meta 11px uppercase, tracking 0.12em.
- Radius: all-sharp, 0. Exception: the location dot and the scrubber handle are round (a dot is a dot).
- Materials: no blur. Floating chrome is solid `rgba(0,0,0,0.85)` with a `hairline` border; sheets and the weather page are solid `#000`.
- Motion: 160ms `ease-out` for everything, including sheets and the page. The location halo does not pulse.
- Weather-page sky: the same sky in dim grays (no color), so effects read in white.
