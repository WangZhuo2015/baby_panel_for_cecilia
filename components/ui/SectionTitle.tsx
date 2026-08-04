import React from 'react';

interface SectionTitleProps {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export const SectionTitle: React.FC<SectionTitleProps> = ({
  title,
  icon,
  action,
  className = '',
}) => {
  return (
    <div className={`flex items-center justify-between px-1 ${className}`}>
      <div className="flex items-center gap-2">
        {icon && (
          <span className="flex items-center justify-center w-6 h-6 text-primary">
            {icon}
          </span>
        )}
        <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
      </div>
      {action && <div className="flex items-center">{action}</div>}
    </div>
  );
};
