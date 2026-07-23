import { CheckCircle2, AlertCircle, Radio } from 'lucide-react';
import type { PublishBlueprintResult } from '../../types';

interface Props {
  result: PublishBlueprintResult | null;
  onDismiss: () => void;
}

export default function BlueprintPublishResult({ result, onDismiss }: Props) {
  if (!result) return null;

  const isActive = result.status === 'Active';

  return (
    <div
      className={`rounded-xl border p-4 space-y-3 ${
        isActive ? 'border-emerald-800/60 bg-emerald-950/20' : 'border-amber-800/60 bg-amber-950/20'
      }`}
    >
      <div className="flex items-start gap-3">
        {isActive ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
        ) : (
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">Blueprint published successfully</p>
          <dl className="mt-3 space-y-1.5 text-xs">
            <Row label="Channel" value={result.channel.name} />
            <Row label="Playback mode" value={result.playbackMode} highlight />
            <Row label="Blueprint" value={result.blueprintName} />
            <Row label="Status" value={result.status} highlight={isActive} />
            <Row label="Window segments" value={String(result.segmentCount)} />
            {result.streamRestarted && <Row label="Stream" value="Restarted with blueprint source" />}
            {!result.streamRestarted && result.status === 'Pending restart' && (
              <Row label="Next step" value="Start the channel to activate blueprint playback" />
            )}
          </dl>
          {result.warnings.length > 0 && (
            <ul className="mt-3 space-y-1 text-[11px] text-amber-400/90">
              {result.warnings.map((w, i) => (
                <li key={i}>• {w}</li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" onClick={onDismiss} className="text-gray-600 hover:text-white text-xs">
          Dismiss
        </button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className={`font-medium text-right ${highlight ? 'text-emerald-400' : 'text-white'}`}>{value}</dd>
    </div>
  );
}

export function PublishPanelContent({
  channels,
  publishChannelId,
  onChannelChange,
  onPublish,
  publishResult,
  onDismissResult,
}: {
  channels: Array<{ id: string; name: string }>;
  publishChannelId: string;
  onChannelChange: (id: string) => void;
  onPublish: () => void;
  publishResult: PublishBlueprintResult | null;
  onDismissResult: () => void;
}) {
  return (
    <div className="p-4 space-y-3 h-full overflow-y-auto">
      {publishResult && <BlueprintPublishResult result={publishResult} onDismiss={onDismissResult} />}

      <p className="text-xs text-gray-500 flex items-center gap-1.5">
        <Radio className="w-3.5 h-3.5" />
        Link blueprint to a playlist channel. Stream restarts automatically if already running.
      </p>
      <select
        value={publishChannelId}
        onChange={(e) => onChannelChange(e.target.value)}
        className="w-full px-3 py-2 bg-black border border-[#333] rounded-lg text-sm text-white"
      >
        <option value="">Select channel…</option>
        {channels.map((ch) => (
          <option key={ch.id} value={ch.id}>
            {ch.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onPublish}
        className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg"
      >
        Publish Blueprint
      </button>
    </div>
  );
}
