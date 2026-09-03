"use client";

import React from "react";
import { Check } from "lucide-react";

interface Step {
  id: string;
  title: string;
}

interface OnboardingStepProgressProps {
  steps: Step[];
  currentStepIndex: number;
}

export function OnboardingStepProgress({ steps, currentStepIndex }: OnboardingStepProgressProps) {
  return (
    <div className="w-full py-2 select-none">
      <div className="flex items-center justify-between relative">
        {/* 背景连接线 */}
        <div className="absolute left-4 right-4 top-1/2 -translate-y-1/2 h-0.5 bg-gray-200 dark:bg-card z-0" />
        
        {steps.map((step, idx) => {
          const isDone = idx < currentStepIndex;
          const isCurrent = idx === currentStepIndex;

          return (
            <div key={step.id} className="relative z-10 flex flex-col items-center">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                  isDone
                    ? "bg-primary text-white shadow-soft"
                    : isCurrent
                    ? "bg-primary-soft text-primary border-2 border-primary shadow-soft scale-110"
                    : "bg-white dark:bg-card text-text-muted border border-divider"
                }`}
              >
                {isDone ? <Check size={14} strokeWidth={3} /> : idx + 1}
              </div>
              <span
                className={`text-[10px] mt-1 transition-colors whitespace-nowrap ${
                  isCurrent
                    ? "text-primary font-bold"
                    : isDone
                    ? "text-text-secondary"
                    : "text-text-muted"
                }`}
              >
                {step.title}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
