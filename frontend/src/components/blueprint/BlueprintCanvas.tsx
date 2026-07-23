import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, GripVertical, Plus, Settings2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { BlueprintBlock, BlueprintBlockType, BlueprintSummary, Playlist } from '../../types';
import { BLOCK_PALETTE, blockMeta } from './blockMeta';
import { defaultTransitionAfter, transitionLabel } from './transitionUtils';

interface BlueprintCanvasProps {
  blocks: BlueprintBlock[];
  playlists: Playlist[];
  summary?: BlueprintSummary | null;
  selectedBlockId: string | null;
  selectedTransitionBlockId: string | null;
  onSelectBlock: (id: string | null) => void;
  onSelectTransition: (id: string | null) => void;
  onChange: (blocks: BlueprintBlock[]) => void;
  onAddBlock: (type: BlueprintBlockType, insertAfterBlockId?: string | null) => void;
}

function formatDuration(sec: number) {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function playlistInsight(
  playlistId: string | undefined,
  playlists: Playlist[],
  summary?: BlueprintSummary | null
) {
  if (!playlistId) return null;
  const fromSummary = summary?.playlistInsights.find((p) => p.id === playlistId);
  if (fromSummary) return fromSummary;

  const pl = playlists.find((p) => p.id === playlistId);
  if (!pl) return null;
  const items = pl.items?.filter((i) => i.status === 'READY') ?? [];
  const durationSec = items.reduce((s, i) => s + (i.duration ?? 120), 0);
  return {
    id: pl.id,
    name: pl.name,
    itemCount: items.length || pl._count?.items || 0,
    durationSec,
    formattedDuration: formatDuration(durationSec),
  };
}

function BlockCard({
  block,
  isSelected,
  isDragging,
  onSelect,
  onRemove,
  dragHandleProps,
}: {
  block: BlueprintBlock;
  isSelected: boolean;
  isDragging?: boolean;
  onSelect: () => void;
  onRemove: () => void;
  dragHandleProps?: Record<string, unknown>;
}) {
  const meta = blockMeta(block.type);
  const superHint =
    block.type === 'SUPER'
      ? (block.config.superPlayMode || 'COUNT') === 'ALL'
        ? 'Plays entire playlist'
        : `Plays ${block.config.repeatCount ?? 5} videos`
      : null;

  return (
    <div
      className={`w-full max-w-lg rounded-xl border-2 p-4 cursor-pointer transition-all duration-200 ${meta.color} ${
        isSelected
          ? 'ring-2 ring-white shadow-[0_0_24px_rgba(255,255,255,0.12)] scale-[1.01]'
          : 'hover:brightness-110 hover:shadow-lg hover:-translate-y-0.5'
      } ${isDragging ? 'shadow-2xl rotate-1 opacity-90' : ''}`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="p-1.5 text-gray-500 hover:text-white cursor-grab active:cursor-grabbing rounded hover:bg-white/5"
          {...dragHandleProps}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white">{block.label || meta.label}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {superHint || meta.description}
          </p>
        </div>
        {block.type !== 'LOOP' && (
          <Settings2 className={`w-4 h-4 shrink-0 ${isSelected ? 'text-white' : 'text-gray-600'}`} />
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="p-1.5 text-gray-600 hover:text-red-400 rounded hover:bg-red-500/10"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function SortableBlock({
  block,
  isSelected,
  onSelect,
  onRemove,
}: {
  block: BlueprintBlock;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="w-full flex flex-col items-center">
      <BlockCard
        block={block}
        isSelected={isSelected}
        onSelect={onSelect}
        onRemove={onRemove}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

function InsertBlockSlot({
  insertAfterBlockId,
  onAddBlock,
}: {
  insertAfterBlockId: string | null;
  onAddBlock: (type: BlueprintBlockType, insertAfterBlockId?: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const addable = BLOCK_PALETTE.filter((item) => item.type !== 'LOOP');

  return (
    <div className="relative flex flex-col items-center py-1 w-full max-w-lg">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-medium transition-all ${
          open
            ? 'border-violet-400/60 bg-violet-950/50 text-violet-300'
            : 'border-dashed border-[#444] text-gray-500 hover:border-violet-500/50 hover:text-violet-300 hover:bg-violet-950/20'
        }`}
      >
        <Plus className="w-3.5 h-3.5" />
        Add block here
      </button>
      {open && (
        <div className="absolute top-full mt-2 z-20 w-full max-w-md rounded-xl border border-[#333] bg-[#111] p-2 shadow-xl grid grid-cols-2 gap-1.5">
          {addable.map((item) => (
            <button
              key={item.type}
              type="button"
              onClick={() => {
                onAddBlock(item.type, insertAfterBlockId);
                setOpen(false);
              }}
              className={`text-left px-2.5 py-2 rounded-lg border text-xs text-white hover:brightness-110 transition ${item.color}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TransitionConnector({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex flex-col items-center py-3 my-1 w-full max-w-lg transition-all ${
        isActive ? 'scale-105' : ''
      }`}
    >
      <div className="relative flex flex-col items-center">
        <div
          className={`w-px h-6 bg-gradient-to-b from-transparent transition-all ${
            isActive ? 'via-violet-400 to-violet-400' : 'via-gray-700 to-gray-600 group-hover:via-violet-500/60'
          }`}
        />
        <div
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-medium uppercase tracking-wide transition-all ${
            isActive
              ? 'border-violet-400/60 bg-violet-950/50 text-violet-300 shadow-[0_0_12px_rgba(139,92,246,0.3)]'
              : 'border-[#333] bg-[#111] text-gray-500 group-hover:border-violet-500/40 group-hover:text-violet-300'
          }`}
        >
          <ArrowDown className="w-3 h-3" />
          {label}
        </div>
        <div
          className={`w-px h-6 bg-gradient-to-b transition-all ${
            isActive ? 'from-violet-400 via-violet-400/50 to-transparent' : 'from-gray-600 via-gray-700 to-transparent group-hover:from-violet-500/40'
          }`}
        />
      </div>
    </button>
  );
}

export default function BlueprintCanvas({
  blocks,
  playlists,
  summary,
  selectedBlockId,
  selectedTransitionBlockId,
  onSelectBlock,
  onSelectTransition,
  onChange,
  onAddBlock,
}: BlueprintCanvasProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const selected = blocks.find((b) => b.id === selectedBlockId);
  const editingTransition = blocks.find((b) => b.id === selectedTransitionBlockId);
  const activeBlock = blocks.find((b) => b.id === activeId);

  const handleDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = blocks.findIndex((b) => b.id === active.id);
    const newIndex = blocks.findIndex((b) => b.id === over.id);
    const next = [...blocks];
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved);
    onChange(next);
  };

  const updateBlock = (blockId: string, patch: Partial<BlueprintBlock['config']> & { label?: string }) => {
    onChange(
      blocks.map((b) =>
        b.id === blockId
          ? {
              ...b,
              ...(patch.label !== undefined ? { label: patch.label } : {}),
              config: { ...b.config, ...patch },
            }
          : b
      )
    );
  };

  const updateSelected = (patch: Partial<BlueprintBlock['config']> & { label?: string }) => {
    if (!selectedBlockId) return;
    updateBlock(selectedBlockId, patch);
  };

  const updateTransition = (patch: Partial<NonNullable<BlueprintBlock['config']['transitionIn']>>) => {
    if (!selectedTransitionBlockId) return;
    const block = blocks.find((b) => b.id === selectedTransitionBlockId);
    if (!block) return;
    const current = block.config.transitionIn || { mode: 'ALWAYS' as const };
    updateBlock(selectedTransitionBlockId, {
      transitionIn: { ...current, ...patch },
    });
  };

  const settingsBlock = editingTransition || selected;
  const insight = settingsBlock ? playlistInsight(settingsBlock.config.playlistId, playlists, summary) : null;

  return (
    <div className="flex gap-4 h-full min-h-0">
      <div className="w-44 shrink-0 space-y-1.5">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1 px-1">Blocks</p>
        <p className="text-[10px] text-gray-600 px-1 mb-2 leading-snug">
          Click to add{selectedBlockId ? ' after selection' : ' before Loop'}.
        </p>
        {BLOCK_PALETTE.map((item) => (
          <button
            key={item.type}
            type="button"
            onClick={() => onAddBlock(item.type, selectedBlockId)}
            className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm text-white hover:brightness-110 hover:-translate-y-px transition-all duration-150 ${item.color}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-w-0 overflow-y-auto bg-[#080808] border border-[#333] rounded-xl p-8 blueprint-canvas-grid">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col items-center pb-6 gap-1">
              {blocks.length === 0 && (
                <p className="text-gray-600 text-sm py-16">Click a block type to start designing your channel</p>
              )}
              {blocks.map((block, i) => {
                const prev = i > 0 ? blocks[i - 1] : undefined;
                const prevType = prev?.type !== 'LOOP' ? prev?.type : defaultTransitionAfter(blocks, i);
                const connLabel = transitionLabel(block, prevType);
                const insertAfterId = prev?.id ?? null;

                return (
                  <div key={block.id} className="w-full flex flex-col items-center">
                    {i > 0 && (
                      <>
                        <InsertBlockSlot insertAfterBlockId={insertAfterId} onAddBlock={onAddBlock} />
                        <TransitionConnector
                          label={connLabel}
                          isActive={selectedTransitionBlockId === block.id}
                          onClick={() => {
                            onSelectTransition(block.id);
                            onSelectBlock(null);
                          }}
                        />
                      </>
                    )}
                    <SortableBlock
                      block={block}
                      isSelected={selectedBlockId === block.id && !selectedTransitionBlockId}
                      onSelect={() => {
                        onSelectBlock(block.id);
                        onSelectTransition(null);
                      }}
                      onRemove={() => {
                        onChange(blocks.filter((b) => b.id !== block.id));
                        if (selectedBlockId === block.id) onSelectBlock(null);
                        if (selectedTransitionBlockId === block.id) onSelectTransition(null);
                      }}
                    />
                  </div>
                );
              })}
              {blocks.length > 0 && blocks[blocks.length - 1]?.type !== 'LOOP' && (
                <InsertBlockSlot
                  insertAfterBlockId={blocks[blocks.length - 1]?.id ?? null}
                  onAddBlock={onAddBlock}
                />
              )}
            </div>
          </SortableContext>

          <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1)' }}>
            {activeBlock ? (
              <BlockCard block={activeBlock} isSelected isDragging onSelect={() => {}} onRemove={() => {}} />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      <div className="w-64 shrink-0 border border-[#333] rounded-xl p-4 bg-[#111] overflow-y-auto">
        {editingTransition ? (
          <>
            <p className="text-xs font-medium text-violet-400 uppercase tracking-wide mb-1">Transition</p>
            <p className="text-sm text-white font-medium mb-4">
              Before {editingTransition.label || blockMeta(editingTransition.type).label}
            </p>
            <div className="space-y-3">
              <label className="block text-xs text-gray-400">
                When to play
                <select
                  className="mt-1 w-full bg-black border border-[#333] rounded-lg px-2 py-2 text-sm text-white"
                  value={editingTransition.config.transitionIn?.mode || 'ALWAYS'}
                  onChange={(e) => {
                    const mode = e.target.value as 'ALWAYS' | 'EVERY_N_ITEMS' | 'EVERY_N_MINUTES';
                    const idx = blocks.findIndex((b) => b.id === editingTransition.id);
                    updateTransition({
                      mode,
                      value: mode === 'ALWAYS' ? undefined : editingTransition.config.transitionIn?.value || 2,
                      afterBlockType:
                        mode === 'EVERY_N_ITEMS'
                          ? defaultTransitionAfter(blocks, idx)
                          : editingTransition.config.transitionIn?.afterBlockType,
                    });
                  }}
                >
                  <option value="ALWAYS">Always</option>
                  <option value="EVERY_N_ITEMS">Every N items</option>
                  <option value="EVERY_N_MINUTES">Every X minutes</option>
                </select>
              </label>

              {editingTransition.config.transitionIn?.mode === 'EVERY_N_ITEMS' && (
                <label className="block text-xs text-gray-400">
                  Item count
                  <input
                    type="number"
                    min={1}
                    className="mt-1 w-full bg-black border border-[#333] rounded-lg px-2 py-2 text-sm text-white"
                    value={editingTransition.config.transitionIn?.value ?? 2}
                    onChange={(e) => updateTransition({ value: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                  />
                </label>
              )}

              {editingTransition.config.transitionIn?.mode === 'EVERY_N_MINUTES' && (
                <label className="block text-xs text-gray-400">
                  Minutes
                  <input
                    type="number"
                    min={1}
                    className="mt-1 w-full bg-black border border-[#333] rounded-lg px-2 py-2 text-sm text-white"
                    value={editingTransition.config.transitionIn?.value ?? 30}
                    onChange={(e) => updateTransition({ value: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                  />
                </label>
              )}

              <p className="text-[11px] text-gray-600 leading-relaxed">
                Controls how often this block appears in the loop. Example: promo every 2 movies.
              </p>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Block settings</p>
            {!selected || selected.type === 'LOOP' ? (
              <p className="text-sm text-gray-600 leading-relaxed">
                {selected?.type === 'LOOP'
                  ? 'Loop returns to the first block — no settings needed.'
                  : 'Select a block to configure its playlist, or click an arrow for transition rules.'}
              </p>
            ) : (
              <div className="space-y-3">
                <label className="block text-xs text-gray-400">
                  Label
                  <input
                    className="mt-1 w-full bg-black border border-[#333] rounded-lg px-2 py-2 text-sm text-white"
                    value={selected.label || ''}
                    onChange={(e) => updateSelected({ label: e.target.value })}
                  />
                </label>
                <label className="block text-xs text-gray-400">
                  Playlist
                  <select
                    className="mt-1 w-full bg-black border border-[#333] rounded-lg px-2 py-2 text-sm text-white"
                    value={selected.config.playlistId || ''}
                    onChange={(e) => updateSelected({ playlistId: e.target.value || undefined })}
                  >
                    <option value="">Choose playlist…</option>
                    {playlists.map((pl) => (
                      <option key={pl.id} value={pl.id}>
                        {pl.name}
                      </option>
                    ))}
                  </select>
                </label>

                {insight && (
                  <div className="rounded-lg border border-[#2a2a2a] bg-black/40 p-3 space-y-1">
                    <p className="text-[10px] text-gray-600 uppercase tracking-wide">Playlist insight</p>
                    <p className="text-sm font-semibold text-white">{insight.name}</p>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">{insight.itemCount} items</span>
                      <span className="text-violet-400 font-medium">{insight.formattedDuration} total</span>
                    </div>
                    {insight.itemCount === 0 && (
                      <p className="text-[11px] text-amber-400">Empty — add content to this playlist first.</p>
                    )}
                    {insight.itemCount === 1 && (
                      <p className="text-[11px] text-amber-400">Only 1 item — repeats will be frequent.</p>
                    )}
                    {insight.itemCount >= 10 && (
                      <p className="text-[11px] text-emerald-500/80">Good pool size for this block.</p>
                    )}
                  </div>
                )}

                <label className="block text-xs text-gray-400">
                  Selection
                  <select
                    className="mt-1 w-full bg-black border border-[#333] rounded-lg px-2 py-2 text-sm text-white"
                    value={selected.config.selectionMode || 'SEQUENTIAL'}
                    onChange={(e) =>
                      updateSelected({ selectionMode: e.target.value as 'RANDOM' | 'SEQUENTIAL' })
                    }
                  >
                    <option value="SEQUENTIAL">Sequential</option>
                    <option value="RANDOM">Random</option>
                  </select>
                </label>

                {selected.type === 'SUPER' && (
                  <>
                    <label className="block text-xs text-gray-400">
                      Play mode
                      <select
                        className="mt-1 w-full bg-black border border-[#333] rounded-lg px-2 py-2 text-sm text-white"
                        value={selected.config.superPlayMode || 'COUNT'}
                        onChange={(e) =>
                          updateSelected({
                            superPlayMode: e.target.value as 'COUNT' | 'ALL',
                          })
                        }
                      >
                        <option value="COUNT">N videos from playlist</option>
                        <option value="ALL">Entire playlist</option>
                      </select>
                    </label>
                    {(selected.config.superPlayMode || 'COUNT') === 'COUNT' && (
                      <label className="block text-xs text-gray-400">
                        Videos per visit
                        <input
                          type="number"
                          min={1}
                          max={99}
                          className="mt-1 w-full bg-black border border-[#333] rounded-lg px-2 py-2 text-sm text-white"
                          value={selected.config.repeatCount ?? 5}
                          onChange={(e) =>
                            updateSelected({
                              repeatCount: Math.max(1, Math.min(99, parseInt(e.target.value, 10) || 1)),
                            })
                          }
                        />
                      </label>
                    )}
                    <p className="text-[11px] text-gray-600 leading-relaxed">
                      Super block plays multiple clips from the same playlist before moving to the next
                      block — ideal for music hours or back-to-back episodes.
                    </p>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
