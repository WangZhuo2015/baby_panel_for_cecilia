"use client";
import { useState, useEffect } from 'react';
import { AlertCircle, TrendingUp, Brain, MessageCircle, Hand, Sparkles } from 'lucide-react';
import { AppHeader, CuteCard, SegmentControl, SectionTitle } from '@/components/ui';
import { useBabyStore } from '@/stores/useBabyStore';
import type { DevelopmentCategory } from '@/types';

const categoryMap: { value: DevelopmentCategory; label: string; icon: React.ReactNode }[] = [
  { value: 'gross_motor', label: '大运动', icon: <TrendingUp size={14} /> },
  { value: 'cognitive', label: '认知', icon: <Brain size={14} /> },
  { value: 'language', label: '语言', icon: <MessageCircle size={14} /> },
  { value: 'fine_motor', label: '精细/感官', icon: <Hand size={14} /> },
];

function getStatusStyle(status: 'achieved' | 'practicing' | 'upcoming') {
  switch (status) {
    case 'achieved':
      return 'bg-mint/15 text-mint';
    case 'practicing':
      return 'bg-primary/10 text-primary';
    case 'upcoming':
      return 'bg-text-muted/10 text-text-muted';
  }
}

function getStatusLabel(status: 'achieved' | 'practicing' | 'upcoming') {
  switch (status) {
    case 'achieved': return '已达成';
    case 'practicing': return '练习中';
    case 'upcoming': return '即将到来';
  }
}

function getCategoryIcon(category: DevelopmentCategory) {
  switch (category) {
    case 'gross_motor': return <TrendingUp size={18} className="text-primary" />;
    case 'cognitive': return <Brain size={18} className="text-primary" />;
    case 'language': return <MessageCircle size={18} className="text-primary" />;
    case 'fine_motor': return <Hand size={18} className="text-primary" />;
  }
}

export default function DevelopmentPage() {
  const [selectedMonth, setSelectedMonth] = useState('6');
  const [activeTab, setActiveTab] = useState<DevelopmentCategory>('gross_motor');

  const milestones = useBabyStore((s) => s.milestones) ?? [];
  const activities = useBabyStore((s) => s.activities) ?? [];
  const fetchMilestones = useBabyStore((s) => s.fetchMilestones);
  const fetchActivities = useBabyStore((s) => s.fetchActivities);

  const monthOptions = Array.from({ length: 24 }, (_, i) => `${i + 1}`);

  useEffect(() => {
    fetchMilestones(activeTab, parseInt(selectedMonth, 10));
    fetchActivities();
  }, [activeTab, selectedMonth, fetchMilestones, fetchActivities]);

  const filteredMilestones = milestones.filter((m) => m.category === activeTab);

  return (
    <div className="min-h-screen bg-bg">
      <AppHeader title="发育里程碑" />

      <div className="px-4 pt-3 pb-8 space-y-5">
        {/* Month selector */}
        <div className="overflow-x-auto scrollbar-hide">
          <div className="flex gap-2">
            {monthOptions.map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => setSelectedMonth(label)}
                className={`btn-press flex-shrink-0 py-2 px-4 rounded-full text-sm font-medium transition-all cursor-pointer min-h-[36px] ${
                  selectedMonth === label
                    ? 'bg-primary text-white shadow-button'
                    : 'bg-card text-text-secondary shadow-soft'
                }`}
              >
                {label}月龄
              </button>
            ))}
          </div>
        </div>

        {/* Category tabs */}
        <SegmentControl
          options={categoryMap.map((c) => ({ value: c.value, label: c.label }))}
          value={activeTab}
          onChange={(v) => setActiveTab(v as DevelopmentCategory)}
        />

        {/* Milestone cards */}
        <div className="space-y-3">
          {filteredMilestones.map((milestone) => (
            <CuteCard key={milestone.id}>
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-2xl bg-primary-light flex-shrink-0">
                  {getCategoryIcon(milestone.category)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <h3 className="font-semibold text-text-primary text-sm">
                      {milestone.title}
                    </h3>
                    <span className={`flex-shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusStyle(milestone.status)}`}>
                      {getStatusLabel(milestone.status)}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary leading-relaxed">
                    {milestone.description}
                  </p>
                </div>
              </div>
            </CuteCard>
          ))}
        </div>

        {/* Activity recommendations */}
        <div>
          <SectionTitle title="今日活动推荐" icon={<Sparkles size={18} />} className="mb-3" />
          <div className="space-y-3">
            {activities.map((activity) => (
              <CuteCard key={activity.id} variant="gradient">
                <div className="mb-2">
                  <h3 className="font-semibold text-text-primary text-sm">{activity.title}</h3>
                  <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                    {activity.tag}
                  </span>
                </div>

                {/* Materials */}
                <div className="mb-3">
                  <p className="text-xs text-text-muted mb-1.5">所需材料</p>
                  <div className="flex flex-wrap gap-1.5">
                    {activity.materials.map((m, i) => (
                      <span key={i} className="px-2.5 py-0.5 rounded-full bg-card text-xs text-text-secondary">
                        {m}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Steps */}
                <div>
                  <p className="text-xs text-text-muted mb-1.5">步骤</p>
                  <ol className="space-y-1.5">
                    {activity.steps.map((step, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-white text-[10px] font-bold flex-shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <span className="text-xs text-text-secondary leading-relaxed">
                          {step}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              </CuteCard>
            ))}
          </div>
        </div>

        {/* Disclaimer */}
        <div className="flex items-start gap-2 px-1 pt-2">
          <AlertCircle size={14} className="text-text-muted flex-shrink-0 mt-0.5" />
          <p className="text-xs text-text-muted leading-relaxed">
            建议仅供参考，不作为发育诊断依据。
          </p>
        </div>
      </div>
    </div>
  );
}
