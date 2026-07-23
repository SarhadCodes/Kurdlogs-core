import { useCallback, useEffect, useState } from 'react';
import { Layers, RefreshCw } from 'lucide-react';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import { processingApi } from '../services/api';
import { wsService } from '../services/websocket';
import type { ProcessingJob } from '../types';
import toast from 'react-hot-toast';

const statusColor: Record<string, string> = {
  QUEUED: 'text-yellow-400 bg-yellow-900/30',
  PROCESSING: 'text-blue-400 bg-blue-900/30',
  COMPLETED: 'text-emerald-400 bg-emerald-900/30',
  FAILED: 'text-red-400 bg-red-900/30',
};

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function ProcessingPage() {
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [queuePending, setQueuePending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');

  const load = useCallback(async () => {
    try {
      const res = await processingApi.listJobs(80, filter || undefined);
      if (res.data) setJobs(res.data);
      if (res.meta?.queuePending != null) setQueuePending(res.meta.queuePending);
    } catch {
      toast.error('Failed to load processing jobs');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    const unsub = wsService.subscribe('processing:job', (payload: ProcessingJob) => {
      if (!payload?.id) return;
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.id === payload.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...payload };
          return next;
        }
        return [payload, ...prev].slice(0, 80);
      });
    });
    return unsub;
  }, []);

  if (loading) return <Layout><LoadingSpinner /></Layout>;

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
              <Layers className="w-6 h-6" /> Processing Queue
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              Unified ingest pipeline — {queuePending} job(s) waiting
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="bg-black border border-[#333] rounded px-3 py-2 text-sm text-white"
            >
              <option value="">All statuses</option>
              <option value="QUEUED">Queued</option>
              <option value="PROCESSING">Processing</option>
              <option value="COMPLETED">Completed</option>
              <option value="FAILED">Failed</option>
            </select>
            <button
              type="button"
              onClick={load}
              className="inline-flex items-center gap-2 px-3 py-2 border border-[#333] rounded text-sm text-gray-300 hover:text-white"
            >
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </div>
        </div>

        <div className="overflow-x-auto border border-[#333] rounded-lg">
          <table className="w-full text-sm text-left">
            <thead className="bg-[#1a1a1a] text-gray-400">
              <tr>
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Progress</th>
                <th className="px-4 py-3">Speed</th>
                <th className="px-4 py-3">Time / ETA</th>
                <th className="px-4 py-3">Started</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-t border-[#222] hover:bg-[#111]">
                  <td className="px-4 py-3 text-white max-w-[200px] truncate">
                    {job.playlistItem?.originalFilename || job.id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{job.type}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded ${statusColor[job.status] || ''}`}>
                      {job.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 min-w-[120px]">
                      <div className="flex-1 h-1.5 bg-[#222] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-white transition-all"
                          style={{ width: `${job.progressPct || 0}%` }}
                        />
                      </div>
                      <span className="text-gray-400 text-xs w-10">{job.progressPct || 0}%</span>
                    </div>
                    {job.currentFrame != null && (
                      <p className="text-xs text-gray-600 mt-1">frame {job.currentFrame}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{job.encodingSpeed || '—'}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {job.currentTimeSec != null ? formatTime(job.currentTimeSec) : '—'}
                    {job.etaSeconds != null && job.etaSeconds > 0 && (
                      <span className="block text-gray-600">ETA {Math.ceil(job.etaSeconds / 60)}m</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {job.startedAt ? new Date(job.startedAt).toLocaleString() : '—'}
                    {job.errorMessage && (
                      <p className="text-red-400 mt-1 max-w-xs truncate" title={job.errorMessage}>
                        {job.errorMessage}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                    No processing jobs yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
