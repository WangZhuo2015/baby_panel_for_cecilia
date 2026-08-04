"use client";
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CuteCard } from '@/components/ui/CuteCard';
import { CuteButton } from '@/components/ui/CuteButton';
import { SegmentControl } from '@/components/ui/SegmentControl';
import { useBabyStore } from '@/stores/useBabyStore';
import { calculateAge } from '@/data/mockBaby';

function generateWeeklyDates() {
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const today = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - 3 + i);
    const dateStr = d.toISOString().split('T')[0];
    return {
      date: dateStr,
      day: d.getDate(),
      weekday: weekdays[d.getDay()],
      isToday: i === 3,
    };
  });
}

export default function FoodPage() {
  const router = useRouter();
  const baby = useBabyStore((s) => s.baby);
  const age = baby ? calculateAge(baby.birthDate) : { months: 0, days: 0, label: "0月0天" };
  const foodPlans = useBabyStore((s) => s.foodPlans);
  const fetchFoodPlans = useBabyStore((s) => s.fetchFoodPlans);

  const weeklyDates = generateWeeklyDates();
  const [selectedDate, setSelectedDate] = useState(
    weeklyDates.find((d) => d.isToday)?.date || weeklyDates[3].date
  );
  const [activeTab, setActiveTab] = useState('today');

  useEffect(() => {
    fetchFoodPlans(selectedDate);
  }, [selectedDate, fetchFoodPlans]);

  // Get food plan for selected date
  const todayFoodPlan = foodPlans?.find((plan) => plan.date === selectedDate);

  return (
    <div className="min-h-[100dvh] bg-bg pb-8">
      {/* Baby info header */}
      <div className="safe-top px-4 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-light to-primary-soft flex items-center justify-center text-2xl">
            👶
          </div>
          <div>
            <h2 className="text-lg font-bold text-text-primary">{baby?.nickname ?? ""}</h2>
            <p className="text-sm text-text-secondary">{age.label}</p>
          </div>
        </div>
      </div>

      {/* 7-day date picker */}
      <div className="px-4 mb-4">
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {weeklyDates.map((dateItem) => {
            const isSelected = dateItem.date === selectedDate;
            return (
              <button
                key={dateItem.date}
                type="button"
                onClick={() => setSelectedDate(dateItem.date)}
                className={`flex-shrink-0 flex flex-col items-center justify-center w-14 h-18 rounded-2xl transition-all btn-press ${
                  dateItem.isToday
                    ? 'bg-primary text-white shadow-button'
                    : isSelected
                    ? 'bg-primary-light text-primary'
                    : 'bg-card text-text-secondary'
                }`}
              >
                <span className="text-xs font-medium mb-1">周{dateItem.weekday}</span>
                <span className="text-xl font-bold">{dateItem.day}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 mb-4">
        <SegmentControl
          options={[
            { value: 'today', label: '今日辅食' },
            { value: 'library', label: '食材库' },
          ]}
          value={activeTab}
          onChange={setActiveTab}
        />
      </div>

      {/* Content */}
      <div className="px-4">
        {activeTab === 'today' ? (
          <>
            {/* Today's food card */}
            {todayFoodPlan ? (
              <CuteCard variant="gradient" className="mb-4">
                <div className="flex flex-col gap-3">
                  {/* Meal name and tags */}
                  <div>
                    <h3 className="text-lg font-bold text-text-primary mb-2">
                      {todayFoodPlan.name}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {todayFoodPlan.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-3 py-1 bg-white/60 text-primary text-xs font-medium rounded-full"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Nutrition */}
                  <div className="bg-white/40 rounded-xl p-3">
                    <p className="text-xs text-text-secondary mb-1">营养价值</p>
                    <p className="text-sm font-medium text-text-primary">
                      {todayFoodPlan.nutrition}
                    </p>
                  </div>

                  {/* Ingredients */}
                  <div>
                    <p className="text-sm font-semibold text-text-secondary mb-2">食材</p>
                    <div className="flex flex-wrap gap-2">
                      {todayFoodPlan.ingredients.map((ingredient) => (
                        <span
                          key={ingredient}
                          className="px-3 py-1.5 bg-white/50 text-sm text-text-primary rounded-full"
                        >
                          {ingredient}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Steps */}
                  <div>
                    <p className="text-sm font-semibold text-text-secondary mb-2">步骤</p>
                    <ol className="flex flex-col gap-2">
                      {todayFoodPlan.steps.map((step, idx) => (
                        <li key={idx} className="flex gap-2 text-sm text-text-primary">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <span className="pt-0.5">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </CuteCard>
            ) : (
              <CuteCard className="mb-4">
                <div className="text-center py-8">
                  <p className="text-4xl mb-2">🍽️</p>
                  <p className="text-sm text-text-secondary">今日暂无辅食计划</p>
                </div>
              </CuteCard>
            )}

            {/* Action buttons */}
            <div className="flex flex-col gap-3 mb-4">
              <CuteButton fullWidth onClick={() => router.push('/food/log')}>
                记录辅食
              </CuteButton>
              <CuteButton fullWidth variant="secondary" onClick={() => router.push('/food/library')}>
                查看食材库
              </CuteButton>
            </div>

            {/* Tip */}
            <div className="bg-primary-light/30 rounded-2xl p-4">
              <p className="text-xs text-text-secondary leading-relaxed">
                💡 首次添加新食材，建议持续观察3天。
              </p>
            </div>
          </>
        ) : (
          <div className="text-center py-12">
            <p className="text-5xl mb-3">🥕</p>
            <p className="text-sm text-text-secondary mb-4">食材库功能即将上线</p>
            <CuteButton variant="secondary" onClick={() => setActiveTab('today')}>
              返回今日辅食
            </CuteButton>
          </div>
        )}
      </div>
    </div>
  );
}
