import { AlertTriangle, Play, Clock, BarChart3 } from 'lucide-react';
import type { BlueprintSimulation, SimulationHorizon } from '../../types';

interface Props {
  simulation: BlueprintSimulation | null;
  horizon: SimulationHorizon;
  onHorizonChange: (h: SimulationHorizon) => void;
  onSimulate: () => void;
  loading: boolean;
}

const HORIZONS: { value: SimulationHorizon; label: string }[] = [
  { value: '1h', label: 'Next hour' },
  { value: '24h', label: 'Next 24 hours' },
  { value: '7d', label: 'Next 7 days' },
];

function severityClass(severity?: string) {
  if (severity === 'critical') return 'text-red-400 bg-red-950/30 border-red-900/50';
  if (severity === 'info') return 'text-blue-400 bg-blue-950/20 border-blue-900/40';
  return 'text-amber-400 bg-amber-950/20 border-amber-900/40';
}

export default function BlueprintSimulatorPanel({
  simulation,
  horizon,
  onHorizonChange,
  onSimulate,
  loading,
}: Props) {
  return (
    <div className="flex flex-col h-full min-h-[200px]">
      <div className="px-4 py-3 border-b border-[#333] flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium text-white flex items-center gap-2">
          <Play className="w-4 h-4" /> Simulate Blueprint
        </h3>
        <div className="flex gap-1 ml-auto">
          {HORIZONS.map((h) => (
            <button
              key={h.value}
              type="button"
              onClick={() => onHorizonChange(h.value)}
              className={`px-2 py-1 text-xs rounded-md transition ${
                horizon === h.value ? 'bg-white text-black' : 'text-gray-500 hover:text-white'
              }`}
            >
              {h.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={onSimulate}
          className="px-3 py-1.5 bg-white text-black text-xs font-medium rounded-md disabled:opacity-50"
        >
          {loading ? 'Running…' : 'Run'}
        </button>
      </div>

      {!simulation ? (
        <div className="flex-1 flex items-center justify-center text-gray-600 text-sm p-6 text-center">
          Preview what your channel will play — detects empty blocks, repetition, and schedule gaps.
        </div>
      ) : (
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {simulation.warnings.length > 0 && (
            <div className="px-4 py-3 border-b border-[#333] space-y-2 max-h-36 overflow-y-auto">
              {simulation.warnings.map((w, i) => (
                <div
                  key={i}
                  className={`text-xs rounded-lg border px-3 py-2 ${severityClass(w.severity)}`}
                >
                  <p className="flex items-start gap-1.5 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    {w.message}
                  </p>
                  {w.suggestion && (
                    <p className="mt-1 ml-5 text-[11px] opacity-80 leading-relaxed">{w.suggestion}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="px-4 py-3 border-b border-[#333] grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Segments" value={String(simulation.stats.totalSegments)} />
            <Stat label="Unique" value={String(simulation.stats.uniqueTitles)} />
            <Stat label="Cycles" value={String(simulation.stats.cycleCount)} />
            <Stat
              label="Duration"
              value={simulation.coverage?.formatted ?? `${Math.round(simulation.stats.totalDurationSec / 3600)}h`}
            />
          </div>

          {(simulation.diversity || simulation.coverage) && (
            <div className="px-4 py-3 border-b border-[#333] grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {simulation.diversity && (
                <div className="rounded-lg bg-black/30 border border-[#2a2a2a] p-3">
                  <p className="text-[10px] text-gray-600 uppercase flex items-center gap-1">
                    <BarChart3 className="w-3 h-3" /> Diversity Score
                  </p>
                  <p className="text-lg font-bold text-violet-400 mt-1">
                    {simulation.diversity.score}/100
                    <span className="text-xs font-normal text-gray-500 ml-2">{simulation.diversity.label}</span>
                  </p>
                  <ul className="mt-2 space-y-0.5 text-gray-500">
                    {simulation.diversity.reasons.map((r, i) => (
                      <li key={i}>• {r}</li>
                    ))}
                  </ul>
                </div>
              )}
              {simulation.coverage && (
                <div className="rounded-lg bg-black/30 border border-[#2a2a2a] p-3">
                  <p className="text-[10px] text-gray-600 uppercase">Coverage Report</p>
                  <p className="text-lg font-bold text-white mt-1">
                    {simulation.coverage.formatted}
                    <span className="text-xs font-normal text-gray-500 ml-2">total</span>
                  </p>
                  <ul className="mt-2 space-y-0.5 text-gray-500">
                    {simulation.coverage.breakdown.map((b) => (
                      <li key={b.blockType} className="flex justify-between gap-2">
                        <span>{b.label}</span>
                        <span className="text-gray-400">{b.formatted}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#1a1a1a] text-gray-500">
                <tr>
                  <th className="text-left px-3 py-2">Time</th>
                  <th className="text-left px-3 py-2">Block</th>
                  <th className="text-left px-3 py-2">Content</th>
                </tr>
              </thead>
              <tbody>
                {simulation.segments.slice(0, 80).map((seg, i) => (
                  <tr key={i} className="border-t border-[#222] hover:bg-[#0a0a0a]">
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                      <Clock className="w-3 h-3 inline mr-1 opacity-50" />
                      {new Date(seg.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-3 py-2 text-gray-400">{seg.blockLabel}</td>
                    <td className="px-3 py-2 text-white truncate max-w-[180px]">{seg.title}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {simulation.segments.length > 80 && (
              <p className="text-center text-gray-600 text-xs py-2">
                + {simulation.segments.length - 80} more segments
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-gray-600 uppercase">{label}</p>
      <p className="text-sm font-semibold text-white">{value}</p>
    </div>
  );
}
