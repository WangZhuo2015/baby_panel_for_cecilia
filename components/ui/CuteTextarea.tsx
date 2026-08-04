import React from 'react';

interface CuteTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export const CuteTextarea: React.FC<CuteTextareaProps> = ({
  label,
  className = '',
  ...props
}) => {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-sm font-medium text-text-secondary pl-1">
          {label}
        </label>
      )}
      <textarea
        className={`rounded-[18px] border border-primary-soft bg-card px-4 py-3 text-sm text-text-primary placeholder:text-text-muted resize-none
          focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary
          transition-all min-h-[100px] ${className}`}
        {...props}
      />
    </div>
  );
};
