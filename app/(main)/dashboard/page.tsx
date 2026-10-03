"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Droplets, Moon, TrendingUp, RefreshCw } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useBabyStore } from "@/stores/useBabyStore";
import { CuteCard } from "@/components/ui/CuteCard";
import type { CareTrends } from "@/lib/care-trends";
import { isValidDateStr } from "@/lib/date";

export default function DashboardPage() {
  const params = useSearchParams();
  const baby = useBabyStore(s => s.baby);
  const fetchBaby = useBabyStore(s => s.fetchBaby);
  const babyId = baby?.id;
  const [days, setDays] = useState<7 | 30>(7);
  const [endDate, setEndDate] = useState(() => {
    const date = params.get("endDate");
    return date && isValidDateStr(date) ? date : "";
  });
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string; data?: CareTrends; error?: string }>({ key: "" });
  const key = `${babyId ?? ""}/${days}/${endDate}/${revision}`;
  useEffect(() => { if (!baby) void fetchBaby(); }, [baby, fetchBaby]);
  useEffect(() => {
    if (!babyId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ babyId, days: String(days) });
    if (endDate) query.set("endDate", endDate);
    void (async () => {
      try {
        const response = await fetch(`/api/records/trends?${query}`, { signal: controller.signal, cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "趋势数据加载失败");
        if (payload.babyId !== babyId || !Array.isArray(payload.days) || payload.days.length !== days) throw new Error("趋势数据不完整，请重试");
        if (!controller.signal.aborted) setState({ key, data: payload });
      } catch (error) {
        if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : "趋势数据加载失败" });
      }
    })();
    return () => controller.abort();
  }, [babyId, days, endDate, revision, key]);
  const data = state.key === key ? state.data : undefined;
  const error = state.key === key ? state.error : undefined;
  const measuredDays = data?.days.filter(day => day.recordedMilkMl !== null) ?? [];
  const milkTotal = measuredDays.reduce((sum, day) => sum + day.recordedMilkMl!, 0);
  const latest = measuredDays.at(-1), prior = measuredDays.at(-2);
  const change = latest && prior ? Math.round((latest.recordedMilkMl! - prior.recordedMilkMl!) * 100) / 100 : null;
  const sleepDays = data?.days.filter(day => day.sleepMinutes !== null) ?? [];
  const averageSleep = sleepDays.length ? (sleepDays.reduce((sum, day) => sum + day.sleepMinutes!, 0) / sleepDays.length / 60).toFixed(1) : "—";
  const chart = data?.days.map(day => ({ ...day, sleepHours: day.sleepMinutes === null ? null : Math.round(day.sleepMinutes / 6) / 10 }));

  return <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
    <div className="flex items-center justify-between gap-3">
      <Link href="/" className="text-sm text-text-secondary inline-flex items-center gap-1"><ArrowLeft size={16} />今日</Link>
      <Link href="/daily-summary" className="text-sm text-primary">查看日报</Link>
    </div>
    <header>
      <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2"><TrendingUp className="text-primary" />成长趋势看板</h1>
      <p className="text-sm text-text-secondary mt-2">{baby?.nickname ?? "宝宝"}的奶量、睡眠与照护记录变化</p>
    </header>
    <CuteCard className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl bg-primary/10 p-1" aria-label="统计范围">
          {([7, 30] as const).map(value => <button key={value} aria-pressed={days === value} onClick={() => setDays(value)} className={`px-4 py-2 rounded-lg text-sm ${days === value ? "bg-primary text-white" : "text-text-secondary"}`}>近 {value} 天</button>)}
        </div>
        <label className="text-sm text-text-secondary flex flex-wrap items-center gap-2">截至日期
          <input aria-label="截至日期" type="date" value={endDate || data?.endDate || ""} max={data?.today} onChange={e => setEndDate(e.target.value)} className="rounded-xl border border-primary/20 bg-card p-2 min-w-0 text-text-primary" />
        </label>
        <button aria-label="刷新趋势" onClick={() => setRevision(v => v + 1)} className="p-2 text-primary"><RefreshCw size={18} /></button>
      </div>
      <p className="text-xs text-text-muted">按{data ? `家庭时区 ${data.timeZone}` : "家庭时区"}统计。奶量仅包含明确记录的毫升数；亲喂分钟单独展示，未记录日期不按 0 计算。</p>
    </CuteCard>
    {error ? <CuteCard className="p-6 text-center"><p role="alert">{error}</p><button className="mt-3 text-primary" onClick={() => setRevision(v => v + 1)}>重试</button></CuteCard>
      : !data ? <p role="status" className="py-12 text-center text-text-secondary">{baby ? "正在加载趋势…" : "请选择宝宝后查看趋势"}</p>
      : <div data-testid="care-trends-loaded" className="space-y-5">
        {!data.days.some(day => day.hasRecords) && <CuteCard className="p-6 text-center"><p className="font-bold">这段时间还没有喂养、睡眠或尿布记录</p><p className="mt-2 text-sm text-text-secondary">选择其他日期，或先记一笔照护记录。</p></CuteCard>}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[{ label: "平均每日记录奶量", value: measuredDays.length ? `${Math.round(milkTotal / measuredDays.length)} ml` : "—", detail: `${measuredDays.length} 个有奶量记录的日期` },
            { label: "最近两次日奶量变化", value: change === null ? "—" : `${change > 0 ? "+" : ""}${change} ml`, detail: latest && prior ? `${prior.date.slice(5)} → ${latest.date.slice(5)}` : "至少需要两天奶量记录" },
            { label: "喂养次数", value: `${data.days.reduce((sum, day) => sum + day.feedingCount, 0)} 次`, detail: `亲喂 ${data.days.reduce((sum, day) => sum + day.breastMinutes, 0)} 分钟` },
            { label: "平均每日记录睡眠", value: `${averageSleep}${sleepDays.length ? " 小时" : ""}`, detail: `${sleepDays.length} 个有睡眠记录的日期` }].map(item => <CuteCard className="p-4" key={item.label}><p className="text-xs text-text-secondary">{item.label}</p><p className="text-xl font-bold mt-2 text-text-primary">{item.value}</p><p className="text-xs text-text-muted mt-2">{item.detail}</p></CuteCard>)}
        </div>
        <CuteCard className="p-4 sm:p-5">
          <h2 className="font-bold flex items-center gap-2"><Droplets size={18} className="text-sky-500" />每日记录奶量 <span className="text-xs text-text-muted">ml</span></h2>
          <div className="h-64 mt-4 w-full min-w-0" role="img" aria-label="每日记录奶量折线图，下方表格提供完整数值">
            <ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{ left: -15, right: 12, top: 8 }}><CartesianGrid strokeDasharray="3 3" opacity={0.25} /><XAxis dataKey="date" tickFormatter={v => String(v).slice(5)} tick={{ fontSize: 11 }} minTickGap={18} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Line type="linear" name="记录奶量 (ml)" dataKey="recordedMilkMl" stroke="#0ea5e9" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} /></LineChart></ResponsiveContainer>
          </div>
        </CuteCard>
        <CuteCard className="p-4 sm:p-5">
          <h2 className="font-bold flex items-center gap-2"><Moon size={18} className="text-violet-500" />每日记录睡眠 <span className="text-xs text-text-muted">小时</span></h2>
          <div className="h-52 mt-4 w-full min-w-0" role="img" aria-label="每日睡眠时长折线图，下方表格提供完整数值">
            <ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{ left: -15, right: 12, top: 8 }}><CartesianGrid strokeDasharray="3 3" opacity={0.25} /><XAxis dataKey="date" tickFormatter={v => String(v).slice(5)} tick={{ fontSize: 11 }} minTickGap={18} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Line type="linear" name="记录睡眠 (小时)" dataKey="sleepHours" stroke="#8b5cf6" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} /></LineChart></ResponsiveContainer>
          </div>
          <p className="text-xs text-text-muted">跨日睡眠分摊到各日，重叠时段只计算一次；进行中的睡眠统计到本次刷新时间。</p>
        </CuteCard>
        <CuteCard className="p-4">
          <h2 className="font-bold mb-3">逐日明细</h2>
          <div className="overflow-x-auto"><table className="w-full text-xs text-right whitespace-nowrap"><thead><tr className="text-text-secondary"><th className="text-left p-2">日期</th><th className="p-2">奶量 ml</th><th className="p-2">喂养次</th><th className="p-2">亲喂分</th><th className="p-2">睡眠小时</th><th className="p-2">尿布次</th></tr></thead><tbody>{[...data.days].reverse().map(day => <tr key={day.date} className="border-t border-primary/10"><td className="text-left p-2"><Link className="text-primary underline" href={`/daily-summary?date=${day.date}`}>{day.date.slice(5)}</Link></td><td className="p-2">{day.recordedMilkMl ?? "—"}</td><td className="p-2">{day.feedingCount || "—"}</td><td className="p-2">{day.breastMinutes || "—"}</td><td className="p-2">{day.sleepMinutes === null ? "—" : (day.sleepMinutes / 60).toFixed(1)}</td><td className="p-2">{day.diaperCount || "—"}</td></tr>)}</tbody></table></div>
        </CuteCard>
      </div>}
  </div>;
}
