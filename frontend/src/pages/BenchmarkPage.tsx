import { useEffect, useState } from 'react';
import { Gauge, Play, Download } from 'lucide-react';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import { benchmarkApi } from '../services/api';
import type { BenchmarkReport } from '../types';
import toast from 'react-hot-toast';

const CHANNEL_OPTIONS = [1, 5, 10, 20] as const;

export default function BenchmarkPage() {
  const [report, setReport] = useState<BenchmarkReport | null>(null);
  const [running, setRunning] = useState(false);
  const [channels, setChannels] = useState<1 | 5 | 10 | 20>(1);
  const [seconds, setSeconds] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [statusRes, lastRes] = await Promise.all([
          benchmarkApi.status(),
          benchmarkApi.last(),
        ]);
        if (statusRes.data) setRunning(statusRes.data.running);
        if (lastRes.data) setReport(lastRes.data);
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleRun = async () => {
    setRunning(true);
    toast.loading(`Running ${channels}-channel benchmark (${seconds}s)...`, { id: 'bench' });
    try {
      const res = await benchmarkApi.run(channels, seconds);
      if (res.data) setReport(res.data);
      toast.success('Benchmark complete', { id: 'bench' });
    } catch (e: any) {
      toast.error(e?.error || 'Benchmark failed', { id: 'bench' });
    } finally {
      setRunning(false);
    }
  };

  const downloadReport = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <Layout><LoadingSpinner /></Layout>;

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
            <Gauge className="w-6 h-6" /> Stress Test / Benchmark
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Localhost-only capacity testing — measures CPU, RAM, and disk write rate
          </p>
        </div>

        <div className="bg-[#111] border border-[#333] rounded-lg p-5 space-y-4 max-w-xl">
          <label className="block text-sm text-gray-400">
            Target playlist channels
            <select
              value={channels}
              onChange={(e) => setChannels(parseInt(e.target.value, 10) as 1 | 5 | 10 | 20)}
              className="mt-1 w-full bg-black border border-[#333] rounded px-3 py-2 text-white"
              disabled={running}
            >
              {CHANNEL_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} channel{n > 1 ? 's' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-gray-400">
            Sample duration (seconds, max 120)
            <input
              type="number"
              min={10}
              max={120}
              value={seconds}
              onChange={(e) => setSeconds(Math.min(120, Math.max(10, parseInt(e.target.value, 10) || 30)))}
              className="mt-1 w-full bg-black border border-[#333] rounded px-3 py-2 text-white"
              disabled={running}
            />
          </label>
          <button
            type="button"
            disabled={running}
            onClick={handleRun}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white text-black rounded text-sm font-medium disabled:opacity-50"
          >
            <Play className="w-4 h-4" /> {running ? 'Running…' : 'Run benchmark'}
          </button>
        </div>

        {report && (
          <div className="bg-[#111] border border-[#333] rounded-lg p-5 space-y-4">
            <div className="flex justify-between items-start gap-3 flex-wrap">
              <div>
                <h2 className="text-lg font-semibold text-white">Last report</h2>
                <p className="text-xs text-gray-500 mt-1">
                  {report.targetChannels} channels · {report.durationSec}s · {report.id}
                </p>
              </div>
              <button
                type="button"
                onClick={downloadReport}
                className="inline-flex items-center gap-2 px-3 py-2 border border-[#333] rounded text-sm text-gray-300 hover:text-white"
              >
                <Download className="w-4 h-4" /> Download JSON
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Avg CPU" value={`${report.summary.avgSystemCpu}%`} />
              <Stat label="Peak CPU" value={`${report.summary.peakSystemCpu}%`} />
              <Stat label="Avg RAM" value={`${report.summary.avgRamPct}%`} />
              <Stat label="Peak RAM" value={`${report.summary.peakRamPct}%`} />
              <Stat label="Avg FFmpeg CPU" value={`${report.summary.avgFfmpegCpu}%`} />
              <Stat label="Peak FFmpeg CPU" value={`${report.summary.peakFfmpegCpu}%`} />
              <Stat label="Disk write est." value={`${report.summary.diskWriteEstimateKbPerSec} KB/s`} />
            </div>

            <p
              className={`text-sm font-medium ${
                report.recommendation.startsWith('CRITICAL')
                  ? 'text-red-400'
                  : report.recommendation.startsWith('WARNING')
                    ? 'text-yellow-400'
                    : 'text-emerald-400'
              }`}
            >
              {report.recommendation}
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black/40 border border-[#222] rounded p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-white mt-1">{value}</p>
    </div>
  );
}
