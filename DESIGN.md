# Design

Locked. Every surface reads this file. Do not restyle per screen.

## Color
- background: #000000
- foreground: #f0f0fa
- muted: #8a8a96
- hairline: #2a2a2a
- accent: #f5a623
- accent-on: #000000

Neutrals only besides `accent`. No second chromatic color. `#000` and `#fff` are allowed.

- `accent` fills the active NWS alert tag and nothing else. Not links, not focus rings, not lightning, not data, not icons.
- HUD control surface: `background` at 0.85 opacity (`rgba(0,0,0,0.85)`).
- Status remap: errors, loading, offline, and "no storms in view" all use `muted` text. Only an active alert uses `accent`.
- Data layers are neutral by default: wind particles in `foreground`, rain streaks in `foreground`/`muted` at reduced alpha, lightning in `foreground`, radar grayscale, clouds (GOES infrared) grayscale. The dark basemap is desaturated to grayscale at load; the satellite basemap is grayscale and dimmed. Alpha varies with data; hue does not, except under the one exception below.
- Imagery exception (owner-requested, 2026-10-05): Settings → Map → Colors → Color shows imagery in its own colors: the NWS reflectivity scale on radar (blue/green light through yellow, orange, red heavy) and true color on the satellite basemap, dimmed so particles and HUD type stay readable. It applies to those raster layers only, only when the viewer picks it, and the default stays Mono. These are data, not a palette: no UI element may borrow these hues, and NWS orange is never a second accent.

## Type
- text: IBM Plex Sans (self-hosted, weights 300 / 400 / 500). D-DIN Exp is the preferred face if it is ever self-hosted; it would replace Plex everywhere, not alongside it.
- mono: None
- sizes: display 72px (temperature, weight 300) / body 16px (condition line, sheet text, inputs; 16px also stops iOS zooming into focused fields) / meta 11px (place name, labels, attribution; uppercase where used as a label, tracking 0.12em)

One family. Basemap labels come from the tile provider's glyphs; they are map ornament, not UI type. HUD text over the live map may carry a neutral `#000` text-shadow halo for legibility; it is not a decorative effect.

## Radius
- family: all-sharp
- value: 0
- exception: Pill (9999px) on the bottom layer toggle buttons (Wind, Rain, Thunder, Clouds) only; every other radius stays 0, including the alert tag, the gear button, the sheet, inputs, and segmented controls.

The brief calls the alert an "alert pill". It is a sharp tag: the radius lock wins over the word.

## Space
- base: 4px

## Motion
- duration: 160ms (never over 200ms)
- easing: ease-out

No linear. No ease-in. No bounce. No elastic.

- UI motion is allowed only for: sheet open/close, toggle state change, alert tag appearing.
- Wind particles, rain streaks, and lightning are data layers, not UI motion. They may animate continuously. A lightning flash lasts under 400ms.
- `prefers-reduced-motion`: UI transitions drop to none. Data layers keep running because they are the content.

## Surfaces
- HUD text floats on the map with no card behind it.
- Controls are either solid `rgba(0,0,0,0.85)` or a ghost 1px outline on transparent black.
- The sheet is one solid `#000` surface with a `hairline` top edge. Sections are separated by hairlines, never boxed. No nested cards.
- No glass, frost, or backdrop blur. No gradients on chrome. No equal feature grids.

## Components
- Layer toggle (pill, the one radius exception): 64×48, 12px apart; 56×48, 8px apart below 360px wide. Active: `rgba(0,0,0,0.85)` fill, 1px `foreground` outline, filled `foreground` icon. Inactive: transparent black, 1px `muted` outline, outline `muted` icon.
- Alert tag: `accent` fill, `accent-on` text, meta size, uppercase, sharp. Shown only while an NWS alert is active for the selected point.
- Gear: 44×44 square, `rgba(0,0,0,0.85)`, `foreground` icon.
- Attribution strip: meta size or smaller, `muted`, bottom-left. Credits for optional imagery (Esri, NOAA GOES) appear only while that imagery is on screen; the strip may wrap to two lines.
- Selected point: a 1px `foreground` crosshair on the map, no dot, no fill.
