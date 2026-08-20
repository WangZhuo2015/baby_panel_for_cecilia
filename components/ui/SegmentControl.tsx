import React from 'react';

interface SegmentOption {
  value: string;
  label: string;
}

interface SegmentControlProps {
  options: SegmentOption[];
  value: string;
  onChange: (v: string) => void;
  scrollable?: boolean;
}

export const SegmentControl: React.FC<SegmentControlProps> = ({
  options,
  value,
  onChange,
  scrollable,
}) => {
  const isMany = scrollable || options.length >= 5;

  return (
    <div
      className={`p-1 bg-primary-light rounded-full ${
        isMany
          ? 'flex overflow-x-auto scrollbar-hide gap-1 max-w-full'
          : 'flex gap-1 w-full'
      }`}
    >
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`btn-press whitespace-nowrap select-none rounded-full font-medium transition-all min-h-[34px] cursor-pointer text-xs sm:text-sm ${
              isMany ? 'flex-shrink-0 px-3.5 py-1.5' : 'flex-1 px-2 py-1.5'
            } ${
              isActive
                ? 'bg-primary text-white shadow-button font-bold'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};
