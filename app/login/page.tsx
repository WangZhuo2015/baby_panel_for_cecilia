"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CuteCard } from "@/components/ui/CuteCard";
import { CuteInput } from "@/components/ui/CuteInput";
import { CuteButton } from "@/components/ui/CuteButton";
import { useToast } from "@/components/ui/Toast";
import { useBabyStore } from "@/stores/useBabyStore";
import { LogIn, Baby } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const login = useBabyStore((s) => s.login);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      showToast("请输入用户名和密码");
      return;
    }

    setLoading(true);
    try {
      await login({ username: username.trim(), password });
      showToast("登录成功 ✨");
      router.push("/");
    } catch (err: any) {
      showToast(err?.message || "登录失败，请核对用户名和密码");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-canvas flex flex-col justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center mb-6">
        <div className="w-16 h-16 rounded-3xl bg-primary-light text-primary mx-auto flex items-center justify-center shadow-card mb-3">
          <Baby size={36} />
        </div>
        <h2 className="text-2xl font-bold text-text-primary">宝宝成长工作台</h2>
        <p className="text-sm text-text-secondary mt-1">登录账号，与家人共同记录宝宝成长</p>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <CuteCard className="py-8 px-6 shadow-soft">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                用户名
              </label>
              <CuteInput
                type="text"
                placeholder="请输入用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                密码
              </label>
              <CuteInput
                type="password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            <div className="pt-2">
              <CuteButton
                type="submit"
                variant="primary"
                size="lg"
                className="w-full justify-center"
                disabled={loading}
              >
                <LogIn size={18} className="mr-2" />
                {loading ? "登录中..." : "登 录"}
              </CuteButton>
            </div>
          </form>

          <div className="mt-6 text-center text-xs text-text-secondary">
            还没有账号？{" "}
            <Link href="/register" className="font-semibold text-primary hover:underline">
              立即注册 / 加入家庭
            </Link>
          </div>
        </CuteCard>
      </div>
    </div>
  );
}
