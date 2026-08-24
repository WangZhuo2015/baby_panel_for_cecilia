"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  Clock,
  Plus,
  Minus,
} from "lucide-react";
import { AppHeader } from "@/components/ui/AppHeader";
import { CuteButton } from "@/components/ui/CuteButton";
import { CuteInput } from "@/components/ui/CuteInput";
import { CuteCard } from "@/components/ui/CuteCard";
import { FormSection } from "@/components/ui/FormSection";
import { SegmentControl } from "@/components/ui/SegmentControl";
import { QuickAiButton } from "@/components/ui/QuickAiButton";
import { useToast } from "@/components/ui/Toast";
import { useBabyStore } from "@/stores/useBabyStore";
import { localTimeToUtcIso } from "@/lib/date";
import type { FeedingType } from "@/types";

const FORMULA_PRESETS = [60, 90, 120, 150, 180, 210, 240];


// ===== 亲喂秒表外部 store：计时 tick 不经过页面 state =====
const stopwatchStore = {
  left: 600, // default 10m
  right: 480, // default 8m
  listeners: new Set<() => void>(),
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  },
  emit() {
    this.listeners.forEach((fn) => fn());
  },
};

function StopwatchText({ side }: { side: "left" | "right" }) {
  const totalSec = useSyncExternalStore(
    (cb) => stopwatchStore.subscribe(cb),
    () => stopwatchStore[side]
  );
  return <>{formatTimerStatic(totalSec)}</>;
}

function StopwatchMinutes({ side }: { side: "left" | "right" }) {
  const totalSec = useSyncExternalStore(
    (cb) => stopwatchStore.subscribe(cb),
    () => stopwatchStore[side]
  );
  return <>{Math.round(totalSec / 60)}分</>;
}

function formatTimerStatic(totalSec: number) {
  const m = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default function FeedingRecordPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const addFeedingRecord = useBabyStore((s) => s.addFeedingRecord);

  const [feedingType, setFeedingType] = useState<FeedingType>("formula");
  const [amount, setAmount] = useState(120);

  // Breastfeeding stopwatch —— 秒数存模块级 store，叶子组件自订阅，
  // 计时期间不再每秒重渲染整页（提交时直接读 store）
  const [activeSide, setActiveSide] = useState<"left" | "right" | null>(null);

  const [spitUp, setSpitUp] = useState(false);
  const [tookVitaminD, setTookVitaminD] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [time, setTime] = useState(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  });
  const [isNow, setIsNow] = useState(true);

  // Stopwatch timer interval：只推进 store 并通知叶子组件
  useEffect(() => {
    if (!activeSide) return;
    const interval = setInterval(() => {
      stopwatchStore[activeSide] += 1;
      stopwatchStore.emit();
    }, 1000);
    return () => clearInterval(interval);
  }, [activeSide]);

  const leftMin = Math.round(stopwatchStore.left / 60);
  const rightMin = Math.round(stopwatchStore.right / 60);
  const totalNursingMin = leftMin + rightMin;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      let finalNotes = notes.trim();
      if (tookVitaminD) {
        finalNotes = finalNotes ? `${finalNotes} (已补充维生素D)` : "已补充维生素D";
      }

      await addFeedingRecord({
        timestamp: isNow ? new Date().toISOString() : localTimeToUtcIso(time),
        type: feedingType,
        amountMl:
          feedingType === "formula" || feedingType === "bottle_breast" || feedingType === "mixed"
            ? Number(amount)
            : undefined,
        leftMinutes: feedingType === "breast" || feedingType === "mixed" ? leftMin : undefined,
        rightMinutes: feedingType === "breast" || feedingType === "mixed" ? rightMin : undefined,
        spitUp,
        notes: finalNotes || undefined,
      });

      showToast("喂养记录已保存 ✨");
      setTimeout(() => router.push("/"), 500);
    } catch (err: any) {
      showToast(err?.message || "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-bg max-w-md mx-auto px-4 pt-4 pb-36">
      <AppHeader
        title="记录喂养"
        showBack
        rightAction={
          <button
            onClick={() => handleSubmit()}
            disabled={saving}
            className="text-xs font-bold text-primary px-3 py-1.5 rounded-full bg-primary-soft hover:bg-primary/20 btn-press whitespace-nowrap"
          >
            {saving ? "保存中" : "保存"}
          </button>
        }
      />

      <div className="space-y-4 mt-3">
        {/* Quick AI Advisor */}
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

        {/* 🤱 母乳亲喂：双侧实时秒表与时长调整 */}
        {(feedingType === "breast" || feedingType === "mixed") && (
          <CuteCard className="p-4 space-y-4 bg-gradient-to-br from-pink-50/70 to-purple-50/40 border border-pink-100">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-pink-900 flex items-center gap-1.5">
                  <Clock size={15} className="text-primary" />
                  母乳亲喂计时与时长
                </h3>
                <p className="text-[10px] text-text-muted mt-0.5">
                  支持实时秒表计时或直接调节分钟数
                </p>
              </div>
              <div className="text-right">
                <span className="text-xs text-text-secondary">总计时长</span>
                <p className="text-base font-extrabold text-primary">{totalNursingMin} 分钟</p>
              </div>
            </div>

            {/* Left & Right Dual Timer Cards */}
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
                <div className="text-2xl font-mono font-bold text-text-primary my-1.5">
                  {<StopwatchText side="left" />}
                </div>

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
                      stopwatchStore.left = 0;
                      stopwatchStore.emit();
                    }}
                    className="p-1 rounded-full text-gray-400 hover:text-gray-600"
                    title="重置"
                  >
                    <RotateCcw size={12} />
                  </button>
                </div>

                {/* Quick Minute Adjustment */}
                <div className="flex items-center justify-center gap-1 pt-1 border-t border-divider/50">
                  <button
                    type="button"
                    onClick={() => { stopwatchStore.left = Math.max(0, stopwatchStore.left - 60); stopwatchStore.emit(); }}
                    className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-xs font-bold flex items-center justify-center"
                  >
                    -1
                  </button>
                  <span className="text-xs font-bold text-text-primary w-8">{<StopwatchMinutes side="left" />}</span>
                  <button
                    type="button"
                    onClick={() => { stopwatchStore.left = stopwatchStore.left + 60; stopwatchStore.emit(); }}
                    className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-xs font-bold flex items-center justify-center"
                  >
                    +1
                  </button>
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
                <div className="text-2xl font-mono font-bold text-text-primary my-1.5">
                  {<StopwatchText side="right" />}
                </div>

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
                      stopwatchStore.right = 0;
                      stopwatchStore.emit();
                    }}
                    className="p-1 rounded-full text-gray-400 hover:text-gray-600"
                    title="重置"
                  >
                    <RotateCcw size={12} />
                  </button>
                </div>

                {/* Quick Minute Adjustment */}
                <div className="flex items-center justify-center gap-1 pt-1 border-t border-divider/50">
                  <button
                    type="button"
                    onClick={() => { stopwatchStore.right = Math.max(0, stopwatchStore.right - 60); stopwatchStore.emit(); }}
                    className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-xs font-bold flex items-center justify-center"
                  >
                    -1
                  </button>
                  <span className="text-xs font-bold text-text-primary w-8">{<StopwatchMinutes side="right" />}</span>
                  <button
                    type="button"
                    onClick={() => { stopwatchStore.right = stopwatchStore.right + 60; stopwatchStore.emit(); }}
                    className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-xs font-bold flex items-center justify-center"
                  >
                    +1
                  </button>
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
                className="w-10 h-10 rounded-full bg-primary-light text-primary flex items-center justify-center btn-press font-bold"
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
                className="w-10 h-10 rounded-full bg-primary-light text-primary flex items-center justify-center btn-press font-bold"
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
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
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
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  setTime(
                    `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
                  );
                  setIsNow(true);
                }}
                className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition-all whitespace-nowrap ${
                  isNow
                    ? "bg-primary text-white shadow-button"
                    : "bg-primary-light text-primary hover:bg-primary-soft"
                }`}
              >
                刚刚 / 现在
              </button>
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
                className={`px-3 py-1 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
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
                className={`px-3 py-1 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
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

        {/* Submit */}
        <div className="pt-2">
          <CuteButton
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => handleSubmit()}
            disabled={saving}
            className="flex items-center justify-center gap-2"
          >
            <CheckCircle2 size={18} />
            {saving ? "保存中..." : "保存喂养记录"}
          </CuteButton>
        </div>
      </div>
    </div>
  );
}
