"use client";
import { useState, useEffect } from 'react';
import { AppHeader } from '@/components/ui/AppHeader';
import { CuteCard } from '@/components/ui/CuteCard';
import { CuteButton } from '@/components/ui/CuteButton';
import { SegmentControl } from '@/components/ui/SegmentControl';
import { HeartRating } from '@/components/ui/HeartRating';
import { useToast } from '@/components/ui/Toast';
import { useBabyStore } from '@/stores/useBabyStore';
import type { FoodStatus } from '@/types';

export default function FoodLibraryPage() {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<FoodStatus>('tried');
  const foodItems = useBabyStore((s) => s.foodItems) ?? [];
  const fetchFoodItems = useBabyStore((s) => s.fetchFoodItems);

  useEffect(() => {
    fetchFoodItems(activeTab);
  }, [activeTab, fetchFoodItems]);

  const filteredItems = foodItems.filter((item) => item.status === activeTab);

  const handleAddFood = () => {
    showToast('功能开发中');
  };

  return (
    <div className="min-h-[100dvh] bg-bg pb-8">
      <AppHeader
        title="食材库"
        showBack
        rightAction={
          <button
            onClick={handleAddFood}
            className="text-sm font-medium text-primary btn-press px-2"
          >
            添加
          </button>
        }
      />

      <div className="px-4 pt-4">
        {/* Add food button */}
        <div className="mb-4">
          <CuteButton fullWidth onClick={handleAddFood}>
            + 添加食材
          </CuteButton>
        </div>

        {/* Tabs */}
        <div className="mb-4">
          <SegmentControl
            options={[
              { value: 'tried', label: '已尝试' },
              { value: 'to_try', label: '待尝试' },
            ]}
            value={activeTab}
            onChange={(v) => setActiveTab(v as FoodStatus)}
          />
        </div>

        {/* Food list */}
        <div className="flex flex-col gap-3">
          {filteredItems.length > 0 ? (
            filteredItems.map((item) => (
              <CuteCard key={item.id} className="card-press">
                <div className="flex items-center gap-3">
                  {/* Emoji icon */}
                  <div className="text-4xl flex-shrink-0">{item.icon}</div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-base font-semibold text-text-primary truncate">
                        {item.name}
                      </h3>
                      <span
                        className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                          item.status === 'tried'
                            ? 'bg-mint/20 text-mint-dark'
                            : 'bg-primary-light/50 text-primary'
                        }`}
                      >
                        {item.status === 'tried' ? '已尝试' : '待尝试'}
                      </span>
                    </div>

                    {item.firstAddedDate ? (
                      <p className="text-xs text-text-secondary mb-1.5">
                        首次添加：{item.firstAddedDate}
                      </p>
                    ) : (
                      <p className="text-xs text-text-muted mb-1.5">尚未添加</p>
                    )}

                    {/* Heart rating */}
                    {item.status === 'tried' && item.acceptance > 0 && (
                      <HeartRating value={item.acceptance} readOnly size={16} />
                    )}
                  </div>
                </div>
              </CuteCard>
            ))
          ) : (
            <div className="text-center py-12">
              <p className="text-5xl mb-3">🥗</p>
              <p className="text-sm text-text-secondary">
                {activeTab === 'tried' ? '暂无已尝试的食材' : '暂无待尝试的食材'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
