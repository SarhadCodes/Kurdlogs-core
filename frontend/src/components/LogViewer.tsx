import { useRef, useEffect } from 'react';

interface LogEntry {
  id: string;
  timestamp: string;
  level: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
  message: string;
}

interface LogViewerProps {
  logs: LogEntry[];
}

const levelColors: Record<string, string> = {
  ERROR: 'text-red-400',
  WARN: 'text-yellow-400',
  INFO: 'text-white',
  DEBUG: 'text-[#666]',
};

const levelBadgeColors: Record<string, string> = {
  ERROR: 'text-red-400 bg-red-400/10',
  WARN: 'text-yellow-400 bg-yellow-400/10',
  INFO: 'text-white bg-white/5',
  DEBUG: 'text-[#666] bg-[#222]',
};

export default function LogViewer({ logs }: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div
      ref={containerRef}
      className="bg-[#111] border border-[#333] rounded-lg p-4 max-h-96 overflow-y-auto font-mono text-xs"
    >
      {logs.length === 0 ? (
        <p className="text-[#555] text-center py-8">No logs available</p>
      ) : (
        <div className="space-y-1">
          {logs.map((log) => (
            <div key={log.id} className="flex items-start gap-2 leading-5">
              <span className="text-[#555] flex-shrink-0 select-none">
                {log.timestamp}
              </span>
              <span
                className={`flex-shrink-0 px-1.5 py-0 rounded text-[10px] font-semibold uppercase ${
                  levelBadgeColors[log.level] ?? levelBadgeColors.INFO
                }`}
              >
                {log.level}
              </span>
              <span className={levelColors[log.level] ?? 'text-white'}>
                {log.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
