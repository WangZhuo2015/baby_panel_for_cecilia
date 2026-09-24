'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Syringe, Shield, Info, AlertTriangle, ChevronDown, ChevronUp, MapPin, CalendarDays, CheckCircle2, Circle, Baby } from 'lucide-react'
import { AppHeader, CuteCard, SectionTitle, SegmentControl, QuickAiButton } from '@/components/ui'
import DataVersionBadge from '@/components/ui/DataVersionBadge'
import { BabyAvatar } from '@/components/ui/BabyAvatar'
import { useBabyStore } from '@/stores/useBabyStore'
import {
  getLocalDateStr,
  addDays,
  addMonths,
  diffDaysFromToday,
  getWeekdayStr,
} from '@/lib/date'
import { calculateAge } from '@/lib/age'
import { activeVaccineIds, buildExclusiveVaccineGroups } from '@/lib/vaccine-schedule'

interface Vaccine {
  id: string
  vaccineId: string
  name: string
  programType: 'national_immunization_program' | 'non_program' | 'provincial_immunization_program'
  diseases: string[]
  ageMinMonths?: number | null
  ageMaxMonths?: number | null
  strategy?: string | null
  strategyGroup?: string | null
  strategyOptions?: { name: string; description: string }[]
  substitutionRules?: string[] | null
  routineHealthyChildOption?: boolean | null
  manualReviewRequired?: boolean | null
  sexRestriction?: string | null
  regionalOverrides?: {
    regionCode: string
    regionName: string
    programType: string
    feeType: string
    effectiveDate: string
  }[]
  regionalOverride?: {
    regionCode: string
    regionName: string
    programType: string
    feeType: string
  }
  doses?: {
    doseNumber: number
    doseLabel: string
    recommendedAgeMonths?: number | null
  }[]
  notes?: string | null
  dataSource?: { organization?: string; asOf?: string }
}

interface ScheduleEntry {
  vaccineId: string
  doseNumber: number
  ageMonths: number | null
  ageDays: number | null
  ageLabel: string | null
  isOptional: boolean
  action: string | null
  selectionGroup?: string | null
}

interface StrategyGroupPayload {
  optionsJson?: unknown
}

interface EngineRulePayload {
  type?: string | null
  vaccineIdsJson?: unknown
  vaccineIds?: unknown
}

interface ScheduleItem {
  key: string
  vaccineId: string
  doseNumber: number
  vaccineName: string
  doseLabel: string
  ageLabel: string
  date: string
  diffDays: number
  isOptional: boolean
  programType: string
  action: string | null
  manualReviewRequired: boolean
}

const PROGRAM_LABELS: Record<string, string> = {
  national_immunization_program: '国家免疫规划',
  non_program: '非免疫规划（自费）',
  provincial_immunization_program: '地方免疫规划',
}

const PROGRAM_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  national_immunization_program: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-400' },
  non_program: { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200', dot: 'bg-violet-400' },
  provincial_immunization_program: { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200', dot: 'bg-sky-400' },
}

function getAgeLabel(months?: number | null): string {
  if (months === undefined || months === null) return ''
  if (months === 0) return '出生时'
  if (months < 12) return `${months}月龄`
  if (months % 12 === 0) return `${Math.floor(months / 12)}岁`
  return `${Math.floor(months / 12)}岁${months % 12}个月`
}

function VaccineCard({ vaccine }: { vaccine: Vaccine }) {
  const [expanded, setExpanded] = useState(false)
  const colors = PROGRAM_COLORS[vaccine.programType] || PROGRAM_COLORS.non_program

  const hasRegionalOverride = vaccine.regionalOverrides && vaccine.regionalOverrides.length > 0
  const regionalOverride = hasRegionalOverride ? vaccine.regionalOverrides![0] : null

  const displayProgramType = regionalOverride
    ? regionalOverride.programType
    : vaccine.programType
  const displayLabel = PROGRAM_LABELS[displayProgramType] || displayProgramType

  return (
    <CuteCard className="mb-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-gray-800 text-base">{vaccine.name}</h3>
            {vaccine.manualReviewRequired && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-medium border border-amber-200">
                <AlertTriangle className="w-3 h-3" />
                需接种门诊确认
              </span>
            )}
            {regionalOverride && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 text-xs font-medium border border-sky-200">
                <MapPin className="w-3 h-3" />
                {regionalOverride.regionName}
              </span>
            )}
          </div>

          <p className="text-sm text-gray-500 mt-1">预防：{vaccine.diseases?.join('、')}</p>

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${colors.bg} ${colors.text} ${colors.border}`}>
              <Shield className="w-3 h-3" />
              {displayLabel}
            </span>
            {vaccine.doses && vaccine.doses.length > 0 && (
              <span className="text-xs text-gray-400">
                {vaccine.doses.map(d => getAgeLabel(d.recommendedAgeMonths)).filter(Boolean).join(' · ')}
              </span>
            )}
          </div>

          {vaccine.notes && vaccine.notes !== null && (
            <p className="text-xs text-gray-400 mt-2 italic">{vaccine.notes}</p>
          )}
        </div>

        {vaccine.strategyOptions && vaccine.strategyOptions.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors shrink-0"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>

      {expanded && vaccine.strategyOptions && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-xs text-gray-400 mb-2 flex items-center gap-1">
            <Info className="w-3 h-3" />
            以下为不同策略方案，请根据医生建议与实际情况选择其一：
          </p>
          <div className="space-y-2">
            {vaccine.strategyOptions.map((option, idx) => (
              <div key={idx} className="bg-gray-50/80 rounded-xl p-3 border border-gray-100">
                <p className="font-medium text-sm text-gray-700">{option.name}</p>
                {option.description && (
                  <p className="text-xs text-gray-400 mt-1">{option.description}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </CuteCard>
  )
}

const RANGE_OPTIONS = [
  { value: 'pending', label: '待接种/待补' },
  { value: '30', label: '近30天' },
  { value: '90', label: '近90天' },
  { value: 'all', label: '全部规划' },
]

export default function VaccinesPage() {
  const router = useRouter()
  const baby = useBabyStore((s) => s.baby)
  const fetchUser = useBabyStore((s) => s.fetchUser)
  const [vaccines, setVaccines] = useState<Vaccine[]>([])
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([])
  const [strategyGroups, setStrategyGroups] = useState<StrategyGroupPayload[]>([])
  const [engineRules, setEngineRules] = useState<EngineRulePayload[]>([])
  const [dataRelease, setDataRelease] = useState<{ asOf?: string | null; sources?: { organization?: string }[] } | null>(null)
  const [selections, setSelections] = useState<Record<string, { selected: boolean; completed: boolean }>>({})
  const [range, setRange] = useState('pending')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // Ensure user session & baby profile are loaded
  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const [res, selRes] = await Promise.all([
        fetch('/api/vaccines', { headers: { 'x-growdesk-representation': 'extended' } }),
        fetch('/api/vaccines/selections', { headers: { 'x-growdesk-representation': 'extended' } }),
      ]);
      if (res.ok) {
        const data = await res.json();
        let list: Vaccine[] = [];
        if (Array.isArray(data)) {
          list = data;
        } else if (data.national || data.nonProgram || data.provincial) {
          list = [
            ...(data.national || []),
            ...(data.provincial || []),
            ...(data.nonProgram || []),
          ];
        } else {
          list = data.data || data.vaccines || [];
        }
        setVaccines(list);
        setSchedule(data.schedule || []);
        setStrategyGroups(Array.isArray(data.strategyGroups) ? data.strategyGroups : []);
        setEngineRules(Array.isArray(data.engineRules) ? data.engineRules : []);
        setDataRelease(data.dataRelease ?? null);
      }
      if (selRes.ok) {
        const sels = await selRes.json();
        const map: Record<string, { selected: boolean; completed: boolean }> = {};
        for (const s of Array.isArray(sels) ? sels : []) {
          map[`${s.vaccineId}-${s.doseNumber}`] = {
            selected: Boolean(s.selected),
            completed: Boolean(s.completed),
          };
        }
        setSelections(map);
      }
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  };

  useEffect(() => {
    async function fetchVaccines() {
      try {
        const [res, selRes] = await Promise.all([
          fetch('/api/vaccines', { headers: { 'x-growdesk-representation': 'extended' } }),
          fetch('/api/vaccines/selections', { headers: { 'x-growdesk-representation': 'extended' } }),
        ])
        if (!res.ok) throw new Error('加载失败')
        const data = await res.json()
        let list: Vaccine[] = []
        if (Array.isArray(data)) {
          list = data
        } else if (data.national || data.nonProgram || data.provincial) {
          list = [
            ...(data.national || []),
            ...(data.provincial || []),
            ...(data.nonProgram || []),
          ]
        } else {
          list = data.data || data.vaccines || []
        }
        setVaccines(list)
        setSchedule(data.schedule || [])
        setStrategyGroups(Array.isArray(data.strategyGroups) ? data.strategyGroups : [])
        setEngineRules(Array.isArray(data.engineRules) ? data.engineRules : [])
        setDataRelease(data.dataRelease ?? null)

        if (selRes.ok) {
          const sels = await selRes.json()
          const map: Record<string, { selected: boolean; completed: boolean }> = {}
          for (const s of Array.isArray(sels) ? sels : []) {
            map[`${s.vaccineId}-${s.doseNumber}`] = {
              selected: Boolean(s.selected),
              completed: Boolean(s.completed),
            }
          }
          setSelections(map)
        }
      } catch (err: any) {
        setError(err.message || '未知错误')
      } finally {
        setLoading(false)
      }
    }
    fetchVaccines()
  }, [])

  const vaccineById = useMemo(() => {
    const map = new Map<string, Vaccine>()
    for (const v of vaccines) map.set(v.vaccineId, v)
    return map
  }, [vaccines])

  const birthDate = baby?.birthDate ?? null

  const scheduleItems = useMemo<ScheduleItem[]>(() => {
    if (!birthDate) return []

    // 互斥组完全由排期、策略模板和规则数据推导；用户已选/已完成的产品优先，
    // 没有选择时使用数据中的首个候选，避免把同一策略的多套程序同时列为待接种。
    const exclusiveGroups = buildExclusiveVaccineGroups(
      schedule,
      strategyGroups,
      engineRules,
      vaccines.map((v) => ({
        vaccineId: v.vaccineId,
        name: v.name,
        substitutionRules: v.substitutionRules,
      })),
    )
    const activeVaccineInGroup = activeVaccineIds(exclusiveGroups, selections)

    const items: ScheduleItem[] = []
    for (const entry of schedule) {
      const vaccine = vaccineById.get(entry.vaccineId)
      if (!vaccine || vaccine.routineHealthyChildOption === false) continue
      // 性别限制过滤：如 HPV 仅女性
      if (vaccine.sexRestriction === "female" && baby?.gender !== "female") continue
      if (vaccine.sexRestriction === "male" && baby?.gender !== "male") continue

      // 互斥检查：仅隐藏明确属于某个互斥组但不是当前活动候选的产品。
      if (
        exclusiveGroups.some((group) => group.includes(entry.vaccineId)) &&
        !activeVaccineInGroup.has(entry.vaccineId)
      ) {
        continue
      }

      let date: string
      let ageLabel = ''
      if (entry.ageDays != null) {
        date = addDays(birthDate, entry.ageDays)
        ageLabel = entry.ageLabel || `${entry.ageDays}天`
      } else if (entry.ageMonths != null) {
        date = addMonths(birthDate, entry.ageMonths)
        ageLabel = entry.ageLabel || getAgeLabel(entry.ageMonths)
      } else {
        continue
      }

      const dose = vaccine.doses?.find((d) => d.doseNumber === entry.doseNumber)
      items.push({
        key: `${entry.vaccineId}-${entry.doseNumber}`,
        vaccineId: entry.vaccineId,
        doseNumber: entry.doseNumber,
        vaccineName: vaccine.name,
        doseLabel: dose?.doseLabel ?? `第${entry.doseNumber}剂`,
        ageLabel,
        date,
        diffDays: diffDaysFromToday(date),
        isOptional: entry.isOptional,
        programType: vaccine.programType,
        action: entry.action,
        manualReviewRequired: vaccine.manualReviewRequired ?? false,
      })
    }
    items.sort((a, b) => {
      const diff = a.date.localeCompare(b.date)
      if (diff !== 0) return diff
      return a.doseNumber - b.doseNumber
    })
    return items
  }, [schedule, strategyGroups, engineRules, vaccines, vaccineById, birthDate, selections])

  const isCompleted = useCallback(
    (item: ScheduleItem) => Boolean(selections[item.key]?.completed),
    [selections]
  )

  const isSelected = useCallback(
    (item: ScheduleItem) => selections[item.key]?.selected ?? !item.isOptional,
    [selections]
  )

  const visibleItems = useMemo(() => {
    if (range === 'all') return scheduleItems
    if (range === 'pending') {
      return scheduleItems.filter((item) => {
        const completed = isCompleted(item)
        return !completed && item.diffDays <= 60
      })
    }
    const max = Number(range)
    return scheduleItems.filter((item) => item.diffDays >= -30 && item.diffDays <= max)
  }, [scheduleItems, range, isCompleted])

  const upcomingCount = scheduleItems.filter((i) => !isCompleted(i) && i.diffDays >= 0 && i.diffDays <= 30).length
  const overdueCount = scheduleItems.filter((i) => !isCompleted(i) && i.diffDays < 0).length

  const toggleCompleted = async (item: ScheduleItem) => {
    const nextCompleted = !isCompleted(item)
    setSelections((prev) => ({
      ...prev,
      [item.key]: {
        selected: prev[item.key]?.selected ?? isSelected(item),
        completed: nextCompleted,
      },
    }))
    try {
      const res = await fetch('/api/vaccines/selections', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vaccineId: item.vaccineId,
          doseNumber: item.doseNumber,
          completed: nextCompleted,
        }),
      })
      if (!res.ok) throw new Error('保存接种状态失败')
    } catch {
      setSelections((prev) => ({
        ...prev,
        [item.key]: {
          selected: prev[item.key]?.selected ?? isSelected(item),
          completed: !nextCompleted,
        },
      }))
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg">
        <AppHeader title="疫苗接种指南" />
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="w-10 h-10 border-4 border-pink-200 border-t-pink-500 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-gray-400">正在加载疫苗信息...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-bg">
        <AppHeader title="疫苗接种指南" />
        <div className="flex items-center justify-center py-20 px-4">
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center max-w-sm w-full">
            <AlertTriangle className="w-8 h-8 text-red-300 mx-auto mb-2" />
            <p className="text-red-600 font-medium">加载失败</p>
            <p className="text-red-400 text-sm mt-1">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  // Filter: hide vaccines with routineHealthyChildOption === false and gender mismatch
  const timelineVaccines = vaccines.filter(v => v.routineHealthyChildOption !== false
    && !(v.sexRestriction === "female" && baby?.gender !== "female")
    && !(v.sexRestriction === "male" && baby?.gender !== "male"))

  // Group by program type
  const grouped: Record<string, Vaccine[]> = {}
  for (const v of timelineVaccines) {
    const key = v.programType
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(v)
  }

  const groupOrder = ['national_immunization_program', 'provincial_immunization_program', 'non_program']

  const dataSource = {
    organization: dataRelease?.sources?.[0]?.organization,
    asOf: dataRelease?.asOf,
  };

  return (
    <div className="min-h-screen bg-bg pb-36 workbench:pb-12 max-w-5xl mx-auto">
      <AppHeader title="健康与预防管理" onRefresh={handleRefresh} refreshing={refreshing} />

      <div className="px-4 pt-2 space-y-4">
        {/* Top Switcher */}
        <div className="flex items-center gap-2 bg-primary-light/60 p-1 rounded-2xl">
          <div className="flex-1 py-2 text-center text-xs font-bold rounded-xl bg-white text-primary shadow-soft whitespace-nowrap">
            💉 疫苗规划
          </div>
          <Link
            href="/health/medical"
            className="flex-1 py-2 text-center text-xs font-semibold rounded-xl text-text-secondary hover:text-primary transition-all whitespace-nowrap"
          >
            📑 化验与体检
          </Link>
        </div>
        {/* Header info */}
        <div className="flex items-center justify-between bg-white/70 p-3 rounded-2xl border border-primary/20 shadow-soft">
          <div
            className="flex items-center gap-3 cursor-pointer group flex-1"
            onClick={() => router.push("/onboarding")}
            title="点击修改宝宝资料与头像"
          >
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-primary-soft to-primary/30 flex items-center justify-center overflow-hidden shadow-xs shrink-0 group-hover:ring-2 group-hover:ring-primary/40 transition-all lg:hidden">
              {baby?.avatarUrl ? (
                <BabyAvatar src={baby.avatarUrl} alt={baby.nickname} size={44} />
              ) : (
                <Baby size={22} className="text-primary" />
              )}
            </div>
            <div>
              <p className="text-sm font-bold text-text-primary group-hover:text-primary transition-colors">
                <span className="lg:hidden">{baby?.nickname ?? "宝宝"} </span>疫苗接种规划
              </p>
              <p className="text-xs text-text-secondary">
                当前月龄 {calculateAge(birthDate || getLocalDateStr()).label} · 0–3岁接种时间表
              </p>
            </div>
          </div>

          <QuickAiButton
            contextType="vaccine"
            label="疫苗问答"
            contextTitle="疫苗接种与预防顾问"
            contextDetail={`近期30天内安排：${upcomingCount}项；已过期：${overdueCount}项`}
          />
        </div>

        {/* ── Upcoming schedule ─────────────────────────────── */}
        <div>
          <SectionTitle
            title="近期接种安排"
            icon={<CalendarDays size={16} className="text-primary" />}
            action={
              <span className="text-xs text-gray-400">
                {upcomingCount > 0 ? `30 天内 ${upcomingCount} 项` : ''}
                {overdueCount > 0 ? ` · 已过期 ${overdueCount} 项` : ''}
              </span>
            }
          />

          {!birthDate ? (
            <CuteCard className="mt-2">
              <div className="text-center py-4">
                <p className="text-sm text-gray-500 mb-3">请先设置宝宝生日，才能计算接种日期</p>
                <a
                  href="/onboarding"
                  className="inline-block px-5 py-2 rounded-full bg-primary text-white text-sm font-medium shadow-button btn-press"
                >
                  去设置宝宝信息
                </a>
              </div>
            </CuteCard>
          ) : (
            <>
              <div className="mt-2 mb-3">
                <SegmentControl
                  options={RANGE_OPTIONS}
                  value={range}
                  onChange={(v) => setRange(v)}
                />
              </div>

              {visibleItems.length === 0 ? (
                <CuteCard>
                  <p className="text-sm text-gray-400 text-center py-6">
                    {range === 'all' ? '暂无接种安排' : '该时间区间内暂无接种安排'}
                  </p>
                </CuteCard>
              ) : (
                <div className="space-y-2.5">
                  {visibleItems.map((item) => {
                    const completed = isCompleted(item)
                    const overdue = item.diffDays < 0 && !completed
                    const dueToday = item.diffDays === 0 && !completed
                    const colors = PROGRAM_COLORS[item.programType] || PROGRAM_COLORS.non_program

                    return (
                      <CuteCard
                        key={item.key}
                        className={`transition-all ${
                          completed
                            ? 'bg-emerald-50/40 border-emerald-200/60'
                            : overdue
                              ? 'bg-amber-50/30 border-amber-200/70 shadow-2xs'
                              : 'bg-card border-primary/10'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {/* Date block */}
                          <div
                            className={`flex-shrink-0 w-14 text-center rounded-2xl py-2 transition-colors ${
                              completed
                                ? 'bg-emerald-100/80 text-emerald-800'
                                : overdue
                                  ? 'bg-amber-100 text-amber-900 font-bold'
                                  : dueToday
                                    ? 'bg-primary text-white shadow-xs'
                                    : 'bg-primary-light/60 text-primary'
                            }`}
                          >
                            <p className={`text-[10px] font-medium ${dueToday ? 'text-white/80' : 'opacity-75'}`}>
                              {getWeekdayStr(item.date)}
                            </p>
                            <p className="text-lg font-extrabold leading-tight">
                              {Number(item.date.slice(8, 10))}
                            </p>
                            <p className={`text-[10px] ${dueToday ? 'text-white/80' : 'opacity-75'}`}>
                              {item.date.slice(5, 7)}月
                            </p>
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary-soft/70 text-primary font-bold shrink-0">
                                {item.ageLabel}
                              </span>
                              <p className={`text-sm font-bold truncate ${completed ? 'line-through text-text-muted' : 'text-text-primary'}`}>
                                {item.vaccineName}
                              </p>
                              <span className="text-[11px] text-text-muted shrink-0 font-medium">
                                {item.doseLabel}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${colors.bg} ${colors.text} ${colors.border}`}>
                                {PROGRAM_LABELS[item.programType] || item.programType}
                              </span>

                              {completed ? (
                                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                  <CheckCircle2 size={10} />
                                  已接种
                                </span>
                              ) : overdue ? (
                                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                  <AlertTriangle size={10} />
                                  待补种 (已过 {Math.abs(item.diffDays)} 天)
                                </span>
                              ) : dueToday ? (
                                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary text-white shadow-xs">
                                  今日应种
                                </span>
                              ) : (
                                <span className="text-[10px] font-medium text-text-muted">
                                  {item.diffDays === 1 ? '明天' : `${item.diffDays} 天后`}
                                </span>
                              )}

                              {item.action && (
                                <span className="text-[10px] text-text-muted truncate max-w-[150px]">
                                  {item.action}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Completion toggle button */}
                          <button
                            type="button"
                            onClick={() => toggleCompleted(item)}
                            title={completed ? '点击撤销已接种状态' : '点击标记此针已接种'}
                            aria-label={completed ? '点击撤销已接种状态' : '点击标记此针已接种'}
                            className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                              completed
                                ? 'bg-emerald-500 text-white shadow-sm ring-2 ring-emerald-200'
                                : 'bg-primary-soft/40 hover:bg-primary-soft text-text-muted hover:text-primary'
                            }`}
                          >
                            {completed ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                          </button>
                        </div>
                      </CuteCard>
                    )
                  })}
                </div>
              )}

              <p className="text-[10px] text-gray-400 mt-2 flex items-start gap-1 px-1">
                <Info className="w-3 h-3 shrink-0 mt-0.5" />
                日期按宝宝出生日期推算，实际接种请以接种门诊安排为准；点击右侧圆钮可自选是否接种
              </p>
            </>
          )}
        </div>

        {/* Legend */}
        <CuteCard>
          <p className="text-xs text-gray-400 mb-2 font-medium">图例说明</p>
          <div className="flex flex-wrap gap-2">
            {groupOrder.map(type => (
              <span
                key={type}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${PROGRAM_COLORS[type]?.bg || 'bg-gray-50'} ${PROGRAM_COLORS[type]?.text || 'text-gray-600'} ${PROGRAM_COLORS[type]?.border || 'border-gray-200'}`}
              >
                {PROGRAM_LABELS[type]}
              </span>
            ))}
          </div>
          <p className="text-xs text-gray-300 mt-2 flex items-start gap-1">
            <Info className="w-3 h-3 mt-0.5 shrink-0" />
            部分疫苗有多种策略方案（如乙脑减毒/灭活），可根据医生建议与实际情况选择其一
          </p>
        </CuteCard>

        {/* Vaccine groups */}
        {groupOrder.map(type => {
          const items = grouped[type]
          if (!items || items.length === 0) return null
          const colors = PROGRAM_COLORS[type] || PROGRAM_COLORS.non_program
          return (
            <div key={type}>
              <SectionTitle
                title={`${PROGRAM_LABELS[type]}（${items.length}种）`}
                icon={<span className={`inline-block w-2.5 h-2.5 rounded-full ${colors.dot}`} />}
              />
              <div className="mt-2">
                {items.map(vaccine => (
                  <VaccineCard key={vaccine.id} vaccine={vaccine} />
                ))}
              </div>
            </div>
          )
        })}

        {vaccines.length === 0 && (
          <div className="text-center py-12">
            <Syringe className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">暂无疫苗数据</p>
          </div>
        )}

        {/* Disclaimer */}
        <div className="flex items-start gap-2 px-1">
          <Info size={14} className="text-gray-300 shrink-0 mt-0.5" />
          <p className="text-xs text-gray-400 leading-relaxed">
            实际接种计划请以当地卫生部门及接种门诊安排为准。
          </p>
        </div>

        {/* Data source */}
        <DataVersionBadge
          organization={dataSource.organization || '未知'}
          asOf={dataSource.asOf || '未知'}
          className="px-1"
        />
      </div>
    </div>
  )
}
