import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import LivePlayer from '../components/LivePlayer';
import { buildStreamUrl } from '../utils/streamUrl';
import type { OutputType } from '../types';

function manifestFromQuery(searchParams: URLSearchParams): string {
  const format = searchParams.get('format');
  if (format === 'dash') return 'manifest.mpd';
  if (format === 'hls') return 'master.m3u8';
  return 'master.m3u8';
}

export default function EmbedPlayerPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const [src, setSrc] = useState<string | null>(null);
  const [isDash, setIsDash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      setError('Missing channel slug');
      return;
    }

    const apiKey = searchParams.get('api_key');
    const streamToken = searchParams.get('token');

    async function resolve() {
      try {
        let outputType: OutputType = 'HLS';

        if (apiKey) {
          const res = await fetch(`/api/iptv/channels/${slug!}?api_key=${encodeURIComponent(apiKey)}`);
          const json = await res.json();
          if (!json.success) {
            setError(json.error || 'Invalid API key or channel');
            return;
          }
          outputType = json.data?.outputType || 'HLS';
        }

        const manifest = manifestFromQuery(searchParams);
        setIsDash(manifest.endsWith('.mpd'));

        const channelSlug = slug as string;
        if (apiKey) {
          setSrc(`/stream/play/${channelSlug}/${manifest}?api_key=${encodeURIComponent(apiKey)}`);
        } else if (streamToken) {
          setSrc(buildStreamUrl(channelSlug, manifest, streamToken));
        } else {
          // Same-origin embed uses httpOnly session cookie when logged in.
          setSrc(buildStreamUrl(channelSlug, manifest));
        }
      } catch {
        setError('Failed to load stream');
      }
    }

    resolve();
  }, [slug, searchParams]);

  if (error) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-gray-500 text-sm p-4">
        {error}
      </div>
    );
  }

  if (!src) {
    return <div className="min-h-screen bg-black" />;
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="w-full max-w-6xl aspect-video">
        <LivePlayer src={src} engine="auto" autoPlay />
      </div>
    </div>
  );
}
