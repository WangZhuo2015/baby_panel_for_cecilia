'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Syringe, Shield, Info, AlertTriangle, ChevronDown, ChevronUp, MapPin, CalendarDays, CheckCircle2, Circle, Baby } from 'lucide-react'
import { AppHeader, CuteCard, SectionTitle, SegmentControl, QuickAiButton } from '@/components/ui'
import DataVersionBadge from '@/components/ui/DataVersionBadge'
import { useBabyStore } from '@/stores/useBabyStore'
import { getLocalDateStr } from '@/lib/date'
import { calculateAge } from '@/lib/age'

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
  routineHealthyChildOption?: boolean | null
  manualReviewRequired?: boolean | null
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
}

interface ScheduleItem {
  key: string
  vaccineId: string
  doseNumber: number
  vaccineName: string
  doseLabel: string
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

function addMonths(dateStr: string, months: number): string {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setMonth(d.getMonth() + months)
  return getLocalDateStr(d)
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + days)
  return getLocalDateStr(d)
}

function diffDaysFromToday(dateStr: string): number {
  const today = new Date(`${getLocalDateStr()}T00:00:00`).getTime()
  const target = new Date(`${dateStr}T00:00:00`).getTime()
  return Math.round((target - today) / (1000 * 60 * 60 * 24))
}

function weekdayOf(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('zh-CN', { weekday: 'short' })
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
  { value: '7', label: '7天' },
  { value: '30', label: '30天' },
  { value: '90', label: '90天' },
  { value: 'all', label: '全部' },
]

export default function VaccinesPage() {
  const router = useRouter()
  const [vaccines, setVaccines] = useState<Vaccine[]>([])
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([])
  const [dataRelease, setDataRelease] = useState<{ asOf?: string | null; sources?: { organization?: string }[] } | null>(null)
  const [selections, setSelections] = useState<Record<string, boolean>>({})
  const [range, setRange] = useState('30')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const baby = useBabyStore((s) => s.baby)

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const [res, selRes] = await Promise.all([
        fetch('/api/vaccines'),
        fetch('/api/vaccines/selections'),
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
        setDataRelease(data.dataRelease ?? null);
      }
      if (selRes.ok) {
        const sels = await selRes.json();
        const map: Record<string, boolean> = {};
        for (const s of Array.isArray(sels) ? sels : []) {
          map[`${s.vaccineId}-${s.doseNumber}`] = s.selected;
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
          fetch('/api/vaccines'),
          fetch('/api/vaccines/selections'),
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
        setDataRelease(data.dataRelease ?? null)

        if (selRes.ok) {
          const sels = await selRes.json()
          const map: Record<string, boolean> = {}
          for (const s of Array.isArray(sels) ? sels : []) {
            map[`${s.vaccineId}-${s.doseNumber}`] = s.selected
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
    const items: ScheduleItem[] = []
    for (const entry of schedule) {
      const vaccine = vaccineById.get(entry.vaccineId)
      if (!vaccine || vaccine.routineHealthyChildOption === false) continue

      let date: string
      if (entry.ageDays != null) {
        date = addDays(birthDate, entry.ageDays)
      } else if (entry.ageMonths != null) {
        date = addMonths(birthDate, entry.ageMonths)
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
        date,
        diffDays: diffDaysFromToday(date),
        isOptional: entry.isOptional,
        programType: vaccine.programType,
        action: entry.action,
        manualReviewRequired: vaccine.manualReviewRequired ?? false,
      })
    }
    items.sort((a, b) => a.date.localeCompare(b.date))
    return items
  }, [schedule, vaccineById, birthDate])

  const visibleItems = useMemo(() => {
    if (range === 'all') return scheduleItems
    const max = Number(range)
    return scheduleItems.filter((item) => item.diffDays >= 0 && item.diffDays <= max)
  }, [scheduleItems, range])

  const upcomingCount = scheduleItems.filter((i) => i.diffDays >= 0 && i.diffDays <= 30).length
  const overdueCount = scheduleItems.filter((i) => i.diffDays < 0).length

  const isSelected = useCallback(
    (item: ScheduleItem) => selections[item.key] ?? !item.isOptional,
    [selections]
  )

  const toggleSelection = async (item: ScheduleItem) => {
    const current = isSelected(item)
    const next = !current
    setSelections((prev) => ({ ...prev, [item.key]: next }))
    try {
      const res = await fetch('/api/vaccines/selections', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vaccineId: item.vaccineId,
          doseNumber: item.doseNumber,
          selected: next,
        }),
      })
      if (!res.ok) throw new Error('保存失败')
    } catch {
      setSelections((prev) => ({ ...prev, [item.key]: current }))
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

  // Filter: hide vaccines with routineHealthyChildOption === false
  const timelineVaccines = vaccines.filter(v => v.routineHealthyChildOption !== false)

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
    <div className="min-h-screen bg-bg pb-36">
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
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-primary-soft to-primary/30 flex items-center justify-center overflow-hidden shadow-xs shrink-0 group-hover:ring-2 group-hover:ring-primary/40 transition-all">
              {baby?.avatarUrl ? (
                <img src={baby.avatarUrl} alt={baby.nickname} className="w-full h-full object-cover" />
              ) : (
                <Baby size={22} className="text-primary" />
              )}
            </div>
            <div>
              <p className="text-sm font-bold text-text-primary group-hover:text-primary transition-colors">
                {baby?.nickname ?? "宝宝"} 疫苗接种规划
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
                    const selected = isSelected(item)
                    const overdue = item.diffDays < 0
                    const dueToday = item.diffDays === 0
                    const colors = PROGRAM_COLORS[item.programType] || PROGRAM_COLORS.non_program

                    const countdownLabel = overdue
                      ? `已过期 ${-item.diffDays} 天`
                      : dueToday
                        ? '今天'
                        : item.diffDays === 1
                          ? '明天'
                          : `${item.diffDays} 天后`

                    return (
                      <CuteCard key={item.key} className={overdue || !selected ? 'opacity-60' : ''}>
                        <div className="flex items-center gap-3">
                          {/* Date block */}
                          <div className={`flex-shrink-0 w-14 text-center rounded-xl py-2 ${overdue ? 'bg-gray-100' : dueToday ? 'bg-primary text-white' : 'bg-primary-light/60'}`}>
                            <p className={`text-[10px] ${overdue ? 'text-gray-400' : dueToday ? 'text-white/80' : 'text-text-muted'}`}>
                              {weekdayOf(item.date)}
                            </p>
                            <p className={`text-lg font-bold leading-tight ${overdue ? 'text-gray-400' : dueToday ? 'text-white' : 'text-primary'}`}>
                              {Number(item.date.slice(8, 10))}
                            </p>
                            <p className={`text-[10px] ${overdue ? 'text-gray-300' : dueToday ? 'text-white/70' : 'text-text-muted'}`}>
                              {item.date.slice(5, 7)}月
                            </p>
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-semibold text-text-primary truncate">
                                {item.vaccineName}
                              </p>
                              <span className="text-[10px] text-text-muted">{item.doseLabel}</span>
                            </div>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${colors.bg} ${colors.text} ${colors.border}`}>
                                {PROGRAM_LABELS[item.programType] || item.programType}
                              </span>
                              <span className={`text-[10px] font-medium ${overdue ? 'text-gray-400' : dueToday ? 'text-primary' : 'text-text-muted'}`}>
                                {countdownLabel}
                              </span>
                              {item.action && (
                                <span className="text-[10px] text-gray-400">{item.action}</span>
                              )}
                            </div>
                          </div>

                          {/* Selection toggle */}
                          <button
                            type="button"
                            onClick={() => toggleSelection(item)}
                            aria-label={selected ? '取消接种' : '选择接种'}
                            className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                              selected
                                ? 'bg-primary text-white shadow-button'
                                : 'bg-gray-100 text-gray-300'
                            }`}
                          >
                            {selected ? <CheckCircle2 size={20} /> : <Circle size={20} />}
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
