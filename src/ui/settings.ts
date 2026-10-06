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
      'Lightning is approximate: strikes are placed inside forecast thunderstorm cells at random times, not from a live strike feed.',
    ),
    h('p', { class: 'group-label' }, 'Data'),
    h(
      'p',
      { class: 'pop-note' },
      'Live radar, places, observations, forecasts, and alerts: NWS. Radar history and forecast radar: NEXRAD and HRRR via Iowa Environmental Mesonet. Wind, rain, and point forecasts: Open-Meteo (CC BY 4.0). Search: Photon (OpenStreetMap). Clouds: NOAA GOES via nowCOAST. Satellite imagery: Esri, Vantor, Earthstar Geographics, and the GIS User Community. Map © CARTO © OpenStreetMap contributors.',
    ),
  );
}
