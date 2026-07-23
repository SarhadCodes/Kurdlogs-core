import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  Plus,
  Layers,
  Trash2,
  Image,
  Type,
  Badge,
  Droplets,
  Clock,
  RefreshCw,
  Upload,
  FolderOpen,
  Power,
  PowerOff,
  X,
  Pencil,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { overlayApi, channelApi } from '../services/api';
import { Overlay, OverlayType, Channel } from '../types';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import OverlayPreview, { CANVAS_W, CANVAS_H } from '../components/OverlayPreview';
import type { OverlayElement } from '../components/OverlayPreview';
import { buildStreamUrl } from '../utils/streamUrl';

const OVERLAY_TYPES: OverlayType[] = ['LOGO', 'SCROLLING_TEXT', 'LIVE_BADGE', 'WATERMARK', 'CLOCK'];
const DEFAULT_SIZES: Record<OverlayType, { w: number; h: number }> = {
  LOGO: { w: 200, h: 200 },
  WATERMARK: { w: 200, h: 200 },
  SCROLLING_TEXT: { w: 1920, h: 60 },
  LIVE_BADGE: { w: 120, h: 50 },
  CLOCK: { w: 220, h: 50 },
};

const overlayTypeIcon = (type: OverlayType) => {
  switch (type) {
    case 'LOGO': return <Image className="w-4 h-4" />;
    case 'SCROLLING_TEXT': return <Type className="w-4 h-4" />;
    case 'LIVE_BADGE': return <Badge className="w-4 h-4" />;
    case 'WATERMARK': return <Droplets className="w-4 h-4" />;
    case 'CLOCK': return <Clock className="w-4 h-4" />;
  }
};

const overlayTypeLabel = (type: OverlayType): string => {
  switch (type) {
    case 'LOGO': return 'Logo';
    case 'SCROLLING_TEXT': return 'Scrolling Text';
    case 'LIVE_BADGE': return 'Live Badge';
    case 'WATERMARK': return 'Watermark';
    case 'CLOCK': return 'Clock';
  }
};

type FileInputMode = 'upload' | 'path';

const OverlaysPage: React.FC = () => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOverlays, setLoadingOverlays] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [editingOverlayId, setEditingOverlayId] = useState<string | null>(null);
  const [fullscreenEditor, setFullscreenEditor] = useState(false);

  // Form state
  const [formType, setFormType] = useState<OverlayType>('LOGO');
  const [formFileMode, setFormFileMode] = useState<FileInputMode>('upload');
  const [formFilePath, setFormFilePath] = useState('');
  const [formFile, setFormFile] = useState<File | null>(null);
  const [formImagePreview, setFormImagePreview] = useState<string | null>(null);
  const [formText, setFormText] = useState('');
  const [formFontSize, setFormFontSize] = useState(24);
  const [formFontColor, setFormFontColor] = useState('#ffffff');
  const [formSpeed, setFormSpeed] = useState(50);
  const [formOpacity, setFormOpacity] = useState(0.5);
  const [formWidth, setFormWidth] = useState(200);
  const [formHeight, setFormHeight] = useState(200);
  const [formX, setFormX] = useState(20);
  const [formY, setFormY] = useState(20);
  const [formShowEveryMinutes, setFormShowEveryMinutes] = useState<number | ''>('');
  const [formShowForSeconds, setFormShowForSeconds] = useState<number | ''>('');
  const [formFadeInSeconds, setFormFadeInSeconds] = useState<number | ''>('');
  const [formFadeOutSeconds, setFormFadeOutSeconds] = useState<number | ''>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [livePreviewSize, setLivePreviewSize] = useState<{ width: number; height: number } | null>(null);

  const selectedChannel = useMemo(
    () => channels.find((c) => c.id === selectedChannelId) || null,
    [channels, selectedChannelId]
  );

  const previewCanvas = useMemo(() => {
    if (livePreviewSize && livePreviewSize.width > 0 && livePreviewSize.height > 0) {
      return { width: livePreviewSize.width, height: livePreviewSize.height };
    }
    const resolution = selectedChannel?.transcodingProfile?.resolution;
    if (resolution === 'RES_720P') return { width: 1280, height: 720 };
    if (resolution === 'RES_480P') return { width: 854, height: 480 };
    return { width: CANVAS_W, height: CANVAS_H };
  }, [selectedChannel, livePreviewSize]);

  const previewStreamUrl = useMemo(() => {
    if (!selectedChannel?.slug) return '';
    return buildStreamUrl(selectedChannel.slug, 'master.m3u8');
  }, [selectedChannel?.slug]);

  useEffect(() => {
    setLivePreviewSize(null);
  }, [selectedChannelId]);

  const fetchChannels = async () => {
    try {
      const res = await channelApi.getAll();
      setChannels(res.data || []);
    } catch {
      toast.error('Failed to load channels');
    } finally {
      setLoading(false);
    }
  };

  const fetchOverlays = async (channelId: string) => {
    if (!channelId) { setOverlays([]); return; }
    setLoadingOverlays(true);
    try {
      const res = await overlayApi.getAll(channelId);
      setOverlays(res.data || []);
    } catch {
      toast.error('Failed to load overlays');
    } finally {
      setLoadingOverlays(false);
    }
  };

  useEffect(() => { fetchChannels(); }, []);
  useEffect(() => {
    if (selectedChannelId) fetchOverlays(selectedChannelId);
    else setOverlays([]);
  }, [selectedChannelId]);

  const resetForm = useCallback(() => {
    setFormType('LOGO');
    setFormFileMode('upload');
    setFormFilePath('');
    setFormFile(null);
    setFormImagePreview(null);
    setFormText('');
    setFormFontSize(24);
    setFormFontColor('#ffffff');
    setFormSpeed(50);
    setFormOpacity(0.5);
    setFormWidth(200);
    setFormHeight(200);
    setFormX(20);
    setFormY(20);
    setFormShowEveryMinutes('');
    setFormShowForSeconds('');
    setFormFadeInSeconds('');
    setFormFadeOutSeconds('');
    setEditingOverlayId(null);
    setFullscreenEditor(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleTypeChange = (type: OverlayType) => {
    setFormType(type);
    setFormFile(null);
    setFormFilePath('');
    setFormImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    const size = DEFAULT_SIZES[type];
    setFormWidth(size.w);
    setFormHeight(size.h);
    setFormX(type === 'SCROLLING_TEXT' ? 0 : 20);
    setFormY(type === 'SCROLLING_TEXT' ? previewCanvas.height - size.h - 40 : 20);
  };

  const handleFileChange = (file: File | null) => {
    setFormFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      setFormImagePreview(url);
      const img = new window.Image();
      img.onload = () => {
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w > 400) { h = Math.round(h * (400 / w)); w = 400; }
        if (h > 400) { w = Math.round(w * (400 / h)); h = 400; }
        setFormWidth(w);
        setFormHeight(h);
      };
      img.src = url;
    } else {
      setFormImagePreview(null);
    }
  };

  const previewElement: OverlayElement = useMemo(() => ({
    type: formType,
    x: formX,
    y: formY,
    width: formWidth,
    height: formHeight,
    label: overlayTypeLabel(formType),
    imageUrl: formImagePreview || undefined,
    text: formText,
    fontSize: formFontSize,
    fontColor: formFontColor,
    opacity: formOpacity,
  }), [formType, formX, formY, formWidth, formHeight, formImagePreview, formText, formFontSize, formFontColor, formOpacity]);

  const handlePreviewChange = useCallback((pos: { x: number; y: number }) => {
    setFormX(pos.x);
    setFormY(pos.y);
  }, []);

  useEffect(() => {
    setFormWidth((prev) => Math.max(10, Math.min(prev, previewCanvas.width)));
    setFormHeight((prev) => Math.max(10, Math.min(prev, previewCanvas.height)));
    setFormX((prev) => Math.max(0, Math.min(prev, Math.max(0, previewCanvas.width - formWidth))));
    setFormY((prev) => Math.max(0, Math.min(prev, Math.max(0, previewCanvas.height - formHeight))));
  }, [previewCanvas.width, previewCanvas.height]);

  const openEditOverlay = (overlay: Overlay) => {
    const cfg = overlay.config || {};
    setEditingOverlayId(overlay.id);
    setFormType(overlay.type);
    setFormFileMode('path');
    setFormFile(null);
    setFormImagePreview(null);
    setFormFilePath(cfg.imagePath || cfg.path || '');
    setFormText(cfg.text || '');
    setFormFontSize(cfg.fontSize || 24);
    setFormFontColor(cfg.fontColor || '#ffffff');
    setFormSpeed(cfg.speed || 50);
    setFormOpacity(cfg.opacity != null ? Number(cfg.opacity) : 0.5);
    setFormWidth(cfg.width || DEFAULT_SIZES[overlay.type].w);
    setFormHeight(cfg.height || DEFAULT_SIZES[overlay.type].h);
    setFormX(cfg.x != null ? Number(cfg.x) : 20);
    setFormY(cfg.y != null ? Number(cfg.y) : 20);
    setFormShowEveryMinutes(cfg.showEveryMinutes ?? '');
    setFormShowForSeconds(cfg.showForSeconds ?? '');
    setFormFadeInSeconds(cfg.fadeInSeconds ?? '');
    setFormFadeOutSeconds(cfg.fadeOutSeconds ?? '');
    setShowCreateModal(true);
  };

  const handleSaveOverlay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChannelId) { toast.error('Select a channel first'); return; }

    setCreating(true);
    try {
      const config: Record<string, any> = {
        x: formX,
        y: formY,
        width: formWidth,
        height: formHeight,
      };
      const hasScheduleA = formShowEveryMinutes !== '';
      const hasScheduleB = formShowForSeconds !== '';
      if (hasScheduleA !== hasScheduleB) {
        toast.error('Set both schedule fields: minutes and seconds');
        setCreating(false);
        return;
      }
      if (formShowEveryMinutes !== '' && formShowForSeconds !== '') {
        config.showEveryMinutes = Number(formShowEveryMinutes);
        config.showForSeconds = Number(formShowForSeconds);
        if (formFadeInSeconds !== '') config.fadeInSeconds = Number(formFadeInSeconds);
        if (formFadeOutSeconds !== '') config.fadeOutSeconds = Number(formFadeOutSeconds);
      }

      let payload: any;
      const needsFile = formType === 'LOGO' || formType === 'WATERMARK';

      if (formType === 'SCROLLING_TEXT') {
        config.text = formText;
        config.fontSize = formFontSize;
        config.fontColor = formFontColor;
        config.speed = formSpeed;
        config.y = formY;
        payload = { type: formType, position: 'custom', config };
      } else if (formType === 'LIVE_BADGE') {
        config.fontSize = formFontSize;
        payload = { type: formType, position: 'custom', config };
      } else if (formType === 'CLOCK') {
        config.fontSize = formFontSize;
        config.fontColor = formFontColor;
        payload = { type: formType, position: 'custom', config };
      } else if (needsFile) {
        if (formType === 'WATERMARK') config.opacity = formOpacity;

        if (formFileMode === 'upload' && formFile) {
          const formData = new FormData();
          formData.append('logo', formFile);
          formData.append('type', formType);
          formData.append('position', 'custom');
          formData.append('config', JSON.stringify(config));
          payload = formData;
        } else if (formFileMode === 'path' && formFilePath.trim()) {
          config.imagePath = formFilePath.trim();
          payload = { type: formType, position: 'custom', config };
        } else if (!editingOverlayId) {
          toast.error(`Please provide an image for the ${overlayTypeLabel(formType).toLowerCase()}`);
          setCreating(false);
          return;
        } else {
          // Edit mode: keep existing image path by not forcing a new one.
          payload = { type: formType, position: 'custom', config };
        }
      }

      if (editingOverlayId) {
        await overlayApi.update(editingOverlayId, payload);
        toast.success('Overlay updated');
      } else {
        await overlayApi.create(selectedChannelId, payload);
        toast.success('Overlay created');
      }
      setShowCreateModal(false);
      resetForm();
      fetchOverlays(selectedChannelId);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to create overlay');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (overlay: Overlay) => {
    setTogglingId(overlay.id);
    try {
      await overlayApi.update(overlay.id, { isActive: !overlay.isActive });
      toast.success(overlay.isActive ? 'Overlay deactivated' : 'Overlay activated');
      fetchOverlays(selectedChannelId);
    } catch {
      toast.error('Failed to update overlay');
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await overlayApi.delete(deleteId);
      toast.success('Overlay deleted');
      setDeleteId(null);
      fetchOverlays(selectedChannelId);
    } catch {
      toast.error('Failed to delete overlay');
    } finally {
      setDeleting(false);
    }
  };

  const needsFileInput = formType === 'LOGO' || formType === 'WATERMARK';

  if (loading) {
    return <Layout><LoadingSpinner /></Layout>;
  }

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          title="Overlays"
          description="Manage stream overlays"
          actions={
            selectedChannelId ? (
              <>
                <button
                  type="button"
                  onClick={() => fetchOverlays(selectedChannelId)}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[#222] text-white text-sm rounded-md hover:bg-[#2a2a2a] border border-[#333] transition-colors min-h-[44px]"
                >
                  <RefreshCw className="w-4 h-4" /> Refresh
                </button>
                <button
                  type="button"
                  onClick={() => { resetForm(); setShowCreateModal(true); }}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-black text-sm font-medium rounded-md hover:bg-gray-200 transition-colors min-h-[44px] flex-1 sm:flex-none"
                >
                  <Plus className="w-4 h-4" /> Add Overlay
                </button>
              </>
            ) : undefined
          }
        />

        {/* Channel Selector */}
        <div className="bg-[#111] border border-[#333] rounded-lg p-4">
          <label className="block text-sm font-medium text-gray-400 mb-2">Select Channel</label>
          <select value={selectedChannelId} onChange={(e) => setSelectedChannelId(e.target.value)}
            className="w-full max-w-md px-3 py-2 bg-black border border-[#333] rounded-md text-white focus:outline-none focus:border-gray-500 text-sm">
            <option value="">Choose a channel...</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* Overlays List */}
        {!selectedChannelId ? (
          <EmptyState icon={<Layers className="w-12 h-12" />} title="Select a channel" description="Choose a channel above to view and manage its overlays" />
        ) : loadingOverlays ? (
          <LoadingSpinner />
        ) : overlays.length === 0 ? (
          <EmptyState icon={<Layers className="w-12 h-12" />} title="No overlays" description="Add overlays like logos, text tickers, or live badges to your stream"
            action={
              <button onClick={() => { resetForm(); setShowCreateModal(true); }}
                className="flex items-center gap-2 px-4 py-2 bg-white text-black text-sm font-medium rounded-md hover:bg-gray-200 transition-colors">
                <Plus className="w-4 h-4" /> Add Overlay
              </button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {overlays.map((overlay) => (
              <div key={overlay.id} className="bg-[#111] border border-[#333] rounded-lg p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-[#222] rounded-md text-gray-400">{overlayTypeIcon(overlay.type)}</div>
                    <div>
                      <h3 className="text-white text-sm font-medium">{overlayTypeLabel(overlay.type)}</h3>
                      <p className="text-gray-500 text-xs mt-0.5">
                        {overlay.config?.x != null && overlay.config?.y != null
                          ? `Position: ${overlay.config.x}, ${overlay.config.y}`
                          : `Position: ${overlay.position || 'default'}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEditOverlay(overlay)}
                      className="p-1.5 text-gray-500 hover:text-white hover:bg-[#222] rounded transition-colors"
                      title="Edit overlay"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleToggleActive(overlay)} disabled={togglingId === overlay.id}
                      className={`p-1.5 rounded transition-colors ${overlay.isActive ? 'text-green-500 hover:text-green-400 hover:bg-[#222]' : 'text-gray-600 hover:text-gray-400 hover:bg-[#222]'}`}
                      title={overlay.isActive ? 'Deactivate' : 'Activate'}>
                      {overlay.isActive ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                    </button>
                    <button onClick={() => setDeleteId(overlay.id)}
                      className="p-1.5 text-gray-500 hover:text-red-500 hover:bg-[#222] rounded transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <div className={`w-2 h-2 rounded-full ${overlay.isActive ? 'bg-green-500' : 'bg-gray-600'}`} />
                  <span className="text-xs text-gray-400">{overlay.isActive ? 'Active' : 'Inactive'}</span>
                </div>
                {overlay.config && (
                  <div className="space-y-1.5 bg-black rounded-md p-3">
                    {Object.entries(overlay.config).filter(([k]) => !['path', 'imagePath'].includes(k)).map(([key, value]) => (
                      <div key={key} className="flex justify-between text-xs">
                        <span className="text-gray-500">{key}</span>
                        <span className="text-gray-300 truncate max-w-[180px]">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {overlay.config?.showEveryMinutes && overlay.config?.showForSeconds && (
                  <p className="text-xs text-amber-400 mt-2">
                    Visible every {overlay.config.showEveryMinutes} min for {overlay.config.showForSeconds}s
                  </p>
                )}
                {(overlay.config?.fadeInSeconds || overlay.config?.fadeOutSeconds) && (
                  <p className="text-xs text-gray-500 mt-1">
                    Fade in: {overlay.config?.fadeInSeconds || 0}s · Fade out: {overlay.config?.fadeOutSeconds || 0}s
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Create Overlay Modal (wider for preview) ─── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70" onClick={() => { setShowCreateModal(false); resetForm(); }} />
          <div className={`relative z-10 w-full bg-[#111] border border-[#333] shadow-2xl overflow-y-auto ${
            fullscreenEditor
              ? 'max-w-none h-screen rounded-none mx-0'
              : 'max-w-4xl mx-4 rounded-lg max-h-[90vh]'
          }`}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#333]">
              <h2 className="text-lg font-semibold text-white">
                {editingOverlayId ? 'Edit Overlay' : 'Add Overlay'}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFullscreenEditor((v) => !v)}
                  className="text-[#888] hover:text-white transition-colors p-1.5 rounded hover:bg-[#222]"
                  title={fullscreenEditor ? 'Exit fullscreen' : 'Fullscreen editor'}
                >
                  {fullscreenEditor ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
                <button onClick={() => { setShowCreateModal(false); resetForm(); }} className="text-[#888] hover:text-white transition-colors">
                  <X size={20} />
                </button>
              </div>
            </div>
            <form onSubmit={handleSaveOverlay} className={`px-6 py-4 ${fullscreenEditor ? 'min-h-[calc(100vh-72px)]' : ''}`}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left: Preview */}
                <div className="space-y-4">
                  <OverlayPreview
                    overlay={previewElement}
                    onChange={handlePreviewChange}
                    canvasWidth={previewCanvas.width}
                    canvasHeight={previewCanvas.height}
                    backgroundStreamUrl={previewStreamUrl}
                    onBackgroundVideoMeta={({ width, height }) => {
                      if (width > 0 && height > 0) setLivePreviewSize({ width, height });
                    }}
                  />

                  {/* Position inputs */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">X</label>
                      <input type="number" value={formX} onChange={(e) => setFormX(parseInt(e.target.value) || 0)}
                        min={0} max={previewCanvas.width}
                        className="w-full px-2 py-1.5 bg-black border border-[#333] rounded text-white text-sm font-mono focus:outline-none focus:border-gray-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Y</label>
                      <input type="number" value={formY} onChange={(e) => setFormY(parseInt(e.target.value) || 0)}
                        min={0} max={previewCanvas.height}
                        className="w-full px-2 py-1.5 bg-black border border-[#333] rounded text-white text-sm font-mono focus:outline-none focus:border-gray-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Width</label>
                      <input type="number" value={formWidth} onChange={(e) => setFormWidth(parseInt(e.target.value) || 100)}
                        min={10} max={previewCanvas.width}
                        className="w-full px-2 py-1.5 bg-black border border-[#333] rounded text-white text-sm font-mono focus:outline-none focus:border-gray-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Height</label>
                      <input type="number" value={formHeight} onChange={(e) => setFormHeight(parseInt(e.target.value) || 100)}
                        min={10} max={previewCanvas.height}
                        className="w-full px-2 py-1.5 bg-black border border-[#333] rounded text-white text-sm font-mono focus:outline-none focus:border-gray-500" />
                    </div>
                  </div>

                  {/* Quick position buttons */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">Quick Position</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { label: 'TL', x: 20, y: 20 },
                        { label: 'TC', x: Math.round((previewCanvas.width - formWidth) / 2), y: 20 },
                        { label: 'TR', x: previewCanvas.width - formWidth - 20, y: 20 },
                        { label: 'ML', x: 20, y: Math.round((previewCanvas.height - formHeight) / 2) },
                        { label: 'MC', x: Math.round((previewCanvas.width - formWidth) / 2), y: Math.round((previewCanvas.height - formHeight) / 2) },
                        { label: 'MR', x: previewCanvas.width - formWidth - 20, y: Math.round((previewCanvas.height - formHeight) / 2) },
                        { label: 'BL', x: 20, y: previewCanvas.height - formHeight - 20 },
                        { label: 'BC', x: Math.round((previewCanvas.width - formWidth) / 2), y: previewCanvas.height - formHeight - 20 },
                        { label: 'BR', x: previewCanvas.width - formWidth - 20, y: previewCanvas.height - formHeight - 20 },
                      ].map((pos) => (
                        <button key={pos.label} type="button"
                          onClick={() => { setFormX(Math.max(0, pos.x)); setFormY(Math.max(0, pos.y)); }}
                          className="px-2 py-1.5 bg-black border border-[#333] rounded text-xs text-gray-400 hover:text-white hover:border-gray-500 transition-colors">
                          {pos.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right: Settings */}
                <div className="space-y-4">
                  {/* Type */}
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1.5">Type</label>
                    <select value={formType} onChange={(e) => handleTypeChange(e.target.value as OverlayType)}
                      className="w-full px-3 py-2 bg-black border border-[#333] rounded-md text-white focus:outline-none focus:border-gray-500 text-sm">
                      {OVERLAY_TYPES.map((t) => <option key={t} value={t}>{overlayTypeLabel(t)}</option>)}
                    </select>
                  </div>

                  {/* File Input (LOGO / WATERMARK) */}
                  {needsFileInput && (
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1.5">Image Source</label>
                      <div className="flex items-center gap-1 mb-2 bg-black rounded-md p-1 w-fit">
                        <button type="button" onClick={() => setFormFileMode('upload')}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${formFileMode === 'upload' ? 'bg-[#222] text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                          <Upload className="w-3 h-3" /> Upload
                        </button>
                        <button type="button" onClick={() => setFormFileMode('path')}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${formFileMode === 'path' ? 'bg-[#222] text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                          <FolderOpen className="w-3 h-3" /> Path
                        </button>
                      </div>
                      {formFileMode === 'upload' ? (
                        <div>
                          <input ref={fileInputRef} type="file" accept="image/*"
                            onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                            className="hidden" id="overlay-file-upload" />
                          <label htmlFor="overlay-file-upload"
                            className="flex items-center justify-center gap-2 px-4 py-3 bg-black border border-dashed border-[#333] rounded-md cursor-pointer hover:border-gray-500 transition-colors">
                            <Upload className="w-4 h-4 text-gray-500" />
                            <span className="text-sm text-gray-400">{formFile ? formFile.name : 'Select image file'}</span>
                          </label>
                        </div>
                      ) : (
                        <input type="text" value={formFilePath} onChange={(e) => setFormFilePath(e.target.value)}
                          placeholder="/path/to/image.png"
                          className="w-full px-3 py-2 bg-black border border-[#333] rounded-md text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 text-sm font-mono" />
                      )}
                    </div>
                  )}

                  {/* WATERMARK: Opacity */}
                  {formType === 'WATERMARK' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1.5">Opacity: {formOpacity}</label>
                      <input type="range" min={0.05} max={1} step={0.05} value={formOpacity}
                        onChange={(e) => setFormOpacity(parseFloat(e.target.value))}
                        className="w-full accent-white" />
                    </div>
                  )}

                  {/* SCROLLING_TEXT fields */}
                  {formType === 'SCROLLING_TEXT' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1.5">Text</label>
                        <input type="text" value={formText} onChange={(e) => setFormText(e.target.value)}
                          placeholder="Breaking news: ..."
                          className="w-full px-3 py-2 bg-black border border-[#333] rounded-md text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 text-sm" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-400 mb-1.5">Font Size</label>
                          <input type="number" value={formFontSize} onChange={(e) => setFormFontSize(parseInt(e.target.value) || 24)}
                            min={8} max={120}
                            className="w-full px-3 py-2 bg-black border border-[#333] rounded-md text-white focus:outline-none focus:border-gray-500 text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-400 mb-1.5">Color</label>
                          <div className="flex items-center gap-2">
                            <input type="color" value={formFontColor} onChange={(e) => setFormFontColor(e.target.value)}
                              className="w-9 h-9 bg-transparent border border-[#333] rounded cursor-pointer" />
                            <input type="text" value={formFontColor} onChange={(e) => setFormFontColor(e.target.value)}
                              className="flex-1 px-3 py-2 bg-black border border-[#333] rounded-md text-white text-sm font-mono" />
                          </div>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1.5">Speed: {formSpeed}</label>
                        <input type="range" min={10} max={200} step={5} value={formSpeed}
                          onChange={(e) => setFormSpeed(parseInt(e.target.value))}
                          className="w-full accent-white" />
                      </div>
                    </>
                  )}

                  {/* LIVE_BADGE: Font Size */}
                  {formType === 'LIVE_BADGE' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1.5">Font Size</label>
                      <input type="number" value={formFontSize} onChange={(e) => setFormFontSize(parseInt(e.target.value) || 24)}
                        min={8} max={80}
                        className="w-full px-3 py-2 bg-black border border-[#333] rounded-md text-white focus:outline-none focus:border-gray-500 text-sm" />
                    </div>
                  )}

                  {/* CLOCK: Font size + color */}
                  {formType === 'CLOCK' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1.5">Font Size</label>
                        <input type="number" value={formFontSize} onChange={(e) => setFormFontSize(parseInt(e.target.value) || 24)}
                          min={8} max={120}
                          className="w-full px-3 py-2 bg-black border border-[#333] rounded-md text-white focus:outline-none focus:border-gray-500 text-sm" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1.5">Color</label>
                        <div className="flex items-center gap-2">
                          <input type="color" value={formFontColor} onChange={(e) => setFormFontColor(e.target.value)}
                            className="w-9 h-9 bg-transparent border border-[#333] rounded cursor-pointer" />
                          <input type="text" value={formFontColor} onChange={(e) => setFormFontColor(e.target.value)}
                            className="flex-1 px-3 py-2 bg-black border border-[#333] rounded-md text-white text-sm font-mono" />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="pt-2 border-t border-[#222]">
                    <h4 className="text-sm font-medium text-gray-300 mb-2">Display Schedule (optional)</h4>
                    <p className="text-xs text-gray-500 mb-2">
                      Leave empty to show overlay all the time.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1.5">Every (minutes)</label>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={formShowEveryMinutes}
                          onChange={(e) =>
                            setFormShowEveryMinutes(e.target.value === '' ? '' : Number(e.target.value))
                          }
                          placeholder="e.g. 10"
                          className="w-full px-3 py-2 bg-black border border-[#333] rounded-md text-white focus:outline-none focus:border-gray-500 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1.5">Show (seconds)</label>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={formShowForSeconds}
                          onChange={(e) =>
                            setFormShowForSeconds(e.target.value === '' ? '' : Number(e.target.value))
                          }
                          placeholder="e.g. 15"
                          className="w-full px-3 py-2 bg-black border border-[#333] rounded-md text-white focus:outline-none focus:border-gray-500 text-sm"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1.5">Fade in (seconds)</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={formFadeInSeconds}
                          onChange={(e) =>
                            setFormFadeInSeconds(e.target.value === '' ? '' : Number(e.target.value))
                          }
                          placeholder="e.g. 2"
                          className="w-full px-3 py-2 bg-black border border-[#333] rounded-md text-white focus:outline-none focus:border-gray-500 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1.5">Fade out (seconds)</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={formFadeOutSeconds}
                          onChange={(e) =>
                            setFormFadeOutSeconds(e.target.value === '' ? '' : Number(e.target.value))
                          }
                          placeholder="e.g. 2"
                          className="w-full px-3 py-2 bg-black border border-[#333] rounded-md text-white focus:outline-none focus:border-gray-500 text-sm"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#222]">
                    <button type="button" onClick={() => { setShowCreateModal(false); resetForm(); }}
                      className="px-4 py-2 bg-[#222] text-white text-sm rounded-md hover:bg-[#2a2a2a] border border-[#333] transition-colors">
                      Cancel
                    </button>
                    <button type="submit" disabled={creating}
                      className="px-4 py-2 bg-white text-black text-sm font-medium rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50">
                      {creating ? (editingOverlayId ? 'Saving...' : 'Creating...') : (editingOverlayId ? 'Save Changes' : 'Add Overlay')}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete}
        title="Delete Overlay" message="Are you sure you want to delete this overlay?"
        confirmLabel={deleting ? 'Deleting...' : 'Delete'} loading={deleting} />

    </Layout>
  );
};

export default OverlaysPage;
