"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/ui/AppHeader";
import { useToast } from "@/components/ui/Toast";
import { useBabyStore } from "@/stores/useBabyStore";
import { calculateAge } from "@/lib/age";
import { GrowthForm } from "@/components/records/GrowthForm";

export default function GrowthAddPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const baby = useBabyStore((s) => s.baby);
  const fetchUser = useBabyStore((s) => s.fetchUser);
  const addGrowthMeasurement = useBabyStore((s) => s.addGrowthMeasurement);
  const refreshAll = useBabyStore((s) => s.refreshAll);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetchUser();
  }, [fetchUser]);

  const handleSave = async (data: any) => {
    if (saving) return;
    if (!baby?.birthDate) {
      showToast("请先设置宝宝生日");
      router.push("/onboarding");
      return;
    }
    setSaving(true);
    try {
      const { months, label } = calculateAge(baby.birthDate, data.date);
      await addGrowthMeasurement({
        ...data,
        ageInMonths: months,
        ageLabel: label,
      });
      await refreshAll();
      showToast("记录保存成功 ✨");
      setTimeout(() => router.push("/growth"), 400);
    } catch (e: any) {
      showToast(e?.message || "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-bg">
      <AppHeader title="添加测量记录" showBack />
      <div className="px-4 pt-4 pb-16 max-w-md md:max-w-lg mx-auto">
        <GrowthForm onSubmit={handleSave} onCancel={() => router.back()} saving={saving} />
      </div>
    </div>
  );
}
