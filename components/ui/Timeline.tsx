import React from 'react';
import type { TimelineEntry } from '@/types';
import { Baby, Moon, Droplets, UtensilsCrossed, Pencil, Trash2 } from 'lucide-react';

interface TimelineProps {
  items: TimelineEntry[];
  /** 传入即显示每条的编辑/删除操作（误操作修正入口） */
  onEdit?: (item: TimelineEntry) => void;
  onDelete?: (item: TimelineEntry) => void;
}

const iconMap: Record<TimelineEntry['type'], React.FC<{ size?: number; className?: string }>> = {
  feeding: Baby,
  sleep: Moon,
  diaper: Droplets,
  food: UtensilsCrossed,
};

const colorMap: Record<TimelineEntry['type'], string> = {
  feeding: 'bg-peach/20 text-peach',
  sleep: 'bg-lavender/20 text-lavender',
  diaper: 'bg-sky/20 text-sky',
  food: 'bg-mint/20 text-mint',
};

export const Timeline: React.FC<TimelineProps> = ({ items, onEdit, onDelete }) => {
  if (items.length === 0) return null;

  return (
    <div className="relative pl-6">
      {/* Connecting line */}
      <div className="absolute left-[11px] top-2 bottom-2 w-[2px] bg-primary-soft/60 rounded-full" />

      {items.map((item, idx) => {
        const Icon = iconMap[item.type] || Baby;
        const color = colorMap[item.type] || colorMap.feeding;

        return (
          <div
            key={item.id}
            className={`relative flex gap-3 pb-5 last:pb-0 animate-fade-in group`}
            style={{ animationDelay: `${idx * 60}ms` }}
          >
            {/* Icon dot */}
            <div className={`absolute -left-6 flex items-center justify-center w-[22px] h-[22px] rounded-full ${color} z-10`}>
              <Icon size={12} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 ml-1">
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-text-muted font-medium">{item.time}</span>
                <span className="text-sm font-medium text-text-primary">{item.title}</span>
                {item.recorderName && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary-soft/40 text-text-secondary whitespace-nowrap">
                    {item.recorderName}
                  </span>
                )}
              </div>
              {item.detail && (
                <p className="text-xs text-text-secondary mt-0.5">{item.detail}</p>
              )}
            </div>

            {(onEdit || onDelete) && (
              <div className="flex items-center gap-1 self-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-60 transition-opacity">
                {onEdit && (
                  <button
                    type="button"
                    aria-label="编辑这条记录"
                    onClick={() => onEdit(item)}
                    className="p-1.5 rounded-full text-text-muted hover:text-primary hover:bg-primary-soft/30"
                  >
                    <Pencil size={13} />
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    aria-label="删除这条记录"
                    onClick={() => onDelete(item)}
                    className="p-1.5 rounded-full text-text-muted hover:text-red-500 hover:bg-red-50"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
