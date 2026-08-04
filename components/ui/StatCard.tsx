import React from 'react';

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  color?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  icon,
  label,
  value,
  unit,
  color = 'text-primary',
}) => {
  return (
    <div className="bg-card rounded-[20px] shadow-card p-3 flex flex-col items-center gap-1.5 min-w-0">
      <div className={`flex items-center justify-center w-9 h-9 rounded-full ${color}`}>
        {icon}
      </div>
      <div className="flex items-baseline gap-0.5">
        <span className="text-xl font-bold text-text-primary">{value}</span>
        {unit && <span className="text-xs text-text-muted">{unit}</span>}
      </div>
      <span className="text-xs text-text-secondary truncate w-full text-center">
        {label}
      </span>
    </div>
  );
};
