import React from 'react';
import { ChevronLeft } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

interface AppHeaderProps {
  title: string;
  showBack?: boolean;
  rightAction?: React.ReactNode;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  title,
  showBack = false,
  rightAction,
}) => {
  const handleBack = () => {
    window.history.back();
  };

  return (
    <header className="safe-top sticky top-0 z-50 bg-bg/90 backdrop-blur-md">
      <div className="flex items-center justify-between h-12 px-4 relative">
        {/* Left: back button */}
        <div className="w-10 flex-shrink-0">
          {showBack && (
            <button
              type="button"
              onClick={handleBack}
              className="btn-press flex items-center justify-center w-10 h-10 -ml-2 rounded-full text-text-primary cursor-pointer min-w-[44px] min-h-[44px]"
              aria-label="返回"
            >
              <ChevronLeft size={24} />
            </button>
          )}
        </div>

        {/* Center: title */}
        <h1 className="absolute left-1/2 -translate-x-1/2 text-base font-semibold text-text-primary whitespace-nowrap">
          {title}
        </h1>

        {/* Right: theme toggle + action */}
        <div className="flex-shrink-0 flex items-center justify-end gap-0.5 min-w-[44px]">
          <ThemeToggle />
          {rightAction}
        </div>
      </div>
    </header>
  );
};
