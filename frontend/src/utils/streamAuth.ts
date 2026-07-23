import { getOrCreateViewerSessionId } from './viewerSession';

/** Auth query params from the manifest URL (token or admin access_token). */
export function getStreamAuthFromSrc(src: string): {
  streamToken: string | null;
  accessToken: string | null;
  viewerSessionId: string | null;
} {
  const srcUrl = new URL(src, window.location.origin);
  return {
    streamToken: srcUrl.searchParams.get('token'),
    accessToken: srcUrl.searchParams.get('access_token'),
    viewerSessionId: srcUrl.searchParams.get('vsid'),
  };
}

export function appendStreamAuthToUrl(
  url: string,
  auth: { streamToken: string | null; accessToken: string | null; viewerSessionId?: string | null }
): string {
  const isAbsolute = url.startsWith('http://') || url.startsWith('https://');
  const reqUrl = new URL(url, window.location.origin);

  if (auth.streamToken && !reqUrl.searchParams.has('token')) {
    reqUrl.searchParams.set('token', auth.streamToken);
  }
  if (auth.accessToken && !reqUrl.searchParams.has('access_token')) {
    reqUrl.searchParams.set('access_token', auth.accessToken);
  }
  const vsid = auth.viewerSessionId || getOrCreateViewerSessionId();
  if (vsid && !reqUrl.searchParams.has('vsid')) {
    reqUrl.searchParams.set('vsid', vsid);
  }

  return isAbsolute ? reqUrl.toString() : reqUrl.pathname + reqUrl.search;
}
