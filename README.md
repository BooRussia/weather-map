# Weather Map

Live wind and rain over a dark map, phone first. One screen: the map is the app.

- **Wind**: particles that follow the wind direction; speed and brightness scale with wind speed.
- **Rain**: falling streaks, denser where precipitation is heavier and more likely, over the NWS radar. Settings → Map → **Colors → Color** shows the NWS intensity scale (blue/green light, yellow/orange moderate, red heavy). Settings → Rain → **Falling rain → Off** hides the streaks so only the radar shows. These choices are remembered.
- **Thunder**: approximate lightning (see below) with a short procedural crackle; the sound can be turned off in Settings.
- **Clouds**: live GOES weather-satellite imagery (infrared, so it works at night), a few minutes old.
- **Map style**: Settings → Map → Style switches between the dark map and **Satellite** aerial imagery, with place names and state lines kept on top. **Colors: Mono / Color** applies to both the radar and the satellite imagery.
- Tap the map to read conditions for that point. Tap the temperature for the forecast. An amber tag appears only while an NWS alert is active for the selected point.

`PRODUCT.md` is the brief. `DESIGN.md` is the locked visual language; read it before changing any UI.

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
| [NWS radar mosaic](https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity/MapServer) | Radar under the Rain layer (grayscale or color) | U.S. government data, no key. US coverage only. |
| [NOAA nowCOAST](https://nowcoast.noaa.gov/) | Clouds layer: GOES East + West longwave infrared | U.S. government data, no key. Covers the Americas and eastern Pacific. |
| [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) | Satellite map style | Credit: Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community. Fine for personal and non-commercial use; check Esri's terms (or get a free ArcGIS Location Platform key) before a commercial launch. |
| [Open-Meteo](https://open-meteo.com/) | Wind + precipitation grid for the particles; point temperature/hourly fallback; place search | **CC BY 4.0**, attribution required. Free tier: non-commercial, 10,000 calls/day. |
| [CARTO Dark Matter](https://carto.com/basemaps) | Basemap (converted to grayscale at load) | © CARTO © OpenStreetMap contributors. Check CARTO's basemap terms before commercial use. |
| [IBM Plex Sans](https://github.com/IBM/plex) | UI type, self-hosted via `@fontsource` | SIL Open Font License. |

The on-screen attribution strip (bottom-left) credits Open-Meteo, NWS, CARTO, and OpenStreetMap, each linked. Esri and NOAA GOES credits appear while their imagery is showing.

### Staying inside Open-Meteo's free tier

Each grid point counts as one call. The app requests about 40 points per view in **one** batched request and refetches only when the view leaves the padded grid, the zoom changes by 2+ levels, or the data is 15 minutes old. Requests are at least 8 seconds apart (45 seconds when only detail would improve), and the last 6 grids are cached for panning back and forth. A normal session uses a few hundred calls.

### Lightning is approximate

There's no free, keyless live lightning feed. When Thunder is on, strikes are placed inside grid cells where Open-Meteo reports a thunderstorm (WMO codes 95–99), at random times (about one every few seconds per storm cell, capped at 1.2 per second for the view). Settings says this in plain words. If no storm cell is in view, a short note says so.

## Deploy

It's a static site: build, then host `dist/` anywhere.

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
  map/                  MapLibre setup, radar, basemap grayscale
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
