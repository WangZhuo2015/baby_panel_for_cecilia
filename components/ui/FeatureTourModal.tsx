"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Sparkles, X, BookOpen } from "lucide-react";
import { FeatureTourCards } from "./FeatureTourCards";

interface FeatureTourModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FeatureTourModal: React.FC<FeatureTourModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted) return null;

  const modalContent = (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[999] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in select-none"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-[#1E171E] text-text-primary dark:text-gray-100 w-full max-w-lg rounded-t-[32px] sm:rounded-3xl h-[88vh] sm:h-[680px] max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-slide-up pb-[max(12px,env(safe-area-inset-bottom,0px))] border border-primary/20"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-divider flex items-center justify-between bg-gradient-to-r from-pink-50 via-rose-50 to-purple-50 dark:from-pink-950/20 dark:via-rose-950/20 dark:to-purple-950/20">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-primary text-white flex items-center justify-center shadow-button shrink-0">
              <BookOpen size={20} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-primary flex items-center gap-1.5">
                Baby Panel 功能与育儿指南
                <Sparkles size={14} className="text-primary" />
              </h3>
              <p className="text-[11px] text-text-secondary">
                专业医学标准 · 科学发育评估 · 家庭多人同步
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/80 dark:bg-card/80 flex items-center justify-center text-text-secondary hover:bg-white cursor-pointer"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 flex-1 min-h-0 flex flex-col">
          <FeatureTourCards
            onComplete={onClose}
            showCompleteButton={true}
            completeButtonText="我知道啦"
          />
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};
