"use client";
import { useState, useEffect } from 'react';
import { CheckCircle, Shield, Bell, Info } from 'lucide-react';
import { AppHeader } from '@/components/ui/AppHeader';
import { CuteCard } from '@/components/ui/CuteCard';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { useBabyStore } from '@/stores/useBabyStore';

function getAgeAtDate(birthDateStr: string, targetDateStr: string): string {
  const birth = new Date(birthDateStr);
  const target = new Date(targetDateStr);

  let months = target.getFullYear() - birth.getFullYear();
  const monthDiff = target.getMonth() - birth.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && target.getDate() < birth.getDate())) {
    months--;
  }

  const birthDay = new Date(target.getFullYear(), target.getMonth(), birth.getDate());
  let days: number;

  if (target >= birthDay) {
    days = target.getDate() - birth.getDate();
  } else {
    const prevMonth = new Date(target.getFullYear(), target.getMonth(), 0);
    days = prevMonth.getDate() - birth.getDate() + target.getDate();
  }

  if (months > 0) {
    return `${months}月${days}天`;
  }
  return `${days}天`;
}

export default function VaccinesPage() {
  const baby = useBabyStore((s) => s.baby);
  const vaccines = useBabyStore((s) => s.vaccines) ?? [];
  const fetchVaccines = useBabyStore((s) => s.fetchVaccines);
  const [reminderOn, setReminderOn] = useState(true);

  useEffect(() => {
    fetchVaccines();
  }, [fetchVaccines]);

  const completed = vaccines.filter((v) => v.isCompleted);
  const upcoming = vaccines.filter((v) => !v.isCompleted);

  return (
    <div className="px-4 pt-12 pb-6">
      {/* Header */}
      <AppHeader title="疫苗计划" showBack />

      {/* Region note */}
      <div className="mt-4 mb-4 flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-primary-light/60">
        <Shield size={16} className="text-primary flex-shrink-0" />
        <p className="text-xs text-primary font-medium leading-relaxed">
          接种计划地区：中国国家免疫规划
        </p>
      </div>

      {/* Completed section */}
      <div className="mb-5">
        <SectionTitle title="已完成" icon={<CheckCircle size={18} className="text-mint" />} className="mb-3" />
        <CuteCard>
          <div className="space-y-3">
            {completed.map((vaccine, index) => (
              <div
                key={vaccine.id}
                className={`flex items-center gap-3 ${index < completed.length - 1 ? 'pb-3 border-b border-primary-soft/30' : ''}`}
              >
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-mint/15 flex items-center justify-center">
                  <CheckCircle size={16} className="text-mint" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary">{vaccine.name}</p>
                  <p className="text-xs text-text-muted">{vaccine.dose}</p>
                </div>
                <div className="flex-shrink-0 text-right">
                  <p className="text-xs text-text-muted">{vaccine.completedDate}</p>
                </div>
              </div>
            ))}
          </div>
        </CuteCard>
      </div>

      {/* Upcoming section */}
      <div className="mb-5">
        <SectionTitle title="即将接种" icon={<Shield size={18} className="text-primary" />} className="mb-3" />
        <CuteCard>
          <div className="space-y-3">
            {upcoming.map((vaccine, index) => {
              const ageAtVaccine = baby ? getAgeAtDate(baby.birthDate, vaccine.scheduledDate) : "";
              return (
                <div
                  key={vaccine.id}
                  className={`flex items-center gap-3 ${index < upcoming.length - 1 ? 'pb-3 border-b border-primary-soft/30' : ''}`}
                >
                  {/* Countdown badge */}
                  <div className="flex-shrink-0 px-2.5 py-1 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-xs font-semibold text-primary whitespace-nowrap">
                      还有{vaccine.countdownDays}天
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-text-primary">{vaccine.name}</p>
                      <p className="text-xs text-text-muted">{vaccine.dose}</p>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-xs text-text-muted">{vaccine.scheduledDate}</p>
                      <span className="text-text-muted/50 text-xs">·</span>
                      <p className="text-xs text-text-muted">{ageAtVaccine}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CuteCard>
      </div>

      {/* Push reminder toggle */}
      <CuteCard className="mb-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-lavender/15 flex items-center justify-center">
              <Bell size={16} className="text-lavender" />
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">Push 提醒</p>
              <p className="text-xs text-text-muted">接种日前自动推送提醒</p>
            </div>
          </div>
          {/* Toggle switch */}
          <button
            type="button"
            onClick={() => setReminderOn((prev) => !prev)}
            className={`relative w-12 h-7 rounded-full transition-colors duration-200 flex-shrink-0 cursor-pointer ${
              reminderOn ? 'bg-primary' : 'bg-gray-200'
            }`}
            aria-label="Toggle push reminder"
          >
            <span
              className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                reminderOn ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </CuteCard>

      {/* Disclaimer */}
      <div className="flex items-start gap-2 px-3 py-2.5">
        <Info size={14} className="text-text-muted flex-shrink-0 mt-0.5" />
        <p className="text-xs text-text-muted leading-relaxed">
          实际接种计划请以当地卫生部门及接种机构安排为准。
        </p>
      </div>
    </div>
  );
}
