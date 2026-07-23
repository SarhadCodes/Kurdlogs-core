import { resolveIpGeo } from './ipGeo.service';

export function resolveIsp(ip: string): Promise<string | undefined> {
  return resolveIpGeo(ip).then((geo) => geo?.isp);
}
