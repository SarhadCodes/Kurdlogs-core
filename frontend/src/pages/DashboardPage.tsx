import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Tv,
  Radio,
  ListVideo,
  Key,
  Activity,
  CircleDot,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { channelApi, playlistApi, tokenApi } from '../services/api';
import { Channel, Playlist, Token, ChannelStatus } from '../types';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import StatusBadge from '../components/StatusBadge';

interface OverviewCard {
  title: string;
  value: number;
  icon: React.ReactNode;
  subtitle?: string;
}

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async (showToast = false) => {
    try {
      const [channelRes, playlistRes, tokenRes] = await Promise.all([
        channelApi.getAll(),
        playlistApi.getAll(),
        tokenApi.getAll(),
      ]);
      setChannels(channelRes.data || []);
      setPlaylists(playlistRes.data || []);
      setTokens(tokenRes.data || []);
      if (showToast) toast.success('Dashboard refreshed');
    } catch (err: any) {
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData(true);
  };

  const onlineChannels = channels.filter((c) => c.status === 'ONLINE');
  const errorChannels = channels.filter((c) => c.status === 'ERROR');

  const overviewCards: OverviewCard[] = [
    {
      title: 'Total Channels',
      value: channels.length,
      icon: <Tv className="w-5 h-5 text-gray-400" />,
      subtitle: `${errorChannels.length} with errors`,
    },
    {
      title: 'Online Channels',
      value: onlineChannels.length,
      icon: <Radio className="w-5 h-5 text-green-500" />,
      subtitle: `${channels.length > 0 ? Math.round((onlineChannels.length / channels.length) * 100) : 0}% uptime`,
    },
    {
      title: 'Total Playlists',
      value: playlists.length,
      icon: <ListVideo className="w-5 h-5 text-gray-400" />,
    },
    {
      title: 'Active Tokens',
      value: tokens.length,
      icon: <Key className="w-5 h-5 text-gray-400" />,
    },
  ];

  const getStatusColor = (status: ChannelStatus): string => {
    switch (status) {
      case 'ONLINE':
        return 'text-green-500';
      case 'ERROR':
        return 'text-red-500';
      case 'STARTING':
      case 'STOPPING':
        return 'text-yellow-500';
      default:
        return 'text-gray-500';
    }
  };

  const getStatusIcon = (status: ChannelStatus) => {
    switch (status) {
      case 'ONLINE':
        return <CircleDot className={`w-3 h-3 ${getStatusColor(status)}`} />;
      case 'ERROR':
        return <AlertCircle className={`w-3 h-3 ${getStatusColor(status)}`} />;
      default:
        return <Activity className={`w-3 h-3 ${getStatusColor(status)}`} />;
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
          title="Dashboard"
          description="Overview of your streaming infrastructure"
          actions={
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[#222222] text-white text-sm rounded-md hover:bg-[#2a2a2a] border border-[#333333] transition-colors disabled:opacity-50 min-h-[44px]"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          }
        />

        {/* Overview Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {overviewCards.map((card) => (
            <div
              key={card.title}
              className="bg-[#111111] border border-[#333333] rounded-lg p-5"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-400">{card.title}</span>
                {card.icon}
              </div>
              <div className="text-3xl font-bold text-white">{card.value}</div>
              {card.subtitle && (
                <p className="text-xs text-gray-500 mt-1">{card.subtitle}</p>
              )}
            </div>
          ))}
        </div>

        {/* Channel Status List */}
        <div className="bg-[#111111] border border-[#333333] rounded-lg">
          <div className="px-5 py-4 border-b border-[#333333]">
            <h2 className="text-lg font-semibold text-white">Channel Status</h2>
          </div>

          {channels.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Tv className="w-10 h-10 mx-auto mb-3 text-gray-600" />
              <p>No channels created yet</p>
              <button
                onClick={() => navigate('/channels')}
                className="mt-3 text-sm text-white underline hover:no-underline"
              >
                Create your first channel
              </button>
            </div>
          ) : (
            <div className="divide-y divide-[#222222]">
              {channels.map((channel) => (
                <div
                  key={channel.id}
                  onClick={() => navigate(`/channels/${channel.id}`)}
                  className="flex items-center justify-between px-5 py-3 hover:bg-[#1a1a1a] cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {getStatusIcon(channel.status)}
                    <div>
                      <p className="text-white text-sm font-medium">{channel.name}</p>
                      <p className="text-gray-500 text-xs">{channel.sourceType} &middot; {channel.slug}</p>
                    </div>
                  </div>
                  <StatusBadge status={channel.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default DashboardPage;
