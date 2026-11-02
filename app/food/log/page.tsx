"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/ui/AppHeader";
import { useToast } from "@/components/ui/Toast";
import { useBabyStore } from "@/stores/useBabyStore";
import { FoodLogForm } from "@/components/records/FoodLogForm";
import { useRecordIdentityReady } from "@/lib/hooks/useRecordIdentityReady";

export default function FoodLogPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const addFoodLogRecord = useBabyStore((s) => s.addFoodLogRecord);
  const identityReady = useRecordIdentityReady();

  const [saving, setSaving] = useState(false);

  const handleSubmit = async (data: any) => {
    setSaving(true);
    try {
      await addFoodLogRecord(data);
      showToast("辅食记录已保存 ✨");
      setTimeout(() => router.push("/food"), 600);
    } catch (err: any) {
      showToast(err?.message || "保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto min-h-[100dvh] w-full max-w-4xl bg-bg px-4 pb-32 pt-4 sm:px-6 lg:px-8">
      <AppHeader title="辅食记录" showBack />

      <div className="mt-3">
        <FoodLogForm
          mode="create"
          onSubmit={handleSubmit}
          saving={saving || !identityReady}
        />
      </div>
    </div>
  );
}
