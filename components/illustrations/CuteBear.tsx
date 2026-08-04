import React from 'react';

interface CuteBearProps {
  size?: number;
  className?: string;
}

/**
 * CuteBear — a cuddly brown bear for food and activity sections.
 */
export const CuteBear: React.FC<CuteBearProps> = ({ size = 80, className }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Cute bear"
    >
      {/* Left ear (outer) */}
      <circle cx="32" cy="28" r="14" fill="#C9956B" />
      {/* Left ear (inner) */}
      <circle cx="32" cy="28" r="8" fill="#E6BF98" />

      {/* Right ear (outer) */}
      <circle cx="88" cy="28" r="14" fill="#C9956B" />
      {/* Right ear (inner) */}
      <circle cx="88" cy="28" r="8" fill="#E6BF98" />

      {/* Body */}
      <ellipse cx="60" cy="100" rx="26" ry="18" fill="#C9956B" />
      {/* Belly patch */}
      <ellipse cx="60" cy="100" rx="16" ry="11" fill="#E6BF98" />

      {/* Tiny paws */}
      <ellipse cx="42" cy="114" rx="9" ry="5" fill="#C9956B" />
      <ellipse cx="78" cy="114" rx="9" ry="5" fill="#C9956B" />
      {/* Paw pads */}
      <ellipse cx="42" cy="115" rx="4" ry="2.5" fill="#E6BF98" />
      <ellipse cx="78" cy="115" rx="4" ry="2.5" fill="#E6BF98" />

      {/* Head */}
      <circle cx="60" cy="58" r="34" fill="#C9956B" />

      {/* Muzzle */}
      <ellipse cx="60" cy="70" rx="15" ry="11" fill="#E6BF98" />

      {/* Cheek blush — left */}
      <ellipse cx="36" cy="68" rx="6" ry="4" fill="#E8A07A" opacity="0.5" />
      {/* Cheek blush — right */}
      <ellipse cx="84" cy="68" rx="6" ry="4" fill="#E8A07A" opacity="0.5" />

      {/* Eyes */}
      <circle cx="46" cy="54" r="2.8" fill="#3D2419" />
      <circle cx="74" cy="54" r="2.8" fill="#3D2419" />

      {/* Eye highlights */}
      <circle cx="47" cy="53" r="1" fill="#FFFFFF" />
      <circle cx="75" cy="53" r="1" fill="#FFFFFF" />

      {/* Nose */}
      <ellipse cx="60" cy="65" rx="3.5" ry="2.6" fill="#6B4533" />
      {/* Nose highlight */}
      <ellipse cx="59" cy="64" rx="1.2" ry="0.8" fill="#FFFFFF" opacity="0.5" />

      {/* Mouth */}
      <path
        d="M56 72 Q60 76 64 72"
        stroke="#6B4533"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
      {/* Mouth line down from nose */}
      <line
        x1="60"
        y1="67.5"
        x2="60"
        y2="72"
        stroke="#6B4533"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
};
