import React from 'react';

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  color?: string;
  onClick?: () => void;
  active?: boolean;
}

const StatCardImpl: React.FC<StatCardProps> = ({
  icon,
  label,
  value,
  unit,
  color = 'text-primary',
  onClick,
  active = false,
}) => {
  const className = `bg-card rounded-[20px] shadow-card hover:shadow-elevated p-3 flex flex-col items-center gap-1.5 min-w-0 transition-all duration-200 hover:-translate-y-1 active:scale-95 ${
    onClick
      ? `cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${active ? 'ring-2 ring-primary/60' : ''}`
      : 'cursor-default'
  }`;

  const content = (
    <>
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
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={className}
        onClick={onClick}
        aria-label={`${label} ${value}${unit ?? ''}，查看${label}趋势`}
        aria-pressed={active}
      >
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
};

export const StatCard = React.memo(StatCardImpl);
