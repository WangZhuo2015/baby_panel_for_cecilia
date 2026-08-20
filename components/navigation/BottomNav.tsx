"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, TrendingUp, UtensilsCrossed, Star, ShieldCheck } from "lucide-react";

const navItems = [
  { path: "/", label: "今日", icon: Home },
  { path: "/growth", label: "成长", icon: TrendingUp },
  { path: "/food", label: "辅食", icon: UtensilsCrossed },
  { path: "/development", label: "发展", icon: Star },
  { path: "/health/vaccines", label: "健康", icon: ShieldCheck },
];

export function BottomNav() {
  const pathname = usePathname();

  const isActive = (path: string) => {
    if (path === "/") return pathname === "/" || pathname === "/today";
    return pathname.startsWith(path);
  };

  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-white/95 backdrop-blur-xl border-t border-primary-soft/40 z-50 pb-[max(8px,env(safe-area-inset-bottom,0px))]">
      <div className="flex items-center justify-around px-2 pt-1.5 pb-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          return (
            <Link
              key={item.path}
              href={item.path}
              prefetch={true}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 py-1 min-w-[52px] rounded-2xl transition-all duration-200 btn-press cursor-pointer ${
                active ? "text-primary font-bold" : "text-text-muted hover:text-text-secondary"
              }`}
            >
              <div className={`p-1 rounded-xl transition-colors ${active ? "bg-primary/10" : ""}`}>
                <Icon size={21} strokeWidth={active ? 2.3 : 1.8} />
              </div>
              <span className={`text-[10px] tracking-tight ${active ? "text-primary font-bold" : "text-text-muted"}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
