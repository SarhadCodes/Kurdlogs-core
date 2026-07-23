import axios from 'axios';
import {
  User,
  Channel,
  Playlist,
  Overlay,
  TranscodingProfile,
  Token,
  SystemStats,
  StreamLog,
  BoostNode,
  BoostSummary,
  ApiResponse,
} from '../types';
import type { ChannelPlayUrlsData } from '../utils/channelOutputs';

const api = axios.create({
  baseURL: '/api',
  timeout: 30_000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      if (window.location.pathname !== '/login') {
         window.location.href = '/login';
      }
    }
    const detail =
      error.response?.data?.error ||
      error.response?.data?.message ||
      error.message ||
      'Request failed';
    return Promise.reject(detail);
  }
);

export const authApi = {
  login: (data: any) =>
    api.post<any, ApiResponse<{ token: string; user: User }>>('/auth/login', data, { timeout: 45_000 }),
  getMe: () => api.get<any, ApiResponse<User>>('/auth/me'),
  updateProfile: (data: { displayName: string }) =>
    api.put<any, ApiResponse<User>>('/auth/profile', data),
  uploadAvatar: (data: FormData) =>
    api.post<any, ApiResponse<User>>('/auth/avatar', data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  changePassword: (data: any) => api.put<any, ApiResponse>('/auth/change-password', data),
};

export const channelApi = {
  getAll: () => api.get<any, ApiResponse<Channel[]>>('/channels'),
  getById: (id: string) => api.get<any, ApiResponse<Channel>>(`/channels/${id}`),
  create: (data: any) => api.post<any, ApiResponse<Channel>>('/channels', data),
  update: (id: string, data: any) => api.put<any, ApiResponse<Channel>>(`/channels/${id}`, data),
  delete: (id: string) => api.delete<any, ApiResponse>(`/channels/${id}`),
  start: (id: string) => api.post<any, ApiResponse>(`/channels/${id}/start`),
  stop: (id: string) => api.post<any, ApiResponse>(`/channels/${id}/stop`),
  restart: (id: string) => api.post<any, ApiResponse>(`/channels/${id}/restart`),
  getStats: (id: string) => api.get<any, ApiResponse<any>>(`/channels/${id}/stats`),
  getLogs: (id: string) => api.get<any, ApiResponse<any[]>>(`/channels/${id}/logs`),
  clearLogs: (id: string) => api.delete<any, ApiResponse<{ deleted: number }>>(`/channels/${id}/logs`),
  switchMode: (id: string, data: any) => api.post<any, ApiResponse<Channel>>(`/channels/${id}/switch-mode`, data),
  setPlaybackMode: (id: string, mode: 'playlist' | 'blueprint', blueprintId?: string) =>
    api.post<any, ApiResponse<Channel>>(`/channels/${id}/playback-mode`, { mode, blueprintId }),
  getPlayUrls: (id: string) => api.get<any, ApiResponse<ChannelPlayUrlsData>>(`/channels/${id}/play-urls`),
};

export const playlistApi = {
  getAll: () => api.get<any, ApiResponse<Playlist[]>>('/playlists'),
  getById: (id: string) => api.get<any, ApiResponse<Playlist>>(`/playlists/${id}`),
  create: (data: any) => api.post<any, ApiResponse<Playlist>>('/playlists', data),
  update: (id: string, data: any) => api.put<any, ApiResponse<Playlist>>(`/playlists/${id}`, data),
  delete: (id: string) => api.delete<any, ApiResponse>(`/playlists/${id}`),
  addItem: (
    id: string,
    data: any,
    options?: { onUploadProgress?: (pct: number) => void }
  ) => {
    const isFormData = data instanceof FormData;
    return api.post<any, ApiResponse>(`/playlists/${id}/items`, data, {
      headers: isFormData ? { 'Content-Type': 'multipart/form-data' } : undefined,
      timeout: 0,
      onUploadProgress: options?.onUploadProgress
        ? (evt) => {
            if (!evt.total) return;
            options.onUploadProgress!(Math.round((evt.loaded * 100) / evt.total));
          }
        : undefined,
    });
  },
  replaceItem: (
    itemId: string,
    data: any,
    options?: { onUploadProgress?: (pct: number) => void }
  ) => {
    const isFormData = data instanceof FormData;
    return api.put<any, ApiResponse>(`/playlists/items/${itemId}/replace`, data, {
      headers: isFormData ? { 'Content-Type': 'multipart/form-data' } : undefined,
      timeout: 0,
      onUploadProgress: options?.onUploadProgress
        ? (evt) => {
            if (!evt.total) return;
            options.onUploadProgress!(Math.round((evt.loaded * 100) / evt.total));
          }
        : undefined,
    });
  },
  removeItem: (id: string, itemId: string) => api.delete<any, ApiResponse>(`/playlists/items/${itemId}`),
  reorderItems: (id: string, itemIds: string[]) => api.put<any, ApiResponse>(`/playlists/${id}/items/reorder`, { itemIds }),
  updateItemLogo: (itemId: string, data: FormData | Record<string, unknown>) => {
    const isFormData = data instanceof FormData;
    return api.put<any, ApiResponse<import('../types').PlaylistItem>>(
      `/playlists/items/${itemId}/logo`,
      data,
      { headers: isFormData ? { 'Content-Type': 'multipart/form-data' } : undefined }
    );
  },
  retryNormalize: (itemId: string) =>
    api.post<any, ApiResponse<import('../types').PlaylistItem>>(`/playlists/items/${itemId}/retry-normalize`),
};

export const overlayApi = {
  getAll: (channelId: string) => api.get<any, ApiResponse<Overlay[]>>(`/overlays/channel/${channelId}`),
  create: (channelId: string, data: any) => {
    const isFormData = data instanceof FormData;
    return api.post<any, ApiResponse<Overlay>>(`/overlays/channel/${channelId}`, data, {
      headers: isFormData ? { 'Content-Type': 'multipart/form-data' } : undefined
    });
  },
  update: (id: string, data: any) => {
    const isFormData = data instanceof FormData;
    return api.put<any, ApiResponse<Overlay>>(`/overlays/${id}`, data, {
      headers: isFormData ? { 'Content-Type': 'multipart/form-data' } : undefined
    });
  },
  delete: (id: string) => api.delete<any, ApiResponse>(`/overlays/${id}`),
};

export const transcodingApi = {
  getAll: () => api.get<any, ApiResponse<TranscodingProfile[]>>('/transcoding'),
  create: (data: any) => api.post<any, ApiResponse<TranscodingProfile>>('/transcoding', data),
  update: (id: string, data: any) => api.put<any, ApiResponse<TranscodingProfile>>(`/transcoding/${id}`, data),
  delete: (id: string) => api.delete<any, ApiResponse>(`/transcoding/${id}`),
};

export const tokenApi = {
  getAll: () => api.get<any, ApiResponse<Token[]>>('/tokens'),
  create: (data: any) => api.post<any, ApiResponse<Token>>('/tokens', data),
  delete: (id: string) => api.delete<any, ApiResponse>(`/tokens/${id}`),
  refresh: (id: string) => api.post<any, ApiResponse<Token>>(`/tokens/${id}/refresh`),
  refreshAll: () => api.post<any, ApiResponse>('/tokens/refresh-all'),
};

export const monitorApi = {
  getSystemStats: () => api.get<any, ApiResponse<SystemStats>>('/monitoring/stats'),
  getChannelHealth: () => api.get<any, ApiResponse<import('../types').ChannelHealthReport[]>>('/monitoring/health'),
  getLogs: (limit: number = 50) => api.get<any, ApiResponse<StreamLog[]>>(`/monitoring/logs?limit=${limit}`),
  getAppLogs: (limit = 100, category?: string) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (category) q.set('category', category);
    return api.get<any, ApiResponse<import('../types').AppLogEntry[]>>(`/monitoring/app-logs?${q}`);
  },
  exportAppLogs: () =>
    api.get<any, Blob>('/monitoring/app-logs/export', { responseType: 'blob' }),
  exportBackup: () =>
    api.get<any, Blob>('/monitoring/backup/export', {
      responseType: 'blob',
    }),
  importBackup: (backup: unknown) =>
    api.post<any, ApiResponse>('/monitoring/backup/import', { backup }),
};

export const brandProfileApi = {
  getAll: () => api.get<any, ApiResponse<import('../types').BrandProfile[]>>('/brand-profiles'),
  getById: (id: string) => api.get<any, ApiResponse<import('../types').BrandProfile>>(`/brand-profiles/${id}`),
  create: (data: FormData | Record<string, unknown>) => {
    const isFormData = data instanceof FormData;
    return api.post<any, ApiResponse<import('../types').BrandProfile>>('/brand-profiles', data, {
      headers: isFormData ? { 'Content-Type': 'multipart/form-data' } : undefined,
    });
  },
  update: (id: string, data: FormData | Record<string, unknown>) => {
    const isFormData = data instanceof FormData;
    return api.put<any, ApiResponse<import('../types').BrandProfile>>(`/brand-profiles/${id}`, data, {
      headers: isFormData ? { 'Content-Type': 'multipart/form-data' } : undefined,
    });
  },
  delete: (id: string) => api.delete<any, ApiResponse>(`/brand-profiles/${id}`),
};

export const processingApi = {
  listJobs: (limit = 50, status?: string) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (status) q.set('status', status);
    return api.get<any, ApiResponse<import('../types').ProcessingJob[]> & { meta?: { queuePending: number } }>(
      `/processing/jobs?${q}`
    );
  },
  getJob: (id: string) =>
    api.get<any, ApiResponse<import('../types').ProcessingJob>>(`/processing/jobs/${id}`),
};

export const benchmarkApi = {
  status: () => api.get<any, ApiResponse<{ running: boolean }>>('/benchmark/status'),
  last: () => api.get<any, ApiResponse<import('../types').BenchmarkReport | null>>('/benchmark/last'),
  run: (channels: 1 | 5 | 10 | 20, seconds = 30) =>
    api.post<any, ApiResponse<import('../types').BenchmarkReport>>('/benchmark/run', { channels, seconds }),
};

export const blueprintApi = {
  getAll: () => api.get<any, ApiResponse<import('../types').ChannelBlueprint[]>>('/blueprints'),
  getTemplates: () =>
    api.get<any, ApiResponse<Array<{ key: string; name: string; description: string }>>>('/blueprints/templates'),
  getById: (id: string) => api.get<any, ApiResponse<import('../types').ChannelBlueprint>>(`/blueprints/${id}`),
  create: (data: { templateKey?: string; name?: string; blocks?: import('../types').BlueprintBlock[] }) =>
    api.post<any, ApiResponse<import('../types').ChannelBlueprint>>('/blueprints', data),
  update: (id: string, data: Record<string, unknown>) =>
    api.put<any, ApiResponse<import('../types').ChannelBlueprint>>(`/blueprints/${id}`, data),
  delete: (id: string) => api.delete<any, ApiResponse>(`/blueprints/${id}`),
  simulate: (id: string, horizon: import('../types').SimulationHorizon) =>
    api.post<any, ApiResponse<import('../types').BlueprintSimulation>>(`/blueprints/${id}/simulate`, { horizon }),
  summary: (id: string, blocks?: import('../types').BlueprintBlock[]) =>
    api.post<any, ApiResponse<import('../types').BlueprintSummary>>(`/blueprints/${id}/summary`, { blocks }),
  timeline: (
    id: string,
    horizon: import('../types').SimulationHorizon,
    blocks?: import('../types').BlueprintBlock[],
    channelId?: string
  ) =>
    api.post<any, ApiResponse<import('../types').BlueprintSimulation>>(
      `/blueprints/${id}/timeline?horizon=${horizon}${channelId ? `&channelId=${encodeURIComponent(channelId)}` : ''}`,
      { blocks }
    ),
  cachedTimeline: (id: string, horizon: import('../types').SimulationHorizon, channelId?: string) =>
    api.get<any, ApiResponse<import('../types').BlueprintSimulation | null>>(
      `/blueprints/${id}/timeline/cached?horizon=${horizon}${
        channelId ? `&channelId=${encodeURIComponent(channelId)}` : ''
      }`
    ),
  liveCursor: (id: string, channelId: string, horizon: import('../types').SimulationHorizon = '24h') =>
    api.get<any, ApiResponse<import('../types').BlueprintLiveCursor>>(
      `/blueprints/${id}/live-cursor?channelId=${encodeURIComponent(channelId)}&horizon=${horizon}`
    ),
  verifyObservers: (id: string, channelId: string, horizon: import('../types').SimulationHorizon = '24h') =>
    api.post<
      any,
      ApiResponse<{
        ok: boolean;
        mismatches: Array<{ observer: string; media: string | null; index?: number | null }>;
        ffmpegMedia: string | null;
        liveCursorMedia: string | null;
        nowPlayingMedia: string | null;
        timelineMedia: string | null;
        cursorSource: string;
      }>
    >(`/blueprints/${id}/verify-observers?channelId=${encodeURIComponent(channelId)}&horizon=${horizon}`),
  verifySync: (id: string, channelId: string, horizon: import('../types').SimulationHorizon = '24h') =>
    api.post<
      any,
      ApiResponse<{
        runtimeMedia: string | null;
        timelineMedia: string | null;
        concatMedia: string | null;
        ffmpegMedia: string | null;
        match: boolean;
        playbackEpoch: number;
        runtimeWindowVersion: string;
        timelineVersion: string;
      }>
    >(`/blueprints/${id}/verify-sync?channelId=${encodeURIComponent(channelId)}&horizon=${horizon}`),
  verifyExecution: (id: string, count = 48) =>
    api.post<any, ApiResponse<{ ok: boolean; compared: number; mismatches: unknown[] }>>(
      `/blueprints/${id}/verify-execution?count=${count}`
    ),
  preview: (id: string, count = 12) =>
    api.get<any, ApiResponse<{ segments: unknown[]; warnings: unknown[] }>>(`/blueprints/${id}/preview?count=${count}`),
  publish: (id: string, channelId: string, blocks?: import('../types').BlueprintBlock[]) =>
    api.post<any, ApiResponse<import('../types').PublishBlueprintResult>>(`/blueprints/${id}/publish`, {
      channelId,
      blocks,
    }),
};

export const boostApi = {
  getNodes: () =>
    api.get<any, ApiResponse<{ nodes: BoostNode[]; summary: BoostSummary }>>('/monitoring/boost/nodes'),
  createNode: (data: {
    name: string;
    host: string;
    port?: number;
    encode?: boolean;
    stream?: boolean;
    maxChannels?: number;
    notes?: string;
  }) => api.post<any, ApiResponse<BoostNode>>('/monitoring/boost/nodes', data),
  updateNode: (id: string, data: Partial<BoostNode>) =>
    api.put<any, ApiResponse<BoostNode>>(`/monitoring/boost/nodes/${id}`, data),
  deleteNode: (id: string) => api.delete<any, ApiResponse>(`/monitoring/boost/nodes/${id}`),
  regenerateKey: (id: string) =>
    api.post<any, ApiResponse<BoostNode>>(`/monitoring/boost/nodes/${id}/regenerate-key`),
};

export const mcrApi = {
  listChannels: () => api.get<any, ApiResponse<import('../types/mcr').McrChannelRow[]>>('/mcr/channels'),
  listAvailableChannels: () =>
    api.get<any, ApiResponse<import('../types/mcr').McrAvailableChannel[]>>('/mcr/available-channels'),
  listIngestPublishers: () =>
    api.get<any, ApiResponse<import('../types/mcr').McrIngestPublisher[]>>('/mcr/ingest/publishers'),
  createIngestKey: (label: string, streamKey?: string) =>
    api.post<any, ApiResponse<import('../types/mcr').McrIngestPublisher>>('/mcr/ingest/keys', {
      label,
      streamKey,
    }),
  getState: (channelId: string) =>
    api.get<any, ApiResponse<import('../types/mcr').McrRouterSnapshot>>(`/mcr/${channelId}`),
  init: (channelId: string) =>
    api.post<any, ApiResponse<import('../types/mcr').McrRouterSnapshot>>(`/mcr/${channelId}/init`),
  discover: (channelId: string) =>
    api.post<any, ApiResponse<import('../types/mcr').McrRouterSnapshot>>(`/mcr/${channelId}/discover`),
  addSource: (channelId: string, payload: import('../types/mcr').AddMcrSourcePayload) =>
    api.post<any, ApiResponse<import('../types/mcr').McrSourceView>>(`/mcr/${channelId}/sources`, payload),
  setPreview: (channelId: string, sourceId: string) =>
    api.post<any, ApiResponse<import('../types/mcr').McrRouterSnapshot>>(`/mcr/${channelId}/preview`, {
      sourceId,
    }),
  take: (channelId: string, payload?: { transition?: 'TAKE' | 'FADE'; fadeDurationMs?: number }) =>
    api.post<any, ApiResponse<import('../types/mcr').McrRouterSnapshot>>(`/mcr/${channelId}/take`, payload ?? {}),
  auto: (channelId: string, fadeDurationMs?: number) =>
    api.post<any, ApiResponse<import('../types/mcr').McrRouterSnapshot>>(`/mcr/${channelId}/auto`, {
      fadeDurationMs,
    }),
  cut: (channelId: string, sourceId?: string) =>
    api.post<any, ApiResponse<import('../types/mcr').McrRouterSnapshot>>(`/mcr/${channelId}/cut`, {
      sourceId,
    }),
  addRtmp: (channelId: string, label: string, inputUrl: string) =>
    api.post<any, ApiResponse<import('../types/mcr').McrSourceView>>(
      `/mcr/${channelId}/sources/rtmp`,
      { label, inputUrl }
    ),
  getPreviewUrl: (channelId: string, sourceId: string) =>
    api.get<any, ApiResponse<{ url: string | null; kind: string; slug?: string; manifest?: string }>>(
      `/mcr/${channelId}/sources/${sourceId}/preview-url`
    ),
};

export interface HybridChannelSnapshot {
  channelId: string;
  activeSource: 'BLUEPRINT' | 'LIVE' | 'TRANSITION';
  liveFeedUrl: string | null;
  stationIdVideoPath: string | null;
  stationIdPlaylistId: string | null;
  stationIdPlaylistItemId: string | null;
  blueprintNormalization: 'OFF' | 'ON' | 'AUTO';
  stationNormalization: 'OFF' | 'ON' | 'AUTO';
  liveNormalization: 'OFF' | 'ON' | 'AUTO';
  transitionInProgress: boolean;
  lastSwitchAt: string | null;
  viewerUrl: string;
  canGoLive: boolean;
  canReturnToSchedule: boolean;
}

export const hybridApi = {
  getState: (channelId: string) =>
    api.get<any, ApiResponse<HybridChannelSnapshot>>(`/hybrid/${channelId}`),
  updateConfig: (channelId: string, data: Partial<HybridChannelSnapshot>) =>
    api.patch<any, ApiResponse<HybridChannelSnapshot>>(`/hybrid/${channelId}`, data),
  goLive: (channelId: string) =>
    api.post<any, ApiResponse<HybridChannelSnapshot>>(`/hybrid/${channelId}/go-live`, undefined, {
      timeout: 0,
    }),
  returnToSchedule: (channelId: string) =>
    api.post<any, ApiResponse<HybridChannelSnapshot>>(
      `/hybrid/${channelId}/return-to-schedule`,
      undefined,
      { timeout: 0 }
    ),
};

export default api;
