"use client";

import React, { useState, useEffect, useRef } from "react";
import { Play, Pause, RotateCcw } from "lucide-react";

function formatTimerStatic(totalSec: number) {
  const m = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export interface NursingDualTimerProps {
  isEdit?: boolean;
  initialLeftMin: number;
  initialRightMin: number;
  onChange: (leftMin: number, rightMin: number) => void;
}

/**
 * Isolated Dual Breast Nursing Timer
 * Isolates 1s stopwatch interval ticks to this leaf component,
 * preventing expensive parent form re-renders on every second.
 */
export function NursingDualTimer({
  isEdit = false,
  initialLeftMin,
  initialRightMin,
  onChange,
}: NursingDualTimerProps) {
  const [activeSide, setActiveSide] = useState<"left" | "right" | null>(null);
  const [leftSec, setLeftSec] = useState<number>(() => Math.max(0, initialLeftMin * 60));
  const [rightSec, setRightSec] = useState<number>(() => Math.max(0, initialRightMin * 60));

  const leftMin = Math.round(leftSec / 60);
  const rightMin = Math.round(rightSec / 60);

  // Sync to parent whenever rounded minute values change
  const prevMinRef = useRef({ leftMin, rightMin });
  useEffect(() => {
    if (prevMinRef.current.leftMin !== leftMin || prevMinRef.current.rightMin !== rightMin) {
      prevMinRef.current = { leftMin, rightMin };
      onChange(leftMin, rightMin);
    }
  }, [leftMin, rightMin, onChange]);

  // Leaf-level interval - only ticks this component
  useEffect(() => {
    if (!activeSide) return;
    const interval = setInterval(() => {
      if (activeSide === "left") setLeftSec((s) => s + 1);
      else setRightSec((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [activeSide]);

  return (
    <div className="grid grid-cols-2 gap-3">
      {/* Left Breast */}
      <div
        className={`p-3 rounded-2xl border transition-all text-center ${
          activeSide === "left"
            ? "bg-white border-primary ring-2 ring-primary/20 shadow-soft"
            : "bg-white/80 border-divider"
        }`}
      >
        <span className="text-xs font-semibold text-text-secondary">左侧乳房</span>
        {!isEdit && (
          <div className="text-2xl font-mono font-bold text-text-primary my-1.5">
            {formatTimerStatic(leftSec)}
          </div>
        )}

        {!isEdit && (
          <div className="flex items-center justify-center gap-1.5 mb-2">
            <button
              type="button"
              onClick={() => setActiveSide(activeSide === "left" ? null : "left")}
              className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 transition-all ${
                activeSide === "left"
                  ? "bg-primary text-white shadow-button"
                  : "bg-primary-soft text-primary hover:bg-primary/20"
              }`}
            >
              {activeSide === "left" ? <Pause size={12} /> : <Play size={12} />}
              {activeSide === "left" ? "暂停" : "开始"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeSide === "left") setActiveSide(null);
                setLeftSec(0);
              }}
              className="p-1 rounded-full text-gray-400 hover:text-gray-600"
              title="重置"
            >
              <RotateCcw size={12} />
            </button>
          </div>
        )}

        {/* Minute Adjustment */}
        <div className={`flex items-center justify-center gap-1 pt-1 ${!isEdit ? "border-t border-divider/50" : "my-2"}`}>
          <button
            type="button"
            onClick={() => setLeftSec((s) => Math.max(0, s - 60))}
            className="w-7 h-7 rounded-full bg-gray-100 text-gray-600 text-xs font-bold flex items-center justify-center btn-press hover:bg-gray-200"
          >
            -1
          </button>
          <span className="text-sm font-bold text-text-primary w-12 text-center">
            {leftMin}分
          </span>
          <button
            type="button"
            onClick={() => setLeftSec((s) => s + 60)}
            className="w-7 h-7 rounded-full bg-gray-100 text-gray-600 text-xs font-bold flex items-center justify-center btn-press hover:bg-gray-200"
          >
            +1
          </button>
        </div>

        {/* Quick minute presets in edit mode */}
        <div className="flex justify-center gap-1 pt-1">
          {[5, 10, 15, 20].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setLeftSec(m * 60)}
              className={`px-1.5 py-0.5 rounded text-[10px] ${
                leftMin === m
                  ? "bg-primary text-white font-bold"
                  : "bg-gray-100 text-text-secondary hover:bg-primary-soft"
              }`}
            >
              {m}m
            </button>
          ))}
        </div>
      </div>

      {/* Right Breast */}
      <div
        className={`p-3 rounded-2xl border transition-all text-center ${
          activeSide === "right"
            ? "bg-white border-primary ring-2 ring-primary/20 shadow-soft"
            : "bg-white/80 border-divider"
        }`}
      >
        <span className="text-xs font-semibold text-text-secondary">右侧乳房</span>
        {!isEdit && (
          <div className="text-2xl font-mono font-bold text-text-primary my-1.5">
            {formatTimerStatic(rightSec)}
          </div>
        )}

        {!isEdit && (
          <div className="flex items-center justify-center gap-1.5 mb-2">
            <button
              type="button"
              onClick={() => setActiveSide(activeSide === "right" ? null : "right")}
              className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 transition-all ${
                activeSide === "right"
                  ? "bg-primary text-white shadow-button"
                  : "bg-primary-soft text-primary hover:bg-primary/20"
              }`}
            >
              {activeSide === "right" ? <Pause size={12} /> : <Play size={12} />}
              {activeSide === "right" ? "暂停" : "开始"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeSide === "right") setActiveSide(null);
                setRightSec(0);
              }}
              className="p-1 rounded-full text-gray-400 hover:text-gray-600"
              title="重置"
            >
              <RotateCcw size={12} />
            </button>
          </div>
        )}

        {/* Minute Adjustment */}
        <div className={`flex items-center justify-center gap-1 pt-1 ${!isEdit ? "border-t border-divider/50" : "my-2"}`}>
          <button
            type="button"
            onClick={() => setRightSec((s) => Math.max(0, s - 60))}
            className="w-7 h-7 rounded-full bg-gray-100 text-gray-600 text-xs font-bold flex items-center justify-center btn-press hover:bg-gray-200"
          >
            -1
          </button>
          <span className="text-sm font-bold text-text-primary w-12 text-center">
            {rightMin}分
          </span>
          <button
            type="button"
            onClick={() => setRightSec((s) => s + 60)}
            className="w-7 h-7 rounded-full bg-gray-100 text-gray-600 text-xs font-bold flex items-center justify-center btn-press hover:bg-gray-200"
          >
            +1
          </button>
        </div>

        {/* Quick minute presets in edit mode */}
        <div className="flex justify-center gap-1 pt-1">
          {[5, 10, 15, 20].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setRightSec(m * 60)}
              className={`px-1.5 py-0.5 rounded text-[10px] ${
                rightMin === m
                  ? "bg-primary text-white font-bold"
                  : "bg-gray-100 text-text-secondary hover:bg-primary-soft"
              }`}
            >
              {m}m
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
