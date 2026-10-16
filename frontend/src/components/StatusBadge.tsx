import { ChannelStatus } from '../types';

interface StatusBadgeProps {
  status: ChannelStatus;
}

const statusConfig: Record<ChannelStatus, { dot: string; text: string; label: string }> = {
  ONLINE: { dot: 'bg-green-500', text: 'text-white', label: 'Online' },
  OFFLINE: { dot: 'bg-[#555]', text: 'text-[#888]', label: 'Offline' },
  ERROR: { dot: 'bg-red-500', text: 'text-red-400', label: 'Error' },
  STARTING: { dot: 'bg-yellow-500', text: 'text-yellow-400', label: 'Starting' },
  STOPPING: { dot: 'bg-yellow-500', text: 'text-yellow-400', label: 'Stopping' },
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.OFFLINE;

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${config.text}`}>
      <span className={`w-2 h-2 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}
