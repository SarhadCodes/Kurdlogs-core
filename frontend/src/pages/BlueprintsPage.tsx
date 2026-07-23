import { useCallback, useEffect, useRef, useState } from 'react';
import { Blocks, Eye, LayoutGrid, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import BlueprintCanvas from '../components/blueprint/BlueprintCanvas';
import BlueprintSimulatorPanel from '../components/blueprint/BlueprintSimulatorPanel';
import BlueprintSummaryPanel from '../components/blueprint/BlueprintSummaryPanel';
import BlueprintPreviewTimeline from '../components/blueprint/BlueprintPreviewTimeline';
import { newBlock } from '../components/blueprint/blockMeta';
import { blueprintApi, playlistApi, channelApi } from '../services/api';
import BlueprintWorkspaceLayout, { useBlueprintWorkspace } from '../components/blueprint/BlueprintWorkspaceLayout';
import { PublishPanelContent } from '../components/blueprint/BlueprintPublishResult';
import type {
  BlueprintBlock,
  BlueprintBlockType,
  ChannelBlueprint,
  BlueprintSimulation,
  BlueprintSummary,
  SimulationHorizon,
  Playlist,
  Channel,
  PublishBlueprintResult,
  BlueprintLiveCursor,
} from '../types';
import { saveTimelineToStorage, loadTimelineFromStorage, clearTimelineStorage } from '../utils/blueprintTimelineCache';
import { resolveLiveSegmentIndex } from '../utils/resolveLiveSegmentIndex';
import { wsService } from '../services/websocket';

type EditorTab = 'design' | 'watch';

export default function BlueprintsPage() {
  const [loading, setLoading] = useState(true);
  const [blueprints, setBlueprints] = useState<ChannelBlueprint[]>([]);
  const [templates, setTemplates] = useState<Array<{ key: string; name: string; description: string }>>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<BlueprintBlock[]>([]);
  const [name, setName] = useState('');
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedTransitionBlockId, setSelectedTransitionBlockId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [simulation, setSimulation] = useState<BlueprintSimulation | null>(null);
  const [timelineSim, setTimelineSim] = useState<BlueprintSimulation | null>(null);
  const [summary, setSummary] = useState<BlueprintSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [horizon, setHorizon] = useState<SimulationHorizon>('1h');
  const [timelineHorizon, setTimelineHorizon] = useState<SimulationHorizon>('24h');
  const [simulating, setSimulating] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [publishChannelId, setPublishChannelId] = useState('');
  const [linkedChannelId, setLinkedChannelId] = useState<string | null>(null);
  const [liveCursor, setLiveCursor] = useState<BlueprintLiveCursor | null>(null);
  const [liveSegmentIndex, setLiveSegmentIndex] = useState<number | null>(null);
  const [timelineAutoLoading, setTimelineAutoLoading] = useState(false);
  const blueprintUpdatedAtRef = useRef<string | undefined>();
  const [publishResult, setPublishResult] = useState<PublishBlueprintResult | null>(null);
  const [editorTab, setEditorTab] = useState<EditorTab>('design');
  const { ws, patch: patchWorkspace } = useBlueprintWorkspace(activeId);

  const load = useCallback(async () => {
    try {
      const [bpRes, tplRes, plRes, chRes] = await Promise.all([
        blueprintApi.getAll(),
        blueprintApi.getTemplates(),
        playlistApi.getAll(),
        channelApi.getAll(),
      ]);
      if (bpRes.data) setBlueprints(bpRes.data);
      if (tplRes.data) setTemplates(tplRes.data);
      if (plRes.data) setPlaylists(plRes.data);
      if (chRes.data) setChannels(chRes.data.filter((c) => c.isPlaylistChannel));
    } catch {
      toast.error('Failed to load blueprints');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refreshSummary = useCallback(async (id: string, currentBlocks: BlueprintBlock[]) => {
    setSummaryLoading(true);
    try {
      const res = await blueprintApi.summary(id, currentBlocks);
      if (res.data) setSummary(res.data);
    } catch {
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeId || blocks.length === 0) {
      setSummary(null);
      return;
    }
    const t = setTimeout(() => refreshSummary(activeId, blocks), 400);
    return () => clearTimeout(t);
  }, [activeId, blocks, refreshSummary]);

  const selectBlueprint = async (id: string) => {
    try {
      const res = await blueprintApi.getById(id);
      if (res.data) {
        setActiveId(id);
        setName(res.data.name);
        setBlocks(res.data.blocks || []);
        setSimulation(null);
        if (id !== activeId) setTimelineSim(null);
        setSelectedBlockId(null);
        setSelectedTransitionBlockId(null);
        setEditorTab('design');
        const chId = res.data.channel?.id ?? null;
        setLinkedChannelId(chId);
        if (chId) setPublishChannelId(chId);
        blueprintUpdatedAtRef.current = res.data.updatedAt;
        const cached = loadTimelineFromStorage(id, timelineHorizon, res.data.updatedAt);
        if (cached) setTimelineSim(cached);
      }
    } catch {
      toast.error('Failed to load blueprint');
    }
  };

  const createFromTemplate = async (templateKey: string) => {
    try {
      const res = await blueprintApi.create({ templateKey });
      if (res.data) {
        toast.success('Blueprint created from template');
        await load();
        await selectBlueprint(res.data.id);
      }
    } catch (err: any) {
      toast.error(err?.error || 'Create failed');
    }
  };

  const handleSave = async () => {
    if (!activeId) return;
    setSaving(true);
    try {
      await blueprintApi.update(activeId, { name, blocks });
      toast.success('Blueprint saved');
      await load();
      await refreshSummary(activeId, blocks);
    } catch (err: any) {
      toast.error(err?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleSimulate = async () => {
    if (!activeId) return;
    setSimulating(true);
    try {
      await blueprintApi.update(activeId, { blocks });
      const res = await blueprintApi.simulate(activeId, horizon);
      if (res.data) setSimulation(res.data);
    } catch (err: any) {
      toast.error(err?.error || 'Simulation failed');
    } finally {
      setSimulating(false);
    }
  };

  const handleTimeline = useCallback(
    async (silent = false) => {
      if (!activeId) return;
      if (!silent) setTimelineLoading(true);
      else setTimelineAutoLoading(true);
      try {
        await blueprintApi.update(activeId, { blocks });
        const channelId = linkedChannelId ?? (publishChannelId || undefined);
        const res = await blueprintApi.timeline(activeId, timelineHorizon, blocks, channelId);
        if (res.data) {
          setTimelineSim(res.data);
          saveTimelineToStorage(activeId, timelineHorizon, res.data);
          if (res.data.liveSegmentIndex != null) setLiveSegmentIndex(res.data.liveSegmentIndex);
        }
      } catch (err: any) {
        if (!silent) toast.error(err?.error || 'Timeline failed');
      } finally {
        setTimelineLoading(false);
        setTimelineAutoLoading(false);
      }
    },
    [activeId, blocks, linkedChannelId, publishChannelId, timelineHorizon]
  );

  const pollLiveCursor = useCallback(async () => {
    const channelId = linkedChannelId ?? publishChannelId;
    if (!activeId || !channelId || !timelineSim?.segments?.length) return;
    try {
      const res = await blueprintApi.liveCursor(activeId, channelId, timelineHorizon);
      if (!res.data) return;

      if (
        res.data.playbackEpoch != null &&
        timelineSim.playbackEpoch != null &&
        res.data.playbackEpoch !== timelineSim.playbackEpoch
      ) {
        clearTimelineStorage(activeId);
        handleTimeline(true);
        return;
      }

      const apiMedia = res.data.current?.title ?? res.data.visible?.title ?? res.data.engine?.title ?? null;
      if (
        apiMedia &&
        (res.data.timelineIndex == null || res.data.timelineIndex < 0) &&
        res.data.timelineMatchMethod === 'none'
      ) {
        if (import.meta.env.DEV) {
          console.warn(
            `[TIMELINE_LOOKUP] match_failed apiMedia=${apiMedia} playbackEpoch=${res.data.playbackEpoch ?? 'n/a'} ` +
              `timelineEpoch=${timelineSim.playbackEpoch ?? 'n/a'} refreshingTimeline=true`
          );
        }
        clearTimelineStorage(activeId);
        handleTimeline(true);
        return;
      }

      setLiveCursor(res.data);
      const idx = resolveLiveSegmentIndex(timelineSim.segments, res.data);
      setLiveSegmentIndex(idx);

      const renderedMedia =
        idx != null && idx >= 0 ? timelineSim.segments[idx]?.title ?? null : null;

      if (import.meta.env.DEV) {
        console.info(
          `[FRONTEND_SYNC] apiMedia=${apiMedia ?? 'none'} renderedMedia=${renderedMedia ?? 'none'} ` +
            `timelineIndex=${res.data.timelineIndex ?? 'n/a'} renderedIndex=${idx ?? 'n/a'} ` +
            `activePlaybackTimeSec=${res.data.timing?.activePlaybackTimeSec?.toFixed(2) ?? res.data.activePlaybackTimeSec?.toFixed(2) ?? 'n/a'} ` +
            `matchMethod=${res.data.timelineMatchMethod ?? 'n/a'}`
        );
        if (apiMedia && renderedMedia && apiMedia !== renderedMedia) {
          console.warn(
            `[FRONTEND_STALE] apiMedia=${apiMedia} renderedMedia=${renderedMedia} ` +
              `apiTimelineIndex=${res.data.timelineIndex} renderedIndex=${idx}`
          );
        }
      }
    } catch {
      /* channel may be offline */
    }
  }, [activeId, linkedChannelId, publishChannelId, timelineSim, timelineHorizon, handleTimeline]);

  const handleTimelineHorizonChange = useCallback(
    (h: SimulationHorizon) => {
      setTimelineHorizon(h);
      if (!activeId) return;
      const restored = loadTimelineFromStorage(activeId, h, blueprintUpdatedAtRef.current);
      if (restored) {
        setTimelineSim(restored);
        return;
      }
      blueprintApi.cachedTimeline(activeId, h, (linkedChannelId ?? publishChannelId) || undefined).then((res) => {
        if (res.data) {
          setTimelineSim(res.data);
          saveTimelineToStorage(activeId, h, res.data);
        }
      });
    },
    [activeId]
  );

  /** Restore or generate timeline when opening Watch tab */
  useEffect(() => {
    if (editorTab !== 'watch' || !activeId) return;

    const channelId = linkedChannelId ?? publishChannelId;

    (async () => {
      if (channelId) {
        try {
          const cached = await blueprintApi.cachedTimeline(activeId, timelineHorizon, channelId);
          if (cached.data) {
            setTimelineSim(cached.data);
            saveTimelineToStorage(activeId, timelineHorizon, cached.data);
            return;
          }
        } catch {
          /* fall through */
        }
      } else {
        const restored = loadTimelineFromStorage(
          activeId,
          timelineHorizon,
          blueprintUpdatedAtRef.current
        );
        if (restored) {
          setTimelineSim(restored);
          return;
        }
      }

      if (channelId) {
        handleTimeline(true);
      }
    })();
  }, [editorTab, activeId, timelineHorizon, linkedChannelId, publishChannelId, handleTimeline]);

  /** WebSocket: immediate timeline invalidation after playlist/runtime rebuild */
  useEffect(() => {
    if (!activeId) return;
    const channelId = linkedChannelId ?? publishChannelId;
    const handler = (payload: { blueprintId?: string; channelId?: string; playbackEpoch?: number }) => {
      if (payload.blueprintId !== activeId) return;
      if (channelId && payload.channelId && payload.channelId !== channelId) return;
      clearTimelineStorage(activeId);
      if (editorTab === 'watch') {
        handleTimeline(true);
      }
    };
    wsService.connect();
    const unsub = wsService.subscribe('blueprint:playback-sync', handler);
    return () => unsub();
  }, [activeId, linkedChannelId, publishChannelId, editorTab, handleTimeline]);

  /** Poll engine cursor every 8s while Watch tab is open */
  useEffect(() => {
    if (editorTab !== 'watch' || !activeId || !(linkedChannelId || publishChannelId)) return;
    pollLiveCursor();
    const id = window.setInterval(pollLiveCursor, 5000);
    return () => window.clearInterval(id);
  }, [editorTab, activeId, linkedChannelId, publishChannelId, pollLiveCursor]);

  /** Advance NOW marker between polls when current segment ends */
  useEffect(() => {
    if (!timelineSim?.segments?.length || !liveCursor) return;
    const idx = resolveLiveSegmentIndex(timelineSim.segments, liveCursor);
    if (idx != null) setLiveSegmentIndex(idx);
  }, [timelineSim, liveCursor]);

  const handlePublish = async () => {
    if (!activeId || !publishChannelId) {
      toast.error('Select a channel to publish');
      return;
    }
    try {
      const res = await blueprintApi.publish(activeId, publishChannelId, blocks);
      if (res.data) {
        setPublishResult(res.data);
        patchWorkspace({ publishCollapsed: false, expandCanvas: false });
        if (res.data.streamRestarted) {
          toast.success(`Blueprint active on ${res.data.channel.name}`);
        } else {
          toast.success('Published — start the channel to activate blueprint playback');
        }
      }
      await load();
    } catch (err: any) {
      toast.error(err?.error || err?.response?.data?.error || 'Publish failed');
      setPublishResult(null);
    }
  };

  const handleDelete = async (bp: ChannelBlueprint) => {
    const linked = bp.channel?.name;
    const msg = linked
      ? `"${bp.name}" is published to ${linked}. Unlink the channel and delete this blueprint?`
      : `Delete blueprint "${bp.name}"?`;
    if (!window.confirm(msg)) return;
    try {
      await blueprintApi.delete(bp.id);
      if (activeId === bp.id) {
        setActiveId(null);
        setBlocks([]);
        setSummary(null);
      }
      toast.success('Deleted');
      await load();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.error || 'Delete failed';
      toast.error(msg);
    }
  };

  const handleAddBlock = (type: BlueprintBlockType, insertAfterBlockId?: string | null) => {
    const nb = newBlock(type);
    setBlocks((prev) => {
      const withoutLoop = prev.filter((b) => b.type !== 'LOOP');
      const loop = prev.find((b) => b.type === 'LOOP');
      if (type === 'LOOP') {
        if (loop) return prev;
        return [...prev, nb];
      }

      let insertIndex = withoutLoop.length;
      if (insertAfterBlockId) {
        const idx = withoutLoop.findIndex((b) => b.id === insertAfterBlockId);
        if (idx >= 0) insertIndex = idx + 1;
      }

      const next = [...withoutLoop];
      next.splice(insertIndex, 0, nb);
      return loop ? [...next, loop] : next;
    });
    setSelectedBlockId(nb.id);
    setSelectedTransitionBlockId(null);
    toast.success(`Added ${nb.label} — click Save to persist`);
  };

  if (loading) return <Layout><LoadingSpinner /></Layout>;

  return (
    <Layout>
      <div className="space-y-4 h-[calc(100dvh-7rem)] flex flex-col min-h-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shrink-0">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
              <Blocks className="w-6 h-6" /> Channel Blueprint
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              Design how your TV channel behaves — no FFmpeg or playlist expertise required
            </p>
          </div>
          {activeId && (
            <div className="flex flex-wrap gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="px-3 py-2 bg-black border border-[#333] rounded-lg text-sm text-white"
              />
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="inline-flex items-center gap-2 px-4 py-2 bg-white text-black rounded-lg text-sm font-medium disabled:opacity-50"
              >
                <Save className="w-4 h-4" /> Save
              </button>
            </div>
          )}
        </div>

        <div className="flex gap-4 flex-1 min-h-0">
          <div className="w-52 shrink-0 border border-[#333] rounded-xl bg-[#111] flex flex-col overflow-hidden">
            <div className="p-3 border-b border-[#333] max-h-[45%] overflow-y-auto">
              <p className="text-xs text-gray-500 mb-2 font-medium">Templates</p>
              <div className="space-y-1">
                {templates.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => createFromTemplate(t.key)}
                    className="w-full text-left px-2 py-1.5 text-xs text-gray-300 hover:bg-[#222] rounded-md transition"
                    title={t.description}
                  >
                    + {t.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {blueprints.map((bp) => (
                <div
                  key={bp.id}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1.5 cursor-pointer transition ${
                    activeId === bp.id ? 'bg-[#222] text-white' : 'text-gray-400 hover:bg-[#1a1a1a]'
                  }`}
                >
                  <button type="button" className="flex-1 text-left text-sm truncate" onClick={() => selectBlueprint(bp.id)}>
                    <span className="block truncate">{bp.name}</span>
                    {bp.channel && (
                      <span className="block text-[10px] text-violet-400/80 truncate">→ {bp.channel.name}</span>
                    )}
                  </button>
                  <button type="button" onClick={() => handleDelete(bp)} className="text-gray-600 hover:text-red-400 p-1">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {blueprints.length === 0 && (
                <p className="text-xs text-gray-600 p-2">No blueprints yet — pick a template above</p>
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0 flex flex-col gap-3 min-h-0">
            {!activeId ? (
              <div className="flex-1 flex items-center justify-center border border-[#333] rounded-xl bg-[#111] text-gray-500">
                Select a blueprint or create one from a template
              </div>
            ) : (
              <BlueprintWorkspaceLayout
                blueprintId={activeId}
                editorTab={editorTab}
                ws={ws}
                onPatch={patchWorkspace}
                headerExtra={
                  <>
                    <button
                      type="button"
                      onClick={() => setEditorTab('design')}
                      className={`inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition ${
                        editorTab === 'design' ? 'bg-white text-black' : 'text-gray-500 hover:text-white bg-[#111] border border-[#333]'
                      }`}
                    >
                      <LayoutGrid className="w-4 h-4" /> Design
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditorTab('watch')}
                      className={`inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition ${
                        editorTab === 'watch' ? 'bg-violet-600 text-white' : 'text-gray-500 hover:text-white bg-[#111] border border-[#333]'
                      }`}
                    >
                      <Eye className="w-4 h-4" /> Watch Blueprint
                    </button>
                  </>
                }
                canvasArea={
                  editorTab === 'design' ? (
                    <BlueprintCanvas
                      blocks={blocks}
                      playlists={playlists}
                      summary={summary}
                      selectedBlockId={selectedBlockId}
                      selectedTransitionBlockId={selectedTransitionBlockId}
                      onSelectBlock={setSelectedBlockId}
                      onSelectTransition={setSelectedTransitionBlockId}
                      onChange={setBlocks}
                      onAddBlock={handleAddBlock}
                    />
                  ) : (
                    <BlueprintPreviewTimeline
                      simulation={timelineSim}
                      horizon={timelineHorizon}
                      onHorizonChange={handleTimelineHorizonChange}
                      onLoad={() => handleTimeline(false)}
                      loading={timelineLoading || timelineAutoLoading}
                      linkedChannelName={
                        linkedChannelId
                          ? channels.find((c) => c.id === linkedChannelId)?.name ??
                            blueprints.find((b) => b.id === activeId)?.channel?.name
                          : undefined
                      }
                      liveSegmentIndex={liveSegmentIndex}
                      liveCursor={liveCursor}
                      isPolling={!!(linkedChannelId || publishChannelId) && editorTab === 'watch'}
                    />
                  )
                }
                summaryPanel={<BlueprintSummaryPanel summary={summary} loading={summaryLoading} />}
                simulatorPanel={
                  <BlueprintSimulatorPanel
                    simulation={simulation}
                    horizon={horizon}
                    onHorizonChange={setHorizon}
                    onSimulate={handleSimulate}
                    loading={simulating}
                  />
                }
                publishPanel={
                  <PublishPanelContent
                    channels={channels}
                    publishChannelId={publishChannelId}
                    onChannelChange={setPublishChannelId}
                    onPublish={handlePublish}
                    publishResult={publishResult}
                    onDismissResult={() => setPublishResult(null)}
                  />
                }
              />
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
