"use client";

export default function MainLoading() {
  return (
    <div className="px-4 pt-safe-6 pb-36 max-w-md mx-auto space-y-4 animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-primary-light" />
          <div className="space-y-2">
            <div className="h-4 w-20 bg-primary-light rounded-full" />
            <div className="h-3 w-16 bg-primary-light/60 rounded-full" />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="w-9 h-9 rounded-full bg-primary-light/40" />
          <div className="w-10 h-10 rounded-full bg-primary-light/40" />
        </div>
      </div>

      {/* Cards skeleton */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="h-28 rounded-3xl bg-sky-50/80" />
        <div className="h-28 rounded-3xl bg-purple-50/80" />
      </div>

      {/* Stats skeleton */}
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-2xl bg-primary-light/30" />
        ))}
      </div>

      {/* Timeline skeleton */}
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 rounded-2xl bg-primary-light/20" />
        ))}
      </div>
    </div>
  );
}
