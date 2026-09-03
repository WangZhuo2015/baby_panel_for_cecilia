"use client";

import React, { useState, useEffect, Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CuteCard } from "@/components/ui/CuteCard";
import { CuteInput } from "@/components/ui/CuteInput";
import { CuteButton } from "@/components/ui/CuteButton";
import { useToast } from "@/components/ui/Toast";
import { useBabyStore } from "@/stores/useBabyStore";
import { UserPlus, Baby, Users, Sparkles, BookOpen } from "lucide-react";
import { APP_VERSION } from "@/lib/version";
import { FeatureTourModal } from "@/components/ui/FeatureTourModal";
import {
  RoleSelectorGrid,
  InvitePreviewCard,
  type FamilyPreviewData,
} from "@/components/onboarding";

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const register = useBabyStore((s) => s.register);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [relation, setRelation] = useState("mother");
  const [loading, setLoading] = useState(false);

  // 邀请码自动识别与家庭预览
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<FamilyPreviewData | null>(null);
  const [isTourModalOpen, setIsTourModalOpen] = useState(false);

  // 校验并加载邀请码信息
  const checkInviteCode = useCallback(async (code: string) => {
    const cleanCode = code.trim().toUpperCase();
    if (cleanCode.length < 4) {
      setPreviewData(null);
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/family/preview?code=${encodeURIComponent(cleanCode)}`);
      const data = await res.json();
      if (res.ok && data.found) {
        setPreviewData(data);
      } else {
        setPreviewData({ found: false, error: data.error || "未找到该家庭邀请码" });
      }
    } catch {
      setPreviewData({ found: false, error: "网络请求异常，请稍后重试" });
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  // 首次载入读取 URL 参数
  useEffect(() => {
    const inviteParam = searchParams.get("invite");
    if (inviteParam && inviteParam.trim()) {
      const clean = inviteParam.trim().toUpperCase();
      setInviteCode(clean);
      checkInviteCode(clean);
    }
  }, [searchParams, checkInviteCode]);

  const handleInviteCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase();
    setInviteCode(val);
    if (val.length >= 6) {
      checkInviteCode(val);
    } else {
      setPreviewData(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      showToast("请输入用户名和密码", "error");
      return;
    }
    if (password.length < 8) {
      showToast("密码至少需要 8 位", "error");
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

      const currentBaby = useBabyStore.getState().baby;
      if (currentBaby) {
        showToast(`欢迎加入！已成功同步【${currentBaby.nickname}】的家庭记录 ✨`, "success");
        router.push("/");
      } else {
        showToast("账号与家庭已创建！请继续添加宝宝资料 ✨", "success");
        router.push("/onboarding");
      }
    } catch (err: any) {
      showToast(err?.message || "注册失败，请更换用户名重试", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-canvas flex flex-col justify-center px-4 py-8 sm:px-6 lg:px-8">
      {/* 顶部标题与功能指南入口 */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center mb-5">
        <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-primary-light to-primary-soft text-primary mx-auto flex items-center justify-center shadow-card mb-3">
          <Baby size={36} />
        </div>
        <h2 className="text-2xl font-bold text-text-primary">加入宝宝成长工作台</h2>
        <p className="text-xs text-text-secondary mt-1">
          WHO 生长发育 · 全量营养摄入 · 疫苗智能日程 · 全家实时协同
        </p>

        {/* 功能速览展开条 */}
        <div className="mt-3 flex items-center justify-center">
          <button
            type="button"
            onClick={() => setIsTourModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-soft/70 hover:bg-primary-soft text-primary text-xs font-semibold transition-all cursor-pointer shadow-2xs border border-primary/20 hover:scale-105 active:scale-95"
          >
            <BookOpen size={13} />
            <span>查看产品功能全景介绍</span>
            <Sparkles size={12} />
          </button>
        </div>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md space-y-3.5">
        {/* 受邀家庭预览卡片（当存在邀请码且匹配成功） */}
        <InvitePreviewCard previewData={previewData} loading={previewLoading} />

        {/* 核心注册表单 */}
        <CuteCard className="py-6 px-6 shadow-soft">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                用户名（用于登录）
              </label>
              <CuteInput
                type="text"
                placeholder="英文字母或数字，如 yeye123"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                登录密码（至少 8 位）
              </label>
              <CuteInput
                type="password"
                placeholder="请设置 8 位及以上密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            {/* 角色与称谓快速选择 */}
            <RoleSelectorGrid
              relation={relation}
              onSelectRelation={(r, label) => {
                setRelation(r);
                if (!displayName) setDisplayName(label);
              }}
              displayName={displayName}
              onDisplayNameChange={setDisplayName}
            />

            {/* 家庭邀请码部分 */}
            <div className="pt-2 border-t border-divider/60">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Users size={14} className="text-primary" />
                  <label className="block text-xs font-semibold text-text-secondary">
                    家庭专属邀请码
                  </label>
                </div>
                {previewLoading && (
                  <span className="text-[10px] text-primary animate-pulse">正在核对...</span>
                )}
              </div>
              <CuteInput
                type="text"
                placeholder="输入 6 位家庭邀请码（可选）"
                value={inviteCode}
                onChange={handleInviteCodeChange}
                maxLength={10}
              />
              <p className="text-[11px] text-text-muted mt-1 leading-relaxed">
                {previewData?.found
                  ? "已自动锁定受邀家庭，注册后直接同步已有宝宝档案。"
                  : "若不填写，注册后将为你创建全新家庭空间，并由你添加宝宝。"}
              </p>
            </div>

            {/* 提交按钮 */}
            <div className="pt-2">
              <CuteButton
                type="submit"
                variant="primary"
                size="lg"
                className="w-full justify-center"
                disabled={loading}
              >
                <UserPlus size={18} className="mr-2" />
                {loading
                  ? "正在处理中..."
                  : previewData?.found
                  ? `立即加入【${previewData.family?.name || "家庭"}】`
                  : "创建账号与家庭空间"}
              </CuteButton>
            </div>
          </form>

          <div className="mt-5 text-center text-xs text-text-secondary">
            已有账号？{" "}
            <Link href="/login" className="font-semibold text-primary hover:underline">
              直接登录
            </Link>
          </div>
        </CuteCard>

        {/* 版本信息 */}
        <div className="text-center text-[10px] text-text-muted/60">
          宝宝成长工作台 {APP_VERSION} · 全家协同记录
        </div>
      </div>

      {/* 产品全景功能介绍弹窗 */}
      <FeatureTourModal
        isOpen={isTourModalOpen}
        onClose={() => setIsTourModalOpen(false)}
      />
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-bg-canvas flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <RegisterForm />
    </Suspense>
  );
}
