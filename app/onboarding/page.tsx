"use client";
import { useState, useEffect } from "react";
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

export default function OnboardingPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const baby = useBabyStore((s) => s.baby);
  const saveBaby = useBabyStore((s) => s.saveBaby);

  const [nickname, setNickname] = useState("");
  const [birthDate, setBirthDate] = useState(getLocalDateStr());
  const [gender, setGender] = useState<"female" | "male">("female");
  const [gestationalAge, setGestationalAge] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  useEffect(() => {
    if (baby) {
      setNickname(baby.nickname);
      setBirthDate(baby.birthDate || getLocalDateStr());
      setGender(baby.gender === "male" ? "male" : "female");
      if (baby.gestationalAge) setGestationalAge(String(baby.gestationalAge));
      if (baby.avatarUrl) setAvatarUrl(baby.avatarUrl);
    }
  }, [baby]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast("图片不能超过 5MB");
      return;
    }
    setAvatarUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/baby/avatar", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "上传失败");
      }
      const data = await res.json();
      setAvatarUrl(data.avatarUrl);
      useBabyStore.getState().fetchBaby();
      showToast("头像已更新 ✨");
    } catch (err: any) {
      showToast(err?.message || "头像上传失败");
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleSave = async () => {
    const name = nickname.trim();
    if (!name) {
      showToast("请输入宝宝昵称");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      showToast("请选择宝宝生日");
      return;
    }
    setSaving(true);
    try {
      const gAge = gestationalAge ? parseInt(gestationalAge, 10) : undefined;
      await saveBaby({
        nickname: name,
        birthDate,
        gender,
        gestationalAge: Number.isFinite(gAge) ? gAge : undefined,
      });
      showToast(baby ? "宝宝信息已更新 ✨" : "欢迎加入，记录从今天开始 ✨");
      router.replace("/");
    } catch (err: any) {
      showToast(err?.message || "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-bg max-w-md mx-auto">
      <AppHeader title={baby ? "宝宝信息" : "欢迎使用"} />

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
                    <img src={avatarUrl} alt="宝宝头像" className="w-full h-full object-cover" />
                  ) : (
                    <Camera size={24} className="text-primary/50" />
                  )}
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center shadow-button">
                  <Camera size={12} />
                </div>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  className="hidden"
                  onChange={handleAvatarUpload}
                  disabled={avatarUploading}
                />
              </label>
              <div className="flex-1">
                <p className="text-sm font-medium text-text-primary">点击上传头像</p>
                <p className="text-[10px] text-text-muted mt-0.5">支持 JPG、PNG、WebP，最大 5MB</p>
              </div>
            </div>
          </FormSection>

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
        </div>
      </div>
    </div>
  );
}
