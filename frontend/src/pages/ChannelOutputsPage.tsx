import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Key, Link2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import ChannelOutputPanel from '../components/ChannelOutputPanel';
import LoadingSpinner from '../components/LoadingSpinner';
import StatusBadge from '../components/StatusBadge';
import { channelApi, tokenApi } from '../services/api';
import { Channel, Token } from '../types';
import { ChannelPlayUrlsData } from '../utils/channelOutputs';

const ChannelOutputsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [activeToken, setActiveToken] = useState<Token | null>(null);
  const [playUrls, setPlayUrls] = useState<ChannelPlayUrlsData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [channelRes, tokensRes, playUrlsRes] = await Promise.all([
        channelApi.getById(id),
        tokenApi.getAll(),
        channelApi.getPlayUrls(id),
      ]);
      setChannel(channelRes.data || null);
      setPlayUrls(playUrlsRes.data || null);
      const token = (tokensRes.data || []).find((t) => t.channelId === id && t.isActive);
      setActiveToken(token || null);
    } catch {
      toast.error('Failed to load channel outputs');
      navigate('/channels');
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <Layout>
        <LoadingSpinner />
      </Layout>
    );
  }

  if (!channel) {
    return (
      <Layout>
        <div className="text-center py-20 text-gray-500">Channel not found</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6 max-w-4xl">
        <PageHeader
          title="Output links"
          description={`Playback and publish URLs for ${channel.name}`}
          leading={
            <button
              type="button"
              onClick={() => navigate(`/channels/${id}`)}
              className="p-2.5 shrink-0 hover:bg-[#1a1a1a] rounded-md transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Back to channel"
            >
              <ArrowLeft className="w-5 h-5 text-gray-400" />
            </button>
          }
          actions={
            <div className="flex flex-wrap gap-2">
              <Link
                to={`/channels/${id}`}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-[#333] rounded-md text-gray-300 hover:text-white hover:border-[#555]"
              >
                <ExternalLink className="w-4 h-4" />
                Channel detail
              </Link>
              <Link
                to="/tokens"
                className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-[#333] rounded-md text-gray-300 hover:text-white hover:border-[#555]"
              >
                <Key className="w-4 h-4" />
                Manage tokens
              </Link>
            </div>
          }
        />

        <div className="flex flex-wrap items-center gap-2 px-1">
          <Link2 className="w-4 h-4 text-gray-500" />
          <span className="text-sm text-gray-400">/{channel.slug}</span>
          <StatusBadge status={channel.status} />
          {activeToken ? (
            <span className="text-xs text-amber-400/90 bg-amber-400/10 px-2 py-0.5 rounded">
              Active stream token
            </span>
          ) : (
            <span className="text-xs text-gray-500 bg-[#1a1a1a] px-2 py-0.5 rounded">
              No active token
            </span>
          )}
        </div>

        {playUrls?.streamReady === false && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Stream files are not on the server yet. Open the channel, click <strong>Start</strong> or{' '}
            <strong>Restart</strong>, wait until the preview plays, then use these links.
            {playUrls.tokenProtected && (
              <>
                {' '}
                This channel has token protection — use the <strong>With stream token</strong> URLs in VLC,
                not the public links.
              </>
            )}
          </div>
        )}

        <ChannelOutputPanel channel={channel} activeToken={activeToken} playUrls={playUrls} />
      </div>
    </Layout>
  );
};

export default ChannelOutputsPage;
