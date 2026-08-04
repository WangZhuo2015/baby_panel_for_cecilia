"use client";
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppHeader } from '@/components/ui/AppHeader';
import { CuteButton } from '@/components/ui/CuteButton';
import { CuteInput } from '@/components/ui/CuteInput';
import { CuteTextarea } from '@/components/ui/CuteTextarea';
import { FormSection } from '@/components/ui/FormSection';
import { HeartRating } from '@/components/ui/HeartRating';
import { useToast } from '@/components/ui/Toast';
import { useBabyStore } from '@/stores/useBabyStore';
import { getLocalDateStr } from '@/lib/date';
import type { FoodLogRecord } from '@/types';

export default function FoodLogPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const addFoodLogRecord = useBabyStore((s) => s.addFoodLogRecord);
  const foodItems = useBabyStore((s) => s.foodItems) ?? [];
  const fetchFoodItems = useBabyStore((s) => s.fetchFoodItems);

  useEffect(() => {
    fetchFoodItems('tried');
  }, [fetchFoodItems]);

  // Get tried foods for chip buttons
  const triedFoods = foodItems.filter((item) => item.status === 'tried');

  // Form state
  const [date, setDate] = useState(getLocalDateStr());
  const [time, setTime] = useState(
    new Date().toTimeString().slice(0, 5)
  );
  const [selectedFoods, setSelectedFoods] = useState<string[]>([]);
  const [portion, setPortion] = useState<FoodLogRecord['portion']>('most');
  const [acceptance, setAcceptance] = useState(3);
  const [babyState, setBabyState] = useState<FoodLogRecord['babyState']>('happy');
  const [hasAbnormal, setHasAbnormal] = useState(false);
  const [abnormalNotes, setAbnormalNotes] = useState('');

  const handleFoodToggle = (foodName: string) => {
    setSelectedFoods((prev) =>
      prev.includes(foodName)
        ? prev.filter((f) => f !== foodName)
        : [...prev, foodName]
    );
  };

  const handleAddCustomFood = () => {
    showToast('功能开发中');
  };

  const handleSubmit = () => {
    if (selectedFoods.length === 0) {
      showToast('请至少选择一种食材');
      return;
    }

    addFoodLogRecord({
      date,
      time,
      foods: selectedFoods,
      portion,
      acceptance,
      babyState,
      hasAbnormal,
      abnormalNotes: hasAbnormal ? abnormalNotes : undefined,
    });

    showToast('记录成功 ✨');
    setTimeout(() => router.push('/food'), 800);
  };

  const portionOptions = [
    { value: 'little' as const, label: '少量' },
    { value: 'half' as const, label: '半碗' },
    { value: 'most' as const, label: '大部分' },
    { value: 'all' as const, label: '全部' },
  ];

  const stateOptions = [
    { value: 'happy' as const, emoji: '😊', label: '开心' },
    { value: 'neutral' as const, emoji: '😐', label: '一般' },
    { value: 'rejected' as const, emoji: '😣', label: '拒绝' },
  ];

  return (
    <div className="min-h-[100dvh] bg-bg pb-8">
      <AppHeader title="辅食记录" showBack />

      <div className="px-4 pt-4">
        {/* Date and time */}
        <FormSection title="时间">
          <div className="flex gap-3">
            <div className="flex-1">
              <CuteInput
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="flex-1">
              <CuteInput
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>
        </FormSection>

        {/* Food selection */}
        <FormSection title="宝宝吃了什么？">
          <div className="flex flex-wrap gap-2">
            {triedFoods.map((food) => {
              const isSelected = selectedFoods.includes(food.name);
              return (
                <button
                  key={food.id}
                  type="button"
                  onClick={() => handleFoodToggle(food.name)}
                  className={`btn-press px-4 py-2 rounded-full text-sm font-medium transition-all ${
                    isSelected
                      ? 'bg-primary text-white shadow-button'
                      : 'bg-primary-light/50 text-text-primary'
                  }`}
                >
                  {food.icon} {food.name}
                </button>
              );
            })}
            <button
              type="button"
              onClick={handleAddCustomFood}
              className="btn-press px-4 py-2 rounded-full text-sm font-medium bg-primary-light/30 text-primary border-2 border-dashed border-primary/30"
            >
              + 添加食材
            </button>
          </div>
        </FormSection>

        {/* Portion */}
        <FormSection title="吃了多少？">
          <div className="grid grid-cols-2 gap-2">
            {portionOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPortion(opt.value)}
                className={`btn-press py-3 rounded-2xl text-sm font-medium transition-all ${
                  portion === opt.value
                    ? 'bg-primary text-white shadow-button'
                    : 'bg-card text-text-secondary'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </FormSection>

        {/* Acceptance rating */}
        <FormSection title="宝宝喜欢程度">
          <div className="flex justify-center py-2">
            <HeartRating value={acceptance} onChange={setAcceptance} size={28} />
          </div>
        </FormSection>

        {/* Baby state */}
        <FormSection title="宝宝状态">
          <div className="flex gap-3">
            {stateOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setBabyState(opt.value)}
                className={`btn-press flex-1 flex flex-col items-center gap-1.5 py-4 rounded-2xl transition-all ${
                  babyState === opt.value
                    ? 'bg-primary text-white shadow-button'
                    : 'bg-card text-text-secondary'
                }`}
              >
                <span className="text-3xl">{opt.emoji}</span>
                <span className="text-xs font-medium">{opt.label}</span>
              </button>
            ))}
          </div>
        </FormSection>

        {/* Abnormal toggle */}
        <FormSection title="是否有明显异常">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setHasAbnormal(false)}
              className={`btn-press flex-1 py-3 rounded-2xl text-sm font-medium transition-all ${
                !hasAbnormal
                  ? 'bg-primary text-white shadow-button'
                  : 'bg-card text-text-secondary'
              }`}
            >
              没有
            </button>
            <button
              type="button"
              onClick={() => setHasAbnormal(true)}
              className={`btn-press flex-1 py-3 rounded-2xl text-sm font-medium transition-all ${
                hasAbnormal
                  ? 'bg-primary text-white shadow-button'
                  : 'bg-card text-text-secondary'
              }`}
            >
              有
            </button>
          </div>

          {hasAbnormal && (
            <div className="mt-3">
              <CuteTextarea
                placeholder="请描述异常情况..."
                value={abnormalNotes}
                onChange={(e) => setAbnormalNotes(e.target.value)}
              />
            </div>
          )}
        </FormSection>

        {/* Submit */}
        <div className="mt-8">
          <CuteButton fullWidth size="lg" onClick={handleSubmit}>
            保存记录
          </CuteButton>
        </div>
      </div>
    </div>
  );
}
