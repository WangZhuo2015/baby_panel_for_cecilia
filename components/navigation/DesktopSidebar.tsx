"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  TrendingUp,
  UtensilsCrossed,
  ShieldCheck,
  Sparkles,
  Star,
  BookOpen,
  CloudSun,
  Users,
  Droplets,
  Moon,
  Wind,
  Plus,
  Baby,
  Camera,
} from "lucide-react";
import { useBabyStore } from "@/stores/useBabyStore";
import { calculateAge } from "@/lib/age";
import { openQuickAI } from "@/lib/quickai-bus";
import { openRecordDrawer, RecordDrawerType } from "@/lib/drawer-bus";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

const mainNavItems = [
  { path: "/", label: "今日看板", icon: Home },
  { path: "/growth", label: "WHO 生长曲线", icon: TrendingUp },
  { path: "/food", label: "辅食食谱与日记", icon: UtensilsCrossed },
  { path: "/nutrition", label: "DRIs 全量营养", icon: Sparkles },
  { path: "/health/vaccines", label: "疫苗接种与健康", icon: ShieldCheck },
  { path: "/development", label: "发育里程碑", icon: Star },
  { path: "/books", label: "早教与绘本", icon: BookOpen },
  { path: "/weather", label: "天气与穿衣建议", icon: CloudSun },
  { path: "/family", label: "家庭成员共享", icon: Users },
];

const quickShortcuts: { type: RecordDrawerType; label: string; icon: any; color: string }[] = [
  { type: "feeding", label: "记喂奶", icon: Droplets, color: "text-sky-500 bg-sky-50 dark:bg-sky-950/40" },
  { type: "sleep", label: "记睡眠", icon: Moon, color: "text-purple-500 bg-purple-50 dark:bg-purple-950/40" },
  { type: "diaper", label: "换尿布", icon: Wind, color: "text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40" },
  { type: "food", label: "记辅食", icon: UtensilsCrossed, color: "text-amber-500 bg-amber-50 dark:bg-amber-950/40" },
  { type: "growth", label: "记生长", icon: TrendingUp, color: "text-pink-500 bg-pink-50 dark:bg-pink-950/40" },
];

export function DesktopSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const baby = useBabyStore((s) => s.baby);
  const age = baby ? calculateAge(baby.birthDate) : { label: "0月0天" };

  const isActive = (path: string) => {
    if (path === "/") return pathname === "/" || pathname === "/today";
    return pathname.startsWith(path);
  };

  return (
    <aside className="hidden lg:flex flex-col fixed left-0 top-0 bottom-0 w-64 bg-card/95 backdrop-blur-xl border-r border-primary/15 z-40 select-none">
      {/* 1. Baby Profile Card Header */}
      <div className="p-4 border-b border-primary/10">
        <div
          onClick={() => router.push("/onboarding")}
          className="flex items-center gap-3 p-2.5 rounded-2xl hover:bg-primary-light/40 transition-colors cursor-pointer group"
          title="点击切换头像或修改宝宝资料"
        >
          <div className="relative shrink-0">
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-primary-soft to-primary/30 flex items-center justify-center overflow-hidden shadow-soft group-hover:ring-2 group-hover:ring-primary/40 transition-all">
              {baby?.avatarUrl ? (
                <img src={baby.avatarUrl} alt={baby.nickname} className="w-full h-full object-cover" />
              ) : (
                <Baby size={22} className="text-primary" />
              )}
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-white flex items-center justify-center shadow-xs">
              <Camera size={9} />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-text-primary text-sm truncate group-hover:text-primary transition-colors">
                {baby?.nickname || "宝宝档案"}
              </span>
              <span className="text-xs">{baby?.gender === "male" ? "👦" : "🎀"}</span>
            </div>
            <p className="text-xs text-text-secondary mt-0.5 truncate">{age.label}</p>
          </div>
        </div>
      </div>

      {/* 2. Quick Record Drawer Shortcuts */}
      <div className="px-4 py-3 border-b border-primary/10">
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider">快捷就地录入</span>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {quickShortcuts.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.type}
                type="button"
                onClick={() => openRecordDrawer(s.type)}
                className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl transition-all hover:scale-105 active:scale-95 btn-press cursor-pointer ${s.color}`}
                title={s.label}
                aria-label={s.label}
              >
                <Icon size={16} />
                <span className="text-[10px] font-bold mt-1 text-text-secondary">{s.label.slice(1)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Main Navigation List */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-1">
        {mainNavItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          return (
            <Link
              key={item.path}
              href={item.path}
              prefetch={true}
              className={`flex items-center gap-3 px-3.5 py-3 rounded-2xl min-h-[46px] transition-all duration-150 btn-press cursor-pointer ${
                active
                  ? "bg-primary text-white font-bold shadow-sm shadow-primary/25"
                  : "text-text-secondary hover:text-text-primary hover:bg-primary-light/40"
              }`}
            >
              <Icon size={18} strokeWidth={active ? 2.4 : 1.9} className="shrink-0" />
              <span className="text-sm font-medium tracking-tight truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>

      {/* 4. Bottom AI Assistant & Theme Toggle Area */}
      <div className="p-3.5 border-t border-primary/10 space-y-2 bg-gradient-to-t from-primary-light/20 to-transparent">
        {/* Large Prominent AI Entry */}
        <button
          type="button"
          onClick={() => openQuickAI({ contextTitle: "AI 育儿专属顾问" })}
          className="w-full min-h-[46px] py-2.5 px-3 rounded-2xl bg-gradient-to-r from-primary to-pink-500 text-white font-bold text-xs shadow-button flex items-center justify-center gap-2 hover:opacity-95 active:scale-98 transition-all cursor-pointer"
        >
          <Sparkles size={16} className="animate-pulse" />
          <span>AI 育儿智能顾问</span>
        </button>

        {/* System Bar (Theme, Settings) */}
        <div className="flex items-center justify-between px-2 pt-1">
          <span className="text-[11px] text-text-muted">深色 / 浅色模式</span>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
