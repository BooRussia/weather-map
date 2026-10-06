import type { LatLon } from '../config';
import { fetchJson } from '../util/http';

/** Photon by Komoot: OpenStreetMap geocoder built for search-as-you-type. Free, no key, fair use. */
const PHOTON = 'https://photon.komoot.io';

const US_STATES: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT',
  Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL',
  Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT',
  Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA',
  'Puerto Rico': 'PR', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN',
  Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI',
  Wyoming: 'WY',
};

interface PhotonProps {
  name?: string;
  housenumber?: string;
  street?: string;
  city?: string;
  district?: string;
  county?: string;
  state?: string;
  country?: string;
  countrycode?: string;
  type?: string;
}

interface PhotonResponse {
  features: { geometry: { coordinates: [number, number] }; properties: PhotonProps }[];
}

export interface Place {
  /** First line: a place name or a street address. */
  title: string;
  /** Second line: city, state (and country outside the US). */
  subtitle: string;
  lat: number;
  lon: number;
  /** City-or-bigger results get a different icon than addresses and points of interest. */
  kind: 'area' | 'address' | 'poi';
}

const region = (p: PhotonProps) => {
  if (!p.state) return p.country ?? '';
  return p.countrycode === 'US' ? (US_STATES[p.state] ?? p.state) : p.state;
};

/** Turn one Photon feature into two clean lines. */
export function toPlace(p: PhotonProps, lon: number, lat: number): Place {
  const address = p.street ? [p.housenumber, p.street].filter(Boolean).join(' ') : '';
  const isArea = ['city', 'town', 'village', 'district', 'county', 'state', 'locality'].includes(p.type ?? '');
  const title = p.name || address || p.city || p.county || region(p) || 'Unnamed place';
  const parts = [
    p.name && address && address !== title ? address : null,
    p.city && p.city !== title ? p.city : null,
    region(p) && region(p) !== title ? region(p) : null,
    p.countrycode && p.countrycode !== 'US' && p.country !== title ? p.country : null,
  ].filter((x): x is string => !!x);
  return {
    title,
    subtitle: [...new Set(parts)].join(', '),
    lat,
    lon,
    kind: isArea ? 'area' : p.type === 'house' || (!p.name && address) ? 'address' : 'poi',
  };
}

/** Cities, addresses, and places; results near `near` come first. */
export async function searchPlaces(q: string, near: LatLon | null, signal?: AbortSignal): Promise<Place[]> {
  const params = new URLSearchParams({ q, limit: '7', lang: 'en' });
  if (near) {
    params.set('lat', near.lat.toFixed(3));
    params.set('lon', near.lon.toFixed(3));
  }
  const r = await fetchJson<PhotonResponse>(`${PHOTON}/api/?${params}`, { signal, timeoutMs: 8000 });
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const f of r.features) {
    const [lon, lat] = f.geometry.coordinates;
    const place = toPlace(f.properties, lon, lat);
    const key = `${place.title}|${place.subtitle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(place);
  }
  return out;
}

/** "Dunnellon, FL" for a point, or null. Used outside NWS coverage. */
export async function reverseName(lat: number, lon: number, signal?: AbortSignal): Promise<string | null> {
  const params = new URLSearchParams({ lat: lat.toFixed(4), lon: lon.toFixed(4), lang: 'en' });
  const r = await fetchJson<PhotonResponse>(`${PHOTON}/reverse?${params}`, { signal, timeoutMs: 6000 });
  const p = r.features[0]?.properties;
  if (!p) return null;
  const name = p.city || p.name || p.county;
  const reg = region(p);
  return name ? [name, reg].filter(Boolean).join(', ') : reg || null;
}
