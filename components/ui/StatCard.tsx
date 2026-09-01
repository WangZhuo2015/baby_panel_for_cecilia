import React from 'react';

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  color?: string;
}

const StatCardImpl: React.FC<StatCardProps> = ({
  icon,
  label,
  value,
  unit,
  color = 'text-primary',
}) => {
  return (
    <div className="bg-card rounded-[20px] shadow-card hover:shadow-elevated p-3 flex flex-col items-center gap-1.5 min-w-0 transition-all duration-200 hover:-translate-y-1 active:scale-95 cursor-default">
      <div className={`flex items-center justify-center w-9 h-9 rounded-full ${color} transition-transform group-hover:scale-110`}>
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

export const StatCard = React.memo(StatCardImpl);
