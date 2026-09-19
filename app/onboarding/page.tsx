"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Baby, Sparkles, Camera } from "lucide-react";
import { AppHeader } from "@/components/ui/AppHeader";
import { CuteButton } from "@/components/ui/CuteButton";
import { CuteInput } from "@/components/ui/CuteInput";
import { CuteCard } from "@/components/ui/CuteCard";
import { FormSection } from "@/components/ui/FormSection";
import { SegmentControl } from "@/components/ui/SegmentControl";
import { useToast } from "@/components/ui/Toast";
import { useBabyStore } from "@/stores/useBabyStore";
import { getLocalDateStr } from "@/lib/date";
import { APP_VERSION } from "@/lib/version";
import { AvatarCropModal } from "@/components/ui/AvatarCropModal";
import { FamilyCreatedShareModal } from "@/components/ui/FamilyCreatedShareModal";
import { BabyAvatar } from "@/components/ui/BabyAvatar";

export default function OnboardingPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const baby = useBabyStore((s) => s.baby);
  const family = useBabyStore((s) => s.family);
  const families = useBabyStore((s) => s.families);
  const [selectedFamilyId, setSelectedFamilyId] = useState("");
  const targetFamilyId = baby?.familyId || (families.length === 1
    ? families[0].id
    : families.find((item) => item.id === selectedFamilyId)?.id);
  const selectedFamilyRef = useRef(targetFamilyId);
  selectedFamilyRef.current = targetFamilyId;

  const handleFamilyChange = (v: string) => {
    setSelectedFamilyId(v);
    setAvatarUrl(null);
  };
  const fetchBaby = useBabyStore((s) => s.fetchBaby);
  const fetchUser = useBabyStore((s) => s.fetchUser);
  const saveBaby = useBabyStore((s) => s.saveBaby);

  const [pageLoading, setPageLoading] = useState(true);
  const [nickname, setNickname] = useState("");
  const [birthDate, setBirthDate] = useState(getLocalDateStr());
  const [gender, setGender] = useState<"female" | "male">("female");
  const [gestationalAge, setGestationalAge] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  // Avatar cropping modal state
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [isCropModalOpen, setIsCropModalOpen] = useState(false);

  // 建档成功邀请家人分享弹窗状态
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [createdBabyName, setCreatedBabyName] = useState("");


  useEffect(() => {
    let isMounted = true;
    Promise.all([fetchUser(), fetchBaby()]).finally(() => {
      if (isMounted) setPageLoading(false);
    });
    return () => {
      isMounted = false;
    };
  }, [fetchUser, fetchBaby]);

  useEffect(() => {
    if (baby) {
      setNickname(baby.nickname);
      setBirthDate(baby.birthDate || getLocalDateStr());
      setGender(baby.gender === "male" ? "male" : "female");
      if (baby.gestationalAge) setGestationalAge(String(baby.gestationalAge));
      if (baby.avatarUrl) setAvatarUrl(baby.avatarUrl);
    }
  }, [baby]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      showToast("图片大小不能超过 25MB", "error");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setCropImageSrc(reader.result);
        setIsCropModalOpen(true);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleCropComplete = async (croppedBlob: Blob) => {
    setIsCropModalOpen(false);
    if (!baby && !targetFamilyId) {
      showToast("请先选择宝宝所属家庭", "error");
      return;
    }
    const uploadFamilyId = targetFamilyId;
    setAvatarUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", croppedBlob, "avatar.jpg");
      if (baby) formData.append("babyId", baby.id);
      else if (targetFamilyId) formData.append("familyId", targetFamilyId);
      const res = await fetch("/api/baby/avatar", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "头像上传失败");
      }
      if (typeof selectedFamilyRef !== "undefined" && selectedFamilyRef && selectedFamilyRef.current !== uploadFamilyId) {
        return;
      }
      setAvatarUrl(data.avatarUrl);
      useBabyStore.getState().fetchBaby();
      showToast("头像已更新并完成裁剪 ✨", "success");
    } catch (err: any) {
      showToast(err?.message || "头像保存失败，请重试", "error");
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleSave = async () => {
    const name = nickname.trim();
    if (!name) {
      showToast("请输入宝宝昵称", "error");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      showToast("请选择宝宝生日", "error");
      return;
    }
    setSaving(true);
    try {
      const gAge = gestationalAge ? parseInt(gestationalAge, 10) : undefined;
      const isNewBaby = !baby;
      if (isNewBaby && !targetFamilyId) {
        showToast("请选择宝宝所属家庭", "error");
        return;
      }
      await saveBaby({
        nickname: name,
        birthDate,
        gender,
        gestationalAge: Number.isFinite(gAge) ? gAge : undefined,
        avatarUrl: avatarUrl || undefined,
        ...(targetFamilyId ? { familyId: targetFamilyId } : {}),
      });

      if (isNewBaby) {
        showToast("欢迎加入，记录从今天开始 ✨", "success");
        await fetchUser();
        setCreatedBabyName(name);
        setIsShareModalOpen(true);
      } else {
        showToast("宝宝信息已更新 ✨", "success");
        router.replace("/");
      }
    } catch (err: any) {
      showToast(err?.message || "保存失败，请重试", "error");
    } finally {
      setSaving(false);
    }
  };


  if (pageLoading) {
    return (
      <div className="min-h-[100dvh] bg-bg max-w-md mx-auto flex items-center justify-center p-4">
        <div className="text-center space-y-2 text-xs text-text-muted">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p>正在加载宝宝档案...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-bg max-w-md mx-auto">
      <AppHeader title={baby ? "宝宝资料与头像" : "欢迎使用"} showBack={!!baby} />

      <div className="px-4 pt-2 pb-8">
        {/* Welcome card */}
        {!baby && (
          <CuteCard variant="gradient" className="mb-6">
            <div className="flex flex-col items-center text-center py-4">
              <div className="w-16 h-16 rounded-full bg-white/70 flex items-center justify-center mb-3">
                <Baby size={30} className="text-primary" />
              </div>
              <p className="text-base font-semibold text-text-primary mb-1">
                欢迎使用宝宝成长工作台
              </p>
              <p className="text-sm text-text-secondary">
                先设置宝宝的信息，就能开始记录啦～
              </p>
            </div>
          </CuteCard>
        )}

        <div className="space-y-4">
          {/* Avatar */}
          <FormSection title="宝宝头像（可选）">
            <div className="flex items-center gap-4">
              <label className="relative cursor-pointer group">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary-soft to-primary/30 flex items-center justify-center overflow-hidden shadow-soft border-2 border-dashed border-primary/30 group-hover:border-primary/60 transition-colors">
                  {avatarUploading ? (
                    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  ) : avatarUrl ? (
                    <BabyAvatar src={avatarUrl} alt="宝宝头像" size={80} />
                  ) : (
                    <Camera size={24} className="text-primary/50" />
                  )}
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center shadow-button">
                  <Camera size={12} />
                </div>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileSelect}
                  disabled={avatarUploading}
                />
              </label>
              <div className="flex-1">
                <p className="text-sm font-medium text-text-primary">
                  {avatarUrl ? "点击头像更换照片" : "点击上传宝宝头像"}
                </p>
                <p className="text-[10px] text-text-muted mt-0.5">
                  支持拖动居中与自由缩放裁剪 · 最大 25MB
                </p>
              </div>
            </div>
          </FormSection>

          {/* Family selection (only when membership is ambiguous) */}
          {!baby && families.length !== 1 && (
            <FormSection title="宝宝所属家庭">
              <SegmentControl
                options={families.map((item) => ({ value: item.id, label: item.name }))}
                value={targetFamilyId || ""}
                onChange={handleFamilyChange}
                scrollable
              />
              <p className="text-[10px] text-text-muted pl-1 mt-1">
                您已加入多个家庭，请选择新宝宝记入哪一个
              </p>
            </FormSection>
          )}

          {/* Nickname */}
          <FormSection title="宝宝昵称">
            <CuteInput
              placeholder="如：糖糖、果果、安安…"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={12}
            />
          </FormSection>

          {/* Birth date */}
          <FormSection title="出生日期">
            <CuteInput
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
            />
            <p className="text-[10px] text-text-muted pl-1 mt-1">
              用于计算月龄、疫苗接种日期与成长曲线
            </p>
          </FormSection>

          {/* Gender */}
          <FormSection title="性别">
            <SegmentControl
              options={[
                { value: "female", label: "👧 女孩" },
                { value: "male", label: "👦 男孩" },
              ]}
              value={gender}
              onChange={(v) => setGender(v as "female" | "male")}
            />
          </FormSection>

          {/* Gestational Age (Optional) */}
          <FormSection title="出生孕周（可选）">
            <CuteInput
              type="number"
              placeholder="足月通常为40周，早产宝宝可填写（如36）"
              value={gestationalAge}
              onChange={(e) => setGestationalAge(e.target.value)}
              min={24}
              max={44}
            />
            <p className="text-[10px] text-text-muted pl-1 mt-1">
              早产宝宝（&lt;37周）系统会自动计算纠正月龄评估发育里程碑
            </p>
          </FormSection>

          <div className="pt-4">
            <CuteButton fullWidth size="lg" onClick={handleSave} disabled={saving}>
              {saving ? "保存中..." : baby ? "保存修改" : "开始使用"}
            </CuteButton>
          </div>

          {!baby && (
            <p className="text-[10px] text-text-muted text-center flex items-center justify-center gap-1">
              <Sparkles size={12} />
              之后随时可以在个人中心修改宝宝信息
            </p>
          )}

          <div className="pt-4 text-center text-[10px] text-text-muted/60">
            宝宝成长工作台 {APP_VERSION}
          </div>
        </div>
      </div>

      <AvatarCropModal
        isOpen={isCropModalOpen}
        imageSrc={cropImageSrc}
        onClose={() => {
          setIsCropModalOpen(false);
          setCropImageSrc(null);
        }}
        onCropComplete={handleCropComplete}
      />

      <FamilyCreatedShareModal
        isOpen={isShareModalOpen}
        onClose={() => {
          setIsShareModalOpen(false);
          router.replace("/");
        }}
        babyName={createdBabyName}
        familyName={family?.name}
        inviteCode={family?.inviteCode}
      />
    </div>
  );
}

