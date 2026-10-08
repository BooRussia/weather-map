import { siteCall, type RadarSite, type SiteProduct } from '../data/radarSites';
import { $, h, svg } from './dom';
import { closeIcon } from './icons';
import { segmented } from './layersMenu';

export interface SiteBarHooks {
  product(p: SiteProduct): void;
  close(): void;
}

/**
 * While one radar is chosen: a row at the top of the timeline card with the
 * tower ("KMOB · Mobile"), Reflectivity / Velocity, and a way back to all radars.
 */
export function renderSiteBar(site: RadarSite | null, product: SiteProduct, hooks: SiteBarHooks): void {
  const el = $('#site-bar');
  el.hidden = !site;
  if (!site) {
    el.replaceChildren();
    return;
  }
  const close = h('button', { type: 'button', class: 'sheet-close site-close', 'aria-label': 'Back to all radars' }, svg(closeIcon));
  close.addEventListener('click', () => hooks.close());
  const products = segmented<SiteProduct>(
    'Radar product',
    [
      { value: 'N0B', label: 'Reflectivity' },
      { value: 'N0S', label: 'Velocity' },
    ],
    product,
    (p) => hooks.product(p),
  );
  products.classList.add('seg-compact');
  el.replaceChildren(h('span', { class: 'site-name' }, h('b', {}, siteCall(site)), ` ${site.name}`), products, close);
}
