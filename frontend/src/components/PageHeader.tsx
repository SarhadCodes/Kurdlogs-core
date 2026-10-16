import { type ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  leading?: ReactNode;
}

export default function PageHeader({ title, description, actions, leading }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        {leading}
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-white break-words">{title}</h1>
          {description && (
            <p className="text-gray-500 text-sm mt-1 break-words">{description}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}
