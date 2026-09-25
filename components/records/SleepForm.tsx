"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Moon,
  Sun,
  CheckCircle2,
  Minus,
  Plus,
  Clock,
  Edit3,
} from "lucide-react";
import { CuteButton } from "@/components/ui/CuteButton";
import { CuteInput } from "@/components/ui/CuteInput";
import { CuteCard } from "@/components/ui/CuteCard";
import { FormSection } from "@/components/ui/FormSection";
import { SegmentControl } from "@/components/ui/SegmentControl";
import { QuickAiButton } from "@/components/ui/QuickAiButton";
import { VoiceConfirmEntry } from "@/components/ui/VoiceConfirmEntry";
import { getLocalDateStr, formatIsoToLocalTime, getLocalTimeStr } from "@/lib/date";
import {
  getPastIsoTime,
  resolvePastStartTime,
  adjustLiveStartTime,
  formatElapsedDuration,
} from "@/lib/sleep-timer";
import type { SleepType, SleepRecord } from "@/types";

const ASLEEP_METHODS = [
  { id: "self", label: "自主入睡 🌟" },
  { id: "nursing", label: "奶睡 🍼" },
  { id: "holding", label: "抱哄入睡 🤱" },
  { id: "rocking", label: "轻拍摇晃 🛋️" },
  { id: "stroller", label: "推车/出行 🛒" },
];

const WAKE_MOODS = [
  { id: "happy", label: "开心笑 😊", color: "text-amber-500 bg-amber-50 border-amber-200" },
  { id: "calm", label: "平静正常 👶", color: "text-blue-500 bg-blue-50 border-blue-200" },
  { id: "crying", label: "哭闹烦躁 😭", color: "text-red-500 bg-red-50 border-red-200" },
];

function LiveSleepDuration({ startIso }: { startIso: string }) {
  const [text, setText] = useState(() => formatElapsedDuration(startIso).text);
  useEffect(() => {
    const tick = () => setText(formatElapsedDuration(startIso).text);
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [startIso]);

  return <>{text}</>;
}

export interface SleepFormProps {
  mode?: "create" | "edit";
  initialData?: Partial<SleepRecord> | any;
  onSubmit: (data: {
    startTime: string;
    endTime: string;
    type: SleepType;
    nightWakingCount: number;
    notes?: string;
    date?: string;
  }) => Promise<void>;
  onCancel?: () => void;
  saving?: boolean;
}

export function SleepForm({
  mode = "create",
  initialData,
  onSubmit,
  onCancel,
  saving = false,
}: SleepFormProps) {
  const isEdit = mode === "edit";

  // Live Timer State (persisted in localStorage, only for create mode)
  const [isLiveSleeping, setIsLiveSleeping] = useState(false);
  const [liveStartTime, setLiveStartTime] = useState<string | null>(null);
  const [isCustomTimeOpen, setIsCustomTimeOpen] = useState(false);
  const [customStartTime, setCustomStartTime] = useState<string>(() => getLocalTimeStr());
  const [isEditingLiveStart, setIsEditingLiveStart] = useState(false);
  const [liveEditTime, setLiveEditTime] = useState<string>("");

  // Manual Form State
  const [date, setDate] = useState<string>(() => {
    if (initialData?.startTime) {
      return getLocalDateStr(new Date(initialData.startTime));
    }
    return getLocalDateStr();
  });

  const [startTime, setStartTime] = useState<string>(() => {
    if (initialData?.startTime) {
      return formatIsoToLocalTime(initialData.startTime);
    }
    return "21:30";
  });

  const [endTime, setEndTime] = useState<string>(() => {
    if (initialData?.endTime) {
      return formatIsoToLocalTime(initialData.endTime);
    }
    return "07:00";
  });

  const [sleepType, setSleepType] = useState<SleepType>(() => {
    const rawType = initialData?.type ?? initialData?.sleepType;
    if (rawType === "nap" || rawType === "day") return "day";
    return "night";
  });

  const [nightWaking, setNightWaking] = useState<number>(() => {
    return typeof initialData?.nightWakingCount === "number" ? initialData.nightWakingCount : 0;
  });

  const [fallingAsleepMethod, setFallingAsleepMethod] = useState<string>(() => {
    if (initialData?.notes) {
      const match = ASLEEP_METHODS.find((m) => initialData.notes.includes(m.label));
      if (match) return match.id;
    }
    return "self";
  });

  const [wakeUpMood, setWakeUpMood] = useState<string>(() => {
    if (initialData?.notes) {
      const match = WAKE_MOODS.find((m) => initialData.notes.includes(m.label));
      if (match) return match.id;
    }
    return "happy";
  });

  const [notes, setNotes] = useState<string>(() => {
    if (!initialData?.notes) return "";
    let clean = initialData.notes;
    for (const m of ASLEEP_METHODS) clean = clean.replace(m.label, "");
    for (const m of WAKE_MOODS) clean = clean.replace(m.label, "");
    return clean.replace(/^[ ·|]+|[ ·|]+$/g, "").trim();
  });

  const dispatchSleepTimerUpdate = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("baby:sleep-timer-updated"));
    }
  };

  // Load and continuously sync live sleep session from localStorage (and on events)
  useEffect(() => {
    if (isEdit) return;
    const syncFromStorage = () => {
      try {
        const storedStart = localStorage.getItem("baby_active_sleep_start");
        const storedType = localStorage.getItem("baby_active_sleep_type");
        if (storedStart && !Number.isNaN(new Date(storedStart).getTime())) {
          setIsLiveSleeping(true);
          setLiveStartTime(storedStart);
          if (storedType) {
            setSleepType(storedType === "nap" || storedType === "day" ? "day" : "night");
          }
        } else {
          setIsLiveSleeping(false);
          setLiveStartTime(null);
        }
      } catch {
        // Ignore
      }
    };
    syncFromStorage();
    window.addEventListener("baby:sleep-timer-updated", syncFromStorage);
    window.addEventListener("storage", syncFromStorage);
    return () => {
      window.removeEventListener("baby:sleep-timer-updated", syncFromStorage);
      window.removeEventListener("storage", syncFromStorage);
    };
  }, [isEdit]);

  const handleStartLiveSleep = (customIso?: string) => {
    const isoStart = customIso || new Date().toISOString();
    setIsLiveSleeping(true);
    setLiveStartTime(isoStart);
    setIsCustomTimeOpen(false);
    setIsEditingLiveStart(false);
    try {
      localStorage.setItem("baby_active_sleep_start", isoStart);
      localStorage.setItem("baby_active_sleep_type", sleepType);
      dispatchSleepTimerUpdate();
    } catch {
      // Ignore
    }
  };

  const handleStartWithCustomTime = () => {
    const resolvedIso = resolvePastStartTime(customStartTime);
    handleStartLiveSleep(resolvedIso);
  };

  const handleToggleLiveSleepType = (newType: SleepType) => {
    setSleepType(newType);
    try {
      localStorage.setItem("baby_active_sleep_type", newType);
      dispatchSleepTimerUpdate();
    } catch {
      // Ignore
    }
  };

  const handleAdjustLiveStartByDelta = (deltaMinutes: number) => {
    if (!liveStartTime) return;
    const newIso = adjustLiveStartTime(liveStartTime, deltaMinutes);
    setLiveStartTime(newIso);
    setLiveEditTime(formatIsoToLocalTime(newIso));
    try {
      localStorage.setItem("baby_active_sleep_start", newIso);
      dispatchSleepTimerUpdate();
    } catch {
      // Ignore
    }
  };

  const handleSaveLiveEditTime = () => {
    if (!liveEditTime) return;
    const resolvedIso = resolvePastStartTime(liveEditTime);
    setLiveStartTime(resolvedIso);
    setIsEditingLiveStart(false);
    try {
      localStorage.setItem("baby_active_sleep_start", resolvedIso);
      dispatchSleepTimerUpdate();
    } catch {
      // Ignore
    }
  };

  const handleWakeUpLiveSleep = () => {
    if (!liveStartTime) return;
    const now = new Date();
    const start = new Date(liveStartTime);

    setStartTime(
      `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`
    );
    setEndTime(
      `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
    );
    setDate(getLocalDateStr(start));

    setIsLiveSleeping(false);
    setLiveStartTime(null);
    setIsEditingLiveStart(false);
    try {
      localStorage.removeItem("baby_active_sleep_start");
      localStorage.removeItem("baby_active_sleep_type");
      dispatchSleepTimerUpdate();
    } catch {
      // Ignore
    }
  };

  const handleCancelLiveSleep = () => {
    if (!confirm("确定要放弃本次实时睡眠计时吗？")) return;
    setIsLiveSleeping(false);
    setLiveStartTime(null);
    setIsEditingLiveStart(false);
    try {
      localStorage.removeItem("baby_active_sleep_start");
      localStorage.removeItem("baby_active_sleep_type");
      dispatchSleepTimerUpdate();
    } catch {
      // Ignore
    }
  };

  // Duration calculation for manual form
  const durationText = useMemo(() => {
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return "--";
    let startMins = sh * 60 + sm;
    let endMins = eh * 60 + em;
    if (endMins < startMins) endMins += 24 * 60;
    const totalMins = endMins - startMins;
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    return `${h > 0 ? `${h}小时` : ""}${m > 0 ? `${m}分钟` : h === 0 ? "0分钟" : ""}`;
  }, [startTime, endTime]);

  const handleFormSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const startLocal = new Date(`${date}T${startTime.padStart(5, "0")}:00+08:00`);
    let endLocal = new Date(`${date}T${endTime.padStart(5, "0")}:00+08:00`);
    if (endLocal.getTime() <= startLocal.getTime()) {
      endLocal = new Date(endLocal.getTime() + 24 * 60 * 60 * 1000); // Cross midnight
    }

    let finalNotes = notes.trim();
    const methodLabel = ASLEEP_METHODS.find((m) => m.id === fallingAsleepMethod)?.label;
    const moodLabel = WAKE_MOODS.find((m) => m.id === wakeUpMood)?.label;

    const tagStrings = [methodLabel, moodLabel].filter(Boolean);
    if (tagStrings.length > 0) {
      finalNotes = finalNotes ? `${tagStrings.join(" · ")} | ${finalNotes}` : tagStrings.join(" · ");
    }

    await onSubmit({
      startTime: startLocal.toISOString(),
      endTime: endLocal.toISOString(),
      type: sleepType,
      nightWakingCount: nightWaking,
      notes: finalNotes || undefined,
      date,
    });
  };

  return (
    <div className="space-y-4">
      {/* Quick AI Advisor & Voice (Create Mode Only) */}
      {!isEdit && (
        <>
          <div className="flex items-center justify-between bg-white dark:bg-card px-3.5 py-2.5 rounded-2xl border border-primary/20 shadow-2xs">
            <div className="flex items-center gap-2">
              <span className="text-base">😴</span>
              <span className="text-xs font-medium text-text-primary">接觉短睡、落地醒或作息疑问？</span>
            </div>
            <QuickAiButton
              contextType="sleep"
              label="睡眠顾问"
              contextTitle="睡眠与作息规律顾问"
              variant="compact"
            />
          </div>
          <VoiceConfirmEntry contextType="sleep" />
        </>
      )}

      {/* 🌙 实时入睡快捷卡片 (Create Mode Only) */}
      {!isEdit && (
        <CuteCard className="p-4 bg-gradient-to-br from-indigo-900 via-purple-900 to-indigo-950 text-white shadow-xl relative overflow-hidden border-0">
          <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-purple-500/20 blur-2xl pointer-events-none" />
          <div className="absolute -bottom-10 -left-10 w-36 h-36 rounded-full bg-indigo-500/20 blur-2xl pointer-events-none" />

          {isLiveSleeping ? (
            <div className="relative text-center py-1 space-y-3">
              {/* Header: Status badge & Sleep type switch */}
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 text-purple-200 text-xs font-medium backdrop-blur-md animate-pulse">
                  <Moon size={13} className="text-yellow-300" />
                  宝宝正在香甜睡眠中...
                </div>
                <div className="flex items-center bg-black/30 p-0.5 rounded-xl text-[11px] border border-white/10">
                  <button
                    type="button"
                    onClick={() => handleToggleLiveSleepType("night")}
                    className={`px-2.5 py-1 rounded-lg transition-all ${
                      sleepType === "night"
                        ? "bg-purple-600 text-white font-bold shadow-xs"
                        : "text-purple-200/80 hover:text-white"
                    }`}
                  >
                    🌙 夜觉
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleLiveSleepType("day")}
                    className={`px-2.5 py-1 rounded-lg transition-all ${
                      sleepType === "day"
                        ? "bg-purple-600 text-white font-bold shadow-xs"
                        : "text-purple-200/80 hover:text-white"
                    }`}
                  >
                    💤 小睡
                  </button>
                </div>
              </div>

              {/* Timer Duration */}
              <div className="py-1">
                <div className="text-3xl font-mono font-bold text-white tracking-wider">
                  {liveStartTime ? <LiveSleepDuration startIso={liveStartTime} /> : null}
                </div>
                <div className="flex items-center justify-center gap-1.5 mt-1.5">
                  <span className="text-xs text-purple-200/90">
                    入睡时间：{liveStartTime ? formatIsoToLocalTime(liveStartTime) : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!isEditingLiveStart && liveStartTime) {
                        setLiveEditTime(formatIsoToLocalTime(liveStartTime));
                      }
                      setIsEditingLiveStart(!isEditingLiveStart);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/15 hover:bg-white/25 text-[11px] text-yellow-300 font-medium transition-colors"
                  >
                    <Edit3 size={11} />
                    {isEditingLiveStart ? "收起" : "修改"}
                  </button>
                </div>
              </div>

              {/* In-flight Start Time Editor */}
              {isEditingLiveStart && (
                <div className="p-3 bg-black/40 backdrop-blur-md rounded-2xl border border-white/15 text-left space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-purple-200">
                    <span className="font-semibold flex items-center gap-1 text-white">
                      <Clock size={12} className="text-yellow-300" />
                      调整入睡开始时间
                    </span>
                    <span className="text-[10px] text-purple-300/80">
                      （时长将自动更新）
                    </span>
                  </div>

                  {/* Quick delta buttons */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-purple-300 shrink-0">微调:</span>
                    <div className="grid grid-cols-4 gap-1.5 flex-1">
                      {[
                        { label: "提前30分", val: -30 },
                        { label: "提前15分", val: -15 },
                        { label: "提前5分", val: -5 },
                        { label: "延后15分", val: 15 },
                      ].map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => handleAdjustLiveStartByDelta(item.val)}
                          className="py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs text-white font-medium text-center transition-colors btn-press border border-white/5 whitespace-nowrap"
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Exact Time Input & Confirm */}
                  <div className="flex items-center gap-2 pt-1 border-t border-white/10">
                    <input
                      type="time"
                      value={liveEditTime}
                      onChange={(e) => setLiveEditTime(e.target.value)}
                      className="bg-white/10 text-white border border-white/20 rounded-xl px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-yellow-300"
                    />
                    <button
                      type="button"
                      onClick={handleSaveLiveEditTime}
                      className="px-3 py-1.5 rounded-xl bg-yellow-400 text-purple-950 font-bold text-xs hover:bg-yellow-300 transition-colors btn-press"
                    >
                      确定保存
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditingLiveStart(false)}
                      className="px-2.5 py-1.5 rounded-xl bg-white/10 text-purple-200 text-xs hover:bg-white/20 transition-colors"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}

              {/* Settle / Cancel Actions */}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleWakeUpLiveSleep}
                  className="flex-1 py-3 rounded-2xl bg-yellow-400 text-purple-950 font-bold text-sm shadow-lg hover:bg-yellow-300 btn-press flex items-center justify-center gap-1.5"
                >
                  <Sun size={17} className="text-purple-950" />
                  宝宝醒了 (结算记录)
                </button>
                <button
                  type="button"
                  onClick={handleCancelLiveSleep}
                  className="px-3 py-3 rounded-2xl bg-white/10 text-white/70 text-xs hover:bg-white/20 transition-colors"
                >
                  放弃本次
                </button>
              </div>
            </div>
          ) : (
            // NOT live sleeping
            <div className="relative py-1 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Moon size={16} className="text-yellow-300" />
                    宝宝准备入睡了吗？
                  </h3>
                  <p className="text-xs text-purple-200/80 mt-0.5">
                    一键实时计时，或从之前入睡时刻开始
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleStartLiveSleep()}
                  className="px-3.5 py-2 rounded-2xl bg-yellow-400 text-purple-950 font-bold text-xs shadow-md hover:bg-yellow-300 btn-press whitespace-nowrap shrink-0 flex items-center gap-1"
                >
                  <Moon size={13} />
                  <span>现在开始计时</span>
                </button>
              </div>

              {/* Past Presets & Custom Time Trigger */}
              <div className="pt-2 border-t border-white/10">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] text-purple-200 font-medium flex items-center gap-1">
                    <Clock size={12} className="text-yellow-300" />
                    已提前入睡？直接倒推开始：
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!isCustomTimeOpen) {
                        setCustomStartTime(getLocalTimeStr());
                      }
                      setIsCustomTimeOpen(!isCustomTimeOpen);
                    }}
                    className="text-[11px] text-yellow-300 hover:text-yellow-200 font-medium underline underline-offset-2 transition-colors"
                  >
                    {isCustomTimeOpen ? "收起" : "指定时刻..."}
                  </button>
                </div>

                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    { label: "5分前", mins: 5 },
                    { label: "10分前", mins: 10 },
                    { label: "15分前", mins: 15 },
                    { label: "30分前", mins: 30 },
                  ].map((p) => (
                    <button
                      key={p.mins}
                      type="button"
                      onClick={() => handleStartLiveSleep(getPastIsoTime(p.mins))}
                      className="py-1.5 px-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs text-purple-100 font-medium text-center transition-all btn-press border border-white/10"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {/* Custom Time Picker Expandable */}
                {isCustomTimeOpen && (
                  <div className="mt-2.5 p-3 bg-black/40 backdrop-blur-md rounded-2xl border border-white/15 flex items-center gap-2">
                    <span className="text-xs text-purple-200 shrink-0">入睡时间:</span>
                    <input
                      type="time"
                      value={customStartTime}
                      onChange={(e) => setCustomStartTime(e.target.value)}
                      className="bg-white/10 text-white border border-white/20 rounded-xl px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-yellow-300"
                    />
                    <button
                      type="button"
                      onClick={handleStartWithCustomTime}
                      className="flex-1 py-1.5 rounded-xl bg-yellow-400 text-purple-950 font-bold text-xs hover:bg-yellow-300 transition-colors whitespace-nowrap btn-press"
                    >
                      从该时刻开始计时
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </CuteCard>
      )}

      {/* 睡眠类型与时长统计 */}
      <CuteCard className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider">
            睡眠类型
          </h3>
          <span className="text-xs font-bold text-primary bg-primary-soft px-2.5 py-1 rounded-full">
            总时长：{durationText}
          </span>
        </div>

        <SegmentControl
          options={[
            { value: "night", label: "🌙 夜间长觉" },
            { value: "day", label: "💤 白天小睡" },
          ]}
          value={sleepType}
          onChange={(v) => setSleepType(v as SleepType)}
        />

        <div className="grid grid-cols-2 gap-3 pt-2">
          <FormSection title="入睡时间">
            <CuteInput
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </FormSection>

          <FormSection title="醒来时间">
            <CuteInput
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </FormSection>
        </div>

        <FormSection title="睡眠日期">
          <CuteInput
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </FormSection>
      </CuteCard>

      {/* 夜醒次数 (仅夜觉) */}
      {sleepType === "night" && (
        <CuteCard className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-text-primary block">
                👶 夜醒次数
              </h3>
              <p className="text-[10px] text-text-muted">记录宝宝半夜醒来喝奶或哭闹次数</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setNightWaking(Math.max(0, nightWaking - 1))}
                className="w-8 h-8 rounded-full bg-primary-light text-primary flex items-center justify-center font-bold text-sm btn-press hover:bg-primary/20"
              >
                <Minus size={14} />
              </button>
              <span className="text-sm font-extrabold text-primary w-8 text-center">
                {nightWaking}次
              </span>
              <button
                type="button"
                onClick={() => setNightWaking(nightWaking + 1)}
                className="w-8 h-8 rounded-full bg-primary-light text-primary flex items-center justify-center font-bold text-sm btn-press hover:bg-primary/20"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* Quick Chips */}
          <div className="flex gap-2 pt-1">
            {[
              { val: 0, label: "0次 (整觉)" },
              { val: 1, label: "1次" },
              { val: 2, label: "2次" },
              { val: 3, label: "3次+" },
            ].map((c) => (
              <button
                key={c.val}
                type="button"
                onClick={() => setNightWaking(c.val)}
                className={`flex-1 py-1.5 rounded-xl text-xs font-medium transition-all whitespace-nowrap btn-press ${
                  nightWaking === c.val
                    ? "bg-primary text-white font-bold shadow-soft"
                    : "bg-gray-100 text-text-secondary hover:bg-gray-200"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </CuteCard>
      )}

      {/* 哄睡方式与醒来状态 */}
      <CuteCard className="p-4 space-y-3">
        <div>
          <span className="text-xs font-semibold text-text-secondary block mb-1.5">
            🛏️ 入睡方式
          </span>
          <div className="flex flex-wrap gap-1.5">
            {ASLEEP_METHODS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setFallingAsleepMethod(m.id)}
                className={`px-3 py-1.5 rounded-xl text-xs transition-all whitespace-nowrap btn-press ${
                  fallingAsleepMethod === m.id
                    ? "bg-primary text-white font-bold shadow-sm"
                    : "bg-gray-100 text-text-secondary hover:bg-gray-200"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t border-divider/60">
          <span className="text-xs font-semibold text-text-secondary block mb-1.5">
            ☀️ 醒来情绪
          </span>
          <div className="grid grid-cols-3 gap-2">
            {WAKE_MOODS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setWakeUpMood(m.id)}
                className={`py-2 rounded-xl text-xs border text-center transition-all whitespace-nowrap btn-press ${
                  wakeUpMood === m.id
                    ? `${m.color} font-bold shadow-sm ring-2 ring-primary/20`
                    : "bg-white text-text-secondary border-divider hover:bg-gray-50"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <FormSection title="备注说明（可选）">
          <CuteInput
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="如：哄睡顺畅 / 易惊醒 / 换了睡袋"
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
          {saving ? "保存中..." : isEdit ? "保存修改" : "保存睡眠记录"}
        </CuteButton>
      </div>
    </div>
  );
}
