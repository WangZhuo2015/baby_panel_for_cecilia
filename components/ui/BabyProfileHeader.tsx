"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { useBabyStore } from "@/stores/useBabyStore";

interface BabyProfileHeaderProps {
  showNotification?: boolean;
}

function getAgeLabel(birthDate: string): string {
  const birth = new Date(birthDate);
  const now = new Date();
  const months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  const days = Math.floor((now.getTime() - birth.getTime()) / (1000 * 60 * 60 * 24));
  if (months < 1) return `${days}天`;
  if (months < 24) return `${months}个月${days % 30}天`;
  const years = Math.floor(months / 12);
  return `${years}岁${months % 12}个月`;
}

export const BabyProfileHeader: React.FC<BabyProfileHeaderProps> = ({
  showNotification = true,
}) => {
  const baby = useBabyStore((s) => s.baby);
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        const readRaw = localStorage.getItem("notification-read-ids");
        const readIds = new Set(readRaw ? JSON.parse(readRaw) : []);
        const unread = list.filter(
          (n: { id: string }) => !readIds.has(n.id)
        ).length;
        setUnreadCount(unread);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchCount();
    const handler = () => fetchCount();
    window.addEventListener("notifications-read", handler);
    return () => window.removeEventListener("notifications-read", handler);
  }, [fetchCount]);

  if (!baby) return null;

  return (
    <div className="flex items-center justify-between px-1 py-2">
      <div
        className="flex items-center gap-3 cursor-pointer group"
        onClick={() => router.push("/onboarding")}
        title="点击修改宝宝资料与头像"
      >
        {/* Avatar */}
        <div className="w-12 h-12 rounded-full bg-primary-soft flex items-center justify-center overflow-hidden shadow-card group-hover:ring-2 group-hover:ring-primary/40 transition-all">
          {baby.avatarUrl ? (
            <img src={baby.avatarUrl} alt={baby.nickname} className="w-full h-full object-cover" />
          ) : (
            <span className="text-xl">👶</span>
          )}
        </div>
        <div>
          <h1 className="text-base font-semibold text-text-primary group-hover:text-primary transition-colors">{baby.nickname}</h1>
          <p className="text-xs text-text-secondary">{getAgeLabel(baby.birthDate)}</p>
        </div>
      </div>
      {showNotification && (
        <button
          type="button"
          onClick={() => router.push("/notifications")}
          className="btn-press relative w-10 h-10 flex items-center justify-center rounded-full bg-primary-light text-primary cursor-pointer min-w-[44px] min-h-[44px]"
          aria-label="通知"
        >
          <Bell size={20} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1 shadow-soft">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
};
