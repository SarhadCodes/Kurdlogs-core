import { useEffect, useState } from 'react';
import { AlertTriangle, Copy } from 'lucide-react';
import Modal from '../Modal';
import { mcrApi } from '../../services/api';
import toast from 'react-hot-toast';
import type {
  AddMcrSourcePayload,
  McrAvailableChannel,
  McrIngestPublisher,
  McrSourceType,
} from '../../types/mcr';

const SOURCE_TYPES: { id: McrSourceType; label: string; disabled?: boolean }[] = [
  { id: 'BLUEPRINT', label: 'Blueprint Channel' },
  { id: 'PLAYLIST', label: 'Playlist Channel' },
  { id: 'RTMP', label: 'RTMP URL' },
  { id: 'RTMP_INGEST', label: 'RTMP Ingest (OBS/vMix)' },
  { id: 'SRT', label: 'SRT' },
  { id: 'RTSP', label: 'RTSP' },
  { id: 'HLS', label: 'HLS (.m3u8)' },
  { id: 'MPEGTS', label: 'MPEG-TS (.ts)' },
  { id: 'UDP', label: 'UDP' },
  { id: 'NDI', label: 'NDI (coming soon)', disabled: true },
];

const URL_PLACEHOLDERS: Partial<Record<McrSourceType, string>> = {
  RTMP: 'rtmp://host/app/stream',
  SRT: 'srt://host:9000?mode=caller',
  RTSP: 'rtsp://host:554/stream',
  HLS: 'https://example.com/live/stream.m3u8',
  MPEGTS: 'https://example.com/stream.ts',
  UDP: 'udp://@239.0.0.1:1234',
};

interface AddSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  channelId: string;
  onAdded: () => void;
}

export default function AddSourceModal({ isOpen, onClose, channelId, onAdded }: AddSourceModalProps) {
  const [sourceType, setSourceType] = useState<McrSourceType>('RTMP');
  const [label, setLabel] = useState('');
  const [inputUrl, setInputUrl] = useState('');
  const [refChannelId, setRefChannelId] = useState('');
  const [streamKey, setStreamKey] = useState('');
  const [channels, setChannels] = useState<McrAvailableChannel[]>([]);
  const [ingestInfo, setIngestInfo] = useState<McrIngestPublisher | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    mcrApi.listAvailableChannels().then((r) => {
      if (r.data) setChannels(r.data.filter((c) => c.id !== channelId));
    });
  }, [isOpen, channelId]);

  const reset = () => {
    setLabel('');
    setInputUrl('');
    setRefChannelId('');
    setStreamKey('');
    setIngestInfo(null);
    setSourceType('RTMP');
  };

  const handleCreateIngestKey = async () => {
    if (!label.trim()) {
      toast.error('Enter a label first');
      return;
    }
    setBusy(true);
    try {
      const res = await mcrApi.createIngestKey(label.trim(), streamKey.trim() || undefined);
      if (res.data) {
        setIngestInfo(res.data);
        setStreamKey(res.data.streamKey);
        toast.success('Ingest key created — push from OBS to publish URL');
      }
    } catch (err: unknown) {
      toast.error(err && typeof err === 'object' && 'error' in err ? String((err as { error: string }).error) : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async () => {
    if (!label.trim()) {
      toast.error('Label is required');
      return;
    }

    const payload: AddMcrSourcePayload = {
      label: label.trim(),
      sourceType,
    };

    if (sourceType === 'BLUEPRINT' || sourceType === 'PLAYLIST') {
      if (!refChannelId) {
        toast.error('Select a channel');
        return;
      }
      payload.refChannelId = refChannelId;
    } else if (sourceType === 'RTMP_INGEST') {
      if (!ingestInfo && !streamKey.trim()) {
        toast.error('Create an ingest key first');
        return;
      }
      payload.streamKey = ingestInfo?.streamKey ?? streamKey.trim();
      payload.inputUrl = ingestInfo?.rtmpUrl;
    } else {
      if (!inputUrl.trim()) {
        toast.error('Input URL is required');
        return;
      }
      payload.inputUrl = inputUrl.trim();
    }

    setBusy(true);
    try {
      await mcrApi.addSource(channelId, payload);
      toast.success('Source added');
      reset();
      onAdded();
      onClose();
    } catch (err: unknown) {
      toast.error(err && typeof err === 'object' && 'error' in err ? String((err as { error: string }).error) : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied');
  };

  const isChannelType = sourceType === 'BLUEPRINT' || sourceType === 'PLAYLIST';
  const isIngestType = sourceType === 'RTMP_INGEST';

  return (
    <Modal isOpen={isOpen} onClose={() => { reset(); onClose(); }} title="Add Source" wide>
      <div className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Source type</label>
          <select
            value={sourceType}
            onChange={(e) => {
              setSourceType(e.target.value as McrSourceType);
              setIngestInfo(null);
            }}
            className="w-full bg-[#1a1a1a] border border-[#333] rounded px-3 py-2 text-sm"
          >
            {SOURCE_TYPES.map((t) => (
              <option key={t.id} value={t.id} disabled={t.disabled}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Label</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="News Studio"
            className="w-full bg-[#1a1a1a] border border-[#333] rounded px-3 py-2 text-sm"
          />
        </div>

        {isChannelType && (
          <div>
            <label className="block text-sm text-gray-400 mb-1">KurdLogs channel</label>
            <select
              value={refChannelId}
              onChange={(e) => setRefChannelId(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-[#333] rounded px-3 py-2 text-sm"
            >
              <option value="">Select channel…</option>
              {channels
                .filter((c) =>
                  sourceType === 'BLUEPRINT' ? c.useBlueprint : c.isPlaylistChannel
                )
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.status})
                  </option>
                ))}
            </select>
          </div>
        )}

        {isIngestType && (
          <div className="space-y-3 p-3 rounded bg-[#111] border border-[#2a2a2a]">
            <p className="text-xs text-gray-400">
              OBS / vMix publishes to <code className="text-blue-400">rtmp://server/live/&#123;streamKey&#125;</code>.
              Feed appears in source list automatically when live.
            </p>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Stream key (optional)</label>
              <input
                value={streamKey}
                onChange={(e) => setStreamKey(e.target.value)}
                placeholder="studio-1"
                className="w-full bg-[#1a1a1a] border border-[#333] rounded px-3 py-2 text-sm font-mono"
              />
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={handleCreateIngestKey}
              className="w-full py-2 text-sm bg-[#222] hover:bg-[#333] rounded"
            >
              Generate ingest URL
            </button>
            {ingestInfo && (
              <div className="text-xs space-y-2 font-mono text-gray-300">
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 shrink-0">Publish:</span>
                  <span className="truncate">{ingestInfo.publishUrl}</span>
                  <button type="button" onClick={() => copyText(ingestInfo.publishUrl)} className="text-blue-400">
                    <Copy size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {!isChannelType && !isIngestType && sourceType !== 'NDI' && (
          <div>
            <label className="block text-sm text-gray-400 mb-1">Input URL</label>
            <input
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder={URL_PLACEHOLDERS[sourceType]}
              className="w-full bg-[#1a1a1a] border border-[#333] rounded px-3 py-2 text-sm font-mono"
            />
          </div>
        )}

        <div className="flex items-start gap-2 text-xs text-amber-600/80 bg-amber-950/30 p-2 rounded">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>Routing switches relay only — blueprint and playlist engines never restart.</span>
        </div>

        <button
          type="button"
          disabled={busy || sourceType === 'NDI'}
          onClick={handleSubmit}
          className="w-full py-2.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 rounded font-medium text-sm"
        >
          Add to Source Bin
        </button>
      </div>
    </Modal>
  );
}
