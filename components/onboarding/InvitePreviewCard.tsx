"use client";

import React from "react";
import { Baby, Users, CheckCircle2, AlertCircle } from "lucide-react";
import { CuteCard } from "@/components/ui/CuteCard";
import { calculateAge } from "@/lib/age";

export interface FamilyPreviewData {
  found: boolean;
  family?: {
    id: string;
    name: string;
    inviteCode: string;
    memberCount: number;
    adminName: string;
  };
  baby?: {
    nickname: string;
    gender: string;
    birthDate: string;
    avatarUrl?: string | null;
  } | null;
  error?: string;
}

interface InvitePreviewCardProps {
  previewData: FamilyPreviewData | null;
  loading: boolean;
}

export function InvitePreviewCard({ previewData, loading }: InvitePreviewCardProps) {
  if (loading) {
    return (
      <div className="p-3.5 rounded-2xl bg-primary-soft/30 border border-primary/20 flex items-center justify-center gap-2 text-xs text-primary animate-pulse">
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span>正在核验家庭邀请码...</span>
      </div>
    );
  }

  if (!previewData) return null;

  if (!previewData.found) {
    return (
      <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2 animate-fade-in">
        <AlertCircle size={16} className="text-amber-600 shrink-0" />
        <span>{previewData.error || "未找到对应家庭，注册后将为你创建全新空间。"}</span>
      </div>
    );
  }

  const { family, baby } = previewData;

  return (
    <CuteCard className="p-4 bg-gradient-to-br from-pink-50/90 via-rose-50/70 to-purple-50/60 dark:from-pink-950/30 dark:via-purple-950/20 dark:to-card border border-primary/30 shadow-card animate-fade-in">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-2xl bg-white dark:bg-card shadow-soft flex items-center justify-center text-primary shrink-0 overflow-hidden border border-primary/20">
          {baby?.avatarUrl ? (
            <img
              src={baby.avatarUrl}
              alt={baby.nickname}
              className="w-full h-full object-cover"
            />
          ) : (
            <Baby size={26} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-primary text-white shadow-2xs">
              已匹配家庭
            </span>
            <span className="text-xs text-text-secondary">
              管理员：{family?.adminName || "家长"}
            </span>
          </div>
          <h3 className="text-sm font-bold text-text-primary mt-1 truncate">
            {family?.name}
            {baby && ` · ${baby.nickname}`}
          </h3>
          {baby?.birthDate && (
            <p className="text-[11px] text-text-secondary mt-0.5">
              宝宝月龄：{calculateAge(baby.birthDate).label}
            </p>
          )}
          <p className="text-[11px] text-primary font-medium mt-1 flex items-center gap-1">
            <CheckCircle2 size={13} />
            账号创建后将自动加入该家庭，无需重新添加宝宝！
          </p>
        </div>
      </div>
    </CuteCard>
  );
}
