export interface ViewerGeoClient {
  lat: number;
  lng: number;
  city?: string;
  country?: string;
}

/** Rough city centers for common timezones when IP geo is unavailable. */
const TZ_APPROX: Record<string, ViewerGeoClient> = {
  'Asia/Baghdad': { lat: 33.31, lng: 44.37, city: 'Baghdad', country: 'IQ' },
  'Asia/Tehran': { lat: 35.69, lng: 51.39, city: 'Tehran', country: 'IR' },
  'Asia/Dubai': { lat: 25.2, lng: 55.27, city: 'Dubai', country: 'AE' },
  'Asia/Riyadh': { lat: 24.71, lng: 46.67, city: 'Riyadh', country: 'SA' },
  'Asia/Istanbul': { lat: 41.01, lng: 28.98, city: 'Istanbul', country: 'TR' },
  'Europe/London': { lat: 51.51, lng: -0.13, city: 'London', country: 'GB' },
  'Europe/Berlin': { lat: 52.52, lng: 13.41, city: 'Berlin', country: 'DE' },
  'Europe/Paris': { lat: 48.86, lng: 2.35, city: 'Paris', country: 'FR' },
  'America/New_York': { lat: 40.71, lng: -74.01, city: 'New York', country: 'US' },
  'America/Los_Angeles': { lat: 34.05, lng: -118.24, city: 'Los Angeles', country: 'US' },
};

let cachedHint: ViewerGeoClient | null = null;
let resolveInFlight: Promise<ViewerGeoClient> | null = null;

function geoFromTimezone(): ViewerGeoClient {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (TZ_APPROX[tz]) return { ...TZ_APPROX[tz] };

  const offsetHours = -new Date().getTimezoneOffset() / 60;
  const lng = Math.max(-180, Math.min(180, offsetHours * 15));
  return {
    lat: 25,
    lng,
    city: tz.split('/').pop()?.replace(/_/g, ' ') || 'Your region',
    country: 'Approx',
  };
}

async function reverseGeocode(lat: number, lng: number): Promise<{ city?: string; country?: string }> {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return {};
    const data = (await res.json()) as {
      city?: string;
      locality?: string;
      principalSubdivision?: string;
      countryCode?: string;
    };
    return {
      city: data.city || data.locality || data.principalSubdivision,
      country: data.countryCode,
    };
  } catch {
    return {};
  }
}

async function geoFromGps(highAccuracy: boolean): Promise<ViewerGeoClient> {
  if (!navigator.geolocation) {
    return geoFromTimezone();
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        const place = await reverseGeocode(lat, lng);
        resolve({
          lat,
          lng,
          city: place.city || TZ_APPROX[Intl.DateTimeFormat().resolvedOptions().timeZone]?.city,
          country: place.country || 'GPS',
        });
      },
      () => resolve(geoFromTimezone()),
      {
        enableHighAccuracy: highAccuracy,
        timeout: highAccuracy ? 12000 : 8000,
        maximumAge: highAccuracy ? 0 : 300_000,
      }
    );
  });
}

/** Resolve once per session: GPS if allowed, else timezone-based estimate. */
export function getViewerGeoHint(): Promise<ViewerGeoClient> {
  if (cachedHint) return Promise.resolve(cachedHint);
  if (resolveInFlight) return resolveInFlight;

  resolveInFlight = geoFromGps(false).then((hint) => {
    cachedHint = hint;
    resolveInFlight = null;
    return hint;
  });

  return resolveInFlight;
}

/** Force refresh (e.g. user clicked "Use my location"). */
export function refreshViewerGeoHint(): Promise<ViewerGeoClient> {
  cachedHint = null;
  resolveInFlight = null;
  return geoFromGps(true).then((hint) => {
    cachedHint = hint;
    return hint;
  });
}

export function peekViewerGeoHint(): ViewerGeoClient | null {
  return cachedHint;
}
