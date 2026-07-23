import { useEffect, useMemo, useState } from 'react';
import { MapPin, Users, X } from 'lucide-react';
import ViewerGlobe from './ViewerGlobe';
import ViewerDetailCard from './ViewerDetailCard';
import { emitViewerHeartbeat } from '../hooks/useViewerHeartbeat';
import { getViewerGeoHint, refreshViewerGeoHint } from '../utils/viewerGeo';
import {
  formatViewerPlace,
  toCobeMarkers,
  QUALITY_LEGEND,
  qualityMarkerColor,
  qualityLabel,
  type ViewerLocation,
} from '../types/viewer';

interface ViewerMapFullscreenProps {
  isOpen: boolean;
  onClose: () => void;
  channelId: string;
  channelName: string;
  viewerCount: number;
  locations: ViewerLocation[];
}

export default function ViewerMapFullscreen({
  isOpen,
  onClose,
  channelId,
  channelName,
  viewerCount,
  locations,
}: ViewerMapFullscreenProps) {
  const [locating, setLocating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const markers = useMemo(
    () => toCobeMarkers(locations, selectedId),
    [locations, selectedId]
  );
  const selectedViewer = locations.find((v) => v.id === selectedId) ?? null;
  const withGeo = locations.filter((v) => v.lat != null && v.lng != null);
  const withoutGeo = locations.filter((v) => v.lat == null || v.lng == null);

  useEffect(() => {
    if (!isOpen) setSelectedId(null);
  }, [isOpen]);

  useEffect(() => {
    if (!selectedId) return;
    if (!locations.some((v) => v.id === selectedId)) setSelectedId(null);
  }, [locations, selectedId]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedId) setSelectedId(null);
        else onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('keydown', onEsc);
      document.body.style.overflow = 'hidden';
      getViewerGeoHint().then(() => emitViewerHeartbeat(channelId));
    }
    return () => {
      document.removeEventListener('keydown', onEsc);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose, channelId, selectedId]);

  const handleUseMyLocation = async () => {
    setLocating(true);
    try {
      await refreshViewerGeoHint();
      emitViewerHeartbeat(channelId);
    } finally {
      setLocating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Live viewers map"
    >
      <header className="shrink-0 flex items-center justify-between gap-4 px-4 sm:px-6 h-14 border-b border-[#333]">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-white truncate">Live viewers</h1>
          <p className="text-xs text-gray-500 truncate">{channelName}</p>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <span className="flex items-center gap-1.5 text-sm text-gray-400">
            <Users className="w-4 h-4" />
            <span className="font-mono text-white">{viewerCount}</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-white border border-[#333] rounded-md hover:bg-[#1a1a1a] transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
            Close
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        <main className="relative flex-1 flex flex-col items-center justify-center min-h-0 p-4 sm:p-8 bg-black">
          <ViewerGlobe
            markers={markers}
            selectedId={selectedId}
            onSelectViewer={setSelectedId}
          />

          {selectedViewer && (
            <div className="absolute bottom-6 left-4 right-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 w-full max-w-sm z-10 pointer-events-auto">
              <ViewerDetailCard viewer={selectedViewer} onClose={() => setSelectedId(null)} />
            </div>
          )}

          <p className="mt-4 text-xs text-gray-500 text-center max-w-md relative z-0">
            Drag to rotate · Tap a dot for viewer details
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-3 relative z-0">
            {QUALITY_LEGEND.map((item) => (
              <span key={item.label} className="flex items-center gap-1.5 text-[10px] text-gray-500">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                {item.label}
              </span>
            ))}
          </div>
        </main>

        <aside className="w-full lg:w-80 shrink-0 border-t lg:border-t-0 lg:border-l border-[#333] bg-black flex flex-col min-h-[200px] lg:min-h-0 max-h-[40vh] lg:max-h-none">
          <div className="p-4 border-b border-[#333] grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">On map</p>
              <p className="text-xl font-mono text-white">{withGeo.length}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Unknown</p>
              <p className="text-xl font-mono text-white">{withoutGeo.length}</p>
            </div>
          </div>

          <div className="p-4 border-b border-[#333]">
            <button
              type="button"
              disabled={locating}
              onClick={handleUseMyLocation}
              className="w-full px-3 py-2 text-xs font-medium rounded-md border border-[#333] bg-black text-white hover:bg-[#1a1a1a] disabled:opacity-50 transition-colors"
            >
              {locating ? 'Getting location…' : 'Use my location (GPS)'}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Viewers</p>
            {locations.length === 0 ? (
              <p className="text-sm text-gray-400">No active viewers.</p>
            ) : (
              <ul className="space-y-1">
                {locations.map((v) => {
                  const active = v.id === selectedId;
                  return (
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(active ? null : v.id)}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-md border text-sm text-left transition-colors ${
                          active
                            ? 'border-gray-500 bg-[#1a1a1a] text-white'
                            : 'border-[#333] bg-black text-gray-300 hover:border-gray-500'
                        }`}
                      >
                        <MapPin
                          className="w-3.5 h-3.5 shrink-0"
                          style={{ color: qualityMarkerColor(v.quality) }}
                        />
                        <span className="truncate flex-1">{formatViewerPlace(v)}</span>
                        <span className="text-[10px] text-gray-500 shrink-0">
                          {qualityLabel(v.quality)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
