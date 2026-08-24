import React from 'react';

interface QuickActionCardProps {
  icon: React.ReactNode;
  label: string;
  color: string;
  onClick?: () => void;
}

const QuickActionCardImpl: React.FC<QuickActionCardProps> = ({
  icon,
  label,
  color,
  onClick,
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn-press flex flex-col items-center justify-center gap-2 w-full rounded-[20px] min-h-[88px] py-4 px-3 shadow-card bg-card cursor-pointer transition-all active:scale-[0.97]"
    >
      <div
        className="flex items-center justify-center w-12 h-12 rounded-full text-white"
        style={{ backgroundColor: color }}
      >
        {icon}
      </div>
      <span className="text-sm font-medium text-text-primary">{label}</span>
    </button>
  );
};

export const QuickActionCard = React.memo(QuickActionCardImpl);
