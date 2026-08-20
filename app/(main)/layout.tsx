"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { BottomNav } from "@/components/navigation/BottomNav";
import { useBabyStore } from "@/stores/useBabyStore";

const hideNavRoutes = [
  "/records/feeding",
  "/records/sleep",
  "/records/diaper",
  "/growth/add",
  "/food/log",
];

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const fetchBaby = useBabyStore((s) => s.fetchBaby);
  const hideNav = hideNavRoutes.includes(pathname);

  useEffect(() => {
    if (!useBabyStore.getState().baby) fetchBaby();
  }, [fetchBaby]);

  return (
    <div className="flex flex-col min-h-[100dvh]">
      <main
        className={`flex-1 ${hideNav ? "pb-4" : "pb-24"} animate-fade-in`}
      >
        {children}
      </main>
      {!hideNav && <BottomNav />}
    </div>
  );
}
