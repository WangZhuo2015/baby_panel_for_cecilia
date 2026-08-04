import React from 'react';
import { Bell } from 'lucide-react';
import { useBabyStore } from '@/stores/useBabyStore';

interface BabyProfileHeaderProps {
  showNotification?: boolean;
}

function getAgeLabel(birthDate: string): string {
  const birth = new Date(birthDate);
  const now = new Date();
  const months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  const days = Math.floor((now.getTime() - birth.getTime()) / (1000 * 60 * 60 * 24));
  if (months < 1) return `${days}天`;
  if (months < 24) return `${months}个月${days % 30}天`;
  const years = Math.floor(months / 12);
  return `${years}岁${months % 12}个月`;
}

export const BabyProfileHeader: React.FC<BabyProfileHeaderProps> = ({
  showNotification = true,
}) => {
  const baby = useBabyStore((s) => s.baby);

  if (!baby) return null;

  return (
    <div className="flex items-center justify-between px-1 py-2">
      <div className="flex items-center gap-3">
        {/* Avatar placeholder */}
        <div className="w-12 h-12 rounded-full bg-primary-soft flex items-center justify-center overflow-hidden shadow-card">
          {baby.avatarUrl ? (
            <img src={baby.avatarUrl} alt={baby.nickname} className="w-full h-full object-cover" />
          ) : (
            <span className="text-xl">👶</span>
          )}
        </div>
        <div>
          <h1 className="text-base font-semibold text-text-primary">{baby.nickname}</h1>
          <p className="text-xs text-text-secondary">{getAgeLabel(baby.birthDate)}</p>
        </div>
      </div>
      {showNotification && (
        <button
          type="button"
          className="btn-press relative w-10 h-10 flex items-center justify-center rounded-full bg-primary-light text-primary cursor-pointer min-w-[44px] min-h-[44px]"
          aria-label="通知"
        >
          <Bell size={20} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full" />
        </button>
      )}
    </div>
  );
};
