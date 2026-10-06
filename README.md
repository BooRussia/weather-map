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
- **Layers** popover: map style (Satellite / Dark); Radar, Wind, Lightning (approximate, with a crackle you can mute), Clouds (live GOES satellite), Alert areas (warnings outlined, watches tinted); radar Colors (Color / Mono); Falling rain.
- **Radar** is drawn smooth, like TV-weather radar: each tile's colors are decoded back to reflectivity on the GPU, blurred at screen resolution (smooth shapes instead of square data cells), and recolored (translucent greens for light rain, then yellow, orange, red), leaving out the faint "clear air" returns.
- **Wind** is short, faint dashes that drift with the wind, brighter where it's stronger.
- **Timeline** (bottom): scrub or play radar from **24 hours ago, through now, into the forecast** (HRRR simulated radar, as far as the latest run reaches, about 15–18 hours), in **15-minute frames**. Playback glides at one hour per second: each frame crossfades into the next, 8 frames load ahead, and it waits ("Loading radar") rather than skip a frame that hasn't arrived. Past frames are archived NEXRAD radar, now is the newest NEXRAD composite (about 2–3 minutes old), future frames are the model. Wind and falling-rain particles follow the same hour. On a keyboard: Space plays/pauses, ← → step an hour, Home returns to now.
- **Opens on** the Satellite map with Color radar, Radar and Wind on, falling rain off, and the radar **looping from an hour ago to an hour ahead** (half speed) until you pause, play, or scrub. Skipped if your device is set to reduce motion.

### Weather page
Apple Weather's main screen for the selected point: a live sky that matches the current weather and time of day (clear, cloudy, rain, storm, snow, fog; day or night) behind glass cards. It shows alerts (tap to expand), the next 2 hours of rain in plain words with 15-minute bars, an hourly strip with sunrise/sunset, 7 days with temperature-colored range bars, and tiles for feels like, UV, wind (compass), humidity, sunrise/sunset, visibility, pressure (gauge), and precipitation. On phones it slides up full screen (swipe down or ✕ to close); at 1100px and wider it stays docked on the right.

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
| [NWS warnings map service](https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer) | Alert areas (warnings and watches; marine and advisories filtered out) | U.S. government data, no key. |
| [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/ogc/) | All radar: newest and archived NEXRAD composite (now and the past 24 h), HRRR simulated radar (forecast) | Free, no key; NEXRAD and HRRR are NOAA data. CONUS coverage. Tiles come from four IEM hostnames for parallel loading, a zoom level coarser than the screen (smoothing hides it), so a frame is a few tiles. |
| [Photon by Komoot](https://photon.komoot.io/) | Search (cities and addresses) and place names outside NWS coverage | Free, no key, fair use; OpenStreetMap data (© OpenStreetMap contributors). |
| [NOAA nowCOAST](https://nowcoast.noaa.gov/) | Clouds layer: GOES East + West longwave infrared | U.S. government data, no key. Covers the Americas and eastern Pacific. |
| [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) | Satellite map style | Credit: Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community. Fine for personal and non-commercial use; check Esri's terms (or get a free ArcGIS Location Platform key) before a commercial launch. |
| [Open-Meteo](https://open-meteo.com/) | Wind + precipitation grid for the particles; hourly, 7-day, next-2-hours, and details for the weather page; temperature fallback | **CC BY 4.0**, attribution required. Free tier: non-commercial, 10,000 calls/day. |
| [CARTO Dark Matter](https://carto.com/basemaps) | Basemap (converted to grayscale at load) | © CARTO © OpenStreetMap contributors. Check CARTO's basemap terms before commercial use. |
| [Inter](https://rsms.me/inter/) | Liquid theme type on non-Apple devices (Apple devices use their system SF Pro), self-hosted via `@fontsource-variable` | SIL Open Font License. |
| [IBM Plex Sans](https://github.com/IBM/plex) | Classic theme type, self-hosted via `@fontsource` | SIL Open Font License. |

The on-screen attribution strip (bottom-left) credits Open-Meteo, NWS, CARTO, and OpenStreetMap, each linked. Esri and NOAA GOES credits appear while their imagery is showing.

### Staying inside Open-Meteo's free tier

Each grid point counts as one call. The app requests about 40 points per view in **one** batched request and refetches only when the view leaves the padded grid, the zoom changes by 2+ levels, or the data is 15 minutes old. Requests are at least 8 seconds apart (45 seconds when only detail would improve), and the last 6 grids are cached for panning back and forth. A normal session uses a few hundred calls.

### Lightning is approximate

There's no free, keyless live lightning feed. When Thunder is on, strikes are placed inside grid cells where Open-Meteo reports a thunderstorm (WMO codes 95–99), at random times (about one every few seconds per storm cell, capped at 1.2 per second for the view). Settings says this in plain words. If no storm cell is in view, a short note says so.

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
  data/                 NWS, Open-Meteo, grid fetching, geolocation (framework-free)
  field/grid.ts         Open-Meteo lattice + bilinear sampling
  layers/               wind / rain / thunder particle layers on canvas
  map/                  MapLibre setup, smoothed radar (WebGL layer + palette), basemap grayscale
  audio/crackle.ts      procedural thunder sound (Web Audio)
  ui/                   HUD, sheet, panels, icons
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
- Hurricane tracking is deliberately absent in v1.
