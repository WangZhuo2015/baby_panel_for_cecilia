"use client";

import { useState, useEffect } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  Clock,
  Plus,
  Minus,
} from "lucide-react";
import { CuteButton } from "@/components/ui/CuteButton";
import { CuteInput } from "@/components/ui/CuteInput";
import { CuteCard } from "@/components/ui/CuteCard";
import { FormSection } from "@/components/ui/FormSection";
import { SegmentControl } from "@/components/ui/SegmentControl";
import { QuickAiButton } from "@/components/ui/QuickAiButton";
import { VoiceConfirmEntry } from "@/components/ui/VoiceConfirmEntry";
import { localTimeToUtcIso, getLocalDateStr } from "@/lib/date";
import type { FeedingType, FeedingRecord } from "@/types";

const FORMULA_PRESETS = [60, 90, 120, 150, 180, 210, 240];

function formatTimerStatic(totalSec: number) {
  const m = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function isoToLocalHHMM(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  return `${p.find((x) => x.type === "hour")?.value ?? "00"}:${p.find((x) => x.type === "minute")?.value ?? "00"}`;
}

export interface FeedingFormProps {
  mode?: "create" | "edit";
  initialData?: Partial<FeedingRecord> | any;
  onSubmit: (data: {
    type: FeedingType;
    amountMl?: number | null;
    leftMinutes?: number | null;
    rightMinutes?: number | null;
    spitUp: boolean;
    notes?: string;
    timestamp: string;
  }) => Promise<void>;
  onCancel?: () => void;
  saving?: boolean;
}

export function FeedingForm({
  mode = "create",
  initialData,
  onSubmit,
  onCancel,
  saving = false,
}: FeedingFormProps) {
  const isEdit = mode === "edit";

  const [feedingType, setFeedingType] = useState<FeedingType>(() => {
    return (initialData?.type as FeedingType) || "formula";
  });

  const [amount, setAmount] = useState<number>(() => {
    return typeof initialData?.amountMl === "number" ? initialData.amountMl : 120;
  });

  // Breastfeeding state
  const [activeSide, setActiveSide] = useState<"left" | "right" | null>(null);
  const [leftSec, setLeftSec] = useState<number>(() => {
    return (initialData?.leftMinutes || 0) * 60;
  });
  const [rightSec, setRightSec] = useState<number>(() => {
    return (initialData?.rightMinutes || 0) * 60;
  });

  const [spitUp, setSpitUp] = useState<boolean>(() => {
    return Boolean(initialData?.spitUp);
  });

  const [tookVitaminD, setTookVitaminD] = useState<boolean>(() => {
    return typeof initialData?.notes === "string" && initialData.notes.includes("维生素D");
  });

  const [notes, setNotes] = useState<string>(() => {
    if (!initialData?.notes) return "";
    return initialData.notes
      .replace(/\(已补充维生素D\)/g, "")
      .replace(/已补充维生素D/g, "")
      .trim();
  });

  const [time, setTime] = useState<string>(() => {
    if (initialData?.timestamp) {
      const hhmm = isoToLocalHHMM(initialData.timestamp);
      if (hhmm) return hhmm;
    }
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  });

  const [isNow, setIsNow] = useState<boolean>(() => !isEdit && !initialData?.timestamp);

  // Stopwatch timer interval
  useEffect(() => {
    if (!activeSide) return;
    const interval = setInterval(() => {
      if (activeSide === "left") setLeftSec((s) => s + 1);
      else setRightSec((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [activeSide]);

  const leftMin = Math.round(leftSec / 60);
  const rightMin = Math.round(rightSec / 60);
  const totalNursingMin = leftMin + rightMin;

  const handleFormSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    let finalNotes = notes.trim();
    if (tookVitaminD) {
      finalNotes = finalNotes ? `${finalNotes} (已补充维生素D)` : "已补充维生素D";
    }

    let timestamp: string;
    if (isEdit && initialData?.timestamp) {
      const origDateStr = getLocalDateStr(new Date(initialData.timestamp));
      timestamp = new Date(`${origDateStr}T${time}:00+08:00`).toISOString();
    } else {
      timestamp = isNow ? new Date().toISOString() : localTimeToUtcIso(time);
    }

    await onSubmit({
      type: feedingType,
      amountMl:
        feedingType === "formula" || feedingType === "bottle_breast" || feedingType === "mixed"
          ? Number(amount)
          : null,
      leftMinutes: feedingType === "breast" || feedingType === "mixed" ? leftMin : null,
      rightMinutes: feedingType === "breast" || feedingType === "mixed" ? rightMin : null,
      spitUp,
      notes: finalNotes || undefined,
      timestamp,
    });
  };

  return (
    <div className="space-y-4">
      {/* Quick AI Advisor & Voice (Only in Create Mode) */}
      {!isEdit && (
        <>
          <div className="flex items-center justify-between bg-white/70 px-3.5 py-2.5 rounded-2xl border border-primary/20 shadow-2xs">
            <div className="flex items-center gap-2">
              <span className="text-base">🍼</span>
              <span className="text-xs font-medium text-text-primary">遇到吐奶/胀气或奶量疑问？</span>
            </div>
            <QuickAiButton
              contextType="feeding"
              label="喂养顾问"
              contextTitle="喂养与胀气拍嗝顾问"
              variant="compact"
            />
          </div>
          <VoiceConfirmEntry contextType="feeding" />
        </>
      )}

      {/* Feeding Type Selector */}
      <CuteCard className="p-3">
        <SegmentControl
          options={[
            { value: "breast", label: "🤱 母乳亲喂" },
            { value: "formula", label: "🍼 配方奶粉" },
            { value: "bottle_breast", label: "🍼 瓶喂母乳" },
            { value: "mixed", label: "🥛 混合喂养" },
          ]}
          value={feedingType}
          onChange={(v) => setFeedingType(v as FeedingType)}
        />
      </CuteCard>

      {/* 🤱 母乳亲喂：双侧秒表与时长调整 */}
      {(feedingType === "breast" || feedingType === "mixed") && (
        <CuteCard className="p-4 space-y-4 bg-gradient-to-br from-pink-50/70 to-purple-50/40 border border-pink-100">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-pink-900 flex items-center gap-1.5">
                <Clock size={15} className="text-primary" />
                母乳亲喂时长
              </h3>
              <p className="text-[10px] text-text-muted mt-0.5">
                {isEdit ? "直接调整两侧亲喂分钟数" : "支持实时秒表计时或直接调节分钟数"}
              </p>
            </div>
            <div className="text-right">
              <span className="text-xs text-text-secondary">总时长</span>
              <p className="text-base font-extrabold text-primary">{totalNursingMin} 分钟</p>
            </div>
          </div>

          {/* Left & Right Dual Cards */}
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
        </CuteCard>
      )}

      {/* 🍼 配方奶 / 瓶喂母乳：刻度预设与微调 */}
      {(feedingType === "formula" || feedingType === "bottle_breast" || feedingType === "mixed") && (
        <CuteCard className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider">
              {feedingType === "bottle_breast" ? "瓶喂母乳量" : "配方奶量"}
            </h3>
            <span className="text-xs text-text-muted">点击或微调奶量</span>
          </div>

          {/* Big Amount Display */}
          <div className="flex items-center justify-center gap-4 py-2">
            <button
              type="button"
              onClick={() => setAmount(Math.max(10, amount - 10))}
              className="w-10 h-10 rounded-full bg-primary-light text-primary flex items-center justify-center btn-press font-bold hover:bg-primary/20"
            >
              <Minus size={18} />
            </button>

            <div className="text-center">
              <div className="text-5xl font-black text-primary tracking-tight">
                {amount}
              </div>
              <span className="text-xs font-semibold text-text-muted">毫升 (ml)</span>
            </div>

            <button
              type="button"
              onClick={() => setAmount(amount + 10)}
              className="w-10 h-10 rounded-full bg-primary-light text-primary flex items-center justify-center btn-press font-bold hover:bg-primary/20"
            >
              <Plus size={18} />
            </button>
          </div>

          {/* Quick Presets */}
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            {FORMULA_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAmount(p)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap btn-press ${
                  amount === p
                    ? "bg-primary text-white shadow-button scale-105"
                    : "bg-gray-100 text-text-secondary hover:bg-primary-soft"
                }`}
              >
                {p}ml
              </button>
            ))}
          </div>
        </CuteCard>
      )}

      {/* 🕒 时间选择 */}
      <CuteCard className="p-4 space-y-3">
        <FormSection title="记录时间">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <CuteInput
                type="time"
                value={time}
                onChange={(e) => {
                  setTime(e.target.value);
                  setIsNow(false);
                }}
              />
            </div>
            {!isEdit && (
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  setTime(
                    `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
                  );
                  setIsNow(true);
                }}
                className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition-all whitespace-nowrap btn-press ${
                  isNow
                    ? "bg-primary text-white shadow-button"
                    : "bg-primary-light text-primary hover:bg-primary-soft"
                }`}
              >
                刚刚 / 现在
              </button>
            )}
          </div>
        </FormSection>

        {/* 吐奶与补充剂开关 */}
        <div className="pt-2 border-t border-divider/60 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-text-primary block">
                ⚠️ 吐奶 / 溢奶情况
              </span>
              <span className="text-[10px] text-text-muted">记录是否有大口吐奶或溢奶</span>
            </div>
            <button
              type="button"
              onClick={() => setSpitUp(!spitUp)}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-all whitespace-nowrap btn-press ${
                spitUp
                  ? "bg-red-500 text-white shadow-sm"
                  : "bg-gray-100 text-text-muted"
              }`}
            >
              {spitUp ? "有吐奶 🚨" : "正常无吐奶"}
            </button>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div>
              <span className="text-xs font-semibold text-text-primary block">
                💊 维生素 D3 打卡
              </span>
              <span className="text-[10px] text-text-muted">已随本顿喂养补充维生素D</span>
            </div>
            <button
              type="button"
              onClick={() => setTookVitaminD(!tookVitaminD)}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-all whitespace-nowrap btn-press ${
                tookVitaminD
                  ? "bg-mint text-white shadow-sm"
                  : "bg-gray-100 text-text-muted"
              }`}
            >
              {tookVitaminD ? "已吃 D3 ✨" : "未吃"}
            </button>
          </div>
        </div>

        <FormSection title="备注说明（可选）">
          <CuteInput
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="如：吃得很香 / 拍嗝顺畅 / 换了新奶嘴"
          />
        </FormSection>
      </CuteCard>

      {/* Buttons */}
      <div className="pt-2 flex gap-3">
        {isEdit && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3 rounded-full border border-primary-soft text-text-secondary text-sm font-medium btn-press hover:bg-gray-50"
          >
            取消
          </button>
        )}
        <CuteButton
          variant="primary"
          size="lg"
          fullWidth={!isEdit}
          onClick={() => handleFormSubmit()}
          disabled={saving}
          className={`flex items-center justify-center gap-2 ${isEdit ? "flex-1" : ""}`}
        >
          <CheckCircle2 size={18} />
          {saving ? "保存中..." : isEdit ? "保存修改" : "保存喂养记录"}
        </CuteButton>
      </div>
    </div>
  );
}
