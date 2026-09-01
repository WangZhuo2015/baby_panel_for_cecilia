import React from 'react';

interface CuteCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  variant?: 'default' | 'gradient';
}

export const CuteCard: React.FC<CuteCardProps> = ({
  children,
  className = '',
  onClick,
  variant = 'default',
}) => {
  const baseStyles = 'rounded-[24px] p-4 shadow-soft transition-all duration-200';

  const variantStyles =
    variant === 'gradient'
      ? 'bg-gradient-to-br from-primary-light to-primary-soft/40 border border-primary/20'
      : 'bg-card';

  const pressable = onClick ? 'card-hover-lift card-press cursor-pointer' : '';

  return (
    <div
      className={`${baseStyles} ${variantStyles} ${pressable} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {children}
    </div>
  );
};
