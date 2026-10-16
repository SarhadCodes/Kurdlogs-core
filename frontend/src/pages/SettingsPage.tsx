import React, { useCallback, useEffect, useState } from 'react';
import {
  Key,
  User,
  Shield,
  Eye,
  EyeOff,
  Server,
  Cpu,
  HardDrive,
  Radio,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { authApi, monitorApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import InstallAppCard from '../components/InstallAppCard';
import LoadingSpinner from '../components/LoadingSpinner';
import toast from 'react-hot-toast';
import type { SystemStats } from '../types';

const APP_VERSION = '1.0.0';
const MIN_PASSWORD_LENGTH = 6;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function SettingsCard({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description?: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[#2a2a2a] bg-[#0d0d0d] overflow-hidden shadow-lg shadow-black/20">
      <div className="px-5 sm:px-6 py-4 border-b border-[#222] bg-gradient-to-r from-[#141414] to-[#0d0d0d]">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-white/5 border border-white/10">
            <Icon className="w-4 h-4 text-gray-300" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">{title}</h2>
            {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
          </div>
        </div>
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  show,
  onToggleShow,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-400 mb-1.5">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          required
          autoComplete={id.includes('current') ? 'current-password' : 'new-password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2.5 pr-10 bg-black/60 border border-[#333] rounded-lg text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-white/20 focus:border-gray-500 text-sm"
        />
        <button
          type="button"
          onClick={onToggleShow}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-500 hover:text-gray-300 rounded-md"
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { user, checkAuth, setUser } = useAuthStore();
  const [profileLoading, setProfileLoading] = useState(false);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const refreshProfile = useCallback(async () => {
    setProfileLoading(true);
    try {
      const res = await authApi.getMe();
      if (res.data) {
        setUser(res.data);
        toast.success('Profile refreshed');
      }
    } catch {
      toast.error('Failed to refresh profile');
    } finally {
      setProfileLoading(false);
    }
  }, [setUser]);

  const loadSystemStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await monitorApi.getSystemStats();
      setSystemStats(res.data || null);
    } catch {
      setSystemStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSystemStats();
  }, [loadSystemStats]);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      toast.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }
    if (newPassword === currentPassword) {
      toast.error('New password must be different from the current password');
      return;
    }

    setIsSubmitting(true);
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      toast.success('Password updated successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await checkAuth();
    } catch (err: any) {
      toast.error(err?.error || err?.message || 'Failed to change password');
    } finally {
      setIsSubmitting(false);
    }
  };

  const environment =
    import.meta.env.MODE === 'production'
      ? window.location.hostname === 'localhost'
        ? 'Production (local)'
        : 'Production'
      : 'Development';

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6">
        <PageHeader
          title="Settings"
          description="Account, security, install app, and system overview"
        />

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 space-y-5">
            <SettingsCard title="Profile" description="Your dashboard account" icon={User}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-5">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#222] to-[#111] border border-[#333] flex items-center justify-center text-2xl font-bold text-white shrink-0">
                  {user?.username?.charAt(0).toUpperCase() || 'U'}
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <p className="text-xl font-semibold text-white truncate">{user?.username}</p>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                      user?.role === 'ADMIN'
                        ? 'bg-white/10 text-white border-white/20'
                        : 'bg-gray-500/10 text-gray-300 border-gray-500/20'
                    }`}
                  >
                    {user?.role === 'ADMIN' ? <Shield className="w-3 h-3" /> : <User className="w-3 h-3" />}
                    {user?.role?.toLowerCase() || 'user'}
                  </span>
                  {user?.mustChangePassword && (
                    <p className="text-xs text-amber-400/90">
                      You should change your password in the Security section below.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={refreshProfile}
                  disabled={profileLoading}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm border border-[#333] rounded-lg text-gray-300 hover:text-white hover:border-[#555] disabled:opacity-50 shrink-0"
                >
                  <RefreshCw className={`w-4 h-4 ${profileLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
            </SettingsCard>

            <SettingsCard
              title="Security"
              description="Change password and keep your account safe"
              icon={Key}
            >
              <form onSubmit={handlePasswordChange} className="space-y-4 max-w-md">
                <PasswordField
                  id="current-password"
                  label="Current password"
                  value={currentPassword}
                  onChange={setCurrentPassword}
                  show={showCurrent}
                  onToggleShow={() => setShowCurrent((v) => !v)}
                />
                <PasswordField
                  id="new-password"
                  label="New password"
                  value={newPassword}
                  onChange={setNewPassword}
                  show={showNew}
                  onToggleShow={() => setShowNew((v) => !v)}
                />
                <p className="text-xs text-gray-500 -mt-2">Minimum {MIN_PASSWORD_LENGTH} characters</p>
                <PasswordField
                  id="confirm-password"
                  label="Confirm new password"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  show={showConfirm}
                  onToggleShow={() => setShowConfirm((v) => !v)}
                />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-black text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 min-h-[44px]"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Update password
                    </>
                  )}
                </button>
              </form>
            </SettingsCard>
          </div>

          <div className="space-y-5">
            <InstallAppCard />

            <SettingsCard title="About KurdLogs Core" description="Media server control panel" icon={Server}>
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 rounded-xl bg-[#111] border border-[#222]">
                  <div className="w-14 h-14 rounded-xl bg-black border border-[#333] flex items-center justify-center">
                    <Radio className="w-7 h-7 text-white" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-white">KurdLogs Core</p>
                    <p className="text-sm text-gray-500">Media Server</p>
                  </div>
                </div>
                <dl className="grid grid-cols-1 gap-3 text-sm">
                  <div className="px-4 py-3 rounded-lg bg-[#111] border border-[#222]">
                    <dt className="text-gray-500 text-xs uppercase tracking-wide">Version</dt>
                    <dd className="text-white font-medium mt-1">{APP_VERSION}</dd>
                  </div>
                  <div className="px-4 py-3 rounded-lg bg-[#111] border border-[#222]">
                    <dt className="text-gray-500 text-xs uppercase tracking-wide">Environment</dt>
                    <dd className="text-white font-medium mt-1">{environment}</dd>
                  </div>
                </dl>
                <p className="text-sm text-gray-400 leading-relaxed">
                  KurdLogs Core is a professional media server platform for live channels, playlists,
                  transcoding, overlays, and stream delivery over HLS and DASH.
                </p>
                <Link to="/install" className="text-sm text-gray-300 underline hover:text-white">
                  Install app help
                </Link>
              </div>
            </SettingsCard>

            <SettingsCard title="System info" description="Live snapshot from this instance" icon={Cpu}>
              {statsLoading ? (
                <LoadingSpinner />
              ) : systemStats ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-4 rounded-lg bg-[#111] border border-[#222] text-center">
                      <Cpu className="w-5 h-5 text-gray-500 mx-auto mb-2" />
                      <p className="text-lg font-semibold text-white">{systemStats.cpu.toFixed(1)}%</p>
                      <p className="text-xs text-gray-500">CPU</p>
                    </div>
                    <div className="p-4 rounded-lg bg-[#111] border border-[#222] text-center">
                      <HardDrive className="w-5 h-5 text-gray-500 mx-auto mb-2" />
                      <p className="text-lg font-semibold text-white">{systemStats.ram.toFixed(1)}%</p>
                      <p className="text-xs text-gray-500">RAM</p>
                    </div>
                    <div className="p-4 rounded-lg bg-[#111] border border-[#222] text-center">
                      <Radio className="w-5 h-5 text-gray-500 mx-auto mb-2" />
                      <p className="text-lg font-semibold text-white">{systemStats.activeChannels}</p>
                      <p className="text-xs text-gray-500">Active streams</p>
                    </div>
                    <div className="p-4 rounded-lg bg-[#111] border border-[#222] text-center">
                      <Server className="w-5 h-5 text-gray-500 mx-auto mb-2" />
                      <p className="text-lg font-semibold text-white">{formatUptime(systemStats.uptime)}</p>
                      <p className="text-xs text-gray-500">Host uptime</p>
                    </div>
                  </div>
                  <p className="text-xs text-gray-600 mt-3">
                    Memory: {formatBytes(systemStats.usedMem)} / {formatBytes(systemStats.totalMem)} used
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray-500">Could not load server stats.</p>
              )}
              <button
                type="button"
                onClick={loadSystemStats}
                disabled={statsLoading}
                className="mt-4 inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white"
              >
                <RefreshCw className={`w-4 h-4 ${statsLoading ? 'animate-spin' : ''}`} />
                Refresh stats
              </button>
            </SettingsCard>
          </div>
        </div>
      </div>
    </Layout>
  );
}
