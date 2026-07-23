import { useEffect } from 'react';
import LivePlayer from '../LivePlayer';
import { MonitorPlay } from 'lucide-react';
import type { McrSourceView } from '../../types/mcr';

interface McrSessionPlayerPoolProps {
  sources: McrSourceView[];
  sessionUrls: Record<string, string | null>;
  activeSourceId: string | null;
  zone: 'preview' | 'aux';
}

/**
 * Keeps one HLS player per source alive in the bin. Switching preview only changes
 * visibility — players are not destroyed or reloaded.
 */
export default function McrSessionPlayerPool({
  sources,
  sessionUrls,
  activeSourceId,
  zone,
}: McrSessionPlayerPoolProps) {
  useEffect(() => {
    const active = sources.find((s) => s.id === activeSourceId);
    if (active) {
      console.info(
        `[MCR_PLAYER] action=route zone=${zone} sourceId=${active.id} ` +
          `label=${active.label} sessionActive=${active.sessionActive ?? false}`
      );
    }
  }, [activeSourceId, sources, zone]);

  return (
    <div className="relative aspect-video bg-black">
      {sources.map((source) => {
        const url = sessionUrls[source.id];
        const visible = activeSourceId === source.id;
        const warming = source.sessionActive && !url;
        if (!url && !source.sessionActive) return null;
        return (
          <div
            key={source.id}
            className={`absolute inset-0 transition-opacity duration-150 ${
              visible ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
            }`}
            aria-hidden={!visible}
          >
            {url ? (
              <LivePlayer
                src={url}
                autoPlay
                controls={false}
                showQualityOverlay={visible}
                playerId={`mcr-${zone}-${source.id}`}
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black text-gray-500">
                <MonitorPlay size={32} className="mb-2 opacity-40 animate-pulse" />
                <span className="text-xs">Connecting…</span>
              </div>
            )}
            {warming && visible && (
              <div className="absolute bottom-2 right-2 text-[10px] text-cyan-500">BUFFERING</div>
            )}
          </div>
        );
      })}
      {!activeSourceId && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600 z-20">
          <MonitorPlay size={40} className="mb-2 opacity-40" />
          <span className="text-xs">No signal</span>
        </div>
      )}
      {activeSourceId && !sessionUrls[activeSourceId] && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600 z-20">
          <MonitorPlay size={40} className="mb-2 opacity-40" />
          <span className="text-xs">Session starting…</span>
        </div>
      )}
    </div>
  );
}
