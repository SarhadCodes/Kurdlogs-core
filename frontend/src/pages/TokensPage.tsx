import React, { useEffect, useState } from 'react';
import {
  Plus,
  Key,
  Copy,
  Trash2,
  RefreshCw,
  RotateCw,
  Link,
  Shield,
  Clock,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { copyToClipboard } from '../utils/clipboard';
import { buildTokenStreamUrl } from '../utils/streamUrl';
import { tokenApi, channelApi } from '../services/api';
import { Token, Channel } from '../types';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';

const TokensPage: React.FC = () => {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  // Form
  const [formChannelId, setFormChannelId] = useState('');
  const [formRefreshInterval, setFormRefreshInterval] = useState('60');

  const fetchData = async () => {
    try {
      const [tokenRes, channelRes] = await Promise.all([
        tokenApi.getAll(),
        channelApi.getAll(),
      ]);
      setTokens(tokenRes.data || []);
      setChannels(channelRes.data || []);
    } catch {
      toast.error('Failed to load tokens');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getChannelForToken = (token: Token): Channel | undefined => {
    return channels.find((c) => c.id === token.channelId);
  };

  const getSecureUrl = (token: Token): string => {
    const channel = getChannelForToken(token);
    const slug = channel?.slug || 'unknown';
    const manifest = channel?.outputType === 'DASH' ? 'manifest.mpd' : 'master.m3u8';
    return buildTokenStreamUrl(window.location.origin, slug, token.token, manifest);
  };

  const getStableIptvUrl = (token: Token): string => {
    const channel = getChannelForToken(token);
    const slug = channel?.slug || 'unknown';
    const manifest = channel?.outputType === 'DASH' ? 'manifest.mpd' : 'master.m3u8';
    return `${window.location.origin}/stream/play/${slug}/${manifest}?api_key=YOUR_IPTV_API_KEY`;
  };

  const handleCopy = (text: string, label: string) => {
    copyToClipboard(text, label);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formChannelId) {
      toast.error('Please select a channel');
      return;
    }

    setCreating(true);
    try {
      await tokenApi.create({
        channelId: formChannelId,
        refreshIntervalMinutes: parseInt(formRefreshInterval) || 60,
      });
      toast.success('Token created');
      setShowCreateModal(false);
      setFormChannelId('');
      setFormRefreshInterval('60');
      fetchData();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to create token');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await tokenApi.delete(deleteId);
      toast.success('Token deleted');
      setDeleteId(null);
      fetchData();
    } catch {
      toast.error('Failed to delete token');
    } finally {
      setDeleting(false);
    }
  };

  const handleRefresh = async (tokenId: string) => {
    setRefreshingId(tokenId);
    try {
      await tokenApi.refresh(tokenId);
      toast.success('Token refreshed — old token stays valid briefly for seamless handoff');
      fetchData();
    } catch {
      toast.error('Failed to refresh token');
    } finally {
      setRefreshingId(null);
    }
  };

  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    try {
      await tokenApi.refreshAll();
      toast.success('All tokens refreshed');
      fetchData();
    } catch {
      toast.error('Failed to refresh tokens');
    } finally {
      setRefreshingAll(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <LoadingSpinner />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          title="Stream Tokens"
          description={`${tokens.length} token${tokens.length !== 1 ? 's' : ''}`}
          actions={
            <>
              {tokens.length > 0 && (
                <button
                  onClick={handleRefreshAll}
                  disabled={refreshingAll}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[#222222] text-white text-sm rounded-md hover:bg-[#2a2a2a] border border-[#333333] transition-colors disabled:opacity-50 min-h-[44px]"
                >
                  <RotateCw className={`w-4 h-4 ${refreshingAll ? 'animate-spin' : ''}`} />
                  Refresh All
                </button>
              )}
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-black text-sm font-medium rounded-md hover:bg-gray-200 transition-colors min-h-[44px] flex-1 sm:flex-none"
              >
                <Plus className="w-4 h-4" />
                Create Token
              </button>
            </>
          }
        />

        {/* IPTV API */}
        <div className="bg-[#111111] border border-[#333333] rounded-lg p-5 space-y-3">
          <h2 className="text-sm font-medium text-white">IPTV app integration</h2>
          <p className="text-xs text-gray-500">
            Use a fixed play URL in your IPTV app (token rotates automatically). Set{' '}
            <code className="text-gray-400">IPTV_API_KEY</code> in docker-compose.
          </p>
          <div className="text-xs text-gray-400 space-y-1 font-mono">
            <p>GET {window.location.origin}/api/iptv/channels</p>
            <p>GET {window.location.origin}/api/iptv/channels/:slug/token</p>
            <p>Header: X-IPTV-Key: your-api-key</p>
          </div>
        </div>

        {/* Tokens List */}
        {tokens.length === 0 ? (
          <EmptyState
            icon={<Key className="w-12 h-12" />}
            title="No tokens yet"
            description="Create tokens to secure your stream URLs"
            action={
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-white text-black text-sm font-medium rounded-md hover:bg-gray-200 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create Token
              </button>
            }
          />
        ) : (
          <div className="space-y-3">
            {tokens.map((token) => {
              const channel = getChannelForToken(token);
              const secureUrl = getSecureUrl(token);
              const stableIptvUrl = getStableIptvUrl(token);
              const isRefreshing = refreshingId === token.id;

              return (
                <div
                  key={token.id}
                  className="bg-[#111111] border border-[#333333] rounded-lg p-5"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <Shield className="w-5 h-5 text-gray-400" />
                      <div>
                        <h3 className="text-white font-medium text-sm">
                          {channel?.name || 'Unknown Channel'}
                        </h3>
                        <p className="text-gray-500 text-xs mt-0.5 flex items-center gap-1.5">
                          <Clock className="w-3 h-3" />
                          Refresh every {token.refreshIntervalMinutes || 60} min
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleRefresh(token.id)}
                        disabled={isRefreshing}
                        className="p-1.5 text-gray-500 hover:text-white hover:bg-[#222222] rounded transition-colors disabled:opacity-50"
                        title="Refresh token"
                      >
                        <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                      </button>
                      <button
                        onClick={() => setDeleteId(token.id)}
                        className="p-1.5 text-gray-500 hover:text-red-500 hover:bg-[#222222] rounded transition-colors"
                        title="Delete token"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Token Value */}
                  <div className="mb-3">
                    <label className="text-xs text-gray-500 mb-1 block">Token</label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-3 py-2 bg-black rounded text-xs text-gray-400 font-mono overflow-x-auto">
                        {token.token}
                      </code>
                      <button
                        onClick={() => handleCopy(token.token, 'Token')}
                        className="p-2 bg-[#222222] hover:bg-[#2a2a2a] border border-[#333333] rounded-md transition-colors flex-shrink-0"
                      >
                        <Copy className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                    </div>
                  </div>

                  {/* Secure URL */}
                  <div className="mb-3">
                    <label className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                      <Link className="w-3 h-3" />
                      Direct stream URL (includes token)
                    </label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-3 py-2 bg-black rounded text-xs text-gray-400 font-mono overflow-x-auto">
                        {secureUrl}
                      </code>
                      <button
                        onClick={() => handleCopy(secureUrl, 'Stream URL')}
                        className="p-2 bg-[#222222] hover:bg-[#2a2a2a] border border-[#333333] rounded-md transition-colors flex-shrink-0"
                      >
                        <Copy className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                    </div>
                  </div>

                  {/* Stable IPTV URL */}
                  <div>
                    <label className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                      <Link className="w-3 h-3" />
                      IPTV play URL (fixed — auto token refresh)
                    </label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-3 py-2 bg-black rounded text-xs text-green-400/90 font-mono overflow-x-auto">
                        {stableIptvUrl}
                      </code>
                      <button
                        onClick={() => handleCopy(stableIptvUrl, 'IPTV URL')}
                        className="p-2 bg-[#222222] hover:bg-[#2a2a2a] border border-[#333333] rounded-md transition-colors flex-shrink-0"
                      >
                        <Copy className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Token Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setFormChannelId('');
          setFormRefreshInterval('60');
        }}
        title="Create Token"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Channel</label>
            <select
              value={formChannelId}
              onChange={(e) => setFormChannelId(e.target.value)}
              className="w-full px-3 py-2 bg-[#111111] border border-[#333333] rounded-md text-white focus:outline-none focus:border-gray-500 text-sm"
            >
              <option value="">Select channel...</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">
              Refresh Interval (minutes)
            </label>
            <input
              type="number"
              value={formRefreshInterval}
              onChange={(e) => setFormRefreshInterval(e.target.value)}
              min="1"
              max="10080"
              className="w-full px-3 py-2 bg-[#111111] border border-[#333333] rounded-md text-white focus:outline-none focus:border-gray-500 text-sm"
            />
            <p className="text-xs text-gray-600 mt-1">Token auto-refreshes at this interval</p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setShowCreateModal(false);
                setFormChannelId('');
                setFormRefreshInterval('60');
              }}
              className="px-4 py-2 bg-[#222222] text-white text-sm rounded-md hover:bg-[#2a2a2a] border border-[#333333] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 bg-white text-black text-sm font-medium rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create Token'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Token"
        message="Are you sure you want to delete this token? Any clients using this token will lose access immediately."
        confirmLabel={deleting ? 'Deleting...' : 'Delete'}
        loading={deleting}
      />
    </Layout>
  );
};

export default TokensPage;
