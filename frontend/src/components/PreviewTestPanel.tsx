import { ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react';
import AudioLevelMeter from './AudioLevelMeter';
import type { StreamQualityInfo } from './LivePlayer';
import type { HlsQualityLevel } from './LivePlayer';

interface PreviewTestPanelProps {
  open: boolean;
  onToggle: () => void;
  currentQuality: StreamQualityInfo | null;
  levels: HlsQualityLevel[];
  selectedLevel: number;
  onSelectLevel: (levelIndex: number) => void;
  canManualQuality: boolean;
  video: HTMLVideoElement | null;
}

export default function PreviewTestPanel({
  open,
  onToggle,
  currentQuality,
  levels,
  selectedLevel,
  onSelectLevel,
  canManualQuality,
  video,
}: PreviewTestPanelProps) {
  return (
    <div className="border-t border-[#333333] bg-[#0d0d0d]">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 py-2.5 flex items-center justify-between gap-2 text-xs text-gray-400 hover:text-white hover:bg-[#151515] transition-colors"
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span className="font-medium">Preview test tools</span>
          {!open && currentQuality && (
            <span className="text-emerald-400 font-mono">({currentQuality.label})</span>
          )}
        </span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-4">
          <div className="rounded-md border border-[#333] bg-[#111] px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Current variant</p>
            <p className="text-sm font-mono text-emerald-400">
              {currentQuality?.label ?? 'Detecting…'}
              {currentQuality?.bitrateKbps != null ? (
                <span className="text-gray-500"> · {currentQuality.bitrateKbps} kbps</span>
              ) : null}
            </p>
          </div>

          {canManualQuality && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Quality (manual)</p>
              <div className="flex flex-wrap gap-1.5">
                <QualityButton
                  label="Auto"
                  active={selectedLevel === -1}
                  onClick={() => onSelectLevel(-1)}
                />
                {levels.map((lvl) => (
                  <QualityButton
                    key={lvl.index}
                    label={lvl.label}
                    sub={lvl.bitrateKbps ? `${lvl.bitrateKbps}k` : undefined}
                    active={selectedLevel === lvl.index}
                    onClick={() => onSelectLevel(lvl.index)}
                  />
                ))}
              </div>
              <p className="text-[10px] text-gray-600 mt-2">
                Auto lets the player pick; manual locks a rendition for testing.
              </p>
            </div>
          )}

          {!canManualQuality && (
            <p className="text-xs text-gray-500">
              Manual quality switching needs HLS.js or Auto with an adaptive master playlist.
            </p>
          )}

          <AudioLevelMeter video={video} className="rounded-md border border-[#333] bg-[#111] px-3 py-2.5" />
          <p className="text-[10px] text-gray-600 -mt-2">
            Preview starts muted for autoplay — click the speaker icon on the video to unmute.
          </p>
        </div>
      )}
    </div>
  );
}

function QualityButton({
  label,
  sub,
  active,
  onClick,
}: {
  label: string;
  sub?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
        active
          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
          : 'bg-[#1a1a1a] text-gray-400 border-[#333] hover:text-white hover:border-[#555]'
      }`}
    >
      {label}
      {sub ? <span className="text-gray-500 ml-1">{sub}</span> : null}
    </button>
  );
}
