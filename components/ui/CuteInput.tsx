import React, { useId } from 'react';

interface CuteInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const CuteInput: React.FC<CuteInputProps> = ({
  label,
  id,
  className = '',
  ...props
}) => {
  const generatedId = useId();
  const inputId = id || generatedId;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-text-secondary pl-1">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`rounded-[18px] border border-primary-soft bg-card px-4 py-3 text-sm text-text-primary placeholder:text-text-muted
          focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary
          transition-all ${className}`}
        {...props}
      />
    </div>
  );
};
