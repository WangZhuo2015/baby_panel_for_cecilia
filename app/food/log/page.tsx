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

const FOOD_ICON_OPTIONS = ['🍽️', '🥩', '🐟', '🥚', '🥛', '🍚', '🥕', '🍎', '🥦', '🍠', '🥬', '🌽', '🍌', '🍇', '🍗', '🍤'];

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

  const [showAddFood, setShowAddFood] = useState(false);
  const [newFoodName, setNewFoodName] = useState('');
  const [newFoodIcon, setNewFoodIcon] = useState('🍽️');
  const [addingFood, setAddingFood] = useState(false);

  const handleAddCustomFood = async () => {
    const name = newFoodName.trim();
    if (!name) {
      showToast('请输入食材名称');
      return;
    }
    setAddingFood(true);
    try {
      const res = await fetch('/api/food/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          icon: newFoodIcon,
          category: 'other',
          status: 'tried',
          firstAddedDate: getLocalDateStr(),
        }),
      });
      if (!res.ok) throw new Error('创建失败');
      const created = await res.json();
      setSelectedFoods((prev) =>
        prev.includes(created.name) ? prev : [...prev, created.name]
      );
      setShowAddFood(false);
      setNewFoodName('');
      showToast('已添加到食材库 ✅');
      fetchFoodItems('tried');
    } catch {
      showToast('添加失败，请重试');
    } finally {
      setAddingFood(false);
    }
  };

  const handleSubmit = async () => {
    if (selectedFoods.length === 0) {
      showToast('请至少选择一种食材');
      return;
    }

    try {
      await addFoodLogRecord({
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
      setTimeout(() => router.push('/food'), 600);
    } catch (err: any) {
      showToast(err?.message || '保存失败，请稍后重试');
    }
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
              onClick={() => setShowAddFood((v) => !v)}
              className="btn-press px-4 py-2 rounded-full text-sm font-medium bg-primary-light/30 text-primary border-2 border-dashed border-primary/30"
            >
              {showAddFood ? '收起' : '+ 添加食材'}
            </button>
          </div>

          {showAddFood && (
            <div className="mt-3 bg-card rounded-2xl border border-primary-soft p-3.5 space-y-3">
              <p className="text-xs text-text-secondary">
                食材会加入食材库并立即标记为"已尝试"
              </p>
              <CuteInput
                placeholder="输入食材名称，如：山药、猪肝…"
                value={newFoodName}
                onChange={(e) => setNewFoodName(e.target.value)}
                autoFocus
              />
              <div>
                <p className="text-xs text-text-secondary mb-1.5 pl-1">选择图标</p>
                <div className="flex flex-wrap gap-1.5">
                  {FOOD_ICON_OPTIONS.map((icon) => (
                    <button
                      key={icon}
                      type="button"
                      onClick={() => setNewFoodIcon(icon)}
                      className={`w-9 h-9 rounded-xl text-lg flex items-center justify-center transition-all ${
                        newFoodIcon === icon
                          ? 'bg-primary/15 ring-2 ring-primary'
                          : 'bg-primary-light/40'
                      }`}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <CuteButton size="sm" fullWidth onClick={handleAddCustomFood} disabled={addingFood}>
                  {addingFood ? '添加中...' : '确认添加'}
                </CuteButton>
                <CuteButton
                  size="sm"
                  variant="secondary"
                  fullWidth
                  onClick={() => setShowAddFood(false)}
                >
                  取消
                </CuteButton>
              </div>
            </div>
          )}
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
