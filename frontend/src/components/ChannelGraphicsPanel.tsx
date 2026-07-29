import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, ImagePlus, Maximize2, Move, Radio, RotateCcw, Save, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import { graphicsApi } from '../services/api';
import type { ChannelGraphics, GraphicsAsset, GraphicsMode } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';

const CANVAS = { width: 1280, height: 720, frameRate: 24 };
// `crypto.randomUUID` is unavailable in some HTTP/browser combinations.
// Command IDs only need to be unique per operator action, so use a safe
// client-side fallback for non-secure deployments.
const commandId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `graphics-${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
};

type LogoLayout = { x: number; y: number; width: number; height: number; opacity: number };
const DEFAULT_LAYOUT: LogoLayout = { x: 1056, y: 24, width: 200, height: 100, opacity: 0.9 };
const number = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function publicAssetUrl(asset?: GraphicsAsset | null): string | null {
  if (!asset) return null;
  const normalized = asset.path.replace(/\\/g, '/');
  const at = normalized.lastIndexOf('/uploads/');
  return at >= 0 ? normalized.slice(at) : normalized;
}

export default function ChannelGraphicsPanel({ channelId }: { channelId: string }) {
  const [state, setState] = useState<ChannelGraphics | null>(null);
  const [assets, setAssets] = useState<GraphicsAsset[]>([]);
  const [assetId, setAssetId] = useState('');
  const [mode, setMode] = useState<GraphicsMode>('PLAYER');
  const [layout, setLayout] = useState<LogoLayout>(DEFAULT_LAYOUT);
  const [busy, setBusy] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);

  const selectedAsset = useMemo(() => assets.find((asset) => asset.id === assetId) || null, [assets, assetId]);
  const updateLayout = (key: keyof LogoLayout, raw: number) => {
    setLayout((current) => {
      const value = Number.isFinite(raw) ? raw : current[key];
      if (key === 'opacity') return { ...current, opacity: Math.min(1, Math.max(0, value)) };
      if (key === 'width') return { ...current, width: Math.min(CANVAS.width, Math.max(20, value)), x: Math.min(current.x, CANVAS.width - Math.max(20, value)) };
      if (key === 'height') return { ...current, height: Math.min(CANVAS.height, Math.max(20, value)), y: Math.min(current.y, CANVAS.height - Math.max(20, value)) };
      if (key === 'x') return { ...current, x: Math.min(CANVAS.width - current.width, Math.max(0, value)) };
      return { ...current, y: Math.min(CANVAS.height - current.height, Math.max(0, value)) };
    });
  };

  const beginLogoDrag = (event: React.PointerEvent<HTMLImageElement>) => {
    const frame = previewRef.current?.getBoundingClientRect();
    if (!frame) return;
    dragOffsetRef.current = {
      x: ((event.clientX - frame.left) / frame.width) * CANVAS.width - layout.x,
      y: ((event.clientY - frame.top) / frame.height) * CANVAS.height - layout.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveLogo = (event: React.PointerEvent<HTMLImageElement>) => {
    const frame = previewRef.current?.getBoundingClientRect();
    const offset = dragOffsetRef.current;
    if (!frame || !offset) return;
    const x = ((event.clientX - frame.left) / frame.width) * CANVAS.width - offset.x;
    const y = ((event.clientY - frame.top) / frame.height) * CANVAS.height - offset.y;
    setLayout((current) => ({
      ...current,
      x: Math.min(CANVAS.width - current.width, Math.max(0, x)),
      y: Math.min(CANVAS.height - current.height, Math.max(0, y)),
    }));
  };

  const endLogoDrag = (event: React.PointerEvent<HTMLImageElement>) => {
    dragOffsetRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const load = async () => {
    const [graphics, assetList] = await Promise.all([graphicsApi.get(channelId), graphicsApi.getAssets()]);
    setState(graphics.data || null);
    setAssets(assetList.data || []);
    if (graphics.data) {
      setMode(graphics.data.mode);
      setAssetId(graphics.data.scene?.asset?.id || '');
      const node = graphics.data.scene?.document.nodes.find((item) => item.type === 'image');
      if (node) {
        setLayout({
          x: number(node.x, DEFAULT_LAYOUT.x), y: number(node.y, DEFAULT_LAYOUT.y),
          width: number(node.width, DEFAULT_LAYOUT.width), height: number(node.height, DEFAULT_LAYOUT.height),
          opacity: number(node.opacity, DEFAULT_LAYOUT.opacity),
        });
      }
    }
  };
  useEffect(() => { load().catch(() => toast.error('Failed to load graphics')); }, [channelId]);

  const save = async () => {
    if (!assetId) return toast.error('Upload or select a logo asset first');
    setBusy(true);
    try {
      const data = await graphicsApi.save(channelId, {
        mode, enabled: state?.enabled || false, assetId,
        document: { canvas: CANVAS, nodes: [{ id: 'channel-logo', type: 'image', ...layout, visible: true, zIndex: 100 }] },
      });
      setState(data.data || null);
      toast.success('Graphics draft saved');
    } catch (error: any) { toast.error(error?.response?.data?.error || 'Failed to save graphics'); }
    finally { setBusy(false); }
  };

  const saveAndApply = async () => {
    if (!assetId) return toast.error('Upload or select a logo asset first');
    setBusy(true);
    try {
      const saved = await graphicsApi.save(channelId, {
        mode, enabled: state?.enabled || false, assetId,
        document: { canvas: CANVAS, nodes: [{ id: 'channel-logo', type: 'image', ...layout, visible: true, zIndex: 100 }] },
      });
      setState(saved.data || null);
      await graphicsApi.publish(channelId, commandId());
      await load();
      toast.success(mode === 'PLAYER' ? 'Graphics saved and applied' : 'Graphics saved and applied — channel restarted');
    } catch (error: any) {
      toast.error(error?.response?.data?.error || error?.message || 'Failed to apply graphics');
    }
    finally { setBusy(false); }
  };

  const upload = async (file?: File) => {
    if (!file) return;
    const body = new FormData(); body.append('asset', file);
    setBusy(true);
    try {
      const result = await graphicsApi.uploadAsset(body);
      const asset = result.data!;
      setAssets((current) => [asset, ...current]);
      setAssetId(asset.id);
      toast.success('Graphics asset added');
    } catch (error: any) { toast.error(error?.response?.data?.error || 'Asset upload failed'); }
    finally { setBusy(false); }
  };

  const visibility = async () => {
    if (!state) return;
    setBusy(true);
    try { await graphicsApi.setVisibility(channelId, !state.enabled, commandId()); await load(); }
    catch { toast.error('Failed to update visibility'); }
    finally { setBusy(false); }
  };

  const place = (x: number, y: number) => setLayout((current) => ({ ...current, x, y }));
  const previewUrl = publicAssetUrl(selectedAsset);
  const fieldClass = 'mt-1 h-9';

  return <div className="space-y-5 rounded-xl border border-border bg-card/80 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex items-center gap-2 font-medium"><Radio className="h-4 w-4 text-emerald-400" /> Broadcast graphics</div><p className="mt-1 text-xs text-muted-foreground">Set the logo once, preview it here, then publish it to the player or broadcast stream.</p></div>
      <span className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">{state?.rendererState || 'NOT CONFIGURED'}</span>
    </div>

    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Mode<select className="mt-1 w-full rounded-md border border-border bg-background p-2" value={mode} onChange={(e) => setMode(e.target.value as GraphicsMode)}><option value="PLAYER">Player overlay · recommended</option><option value="BURN_IN">Burned-in broadcast</option><option value="HYBRID">Hybrid</option></select></label>
      <label className="text-sm">Logo asset<select className="mt-1 w-full rounded-md border border-border bg-background p-2" value={assetId} onChange={(e) => setAssetId(e.target.value)}><option value="">Select an asset</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.filename}</option>)}</select></label>
    </div>

    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
      <section>
          <div className="mb-2 flex items-center justify-between"><div className="flex items-center gap-2 text-sm font-medium"><Maximize2 className="h-4 w-4 text-muted-foreground" /> 1280 × 720 preview</div><span className="text-xs text-muted-foreground">Use Save & apply to make changes live</span></div>
        <div ref={previewRef} className="relative aspect-video overflow-hidden rounded-lg border border-border bg-[radial-gradient(circle_at_18%_20%,rgba(16,185,129,.18),transparent_30%),linear-gradient(135deg,#0d1726,#05080d_60%,#111827)] shadow-inner">
          <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:12.5%_16.666%]" />
          <div className="absolute left-4 top-3 rounded bg-red-500 px-2 py-1 text-[10px] font-bold tracking-wide text-white">LIVE PREVIEW</div>
          <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/65 to-transparent" />
          {previewUrl ? <img src={previewUrl} alt="Drag logo to position it" title="Drag to position the logo" onPointerDown={beginLogoDrag} onPointerMove={moveLogo} onPointerUp={endLogoDrag} onPointerCancel={endLogoDrag} className="absolute touch-none select-none object-contain cursor-grab active:cursor-grabbing" draggable={false} style={{ left: `${(layout.x / CANVAS.width) * 100}%`, top: `${(layout.y / CANVAS.height) * 100}%`, width: `${(layout.width / CANVAS.width) * 100}%`, height: `${(layout.height / CANVAS.height) * 100}%`, opacity: layout.opacity }} /> : <div className="absolute inset-0 grid place-items-center text-center text-sm text-muted-foreground">Select or upload a logo to preview it</div>}
          <div className="absolute bottom-3 left-4 text-xs font-medium text-white/80">Channel program</div>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-border bg-background/40 p-4">
        <div className="flex items-center gap-2 text-sm font-medium"><Move className="h-4 w-4 text-muted-foreground" /> Placement & size</div><p className="-mt-2 text-xs text-muted-foreground">Drag the logo in the preview for free placement.</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-muted-foreground">X position<Input className={fieldClass} type="number" min="0" max={CANVAS.width - layout.width} value={layout.x} onChange={(e) => updateLayout('x', Number(e.target.value))} /></label>
          <label className="text-xs text-muted-foreground">Y position<Input className={fieldClass} type="number" min="0" max={CANVAS.height - layout.height} value={layout.y} onChange={(e) => updateLayout('y', Number(e.target.value))} /></label>
          <label className="text-xs text-muted-foreground">Width<Input className={fieldClass} type="number" min="20" max={CANVAS.width} value={layout.width} onChange={(e) => updateLayout('width', Number(e.target.value))} /></label>
          <label className="text-xs text-muted-foreground">Height<Input className={fieldClass} type="number" min="20" max={CANVAS.height} value={layout.height} onChange={(e) => updateLayout('height', Number(e.target.value))} /></label>
        </div>
        <label className="block text-xs text-muted-foreground">Opacity <span className="float-right text-foreground">{Math.round(layout.opacity * 100)}%</span><input className="mt-2 w-full accent-emerald-400" type="range" min="0" max="1" step="0.05" value={layout.opacity} onChange={(e) => updateLayout('opacity', Number(e.target.value))} /></label>
        <div><p className="mb-2 text-xs text-muted-foreground">Quick position</p><div className="grid grid-cols-2 gap-2"><Button type="button" size="sm" variant="outline" onClick={() => place(24, 24)}>Top left</Button><Button type="button" size="sm" variant="outline" onClick={() => place(CANVAS.width - layout.width - 24, 24)}>Top right</Button><Button type="button" size="sm" variant="outline" onClick={() => place(24, CANVAS.height - layout.height - 24)}>Bottom left</Button><Button type="button" size="sm" variant="outline" onClick={() => place(CANVAS.width - layout.width - 24, CANVAS.height - layout.height - 24)}>Bottom right</Button></div></div>
        <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => setLayout(DEFAULT_LAYOUT)}><RotateCcw className="mr-2 h-3.5 w-3.5" />Reset layout</Button>
      </section>
    </div>

    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm"><ImagePlus className="h-4 w-4" /> Upload logo<input className="hidden" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => upload(e.target.files?.[0])} /></label>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy} onClick={save}><Save className="mr-2 h-4 w-4" />Save draft</Button><Button type="button" disabled={busy || !assetId} onClick={saveAndApply}><Send className="mr-2 h-4 w-4" />Save & apply</Button><Button type="button" variant="outline" disabled={busy || !state} onClick={visibility}>{state?.enabled ? <><EyeOff className="mr-2 h-4 w-4" />Hide</> : <><Eye className="mr-2 h-4 w-4" />Show</>}</Button></div>
    </div>
    {mode !== 'PLAYER' && <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">Burned-in broadcast is embedded in the HLS stream, so VLC and other players see it. Publishing, showing, or hiding the logo restarts this channel once.</p>}
  </div>;
}
