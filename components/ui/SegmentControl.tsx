import React from 'react';

interface SegmentOption {
  value: string;
  label: string;
}

interface SegmentControlProps {
  options: SegmentOption[];
  value: string;
  onChange: (v: string) => void;
}

export const SegmentControl: React.FC<SegmentControlProps> = ({
  options,
  value,
  onChange,
}) => {
  return (
    <div className="flex gap-1 p-1 bg-primary-light rounded-full">
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`btn-press flex-1 py-2 px-3 rounded-full text-sm font-medium transition-all min-h-[36px] cursor-pointer ${
              isActive
                ? 'bg-primary text-white shadow-button'
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
