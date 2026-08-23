'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, TrendingUp, Brain, MessageCircle, Hand, Sparkles, Info, AlertTriangle, Baby, PlayCircle } from 'lucide-react'
import { AppHeader, CuteCard, SegmentControl, SectionTitle, QuickAiButton } from '@/components/ui'
import DataVersionBadge from '@/components/ui/DataVersionBadge'
import { useBabyStore } from '@/stores/useBabyStore'
import { calculateAge } from '@/lib/age'
import type { DevelopmentCategory } from '@/types'

/* ── Milestone ────────────────────────────────────────────── */
interface Milestone {
  id: string
  title: string
  description: string
  category: DevelopmentCategory
  assessmentAgeMonths: number
}

/* ── Warning sign ─────────────────────────────────────────── */
interface WarningSign {
  id: string
  description: string
  ageMonths: number
  category?: string
}

/* ── Activity ─────────────────────────────────────────────── */
interface Activity {
  id: string
  title: string
  description?: string
  materials?: string[]
  steps?: Array<{ order: number; instruction: string }>
  safety?: string | null
  stopConditions?: string[] | null
  durationMinutes?: number | null
  frequencyPerWeek?: number | null
  category?: DevelopmentCategory | string
}

const categoryMap: { value: DevelopmentCategory; label: string; icon: React.ReactNode }[] = [
  { value: 'gross_motor', label: '大运动', icon: <TrendingUp size={14} /> },
  { value: 'cognitive', label: '认知', icon: <Brain size={14} /> },
  { value: 'language', label: '语言', icon: <MessageCircle size={14} /> },
  { value: 'fine_motor', label: '精细/感官', icon: <Hand size={14} /> },
]

function getCategoryIcon(category: DevelopmentCategory) {
  switch (category) {
    case 'gross_motor': return <TrendingUp size={18} className="text-pink-500" />
    case 'cognitive': return <Brain size={18} className="text-violet-500" />
    case 'language': return <MessageCircle size={18} className="text-sky-500" />
    case 'fine_motor': return <Hand size={18} className="text-emerald-500" />
  }
}

export default function DevelopmentPage() {
  const [selectedMonth, setSelectedMonth] = useState(6)
  const [activeTab, setActiveTab] = useState<DevelopmentCategory>('gross_motor')

  /* Data from API */
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [warningSigns, setWarningSigns] = useState<WarningSign[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /* Baby info from store */
  const baby = useBabyStore((s) => s.baby)

  const monthOptions = Array.from({ length: 36 }, (_, i) => i + 1)

  /* Preterm correction */
  const gestationalAge = baby?.gestationalAge ?? null
  const isPreterm = gestationalAge !== null && gestationalAge < 37
  const correctionWeeks = isPreterm ? (40 - gestationalAge!) : 0
  const correctedMonthOffset = isPreterm ? Math.round(correctionWeeks / 4.345) : 0

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      setError(null)
      try {
        const [msRes, actRes] = await Promise.all([
          fetch(`/api/development/milestones?category=${activeTab}&month=${selectedMonth}`),
          fetch(`/api/development/activities?month=${selectedMonth}`).catch(() => null),
        ])

        let msData: Milestone[] = []
        if (msRes.ok) {
          const msJson = await msRes.json()
          msData = Array.isArray(msJson) ? msJson : msJson.milestones || []
        }
        setMilestones(msData)

        if (actRes && actRes.ok) {
          const actJson = await actRes.json()
          setActivities(Array.isArray(actJson) ? actJson : actJson.activities || [])
        }
      } catch (err: any) {
        setError(err.message || '加载失败')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [activeTab, selectedMonth])

  /* Warning signs are independent of category and month — fetch once */
  useEffect(() => {
    async function fetchWarningSigns() {
      try {
        const wsRes = await fetch('/api/development/warning-signs')
        if (wsRes.ok) {
          const wsJson = await wsRes.json()
          setWarningSigns(Array.isArray(wsJson) ? wsJson : wsJson.warningSigns || [])
        }
      } catch {
        // Warning signs are optional
      }
    }
    fetchWarningSigns()
  }, [])

  /* Filter warning signs for current month */
  const relevantWarningSigns = warningSigns.filter(ws => ws.ageMonths <= selectedMonth)

  /* Data source (from milestones if available) */
  const milestoneDataSource = (milestones[0] as any)?.dataSource
  const warningSignDataSource = (warningSigns[0] as any)?.dataSource

  const router = useRouter()
  const age = baby ? calculateAge(baby.birthDate) : { months: 0, days: 0, label: "0月0天" }

  return (
    <div className="min-h-screen bg-bg pb-36">
      <AppHeader title="发育里程碑" />

      <div className="px-4 pt-4 space-y-4">
        {/* Baby profile header */}
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
                {baby?.nickname ?? "宝宝"} 发育评估
              </p>
              <p className="text-xs text-text-secondary">
                当前实际月龄 {age.label} · 评估第 {selectedMonth} 个月标准
              </p>
            </div>
          </div>

          <QuickAiButton
            contextType="development"
            label="发育问答"
            contextTitle="发育里程碑与早教顾问"
            contextDetail={`当前评估月龄：${selectedMonth}个月；早产纠正：${isPreterm ? "是" : "否"}`}
          />
        </div>

        {/* Preterm correction note */}
        {isPreterm && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 flex items-start gap-2">
            <Baby className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 leading-relaxed">
              宝宝胎龄 {gestationalAge} 周（早产），建议使用矫正月龄评估发育情况。
              当前矫正月龄约 {Math.max(0, selectedMonth - correctedMonthOffset)} 个月。
            </p>
          </div>
        )}

        {/* Month selector */}
        <div>
          <p className="text-xs text-gray-400 mb-2">选择月龄查看发育参考</p>
          <div className="overflow-x-auto scrollbar-hide -mx-4 px-4">
            <div className="flex gap-2">
              {monthOptions.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSelectedMonth(m)}
                  className={`flex-shrink-0 whitespace-nowrap py-2 px-4 rounded-full text-sm font-medium transition-all cursor-pointer min-h-[36px] ${
                    selectedMonth === m
                      ? 'bg-pink-400 text-white shadow-sm font-bold'
                      : 'bg-white text-gray-500 shadow-xs border border-gray-100'
                  }`}
                >
                  {m}月龄
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Category tabs */}
        <SegmentControl
          options={categoryMap.map((c) => ({ value: c.value, label: c.label }))}
          value={activeTab}
          onChange={(v) => setActiveTab(v as DevelopmentCategory)}
        />

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="w-8 h-8 border-3 border-pink-200 border-t-pink-500 rounded-full animate-spin mx-auto mb-2" />
              <p className="text-xs text-gray-400">加载中...</p>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
            <AlertTriangle className="w-6 h-6 text-red-300 mx-auto mb-1" />
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        {/* Milestone cards */}
        {!loading && !error && (
          <div className="space-y-3">
            {milestones.length > 0 ? (
              milestones.map((milestone) => (
                <CuteCard key={milestone.id}>
                  <div className="flex items-start gap-3">
                    <div className="flex items-center justify-center w-10 h-10 rounded-2xl bg-pink-50 shrink-0">
                      {getCategoryIcon(milestone.category)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-800 text-sm">
                        {milestone.title}
                      </h3>
                      <p className="text-xs text-gray-500 leading-relaxed mt-1">
                        多数儿童到这个年龄能够{milestone.description}
                      </p>
                    </div>
                  </div>
                </CuteCard>
              ))
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-gray-300">该月龄暂无此项发育参考数据</p>
              </div>
            )}
          </div>
        )}

        {/* ── 发育预警征象 ─────────────────────────────── */}
        {!loading && relevantWarningSigns.length > 0 && (
          <div>
            <SectionTitle
              title="发育预警征象"
              icon={<AlertTriangle size={16} className="text-amber-500" />}
            />
            <p className="text-xs text-gray-400 mt-1 px-1">如出现以下情况，建议咨询儿童保健或儿科专业人员</p>
            <div className="mt-2 space-y-2">
              {relevantWarningSigns.map((ws) => (
                <div
                  key={ws.id}
                  className="bg-amber-50/80 border border-amber-100 rounded-2xl p-3 flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-700 leading-relaxed">{ws.description}</p>
                </div>
              ))}
              <p className="text-xs text-gray-400 mt-2 flex items-start gap-1">
                <Info className="w-3 h-3 shrink-0 mt-0.5" />
                以上仅为参考信息，不代表诊断结论。如有疑虑，请及时咨询专业人员。
              </p>
            </div>
          </div>
        )}

        {/* ── 亲子活动 / 发展小游戏 ─────────────────────── */}
        {!loading && activities.length > 0 && (
          <div>
            <SectionTitle
              title="发展小游戏"
              icon={<Sparkles size={16} className="text-violet-500" />}
            />
            <p className="text-xs text-gray-400 mt-1 px-1">和宝宝一起玩</p>
            <div className="mt-2 space-y-3">
              {activities.map((activity) => (
                <CuteCard key={activity.id} className="!bg-gradient-to-br from-violet-50/50 to-pink-50/50">
                  <div className="mb-2">
                    <h3 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
                      <PlayCircle className="w-4 h-4 text-violet-400" />
                      {activity.title}
                    </h3>
                    {activity.description && (
                      <p className="text-xs text-gray-400 mt-1">{activity.description}</p>
                    )}
                  </div>

                  {/* Safety */}
                  {activity.safety && (
                    <div className="bg-amber-50 border border-amber-100 rounded-xl p-2.5 mb-3">
                      <p className="text-xs text-amber-600 flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span><span className="font-medium">安全提示：</span>{activity.safety}</span>
                      </p>
                    </div>
                  )}

                  {/* Stop conditions */}
                  {activity.stopConditions && activity.stopConditions.length > 0 && (
                    <div className="bg-rose-50 border border-rose-100 rounded-xl p-2.5 mb-3">
                      <div className="text-xs text-rose-600 flex items-start gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <span className="font-medium">出现以下情况请停止：</span>
                          <ul className="mt-1 ml-2 list-disc space-y-0.5">
                            {activity.stopConditions.map((cond, i) => (
                              <li key={i}>{cond}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Materials */}
                  {activity.materials && activity.materials.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs text-gray-400 mb-1.5">所需材料</p>
                      <div className="flex flex-wrap gap-1.5">
                        {activity.materials.map((m, i) => (
                          <span key={i} className="px-2.5 py-0.5 rounded-full bg-white border border-gray-100 text-xs text-gray-500">
                            {m}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Steps */}
                  {activity.steps && activity.steps.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1.5">玩法</p>
                      <ol className="space-y-1.5">
                        {activity.steps.map((step, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-violet-100 text-violet-600 text-[10px] font-bold shrink-0 mt-0.5">
                              {i + 1}
                            </span>
                            <span className="text-xs text-gray-500 leading-relaxed">{step.instruction}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {/* Duration / frequency — only show if data exists */}
                  {(activity.durationMinutes !== null && activity.durationMinutes !== undefined) && (
                    <p className="text-xs text-gray-300 mt-2">
                      建议时长：约 {activity.durationMinutes} 分钟
                      {activity.frequencyPerWeek !== null && activity.frequencyPerWeek !== undefined &&
                        ` · 每周约 ${activity.frequencyPerWeek} 次`
                      }
                    </p>
                  )}
                </CuteCard>
              ))}
            </div>
          </div>
        )}

        {/* Disclaimer */}
        <div className="flex items-start gap-2 px-1 pt-2">
          <Info size={14} className="text-gray-300 shrink-0 mt-0.5" />
          <p className="text-xs text-gray-400 leading-relaxed">
            每个宝宝的发育节奏不同，以上仅为参考，不作为发育诊断依据。
          </p>
        </div>

        {/* Data source */}
        <DataVersionBadge
          organization={milestoneDataSource?.organization || warningSignDataSource?.organization || '国家卫健委儿童发育参考标准'}
          asOf={milestoneDataSource?.asOf || warningSignDataSource?.asOf}
          className="px-1"
        />
      </div>
    </div>
  )
}
