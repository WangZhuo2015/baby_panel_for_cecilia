"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CuteCard } from "@/components/ui/CuteCard";
import { CuteInput } from "@/components/ui/CuteInput";
import { CuteButton } from "@/components/ui/CuteButton";
import { useToast } from "@/components/ui/Toast";
import { useBabyStore } from "@/stores/useBabyStore";
import { UserPlus, Baby, Users } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const register = useBabyStore((s) => s.register);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [relation, setRelation] = useState("mother");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      showToast("请输入用户名和密码");
      return;
    }
    if (password.length < 6) {
      showToast("密码至少需要 6 位");
      return;
    }

    setLoading(true);
    try {
      await register({
        username: username.trim(),
        password,
        displayName: displayName.trim() || undefined,
        inviteCode: inviteCode.trim() || undefined,
        relation,
      });
      showToast("注册成功！欢迎使用 ✨");
      const currentBaby = useBabyStore.getState().baby;
      if (!currentBaby) {
        router.push("/onboarding");
      } else {
        router.push("/");
      }
    } catch (err: any) {
      showToast(err?.message || "注册失败，请更换用户名重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-canvas flex flex-col justify-center px-4 py-8 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center mb-6">
        <div className="w-16 h-16 rounded-3xl bg-primary-light text-primary mx-auto flex items-center justify-center shadow-card mb-3">
          <Baby size={36} />
        </div>
        <h2 className="text-2xl font-bold text-text-primary">创建账号</h2>
        <p className="text-sm text-text-secondary mt-1">支持多家长家庭成员共享与协同育儿</p>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <CuteCard className="py-7 px-6 shadow-soft">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                用户名（用于登录）
              </label>
              <CuteInput
                type="text"
                placeholder="英文字母或数字，如 mama123"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                密码（至少6位）
              </label>
              <CuteInput
                type="password"
                placeholder="请设置密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                你的称呼 / 角色
              </label>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {[
                  { id: "mother", label: "妈妈" },
                  { id: "father", label: "爸爸" },
                  { id: "grandparent", label: "长辈" },
                  { id: "caregiver", label: "看护" },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setRelation(item.id);
                      if (!displayName) setDisplayName(item.label);
                    }}
                    className={`py-2 text-xs rounded-xl border transition-all ${
                      relation === item.id
                        ? "bg-primary-soft text-primary border-primary font-bold shadow-soft"
                        : "bg-white text-text-secondary border-divider hover:border-primary/40"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <CuteInput
                type="text"
                placeholder="自定义昵称（如：大宝妈妈）"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>

            <div className="pt-2 border-t border-divider/60">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Users size={14} className="text-primary" />
                <label className="block text-xs font-semibold text-text-secondary">
                  加入已有家庭（可选）
                </label>
              </div>
              <CuteInput
                type="text"
                placeholder="输入其他家长分享的 6 位邀请码"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              />
              <p className="text-[11px] text-text-muted mt-1">
                若不填写，将为你自动创建全新的家庭育儿空间。
              </p>
            </div>

            <div className="pt-3">
              <CuteButton
                type="submit"
                variant="primary"
                size="lg"
                className="w-full justify-center"
                disabled={loading}
              >
                <UserPlus size={18} className="mr-2" />
                {loading ? "创建中..." : "立即注册"}
              </CuteButton>
            </div>
          </form>

          <div className="mt-6 text-center text-xs text-text-secondary">
            已有账号？{" "}
            <Link href="/login" className="font-semibold text-primary hover:underline">
              直接登录
            </Link>
          </div>
        </CuteCard>
      </div>
    </div>
  );
}
