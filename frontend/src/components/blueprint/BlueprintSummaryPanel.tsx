import { Activity, Film, Megaphone, Radio, Sparkles } from 'lucide-react';
import type { BlueprintSummary } from '../../types';

interface Props {
  summary: BlueprintSummary | null;
  loading?: boolean;
}

function riskColor(risk: BlueprintSummary['repeatRisk']) {
  if (risk === 'LOW') return 'text-emerald-400';
  if (risk === 'MEDIUM') return 'text-amber-400';
  return 'text-red-400';
}

function scoreColor(score: number) {
  if (score >= 85) return 'text-emerald-400';
  if (score >= 65) return 'text-amber-400';
  return 'text-red-400';
}

export default function BlueprintSummaryPanel({ summary, loading }: Props) {
  if (loading) {
    return (
      <div className="border border-[#333] rounded-xl bg-[#111] p-4 animate-pulse">
        <div className="h-4 bg-[#222] rounded w-2/3 mb-4" />
        <div className="space-y-2">
          <div className="h-8 bg-[#222] rounded" />
          <div className="h-8 bg-[#222] rounded" />
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="border border-[#333] rounded-xl bg-[#111] p-4">
        <p className="text-xs text-gray-500">Add blocks to see channel health metrics.</p>
      </div>
    );
  }

  const { blockCounts } = summary;

  return (
    <div className="border border-[#333] rounded-xl bg-gradient-to-b from-[#141414] to-[#0d0d0d] p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Activity className="w-4 h-4 text-violet-400" />
            Channel Health
          </h3>
          <p className="text-[10px] text-gray-600 mt-0.5 uppercase tracking-wider">Blueprint summary</p>
        </div>
        <div className="text-right">
          <p className={`text-2xl font-bold tabular-nums ${scoreColor(summary.blueprintScore)}`}>
            {summary.blueprintScore}
            <span className="text-xs text-gray-600 font-normal">/100</span>
          </p>
          <p className="text-[10px] text-gray-600">Blueprint Score</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Metric icon={Film} label="Movies" value={blockCounts.movies} />
        <Metric icon={Megaphone} label="Promos" value={blockCounts.promos} />
        <Metric icon={Radio} label="Station IDs" value={blockCounts.stationIds} />
        <Metric icon={Sparkles} label="Intros" value={blockCounts.intros} />
        {blockCounts.supers > 0 && (
          <Metric icon={Film} label="Super blocks" value={blockCounts.supers} />
        )}
      </div>

      <div className="rounded-lg bg-black/40 border border-[#2a2a2a] p-3 space-y-2 text-xs">
        <Row label="Coverage" value={summary.coverageFormatted} />
        <Row label="Loop duration" value={summary.estimatedLoopFormatted} />
        <Row label="Unique assets" value={String(summary.uniqueAssets)} />
        <Row
          label="Repeat risk"
          value={summary.repeatRiskLabel}
          valueClass={riskColor(summary.repeatRisk)}
        />
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Film;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-black/30 border border-[#252525]">
      <Icon className="w-3.5 h-3.5 text-gray-500 shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] text-gray-600 uppercase">{label}</p>
        <p className="text-sm font-semibold text-white tabular-nums">{value}</p>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  valueClass = 'text-white',
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gray-500">{label}</span>
      <span className={`font-medium tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}
