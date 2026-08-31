"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/ui/AppHeader";
import { useToast } from "@/components/ui/Toast";
import { useBabyStore } from "@/stores/useBabyStore";
import { FeedingForm } from "@/components/records/FeedingForm";

export default function FeedingRecordPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const addFeedingRecord = useBabyStore((s) => s.addFeedingRecord);
  const fetchFeedingRecords = useBabyStore((s) => s.fetchFeedingRecords);

  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetchFeedingRecords(undefined, true);
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  };

  const handleSubmit = async (data: any) => {
    setSaving(true);
    try {
      await addFeedingRecord(data);
      showToast("喂养记录已保存 ✨");
      setTimeout(() => router.push("/"), 500);
    } catch (err: any) {
      showToast(err?.message || "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-bg max-w-md mx-auto px-4 pt-4 pb-36">
      <AppHeader
        title="记录喂养"
        showBack
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />

      <div className="mt-3">
        <FeedingForm
          mode="create"
          onSubmit={handleSubmit}
          saving={saving}
        />
      </div>
    </div>
  );
}
