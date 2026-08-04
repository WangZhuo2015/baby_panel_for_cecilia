import React from 'react';

interface CuteDuckProps {
  size?: number;
  className?: string;
}

/**
 * CuteDuck — a cheerful yellow duck helper for tips and hints.
 */
export const CuteDuck: React.FC<CuteDuckProps> = ({ size = 80, className }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Cute duck helper"
    >
      {/* Tuft of hair / top feathers */}
      <path
        d="M60 10 Q63 4 68 8 Q70 2 75 9"
        stroke="#FFCB45"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />

      {/* Body */}
      <ellipse cx="60" cy="82" rx="34" ry="30" fill="#FFE066" />
      {/* Belly highlight */}
      <ellipse cx="60" cy="90" rx="20" ry="15" fill="#FFF3B0" opacity="0.7" />

      {/* Wing — left */}
      <path
        d="M28 75 Q20 85 30 100 Q38 98 38 85 Z"
        fill="#FFCB45"
      />

      {/* Wing — right */}
      <path
        d="M92 75 Q100 85 90 100 Q82 98 82 85 Z"
        fill="#FFCB45"
      />

      {/* Head (big and round) */}
      <circle cx="60" cy="50" r="30" fill="#FFE066" />

      {/* Cheek blush — left */}
      <ellipse cx="40" cy="58" rx="6" ry="4" fill="#FFB58A" opacity="0.55" />
      {/* Cheek blush — right */}
      <ellipse cx="80" cy="58" rx="6" ry="4" fill="#FFB58A" opacity="0.55" />

      {/* Eyes */}
      <circle cx="49" cy="48" r="2.8" fill="#4A3347" />
      <circle cx="71" cy="48" r="2.8" fill="#4A3347" />

      {/* Eye highlights */}
      <circle cx="50" cy="47" r="1" fill="#FFFFFF" />
      <circle cx="72" cy="47" r="1" fill="#FFFFFF" />

      {/* Beak */}
      <path
        d="M52 57 Q60 66 68 57 Q60 61 52 57 Z"
        fill="#FFB38A"
        stroke="#F09A6F"
        strokeWidth="0.8"
      />
      {/* Beak line */}
      <path
        d="M54 59 Q60 61 66 59"
        stroke="#F09A6F"
        strokeWidth="0.8"
        strokeLinecap="round"
        fill="none"
      />

      {/* Tiny feet */}
      <ellipse cx="50" cy="112" rx="8" ry="3.5" fill="#FFB38A" />
      <ellipse cx="70" cy="112" rx="8" ry="3.5" fill="#FFB38A" />
    </svg>
  );
};
