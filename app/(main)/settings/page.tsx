"use client";

import { useEffect } from "react";
import { ChatGPTPlanControls } from "@/components/ui/ChatGPTPlanControls";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useBabyStore } from "@/stores/useBabyStore";

const settingsLinks = [
  { href: "/family", label: "家庭成员", description: "管理家庭成员与共享" },
  { href: "/notifications", label: "通知", description: "查看提醒与通知记录" },
  { href: "/family/passport", label: "家庭 Passport", description: "管理语音设备与连接授权" },
];

export default function SettingsPage() {
  const user = useBabyStore((state) => state.user);
  const authLoading = useBabyStore((state) => state.authLoading);
  const fetchUser = useBabyStore((state) => state.fetchUser);

  useEffect(() => {
    void fetchUser();
  }, [fetchUser]);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pt-safe-6 pb-36 sm:px-6 workbench:pb-12">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-primary">账号与偏好</p>
          <h1 className="mt-1 text-2xl font-bold text-text-primary">设置</h1>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-primary/15 bg-card px-3 py-2">
          <span className="text-xs text-text-secondary">外观</span>
          <ThemeToggle />
        </div>
      </header>

      {authLoading ? (
        <p role="status" className="mb-5 rounded-xl border border-primary/15 bg-card p-3 text-sm text-text-secondary">
          正在恢复登录状态…
        </p>
      ) : !user ? (
        <section aria-label="登录提示" className="mb-5 rounded-2xl border border-amber-300/70 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
          <h2 className="font-semibold">登录后管理 AI 模型设置</h2>
          <p className="mt-1">模型偏好按当前账号保存。登录后即可连接 ChatGPT 并编辑各项 AI 功能。</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <a href="/login" className="rounded-lg bg-primary px-3 py-2 font-semibold text-white">登录</a>
            <a href="/register" className="rounded-lg border border-primary/25 px-3 py-2 font-semibold text-primary">注册账号</a>
          </div>
        </section>
      ) : (
        <p role="status" className="mb-5 text-xs text-text-muted">模型偏好会保存到当前账号。</p>
      )}

      <section id="ai-models" aria-labelledby="ai-models-title" className="scroll-mt-5 rounded-2xl border border-primary/15 bg-card p-4 shadow-soft sm:p-5">
        <div className="mb-4">
          <p className="text-xs font-semibold text-primary">模型与账号</p>
          <h2 id="ai-models-title" className="mt-1 text-lg font-bold text-text-primary">AI 模型设置</h2>
          <p className="mt-1 text-sm text-text-secondary">聊天模型、ChatGPT 账号和各项 AI 功能都在这里配置。</p>
        </div>
        <ChatGPTPlanControls disabled={authLoading || !user} />
      </section>

      <section aria-label="其他设置入口" className="mt-5 rounded-2xl border border-primary/15 bg-card p-4 shadow-soft sm:p-5">
        <h2 className="text-base font-bold text-text-primary">家庭与通知</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {settingsLinks.map((item) => (
            <a key={item.href} href={item.href} className="rounded-xl border border-primary/10 p-3 transition-colors hover:border-primary/30 hover:bg-primary/5">
              <span className="block text-sm font-semibold text-text-primary">{item.label}</span>
              <span className="mt-1 block text-xs text-text-muted">{item.description}</span>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
