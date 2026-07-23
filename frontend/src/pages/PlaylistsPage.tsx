import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Plus,
  ListVideo,
  Trash2,
  Upload,
  FolderOpen,
  Film,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Repeat,
  FileVideo,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Replace,
  ArrowUp,
  ArrowDown,
  Image,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { playlistApi, brandProfileApi } from '../services/api';
import { wsService } from '../services/websocket';
import { Playlist, PlaylistItem, PlaylistItemStatus, BrandProfile } from '../types';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import PlaylistItemLogoModal from '../components/PlaylistItemLogoModal';

type AddMode = 'upload' | 'path';
type NormalizeCodec = 'legacy' | 'avc1';

const PlaylistsPage: React.FC = () => {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);

  // Create form
  const [formName, setFormName] = useState('');
  const [formIsLooping, setFormIsLooping] = useState(false);

  // Add video state
  const [addMode, setAddMode] = useState<AddMode>('upload');
  const [videoPath, setVideoPath] = useState('');
  const [addingVideo, setAddingVideo] = useState(false);
  const [uploadingFile, setUploadingFile] = useState<File | null>(null);
  const [normalizeOnAdd, setNormalizeOnAdd] = useState(true);
  const [normalizeCodec, setNormalizeCodec] = useState<NormalizeCodec>('legacy');
  const [brandProfiles, setBrandProfiles] = useState<BrandProfile[]>([]);
  /** '' = playlist/channel default, 'none' = no branding, else profile id */
  const [uploadBrandProfileId, setUploadBrandProfileId] = useState('');
  const [savingPlaylistBrand, setSavingPlaylistBrand] = useState(false);
  const normalizeCodecLabel = normalizeCodec === 'avc1' ? 'H.264 avc1 tag' : 'Fast';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Replace video state
  const [replacingItemId, setReplacingItemId] = useState<string | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  // Delete confirmation
  const [deletePlaylistId, setDeletePlaylistId] = useState<string | null>(null);
  const [deletingPlaylist, setDeletingPlaylist] = useState(false);
  const [deleteItemInfo, setDeleteItemInfo] = useState<{ playlistId: string; itemId: string } | null>(null);
  const [deletingItem, setDeletingItem] = useState(false);
  const [logoItem, setLogoItem] = useState<PlaylistItem | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const fetchPlaylists = useCallback(async () => {
    try {
      const res = await playlistApi.getAll();
      setPlaylists(res.data || []);
    } catch (err: any) {
      toast.error('Failed to load playlists');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSinglePlaylist = useCallback(async (playlistId: string) => {
    try {
      const res = await playlistApi.getById(playlistId);
      if (res.data) {
        setPlaylists((prev) =>
          prev.map((p) => (p.id === playlistId ? res.data! : p))
        );
      }
    } catch {
      // Silently fail, will refresh on next full fetch
    }
  }, []);

  useEffect(() => {
    fetchPlaylists();
    brandProfileApi.getAll().then((res) => {
      if (res.data) setBrandProfiles(res.data);
    }).catch(() => { /* optional */ });
  }, [fetchPlaylists]);

  useEffect(() => {
    const unsub = wsService.subscribe(
      'playlist:item:status',
      (data: { itemId: string; playlistId: string; status: PlaylistItemStatus; error?: string }) => {
        setPlaylists((prev) =>
          prev.map((p) => {
            if (p.id !== data.playlistId || !p.items) return p;
            return {
              ...p,
              items: p.items.map((item) =>
                item.id === data.itemId
                  ? {
                      ...item,
                      status: data.status,
                      processingError:
                        data.status === 'READY'
                          ? null
                          : data.error ?? item.processingError,
                    }
                  : item
              ),
            };
          })
        );

        if (data.status === 'READY') {
          toast.success('Video normalization complete');
        } else if (data.status === 'FAILED') {
          toast.error(data.error || 'Video normalization failed');
        }
      }
    );
    return () => unsub();
  }, []);

  const resetCreateForm = () => {
    setFormName('');
    setFormIsLooping(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      toast.error('Playlist name is required');
      return;
    }

    setCreating(true);
    try {
      await playlistApi.create({
        name: formName.trim(),
        isLooping: formIsLooping,
      });
      toast.success('Playlist created');
      setShowCreateModal(false);
      resetCreateForm();
      fetchPlaylists();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to create playlist');
    } finally {
      setCreating(false);
    }
  };

  const handleDeletePlaylist = async () => {
    if (!deletePlaylistId) return;
    setDeletingPlaylist(true);
    try {
      await playlistApi.delete(deletePlaylistId);
      toast.success('Playlist deleted');
      if (selectedPlaylistId === deletePlaylistId) {
        setSelectedPlaylistId(null);
      }
      setDeletePlaylistId(null);
      fetchPlaylists();
    } catch (err: any) {
      toast.error('Failed to delete playlist');
    } finally {
      setDeletingPlaylist(false);
    }
  };

  const handleTogglePlaylist = (playlistId: string) => {
    if (selectedPlaylistId === playlistId) {
      setSelectedPlaylistId(null);
    } else {
      setSelectedPlaylistId(playlistId);
      // Refresh the playlist data when expanding
      fetchSinglePlaylist(playlistId);
    }
    // Reset add video form when switching
    setVideoPath('');
    setUploadingFile(null);
    setNormalizeOnAdd(true);
    setNormalizeCodec('legacy');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (folderInputRef.current) {
      folderInputRef.current.value = '';
    }
  };

  const uploadErrorMessage = (err: any): string => {
    if (typeof err === 'string') return err;
    return err?.error || err?.message || 'Upload failed — file may be too large or connection timed out';
  };

  const appendBrandToForm = (formData: FormData) => {
    if (uploadBrandProfileId) {
      formData.append('brandProfileId', uploadBrandProfileId);
    }
  };

  const brandPayload = () =>
    uploadBrandProfileId ? { brandProfileId: uploadBrandProfileId } : {};

  const handleSavePlaylistBrand = async (playlistId: string, brandProfileId: string) => {
    setSavingPlaylistBrand(true);
    try {
      await playlistApi.update(playlistId, {
        brandProfileId: brandProfileId || null,
      });
      toast.success('Playlist default brand updated');
      await fetchSinglePlaylist(playlistId);
      fetchPlaylists();
    } catch (err: any) {
      toast.error(err?.error || 'Failed to update playlist brand');
    } finally {
      setSavingPlaylistBrand(false);
    }
  };

  // ── ADD VIDEO: File Upload ──
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedPlaylistId) return;

    setUploadingFile(file);
    setAddingVideo(true);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append('video', file);
      formData.append('normalize', String(normalizeOnAdd));
      formData.append('normalizeCodec', normalizeCodec);
      appendBrandToForm(formData);
      await playlistApi.addItem(selectedPlaylistId, formData, {
        onUploadProgress: setUploadProgress,
      });
      toast.success(
        normalizeOnAdd
          ? `Added "${file.name}" — fast normalize started (720p ultrafast)...`
          : `Added "${file.name}" without normalization`
      );
      await fetchSinglePlaylist(selectedPlaylistId);
    } catch (err: any) {
      toast.error(uploadErrorMessage(err));
    } finally {
      setAddingVideo(false);
      setUploadingFile(null);
      setUploadProgress(null);
      // Reset the file input so the same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const isVideoFile = (file: File): boolean => {
    if (file.type.startsWith('video/')) return true;
    return /\.(mp4|mkv|avi|mov|m4v|ts|m2ts|webm|flv|wmv|mpeg|mpg)$/i.test(file.name);
  };

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedPlaylistId) return;
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const files = Array.from(fileList).filter(isVideoFile);
    if (files.length === 0) {
      toast.error('No video files found in selected folder');
      return;
    }

    setAddingVideo(true);
    try {
      let added = 0;
      for (const file of files) {
        setUploadProgress(0);
        setUploadingFile(file);
        const formData = new FormData();
        formData.append('video', file);
        formData.append('normalize', String(normalizeOnAdd));
        formData.append('normalizeCodec', normalizeCodec);
        appendBrandToForm(formData);
        await playlistApi.addItem(selectedPlaylistId, formData, {
          onUploadProgress: setUploadProgress,
        });
        added++;
      }

      toast.success(
        normalizeOnAdd
          ? `Added ${added} video(s) — normalization started`
          : `Added ${added} video(s) without normalization`
      );
      await fetchSinglePlaylist(selectedPlaylistId);
    } catch (err: any) {
      toast.error(uploadErrorMessage(err));
    } finally {
      setAddingVideo(false);
      setUploadingFile(null);
      setUploadProgress(null);
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  // ── ADD VIDEO: Path Input ──
  const handleAddByPath = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoPath.trim() || !selectedPlaylistId) {
      toast.error('Please enter a valid file path');
      return;
    }

    setAddingVideo(true);
    try {
      const pathStr = videoPath.trim();
      // Extract filename from path (handle both / and \ separators)
      const filename = pathStr.split(/[/\\]/).pop() || pathStr;

      await playlistApi.addItem(selectedPlaylistId, {
        videoPath: pathStr,
        originalFilename: filename,
        normalize: normalizeOnAdd,
        normalizeCodec,
        ...brandPayload(),
      });

      toast.success(
        normalizeOnAdd
          ? `Added "${filename}" — normalizing (${normalizeCodecLabel})...`
          : `Added "${filename}" without normalization`
      );
      setVideoPath('');
      // Refresh the playlist to show the new item
      await fetchSinglePlaylist(selectedPlaylistId);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to add video');
    } finally {
      setAddingVideo(false);
    }
  };

  // ── DELETE ITEM ──
  const handleDeleteItem = async () => {
    if (!deleteItemInfo) return;
    setDeletingItem(true);
    try {
      await playlistApi.removeItem(deleteItemInfo.playlistId, deleteItemInfo.itemId);
      toast.success('Item removed from playlist');
      setDeleteItemInfo(null);
      // Refresh playlist
      await fetchSinglePlaylist(deleteItemInfo.playlistId);
    } catch (err: any) {
      toast.error('Failed to remove item');
    } finally {
      setDeletingItem(false);
    }
  };

  const handleReplaceClick = (itemId: string) => {
    setReplacingItemId(itemId);
    setTimeout(() => replaceInputRef.current?.click(), 0);
  };

  const handleReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !replacingItemId || !selectedPlaylistId) return;

    try {
      setUploadProgress(0);
      const formData = new FormData();
      formData.append('video', file);
      appendBrandToForm(formData);
      await playlistApi.replaceItem(replacingItemId, formData, {
        onUploadProgress: setUploadProgress,
      });
      toast.success(`Replacing with "${file.name}" — fast normalize started...`);
      await fetchSinglePlaylist(selectedPlaylistId);
    } catch (err: any) {
      toast.error(uploadErrorMessage(err));
    } finally {
      setReplacingItemId(null);
      setUploadProgress(null);
      if (replaceInputRef.current) replaceInputRef.current.value = '';
    }
  };

  const handleRetryNormalize = async (item: PlaylistItem, playlistId: string) => {
    try {
      await playlistApi.retryNormalize(item.id);
      toast.success(`Retrying normalize for "${item.originalFilename}"…`);
      await fetchSinglePlaylist(playlistId);
    } catch (err: any) {
      toast.error(err?.error || 'Retry failed');
    }
  };

  const handleMoveItem = async (playlistId: string, fromIndex: number, toIndex: number) => {
    const playlist = playlists.find((p) => p.id === playlistId);
    if (!playlist?.items) return;
    if (toIndex < 0 || toIndex >= playlist.items.length) return;

    const nextItems = [...playlist.items];
    const [moved] = nextItems.splice(fromIndex, 1);
    nextItems.splice(toIndex, 0, moved);
    const itemIds = nextItems.map((i) => i.id);

    // Optimistic update for snappy UX
    setPlaylists((prev) =>
      prev.map((p) => (p.id === playlistId ? { ...p, items: nextItems } : p))
    );

    try {
      await playlistApi.reorderItems(playlistId, itemIds);
      toast.success('Playlist order updated');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to reorder videos');
      await fetchSinglePlaylist(playlistId);
    }
  };

  const selectedPlaylist = playlists.find((p) => p.id === selectedPlaylistId);

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
          title="Playlists"
          description={`${playlists.length} playlist${playlists.length !== 1 ? 's' : ''}`}
          actions={
            <>
            <button
              onClick={() => fetchPlaylists()}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[#222222] text-white text-sm rounded-md hover:bg-[#2a2a2a] border border-[#333333] transition-colors min-h-[44px]"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-black text-sm font-medium rounded-md hover:bg-gray-200 transition-colors min-h-[44px] flex-1 sm:flex-none"
            >
              <Plus className="w-4 h-4" />
              Create Playlist
            </button>
            </>
          }
        />

        {/* Playlists */}
        {playlists.length === 0 ? (
          <EmptyState
            icon={<ListVideo className="w-12 h-12" />}
            title="No playlists yet"
            description="Create a playlist to organize your video content"
            action={
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-white text-black text-sm font-medium rounded-md hover:bg-gray-200 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create Playlist
              </button>
            }
          />
        ) : (
          <div className="space-y-3">
            {playlists.map((playlist) => {
              const isExpanded = selectedPlaylistId === playlist.id;
              // Ensure we fallback to _count?.items if items array is not populated
              const items: PlaylistItem[] = playlist.items || [];
              const itemsCount = playlist._count?.items ?? items.length;

              return (
                <div
                  key={playlist.id}
                  className="bg-[#111111] border border-[#333333] rounded-lg overflow-hidden"
                >
                  {/* Playlist Header */}
                  <div
                    className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-[#1a1a1a] transition-colors"
                    onClick={() => handleTogglePlaylist(playlist.id)}
                  >
                    <div className="flex items-center gap-3">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-gray-500" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-500" />
                      )}
                      <ListVideo className="w-5 h-5 text-gray-400" />
                      <div>
                        <h3 className="text-white font-medium text-sm">{playlist.name}</h3>
                        <p className="text-gray-500 text-xs mt-0.5">
                          {itemsCount} item{itemsCount !== 1 ? 's' : ''}
                          {playlist.isLooping && (
                            <span className="inline-flex items-center gap-1 ml-2">
                              <Repeat className="w-3 h-3" />
                              Looping
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletePlaylistId(playlist.id);
                      }}
                      className="p-2 text-gray-600 hover:text-red-500 hover:bg-[#222222] rounded-md transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div className="border-t border-[#222222]">
                      {/* Add Video Section */}
                      <div className="px-5 py-4 border-b border-[#222222]">
                        <h4 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
                          <Plus className="w-4 h-4" />
                          Add Video
                        </h4>

                        {/* Mode Tabs */}
                        <div className="flex items-center gap-1 mb-3 bg-black rounded-md p-1 w-fit">
                          <button
                            onClick={() => setAddMode('upload')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                              addMode === 'upload'
                                ? 'bg-[#222222] text-white'
                                : 'text-gray-500 hover:text-gray-300'
                            }`}
                          >
                            <Upload className="w-3 h-3" />
                            Upload File
                          </button>
                          <button
                            onClick={() => setAddMode('path')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                              addMode === 'path'
                                ? 'bg-[#222222] text-white'
                                : 'text-gray-500 hover:text-gray-300'
                            }`}
                          >
                            <FolderOpen className="w-3 h-3" />
                            Enter Path
                          </button>
                        </div>

                        <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-[#2a2a2a] bg-black px-3 py-2">
                          <div>
                            <p className="text-xs text-gray-300">Normalize video</p>
                            <p className="text-[11px] text-gray-600">
                              Fast 720p H.264 — instant remux for MP4/H.264, encode only when needed
                            </p>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={normalizeOnAdd}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setNormalizeOnAdd(checked);
                                if (!checked) setNormalizeCodec('legacy');
                              }}
                              disabled={addingVideo}
                              className="sr-only peer"
                            />
                            <div className="w-9 h-5 bg-[#333333] rounded-full peer peer-checked:bg-white transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-500 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full peer-checked:after:bg-black" />
                          </label>
                        </div>
                        {normalizeOnAdd && (
                          <div className="mb-3">
                            <label className="block text-xs text-gray-400 mb-1.5">Normalization codec</label>
                            <select
                              value={normalizeCodec}
                              onChange={(e) => setNormalizeCodec(e.target.value as NormalizeCodec)}
                              disabled={addingVideo}
                              className="w-full px-3 py-2 bg-black border border-[#333333] rounded-md text-white focus:outline-none focus:border-gray-500 text-sm"
                            >
                              <option value="legacy">Fast (recommended)</option>
                              <option value="avc1">H.264 with avc1 tag</option>
                            </select>
                          </div>
                        )}

                        <div className="mb-3">
                          <label className="block text-xs text-gray-400 mb-1.5 flex items-center gap-1.5">
                            <Image className="w-3.5 h-3.5" />
                            Brand profile for this upload
                          </label>
                          <select
                            value={uploadBrandProfileId}
                            onChange={(e) => setUploadBrandProfileId(e.target.value)}
                            disabled={addingVideo}
                            className="w-full px-3 py-2 bg-black border border-[#333333] rounded-md text-white focus:outline-none focus:border-gray-500 text-sm"
                          >
                            <option value="">
                              {playlist.brandProfile
                                ? `Playlist default (${playlist.brandProfile.name})`
                                : 'Default (playlist / channel brand)'}
                            </option>
                            <option value="none">No branding</option>
                            {brandProfiles.map((bp) => (
                              <option key={bp.id} value={bp.id}>
                                {bp.name}
                              </option>
                            ))}
                          </select>
                          <p className="text-[11px] text-gray-600 mt-1">
                            Logo is burned during upload — not at stream runtime
                          </p>
                        </div>

                        <div className="mb-3 rounded-md border border-[#2a2a2a] bg-black px-3 py-2">
                          <label className="block text-xs text-gray-400 mb-1.5">Playlist default brand</label>
                          <div className="flex gap-2">
                            <select
                              key={playlist.id}
                              value={playlist.brandProfileId || ''}
                              disabled={savingPlaylistBrand}
                              onChange={(e) => handleSavePlaylistBrand(playlist.id, e.target.value)}
                              className="flex-1 px-3 py-2 bg-[#111] border border-[#333333] rounded-md text-white text-sm"
                            >
                              <option value="">None</option>
                              {brandProfiles.map((bp) => (
                                <option key={bp.id} value={bp.id}>
                                  {bp.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {/* Upload File Mode */}
                        {addMode === 'upload' && (
                          <div>
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept="video/*"
                              onChange={handleFileSelect}
                              disabled={addingVideo}
                              className="hidden"
                              id={`file-upload-${playlist.id}`}
                            />
                            <input
                              ref={folderInputRef}
                              type="file"
                              multiple
                              {...({ webkitdirectory: '' } as any)}
                              onChange={handleFolderSelect}
                              disabled={addingVideo}
                              className="hidden"
                              id={`folder-upload-${playlist.id}`}
                            />
                            {addingVideo ? (
                              <div className="flex flex-col gap-2 px-4 py-3 bg-black rounded-md border border-[#333333]">
                                <div className="flex items-center gap-3">
                                  <div className="w-4 h-4 border-2 border-gray-500/30 border-t-gray-300 rounded-full animate-spin flex-shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm text-white truncate">
                                      {uploadingFile ? `Uploading: ${uploadingFile.name}` : 'Uploading videos...'}
                                    </p>
                                    {uploadingFile && (
                                      <p className="text-xs text-gray-500">
                                        {(uploadingFile.size / (1024 * 1024)).toFixed(1)} MB
                                        {uploadProgress != null ? ` · ${uploadProgress}%` : ''}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                {uploadProgress != null && (
                                  <div className="h-1.5 bg-[#222] rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-emerald-500 transition-all duration-300"
                                      style={{ width: `${uploadProgress}%` }}
                                    />
                                  </div>
                                )}
                                <p className="text-[10px] text-gray-600">Large files may take several minutes — do not close this tab.</p>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <label
                                  htmlFor={`file-upload-${playlist.id}`}
                                  className="flex flex-col items-center justify-center gap-2 px-4 py-5 bg-black border border-dashed border-[#333333] rounded-md cursor-pointer hover:border-gray-500 transition-colors"
                                >
                                  <Upload className="w-6 h-6 text-gray-500" />
                                  <span className="text-sm text-gray-400">
                                    Click to select a video file
                                  </span>
                                  <span className="text-xs text-gray-600">
                                    Supports MP4, MKV, AVI, MOV, TS and more
                                  </span>
                                </label>
                                <label
                                  htmlFor={`folder-upload-${playlist.id}`}
                                  className="flex items-center justify-center gap-2 px-4 py-2 bg-[#171717] border border-[#333333] rounded-md cursor-pointer hover:border-gray-500 transition-colors"
                                >
                                  <FolderOpen className="w-4 h-4 text-gray-400" />
                                  <span className="text-sm text-gray-300">Upload folder (all videos)</span>
                                </label>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Enter Path Mode */}
                        {addMode === 'path' && (
                          <form onSubmit={handleAddByPath} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={videoPath}
                              onChange={(e) => setVideoPath(e.target.value)}
                              placeholder="/path/to/video.mp4 or C:\Videos\file.mp4"
                              disabled={addingVideo}
                              className="flex-1 px-3 py-2 bg-black border border-[#333333] rounded-md text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 text-sm font-mono"
                            />
                            <button
                              type="submit"
                              disabled={addingVideo || !videoPath.trim()}
                              className="flex items-center gap-2 px-4 py-2 bg-white text-black text-sm font-medium rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                            >
                              {addingVideo ? (
                                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                              ) : (
                                <Plus className="w-4 h-4" />
                              )}
                              Add
                            </button>
                          </form>
                        )}
                      </div>

                      {/* Items List */}
                      <div>
                        {items.length === 0 ? (
                          <div className="px-5 py-8 text-center">
                            <Film className="w-8 h-8 mx-auto mb-2 text-gray-600" />
                            <p className="text-sm text-gray-500">
                              No videos in this playlist yet
                            </p>
                            <p className="text-xs text-gray-600 mt-1">
                              Use the form above to add videos
                            </p>
                          </div>
                        ) : (
                          <div className="divide-y divide-[#1a1a1a]">
                            {items.map((item, index) => (
                              <div
                                key={item.id}
                                className={`flex items-center justify-between px-5 py-3 hover:bg-[#1a1a1a] transition-colors group ${
                                  item.status === 'FAILED' ? 'bg-red-500/5' : ''
                                }`}
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <span className="text-xs text-gray-600 font-mono w-6 text-right flex-shrink-0">
                                    {index + 1}.
                                  </span>

                                  {item.status === 'PROCESSING' ? (
                                    <Loader2 className="w-4 h-4 text-yellow-500 animate-spin flex-shrink-0" />
                                  ) : item.status === 'FAILED' ? (
                                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                                  ) : item.status === 'READY' ? (
                                    <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                                  ) : (
                                    <FileVideo className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                  )}

                                  <div className="min-w-0">
                                    <p className="text-sm text-white truncate">
                                      {item.originalFilename || item.videoPath || `Item ${index + 1}`}
                                    </p>
                                    <p className="text-xs text-gray-600 truncate mt-0.5">
                                      {item.status === 'PROCESSING' && (
                                        <span className="text-yellow-500">
                                          {item.processingError || 'Processing…'}
                                        </span>
                                      )}
                                      {item.status === 'FAILED' && (
                                        <span className="text-red-500">
                                          Failed{item.processingError ? `: ${item.processingError}` : ''}
                                        </span>
                                      )}
                                      {item.status === 'READY' && (
                                        <span className="text-green-500/70">
                                          Ready{item.logoBurned ? ' · logo burned in' : ''}
                                        </span>
                                      )}
                                      {!item.status && item.videoPath && item.originalFilename && (
                                        <span>{item.videoPath}</span>
                                      )}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                {item.status === 'FAILED' && (
                                  <>
                                    <button
                                      onClick={() => handleReplaceClick(item.id)}
                                      title="Upload this video again"
                                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-sky-400 border border-sky-500/30 rounded hover:bg-sky-500/10"
                                    >
                                      <Upload className="w-3.5 h-3.5" />
                                      Re-upload
                                    </button>
                                    <button
                                      onClick={() => handleRetryNormalize(item, playlist.id)}
                                      title="Retry normalization (only if file still on server)"
                                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-amber-400 border border-amber-500/30 rounded hover:bg-amber-500/10"
                                    >
                                      <RefreshCw className="w-3.5 h-3.5" />
                                      Retry
                                    </button>
                                  </>
                                )}
                                <button
                                  onClick={() => setLogoItem(item)}
                                  disabled={item.status === 'PROCESSING'}
                                  title="Burn logo into this video"
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs text-emerald-400 border border-emerald-500/30 rounded hover:bg-emerald-500/10 disabled:opacity-50"
                                >
                                  <Image className="w-3.5 h-3.5" />
                                  Logo
                                </button>
                                <button
                                  onClick={() => handleMoveItem(playlist.id, index, index - 1)}
                                  disabled={index === 0}
                                  title="Move up"
                                  className="p-1.5 text-gray-600 hover:text-white hover:bg-[#222222] rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  <ArrowUp className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleMoveItem(playlist.id, index, index + 1)}
                                  disabled={index === items.length - 1}
                                  title="Move down"
                                  className="p-1.5 text-gray-600 hover:text-white hover:bg-[#222222] rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  <ArrowDown className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleReplaceClick(item.id)}
                                  disabled={replacingItemId === item.id}
                                  title="Replace video"
                                  className="p-1.5 text-gray-600 hover:text-blue-400 hover:bg-[#222222] rounded transition-colors disabled:opacity-50"
                                >
                                  {replacingItemId === item.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Replace className="w-4 h-4" />
                                  )}
                                </button>
                                <button
                                  onClick={() =>
                                    setDeleteItemInfo({
                                      playlistId: playlist.id,
                                      itemId: item.id,
                                    })
                                  }
                                  className="p-1.5 text-gray-600 hover:text-red-500 hover:bg-[#222222] rounded transition-colors"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Playlist Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          resetCreateForm();
        }}
        title="Create Playlist"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">
              Playlist Name
            </label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="My Playlist"
              autoFocus
              className="w-full px-3 py-2 bg-[#111111] border border-[#333333] rounded-md text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 text-sm"
            />
          </div>

          <div className="flex items-center gap-3">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formIsLooping}
                onChange={(e) => setFormIsLooping(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-[#333333] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-500 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-white peer-checked:after:bg-black" />
            </label>
            <div>
              <span className="text-sm text-gray-400">Loop Playlist</span>
              <p className="text-xs text-gray-600">Restart from beginning after last item</p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setShowCreateModal(false);
                resetCreateForm();
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
              {creating ? 'Creating...' : 'Create Playlist'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Playlist Confirmation */}
      <ConfirmDialog
        isOpen={!!deletePlaylistId}
        onClose={() => setDeletePlaylistId(null)}
        onConfirm={handleDeletePlaylist}
        title="Delete Playlist"
        message="Are you sure you want to delete this playlist? All items will be removed. This action cannot be undone."
        confirmLabel={deletingPlaylist ? 'Deleting...' : 'Delete'}
        loading={deletingPlaylist}
      />

      {/* Hidden file input for replacing videos */}
      <input
        ref={replaceInputRef}
        type="file"
        accept="video/*"
        onChange={handleReplaceFile}
        className="hidden"
      />

      {/* Delete Item Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteItemInfo}
        onClose={() => setDeleteItemInfo(null)}
        onConfirm={handleDeleteItem}
        title="Remove Item"
        message="Are you sure you want to remove this item from the playlist?"
        confirmLabel={deletingItem ? 'Removing...' : 'Remove'}
        loading={deletingItem}
      />

      <PlaylistItemLogoModal
        item={logoItem}
        onClose={() => setLogoItem(null)}
        onSaved={() => {
          if (selectedPlaylistId) fetchSinglePlaylist(selectedPlaylistId);
        }}
      />
    </Layout>
  );
};

export default PlaylistsPage;
