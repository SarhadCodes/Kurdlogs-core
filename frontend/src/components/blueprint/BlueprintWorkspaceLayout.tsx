import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Maximize2, Minimize2 } from 'lucide-react';

export interface BlueprintWorkspaceState {
  simulatorCollapsed: boolean;
  publishCollapsed: boolean;
  expandCanvas: boolean;
  bottomPanelHeight: number;
}

const DEFAULT_STATE: BlueprintWorkspaceState = {
  simulatorCollapsed: false,
  publishCollapsed: false,
  expandCanvas: false,
  bottomPanelHeight: 300,
};

const STORAGE_KEY = 'kurdlogs-blueprint-workspace';

function loadState(): BlueprintWorkspaceState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_STATE;
  }
}

function saveState(state: BlueprintWorkspaceState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

interface CollapsibleSectionProps {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
}

export function CollapsibleSection({ title, collapsed, onToggle, children, className = '' }: CollapsibleSectionProps) {
  return (
    <div className={`border border-[#333] rounded-xl bg-[#111] overflow-hidden flex flex-col min-h-0 ${className}`}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 py-2.5 border-b border-[#333] flex items-center gap-2 text-sm font-medium text-white hover:bg-[#1a1a1a] transition shrink-0"
      >
        {collapsed ? <ChevronRight className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
        {title}
      </button>
      {!collapsed && <div className="flex-1 min-h-0 overflow-hidden">{children}</div>}
    </div>
  );
}

interface Props {
  blueprintId: string | null;
  editorTab: 'design' | 'watch';
  canvasArea: ReactNode;
  summaryPanel?: ReactNode;
  simulatorPanel: ReactNode;
  publishPanel: ReactNode;
  headerExtra?: ReactNode;
}

export function useBlueprintWorkspace(blueprintId: string | null) {
  const [ws, setWs] = useState<BlueprintWorkspaceState>(loadState);

  useEffect(() => {
    setWs(loadState());
  }, [blueprintId]);

  const patch = useCallback((next: Partial<BlueprintWorkspaceState>) => {
    setWs((prev) => {
      const merged = { ...prev, ...next };
      saveState(merged);
      return merged;
    });
  }, []);

  return { ws, patch };
}

export default function BlueprintWorkspaceLayout({
  editorTab,
  canvasArea,
  summaryPanel,
  simulatorPanel,
  publishPanel,
  headerExtra,
  ws,
  onPatch,
}: Props & { ws: BlueprintWorkspaceState; onPatch: (p: Partial<BlueprintWorkspaceState>) => void }) {
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const { expandCanvas, simulatorCollapsed, publishCollapsed, bottomPanelHeight } = ws;

  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: bottomPanelHeight };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY;
      const next = Math.max(120, Math.min(560, dragRef.current.startH + delta));
      onPatch({ bottomPanelHeight: next });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const showBottom = !expandCanvas && editorTab === 'design';
  const showSummary = !expandCanvas && editorTab === 'design' && summaryPanel;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        {headerExtra}
        {editorTab === 'design' && (
          <button
            type="button"
            onClick={() => onPatch({ expandCanvas: !expandCanvas })}
            className={`ml-auto inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border transition ${
              expandCanvas
                ? 'border-violet-500/50 bg-violet-950/40 text-violet-300'
                : 'border-[#333] text-gray-400 hover:text-white hover:border-[#555]'
            }`}
          >
            {expandCanvas ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            {expandCanvas ? 'Exit expand' : 'Expand canvas'}
          </button>
        )}
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">{canvasArea}</div>
        {showSummary && <div className="w-56 shrink-0 hidden xl:block">{summaryPanel}</div>}
      </div>

      {showSummary && <div className="xl:hidden shrink-0">{summaryPanel}</div>}

      {showBottom && (
        <>
          <div
            role="separator"
            aria-orientation="horizontal"
            onMouseDown={onResizeStart}
            className="h-2 shrink-0 cursor-row-resize group flex items-center justify-center"
          >
            <div className="w-16 h-1 rounded-full bg-[#333] group-hover:bg-violet-500/60 transition" />
          </div>

          <div
            className="shrink-0 grid grid-cols-1 lg:grid-cols-2 gap-3 min-h-0 overflow-hidden"
            style={{ height: simulatorCollapsed && publishCollapsed ? 'auto' : bottomPanelHeight }}
          >
            <CollapsibleSection
              title="Simulator"
              collapsed={simulatorCollapsed}
              onToggle={() => onPatch({ simulatorCollapsed: !simulatorCollapsed })}
              className="h-full"
            >
              {simulatorPanel}
            </CollapsibleSection>

            <CollapsibleSection
              title="Publish"
              collapsed={publishCollapsed}
              onToggle={() => onPatch({ publishCollapsed: !publishCollapsed })}
              className="h-full"
            >
              {publishPanel}
            </CollapsibleSection>
          </div>
        </>
      )}
    </div>
  );
}
