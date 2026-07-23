import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  HardDrive,
  Cpu,
  MemoryStick as Memory,
  Clock,
  RefreshCw,
  Download,
  Upload,
  Zap,
  Tv2,
} from 'lucide-react';
import { monitorApi } from '../services/api';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import LogViewer from '../components/LogViewer';
import BoostPanel from '../components/BoostPanel';
import { SystemStats, StreamLog, ChannelHealthReport, HealthLevel } from '../types';
import toast from 'react-hot-toast';

type MonitoringTab = 'overview' | 'boost';

const healthStyles: Record<HealthLevel, string> = {
  EXCELLENT: 'text-emerald-400 bg-emerald-900/30',
  GOOD: 'text-blue-400 bg-blue-900/30',
  WARNING: 'text-yellow-400 bg-yellow-900/30',
  CRITICAL: 'text-red-400 bg-red-900/30',
};

export default function MonitoringPage() {
  const [tab, setTab] = useState<MonitoringTab>('overview');
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [health, setHealth] = useState<ChannelHealthReport[]>([]);
  const [logs, setLogs] = useState<StreamLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [backupBusy, setBackupBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchMonitoringData = async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const [statsRes, logsRes, healthRes] = await Promise.all([
        monitorApi.getSystemStats(),
        monitorApi.getLogs(100),
        monitorApi.getChannelHealth(),
      ]);
      if (statsRes.data) setStats(statsRes.data);
      if (logsRes.data) setLogs(logsRes.data);
      if (healthRes.data) setHealth(healthRes.data);
    } catch {
      if (!silent) toast.error('Failed to refresh monitoring');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (tab !== 'overview') return;
    fetchMonitoringData(true);
    if (!autoRefresh) return;
    const interval = setInterval(() => fetchMonitoringData(true), 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, tab]);

  const handleExportAppLogs = async () => {
    try {
      const blob = await monitorApi.exportAppLogs();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kurdlogs-app-logs-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('App logs exported');
    } catch {
      toast.error('Failed to export app logs');
    }
  };

  const handleExportBackup = async () => {
    setBackupBusy(true);
    try {
      const blob = await monitorApi.exportBackup();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      a.href = url;
      a.download = `kurdlogs-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Backup exported');
    } catch {
      toast.error('Failed to export backup');
    } finally {
      setBackupBusy(false);
    }
  };

  const handleImportBackupFile = async (file?: File | null) => {
    if (!file) return;
    const ok = window.confirm(
      'Import backup now? This will overwrite existing records with the same IDs.'
    );
    if (!ok) return;

    setBackupBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      await monitorApi.importBackup(parsed);
      toast.success('Backup imported');
      await fetchMonitoringData(true);
    } catch {
      toast.error('Failed to import backup');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
      setBackupBusy(false);
    }
  };

  if (loading && tab === 'overview') return <Layout><LoadingSpinner /></Layout>;

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2 flex-wrap">
              <Activity className="w-6 h-6 shrink-0" /> Monitoring
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              {tab === 'overview'
                ? 'Real-time system health, backup, and stream logs'
                : 'Scale encoding and streaming across multiple VPS workers'}
            </p>
          </div>
          {tab === 'overview' && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => fetchMonitoringData()}
                disabled={refreshing}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-[#333] rounded-md text-gray-300 hover:text-white hover:border-[#555] disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                type="button"
                onClick={handleExportAppLogs}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-[#333] rounded-md text-gray-300 hover:text-white hover:border-[#555]"
              >
                <Download className="w-4 h-4" />
                App logs
              </button>
              <button
                type="button"
                onClick={handleExportBackup}
                disabled={backupBusy}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-[#333] rounded-md text-gray-300 hover:text-white hover:border-[#555] disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                Export backup
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={backupBusy}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-[#333] rounded-md text-gray-300 hover:text-white hover:border-[#555] disabled:opacity-50"
              >
                <Upload className="w-4 h-4" />
                Import backup
              </button>
              <label className="inline-flex items-center gap-2 text-xs text-gray-400 ml-1">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="accent-white"
                />
                Auto refresh
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => handleImportBackupFile(e.target.files?.[0])}
              />
            </div>
          )}
        </div>

        <div className="flex gap-1 p-1 bg-[#111] border border-[#333] rounded-lg w-fit">
          <TabButton active={tab === 'overview'} onClick={() => setTab('overview')} icon={Activity}>
            Overview
          </TabButton>
          <TabButton active={tab === 'boost'} onClick={() => setTab('boost')} icon={Zap}>
            Boost
          </TabButton>
        </div>

        {tab === 'boost' ? (
          <BoostPanel />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-[#111111] border border-[#333333] rounded-lg p-5">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-gray-400 font-medium flex items-center gap-2">
                    <Cpu className="w-5 h-5" /> CPU Usage
                  </h3>
                  <span className="text-2xl font-bold text-white">{stats?.cpu?.toFixed(1) || 0}%</span>
                </div>
                <div className="w-full bg-[#222222] rounded-full h-2">
                  <div
                    className="bg-white h-2 rounded-full transition-all duration-500"
                    style={{ width: `${stats?.cpu || 0}%` }}
                  />
                </div>
              </div>

              <div className="bg-[#111111] border border-[#333333] rounded-lg p-5">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-gray-400 font-medium flex items-center gap-2">
                    <Memory className="w-5 h-5" /> Memory
                  </h3>
                  <span className="text-2xl font-bold text-white">
                    {stats ? Math.round((stats.usedMem / stats.totalMem) * 100) : 0}%
                  </span>
                </div>
                <div className="w-full bg-[#222222] rounded-full h-2">
                  <div
                    className="bg-white h-2 rounded-full transition-all duration-500"
                    style={{ width: `${stats ? (stats.usedMem / stats.totalMem) * 100 : 0}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-3 text-right">
                  {stats ? (stats.usedMem / (1024 ** 3)).toFixed(1) : 0} GB /{' '}
                  {stats ? (stats.totalMem / (1024 ** 3)).toFixed(1) : 0} GB
                </p>
              </div>

              <div className="bg-[#111111] border border-[#333333] rounded-lg p-5">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-gray-400 font-medium flex items-center gap-2">
                    <Clock className="w-5 h-5" /> System Uptime
                  </h3>
                </div>
                <div className="text-3xl font-bold text-white mt-2">
                  {stats ? Math.floor(stats.uptime / 3600) : 0}h{' '}
                  {stats ? Math.floor((stats.uptime % 3600) / 60) : 0}m
                </div>
              </div>
              <div className="bg-[#111111] border border-[#333333] rounded-lg p-5">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-gray-400 font-medium flex items-center gap-2">
                    <Tv2 className="w-5 h-5" /> Active Channels
                  </h3>
                  <span className="text-2xl font-bold text-white">{stats?.activeChannels ?? 0}</span>
                </div>
              </div>
            </div>

            <div className="bg-[#111111] border border-[#333333] rounded-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-[#333333] bg-[#1a1a1a]">
                <h3 className="font-medium text-white">Channel health</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-gray-500 text-left">
                    <tr>
                      <th className="px-4 py-3">Channel</th>
                      <th className="px-4 py-3">Playback</th>
                      <th className="px-4 py-3">Health</th>
                      <th className="px-4 py-3">CPU</th>
                      <th className="px-4 py-3">Bitrate</th>
                      <th className="px-4 py-3">Speed</th>
                      <th className="px-4 py-3">Viewers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {health.map((ch) => (
                      <tr key={ch.channelId} className="border-t border-[#222] align-top">
                        <td className="px-4 py-3 text-white">{ch.name}</td>
                        <td className="px-4 py-3">
                          <PlaybackCell playback={ch.playback} />
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-1 rounded ${healthStyles[ch.health]}`}>
                            {ch.health} ({ch.healthScore})
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-400">{ch.cpu.toFixed(1)}%</td>
                        <td className="px-4 py-3 text-gray-400">{ch.bitrate} kbps</td>
                        <td className="px-4 py-3 text-gray-400">{ch.speed}</td>
                        <td className="px-4 py-3 text-gray-400">{ch.viewers}</td>
                      </tr>
                    ))}
                    {health.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                          No channels configured
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-[#111111] border border-[#333333] rounded-lg overflow-hidden flex flex-col h-[min(500px,55vh)] sm:h-[500px]">
              <div className="px-5 py-4 border-b border-[#333333] flex justify-between items-center bg-[#1a1a1a]">
                <h3 className="font-medium text-white flex items-center gap-2">
                  <HardDrive className="w-4 h-4" /> Global Stream Logs
                </h3>
                <span className="text-xs bg-[#222222] text-gray-400 px-2 py-1 rounded">
                  Last 100 entries
                </span>
              </div>
              <div className="flex-1 p-0 overflow-hidden">
                <LogViewer logs={logs} />
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

function PlaybackCell({ playback }: { playback?: ChannelHealthReport['playback'] }) {
  if (!playback) {
    return <span className="text-gray-600 text-xs">—</span>;
  }

  const isBlueprint = playback.playbackSource === 'BLUEPRINT';

  return (
    <div className="text-xs space-y-1 min-w-[180px]">
      <p className={`font-medium ${isBlueprint ? 'text-violet-400' : 'text-blue-400'}`}>
        {playback.playbackSource}
      </p>
      {isBlueprint && playback.blueprintName && (
        <p className="text-gray-500">{playback.blueprintName}</p>
      )}
      {playback.currentBlock && (
        <p className="text-gray-400">
          <span className="text-gray-600">Block:</span> {playback.currentBlock}
        </p>
      )}
      {playback.currentAsset && (
        <p className="text-gray-400 truncate max-w-[200px]" title={playback.currentAsset}>
          <span className="text-gray-600">Now:</span> {playback.currentAsset}
        </p>
      )}
      {playback.nextBlock && (
        <p className="text-gray-500">
          <span className="text-gray-600">Next:</span> {playback.nextBlock}
          {playback.nextAsset ? ` · ${playback.nextAsset}` : ''}
        </p>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
        active ? 'bg-[#1a1a1a] text-white' : 'text-gray-500 hover:text-white'
      }`}
    >
      <Icon className="w-4 h-4" />
      {children}
    </button>
  );
}
