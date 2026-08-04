import React from 'react';

interface AiRobotProps {
  size?: number;
  className?: string;
}

/**
 * AiRobot — a friendly purple AI assistant robot with glowing mint-green eyes.
 */
export const AiRobot: React.FC<AiRobotProps> = ({ size = 80, className }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="AI robot assistant"
    >
      {/* Antenna line */}
      <line
        x1="60"
        y1="12"
        x2="60"
        y2="26"
        stroke="#B98AF5"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* Antenna ball */}
      <circle cx="60" cy="10" r="4" fill="#78DDB5" />
      {/* Antenna glow */}
      <circle cx="60" cy="10" r="6" fill="#78DDB5" opacity="0.25" />

      {/* Left ear / side module */}
      <rect x="14" y="46" width="8" height="18" rx="3" fill="#B98AF5" />
      <rect x="16" y="50" width="4" height="4" rx="1" fill="#78DDB5" opacity="0.7" />

      {/* Right ear / side module */}
      <rect x="98" y="46" width="8" height="18" rx="3" fill="#B98AF5" />
      <rect x="100" y="50" width="4" height="4" rx="1" fill="#78DDB5" opacity="0.7" />

      {/* Head */}
      <rect x="20" y="26" width="80" height="60" rx="18" fill="#B98AF5" />
      {/* Face plate (lighter) */}
      <rect x="28" y="34" width="64" height="44" rx="12" fill="#D4B4FA" />

      {/* Eye sockets */}
      <rect x="38" y="44" width="14" height="12" rx="6" fill="#2A1A3D" />
      <rect x="68" y="44" width="14" height="12" rx="6" fill="#2A1A3D" />

      {/* Glowing eyes (mint green) */}
      <circle cx="45" cy="50" r="3.5" fill="#78DDB5" />
      <circle cx="75" cy="50" r="3.5" fill="#78DDB5" />
      {/* Eye glow halos */}
      <circle cx="45" cy="50" r="5" fill="#78DDB5" opacity="0.35" />
      <circle cx="75" cy="50" r="5" fill="#78DDB5" opacity="0.35" />
      {/* Eye highlights */}
      <circle cx="46" cy="49" r="1.2" fill="#FFFFFF" />
      <circle cx="76" cy="49" r="1.2" fill="#FFFFFF" />

      {/* Cheek blush — left */}
      <ellipse cx="36" cy="64" rx="5" ry="3" fill="#FFB5D0" opacity="0.5" />
      {/* Cheek blush — right */}
      <ellipse cx="84" cy="64" rx="5" ry="3" fill="#FFB5D0" opacity="0.5" />

      {/* Friendly smile */}
      <path
        d="M52 68 Q60 76 68 68"
        stroke="#2A1A3D"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />

      {/* Neck */}
      <rect x="52" y="86" width="16" height="6" rx="2" fill="#A074E0" />

      {/* Body */}
      <rect x="30" y="92" width="60" height="24" rx="10" fill="#B98AF5" />
      {/* Chest light */}
      <circle cx="60" cy="104" r="4" fill="#78DDB5" />
      <circle cx="60" cy="104" r="6" fill="#78DDB5" opacity="0.3" />

      {/* Arms */}
      <rect x="22" y="96" width="8" height="14" rx="4" fill="#A074E0" />
      <rect x="90" y="96" width="8" height="14" rx="4" fill="#A074E0" />
    </svg>
  );
};
