const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface IpGeoResult {
  lat?: number;
  lng?: number;
  city?: string;
  country?: string;
  countryCode?: string;
  isp?: string;
}

const cache = new Map<string, { data: IpGeoResult; expires: number }>();

export function isPrivateIp(ip: string): boolean {
  const clean = ip.replace(/^::ffff:/, '');
  return (
    !clean ||
    clean === '127.0.0.1' ||
    clean === '::1' ||
    clean.startsWith('192.168.') ||
    clean.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(clean)
  );
}

export function localNetworkGeo(): IpGeoResult {
  return { city: 'Local network', country: 'Local' };
}

/** Resolve city/country/coordinates from a public IP (cached, ip-api.com). */
export function resolveIpGeo(ip: string): Promise<IpGeoResult | undefined> {
  if (isPrivateIp(ip)) {
    return Promise.resolve(localNetworkGeo());
  }

  const cached = cache.get(ip);
  if (cached && cached.expires > Date.now()) {
    return Promise.resolve(cached.data);
  }

  return fetch(
    `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,lat,lon,city,country,countryCode,isp`,
    { signal: AbortSignal.timeout(5000) }
  )
    .then((res) => res.json())
    .then((data: {
      status?: string;
      lat?: number;
      lon?: number;
      city?: string;
      country?: string;
      countryCode?: string;
      isp?: string;
    }) => {
      if (data.status !== 'success') return undefined;
      const result: IpGeoResult = {
        lat: typeof data.lat === 'number' ? data.lat : undefined,
        lng: typeof data.lon === 'number' ? data.lon : undefined,
        city: data.city || undefined,
        country: data.countryCode || data.country || undefined,
        countryCode: data.countryCode || undefined,
        isp: data.isp || undefined,
      };
      cache.set(ip, { data: result, expires: Date.now() + CACHE_TTL_MS });
      return result;
    })
    .catch(() => undefined);
}
