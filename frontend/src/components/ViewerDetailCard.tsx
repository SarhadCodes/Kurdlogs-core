import { X } from 'lucide-react';
import {
  formatConnectedDuration,
  formatViewerBitrate,
  formatViewerLocationLabel,
  qualityLabel,
  qualityMarkerColor,
  type ViewerLocation,
} from '../types/viewer';

interface ViewerDetailCardProps {
  viewer: ViewerLocation;
  onClose: () => void;
}

export default function ViewerDetailCard({ viewer, onClose }: ViewerDetailCardProps) {
  const accent = qualityMarkerColor(viewer.quality);

  return (
    <div
      className="rounded-xl border bg-black/95 backdrop-blur-md shadow-2xl overflow-hidden"
      style={{ borderColor: accent }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#333]">
        <div className="flex items-center gap-2">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: accent }}
          />
          <p className="text-sm font-semibold text-white">Viewer details</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-gray-400 hover:text-white rounded"
          aria-label="Close details"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <dl className="px-4 py-3 space-y-2.5 text-sm">
        <DetailRow label="Location" value={formatViewerLocationLabel(viewer)} />
        <DetailRow label="ISP" value={viewer.isp || '—'} />
        <DetailRow label="Device" value={viewer.device || 'Unknown device'} />
        <DetailRow label="Player" value={viewer.player || 'Web player'} />
        <DetailRow label="Quality" value={qualityLabel(viewer.quality)} accent={accent} />
        <DetailRow label="Bitrate" value={formatViewerBitrate(viewer.bitrateKbps)} />
        <DetailRow
          label="Connected"
          value={formatConnectedDuration(viewer.connectedSeconds || 0)}
        />
      </dl>
    </div>
  );
}

function DetailRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-gray-400 shrink-0">{label}</dt>
      <dd
        className="font-medium text-right"
        style={accent ? { color: accent } : { color: '#ffffff' }}
      >
        {value}
      </dd>
    </div>
  );
}
