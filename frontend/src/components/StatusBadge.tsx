import { ChannelStatus } from '../types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: ChannelStatus;
}

const statusConfig: Record<
  ChannelStatus,
  { label: string; variant: 'success' | 'muted' | 'destructive' | 'warning'; dot: string }
> = {
  ONLINE: { label: 'Online', variant: 'success', dot: 'bg-zinc-300' },
  OFFLINE: { label: 'Offline', variant: 'muted', dot: 'bg-zinc-500' },
  ERROR: { label: 'Error', variant: 'destructive', dot: 'bg-red-700' },
  STARTING: { label: 'Starting', variant: 'warning', dot: 'bg-zinc-400' },
  STOPPING: { label: 'Stopping', variant: 'warning', dot: 'bg-zinc-400' },
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.OFFLINE;

  return (
    <Badge variant={config.variant} className="gap-1.5 font-medium">
      <span className={cn('h-1.5 w-1.5 rounded-full', config.dot)} />
      {config.label}
    </Badge>
  );
}
