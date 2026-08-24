import React from 'react';
import { Heart } from 'lucide-react';

interface HeartRatingProps {
  value: number;
  onChange?: (v: number) => void;
  readOnly?: boolean;
  size?: number;
}

export const HeartRating: React.FC<HeartRatingProps> = ({
  value,
  onChange,
  readOnly = false,
  size = 20,
}) => {
  const isInteractive = !!onChange && !readOnly;

  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= value;
        return (
          <button
            key={star}
            type="button"
            disabled={!isInteractive}
            onClick={() => onChange?.(star)}
            className={`${isInteractive ? 'btn-press cursor-pointer' : 'cursor-default'} tap-hotzone p-0.5`}
            aria-label={`${star} heart${filled ? '' : 's'}`}
          >
            <Heart
              size={size}
              className={`transition-colors ${
                filled
                  ? 'fill-primary text-primary'
                  : 'fill-transparent text-text-muted/40'
              }`}
            />
          </button>
        );
      })}
    </div>
  );
};
