'use client'

import { useState, useEffect } from 'react'
import { Syringe, Shield, Info, AlertTriangle, ChevronDown, ChevronUp, MapPin } from 'lucide-react'
import { AppHeader, CuteCard, SectionTitle } from '@/components/ui'
import DataVersionBadge from '@/components/ui/DataVersionBadge'

interface Vaccine {
  id: string
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

export default function VaccinesPage() {
  const [vaccines, setVaccines] = useState<Vaccine[]>([])
  const [dataRelease, setDataRelease] = useState<{ asOf?: string | null; sources?: { organization?: string }[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchVaccines() {
      try {
        const res = await fetch('/api/vaccines')
        if (!res.ok) throw new Error('加载失败')
        const data = await res.json()
        // API returns grouped: {national, nonProgram, provincial, strategyGroups, ...}
        let list: any[] = []
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
        setDataRelease(data.dataRelease ?? null)
      } catch (err: any) {
        setError(err.message || '未知错误')
      } finally {
        setLoading(false)
      }
    }
    fetchVaccines()
  }, [])

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

  // Data source from API dataRelease, fallback to '未知'
  const dataSource = {
    organization: dataRelease?.sources?.[0]?.organization,
    asOf: dataRelease?.asOf,
  }

  return (
    <div className="min-h-screen bg-bg pb-8">
      <AppHeader title="疫苗接种指南" />

      <div className="px-4 pt-4 space-y-5">
        {/* Header info */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-pink-200 to-purple-200 mb-2">
            <Syringe className="w-7 h-7 text-pink-600" />
          </div>
          <p className="text-sm text-gray-400">0–3岁宝宝疫苗时间表</p>
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
