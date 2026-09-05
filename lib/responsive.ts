/**
 * 判断当前设备视口是否处于“桌面端 / iPad / 小型平板横屏工作台”模式：
 * - 桌面端 / 大尺寸平板 (宽 ≥ 1024px)
 * - 小型平板横屏 (如 OPPO Pad Mini、iPad mini 横屏：宽 ≥ 768px，高 ≥ 480px，landscape 方向)
 * 
 * 手机横屏 (高度通常 ≤ 440px) 保持移动端视图，避免手机横置时误触桌面侧边栏与多栏网格。
 */
export function isWorkbenchViewport(): boolean {
  if (typeof window === "undefined") return false;
  if (window.innerWidth >= 1024) return true;
  return (
    window.innerWidth >= 768 &&
    window.innerHeight >= 480 &&
    window.matchMedia("(orientation: landscape)").matches
  );
}
