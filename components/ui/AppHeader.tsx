"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, RefreshCw } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

interface AppHeaderProps {
  title: string;
  showBack?: boolean;
  rightAction?: React.ReactNode;
  onRefresh?: () => Promise<void> | void;
  refreshing?: boolean;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  title,
  showBack = false,
  rightAction,
  onRefresh,
  refreshing = false,
}) => {
  const router = useRouter();
  const [internalLoading, setInternalLoading] = useState(false);
  const isSpinning = refreshing || internalLoading;

  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
    } else {
      router.push('/');
    }
  };

  const handleRefreshClick = async () => {
    if (!onRefresh || isSpinning) return;
    setInternalLoading(true);
    try {
      await onRefresh();
    } finally {
      setTimeout(() => setInternalLoading(false), 450);
    }
  };

  return (
    <header className="safe-top sticky top-0 z-50 bg-bg/90 backdrop-blur-md border-b border-primary/5">
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

        {/* Right: theme toggle + refresh + action */}
        <div className="flex-shrink-0 flex items-center justify-end gap-1 min-w-[44px]">
          {onRefresh && (
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={isSpinning}
              className="btn-press flex items-center justify-center w-9 h-9 rounded-full text-text-secondary hover:text-primary transition-colors cursor-pointer disabled:opacity-60"
              title="刷新本页数据"
              aria-label="刷新本页数据"
            >
              <RefreshCw size={17} className={isSpinning ? "animate-spin text-primary" : ""} />
            </button>
          )}
          <ThemeToggle />
          {rightAction}
        </div>
      </div>
    </header>
  );
};
