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
const NURSING_STORAGE_KEY = "baby_active_nursing_timer";

export function NursingDualTimer({
  isEdit = false,
  initialLeftMin,
  initialRightMin,
  onChange,
}: NursingDualTimerProps) {
  const [activeSide, setActiveSide] = useState<"left" | "right" | null>(null);
  const [leftSec, setLeftSec] = useState<number>(() => Math.max(0, initialLeftMin * 60));
  const [rightSec, setRightSec] = useState<number>(() => Math.max(0, initialRightMin * 60));

  // Ref tracking base elapsed seconds and real start timestamp to prevent background throttling drift
  const timingRef = useRef<{ side: "left" | "right" | null; baseSec: number; startAt: number }>({
    side: null,
    baseSec: 0,
    startAt: 0,
  });

  // Restore active timing state on mount (create mode only)
  useEffect(() => {
    if (isEdit || typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(NURSING_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      const now = Date.now();
      // Only restore if within 12 hours
      if (now - (data.updatedAt || 0) < 12 * 3600 * 1000) {
        let restoredLeft = data.leftSec || 0;
        let restoredRight = data.rightSec || 0;
        if (data.activeSide === "left" && data.startAt) {
          const delta = Math.floor((now - data.startAt) / 1000);
          restoredLeft = (data.baseSec || 0) + delta;
          timingRef.current = { side: "left", baseSec: data.baseSec || 0, startAt: data.startAt };
          setActiveSide("left");
        } else if (data.activeSide === "right" && data.startAt) {
          const delta = Math.floor((now - data.startAt) / 1000);
          restoredRight = (data.baseSec || 0) + delta;
          timingRef.current = { side: "right", baseSec: data.baseSec || 0, startAt: data.startAt };
          setActiveSide("right");
        }
        setLeftSec(restoredLeft);
        setRightSec(restoredRight);
      }
    } catch {
      // Ignore
    }
  }, [isEdit]);

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

  // Handle switching active side
  const handleToggleSide = (side: "left" | "right") => {
    if (activeSide === side) {
      // Pause
      setActiveSide(null);
      timingRef.current = { side: null, baseSec: 0, startAt: 0 };
      if (!isEdit && typeof window !== "undefined") {
        try {
          localStorage.setItem(
            NURSING_STORAGE_KEY,
            JSON.stringify({ activeSide: null, leftSec, rightSec, updatedAt: Date.now() })
          );
        } catch {}
      }
    } else {
      // Start or switch side
      const baseSec = side === "left" ? leftSec : rightSec;
      const startAt = Date.now();
      timingRef.current = { side, baseSec, startAt };
      setActiveSide(side);
      if (!isEdit && typeof window !== "undefined") {
        try {
          localStorage.setItem(
            NURSING_STORAGE_KEY,
            JSON.stringify({ activeSide: side, baseSec, startAt, leftSec, rightSec, updatedAt: startAt })
          );
        } catch {}
      }
    }
  };

  // Timestamp-delta interval: immune to background timer throttling
  useEffect(() => {
    if (!activeSide) return;

    const tick = () => {
      const now = Date.now();
      const elapsed = Math.max(0, Math.floor((now - timingRef.current.startAt) / 1000));
      const current = timingRef.current.baseSec + elapsed;
      if (activeSide === "left") {
        setLeftSec(current);
      } else {
        setRightSec(current);
      }
      if (!isEdit && typeof window !== "undefined") {
        try {
          localStorage.setItem(
            NURSING_STORAGE_KEY,
            JSON.stringify({
              activeSide,
              baseSec: timingRef.current.baseSec,
              startAt: timingRef.current.startAt,
              leftSec: activeSide === "left" ? current : leftSec,
              rightSec: activeSide === "right" ? current : rightSec,
              updatedAt: now,
            })
          );
        } catch {}
      }
    };

    tick();
    const interval = setInterval(tick, 1000);

    // Sync instantly when user unlocks or re-focuses tab
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        tick();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeSide, leftSec, rightSec, isEdit]);

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
              onClick={() => handleToggleSide("left")}
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
                timingRef.current = { side: null, baseSec: 0, startAt: 0 };
                setLeftSec(0);
                if (!isEdit && typeof window !== "undefined") {
                  try {
                    localStorage.setItem(
                      NURSING_STORAGE_KEY,
                      JSON.stringify({ activeSide: null, leftSec: 0, rightSec, updatedAt: Date.now() })
                    );
                  } catch {}
                }
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
              onClick={() => handleToggleSide("right")}
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
                timingRef.current = { side: null, baseSec: 0, startAt: 0 };
                setRightSec(0);
                if (!isEdit && typeof window !== "undefined") {
                  try {
                    localStorage.setItem(
                      NURSING_STORAGE_KEY,
                      JSON.stringify({ activeSide: null, leftSec, rightSec: 0, updatedAt: Date.now() })
                    );
                  } catch {}
                }
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
