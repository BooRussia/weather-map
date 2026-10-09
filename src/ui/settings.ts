import type { Store } from '../state';
import { h } from './dom';
import { segmented, segRow, switchRow } from './layersMenu';

/** Settings: appearance, units, sound, and where the data comes from. */
export function settingsPanel(store: Store): HTMLElement {
  const s = store.get();
  return h(
    'div',
    {},
    h('p', { class: 'group-label' }, 'Appearance'),
    h(
      'div',
      { class: 'group' },
      segRow(
        'Theme',
        segmented('Theme', [{ value: 'liquid', label: 'Liquid' }, { value: 'classic', label: 'Classic' }], s.theme, (v) =>
          store.set({ theme: v }),
        ),
      ),
    ),
    h('p', { class: 'pop-note' }, 'Liquid is glass and color, like Apple’s apps. Classic is the original black-and-amber look.'),
    h('p', { class: 'group-label' }, 'Map'),
    h(
      'div',
      { class: 'group' },
      switchRow({ label: 'Weather follows the map', checked: s.followMap, onChange: (on) => store.set({ followMap: on }) }),
    ),
    h(
      'p',
      { class: 'pop-note' },
      'On: move the map and the weather shows what’s under the center cross. Off: the weather stays on your location (or a place you searched) while you look around.',
    ),
    h('p', { class: 'group-label' }, 'Units'),
    h(
      'div',
      { class: 'group' },
      segRow(
        'Temperature',
        segmented('Temperature', [{ value: 'F', label: '°F' }, { value: 'C', label: '°C' }], s.tempUnit, (v) =>
          store.set({ tempUnit: v }),
        ),
      ),
      segRow(
        'Wind',
        segmented('Wind', [{ value: 'mph', label: 'mph' }, { value: 'kmh', label: 'km/h' }], s.windUnit, (v) =>
          store.set({ windUnit: v }),
        ),
      ),
    ),
    h('p', { class: 'group-label' }, 'Lightning'),
    h('div', { class: 'group' }, switchRow({ label: 'Thunder sound', checked: s.sound, onChange: (on) => store.set({ sound: on }) })),
    h(
      'p',
      { class: 'pop-note' },
      'Lightning is live from the GOES satellites’ lightning mapper, about a minute behind: the glow is where flashes are, and the bolts strike inside it (their exact timing is for show).',
    ),
    h('p', { class: 'group-label' }, 'Data'),
    h(
      'p',
      { class: 'pop-note' },
      'Places, observations, forecasts, and alerts: NWS. Radar: NOAA MRMS (now and the last 2 hours), NEXRAD history and the HRRR forecast via Iowa Environmental Mesonet. Wind: Environment and Climate Change Canada (GeoMet, GDPS model). Falling rain, lightning cells, and point forecasts: Open-Meteo (CC BY 4.0). Search: Photon (OpenStreetMap). Clouds: NOAA GOES via nowCOAST. Weather maps: Environment and Climate Change Canada (GeoMet: GDPS, GDWPS, GIOPS models), NASA GIBS (GOES infrared), and Open-Meteo. Satellite imagery: Esri, Vantor, Earthstar Geographics, and the GIS User Community. Map © CARTO © OpenStreetMap contributors.',
    ),
  );
}
