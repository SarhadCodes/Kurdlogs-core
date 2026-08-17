import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Files,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { monitorApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import type { StorageCleanupTargetId, StorageReport, StorageStatus } from '../types';

const statusStyles: Record<StorageStatus, { text: string; badge: string; bar: string }> = {
  HEALTHY: {
    text: 'Storage healthy',
    badge: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
    bar: 'bg-emerald-400',
  },
  WARNING: {
    text: 'Storage running low',
    badge: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
    bar: 'bg-amber-400',
  },
  CRITICAL: {
    text: 'Storage critical',
    badge: 'text-red-300 bg-red-500/10 border-red-500/20',
    bar: 'bg-red-400',
  },
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unit;
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[unit]}`;
}

export default function StoragePanel() {
  const user = useAuthStore((state) => state.user);
  const [report, setReport] = useState<StorageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [selected, setSelected] = useState<Set<StorageCleanupTargetId>>(new Set());
  const initializedSelection = useRef(false);

  const load = async (force = false) => {
    if (force) setRefreshing(true);
    try {
      const response = await monitorApi.getStorage(force);
      if (response.data) {
        setReport(response.data);
        if (!initializedSelection.current) {
          setSelected(new Set(
            response.data.cleanup.targets
              .filter((target) => target.bytes > 0 || target.fileCount > 0 || target.rowCount > 0)
              .map((target) => target.id)
          ));
          initializedSelection.current = true;
        }
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Failed to read storage');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const interval = window.setInterval(() => load(), 5 * 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const selectedTargets = useMemo(
    () => report?.cleanup.targets.filter((target) => selected.has(target.id)) || [],
    [report, selected]
  );
  const selectedBytes = selectedTargets.reduce((sum, target) => sum + target.bytes, 0);
  const selectedRows = selectedTargets.reduce((sum, target) => sum + target.rowCount, 0);

  const toggleTarget = (id: StorageCleanupTargetId) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const cleanStorage = async () => {
    if (selected.size === 0) return;
    const details = [
      selectedBytes > 0 ? formatBytes(selectedBytes) : '',
      selectedRows > 0 ? `${selectedRows.toLocaleString()} old monitoring rows` : '',
    ].filter(Boolean).join(' and ');
    if (!window.confirm(`Clear ${details || 'the selected storage data'}? Active streams and playlist media are protected.`)) return;

    setCleaning(true);
    try {
      const response = await monitorApi.cleanupStorage([...selected]);
      if (response.data) {
        setReport(response.data.storage);
        setSelected(new Set());
        const parts = [
          response.data.freedBytes > 0 ? `${formatBytes(response.data.freedBytes)} freed` : '',
          response.data.deletedFiles > 0 ? `${response.data.deletedFiles} files removed` : '',
          response.data.removedRows > 0 ? `${response.data.removedRows.toLocaleString()} history rows removed` : '',
        ].filter(Boolean);
        toast.success(parts.join(' · ') || 'Storage is already clean');
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Storage cleanup failed');
    } finally {
      setCleaning(false);
    }
  };

  if (loading) return <div className="h-64 animate-pulse rounded-xl border border-[#2a2a2a] bg-[#111]" />;
  if (!report) return null;

  const { filesystem, application, cleanup } = report;
  const status = statusStyles[filesystem.status];

  return (
    <section className="overflow-hidden rounded-xl border border-[#2d2d2d] bg-[#101010]">
      <div className="flex flex-col gap-3 border-b border-[#292929] bg-[#151515] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-white">
            <HardDrive className="h-5 w-5" /> Storage
          </h2>
          <p className="mt-1 text-xs text-gray-500">Filesystem capacity, KurdLogs usage, and protected cleanup</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${status.badge}`}>{status.text}</span>
          <button
            type="button"
            onClick={() => load(true)}
            disabled={refreshing}
            className="rounded-md border border-[#333] p-2 text-gray-400 hover:border-[#555] hover:text-white disabled:opacity-50"
            aria-label="Rescan storage"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="grid gap-0 xl:grid-cols-[1.25fr_1fr]">
        <div className="space-y-6 border-b border-[#292929] p-5 xl:border-b-0 xl:border-r">
          <div className="grid gap-4 sm:grid-cols-3">
            <Metric label="Available" value={formatBytes(filesystem.availableBytes)} accent="text-white" />
            <Metric label="Used" value={formatBytes(filesystem.usedBytes)} />
            <Metric label="Total" value={formatBytes(filesystem.totalBytes)} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="text-gray-400">Filesystem usage</span>
              <span className="font-mono text-gray-300">{filesystem.usagePercent.toFixed(1)}%</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-[#252525]">
              <div className={`h-full rounded-full transition-all duration-500 ${status.bar}`} style={{ width: `${Math.min(100, filesystem.usagePercent)}%` }} />
            </div>
            <p className="mt-2 text-xs text-gray-600">Available space is what the server can safely allocate. Reserved filesystem space is excluded.</p>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-medium text-gray-200">
                <Database className="h-4 w-4 text-gray-500" /> KurdLogs managed files
              </h3>
              <span className="text-xs text-gray-500">{formatBytes(application.totalBytes)} · {application.fileCount.toLocaleString()} files</span>
            </div>
            <div className="mb-4 flex h-2.5 overflow-hidden rounded-full bg-[#252525]">
              {application.categories.map((category) => (
                <div
                  key={category.id}
                  title={`${category.label}: ${formatBytes(category.bytes)}`}
                  style={{ width: application.totalBytes > 0 ? `${(category.bytes / application.totalBytes) * 100}%` : '0%', backgroundColor: category.color }}
                />
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {application.categories.map((category) => (
                <div key={category.id} className="flex items-center justify-between rounded-lg border border-[#252525] bg-[#0c0c0c] px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: category.color }} />
                    <span className="truncate text-xs text-gray-400">{category.label}</span>
                  </div>
                  <div className="ml-3 text-right">
                    <p className="text-xs font-medium text-gray-200">{formatBytes(category.bytes)}</p>
                    <p className="text-[10px] text-gray-600">{category.fileCount.toLocaleString()} files</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between rounded-lg border border-dashed border-[#303030] px-3 py-2 text-xs">
              <span className="text-gray-500">System, database, Docker, and other files</span>
              <span className="text-gray-300">{formatBytes(application.otherSystemBytes)}</span>
            </div>
          </div>
        </div>

        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h3 className="flex items-center gap-2 font-medium text-white"><Trash2 className="h-4 w-4" /> Safe cleanup</h3>
              <p className="mt-1 text-xs text-gray-500">{formatBytes(cleanup.reclaimableBytes)} in {cleanup.reclaimableFiles.toLocaleString()} removable files</p>
            </div>
            <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400" />
          </div>

          <div className="space-y-2">
            {cleanup.targets.map((target) => {
              const hasWork = target.bytes > 0 || target.fileCount > 0 || target.rowCount > 0;
              return (
                <label key={target.id} className={`flex gap-3 rounded-lg border p-3 transition-colors ${hasWork ? 'cursor-pointer border-[#2d2d2d] bg-[#0c0c0c] hover:border-[#444]' : 'border-[#232323] bg-[#0a0a0a] opacity-55'}`}>
                  <input
                    type="checkbox"
                    checked={selected.has(target.id)}
                    disabled={!hasWork || user?.role !== 'ADMIN'}
                    onChange={() => toggleTarget(target.id)}
                    className="mt-1 h-4 w-4 accent-emerald-400"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-sm font-medium text-gray-200">{target.label}</span>
                      <span className="shrink-0 text-xs font-medium text-gray-300">
                        {target.bytes > 0 ? formatBytes(target.bytes) : target.rowCount > 0 ? `${target.rowCount.toLocaleString()} rows` : 'Clean'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-gray-600">{target.description}</p>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-500/15 bg-emerald-500/[0.06] p-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <p className="text-xs leading-5 text-emerald-100/70">Active manifests, current HLS segments, ready playlist videos, logos, and station IDs are always protected.</p>
          </div>

          {user?.role === 'ADMIN' ? (
            <button
              type="button"
              onClick={cleanStorage}
              disabled={cleaning || selected.size === 0}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-white px-4 py-2.5 text-sm font-medium text-black hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {cleaning ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {cleaning ? 'Cleaning safely…' : `Clear selected${selectedBytes > 0 ? ` · ${formatBytes(selectedBytes)}` : ''}`}
            </button>
          ) : (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-3 text-xs text-amber-200/80">
              <AlertTriangle className="h-4 w-4 shrink-0" /> Administrator access is required to clear storage.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value, accent = 'text-gray-200' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-[#292929] bg-[#0b0b0b] p-4">
      <div className="mb-2 flex items-center gap-2 text-xs text-gray-500"><Files className="h-3.5 w-3.5" /> {label}</div>
      <p className={`text-xl font-semibold ${accent}`}>{value}</p>
    </div>
  );
}
