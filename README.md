# Weather Map

Live radar, wind, and forecasts over a satellite map, phone first. One screen: the map is the app.

**Live:** https://boorussia.github.io/weather-map/

### Two themes
- **Liquid** (default): close to Apple's own apps. Liquid-glass controls, SF Pro on iPhone/Mac (Inter elsewhere), system colors, and a weather page with a live sky.
- **Classic**: the original black-and-amber look, sharp corners, IBM Plex.

Switch under Layers → Units, sound & appearance → Theme. The choice is remembered. Both themes share one layout; `DESIGN.md` defines both.

### On the map
- **Search** (top): cities and street addresses, suggestions as you type, nearby results first. Press `/` on a keyboard to jump to it.
- **You** are the blue dot. The **locate button** (top right, under Layers) snaps the map back to you and fills in blue while it follows you.
- **Drag, tap, or search** and the readout switches to whatever is under the **center cross**; it reloads when the map settles. Prefer it to stay put? Turn off **Weather follows the map** (Layers → Units, sound & appearance): moving the map then leaves the weather on your location, or on the last place you searched.
- **Readout** (glass card): place ("My location" when it's you), temperature, condition, `H:87° L:76°`. Tap it for the weather page.
- **Alert pill**: appears under the readout while an NWS alert is active there; tap for the full text.
- **Alerts** (top-right controls): a count of the warnings and watches in view; tap for the list by type (most dangerous first), each alert's zones and full NWS text, and "Show on map". Alert areas on the map use the NWS hazard colors.
- **Single-site radar**: tap a NEXRAD tower (dots with call signs from zoom 6.5, while Radar is on) to see that radar's own scans at full resolution, the past 24 hours and now, with **Reflectivity / Velocity** in a bar on the timeline card and a dashed ring at the radar's range. Velocity: green toward the radar, red away. The forecast part of the timeline stays HRRR (reflectivity only). Close returns to the composite.
- **Storm tracks** (Layers, on by default): strong storm cells from the radars' storm tracking with where they're headed (half an hour, or an hour with 15-minute ticks for storms with hail or rotation), colored by threat: red tornado signature, orange rotation, green large hail. Tap for motion, strongest echo, top, hail, rotation. Option: storm reports from the past 24 hours.
- **Storm outlook** (Layers): SPC severe-storm or WPC flash-flood outlook areas for today, tomorrow, or day 3, labeled by risk.
- **Shareable view**: the address bar keeps the map position (`#map=zoom/lat/lon`); reloads and links open there.
- **Layers** drawer (on the right, like Windy's menu): switches for Radar, Wind, Lightning (live from the GOES lightning mapper, with a crackle you can mute), Clouds (live GOES satellite), Hurricanes, Alert areas (warnings outlined, watches tinted); the **weather map**, picked from thumbnails; map style (Satellite / Dark), radar colors (Color / Mono), Falling rain.
- **Weather maps**, one at a time, drawn smooth under the radar and wind: wind, gusts, temperature, feels like, rain, rain total (next 24 h), thunderstorms (CAPE), clouds, low clouds, humidity, dew point, pressure, fog/visibility, waves, swell, currents, sea temperature, air quality, snow depth, new snow, and infrared satellite. They follow the timeline (past hours from earlier model runs) and crossfade between hours; a legend under the timeline shows the scale and the value at your point. Model maps come from Environment Canada's global model (15 km) through GeoMet as raw values, decoded from GeoTIFF in the browser and colored on the GPU; infrared is NASA GIBS GOES imagery decoded back to cloud-top temperature; the rest are Open-Meteo points.
- **Radar** is drawn smooth, like TV-weather radar: each tile's colors are decoded back to reflectivity on the GPU, blurred at screen resolution (smooth shapes instead of square data cells), and recolored (translucent greens for light rain, then yellow, orange, red), leaving out the faint "clear air" returns.
- **Hurricanes** (layer switch, on by default): while storms are active, a pill under the readout opens the storm panel (wind, pressure, movement, GOES satellite of the storm in color or infrared with a loop, NHC's forecast, an intensity chart of the models, a switch per model group, and NHC's graphics: key messages, cone, wind field, wind odds, arrival times, WPC rainfall). The chevron on the Hurricanes switch lists what it shows, each with its own switch: cone, track, spaghetti and ensemble members, past track, warnings, wind field, wind-speed odds (39+ / 58+ / 74+ mph), arrival of storm winds, storm surge, development outlook, and sea temperature. On the map: NHC's official cone, track and forecast points (colored by category), coastal watches and warnings, past track, the seven-day outlook areas with their odds, and the spaghetti: official, consensus, hurricane models (HWRF, HMON, HAFS-A/B, COAMPS-TC), global models (GFS, UKMET, Canadian, NAVGEM, ECMWF when public), ensemble means, statistical/trajectory models, and the 31 GFS ensemble members. Tap a storm to open it.
- **Wind** is short comets, like Windy's: each a tapered streak along the wind (longer and brighter where it's stronger) that fades in and out instead of popping. The wind comes from Environment Canada's global model (15 km, GeoMet), blended between hours as the timeline plays.
- **Hurricane tracker** (top-right controls): turns hurricanes on and opens the storm panel, or off again.
- **Map only** (last of the top-right controls, or F): hides every control so you can just look at the map, fullscreen where the browser allows (not iPhone Safari). The corner button that brings the controls back fades away until you touch the screen or move the mouse; Escape works too.
- **Timeline** (bottom): scrub or play radar from **24 hours ago, through now, into the forecast** (HRRR simulated radar, as far as the latest run reaches, about 15–18 hours), in **15-minute frames**. Playback glides at one hour per second: each frame crossfades into the next, 8 frames load ahead, and it waits ("Loading radar") rather than skip a frame that hasn't arrived. Past frames are archived NEXRAD radar, now is the newest NEXRAD composite (about 2–3 minutes old), future frames are the model. Wind and falling-rain particles follow the same hour. On a keyboard: Space plays/pauses, ← → step an hour, Home returns to now, F toggles map only.
- **Trip weather** (route button, under locate): enter where you are starting (your location by default) and where you are going, leave now or later, and it checks the drive at the time you will be at each spot: NWS warnings, watches, and advisories the route crosses (and whether they are in effect while you pass), SPC severe-storm and WPC flash-flood outlooks, and the forecast at a stop every 30 minutes of driving (thunderstorms, heavy rain, snow, freezing rain, fog, strong gusts). Tap a stop to fly there and set the radar to that hour (when forecast radar reaches it).
  - **Overnight stops**: choose up to 8, 10, or 12 hours of driving a day (or Nonstop) and when mornings start (7, 8, or 9 AM). The drive is split into balanced days, each night lands where a day ends, and the next morning starts at that hour in the town's own time zone (at least 8 hours later). Each night shows the evening and next-morning forecast, alerts count for the whole stay, and every time reads in local time (marked, e.g. "CDT", when it differs from yours). Drive times are typical speeds with no breaks.
- **Opens on** the Satellite map with Color radar, Radar and Wind on, falling rain off, and the radar **looping from an hour ago to an hour ahead** (half speed) until you pause, play, or scrub. Skipped if your device is set to reduce motion.

### Weather page
Apple Weather's main screen for the selected point: a live sky that matches the current weather and time of day behind glass cards. It's drawn on the GPU: soft clouds lit from the sun's side, the sun moving on its real arc between that day's sunrise and sunset (warm at golden hour), stars and the moon in its actual phase at night, rain at three depths, drifting snow, rolling fog, and lightning that lights the clouds from inside. It shows alerts (tap to expand), the next 2 hours of rain in plain words with 15-minute bars, an hourly strip with sunrise/sunset, 7 days with temperature-colored range bars, and tiles for feels like, UV, wind (compass), humidity, sunrise/sunset, visibility, pressure (gauge), and precipitation. On phones it slides up full screen (swipe down or ✕ to close); at 1100px and wider it stays docked on the right.

Which ideas came from which apps is logged in `docs/inspiration.md`. `PRODUCT.md` is the brief; `DESIGN.md` is the locked visual language; read it before changing any UI.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (vitest)
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ locally
```

Node 20+ is recommended. `npm run dev` binds to your LAN address too (`server.host`), so you can open it on your phone while on the same Wi-Fi to test the real thing.

## Configure: NWS User-Agent (required)

api.weather.gov asks every client to send a `User-Agent` that names the app and a contact (website or email), so NWS can reach you if your traffic causes trouble. Set yours before deploying:

```bash
cp .env.example .env.local
# then edit .env.local:
# VITE_NWS_USER_AGENT="WeatherMap/1.0 (you@yourdomain.com)"
```

How it's sent: every NWS request includes `User-Agent: <your value>`. NWS allows this header in CORS. Firefox honors it; Chrome and Safari don't let page scripts set `User-Agent`, so they send the browser's own string instead. NWS accepts that, but if you want your contact string on every request, put a small proxy in front of `api.weather.gov` (a Netlify/Vercel/Cloudflare function that adds the header) and point `NWS_BASE` in `src/config.ts` at it.

## Data sources and attribution

| Source | Used for | Terms |
| --- | --- | --- |
| [NWS api.weather.gov](https://www.weather.gov/documentation/services-web-api) | Place name (`/points`), latest observation, forecast, active alerts | U.S. government data, no key. **User-Agent required** (above). |
| [NWS warnings map service](https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer) | Alert areas and the alerts list (warnings and watches; marine and advisories filtered out); trip weather (every alert the route crosses, advisories included) | U.S. government data, no key. Each alert's full text comes from api.weather.gov. |
| [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/ogc/) | All radar: newest and archived NEXRAD composite (now and the past 24 h), HRRR simulated radar (forecast) | Free, no key; NEXRAD and HRRR are NOAA data. CONUS coverage. Tiles come from four IEM hostnames for parallel loading, a zoom level coarser than the screen (smoothing hides it), so a frame is a few tiles. |
| [OSRM on FOSSGIS](https://routing.openstreetmap.de/about.html) | Trip weather: driving routes and drive times | Free, no key, fair use (the servers openstreetmap.org uses); OpenStreetMap data. Typical speeds, no live traffic. |
| [NOAA SPC and WPC outlooks](https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer) | Storm outlook layer (categorical days 1–3, excessive rainfall days 1–3). Trip weather: severe-storm outlooks (days 1–3) and excessive-rainfall (flash-flood) outlooks (days 1–3), queried with the route line | U.S. government data, no key. |
| [NHC tropical GIS](https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer) | Hurricanes: official cone, track, forecast points, watches/warnings, past track, wind field, wind-speed odds, arrival times, storm surge, seven-day outlook | U.S. government data, no key. |
| [NHC storm graphics](https://www.nhc.noaa.gov/storm_graphics/) and [NOAA STAR floaters](https://www.star.nesdis.noaa.gov/goes/floater.php) | Storm panel images: NHC's graphics, GOES satellite of the storm | U.S. government data, no key; shown as images and links. |
| [NASA GIBS](https://nasa-gibs.github.io/gibs-api-docs/) (GHRSST MUR; GOES-East/West ABI band 13) | Hurricanes: sea surface temperature. Infrared weather map: band 13 tiles, decoded back to °C with NASA's colormap | NASA open data, no key. Infrared is about half an hour behind real time. |
| [ECCC MSC GeoMet](https://eccc-msc.github.io/open-data/msc-geomet/readme_en/) | Wind for the particles (GDPS 10 m speed and direction → u/v). Weather maps: wind, gusts, temperature, rain, rain total, CAPE, clouds, humidity, dew point, pressure, snow (GDPS 15 km), waves and swell (GDWPS 25 km), sea temperature (GIOPS). One WCS GeoTIFF per frame for the padded view; past hours from the previous runs | Open data, no key, CORS open. Credit: "Data Source: Environment and Climate Change Canada" (shown while a GeoMet map is on). Contact ECCC above ~86,400 requests/day. |
| [NHC storm list](https://www.nhc.noaa.gov/CurrentStorms.json) and [ATCF guidance](https://ftp.nhc.noaa.gov/atcf/aid_public/) | Hurricanes: active storms and the spaghetti models | U.S. government data, no key. Browsers can't fetch these (no CORS), so `.github/workflows/tropical.yml` runs `scripts/tropical.mjs` every 30 minutes and publishes `tropical.json` to the repo's `data` branch, which the app reads from raw.githubusercontent.com. If that's unavailable the app still finds storms from the NHC GIS (without models). For local dev, `node scripts/tropical.mjs public/tropical.dev.json`. |
| [SSEC RealEarth](https://realearth.ssec.wisc.edu/) (NOAA GOES GLM flash extent density) | Live lightning: where flashes are, minute by minute | Free, no key; credit "SSEC RealEarth, UW-Madison" shown while lightning is on. |
| [IEM RIDGE single-site NEXRAD](https://mesonet.agron.iastate.edu/docs/nexrad_mosaic/) (N0B, N0S) and [NEXRAD sites](https://mesonet.agron.iastate.edu/geojson/network/NEXRAD.geojson) | Single-site radar: each tower's super-res reflectivity and storm-relative velocity scans (listed by `json/radar.py`), and the tower list | Free, no key. Reflectivity tiles use the composite's palette (same decoder); velocity's 13 colors are decoded to knots-ordered steps. Stamped scans use IEM's long-cache `/c/` tiles. |
| [IEM NEXRAD storm attributes](https://mesonet.agron.iastate.edu/geojson/nexrad_attr.geojson) and [local storm reports](https://mesonet.agron.iastate.edu/geojson/lsr.geojson?hours=24) | Storm tracks (every radar's latest storm cells: motion, strongest echo, top, hail, rotation, tornado signature) and storm reports | Free, no key; NEXRAD Level III and NWS reports. Cells refresh every 2 minutes while shown, reports every 5. |
| [Photon by Komoot](https://photon.komoot.io/) | Search (cities and addresses) and place names outside NWS coverage | Free, no key, fair use; OpenStreetMap data (© OpenStreetMap contributors). |
| [NOAA nowCOAST](https://nowcoast.noaa.gov/) | Clouds layer: GOES East + West longwave infrared | U.S. government data, no key. Covers the Americas and eastern Pacific. |
| [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) | Satellite map style | Credit: Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community. Fine for personal and non-commercial use; check Esri's terms (or get a free ArcGIS Location Platform key) before a commercial launch. |
| [Open-Meteo](https://open-meteo.com/) | Precipitation and thunderstorm grid for falling rain and lightning (only while those are on), and the particles' wind if GeoMet is down; hourly, 7-day, next-2-hours, and details for the weather page; temperature fallback; weather maps GeoMet lacks (feels like, low clouds, visibility, currents via the marine API, AQI via the air-quality API) | **CC BY 4.0**, attribution required. Free tier: non-commercial, 10,000 calls/day. |
| [CARTO Dark Matter](https://carto.com/basemaps) | Basemap (converted to grayscale at load) | © CARTO © OpenStreetMap contributors. Check CARTO's basemap terms before commercial use. |
| [Inter](https://rsms.me/inter/) | Liquid theme type on non-Apple devices (Apple devices use their system SF Pro), self-hosted via `@fontsource-variable` | SIL Open Font License. |
| [IBM Plex Sans](https://github.com/IBM/plex) | Classic theme type, self-hosted via `@fontsource` | SIL Open Font License. |

The on-screen attribution strip (bottom-left) credits Open-Meteo, NWS, CARTO, and OpenStreetMap, each linked. Esri and NOAA GOES credits appear while their imagery is showing.

### Staying inside Open-Meteo's free tier

Each grid point counts as one call. The app requests about 40 points per view in **one** batched request and refetches only when the view leaves the padded grid, the zoom changes by 2+ levels, or the data is 15 minutes old. Requests are at least 8 seconds apart (45 seconds when only detail would improve), and the last 6 grids are cached for panning back and forth. A normal session uses a few hundred calls.

### Lightning is live

Lightning comes from the GOES satellites' Geostationary Lightning Mapper (flash extent density, a frame every minute, about a minute behind) through SSEC RealEarth's tiles. The tiles are colored; the app reads the colors back into flash locations and strengths, draws a soft glow where lightning is flashing, and sets the animated bolts (and the crackle) inside those flashes, about one every few seconds per active spot, capped at 1.2 per second for the view. It refreshes every minute and when you pan off the fetched area. If the feed is down, bolts fall back to forecast thunderstorm cells from Open-Meteo, and a note says so. If no lightning is in view when you turn it on, a short note says that too.

## Deploy

It's a static site: build, then host `dist/` anywhere.

- **GitHub Pages** (live now): `.github/workflows/pages.yml` tests, builds, and deploys on every push to `master`. It sets `BASE_PATH=/<repo>/` because Pages serves the site from a sub-path, and sets the NWS User-Agent contact to the repo URL. To use your email instead, edit `VITE_NWS_USER_AGENT` in the workflow.
- **Netlify**: `netlify.toml` is included (build `npm run build`, publish `dist`). Add `VITE_NWS_USER_AGENT` under Site settings → Environment variables.
- **Vercel**: import the repo; it detects Vite (build `npm run build`, output `dist`). Add `VITE_NWS_USER_AGENT` in Project → Settings → Environment Variables.

`VITE_` variables are baked in at build time, so redeploy after changing it.

## Install on a phone

The site ships a web app manifest, so it can go on the home screen today: Safari → Share → Add to Home Screen (iOS), or Chrome → Install app (Android). It opens full screen, black, with no browser chrome.

## Project layout

```
src/
  config.ts             defaults, endpoints, fetch budgets
  state.ts              tiny store; units + sound persist, layers do not
  main.ts               wiring: map, data, layers, UI
  data/                 NWS, Open-Meteo, grid fetching, geolocation, routes + trip hazards (framework-free)
  field/grid.ts         Open-Meteo lattice + bilinear sampling
  layers/               wind / rain / thunder particle layers on canvas
  map/                  MapLibre setup, smoothed radar (WebGL layer + palette), trip route, basemap grayscale
  audio/crackle.ts      procedural thunder sound (Web Audio)
  ui/                   HUD, sheet, panels, trip planner, icons
  styles.css            tokens from DESIGN.md
tests/                  vitest unit tests for the pure logic
```

## Taking it native later

Everything under `data/`, `field/`, and `layers/` is plain TypeScript with no framework, written so the logic can move. Three routes, from least to most work:

1. **Home-screen web app (now).** Already works. No App Store listing, no push notifications on older iOS.
2. **Wrap this site with [Capacitor](https://capacitorjs.com/).** Same code inside a native iOS/Android shell; App Store listing in days. Native plugins add push, haptics, and background location when you want them.
3. **Native Swift (SwiftUI + MapKit or MapLibre Native).** Port `data/` and `field/` almost line for line, and redraw the particles with Metal or Core Animation. MapKit gives you Apple Maps, including its satellite and hybrid views, free and built in. Best feel and battery life; needed for widgets, Live Activities, and the Apple Watch. The most work.

Apple Maps on the website (MapKit JS) is possible but needs a paid Apple Developer account ($99/yr) for a MapKit key, and Apple doesn't allow its tiles inside other map libraries, so MapLibre would have to be swapped out. The free Esri imagery covers the satellite look on the web until the native app.

## Known limits (v1)

- Wind and rain fields are model data (Open-Meteo), not observations. Radar is observed, but only in the US. Clouds cover the Americas and eastern Pacific (GOES East + West).
- Outside NWS coverage the place shows as coordinates, with Open-Meteo filling in temperature and conditions. There are no alerts there.
- The map stays north-up (no rotation or tilt). That keeps the particle math cheap on phones.
