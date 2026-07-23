import { create } from 'zustand';
import { Channel, ChannelStatus, StreamStats } from '../types';
import { channelApi } from '../services/api';

interface ChannelState {
  channels: Channel[];
  stats: Record<string, StreamStats>;
  isLoading: boolean;
  fetchChannels: () => Promise<void>;
  updateChannelStatus: (channelId: string, status: ChannelStatus) => void;
  updateChannelStats: (channelId: string, stats: StreamStats) => void;
}

export const useChannelStore = create<ChannelState>((set, get) => ({
  channels: [],
  stats: {},
  isLoading: false,

  fetchChannels: async () => {
    set({ isLoading: true });
    try {
      const response = await channelApi.getAll();
      if (response.success && response.data) {
        set({ channels: response.data, isLoading: false });
      }
    } catch (error) {
      console.error('Failed to fetch channels', error);
      set({ isLoading: false });
    }
  },

  updateChannelStatus: (channelId, status) => {
    set((state) => ({
      channels: state.channels.map(c => 
        c.id === channelId ? { ...c, status } : c
      )
    }));
  },

  updateChannelStats: (channelId, stats) => {
    set((state) => ({
      stats: {
        ...state.stats,
        [channelId]: stats
      }
    }));
  }
}));
