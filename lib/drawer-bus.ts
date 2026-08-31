export type RecordDrawerType = "feeding" | "sleep" | "diaper" | "food" | "growth";

export interface RecordDrawerOpenDetail {
  type: RecordDrawerType;
  title?: string;
  initialData?: any;
}

/** 唤起右侧滑出抽屉（支持在桌面端/iPad宽屏保持看板上下文就地录入） */
export function openRecordDrawer(detail: RecordDrawerOpenDetail | RecordDrawerType): void {
  if (typeof window === "undefined") return;
  const payload: RecordDrawerOpenDetail = typeof detail === "string" ? { type: detail } : detail;
  window.dispatchEvent(new CustomEvent("record-drawer:open", { detail: payload }));
}

/** 关闭当前打开的记录抽屉 */
export function closeRecordDrawer(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("record-drawer:close"));
}
