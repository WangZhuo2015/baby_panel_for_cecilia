"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, TrendingUp, UtensilsCrossed, ShieldCheck, Sparkles } from "lucide-react";
import { openQuickAI } from "@/lib/quickai-bus";

const leftNavItems = [
  { path: "/", label: "今日", icon: Home },
  { path: "/growth", label: "成长", icon: TrendingUp },
];

const rightNavItems = [
  { path: "/food", label: "辅食", icon: UtensilsCrossed },
  { path: "/health/vaccines", label: "健康", icon: ShieldCheck },
];

export function BottomNav() {
  const pathname = usePathname();

  const isActive = (path: string) => {
    if (path === "/") return pathname === "/" || pathname === "/today";
    return pathname.startsWith(path);
  };

  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md lg:hidden bg-white/95 dark:bg-card/95 backdrop-blur-xl border-t border-primary-soft/40 dark:border-white/10 z-50 pb-[max(8px,env(safe-area-inset-bottom,0px))]">
      <div className="grid grid-cols-5 items-end justify-items-center px-1 pt-1.5 pb-0.5">
        {/* 左侧导航项 */}
        {leftNavItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          return (
            <Link
              key={item.path}
              href={item.path}
              prefetch={true}
              className={`flex flex-col items-center justify-center gap-0.5 w-full py-1 rounded-2xl transition-all duration-200 btn-spring cursor-pointer ${
                active ? "text-primary font-bold scale-105" : "text-text-muted hover:text-text-secondary"
              }`}
            >
              <div className={`p-1 rounded-xl transition-all duration-200 ${active ? "bg-primary/15 scale-110 shadow-xs" : "group-hover:bg-primary-light/30"}`}>
                <Icon size={21} strokeWidth={active ? 2.4 : 1.8} className="transition-transform duration-200" />
              </div>
              <span className={`text-[10px] tracking-tight transition-colors ${active ? "text-primary font-bold" : "text-text-muted"}`}>
                {item.label}
              </span>
            </Link>
          );
        })}

        {/* 中央 AI 入口专属卡位（留足左右间距） */}
        <div className="relative flex flex-col items-center justify-end w-full py-1">
          <button
            type="button"
            onClick={() => openQuickAI({ contextTitle: "AI 育儿智能中枢" })}
            aria-label="打开 AI 育儿智能中枢（语音/问答/复盘/识别）"
            className="absolute -top-5.5 w-[50px] h-[50px] rounded-full bg-gradient-to-br from-primary via-pink-500 to-lavender text-white shadow-button flex items-center justify-center active:scale-90 hover:scale-105 transition-all duration-200 cursor-pointer ring-4 ring-white dark:ring-card animate-pulse-glow-ai group"
          >
            <Sparkles size={22} className="drop-shadow transition-transform duration-300 group-hover:rotate-12 group-active:scale-90" />
          </button>
          <span className="text-[10px] tracking-tight text-primary/80 font-medium pt-0.5">
            AI 助手
          </span>
        </div>

        {/* 右侧导航项 */}
        {rightNavItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          return (
            <Link
              key={item.path}
              href={item.path}
              prefetch={true}
              className={`flex flex-col items-center justify-center gap-0.5 w-full py-1 rounded-2xl transition-all duration-200 btn-spring cursor-pointer ${
                active ? "text-primary font-bold scale-105" : "text-text-muted hover:text-text-secondary"
              }`}
            >
              <div className={`p-1 rounded-xl transition-all duration-200 ${active ? "bg-primary/15 scale-110 shadow-xs" : "group-hover:bg-primary-light/30"}`}>
                <Icon size={21} strokeWidth={active ? 2.4 : 1.8} className="transition-transform duration-200" />
              </div>
              <span className={`text-[10px] tracking-tight transition-colors ${active ? "text-primary font-bold" : "text-text-muted"}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
