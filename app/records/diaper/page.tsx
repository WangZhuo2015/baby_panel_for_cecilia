"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/ui/AppHeader";
import { useToast } from "@/components/ui/Toast";
import { useBabyStore } from "@/stores/useBabyStore";
import { DiaperForm } from "@/components/records/DiaperForm";

export default function DiaperRecordPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const addDiaperRecord = useBabyStore((s) => s.addDiaperRecord);
  const fetchDiaperRecords = useBabyStore((s) => s.fetchDiaperRecords);

  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetchDiaperRecords(true);
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  };

  const handleSubmit = async (data: any) => {
    setSaving(true);
    try {
      await addDiaperRecord(data);
      showToast("记录成功 ✨");
      setTimeout(() => router.push("/"), 600);
    } catch (err: any) {
      showToast(err?.message || "保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-bg max-w-md mx-auto px-4 pt-4 pb-36">
      <AppHeader
        title="尿布记录"
        showBack
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />

      <div className="mt-3">
        <DiaperForm
          mode="create"
          onSubmit={handleSubmit}
          saving={saving}
        />
      </div>
    </div>
  );
}
