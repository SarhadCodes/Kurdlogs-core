import React from 'react';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="text-[#555] mb-4 flex items-center justify-center">
        {icon}
      </div>
      <h3 className="text-white text-base font-medium mb-1">{title}</h3>
      <p className="text-[#888] text-sm text-center max-w-sm mb-6">{description}</p>
      {action && <div>{action}</div>}
    </div>
  );
}
