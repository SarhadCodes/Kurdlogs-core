import { type ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  leading?: ReactNode;
}

export default function PageHeader({ title, description, actions, leading }: PageHeaderProps) {
  return (
    <div className="relative z-0 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {leading}
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl break-words">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground break-words">{description}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
          {actions}
        </div>
      )}
    </div>
  );
}
