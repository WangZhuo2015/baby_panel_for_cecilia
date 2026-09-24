"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/ui/AppHeader";
import { CuteCard } from "@/components/ui/CuteCard";
import { CuteButton } from "@/components/ui/CuteButton";
import { CuteInput } from "@/components/ui/CuteInput";
import { useToast } from "@/components/ui/Toast";
import { useBabyStore } from "@/stores/useBabyStore";
import { Users, Copy, Check, UserPlus, LogOut, ShieldCheck, Smartphone, Sparkles, ChevronRight, Baby, Camera, Link as LinkIcon, Share2, BookOpen, Key, Bot } from "lucide-react";
import { InstallGuideModal } from "@/components/ui/InstallGuideModal";
import { FeatureTourModal } from "@/components/ui/FeatureTourModal";
import { PersonalTokenModal } from "@/components/user/PersonalTokenModal";
import { AiUsageModal } from "@/components/mcp/AiUsageModal";
import { APP_VERSION } from "@/lib/version";
import { BabyAvatar } from "@/components/ui/BabyAvatar";

export default function FamilyPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const {
    user,
    family,
    familyMembers,
    babyMembers,
    babyMembersSupported,
    families,
    babies,
    selectedBabyId,
    baby,
    fetchUser,
    fetchFamilyMembers,
    fetchBabyMembers,
    grantBabyMember,
    revokeBabyMember,
    fetchBaby,
    joinFamily,
    selectBaby,
    createFamilyInvite,
    logout,
  } = useBabyStore();

  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);
  const [isTourModalOpen, setIsTourModalOpen] = useState(false);
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [isAiUsageModalOpen, setIsAiUsageModalOpen] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [switchingBaby, setSwitchingBaby] = useState<string | null>(null);
  const [updatingBabyMember, setUpdatingBabyMember] = useState<string | null>(null);

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

  useEffect(() => {
    if (user) fetchBabyMembers(selectedBabyId ?? "");
  }, [user, selectedBabyId, fetchBabyMembers]);


  const getInviteUrl = () => {
    if (typeof window === "undefined" || !family?.inviteCode) return "";
    return `${window.location.origin}/register?invite=${family.inviteCode}`;
  };

  const handleCreateInvite = async () => {
    if (!family?.id || creatingInvite) return;
    setCreatingInvite(true);
    try {
      const result = await createFamilyInvite(7);
      showToast("一次性邀请码 " + result.inviteCode + " 已生成", "success");
    } catch (err: any) {
      showToast(err?.message || "生成邀请码失败，请稍后重试", "error");
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleSelectBaby = async (babyId: string) => {
    if (babyId === selectedBabyId || switchingBaby) return;
    setSwitchingBaby(babyId);
    try {
      await selectBaby(babyId);
      await fetchFamilyMembers();
      showToast("已切换宝宝，正在加载独立记录", "success");
    } catch (err: any) {
      showToast(err?.message || "切换宝宝失败，请稍后重试", "error");
    } finally {
      setSwitchingBaby(null);
    }
  };

  const handleCopyCode = () => {
    if (!family?.inviteCode) return;
    navigator.clipboard.writeText(family.inviteCode);
    setCopied(true);
    showToast("家庭邀请码已复制到剪贴板 📋");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyLink = () => {
    const url = getInviteUrl();
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    showToast("专属邀请链接已复制，发给家人点击即可一键加入 ✨");
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyInviteText = () => {
    const url = getInviteUrl();
    if (!url) return;
    const babyName = baby?.nickname || "宝宝";
    const text = `🍼 快来加入【${babyName}】的家庭育儿空间！点击专属链接直接加入，全家一起记录喂奶、睡眠与生长健康：\n${url}`;
    navigator.clipboard.writeText(text);
    setCopiedText(true);
    showToast("完整邀请文案已复制，可直接粘贴微信分享给家人 💌");
    setTimeout(() => setCopiedText(false), 2000);
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) {
      showToast("请输入邀请码");
      return;
    }
    setJoining(true);
    try {
      const result = await joinFamily(joinCode.trim());
      showToast(result.message || "成功加入家庭！");
      setJoinCode("");
    } catch (err: any) {
      showToast(err?.message || "加入家庭失败，请检查邀请码");
    } finally {
      setJoining(false);
    }
  };

  const handleGrantBabyAccess = async (userId: string) => {
    if (!selectedBabyId || updatingBabyMember) return;
    setUpdatingBabyMember(userId);
    try {
      await grantBabyMember(selectedBabyId, userId);
      showToast("已授权该成员访问当前宝宝", "success");
    } catch (err: any) {
      showToast(err?.message || "授权宝宝访问失败，请稍后重试", "error");
    } finally {
      setUpdatingBabyMember(null);
    }
  };

  const handleRevokeBabyAccess = async (userId: string) => {
    if (!selectedBabyId || updatingBabyMember) return;
    setUpdatingBabyMember(userId);
    try {
      await revokeBabyMember(selectedBabyId, userId);
      showToast("已撤回该成员的宝宝访问权限", "success");
    } catch (err: any) {
      showToast(err?.message || "撤回宝宝访问失败，请稍后重试", "error");
    } finally {
      setUpdatingBabyMember(null);
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
    grandfather: "爷爷 👴",
    grandmother: "奶奶 👵",
    maternal_grandmother: "姥姥 👵",
    maternal_grandfather: "姥爷 👴",
    caregiver: "育儿嫂/看护 🧑‍🍼",
    parent: "家长 🧑",
    grandparent: "长辈 👵",
    other: "家庭成员 👶",
  };


  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([fetchBaby(true), fetchUser(), fetchFamilyMembers()]);
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  };

  return (
    <div className="min-h-screen bg-bg-canvas px-4 pt-4 pb-28 max-w-4xl mx-auto">
      <AppHeader title="家庭成员与共享" showBack onRefresh={handleRefresh} refreshing={refreshing} />

      {/* Family Info & Invite Card */}
      <CuteCard variant="gradient" className="mt-4 mb-5 shadow-card">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users className="text-primary" size={20} />
            <h2 className="text-base font-bold text-text-primary">
              {family?.name || "家庭育儿空间"}
            </h2>
          </div>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-white dark:bg-card border border-primary/20 text-primary font-medium shadow-2xs">
            {familyMembers.length} 位成员
          </span>
        </div>

        <p className="text-xs text-text-secondary mb-4 leading-relaxed">
          {babyMembersSupported
            ? "把专属链接或邀请码分享给家人。加入家庭后，宝宝管理员还可以按宝宝单独授权访问记录。"
            : "把专属链接或邀请码分享给宝爸、爷爷奶奶、姥姥姥爷或看护人员，点击即可直接加入，共享喂奶、睡眠、成长与疫苗全部记录。"}
        </p>

        {/* 邀请码与快捷操作栏 */}
        <div className="bg-white dark:bg-card rounded-2xl p-3.5 border border-primary/25 shadow-xs space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-[11px] text-text-secondary dark:text-gray-400 block font-medium">家庭一次性邀请码</span>
              <span className="text-xl font-mono font-bold tracking-widest text-primary">
                {family?.inviteCode || "尚未生成"}
              </span>
              {family?.inviteExpiresAt && (
                <span className="text-[10px] text-text-muted block mt-0.5">
                  有效期至 {new Date(family.inviteExpiresAt).toLocaleString("zh-CN")}
                </span>
              )}
            </div>
            {family?.inviteCode ? (
              <CuteButton size="sm" variant="secondary" onClick={handleCopyCode}>
                {copied ? <Check size={14} className="mr-1" /> : <Copy size={14} className="mr-1" />}
                {copied ? "已复制码" : "复制邀请码"}
              </CuteButton>
            ) : (
              <CuteButton size="sm" variant="primary" onClick={handleCreateInvite} disabled={creatingInvite}>
                <Key size={14} className="mr-1" />
                {creatingInvite ? "生成中..." : "生成邀请码"}
              </CuteButton>
            )}
          </div>

          {/* 快捷专属链接与文案 */}
          {family?.inviteCode && (
            <div className="pt-2.5 border-t border-divider/60 flex flex-col sm:flex-row gap-2">
              <CuteButton
                size="sm"
                variant="primary"
                onClick={handleCopyLink}
                className="flex-1 justify-center"
              >
                {copiedLink ? <Check size={14} className="mr-1.5" /> : <LinkIcon size={14} className="mr-1.5" />}
                {copiedLink ? "链接已复制" : "复制专属加入链接"}
              </CuteButton>

              <CuteButton
                size="sm"
                variant="secondary"
                onClick={handleCopyInviteText}
                className="flex-1 justify-center"
              >
                {copiedText ? <Check size={14} className="mr-1.5" /> : <Share2 size={14} className="mr-1.5" />}
                {copiedText ? "文案已复制" : "复制微信邀请文案"}
              </CuteButton>
            </div>
          )}
        </div>
      </CuteCard>


      {families.length > 1 && (
        <CuteCard className="p-3.5 mb-5">
          <p className="text-xs font-semibold text-text-secondary mb-2">已加入的家庭</p>
          <div className="flex flex-wrap gap-2">
            {families.map((item) => (
              <span
                key={item.id}
                className={item.id === family?.id
                  ? "px-2.5 py-1 rounded-full bg-primary text-white text-xs font-medium"
                  : "px-2.5 py-1 rounded-full bg-primary-soft/50 text-text-secondary text-xs"}
              >
                {item.name}
              </span>
            ))}
          </div>
        </CuteCard>
      )}

      {babies.length > 1 && (
        <CuteCard className="p-3.5 mb-5">
          <p className="text-xs font-semibold text-text-secondary mb-2">选择当前宝宝</p>
          <div className="grid grid-cols-2 gap-2">
            {babies.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectBaby(item.id)}
                disabled={Boolean(switchingBaby)}
                className={item.id === selectedBabyId
                  ? "flex items-center gap-2 rounded-xl border border-primary bg-primary-soft/60 px-2.5 py-2 text-left"
                  : "flex items-center gap-2 rounded-xl border border-divider px-2.5 py-2 text-left hover:border-primary/50"}
              >
                {item.avatarUrl ? (
                  <BabyAvatar src={item.avatarUrl} alt={item.nickname} size={30} />
                ) : (
                  <span className="w-[30px] h-[30px] rounded-full bg-primary-soft flex items-center justify-center"><Baby size={16} className="text-primary" /></span>
                )}
                <span className="min-w-0">
                  <span className="block text-xs font-semibold truncate">{item.nickname}</span>
                  <span className="block text-[10px] text-text-muted truncate">
                    {families.find((familyItem) => familyItem.id === item.familyId)?.name || "家庭"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </CuteCard>
      )}

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
                  <BabyAvatar src={baby.avatarUrl} alt={baby.nickname} size={48} />
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
                  {member.username ? "@" + member.username + " · " : ""}{member.relation ? (relationLabels[member.relation] || member.relation) : "已授权成员"}
                </span>
              </div>
            </div>
          </CuteCard>
        ))}
      </div>

      {/* Baby-level access control */}
      {babyMembersSupported && (
        <>
          <h3 className="text-sm font-semibold text-text-secondary mb-3 px-1">宝宝访问权限</h3>
          {baby && selectedBabyId ? (
        <CuteCard className="p-4 mb-6">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-sm font-bold text-text-primary">{baby.nickname} 的授权成员</p>
              <p className="text-[11px] text-text-secondary mt-1 leading-relaxed">
                加入家庭只建立家庭关系；只有这里列出的成员才能访问这个宝宝的记录。
              </p>
            </div>
            <ShieldCheck size={18} className="text-primary shrink-0 mt-0.5" />
          </div>

          <div className="space-y-2">
            {babyMembers.length === 0 ? (
              <p className="text-xs text-text-muted py-2">暂时没有可显示的授权成员。</p>
            ) : babyMembers.map((member) => {
              const familyMember = familyMembers.find((item) => item.userId === member.userId);
              const isCurrentUser = member.userId === user?.id;
              const roleLabel = member.role === "admin" ? "宝宝管理员" : member.role === "viewer" ? "仅查看" : "可编辑记录";
              return (
                <div key={`${member.babyId}:${member.userId}`} className="flex items-center justify-between gap-3 rounded-xl border border-divider px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-text-primary truncate">
                      {familyMember?.displayName || member.displayName}
                      {isCurrentUser && <span className="ml-1.5 text-[10px] text-mint">当前账号</span>}
                    </p>
                    <p className="text-[10px] text-text-muted truncate">
                      {familyMember?.username ? `@${familyMember.username} · ` : ""}{roleLabel}
                    </p>
                  </div>
                  {babyMembers.some((item) => item.userId === user?.id && item.role === "admin") && !isCurrentUser && (
                    <CuteButton
                      size="sm"
                      variant="secondary"
                      onClick={() => handleRevokeBabyAccess(member.userId)}
                      disabled={Boolean(updatingBabyMember)}
                    >
                      {updatingBabyMember === member.userId ? "处理中..." : "撤回访问"}
                    </CuteButton>
                  )}
                </div>
              );
            })}
          </div>

          {babyMembers.some((item) => item.userId === user?.id && item.role === "admin") && (
            <div className="mt-3 pt-3 border-t border-divider/70 space-y-2">
              <p className="text-[11px] font-semibold text-text-secondary">授权当前家庭成员</p>
              {familyMembers.filter((member) => !babyMembers.some((item) => item.userId === member.userId)).map((member) => (
                <div key={member.userId} className="flex items-center justify-between gap-3 rounded-xl bg-primary-soft/25 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-text-primary truncate">{member.displayName}</p>
                    <p className="text-[10px] text-text-muted truncate">
                      {member.username ? `@${member.username} · ` : ""}已加入家庭，等待宝宝授权
                    </p>
                  </div>
                  <CuteButton
                    size="sm"
                    variant="primary"
                    onClick={() => handleGrantBabyAccess(member.userId)}
                    disabled={Boolean(updatingBabyMember)}
                  >
                    {updatingBabyMember === member.userId ? "处理中..." : "授权访问"}
                  </CuteButton>
                </div>
              ))}
              {familyMembers.every((member) => babyMembers.some((item) => item.userId === member.userId)) && (
                <p className="text-[11px] text-text-muted">当前家庭成员都已获得此宝宝的访问权限。</p>
              )}
            </div>
          )}
        </CuteCard>
          ) : (
        <CuteCard className="p-4 mb-6 border border-amber-200/70 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800/40">
          <p className="text-xs font-semibold text-text-primary">等待宝宝管理员授权</p>
          <p className="text-[11px] text-text-secondary mt-1 leading-relaxed">
            你已加入家庭，但还没有宝宝访问权限。请联系对应宝宝的管理员在“宝宝访问权限”中授权后再查看记录。
          </p>
        </CuteCard>
          )}
        </>
      )}

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

      {/* 📖 Feature Tour & Parenting Guide */}
      <h3 className="text-sm font-semibold text-text-secondary mb-3 px-1">功能与育儿指南</h3>
      <CuteCard
        className="p-4 mb-6 bg-gradient-to-r from-blue-50/70 via-sky-50 to-indigo-50/20 border border-blue-200/60 dark:border-blue-800/40 cursor-pointer hover:shadow-md transition-all"
        onClick={() => setIsTourModalOpen(true)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-button shrink-0">
              <BookOpen size={20} />
            </div>
            <div>
              <p className="text-xs font-bold text-text-primary flex items-center gap-1">
                了解功能与使用指南
                <Sparkles size={13} className="text-blue-500" />
              </p>
              <p className="text-[11px] text-text-secondary mt-0.5">
                WHO生长曲线 · 辅食排敏 · 疫苗日历 · 抽屉/语音录入
              </p>
            </div>
          </div>
          <ChevronRight size={16} className="text-text-muted" />
        </div>
      </CuteCard>

      {/* 🔑 个人设备专属设置（与家庭完全解耦） */}
      <h3 className="text-sm font-semibold text-text-secondary mb-3 px-1">个人设备与 Siri 接入</h3>
      <CuteCard
        className="p-4 mb-6 bg-gradient-to-r from-indigo-50/70 via-primary-light/40 to-pink-50/50 dark:from-indigo-950/20 dark:to-primary/10 border border-primary/25 cursor-pointer hover:shadow-md transition-all"
        onClick={() => setIsTokenModalOpen(true)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary to-indigo-600 text-white flex items-center justify-center shadow-button shrink-0">
              <Key size={20} />
            </div>
            <div>
              <p className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                个人专属 Siri / 快捷指令 Token
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-primary/15 text-primary font-bold">每人专属</span>
              </p>
              <p className="text-[11px] text-text-secondary mt-0.5">
                独立于家庭 · 绑定您的 iPhone / HomePod，Siri 自动识别您的个人身份
              </p>
            </div>
          </div>
          <ChevronRight size={16} className="text-text-muted" />
        </div>
      </CuteCard>

      {/* 🤖 已连接 AI 与访问统计 (MCP) */}
      <h3 className="text-sm font-semibold text-text-secondary mb-3 px-1">外部 AI 连接与访问统计</h3>
      <CuteCard
        className="p-4 mb-6 bg-gradient-to-r from-purple-50/70 via-indigo-50/40 to-sky-50/50 dark:from-purple-950/20 dark:to-indigo-950/20 border border-purple-200/60 dark:border-purple-800/40 cursor-pointer hover:shadow-md transition-all"
        onClick={() => setIsAiUsageModalOpen(true)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-600 text-white flex items-center justify-center shadow-button shrink-0">
              <Bot size={20} />
            </div>
            <div>
              <p className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                已连接 AI 与 MCP 访问统计
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 font-bold">MCP 协议</span>
              </p>
              <p className="text-[11px] text-text-secondary mt-0.5">
                查看连接过的 Gemini Spark、ChatGPT、Claude 等 AI 及访问次数统计
              </p>
            </div>
          </div>
          <ChevronRight size={16} className="text-text-muted" />
        </div>
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

      <FeatureTourModal
        isOpen={isTourModalOpen}
        onClose={() => setIsTourModalOpen(false)}
      />

      <PersonalTokenModal
        isOpen={isTokenModalOpen}
        onClose={() => setIsTokenModalOpen(false)}
      />

      <AiUsageModal
        isOpen={isAiUsageModalOpen}
        onClose={() => setIsAiUsageModalOpen(false)}
        babyId={baby?.id}
      />
    </div>
  );
}
