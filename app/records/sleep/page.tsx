"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/ui/AppHeader";
import { useToast } from "@/components/ui/Toast";
import { useBabyStore } from "@/stores/useBabyStore";
import { SleepForm } from "@/components/records/SleepForm";
import { useRecordIdentityReady } from "@/lib/hooks/useRecordIdentityReady";

export function LiveSleepDuration({ startIso }: { startIso: string }) {
  const [sec, setSec] = useState(() =>
    Math.max(0, Math.floor((Date.now() - new Date(startIso).getTime()) / 1000))
  );
  useEffect(() => {
    const tick = () =>
      setSec(Math.max(0, Math.floor((Date.now() - new Date(startIso).getTime()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [startIso]);

  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  const text = h > 0 ? `${h}小时${String(m).padStart(2, "0")}分` : `${m}分${String(ss).padStart(2, "0")}秒`;
  return <>{text}</>;
}

export default function SleepRecordPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const addSleepRecord = useBabyStore((s) => s.addSleepRecord);
  const fetchSleepRecords = useBabyStore((s) => s.fetchSleepRecords);
  const identityReady = useRecordIdentityReady();

  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetchSleepRecords(true);
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  };

  const handleSubmit = async (data: any) => {
    setSaving(true);
    try {
      await addSleepRecord(data);
      showToast("睡眠记录已保存 ✨");
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
        title="记录睡眠"
        showBack
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />

      <div className="mt-3">
        <SleepForm
          mode="create"
          onSubmit={handleSubmit}
          saving={saving || !identityReady}
        />
      </div>
    </div>
  );
}
