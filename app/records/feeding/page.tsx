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
import { useToast } from '@/components/ui/Toast';
import { useBabyStore } from '@/stores/useBabyStore';
import { localTimeToUtcIso } from '@/lib/date';
import type { FeedingType } from '@/types';

interface FeedingFormData {
  notes: string;
}

const formulaAmounts = [60, 90, 120, 150, 180, 210];

export default function FeedingRecordPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const addFeedingRecord = useBabyStore((s) => s.addFeedingRecord);

  const { register, handleSubmit } = useForm<FeedingFormData>();

  const [feedingType, setFeedingType] = useState<FeedingType>('formula');
  const [amount, setAmount] = useState(120);
  const [leftMin, setLeftMin] = useState(10);
  const [rightMin, setRightMin] = useState(8);
  const [spitUp, setSpitUp] = useState(false);
  const [time, setTime] = useState(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });
  const [isNow, setIsNow] = useState(true);

  const onSubmit = (data: FeedingFormData) => {
    addFeedingRecord({
      timestamp: isNow ? new Date().toISOString() : localTimeToUtcIso(time),
      type: feedingType,
      amountMl: feedingType === 'formula' || feedingType === 'mixed' ? amount : undefined,
      leftMinutes: feedingType === 'breast' || feedingType === 'mixed' ? leftMin : undefined,
      rightMinutes: feedingType === 'breast' || feedingType === 'mixed' ? rightMin : undefined,
      spitUp,
      notes: data.notes || undefined,
    });

    showToast('记录成功 ✨');
    setTimeout(() => router.push('/'), 800);
  };

  return (
    <div className="min-h-[100dvh] bg-bg">
      <AppHeader title="喂奶记录" showBack rightAction={
        <button onClick={handleSubmit(onSubmit)} className="text-sm font-medium text-primary btn-press px-2">
          保存
        </button>
      } />

      <form onSubmit={handleSubmit(onSubmit)} className="px-4 pt-4 pb-8">
        {/* Time */}
        <FormSection title="时间">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <CuteInput
                type="time"
                value={time}
                onChange={(e) => { setTime(e.target.value); setIsNow(false); }}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                setTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
                setIsNow(true);
              }}
              className={`px-4 py-3 rounded-[18px] text-sm font-medium btn-press transition-colors ${
                isNow ? 'bg-primary text-white shadow-button' : 'bg-primary-light text-primary'
              }`}
            >
              现在
            </button>
          </div>
        </FormSection>

        {/* Type */}
        <FormSection title="类型">
          <SegmentControl
            options={[
              { value: 'breast', label: '母乳' },
              { value: 'formula', label: '配方奶' },
              { value: 'mixed', label: '混合' },
            ]}
            value={feedingType}
            onChange={(v) => setFeedingType(v as FeedingType)}
          />
        </FormSection>

        {/* Amount (formula) */}
        {(feedingType === 'formula' || feedingType === 'mixed') && (
          <FormSection title="奶量">
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className="text-5xl font-bold text-primary">{amount}</div>
              <div className="text-xl text-text-secondary ml-1">ml</div>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {formulaAmounts.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAmount(a)}
                  className={`px-4 py-2.5 rounded-2xl text-sm font-medium btn-press transition-all ${
                    amount === a
                      ? 'bg-primary text-white shadow-button scale-105'
                      : 'bg-primary-light text-primary hover:bg-primary-soft'
                  }`}
                >
                  {a}ml
                </button>
              ))}
            </div>
          </FormSection>
        )}

        {/* Duration (breast) */}
        {(feedingType === 'breast' || feedingType === 'mixed') && (
          <FormSection title="哺乳时长">
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <p className="text-xs text-text-secondary mb-2">左侧</p>
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setLeftMin(Math.max(0, leftMin - 1))}
                    className="w-10 h-10 rounded-full bg-primary-light text-primary font-bold btn-press"
                  >
                    −
                  </button>
                  <span className="text-2xl font-bold text-text-primary w-12 text-center">{leftMin}</span>
                  <button
                    type="button"
                    onClick={() => setLeftMin(leftMin + 1)}
                    className="w-10 h-10 rounded-full bg-primary-light text-primary font-bold btn-press"
                  >
                    +
                  </button>
                  <span className="text-xs text-text-muted">min</span>
                </div>
              </div>
              <div className="text-center">
                <p className="text-xs text-text-secondary mb-2">右侧</p>
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRightMin(Math.max(0, rightMin - 1))}
                    className="w-10 h-10 rounded-full bg-primary-light text-primary font-bold btn-press"
                  >
                    −
                  </button>
                  <span className="text-2xl font-bold text-text-primary w-12 text-center">{rightMin}</span>
                  <button
                    type="button"
                    onClick={() => setRightMin(rightMin + 1)}
                    className="w-10 h-10 rounded-full bg-primary-light text-primary font-bold btn-press"
                  >
                    +
                  </button>
                  <span className="text-xs text-text-muted">min</span>
                </div>
              </div>
            </div>
          </FormSection>
        )}

        {/* Spit up */}
        <FormSection title="是否吐奶">
          <div className="flex gap-3">
            {[false, true].map((val) => (
              <button
                key={String(val)}
                type="button"
                onClick={() => setSpitUp(val)}
                className={`flex-1 py-3 rounded-[18px] text-sm font-medium btn-press transition-all ${
                  spitUp === val
                    ? 'bg-primary text-white shadow-button'
                    : 'bg-primary-light text-text-secondary'
                }`}
              >
                {val ? '是' : '否'}
              </button>
            ))}
          </div>
        </FormSection>

        {/* Notes */}
        <FormSection title="备注">
          <CuteTextarea
            placeholder="记录一下特殊情况..."
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
