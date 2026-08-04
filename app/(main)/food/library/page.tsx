'use client'

import { useState, useEffect } from 'react'
import { Apple, AlertTriangle, Info, Leaf, Search, X } from 'lucide-react'
import { AppHeader, CuteCard, SectionTitle } from '@/components/ui'
import DataVersionBadge from '@/components/ui/DataVersionBadge'

/* ── Types ────────────────────────────────────────────────── */
interface FoodItem {
  id: string
  name: string
  category?: string | null
  imageEmoji?: string | null
  isCommonAllergen?: boolean | null
  chokingRisk?: boolean | null
  exactMonthEvidence?: boolean | null
  suggestedMonth?: number | null
  notes?: string | null
  nutrients?: string[] | null
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
  meat: 'bg-red-50 border-red-200 text-red-700',
  fish: 'bg-sky-50 border-sky-200 text-sky-700',
  egg: 'bg-yellow-50 border-yellow-200 text-yellow-700',
  dairy: 'bg-blue-50 border-blue-200 text-blue-700',
  legume: 'bg-lime-50 border-lime-200 text-lime-700',
  nut: 'bg-orange-50 border-orange-200 text-orange-700',
  other: 'bg-gray-50 border-gray-200 text-gray-700',
}

/* ── Component ────────────────────────────────────────────── */
export default function FoodLibraryPage() {
  const [items, setItems] = useState<FoodItem[]>([])
  const [guidelines, setGuidelines] = useState<FeedingGuideline[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

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

  /* Filtered items */
  let filteredItems = items.filter(f => f.chokingRisk !== true)
  if (search.trim()) {
    const q = search.trim().toLowerCase()
    filteredItems = filteredItems.filter(f =>
      f.name.toLowerCase().includes(q) ||
      (f.category && f.category.toLowerCase().includes(q))
    )
  }
  if (selectedCategory) {
    filteredItems = filteredItems.filter(f => f.category === selectedCategory)
  }

  /* Data source */
  const dataSource = (items[0] as any)?.dataSource || (guidelines[0] as any)?.dataSource

  return (
    <div className="min-h-screen bg-bg pb-8">
      <AppHeader title="食材图鉴" />

      <div className="px-4 pt-4 space-y-5">
        {/* Header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-emerald-200 to-pink-200 mb-2">
            <Apple className="w-7 h-7 text-emerald-600" />
          </div>
          <p className="text-sm text-gray-400">宝宝辅食食材参考</p>
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
                全部
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

        {/* ── Choking risk warning ─────────────────────────── */}
        {!loading && chokingRiskItems.length > 0 && (
          <div>
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
                  <span
                    key={item.id}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/70 border border-amber-200 text-xs text-amber-700 font-medium"
                  >
                    {item.imageEmoji && <span>{item.imageEmoji}</span>}
                    {item.name}
                  </span>
                ))}
              </div>
            </CuteCard>
          </div>
        )}

        {/* ── Food items grid ─────────────────────────────── */}
        {!loading && (
          <div>
            <SectionTitle
              title={`食材列表（${filteredItems.length}种）`}
              icon={<Leaf size={16} className="text-emerald-500" />}
            />
            <div className="mt-2 grid grid-cols-2 gap-3">
              {filteredItems.map(item => (
                <CuteCard key={item.id} className="!p-3">
                  <div className="flex items-start gap-2">
                    {item.imageEmoji && (
                      <span className="text-2xl shrink-0">{item.imageEmoji}</span>
                    )}
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-gray-800 text-sm truncate">{item.name}</h4>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${CATEGORY_COLORS[item.category || 'other'] || CATEGORY_COLORS.other}`}>
                          {getFoodCategoryLabel(item.category)}
                        </span>
                        {/* Allergen tag: only show when isCommonAllergen === true */}
                        {item.isCommonAllergen === true && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium border bg-orange-50 border-orange-200 text-orange-600">
                            常见过敏原
                          </span>
                        )}
                      </div>
                      {/* Timing guidance — only show if evidence exists */}
                      {item.exactMonthEvidence === true && item.suggestedMonth != null ? (
                        <p className="text-[11px] text-gray-400 mt-1.5">
                          建议约 {item.suggestedMonth} 月龄引入
                        </p>
                      ) : (
                        <p className="text-[11px] text-gray-400 mt-1.5">
                          可在开始添加辅食后逐步尝试
                        </p>
                      )}
                      {item.notes && (
                        <p className="text-[11px] text-gray-300 mt-1 leading-relaxed">{item.notes}</p>
                      )}
                    </div>
                  </div>
                </CuteCard>
              ))}
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
    </div>
  )
}
