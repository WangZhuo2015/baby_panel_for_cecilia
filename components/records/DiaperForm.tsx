"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { CuteButton } from "@/components/ui/CuteButton";
import { CuteInput } from "@/components/ui/CuteInput";
import { CuteTextarea } from "@/components/ui/CuteTextarea";
import { SegmentControl } from "@/components/ui/SegmentControl";
import { FormSection } from "@/components/ui/FormSection";
import { QuickAiButton } from "@/components/ui/QuickAiButton";
import { VoiceConfirmEntry } from "@/components/ui/VoiceConfirmEntry";
import { localTimeToUtcIso, getLocalDateStr } from "@/lib/date";
import type { DiaperType, PoopColor, PoopConsistency, DiaperRecord } from "@/types";

const diaperTypes: { value: DiaperType; label: string; emoji: string }[] = [
  { value: "pee", label: "尿", emoji: "💧" },
  { value: "poop", label: "便便", emoji: "💩" },
  { value: "both", label: "尿 + 便", emoji: "💧💩" },
];

const poopColors: { value: PoopColor; label: string; color: string }[] = [
  { value: "yellow", label: "黄色", color: "#FFD76A" },
  { value: "green", label: "绿色", color: "#78DDB5" },
  { value: "brown", label: "棕色", color: "#A0724A" },
  { value: "other", label: "其他", color: "#B6A0A5" },
];

const poopConsistency: { value: PoopConsistency; label: string }[] = [
  { value: "loose", label: "稀" },
  { value: "paste", label: "糊状" },
  { value: "formed", label: "成形" },
];

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

export interface DiaperFormProps {
  mode?: "create" | "edit";
  initialData?: Partial<DiaperRecord> | any;
  onSubmit: (data: {
    type: DiaperType;
    poopColor?: PoopColor | null;
    poopConsistency?: PoopConsistency | null;
    notes?: string;
    timestamp: string;
  }) => Promise<void>;
  onCancel?: () => void;
  saving?: boolean;
}

export function DiaperForm({
  mode = "create",
  initialData,
  onSubmit,
  onCancel,
  saving = false,
}: DiaperFormProps) {
  const isEdit = mode === "edit";

  const [diaperType, setDiaperType] = useState<DiaperType>(() => {
    return (initialData?.type as DiaperType) || "pee";
  });

  const [selectedColor, setSelectedColor] = useState<PoopColor>(() => {
    return (initialData?.poopColor as PoopColor) || "yellow";
  });

  const [selectedConsistency, setSelectedConsistency] = useState<PoopConsistency>(() => {
    return (initialData?.poopConsistency as PoopConsistency) || "paste";
  });

  const [notes, setNotes] = useState<string>(() => {
    return initialData?.notes || "";
  });

  const [time, setTime] = useState<string>(() => {
    if (initialData?.timestamp) {
      const hhmm = isoToLocalHHMM(initialData.timestamp);
      if (hhmm) return hhmm;
    }
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  });

  const showPoopFields = diaperType === "poop" || diaperType === "both";

  const handleFormSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    let timestamp: string;
    if (isEdit && initialData?.timestamp) {
      const origDateStr = getLocalDateStr(new Date(initialData.timestamp));
      timestamp = new Date(`${origDateStr}T${time}:00+08:00`).toISOString();
    } else {
      timestamp = localTimeToUtcIso(time);
    }

    await onSubmit({
      type: diaperType,
      poopColor: showPoopFields ? selectedColor : null,
      poopConsistency: showPoopFields ? selectedConsistency : null,
      notes: notes.trim() || undefined,
      timestamp,
    });
  };

  return (
    <form onSubmit={handleFormSubmit} className="space-y-4">
      {/* Quick AI Advisor & Voice (Create Mode Only) */}
      {!isEdit && (
        <>
          <div className="flex items-center justify-between bg-white/70 px-3.5 py-2.5 rounded-2xl border border-primary/20 shadow-2xs">
            <div className="flex items-center gap-2">
              <span className="text-base">💩</span>
              <span className="text-xs font-medium text-text-primary">便便颜色质地或红屁屁疑问？</span>
            </div>
            <QuickAiButton
              contextType="diaper"
              label="排便顾问"
              contextTitle="排便与臀部护理顾问"
              variant="compact"
            />
          </div>
          <VoiceConfirmEntry contextType="diaper" />
        </>
      )}

      {/* Time */}
      <FormSection title="记录时间">
        <CuteInput type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </FormSection>

      {/* Diaper type - visual cards */}
      <FormSection title="尿布类型">
        <div className="grid grid-cols-3 gap-3">
          {diaperTypes.map((dt) => (
            <button
              key={dt.value}
              type="button"
              onClick={() => setDiaperType(dt.value)}
              className={`flex flex-col items-center justify-center py-5 rounded-[20px] transition-all btn-press ${
                diaperType === dt.value
                  ? "bg-primary text-white shadow-button scale-[1.02]"
                  : "bg-primary-light text-text-primary hover:bg-primary-soft"
              }`}
            >
              <span className="text-3xl mb-1.5">{dt.emoji}</span>
              <span className="text-sm font-medium">{dt.label}</span>
            </button>
          ))}
        </div>
      </FormSection>

      {/* Poop color & consistency */}
      {showPoopFields && (
        <>
          <FormSection title="便便颜色">
            <div className="grid grid-cols-4 gap-2.5">
              {poopColors.map((pc) => (
                <button
                  key={pc.value}
                  type="button"
                  onClick={() => setSelectedColor(pc.value)}
                  className={`flex flex-col items-center py-3 rounded-[16px] transition-all btn-press ${
                    selectedColor === pc.value
                      ? "ring-2 ring-primary bg-white shadow-soft"
                      : "bg-primary-light/50 hover:bg-primary-light"
                  }`}
                >
                  <div
                    className="w-8 h-8 rounded-full mb-1.5 shadow-2xs"
                    style={{ backgroundColor: pc.color }}
                  />
                  <span className="text-xs text-text-secondary font-medium">{pc.label}</span>
                </button>
              ))}
            </div>
          </FormSection>

          <FormSection title="便便性状">
            <SegmentControl
              options={poopConsistency.map((c) => ({ value: c.value, label: c.label }))}
              value={selectedConsistency}
              onChange={(v) => setSelectedConsistency(v as PoopConsistency)}
            />
          </FormSection>
        </>
      )}

      {/* Notes */}
      <FormSection title="备注说明（可选）">
        <CuteTextarea
          placeholder="记录一下宝宝臀部情况或特殊细节..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />
      </FormSection>

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
          type="submit"
          fullWidth={!isEdit}
          size="lg"
          disabled={saving}
          className={`flex items-center justify-center gap-2 ${isEdit ? "flex-1" : ""}`}
        >
          <CheckCircle2 size={18} />
          {saving ? "保存中..." : isEdit ? "保存修改" : "保存记录"}
        </CuteButton>
      </div>
    </form>
  );
}
