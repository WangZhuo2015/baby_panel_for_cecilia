"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { AppHeader } from '@/components/ui/AppHeader';
import { CuteButton } from '@/components/ui/CuteButton';
import { CuteInput } from '@/components/ui/CuteInput';
import { CuteTextarea } from '@/components/ui/CuteTextarea';
import { SegmentControl } from '@/components/ui/SegmentControl';
import { FormSection } from '@/components/ui/FormSection';
import { QuickAiButton } from '@/components/ui/QuickAiButton';
import { useToast } from '@/components/ui/Toast';
import { useBabyStore } from '@/stores/useBabyStore';
import { localTimeToUtcIso } from '@/lib/date';
import type { DiaperType, PoopColor, PoopConsistency } from '@/types';

interface DiaperFormData {
  notes: string;
}

const diaperTypes: { value: DiaperType; label: string; emoji: string }[] = [
  { value: 'pee', label: '尿', emoji: '💧' },
  { value: 'poop', label: '便便', emoji: '💩' },
  { value: 'both', label: '尿 + 便', emoji: '💧💩' },
];

const poopColors: { value: PoopColor; label: string; color: string }[] = [
  { value: 'yellow', label: '黄色', color: '#FFD76A' },
  { value: 'green', label: '绿色', color: '#78DDB5' },
  { value: 'brown', label: '棕色', color: '#A0724A' },
  { value: 'other', label: '其他', color: '#B6A0A5' },
];

const poopConsistency: { value: PoopConsistency; label: string }[] = [
  { value: 'loose', label: '稀' },
  { value: 'paste', label: '糊状' },
  { value: 'formed', label: '成形' },
];

export default function DiaperRecordPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const addDiaperRecord = useBabyStore((s) => s.addDiaperRecord);
  const { register, handleSubmit } = useForm<DiaperFormData>();

  const [diaperType, setDiaperType] = useState<DiaperType>('pee');
  const [selectedColor, setSelectedColor] = useState<PoopColor>('yellow');
  const [selectedConsistency, setSelectedConsistency] = useState<PoopConsistency>('paste');
  const [time, setTime] = useState(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });

  const showPoopFields = diaperType === 'poop' || diaperType === 'both';

  const onSubmit = (data: DiaperFormData) => {
    addDiaperRecord({
      timestamp: localTimeToUtcIso(time),
      type: diaperType,
      poopColor: showPoopFields ? selectedColor : undefined,
      poopConsistency: showPoopFields ? selectedConsistency : undefined,
      notes: data.notes || undefined,
    });
    showToast('记录成功 ✨');
    setTimeout(() => router.push('/'), 800);
  };

  return (
    <div className="min-h-[100dvh] bg-bg">
      <AppHeader title="尿布记录" showBack rightAction={
        <button onClick={handleSubmit(onSubmit)} className="text-sm font-medium text-primary btn-press px-2">
          保存
        </button>
      } />

      <form onSubmit={handleSubmit(onSubmit)} className="px-4 pt-3 pb-8 space-y-4">
        {/* Quick AI Advisor */}
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

        {/* Time */}
        <FormSection title="记录时间">
          <CuteInput type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </FormSection>

        {/* Diaper type - large visual cards */}
        <FormSection title="尿布类型">
          <div className="grid grid-cols-3 gap-3">
            {diaperTypes.map((dt) => (
              <button
                key={dt.value}
                type="button"
                onClick={() => setDiaperType(dt.value)}
                className={`flex flex-col items-center justify-center py-5 rounded-[20px] transition-all btn-press ${
                  diaperType === dt.value
                    ? 'bg-primary text-white shadow-button scale-[1.02]'
                    : 'bg-primary-light text-text-primary'
                }`}
              >
                <span className="text-3xl mb-1.5">{dt.emoji}</span>
                <span className="text-sm font-medium">{dt.label}</span>
              </button>
            ))}
          </div>
        </FormSection>

        {/* Poop color */}
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
                        ? 'ring-2 ring-primary bg-white shadow-soft'
                        : 'bg-primary-light/50'
                    }`}
                  >
                    <div
                      className="w-8 h-8 rounded-full mb-1.5"
                      style={{ backgroundColor: pc.color }}
                    />
                    <span className="text-xs text-text-secondary">{pc.label}</span>
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
        <FormSection title="备注">
          <CuteTextarea
            placeholder="记录一下..."
            {...register('notes')}
          />
        </FormSection>

        {/* Submit */}
        <div className="mt-8">
          <CuteButton type="submit" fullWidth size="lg">
            保存记录
          </CuteButton>
        </div>
      </form>
    </div>
  );
}
