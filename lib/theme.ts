/**
 * 主题（深色模式）工具：localStorage 持久化 + 系统偏好回退。
 * 防闪脚本在 <head> 内联执行，本模块负责切换与读取。
 */

export type ThemeMode = "light" | "dark";

const KEY = "baby-theme";

export function getStoredTheme(): ThemeMode | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

export function getEffectiveTheme(): ThemeMode {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.classList.toggle("dark", mode === "dark");
  try {
    localStorage.setItem(KEY, mode);
  } catch { /* 隐私模式忽略 */ }
}

/** 切换到另一主题并持久化 */
export function toggleTheme(): ThemeMode {
  const next: ThemeMode = getEffectiveTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}
