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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

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
    } catch {
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
      icon: <Tv className="h-5 w-5 text-muted-foreground" />,
      subtitle: `${errorChannels.length} with errors`,
    },
    {
      title: 'Online Channels',
      value: onlineChannels.length,
      icon: <Radio className="h-5 w-5 text-emerald-400" />,
      subtitle: `${channels.length > 0 ? Math.round((onlineChannels.length / channels.length) * 100) : 0}% uptime`,
    },
    {
      title: 'Total Playlists',
      value: playlists.length,
      icon: <ListVideo className="h-5 w-5 text-muted-foreground" />,
    },
    {
      title: 'Active Tokens',
      value: tokens.length,
      icon: <Key className="h-5 w-5 text-muted-foreground" />,
    },
  ];

  const getStatusColor = (status: ChannelStatus): string => {
    switch (status) {
      case 'ONLINE':
        return 'text-emerald-400';
      case 'ERROR':
        return 'text-red-400';
      case 'STARTING':
      case 'STOPPING':
        return 'text-amber-400';
      default:
        return 'text-muted-foreground';
    }
  };

  const getStatusIcon = (status: ChannelStatus) => {
    switch (status) {
      case 'ONLINE':
        return <CircleDot className={`h-3 w-3 ${getStatusColor(status)}`} />;
      case 'ERROR':
        return <AlertCircle className={`h-3 w-3 ${getStatusColor(status)}`} />;
      default:
        return <Activity className={`h-3 w-3 ${getStatusColor(status)}`} />;
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="space-y-6">
          <Skeleton className="h-10 w-64" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
          <LoadingSpinner />
        </div>
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
            <Button variant="outline" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          }
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {overviewCards.map((card) => (
            <Card key={card.title} className="bg-card/80">
              <CardContent className="p-5">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{card.title}</span>
                  {card.icon}
                </div>
                <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
                  {card.value}
                </div>
                {card.subtitle && (
                  <p className="mt-1 text-xs text-muted-foreground">{card.subtitle}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="overflow-hidden bg-card/80">
          <CardHeader className="border-b border-border">
            <CardTitle>Channel Status</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {channels.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <Tv className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
                <p>No channels created yet</p>
                <Button variant="link" className="mt-2" onClick={() => navigate('/channels')}>
                  Create your first channel
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {channels.map((channel) => (
                  <button
                    key={channel.id}
                    type="button"
                    onClick={() => navigate(`/channels/${channel.id}`)}
                    className="flex w-full items-center justify-between px-5 py-3 text-left transition-colors hover:bg-accent/60"
                  >
                    <div className="flex items-center gap-3">
                      {getStatusIcon(channel.status)}
                      <div>
                        <p className="text-sm font-medium text-foreground">{channel.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {channel.sourceType} · {channel.slug}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={channel.status} />
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default DashboardPage;
