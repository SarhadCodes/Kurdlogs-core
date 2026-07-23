import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from './Modal';
import OverlayPreview from './OverlayPreview';
import { playlistApi } from '../services/api';
import { PlaylistItem, PlaylistItemLogoConfig } from '../types';

const CANVAS_W = 1280;
const CANVAS_H = 720;

function logoPreviewUrl(storedPath?: string | null): string | undefined {
  if (!storedPath) return undefined;
  const normalized = storedPath.replace(/\\/g, '/');
  const match =
    normalized.match(/(?:^|\/)uploads\/(logos\/[^/]+)$/i) || normalized.match(/(logos\/[^/]+)$/i);
  if (match) return `/uploads/${match[1]}`;
  if (normalized.startsWith('/uploads/')) return normalized;
  return undefined;
}

interface PlaylistItemLogoModalProps {
  item: PlaylistItem | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function PlaylistItemLogoModal({ item, onClose, onSaved }: PlaylistItemLogoModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [x, setX] = useState(20);
  const [y, setY] = useState(20);
  const [width, setWidth] = useState(200);
  const [height, setHeight] = useState(200);
  const [opacity, setOpacity] = useState(1);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!item) return;
    const cfg = (item.logoConfig || {}) as PlaylistItemLogoConfig;
    setEnabled(!!cfg.enabled);
    setX(cfg.x ?? 20);
    setY(cfg.y ?? 20);
    setWidth(cfg.width ?? 200);
    setHeight(cfg.height ?? 200);
    setOpacity(cfg.opacity ?? 1);
    setLogoFile(null);
    setLogoPreview(logoPreviewUrl(cfg.path || cfg.imagePath) || null);
  }, [item]);

  useEffect(() => {
    if (!logoFile) return;
    const url = URL.createObjectURL(logoFile);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  const overlayElement = useMemo(
    () => ({
      type: 'LOGO' as const,
      x,
      y,
      width,
      height,
      label: 'Logo',
      imageUrl: logoPreview || undefined,
      opacity,
    }),
    [x, y, width, height, logoPreview, opacity]
  );

  const handleSave = async () => {
    if (!item) return;
    if (enabled && !logoPreview && !logoFile) {
      toast.error('Upload a logo image first');
      return;
    }

    const logoConfig: PlaylistItemLogoConfig = {
      enabled,
      x,
      y,
      width,
      height,
      opacity,
    };

    if (item.logoConfig?.path && !logoFile) {
      logoConfig.path = item.logoConfig.path;
    }

    setSaving(true);
    try {
      if (logoFile) {
        const formData = new FormData();
        formData.append('logo', logoFile);
        formData.append('logoConfig', JSON.stringify(logoConfig));
        formData.append('reburn', 'true');
        await playlistApi.updateItemLogo(item.id, formData);
      } else {
        await playlistApi.updateItemLogo(item.id, { logoConfig, reburn: true });
      }
      toast.success(
        enabled
          ? 'Logo burned — live channel will restart automatically (~15 sec)'
          : 'Logo removed — live channel will restart automatically'
      );
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to save logo');
    } finally {
      setSaving(false);
    }
  };

  if (!item) return null;

  return (
    <Modal isOpen={!!item} onClose={onClose} title={`Burn logo — ${item.originalFilename}`}>
      <div className="space-y-4">
        <p className="text-sm text-gray-400">
          Logo is baked into this video once (720p). Uses the already-normalized file when possible — much faster than re-encoding from the original upload.
        </p>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="rounded border-[#444] bg-black"
          />
          <span className="text-sm text-white">Burn logo into this video</span>
        </label>

        {enabled && (
          <>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Logo image</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-[#222] border border-[#333] rounded-md hover:border-[#555]"
                >
                  <Image className="w-4 h-4" />
                  {logoFile ? logoFile.name : 'Choose PNG/JPG'}
                </button>
                {item.logoBurned && (
                  <span className="text-xs text-emerald-500/80">Currently burned in</span>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Width" value={width} onChange={setWidth} min={32} max={800} />
              <Field label="Height" value={height} onChange={setHeight} min={32} max={800} />
              <Field label="X" value={x} onChange={setX} min={0} max={CANVAS_W} />
              <Field label="Y" value={y} onChange={setY} min={0} max={CANVAS_H} />
            </div>

            <OverlayPreview
              overlay={overlayElement}
              onChange={(pos) => {
                setX(pos.x);
                setY(pos.y);
              }}
              canvasWidth={CANVAS_W}
              canvasHeight={CANVAS_H}
            />
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm bg-[#222] border border-[#333] rounded-md text-white hover:bg-[#2a2a2a]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || item.status === 'PROCESSING'}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-white text-black rounded-md hover:bg-gray-200 disabled:opacity-50"
          >
            {saving || item.status === 'PROCESSING' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : null}
            {enabled ? 'Save & burn logo' : 'Remove logo & re-encode'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value) || min)}
        className="w-full px-2 py-1.5 bg-black border border-[#333] rounded text-sm text-white"
      />
    </div>
  );
}
