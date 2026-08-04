import React from 'react';

interface FormSectionProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export const FormSection: React.FC<FormSectionProps> = ({
  title,
  children,
  className = '',
}) => {
  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {title && (
        <h3 className="text-sm font-semibold text-text-secondary px-1">{title}</h3>
      )}
      <div className="bg-card rounded-[20px] shadow-card p-4 flex flex-col gap-3">
        {children}
      </div>
    </div>
  );
};
