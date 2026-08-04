import React from 'react';
import { Sun, CloudRain } from 'lucide-react';

interface WeatherCardProps {
  temperature: number;
  condition: string;
  uv: number;
  rainProbability: number;
  advice: string;
  onClick?: () => void;
}

const conditionEmoji: Record<string, string> = {
  sunny: '☀️',
  cloudy: '⛅',
  rainy: '🌧️',
  snowy: '🌨️',
  windy: '💨',
  overcast: '☁️',
};

export const WeatherCard: React.FC<WeatherCardProps> = ({
  temperature,
  condition,
  uv,
  rainProbability,
  advice,
  onClick,
}) => {
  const emoji = conditionEmoji[condition.toLowerCase()] || '🌤️';

  return (
    <div
      onClick={onClick}
      className={`card-press bg-gradient-to-r from-sky/15 to-primary-light rounded-[20px] p-4 shadow-card ${
        onClick ? 'cursor-pointer' : ''
      }`}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{emoji}</span>
          <div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-text-primary">{temperature}°</span>
            </div>
            <span className="text-xs text-text-secondary capitalize">{condition}</span>
          </div>
        </div>
        <div className="flex gap-3 text-xs text-text-secondary">
          <div className="flex items-center gap-1">
            <Sun size={14} className="text-cream" />
            <span>UV {uv}</span>
          </div>
          <div className="flex items-center gap-1">
            <CloudRain size={14} className="text-sky" />
            <span>{rainProbability}%</span>
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-text-secondary leading-relaxed">{advice}</p>
    </div>
  );
};
