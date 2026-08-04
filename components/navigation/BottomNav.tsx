"use client";

import { usePathname, useRouter } from "next/navigation";
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
  const router = useRouter();

  const isActive = (path: string) => {
    if (path === "/") return pathname === "/" || pathname === "/today";
    return pathname.startsWith(path);
  };

  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-white/95 backdrop-blur-lg border-t border-primary-soft/50 safe-bottom z-50">
      <div className="flex items-center justify-around px-2 pt-2 pb-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          return (
            <button
              key={item.path}
              onClick={() => router.push(item.path)}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 min-w-[52px] rounded-2xl transition-all duration-200 btn-press ${
                active ? "text-primary" : "text-text-muted"
              }`}
            >
              <div className={`p-1 rounded-xl transition-colors ${active ? "bg-primary/10" : ""}`}>
                <Icon size={22} strokeWidth={active ? 2.2 : 1.8} />
              </div>
              <span className={`text-[10px] font-medium ${active ? "text-primary" : "text-text-muted"}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
