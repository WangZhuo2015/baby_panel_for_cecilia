"use client";

import React, { useState, useEffect } from "react";
import { Smartphone, X, ChevronRight } from "lucide-react";
import { InstallGuideModal } from "./InstallGuideModal";

export const InstallGuideBanner: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    // 1. Check if already in standalone PWA mode
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;

    if (isStandalone) {
      setIsVisible(false);
      return;
    }

    // 2. Check if user dismissed recently (dismiss for 5 days)
    const dismissedAt = localStorage.getItem("pwa_install_banner_dismissed");
    if (dismissedAt) {
      const diffDays = (Date.now() - Number(dismissedAt)) / (1000 * 60 * 60 * 24);
      if (diffDays < 5) {
        setIsVisible(false);
        return;
      }
    }

    const ua = navigator.userAgent.toLowerCase();
    setIsIos(/iphone|ipad|ipod/.test(ua));
    setIsVisible(true);
  }, []);

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsVisible(false);
    try {
      localStorage.setItem("pwa_install_banner_dismissed", String(Date.now()));
    } catch {
      // Ignore
    }
  };

  if (!isVisible) {
    return (
      <InstallGuideModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    );
  }

  return (
    <>
      <div
        onClick={() => setIsModalOpen(true)}
        className="mb-3.5 p-3 rounded-2xl bg-gradient-to-r from-primary-light/90 via-pink-50 to-lavender/20 border border-primary/25 shadow-soft flex items-center justify-between gap-2.5 cursor-pointer hover:border-primary/40 transition-all animate-fade-in"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-primary text-white flex items-center justify-center shrink-0 shadow-button">
            <Smartphone size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-text-primary flex items-center gap-1">
              保存为桌面 App 体验更佳 ✨
            </p>
            <p className="text-[10px] text-text-secondary truncate mt-0.5">
              {isIos ? "点击底部分享 ➔「添加到主屏幕」" : "像原生应用一样全屏顺畅记录"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[11px] text-primary font-bold px-2 py-0.5 rounded-full bg-white shadow-xs flex items-center gap-0.5">
            查看指引 <ChevronRight size={12} />
          </span>
          <button
            type="button"
            onClick={handleDismiss}
            className="w-6 h-6 rounded-full text-text-muted hover:text-text-primary flex items-center justify-center hover:bg-black/5"
            title="关闭提示"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <InstallGuideModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
};
