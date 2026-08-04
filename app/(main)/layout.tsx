"use client";

import { usePathname } from "next/navigation";
import { BottomNav } from "@/components/navigation/BottomNav";

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
  const hideNav = hideNavRoutes.includes(pathname);

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
