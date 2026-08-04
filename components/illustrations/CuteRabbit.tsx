import React from 'react';

interface CuteRabbitProps {
  size?: number;
  className?: string;
}

/**
 * CuteRabbit — white bunny mascot with long pink ears, rosy cheeks, and a gentle smile.
 * Main mascot for the baby growth app.
 */
export const CuteRabbit: React.FC<CuteRabbitProps> = ({ size = 80, className }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Cute rabbit mascot"
    >
      {/* Left ear (outer — white) */}
      <ellipse cx="42" cy="22" rx="10" ry="22" fill="#FFFFFF" stroke="#E8D6E0" strokeWidth="1" />
      {/* Left ear (inner — pink) */}
      <ellipse cx="42" cy="24" rx="5.5" ry="14" fill="#FFB5D0" />

      {/* Right ear (outer — white) */}
      <ellipse cx="78" cy="22" rx="10" ry="22" fill="#FFFFFF" stroke="#E8D6E0" strokeWidth="1" />
      {/* Right ear (inner — pink) */}
      <ellipse cx="78" cy="24" rx="5.5" ry="14" fill="#FFB5D0" />

      {/* Body (small, below head) */}
      <ellipse cx="60" cy="102" rx="22" ry="16" fill="#FFFFFF" stroke="#E8D6E0" strokeWidth="1" />

      {/* Tiny feet */}
      <ellipse cx="48" cy="114" rx="8" ry="5" fill="#FFFFFF" stroke="#E8D6E0" strokeWidth="1" />
      <ellipse cx="72" cy="114" rx="8" ry="5" fill="#FFFFFF" stroke="#E8D6E0" strokeWidth="1" />

      {/* Head (big, round) */}
      <circle cx="60" cy="64" r="32" fill="#FFFFFF" stroke="#E8D6E0" strokeWidth="1" />

      {/* Cheek blush — left */}
      <ellipse cx="38" cy="72" rx="7" ry="4.5" fill="#FFD6E8" opacity="0.7" />
      {/* Cheek blush — right */}
      <ellipse cx="82" cy="72" rx="7" ry="4.5" fill="#FFD6E8" opacity="0.7" />

      {/* Eyes */}
      <circle cx="49" cy="62" r="2.8" fill="#4A3347" />
      <circle cx="71" cy="62" r="2.8" fill="#4A3347" />

      {/* Eye highlights */}
      <circle cx="50" cy="61" r="1" fill="#FFFFFF" />
      <circle cx="72" cy="61" r="1" fill="#FFFFFF" />

      {/* Nose — tiny pink triangle */}
      <ellipse cx="60" cy="70" rx="2.5" ry="1.8" fill="#FFB5D0" />

      {/* Smile */}
      <path
        d="M55 74 Q60 79 65 74"
        stroke="#4A3347"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
};
