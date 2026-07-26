import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  Camera,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { authApi, monitorApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import InstallAppCard from '../components/InstallAppCard';
import LoadingSpinner from '../components/LoadingSpinner';
import MfaBackupCodesPanel from '../components/MfaBackupCodesPanel';
import toast from 'react-hot-toast';
import type { SystemStats } from '../types';
import { resolveAvatarUrl, userDisplayName, userInitials } from '../utils/userProfile';
import { BUILD_VERSION } from '../config/buildVersion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const MIN_PASSWORD_LENGTH = 12;

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
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm dark:shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
      <div className="border-b border-border bg-muted/30 px-5 py-4 sm:px-6">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-border bg-background p-2.5 shadow-sm">
            <Icon className="h-4 w-4 text-foreground/80" />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
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
          className="w-full px-3.5 py-3 pr-10 bg-black/40 border border-white/10 rounded-xl text-white placeholder-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400/15 focus:border-emerald-400/40 text-sm"
        />
        <button
          type="button"
          onClick={onToggleShow}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-500 hover:text-emerald-200 rounded-lg transition-colors"
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
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [mfaQr, setMfaQr] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [regenPassword, setRegenPassword] = useState('');
  const [regenCode, setRegenCode] = useState('');
  const [showRegenForm, setShowRegenForm] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);

  useEffect(() => {
    setDisplayName(user?.displayName || '');
  }, [user?.displayName]);

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

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await authApi.updateProfile({ displayName: displayName.trim() });
      if (res.data) setUser(res.data);
      toast.success('Profile updated');
    } catch (err: any) {
      toast.error(typeof err === 'string' ? err : err?.message || 'Failed to update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be 5 MB or smaller');
      return;
    }

    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await authApi.uploadAvatar(formData);
      if (res.data) setUser(res.data);
      toast.success('Profile picture updated');
    } catch (err: any) {
      toast.error(typeof err === 'string' ? err : err?.message || 'Failed to upload picture');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      toast.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (!/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      toast.error('Password must include uppercase, lowercase, and a number');
      return;
    }
    if (user?.username && newPassword.toLowerCase().includes(user.username.toLowerCase())) {
      toast.error('Password must not contain your username');
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
      const res = await authApi.changePassword({ currentPassword, newPassword });
      if (res.data) setUser(res.data);
      toast.success('Password updated successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await checkAuth();
    } catch (err: any) {
      toast.error(err?.error || err?.message || (typeof err === 'string' ? err : 'Failed to change password'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMfaSetup = async () => {
    setMfaBusy(true);
    try {
      const res = await authApi.setupMfa();
      setMfaSecret(res.data?.secret || null);
      setMfaQr(res.data?.qrDataUrl || null);
      setBackupCodes(null);
      toast.success('Scan the QR code with your authenticator app');
    } catch (err: any) {
      toast.error(err?.message || (typeof err === 'string' ? err : 'Failed to start MFA setup'));
    } finally {
      setMfaBusy(false);
    }
  };

  const handleMfaEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaCode.trim()) {
      toast.error('Enter the authenticator code');
      return;
    }
    setMfaBusy(true);
    try {
      const res = await authApi.enableMfa(mfaCode.trim());
      if (res.data?.user) setUser(res.data.user);
      setBackupCodes(res.data?.backupCodes || null);
      setMfaCode('');
      setMfaSecret(null);
      setMfaQr(null);
      toast.success('MFA enabled');
      await checkAuth();
    } catch (err: any) {
      toast.error(err?.message || (typeof err === 'string' ? err : 'Invalid code'));
    } finally {
      setMfaBusy(false);
    }
  };

  const handleMfaDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setMfaBusy(true);
    try {
      const res = await authApi.disableMfa({ password: disablePassword, code: disableCode });
      if (res.data) setUser(res.data);
      setDisablePassword('');
      setDisableCode('');
      setBackupCodes(null);
      toast.success('MFA disabled');
      await checkAuth();
    } catch (err: any) {
      toast.error(err?.message || (typeof err === 'string' ? err : 'Failed to disable MFA'));
    } finally {
      setMfaBusy(false);
    }
  };

  const handleRegenerateBackupCodes = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!regenPassword.trim() || !regenCode.trim()) {
      toast.error('Enter your password and authenticator code');
      return;
    }
    setRegenBusy(true);
    try {
      const res = await authApi.regenerateBackupCodes({
        password: regenPassword,
        code: regenCode.trim(),
      });
      setBackupCodes(res.data?.backupCodes || null);
      setRegenPassword('');
      setRegenCode('');
      setShowRegenForm(false);
      toast.success('New backup codes generated — previous codes no longer work');
    } catch (err: any) {
      toast.error(err?.message || (typeof err === 'string' ? err : 'Failed to regenerate codes'));
    } finally {
      setRegenBusy(false);
    }
  };

  const environment =
    import.meta.env.MODE === 'production'
      ? window.location.hostname === 'localhost'
        ? 'Production (local)'
        : 'Production'
      : 'Development';

  const avatarSrc = resolveAvatarUrl(user?.avatarUrl);

  return (
    <Layout>
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          title="Settings"
          description="Account, security, install app, and system overview"
        />

        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
          <div className="xl:col-span-3 space-y-6">
            <SettingsCard title="Profile" description="Name and picture shown in the side menu" icon={User}>
              <form onSubmit={handleSaveProfile} className="space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-start gap-5">
                  <div className="relative shrink-0">
                    {avatarSrc ? (
                      <img
                        src={avatarSrc}
                        alt=""
                        className="h-20 w-20 rounded-2xl object-cover border border-white/10"
                      />
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-2xl font-bold text-zinc-200">
                        {userInitials(user)}
                      </div>
                    )}
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAvatarChange}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="mt-3 w-full gap-1.5"
                      disabled={uploadingAvatar}
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      <Camera className="h-3.5 w-3.5" />
                      {uploadingAvatar ? 'Uploading…' : 'Change photo'}
                    </Button>
                  </div>

                  <div className="flex-1 min-w-0 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="display-name">Display name</Label>
                      <Input
                        id="display-name"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder={user?.username || 'Your name'}
                        maxLength={64}
                      />
                      <p className="text-xs text-zinc-500">
                        Shown in the sidebar. Login username stays <span className="text-zinc-300">@{user?.username}</span>.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                          user?.role === 'ADMIN'
                            ? 'bg-white/[0.06] text-zinc-200 border-white/15'
                            : 'bg-white/[0.05] text-gray-300 border-white/10'
                        }`}
                      >
                        {user?.role === 'ADMIN' ? <Shield className="w-3 h-3" /> : <User className="w-3 h-3" />}
                        {user?.role?.toLowerCase() || 'user'}
                      </span>
                      <span className="text-xs text-zinc-500">Preview: {userDisplayName({ username: user?.username || '', displayName })}</span>
                    </div>

                    {user?.mustChangePassword && (
                      <p className="text-xs text-amber-300/90">
                        You must change this password before using the panel.
                      </p>
                    )}
                    {user?.mfaRequired && !user?.mfaEnabled && !user?.mustChangePassword && (
                      <p className="text-xs text-amber-300/90">
                        Multi-factor authentication is required for your role. Set it up below.
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" disabled={savingProfile}>
                        {savingProfile ? 'Saving…' : 'Save profile'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={refreshProfile}
                        disabled={profileLoading}
                      >
                        <RefreshCw className={`w-4 h-4 ${profileLoading ? 'animate-spin' : ''}`} />
                        Refresh
                      </Button>
                    </div>
                  </div>
                </div>
              </form>
            </SettingsCard>

            <SettingsCard
              title="Security"
              description="Change password and keep your account safe"
              icon={Key}
            >
              <form onSubmit={handlePasswordChange} className="space-y-4 max-w-xl">
                <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.045] px-4 py-3 text-xs text-amber-100/75">
                  Use a unique password you do not use on other services.
                </div>
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
                <p className="text-xs text-zinc-500 -mt-2">
                  Minimum {MIN_PASSWORD_LENGTH} characters with uppercase, lowercase, and a number
                </p>
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
                  className="inline-flex items-center gap-2 px-5 py-3 bg-emerald-300 text-emerald-950 text-sm font-semibold rounded-xl hover:bg-emerald-200 transition-colors disabled:opacity-50 min-h-[46px] shadow-[0_10px_25px_rgba(74,222,128,.12)]"
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

              <div className="mt-8 border-t border-border pt-6 space-y-4 max-w-xl">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Multi-factor authentication</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {user?.mfaEnabled
                      ? 'MFA is enabled. Authenticator codes are required at sign-in.'
                      : user?.mfaRequired
                        ? 'Required for admin accounts. Scan a QR code with Google Authenticator, Authy, or similar.'
                        : 'Optional for your role. Improves account security.'}
                  </p>
                </div>

                {backupCodes && backupCodes.length > 0 && (
                  <MfaBackupCodesPanel
                    codes={backupCodes}
                    username={user?.username || 'user'}
                    onDismiss={() => setBackupCodes(null)}
                    allowRegenerate={Boolean(user?.mfaEnabled)}
                    regenerating={regenBusy}
                    onRegenerate={() => {
                      setBackupCodes(null);
                      setShowRegenForm(true);
                    }}
                  />
                )}

                {showRegenForm && user?.mfaEnabled && !backupCodes && (
                  <form
                    onSubmit={handleRegenerateBackupCodes}
                    className="rounded-xl border border-border bg-muted/20 px-4 py-3 space-y-3 max-w-xl"
                  >
                    <p className="text-xs text-muted-foreground">
                      Confirm with your password and authenticator to generate a new set. Previous codes will stop working.
                    </p>
                    <PasswordField
                      id="mfa-regen-password"
                      label="Current password"
                      value={regenPassword}
                      onChange={setRegenPassword}
                      show={showCurrent}
                      onToggleShow={() => setShowCurrent((v) => !v)}
                    />
                    <div className="space-y-2">
                      <Label htmlFor="mfa-regen-code">Authenticator code</Label>
                      <Input
                        id="mfa-regen-code"
                        value={regenCode}
                        onChange={(e) => setRegenCode(e.target.value)}
                        placeholder="123456"
                        autoComplete="one-time-code"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" size="sm" disabled={regenBusy}>
                        {regenBusy ? 'Generating…' : 'Generate & show codes'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setShowRegenForm(false);
                          setRegenPassword('');
                          setRegenCode('');
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}

                {!user?.mfaEnabled && (
                  <div className="space-y-4">
                    {!mfaQr ? (
                      <Button type="button" onClick={handleMfaSetup} disabled={mfaBusy || Boolean(user?.mustChangePassword)}>
                        {mfaBusy ? 'Preparing…' : 'Set up authenticator'}
                      </Button>
                    ) : (
                      <form onSubmit={handleMfaEnable} className="space-y-4">
                        {mfaQr && (
                          <img src={mfaQr} alt="MFA QR code" className="h-44 w-44 rounded-lg border border-border bg-white p-2" />
                        )}
                        {mfaSecret && (
                          <p className="text-xs text-muted-foreground break-all">
                            Manual key: <span className="font-mono text-foreground">{mfaSecret}</span>
                          </p>
                        )}
                        <div className="space-y-2">
                          <Label htmlFor="mfa-enable-code">Authenticator code</Label>
                          <Input
                            id="mfa-enable-code"
                            value={mfaCode}
                            onChange={(e) => setMfaCode(e.target.value)}
                            placeholder="123456"
                            autoComplete="one-time-code"
                          />
                        </div>
                        <Button type="submit" disabled={mfaBusy}>
                          {mfaBusy ? 'Verifying…' : 'Enable MFA'}
                        </Button>
                      </form>
                    )}
                    {user?.mustChangePassword && (
                      <p className="text-xs text-amber-300/90">Change your password first, then enable MFA.</p>
                    )}
                  </div>
                )}

                {user?.mfaEnabled && (
                  <div className="space-y-5">
                    {!backupCodes && !showRegenForm && (
                      <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 space-y-3">
                        <p className="text-xs text-muted-foreground">
                          Backup codes are only shown when created. Generate a new set anytime — old codes stop working.
                        </p>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setShowRegenForm(true)}>
                          View / regenerate backup codes
                        </Button>
                      </div>
                    )}

                    <form onSubmit={handleMfaDisable} className="space-y-3">
                      <p className="text-xs text-muted-foreground">
                        Disable only if needed. Admin roles will be asked to set MFA up again.
                      </p>
                      <PasswordField
                        id="mfa-disable-password"
                        label="Current password"
                        value={disablePassword}
                        onChange={setDisablePassword}
                        show={showCurrent}
                        onToggleShow={() => setShowCurrent((v) => !v)}
                      />
                      <div className="space-y-2">
                        <Label htmlFor="mfa-disable-code">Authenticator or backup code</Label>
                        <Input
                          id="mfa-disable-code"
                          value={disableCode}
                          onChange={(e) => setDisableCode(e.target.value)}
                          placeholder="123456"
                        />
                      </div>
                      <Button type="submit" variant="destructive" disabled={mfaBusy}>
                        {mfaBusy ? 'Disabling…' : 'Disable MFA'}
                      </Button>
                    </form>
                  </div>
                )}
              </div>
            </SettingsCard>
          </div>

          <div className="xl:col-span-2 space-y-6">
            <InstallAppCard />

            <SettingsCard title="About KurdLogs Core" description="Media server control panel" icon={Server}>
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 rounded-2xl bg-gradient-to-br from-white/[0.06] to-transparent border border-white/[0.08]">
                  <div className="w-14 h-14 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center">
                    <Radio className="w-7 h-7 text-zinc-200" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-white">KurdLogs Core</p>
                    <p className="text-sm text-gray-500">Media Server</p>
                  </div>
                </div>

                <div
                  className="rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 py-3"
                  title={`Deployment build: ${BUILD_VERSION}`}
                >
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    <CheckCircle2 size={12} strokeWidth={2.5} aria-hidden="true" />
                    System current
                  </div>
                  <p className="mt-1 text-sm font-medium text-white">Release v18.7.7</p>
                  <p className="mt-0.5 font-mono text-[11px] text-zinc-500">{BUILD_VERSION}</p>
                </div>

                <dl className="grid grid-cols-1 gap-3 text-sm">
                  <div className="px-4 py-3 rounded-xl bg-white/[0.035] border border-white/[0.07]">
                    <dt className="text-gray-500 text-xs uppercase tracking-wide">Environment</dt>
                    <dd className="text-white font-medium mt-1">{environment}</dd>
                  </div>
                </dl>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  KurdLogs Core is a professional media server platform for live channels, playlists,
                  transcoding, overlays, and stream delivery over HLS and DASH.
                </p>
                <Link to="/install" className="inline-flex text-sm font-medium text-zinc-300 hover:text-white transition-colors">
                  View installation guide →
                </Link>
              </div>
            </SettingsCard>

            <SettingsCard title="System info" description="Live snapshot from this instance" icon={Cpu}>
              {statsLoading ? (
                <LoadingSpinner />
              ) : systemStats ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-4 rounded-xl bg-white/[0.035] border border-white/[0.07] text-center">
                      <Cpu className="w-5 h-5 text-emerald-300/70 mx-auto mb-2" />
                      <p className="text-lg font-semibold text-white">{systemStats.cpu.toFixed(1)}%</p>
                      <p className="text-xs text-gray-500">CPU</p>
                    </div>
                    <div className="p-4 rounded-xl bg-white/[0.035] border border-white/[0.07] text-center">
                      <HardDrive className="w-5 h-5 text-emerald-300/70 mx-auto mb-2" />
                      <p className="text-lg font-semibold text-white">{systemStats.ram.toFixed(1)}%</p>
                      <p className="text-xs text-gray-500">RAM</p>
                    </div>
                    <div className="p-4 rounded-xl bg-white/[0.035] border border-white/[0.07] text-center">
                      <Radio className="w-5 h-5 text-emerald-300/70 mx-auto mb-2" />
                      <p className="text-lg font-semibold text-white">{systemStats.activeChannels}</p>
                      <p className="text-xs text-gray-500">Active streams</p>
                    </div>
                    <div className="p-4 rounded-xl bg-white/[0.035] border border-white/[0.07] text-center">
                      <Server className="w-5 h-5 text-emerald-300/70 mx-auto mb-2" />
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
                className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-zinc-400 hover:text-emerald-200 transition-colors"
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
