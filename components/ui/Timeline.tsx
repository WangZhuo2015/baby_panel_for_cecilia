import React from 'react';
import type { TimelineEntry } from '@/types';
import { Baby, Moon, Droplets, UtensilsCrossed, Pill } from 'lucide-react';
import { AgentBadge } from '@/components/ui/AgentBadge';

interface TimelineProps {
  items: TimelineEntry[];
  /** 点击任意一条记录（移动端主入口：弹出 修改/删除 操作面板） */
  onItemTap?: (item: TimelineEntry) => void;
}

const iconMap: Record<TimelineEntry['type'], React.FC<{ size?: number; className?: string }>> = {
  feeding: Baby,
  sleep: Moon,
  diaper: Droplets,
  food: UtensilsCrossed,
  supplement: Pill,
};

const colorMap: Record<TimelineEntry['type'], string> = {
  feeding: 'bg-peach/20 text-peach',
  sleep: 'bg-lavender/20 text-lavender',
  diaper: 'bg-sky/20 text-sky',
  food: 'bg-mint/20 text-mint',
  supplement: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400',
};

const TimelineImpl: React.FC<TimelineProps> = ({ items, onItemTap }) => {
  if (items.length === 0) {
    return (
      <div className="py-6 px-4 rounded-2xl bg-white dark:bg-card border border-primary-soft/40 text-center space-y-1 shadow-xs">
        <span className="text-2xl">🍼💤</span>
        <p className="text-xs font-semibold text-text-secondary">今天还没有记录作息流水哦</p>
        <p className="text-[11px] text-text-muted">点击上方快捷卡片，轻松记下宝宝的每一餐与每一觉</p>
      </div>
    );
  }

  return (
    <div className="relative pl-6">
      {/* Connecting line */}
      <div className="absolute left-[11px] top-2 bottom-2 w-[2px] bg-primary-soft/60 rounded-full" />

      {items.map((item, idx) => {
        const Icon = iconMap[item.type] || Baby;
        const color = colorMap[item.type] || colorMap.feeding;

        const content = (
          <>
            {/* Icon dot */}
            <div className={`absolute -left-6 flex items-center justify-center w-[22px] h-[22px] rounded-full ${color} z-10 shrink-0`}>
              <Icon size={12} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 ml-1">
              <div className="flex items-baseline gap-1.5 flex-wrap">
                <span className="text-xs text-text-muted font-medium">{item.time}</span>
                <span className="text-sm font-medium text-text-primary">{item.title}</span>
                {item.sourceAgent && <AgentBadge name={item.sourceAgent} size="xs" />}
                {item.recorderName && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary-soft/40 text-text-secondary whitespace-nowrap">
                    {item.recorderName}
                  </span>
                )}
              </div>
              {item.detail && (
                <p className="text-xs text-text-secondary mt-0.5 break-words">{item.detail}</p>
              )}
            </div>
          </>
        );

        if (!onItemTap) {
          return (
            <div key={item.id} className="relative flex gap-3 pb-5 last:pb-0 animate-fade-in" style={{ animationDelay: `${Math.min(idx * 60, 600)}ms` }}>
              {content}
            </div>
          );
        }

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onItemTap(item)}
            aria-label={`查看可对「${item.title}」执行的操作`}
            className="relative flex gap-3 pb-5 last:pb-0 animate-fade-in w-full text-left active:opacity-70 transition-opacity"
            style={{ animationDelay: `${Math.min(idx * 60, 600)}ms` }}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
};

export const Timeline = React.memo(TimelineImpl);
