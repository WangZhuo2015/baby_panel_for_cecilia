"use client";
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { AppHeader } from '@/components/ui/AppHeader';
import { CuteButton } from '@/components/ui/CuteButton';
import { CuteInput } from '@/components/ui/CuteInput';
import { CuteTextarea } from '@/components/ui/CuteTextarea';
import { SegmentControl } from '@/components/ui/SegmentControl';
import { FormSection } from '@/components/ui/FormSection';
import { useToast } from '@/components/ui/Toast';
import { useBabyStore } from '@/stores/useBabyStore';
import type { SleepType } from '@/types';

interface SleepFormData {
  notes: string;
}

export default function SleepRecordPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const addSleepRecord = useBabyStore((s) => s.addSleepRecord);
  const { register, handleSubmit } = useForm<SleepFormData>();

  const [startTime, setStartTime] = useState('22:00');
  const [endTime, setEndTime] = useState('06:30');
  const [sleepType, setSleepType] = useState<SleepType>('night');
  const [nightWaking, setNightWaking] = useState(1);

  const duration = useMemo(() => {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    let startMins = sh * 60 + sm;
    let endMins = eh * 60 + em;
    if (endMins < startMins) endMins += 24 * 60; // next day
    const totalMins = endMins - startMins;
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    return `${h}小时${m > 0 ? `${m}分` : ''}`;
  }, [startTime, endTime]);

  const onSubmit = (data: SleepFormData) => {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const startMins = sh * 60 + sm;
    let endMins = eh * 60 + em;
    if (endMins < startMins) endMins += 24 * 60; // sleep across midnight

    const now = new Date();
    const startLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sh, sm);
    const endLocal = new Date(startLocal.getTime() + (endMins - startMins) * 60000);

    addSleepRecord({
      startTime: startLocal.toISOString(),
      endTime: endLocal.toISOString(),
      type: sleepType,
      nightWakingCount: nightWaking,
      notes: data.notes || undefined,
    });
    showToast('记录成功 ✨');
    setTimeout(() => router.push('/'), 800);
  };

  return (
    <div className="min-h-[100dvh] bg-bg">
      <AppHeader title="睡眠记录" showBack rightAction={
        <button onClick={handleSubmit(onSubmit)} className="text-sm font-medium text-primary btn-press px-2">
          保存
        </button>
      } />

      <form onSubmit={handleSubmit(onSubmit)} className="px-4 pt-4 pb-8">
        {/* Time range */}
        <FormSection title="入睡时间">
          <CuteInput type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </FormSection>

        <FormSection title="起床时间">
          <CuteInput type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </FormSection>

        {/* Duration display */}
        <div className="mx-4 mb-4 p-4 rounded-[20px] bg-lavender/10 text-center">
          <p className="text-xs text-text-secondary mb-1">总睡眠时长</p>
          <p className="text-2xl font-bold text-lavender">{duration}</p>
        </div>

        {/* Sleep type */}
        <FormSection title="类型">
          <SegmentControl
            options={[
              { value: 'night', label: '夜间睡眠' },
              { value: 'day', label: '白天小睡' },
            ]}
            value={sleepType}
            onChange={(v) => setSleepType(v as SleepType)}
          />
        </FormSection>

        {/* Night waking */}
        {sleepType === 'night' && (
          <FormSection title="夜醒次数">
            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => setNightWaking(Math.max(0, nightWaking - 1))}
                className="w-12 h-12 rounded-full bg-primary-light text-primary text-xl font-bold btn-press"
              >
                −
              </button>
              <div className="text-center min-w-[60px]">
                <span className="text-3xl font-bold text-text-primary">{nightWaking}</span>
                <span className="text-sm text-text-muted ml-1">次</span>
              </div>
              <button
                type="button"
                onClick={() => setNightWaking(nightWaking + 1)}
                className="w-12 h-12 rounded-full bg-primary-light text-primary text-xl font-bold btn-press"
              >
                +
              </button>
            </div>
          </FormSection>
        )}

        {/* Notes */}
        <FormSection title="备注">
          <CuteTextarea
            placeholder="记录睡眠情况..."
            {...register('notes')}
          />
        </FormSection>

        {/* Submit */}
        <div className="mt-8">
          <CuteButton type="submit" fullWidth size="lg">
            保存睡眠记录
          </CuteButton>
        </div>
      </form>
    </div>
  );
}
