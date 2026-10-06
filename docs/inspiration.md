# Inspiration log

Screenshots the owner shared on 2026-10-05, what each app does, and what this project takes or leaves. This is a one-time reference. `DESIGN.md` stays the source of truth: anything taken is rebuilt in our tokens (black, `foreground`, `muted`, hairlines, one amber accent, sharp corners, IBM Plex Sans), never copied as-is.

## MyRadar (radar-first map)

What it does:
- A compact summary panel on top (temperature gauge, high/low with times, rain chance, next two days), then a full-bleed map.
- Satellite basemap, color radar, **NWS warning polygons outlined on the map**, lightning bolt icons, wind particles over everything, a blue dot for you.
- Bottom media bar: layer name, **radar timestamp, play/pause loop, color legend bar**.
- Busy icon toolbar and ads.

Take:
- **Alert areas on the map.** Warnings outlined, watches tinted. Drawn in our one accent (amber already means "active NWS alert").
- **Radar loop → timeline.** First built as a one-hour loop; the owner then asked for past *and* future, so it became a play bar from 24 hours ago into the HRRR forecast (Windy-style), with particles following the same hour.
- **Radar legend.** A thin intensity bar, shown only in Color mode.

Skip:
- Rainbow gauge, colored high/low chips: a second palette.
- Toolbar of eight icons and ads: noise.

## (Not Boring) Weather

What it does:
- A huge 3D temperature, one condition word, a dark **alert pill with a ⚠ icon**.
- An eight-day row of icon + high/low, a scrubber ("scrub to play today's weather"), **rain for the next hour** as a small chart.
- A detail sheet laid out like a **spec sheet: `LABEL ......... value` rows** with leader lines, a week line chart, a Day/Week toggle.

Take:
- **Spec-sheet detail rows** with hairline leader lines. It is the most "SpaceX" idea in the set.
- **⚠ icon** in the alert tag.
- **Next-hour rain chart.**

Skip:
- 3D numbers, iridescent shaders, coach-mark overlays ("Swipe for…"): spectacle, banned by `DESIGN.md`.
- Decorative raindrops over the UI: our rain is a data layer on the map.

## Apple Weather

What it does:
- Big thin temperature, condition, then **`H:78° L:72°`** right under it.
- An alert card ("Flood Watch… until 20:00", National Weather Service).
- **"Rain for the next hour"** minute bars.
- An **hourly strip with sunset dropped in as its own cell**.
- A **10-day list with temperature range bars** and a dot for the current temperature.
- Widget cards: wind compass, moon, sunset curve, UV bar, feels like, averages, precipitation, visibility, humidity + dew point, pressure gauge.
- A Conditions screen: hourly temperature chart with H/L markers, a chance-of-precipitation chart.

Take:
- **High/low line** in the HUD.
- **Alert row** in the detail sheet with its end time, linking to the full text.
- **Next 2 hours rain**, with a plain sentence ("Heavy rain stopping in about 45 min").
- **Hourly strip** with sunrise/sunset cells.
- **7-day range bars** with a "now" tick on today.
- The widget **facts** (feels like, humidity, dew point, wind, gusts, pressure, visibility, UV, sunrise/sunset), shown as one spec-sheet list, not a card grid.

Skip:
- Frosted glass cards: banned.
- Equal widget grid: banned (equal cards).
- Colored temperature and UV gradients: second palette.
- Animated sky background, news.

## "Areal Flood" app (blue card)

What it does:
- A saturated blue hero card, an alert chip, a humidity / wind / UV trio, "Heavy Rain Expected" minute bars, hourly line + precipitation area chart, daily line chart, an upsell.

Take:
- The **intensity word** in the next-hour sentence ("Heavy rain expected").

Skip:
- Saturated card, chip trio as separate cards, line charts for daily highs (range bars read faster), upsell.

## Decisions → where they live

| Idea | From | Where |
| --- | --- | --- |
| H/L line under the condition | Apple | HUD |
| GPS arrow before the place name; chevron hinting the sheet | Not Boring, MyRadar | HUD |
| ⚠ icon in the alert tag | Not Boring | top-right tag |
| Alert row with end time | Apple | detail sheet |
| Next 2 hours rain: sentence + 15-min bars | Apple, Not Boring, Areal Flood | detail sheet |
| Hourly strip with sunrise/sunset cells | Apple | detail sheet |
| 7-day range bars with now tick | Apple | detail sheet |
| Spec-sheet rows with leader lines | Not Boring + Apple's facts | detail sheet |
| Alert areas (warnings outlined, watches tinted) | MyRadar | map, amber |
| Radar timeline (−24 h → HRRR forecast) with frame time | MyRadar, Windy | above the layer buttons |
| Radar color legend | MyRadar | in the timeline row, Color mode only |

## Redesign (2026-10-05): Liquid and Classic themes

The owner then asked for Apple's look outright and chose to keep the original style as a second theme. Several items skipped above are now taken, in the **Liquid** theme only:

| Previously skipped | Now |
| --- | --- |
| Frosted / liquid glass | Floating chrome and weather-page cards are glass |
| Animated sky background | The weather page has a live sky for the current weather and time of day |
| Equal widget grid | Two-column detail tiles (feels like, UV, wind compass, humidity, sun arc, visibility, pressure gauge, precipitation) |
| Colored temperature / UV gradients | Temperature-ramp range bars and a UV ramp |
| SF Symbols-style multicolor icons | Yellow sun, white clouds, cyan drops, yellow bolt |

Also new in both themes: a city/address search bar, a blue location dot with a locate button, and a center cross that picks the point while you drag. **Classic** keeps the original tokens (black, white, one amber accent, sharp corners, IBM Plex, no blur) over the same layout.
