import type { McrSourceView } from '../../types/mcr';

const healthDot: Record<string, string> = {
  ONLINE: 'bg-zinc-300',
  DEGRADED: 'bg-zinc-400',
  OFFLINE: 'bg-red-700',
  UNKNOWN: 'bg-zinc-600',
};

export function SourceHealthStrip({ source }: { source: McrSourceView | null }) {
  if (!source) {
    return (
      <div className="grid grid-cols-3 sm:grid-cols-7 gap-2 px-3 py-2 text-[10px] text-gray-600 border-t border-[#222] bg-[#0d0d0d]">
        <span>—</span>
      </div>
    );
  }
  const h = source.health;
  const connected = source.sessionActive ?? h.status === 'ONLINE';
  return (
    <div className="grid grid-cols-3 sm:grid-cols-7 gap-2 px-3 py-2 text-[10px] border-t border-[#222] bg-[#0d0d0d]">
      <div>
        <span className="block uppercase text-gray-600">Status</span>
        <span className={`flex items-center gap-1 ${h.status === 'ONLINE' ? 'text-zinc-300' : 'text-gray-400'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${healthDot[h.status]}`} />
          {h.status}
        </span>
      </div>
      <div>
        <span className="block uppercase text-gray-600">Session</span>
        <span className={connected ? 'text-cyan-400' : 'text-gray-500'}>
          {connected ? 'connected' : 'idle'}
        </span>
      </div>
      <div>
        <span className="block uppercase text-gray-600">Bitrate</span>
        <span className="text-gray-300">{h.bitrate ? `${h.bitrate}k` : '—'}</span>
      </div>
      <div>
        <span className="block uppercase text-gray-600">FPS</span>
        <span className="text-gray-300">{h.fps ? h.fps.toFixed(1) : '—'}</span>
      </div>
      <div>
        <span className="block uppercase text-gray-600">Resolution</span>
        <span className="text-gray-300">{h.resolution ?? '—'}</span>
      </div>
      <div>
        <span className="block uppercase text-gray-600">Audio</span>
        <span className={h.hasAudio ? 'text-emerald-400' : 'text-gray-500'}>
          {h.hasAudio ? (h.audioCodec ?? 'yes') : 'no'}
        </span>
      </div>
      <div>
        <span className="block uppercase text-gray-600">Type</span>
        <span className="text-gray-400">{source.sourceType}</span>
      </div>
    </div>
  );
}

export { healthDot };
