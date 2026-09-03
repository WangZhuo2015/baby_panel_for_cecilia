"use client";

import React from "react";
import { RELATION_SELECTOR_OPTIONS } from "@/lib/constants";
import { CuteInput } from "@/components/ui/CuteInput";

interface RoleSelectorGridProps {
  relation: string;
  onSelectRelation: (roleId: string, defaultLabel: string) => void;
  displayName: string;
  onDisplayNameChange: (name: string) => void;
}

export function RoleSelectorGrid({
  relation,
  onSelectRelation,
  displayName,
  onDisplayNameChange,
}: RoleSelectorGridProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-semibold text-text-secondary">
          你在家里的称呼 / 角色
        </label>
        <span className="text-[10px] text-text-muted">方便家人查看是谁记录的</span>
      </div>

      {/* 8 个精细化角色按钮 */}
      <div className="grid grid-cols-4 gap-1.5">
        {RELATION_SELECTOR_OPTIONS.map((item) => {
          const isSelected = relation === item.id;
          const isLongLabel = item.label.length > 4;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectRelation(item.id, item.label)}
              className={`py-2 px-0.5 rounded-xl border transition-all text-center flex items-center justify-center cursor-pointer select-none ${
                isLongLabel ? "text-[10.5px] tracking-tight" : "text-xs"
              } ${
                isSelected
                  ? "bg-primary text-white border-primary font-bold shadow-soft scale-[1.02]"
                  : "bg-white dark:bg-card text-text-secondary border-divider hover:border-primary/40 hover:bg-primary-soft/20"
              }`}
            >
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      <CuteInput
        type="text"
        placeholder="自定义称呼，如：安安爸爸、大宝姥姥"
        value={displayName}
        onChange={(e) => onDisplayNameChange(e.target.value)}
        maxLength={16}
      />
    </div>

  );
}
