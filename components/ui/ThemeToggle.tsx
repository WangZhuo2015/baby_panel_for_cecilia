"use client";

import React, { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { getEffectiveTheme, toggleTheme, type ThemeMode } from "@/lib/theme";

/** 顶栏深浅色切换按钮：跟随防闪脚本的初始值，点击即切换并持久化 */
export const ThemeToggle: React.FC = () => {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(getEffectiveTheme());
    setMounted(true);
  }, []);

  const handleClick = () => {
    setTheme(toggleTheme());
  };

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={isDark ? "切换到浅色模式" : "切换到深色模式"}
      className="btn-press flex items-center justify-center w-9 h-9 rounded-full text-text-secondary hover:text-text-primary hover:bg-primary-soft/30 cursor-pointer"
      suppressHydrationWarning
    >
      {/* 挂载前渲染占位图标，避免 SSR/客户端不一致 */}
      {!mounted ? (
        <Moon size={18} />
      ) : isDark ? (
        <Sun size={18} />
      ) : (
        <Moon size={18} />
      )}
    </button>
  );
};
