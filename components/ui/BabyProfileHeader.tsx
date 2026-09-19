"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { useBabyStore } from "@/stores/useBabyStore";
import { calculateAge } from "@/lib/age";
import { calculateUnreadCount } from "@/lib/notifications-storage";
import { BabyAvatar } from "@/components/ui/BabyAvatar";

interface BabyProfileHeaderProps {
  showNotification?: boolean;
}

function getAgeLabel(birthDate: string): string {
  const { months, days } = calculateAge(birthDate);
  if (months < 1) return `${days}天`;
  if (months < 24) return `${months}个月${days}天`;
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  return `${years}岁${remMonths}个月`;
}

export const BabyProfileHeader: React.FC<BabyProfileHeaderProps> = ({
  showNotification = true,
}) => {
  const baby = useBabyStore((s) => s.baby);
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const notificationRequestGeneration = useRef(0);

  const fetchCount = useCallback(async () => {
    const requestedBabyId = baby?.id ?? null;
    const requestGeneration = ++notificationRequestGeneration.current;
    try {
      const url = requestedBabyId
        ? `/api/notifications?babyId=${encodeURIComponent(requestedBabyId)}`
        : "/api/notifications";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (
          requestGeneration !== notificationRequestGeneration.current
          || (useBabyStore.getState().baby?.id ?? null) !== requestedBabyId
        ) {
          return;
        }
        const list = Array.isArray(data) ? data : [];
        setUnreadCount(calculateUnreadCount(list));
      }
    } catch {
      // ignore
    }
  }, [baby?.id]);

  useEffect(() => {
    fetchCount();
    const handler = () => fetchCount();
    window.addEventListener("notifications-read", handler);
    window.addEventListener("baby:data-polled", handler);
    return () => {
      window.removeEventListener("notifications-read", handler);
      window.removeEventListener("baby:data-polled", handler);
    };
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
            <BabyAvatar src={baby.avatarUrl} alt={baby.nickname} size={48} priority />
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
