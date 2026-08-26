'use client'

import { useState, useEffect, useMemo } from 'react'
import { Apple, AlertTriangle, Info, Leaf, Search, X, Ban, ShieldAlert, Sprout } from 'lucide-react'
import { AppHeader, CuteCard, SectionTitle, QuickAiButton } from '@/components/ui'
import DataVersionBadge from '@/components/ui/DataVersionBadge'

/* ── Types ────────────────────────────────────────────────── */
interface TextureByAge {
  ageMinMonths?: number | null
  ageMaxMonths?: number | null
  texture: string
}

interface FoodItem {
  id: string
  foodId?: string
  name: string
  category?: string | null
  icon?: string | null
  imageEmoji?: string | null
  isCommonAllergen?: boolean | null
  allergenIntroductionGuidance?: string | null
  highRiskInfantNeedsMedicalAdvice?: boolean | null
  chokingRisk?: boolean | null
  chokingNotes?: string | null
  exactMonthEvidence?: boolean | null
  suggestedMonth?: number | null
  recommendedFromMonth?: number | null
  recommendedToMonth?: number | null
  avoidBeforeMonths?: number | null
  guidance?: string | null
  notes?: string | null
  nutrients?: string[] | null
  preparation?: string[]
  nutrition?: string[]
  textureByAge?: TextureByAge[]
}

interface FeedingGuideline {
  id: string
  title: string
  description: string
  monthRange?: string | null
}

/* ── Helpers ──────────────────────────────────────────────── */
function getFoodCategoryLabel(cat?: string | null): string {
  if (!cat) return '其他'
  const map: Record<string, string> = {
    grain: '谷物',
    vegetable: '蔬菜',
    fruit: '水果',
    protein: '肉蛋豆',
    meat: '肉类',
    fish: '鱼虾',
    egg: '蛋类',
    dairy: '乳制品',
    legume: '豆类',
    nut: '坚果',
    other: '其他',
  }
  return map[cat] || cat
}

const CATEGORY_COLORS: Record<string, string> = {
  grain: 'bg-amber-50 border-amber-200 text-amber-700',
  vegetable: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  fruit: 'bg-pink-50 border-pink-200 text-pink-700',
  protein: 'bg-red-50 border-red-200 text-red-600',
  meat: 'bg-red-50 border-red-200 text-red-700',
  fish: 'bg-sky-50 border-sky-200 text-sky-700',
  egg: 'bg-yellow-50 border-yellow-200 text-yellow-700',
  dairy: 'bg-blue-50 border-blue-200 text-blue-700',
  legume: 'bg-lime-50 border-lime-200 text-lime-700',
  nut: 'bg-orange-50 border-orange-200 text-orange-700',
  other: 'bg-gray-50 border-gray-200 text-gray-700',
}

/** 避雷判定：无引入月龄 = 不作为婴幼儿食物；有 avoidBeforeMonths = 该月龄前避免 */
function getAvoidFlags(f: FoodItem) {
  const notRecommended =
    (f.recommendedFromMonth == null || f.recommendedFromMonth <= 0) && !f.avoidBeforeMonths
  const avoidBefore = f.avoidBeforeMonths ?? null
  const needsCaution = Boolean(
    notRecommended || avoidBefore || f.chokingRisk === true || f.isCommonAllergen === true
  )
  return { notRecommended, avoidBefore, needsCaution }
}

const RISK_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'ok', label: '✅ 可添加' },
  { value: 'caution', label: '⚠️ 需注意/避雷' },
] as const

type RiskFilter = (typeof RISK_FILTERS)[number]['value']

/* ── Badge row shared by card & detail ────────────────────── */
function FoodBadges({ item }: { item: FoodItem }) {
  const { notRecommended, avoidBefore } = getAvoidFlags(item)
  return (
    <div className="flex flex-wrap gap-1">
      {notRecommended && (
        <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold border bg-red-50 border-red-300 text-red-600">
          <Ban size={10} /> 不建议食用
        </span>
      )}
      {avoidBefore != null && (
        <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold border bg-red-50 border-red-300 text-red-600">
          <ShieldAlert size={10} /> {avoidBefore} 月龄前避免
        </span>
      )}
      {item.chokingRisk === true && (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium border bg-amber-50 border-amber-300 text-amber-700">
          ⚠️ 噎食风险
        </span>
      )}
      {item.isCommonAllergen === true && (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium border bg-orange-50 border-orange-200 text-orange-600">
          常见过敏原
        </span>
      )}
    </div>
  )
}

/* ── Component ────────────────────────────────────────────── */
export default function FoodLibraryPage() {
  const [items, setItems] = useState<FoodItem[]>([])
  const [guidelines, setGuidelines] = useState<FeedingGuideline[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all')
  const [detailItem, setDetailItem] = useState<FoodItem | null>(null)

  useEffect(() => {
    async function fetchData() {
      try {
        const [itemsRes, guidelinesRes] = await Promise.all([
          fetch('/api/food/items'),
          fetch('/api/food/feeding-guidelines'),
        ])

        let itemsData: FoodItem[] = []
        if (itemsRes.ok) {
          const json = await itemsRes.json()
          itemsData = Array.isArray(json) ? json : json.data || json.items || []
        }

        let guidelinesData: FeedingGuideline[] = []
        if (guidelinesRes.ok) {
          const json = await guidelinesRes.json()
          guidelinesData = Array.isArray(json) ? json : json.data || json.guidelines || []
        }

        setItems(itemsData)
        setGuidelines(guidelinesData)
      } catch (err: any) {
        setError(err.message || '加载失败')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  /* Choking risk items — shown prominently at top */
  const chokingRiskItems = items.filter(f => f.chokingRisk === true)

  /* Categories */
  const categories = [...new Set(items.map(f => f.category).filter(Boolean))] as string[]

  /* Filtered items — risk items stay in the list, marked by badges */
  const filteredItems = useMemo(() => {
    let result = [...items]
    if (riskFilter === 'ok') {
      result = result.filter(f => !getAvoidFlags(f).needsCaution)
    } else if (riskFilter === 'caution') {
      result = result.filter(f => getAvoidFlags(f).needsCaution)
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        f =>
          f.name.toLowerCase().includes(q) ||
          (f.category && f.category.toLowerCase().includes(q))
      )
    }
    if (selectedCategory) {
      result = result.filter(f => f.category === selectedCategory)
    }
    return result
  }, [items, riskFilter, search, selectedCategory])

  const cautionCount = items.filter(f => getAvoidFlags(f).needsCaution).length

  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      const [itemsRes, guidelinesRes] = await Promise.all([
        fetch('/api/food/items'),
        fetch('/api/food/feeding-guidelines'),
      ])
      if (itemsRes.ok) {
        const json = await itemsRes.json()
        setItems(Array.isArray(json) ? json : json.data || json.items || [])
      }
      if (guidelinesRes.ok) {
        const json = await guidelinesRes.json()
        setGuidelines(Array.isArray(json) ? json : json.data || json.guidelines || [])
      }
    } finally {
      setTimeout(() => setRefreshing(false), 500)
    }
  }

  /* Data source */
  const dataSource = (items[0] as any)?.dataSource || (guidelines[0] as any)?.dataSource

  return (
    <div className="min-h-screen bg-bg pb-8">
      <AppHeader title="食材图鉴" onRefresh={handleRefresh} refreshing={refreshing} />

      <div className="px-4 pt-4 space-y-5">
        {/* Header info */}
        <div className="flex items-center justify-between bg-white/70 p-3 rounded-2xl border border-primary/20 shadow-soft">
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-gradient-to-br from-emerald-200 to-teal-200 shadow-xs">
              <Apple className="w-6 h-6 text-emerald-700" />
            </div>
            <div>
              <p className="text-sm font-bold text-text-primary">宝宝辅食食材库</p>
              <p className="text-xs text-gray-400">分月龄查询过敏与防噎处理</p>
            </div>
          </div>

          <QuickAiButton
            contextType="food"
            label="食材问答"
            contextTitle="辅食与食材顾问"
          />
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索食材..."
            className="w-full pl-9 pr-9 py-2.5 rounded-2xl bg-white border border-gray-100 text-sm text-gray-700 placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-pink-200 focus:border-pink-300 transition"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-gray-100 transition"
            >
              <X className="w-4 h-4 text-gray-300" />
            </button>
          )}
        </div>

        {/* Risk filter */}
        {!search && (
          <div className="flex gap-2">
            {RISK_FILTERS.map(rf => (
              <button
                key={rf.value}
                onClick={() => setRiskFilter(riskFilter === rf.value ? 'all' : rf.value)}
                className={`py-1.5 px-3 rounded-full text-xs font-medium transition-all ${
                  riskFilter === rf.value
                    ? rf.value === 'caution'
                      ? 'bg-red-400 text-white'
                      : 'bg-emerald-400 text-white'
                    : 'bg-white text-gray-500 border border-gray-100'
                }`}
              >
                {rf.label}
                {rf.value === 'caution' && cautionCount > 0 ? ` (${cautionCount})` : ''}
              </button>
            ))}
          </div>
        )}

        {/* Category filter */}
        {categories.length > 0 && !search && (
          <div className="overflow-x-auto scrollbar-hide -mx-4 px-4">
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`flex-shrink-0 py-1.5 px-3 rounded-full text-xs font-medium transition-all ${
                  selectedCategory === null
                    ? 'bg-emerald-400 text-white'
                    : 'bg-white text-gray-500 border border-gray-100'
                }`}
              >
                全部分类
              </button>
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                  className={`flex-shrink-0 py-1.5 px-3 rounded-full text-xs font-medium transition-all ${
                    selectedCategory === cat
                      ? 'bg-emerald-400 text-white'
                      : 'bg-white text-gray-500 border border-gray-100'
                  }`}
                >
                  {getFoodCategoryLabel(cat)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="w-8 h-8 border-3 border-emerald-200 border-t-emerald-500 rounded-full animate-spin mx-auto mb-2" />
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

        {/* ── Avoid / choking summary ──────────────────────── */}
        {!loading && chokingRiskItems.length > 0 && (
          <CuteCard className="!bg-gradient-to-br from-amber-50 to-orange-50 !border-amber-200">
            <div className="flex items-start gap-2 mb-2">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold text-amber-700 text-sm">⚠ 噎食风险提醒</h3>
                <p className="text-xs text-amber-600 mt-0.5">以下食材需注意处理方式，避免整颗/大块喂食</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {chokingRiskItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => setDetailItem(item)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/70 border border-amber-200 text-xs text-amber-700 font-medium hover:bg-white transition"
                >
                  {(item.icon || item.imageEmoji) && <span>{item.icon || item.imageEmoji}</span>}
                  {item.name}
                </button>
              ))}
            </div>
          </CuteCard>
        )}

        {/* ── Food items grid ─────────────────────────────── */}
        {!loading && (
          <div>
            <SectionTitle
              title={`食材列表（${filteredItems.length}种）`}
              icon={<Leaf size={16} className="text-emerald-500" />}
            />
            <div className="mt-2 grid grid-cols-2 gap-3">
              {filteredItems.map(item => {
                const { notRecommended, avoidBefore } = getAvoidFlags(item)
                const cardTone = notRecommended
                  ? '!bg-red-50/70 !border-red-200'
                  : avoidBefore != null
                  ? '!bg-red-50/40 !border-red-100'
                  : item.chokingRisk === true
                  ? '!bg-amber-50/60 !border-amber-100'
                  : ''
                return (
                  <CuteCard key={item.id} className={`relative !p-3 ${cardTone}`} onClick={() => setDetailItem(item)}>
                    <div className="flex items-start gap-2 pr-14">
                      {(item.icon || item.imageEmoji) && (
                        <span className="text-2xl shrink-0">{item.icon || item.imageEmoji}</span>
                      )}
                      <div className="flex-1 min-w-0">
                        <h4 className={`font-semibold text-sm ${notRecommended ? 'text-red-800' : 'text-gray-800'}`}>
                          {item.name}
                        </h4>
                        <div className="mt-1.5">
                          <FoodBadges item={item} />
                        </div>
                      </div>
                    </div>
                    <span className={`absolute top-3 right-3 px-2 py-0.5 rounded-full text-[10px] font-medium border max-w-[5.5rem] truncate ${CATEGORY_COLORS[item.category || 'other'] || CATEGORY_COLORS.other}`}>
                      {getFoodCategoryLabel(item.category)}
                    </span>
                    {/* Main intro text */}
                    {item.guidance && (
                      <p className="text-[11px] text-gray-600 mt-2 leading-relaxed line-clamp-3">
                        {item.guidance}
                      </p>
                    )}
                    {item.chokingNotes && (
                      <p className="text-[11px] text-amber-700 mt-1.5 leading-relaxed line-clamp-2 flex items-start gap-1">
                        <ShieldAlert size={11} className="shrink-0 mt-0.5" />
                        <span>{item.chokingNotes}</span>
                      </p>
                    )}
                    {/* Timing guidance — only show if evidence exists */}
                    {notRecommended ? (
                      <p className="text-[11px] text-red-500 mt-1.5 font-medium">
                        0–24 月龄均不建议直接提供
                      </p>
                    ) : item.exactMonthEvidence === true && item.suggestedMonth != null ? (
                      <p className="text-[11px] text-gray-400 mt-1.5">
                        建议约 {item.suggestedMonth} 月龄引入
                      </p>
                    ) : item.recommendedFromMonth != null ? (
                      <p className="text-[11px] text-gray-400 mt-1.5">
                        约 {item.recommendedFromMonth} 月龄起可尝试
                        {avoidBefore != null ? `（${avoidBefore} 月龄前避免）` : ''}
                      </p>
                    ) : (
                      <p className="text-[11px] text-gray-400 mt-1.5">
                        可在开始添加辅食后逐步尝试
                      </p>
                    )}
                  </CuteCard>
                )
              })}
            </div>

            {filteredItems.length === 0 && (
              <div className="text-center py-8">
                <Apple className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-gray-300">未找到匹配的食材</p>
              </div>
            )}
          </div>
        )}

        {/* ── Feeding guidelines ──────────────────────────── */}
        {!loading && guidelines.length > 0 && (
          <div>
            <SectionTitle
              title="喂养参考"
              icon={<Info size={16} className="text-sky-500" />}
            />
            <p className="text-xs text-gray-400 mt-1 px-1">国家卫健委喂养评估参考</p>
            <div className="mt-2 space-y-2">
              {guidelines.map(g => (
                <CuteCard key={g.id} className="!bg-sky-50/50">
                  <h4 className="font-medium text-gray-700 text-sm">{g.title}</h4>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">{g.description}</p>
                  {g.monthRange && (
                    <p className="text-[11px] text-gray-300 mt-1">{g.monthRange}</p>
                  )}
                </CuteCard>
              ))}
            </div>
          </div>
        )}

        {/* New food observation tip */}
        {!loading && (
          <CuteCard className="!bg-violet-50/50">
            <p className="text-xs text-violet-600 flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                添加新食材时，建议观察 <span className="font-medium">3–5天</span>，
                留意是否有过敏反应（皮疹、呕吐、腹泻等），再逐步增加种类。
              </span>
            </p>
          </CuteCard>
        )}

        {/* Disclaimer */}
        <div className="flex items-start gap-2 px-1">
          <Info size={14} className="text-gray-300 shrink-0 mt-0.5" />
          <p className="text-xs text-gray-400 leading-relaxed">
            以上信息仅供参考，不作为医学建议。具体喂养方案请咨询儿科或营养科专业人员。
          </p>
        </div>

        {/* Data source */}
        <DataVersionBadge
          organization={dataSource?.organization || '国家卫健委'}
          asOf={dataSource?.asOf}
          className="px-1"
        />
      </div>

      {/* ── Detail sheet ──────────────────────────────────── */}
      {detailItem && (
        <div
          className="fixed inset-0 z-[100] flex items-end bg-black/40 animate-fade-in"
          onClick={() => setDetailItem(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`${detailItem.name}详情`}
        >
          <div
            className="w-full sm:max-w-md sm:mx-auto sm:mb-6 max-h-[82dvh] overflow-y-auto bg-card rounded-t-[24px] sm:rounded-[24px] p-4 pb-[max(16px,env(safe-area-inset-bottom))] space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-3 min-w-0">
                <span className="text-4xl shrink-0">{detailItem.icon || detailItem.imageEmoji || '🍽️'}</span>
                <div className="min-w-0">
                  <h3 className="font-bold text-text-primary">{detailItem.name}</h3>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${CATEGORY_COLORS[detailItem.category || 'other'] || CATEGORY_COLORS.other}`}>
                      {getFoodCategoryLabel(detailItem.category)}
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <FoodBadges item={detailItem} />
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailItem(null)}
                aria-label="关闭"
                className="tap-hotzone p-1.5 rounded-full text-text-muted hover:bg-primary-soft/30 shrink-0"
              >
                <X size={16} />
              </button>
            </div>

            {/* Avoid banner */}
            {getAvoidFlags(detailItem).notRecommended && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
                <Ban size={15} className="text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-700 leading-relaxed">
                  <span className="font-bold">避雷：</span>该食材不建议给 0–24 月龄宝宝食用
                  {detailItem.guidance ? `。${detailItem.guidance}` : ''}
                  {detailItem.notes ? ` ${detailItem.notes}` : ''}
                </p>
              </div>
            )}
            {getAvoidFlags(detailItem).avoidBefore != null && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
                <ShieldAlert size={15} className="text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-700 leading-relaxed">
                  <span className="font-bold">{getAvoidFlags(detailItem).avoidBefore} 月龄前避免</span>
                  {detailItem.guidance ? `：${detailItem.guidance}` : ''}
                </p>
              </div>
            )}

            {/* Introduction guidance */}
            {!getAvoidFlags(detailItem).notRecommended &&
              getAvoidFlags(detailItem).avoidBefore == null &&
              detailItem.guidance && (
              <div className="p-3 bg-emerald-50/60 border border-emerald-100 rounded-xl">
                <p className="text-[11px] font-bold text-emerald-700 mb-1 flex items-center gap-1">
                  <Sprout size={11} /> 引入建议
                </p>
                <p className="text-xs text-gray-700 leading-relaxed">{detailItem.guidance}</p>
              </div>
            )}

            {/* Choking safety */}
            <div className={`p-3 rounded-xl border ${detailItem.chokingRisk ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-100'}`}>
              <p className={`text-[11px] font-bold mb-1 ${detailItem.chokingRisk ? 'text-amber-700' : 'text-gray-500'}`}>
                防噎与安全
              </p>
              <p className="text-xs text-gray-700 leading-relaxed">
                {detailItem.chokingNotes || '噎食风险较低，仍建议按适龄质地处理并在进食时看护。'}
              </p>
            </div>

            {/* Allergen info */}
            <div className={`p-3 rounded-xl border ${detailItem.isCommonAllergen ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 border-gray-100'}`}>
              <p className={`text-[11px] font-bold mb-1 ${detailItem.isCommonAllergen ? 'text-orange-700' : 'text-gray-500'}`}>
                过敏提示
              </p>
              <p className="text-xs text-gray-700 leading-relaxed">
                {detailItem.allergenIntroductionGuidance ||
                  (detailItem.isCommonAllergen === false
                    ? '非常见高敏食材，正常按一次一种新食物的方法引入即可。'
                    : '过敏风险未确认，按一次一种新食物的方法引入并观察 3 天。')}
              </p>
              {detailItem.highRiskInfantNeedsMedicalAdvice === true && (
                <p className="text-[11px] text-red-600 mt-1.5 leading-relaxed">
                  ⚠ 既往严重湿疹、明确食物过敏等高风险婴儿，引入前请先咨询医生。
                </p>
              )}
            </div>

            {/* Preparation */}
            {detailItem.preparation && detailItem.preparation.length > 0 && (
              <div className="p-3 bg-sky-50/60 border border-sky-100 rounded-xl">
                <p className="text-[11px] font-bold text-sky-700 mb-1">制作要点</p>
                <ul className="space-y-1">
                  {detailItem.preparation.map((step, i) => (
                    <li key={i} className="text-xs text-gray-700 leading-relaxed flex gap-1.5">
                      <span className="text-sky-400 shrink-0">·</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Nutrition */}
            {detailItem.nutrition && detailItem.nutrition.length > 0 && (
              <div>
                <p className="text-[11px] font-bold text-text-secondary mb-1.5">营养亮点</p>
                <div className="flex flex-wrap gap-1.5">
                  {detailItem.nutrition.map(n => (
                    <span key={n} className="px-2.5 py-1 rounded-full bg-violet-50 border border-violet-100 text-[11px] text-violet-700 font-medium">
                      {n}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Texture by age */}
            {detailItem.textureByAge && detailItem.textureByAge.length > 0 && (
              <div>
                <p className="text-[11px] font-bold text-text-secondary mb-1.5">分月龄质地</p>
                <div className="space-y-1.5">
                  {detailItem.textureByAge.map((t, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className="shrink-0 px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold text-[10px]">
                        {t.ageMinMonths ?? '?'}–{t.ageMaxMonths ?? '+'} 月
                      </span>
                      <span className="text-gray-700 leading-relaxed">{t.texture}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Notes (when not already shown in avoid banner) */}
            {detailItem.notes && !getAvoidFlags(detailItem).notRecommended && (
              <p className="text-[11px] text-gray-500 leading-relaxed px-1">备注:{detailItem.notes}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
