"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/ui/AppHeader";
import { CuteCard } from "@/components/ui/CuteCard";
import { CuteButton } from "@/components/ui/CuteButton";
import { CuteInput } from "@/components/ui/CuteInput";
import { useToast } from "@/components/ui/Toast";
import { useBabyStore } from "@/stores/useBabyStore";
import { Users, Copy, Check, UserPlus, LogOut, ShieldCheck, Smartphone, Sparkles, ChevronRight, Baby, Camera } from "lucide-react";
import { InstallGuideModal } from "@/components/ui/InstallGuideModal";
import { APP_VERSION } from "@/lib/version";

export default function FamilyPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const {
    user,
    family,
    familyMembers,
    baby,
    fetchUser,
    fetchFamilyMembers,
    fetchBaby,
    joinFamily,
    logout,
  } = useBabyStore();

  const [copied, setCopied] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);

  useEffect(() => {
    fetchBaby();
    fetchUser().then((u) => {
      if (!u) {
        router.push("/login");
      } else {
        fetchFamilyMembers();
      }
    });
  }, [fetchBaby, fetchUser, fetchFamilyMembers, router]);

  const handleCopyCode = () => {
    if (!family?.inviteCode) return;
    navigator.clipboard.writeText(family.inviteCode);
    setCopied(true);
    showToast("家庭邀请码已复制到剪贴板 📋");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) {
      showToast("请输入邀请码");
      return;
    }
    setJoining(true);
    try {
      await joinFamily(joinCode.trim());
      showToast("成功加入家庭！");
      setJoinCode("");
    } catch (err: any) {
      showToast(err?.message || "加入家庭失败，请检查邀请码");
    } finally {
      setJoining(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    showToast("已退出登录");
    router.push("/login");
  };

  const relationLabels: Record<string, string> = {
    mother: "妈妈 👩",
    father: "爸爸 👨",
    grandparent: "长辈 👵",
    caregiver: "看护 🧑‍🍼",
    parent: "家长 🧑",
    other: "家庭成员 👶",
  };

  return (
    <div className="min-h-screen bg-bg-canvas px-4 pt-4 pb-28">
      <AppHeader title="家庭成员与共享" showBack />

      {/* Family Info & Invite Card */}
      <CuteCard variant="gradient" className="mt-4 mb-5 shadow-card">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users className="text-primary" size={20} />
            <h2 className="text-base font-bold text-text-primary">
              {family?.name || "家庭育儿空间"}
            </h2>
          </div>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-white/70 text-primary font-medium">
            {familyMembers.length} 位成员
          </span>
        </div>

        <p className="text-xs text-text-secondary mb-4 leading-relaxed">
          把下方邀请码分享给宝爸、爷爷奶奶或看护人员，即可共享宝宝的全部喂奶、睡眠、成长与疫苗记录。
        </p>

        <div className="bg-white/80 backdrop-blur rounded-2xl p-3.5 flex items-center justify-between border border-primary/20">
          <div>
            <span className="text-[11px] text-text-muted block">家庭专属邀请码</span>
            <span className="text-xl font-mono font-bold tracking-widest text-primary">
              {family?.inviteCode || "------"}
            </span>
          </div>
          <CuteButton size="sm" variant="primary" onClick={handleCopyCode}>
            {copied ? <Check size={14} className="mr-1" /> : <Copy size={14} className="mr-1" />}
            {copied ? "已复制" : "复制邀请码"}
          </CuteButton>
        </div>
      </CuteCard>

      {/* Baby Info & Avatar Card */}
      <h3 className="text-sm font-semibold text-text-secondary mb-2 px-1">宝宝档案</h3>
      <CuteCard
        className="p-3.5 mb-6 bg-gradient-to-r from-primary-light/70 via-pink-50/50 to-lavender/15 border border-primary/25 cursor-pointer hover:shadow-md transition-all"
        onClick={() => router.push("/onboarding")}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-12 h-12 rounded-full bg-primary-soft flex items-center justify-center overflow-hidden shadow-soft">
                {baby?.avatarUrl ? (
                  <img src={baby.avatarUrl} alt={baby.nickname} className="w-full h-full object-cover" />
                ) : (
                  <Baby size={24} className="text-primary" />
                )}
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center shadow-xs">
                <Camera size={11} />
              </div>
            </div>
            <div>
              <p className="text-sm font-bold text-text-primary flex items-center gap-1.5">
                {baby?.nickname || "未设置宝宝"}
                <span className="text-xs font-normal text-text-secondary">
                  {baby?.gender === "male" ? "👦" : "👧"}
                </span>
              </p>
              <p className="text-xs text-primary font-medium mt-0.5 flex items-center gap-0.5">
                点击更换头像与修改宝宝信息
              </p>
            </div>
          </div>
          <ChevronRight size={18} className="text-text-muted" />
        </div>
      </CuteCard>

      {/* Member list */}
      <h3 className="text-sm font-semibold text-text-secondary mb-3 px-1">当前家庭成员</h3>
      <div className="space-y-2.5 mb-6">
        {familyMembers.map((member) => (
          <CuteCard key={member.id} className="p-3.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-soft text-primary font-bold flex items-center justify-center text-sm shadow-soft">
                {member.displayName.slice(0, 1)}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold text-text-primary">
                    {member.displayName}
                  </span>
                  {member.userId === user?.id && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-mint/15 text-mint font-medium">
                      我
                    </span>
                  )}
                  {member.role === "admin" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium flex items-center gap-0.5">
                      <ShieldCheck size={10} /> 创建者
                    </span>
                  )}
                </div>
                <span className="text-xs text-text-muted">
                  @{member.username} · {relationLabels[member.relation] || member.relation}
                </span>
              </div>
            </div>
          </CuteCard>
        ))}
      </div>

      {/* Join another family */}
      <h3 className="text-sm font-semibold text-text-secondary mb-3 px-1">加入其他家庭</h3>
      <CuteCard className="p-4 mb-6">
        <form onSubmit={handleJoin} className="flex gap-2">
          <CuteInput
            placeholder="输入其他家庭的 6 位邀请码"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            className="flex-1"
          />
          <CuteButton type="submit" variant="secondary" disabled={joining}>
            <UserPlus size={16} className="mr-1" />
            {joining ? "加入中..." : "加入"}
          </CuteButton>
        </form>
      </CuteCard>

      {/* 📱 PWA / Add to Home Screen Setting Card */}
      <h3 className="text-sm font-semibold text-text-secondary mb-3 px-1">应用安装与体验</h3>
      <CuteCard
        className="p-4 mb-6 bg-gradient-to-r from-primary-light/70 via-pink-50 to-lavender/15 border border-primary/25 cursor-pointer hover:shadow-md transition-all"
        onClick={() => setIsInstallModalOpen(true)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary text-white flex items-center justify-center shadow-button shrink-0">
              <Smartphone size={20} />
            </div>
            <div>
              <p className="text-xs font-bold text-text-primary flex items-center gap-1">
                保存为手机桌面 App
                <Sparkles size={13} className="text-primary" />
              </p>
              <p className="text-[11px] text-text-secondary mt-0.5">
                支持 iOS / Android 一键全屏，查看详细添加图文指引
              </p>
            </div>
          </div>
          <ChevronRight size={16} className="text-text-muted" />
        </div>
      </CuteCard>

      {/* Account Settings / Logout */}
      <div className="pt-4 border-t border-divider text-center">
        <CuteButton
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="text-text-muted hover:text-red-500"
        >
          <LogOut size={16} className="mr-1.5" />
          退出当前账号 ({user?.username})
        </CuteButton>
      </div>

      {/* App Version Info */}
      <div className="mt-8 text-center space-y-0.5">
        <p className="text-[11px] font-medium text-text-muted">
          宝宝成长工作台 <span className="px-1.5 py-0.5 rounded-full bg-primary-light text-primary text-[10px] font-bold">{APP_VERSION}</span>
        </p>
        <p className="text-[10px] text-text-muted/60">
          全功能离线支持 · 实时数据同步
        </p>
      </div>

      <InstallGuideModal
        isOpen={isInstallModalOpen}
        onClose={() => setIsInstallModalOpen(false)}
      />
    </div>
  );
}
