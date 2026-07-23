import React, { useMemo } from 'react';
import { Copy, Link2, AlertTriangle } from 'lucide-react';
import { Channel, Token } from '../types';
import {
  buildChannelOutputSections,
  ChannelOutputEntry,
  ChannelOutputSection,
  ChannelPlayUrlsData,
} from '../utils/channelOutputs';
import { copyToClipboard } from '../utils/clipboard';

interface ChannelOutputPanelProps {
  channel: Channel;
  activeToken?: Token | null;
  playUrls?: ChannelPlayUrlsData | null;
}

const protocolColors: Record<string, string> = {
  HLS: 'bg-emerald-600',
  DASH: 'bg-emerald-600',
  EMBED: 'bg-emerald-600',
  TOKEN: 'bg-amber-600',
  IPTV: 'bg-sky-600',
  RTMP: 'bg-orange-600',
};

const ChannelOutputPanel: React.FC<ChannelOutputPanelProps> = ({ channel, activeToken, playUrls }) => {
  const sections = useMemo(
    () => buildChannelOutputSections(channel, activeToken, playUrls),
    [channel, activeToken, playUrls]
  );

  const copy = (text: string, label: string) => {
    copyToClipboard(text, label);
  };

  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <SectionBlock key={section.id} section={section} onCopy={copy} />
      ))}
    </div>
  );
};

function SectionBlock({
  section,
  onCopy,
}: {
  section: ChannelOutputSection;
  onCopy: (text: string, label: string) => void;
}) {
  const borderClass = section.highlight
    ? 'border-emerald-600/50 ring-1 ring-emerald-600/20'
    : 'border-[#333333]';

  return (
    <div className={`bg-[#111111] border rounded-lg overflow-hidden ${borderClass}`}>
      <div className="px-4 py-3 border-b border-[#333333]">
        <h3 className="text-sm font-medium text-white">{section.title}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{section.description}</p>
        {section.warning && (
          <p className="text-xs text-amber-400/90 mt-2 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{section.warning}</span>
          </p>
        )}
      </div>

      {section.entries.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-500">No URLs available in this section.</p>
      ) : (
        <div className="divide-y divide-[#222]">
          {section.entries.map((row) => (
            <OutputRow key={row.id} row={row} onCopy={onCopy} />
          ))}
        </div>
      )}
    </div>
  );
}

function OutputRow({
  row,
  onCopy,
}: {
  row: ChannelOutputEntry;
  onCopy: (text: string, label: string) => void;
}) {
  const badgeClass = protocolColors[row.protocol] || 'bg-gray-600';

  return (
    <div className="px-3 sm:px-4 py-3 flex flex-col sm:flex-row gap-2 sm:gap-3">
      <div className="flex-shrink-0 pt-1">
        <span
          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide text-white ${badgeClass}`}
        >
          {row.protocol}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-white font-medium">{row.title}</p>
          {row.recommended && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded">
              Use in VLC
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5 mb-2">{row.description}</p>

        <div className="flex items-start gap-2">
          <code
            className="flex-1 px-2 py-1.5 bg-black border border-[#333] rounded text-xs text-gray-300 font-mono break-all leading-relaxed cursor-text select-all"
            onClick={(e) => {
              const el = e.currentTarget;
              const range = document.createRange();
              range.selectNodeContents(el);
              const sel = window.getSelection();
              sel?.removeAllRanges();
              sel?.addRange(range);
            }}
            title="Click to select URL"
          >
            {row.url}
          </code>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onCopy(row.url, row.title);
            }}
            className="p-2 bg-[#222] hover:bg-[#2a2a2a] border border-[#333] rounded-md flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
            title="Copy URL"
            aria-label={`Copy ${row.title}`}
          >
            <Copy className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {row.embedCode && (
          <div className="mt-2 flex items-start gap-2">
            <code className="flex-1 px-2 py-1.5 bg-black border border-[#333] rounded text-[10px] text-gray-400 font-mono break-all leading-relaxed max-h-20 overflow-y-auto">
              {row.embedCode}
            </code>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCopy(row.embedCode!, 'Embed code');
              }}
              className="p-2 bg-[#222] hover:bg-[#2a2a2a] border border-[#333] rounded-md flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
              title="Copy iframe HTML"
              aria-label="Copy embed code"
            >
              <Copy className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default ChannelOutputPanel;
