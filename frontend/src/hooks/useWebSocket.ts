import { useEffect } from 'react';
import { wsService } from '../services/websocket';
import { useChannelStore } from '../stores/channelStore';
import { useAuthStore } from '../stores/authStore';

export const useWebSocket = () => {
  const { isAuthenticated } = useAuthStore();
  const { updateChannelStatus, updateChannelStats } = useChannelStore();

  useEffect(() => {
    if (!isAuthenticated) return;

    wsService.connect();

    const unsubStatus = wsService.subscribe('channel:status', (data: any) => {
      if (data && data.channelId && data.status) {
        updateChannelStatus(data.channelId, data.status);
      }
    });

    const unsubStats = wsService.subscribe('channel:stats', (data: any) => {
      if (data && data.channelId && data.stats) {
        updateChannelStats(data.channelId, data.stats);
      }
    });

    return () => {
      unsubStatus();
      unsubStats();
      wsService.disconnect();
    };
  }, [isAuthenticated, updateChannelStatus, updateChannelStats]);

  return wsService;
};
