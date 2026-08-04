'use client'

import { useState, useEffect } from 'react'
import { BookOpen, Heart, Star, Search, X } from 'lucide-react'
import { AppHeader, CuteCard, SegmentControl } from '@/components/ui'

/* ── Types ────────────────────────────────────────────────── */
interface Book {
  id: string
  title: string
  author?: string | string[] | null
  coverColor?: string | null
  ratingScore?: number | null
  ageMinMonths?: number | null
  ageMaxMonths?: number | null
  description?: string | null
  tags?: string[] | null
  categories?: string[] | null
  readCount?: number
  isFavorite?: boolean
}

type BookTab = 'all' | 'read' | 'favorites'

const tabs = [
  { value: 'all', label: '精选绘本' },
  { value: 'read', label: '已读' },
  { value: 'favorites', label: '收藏' },
]

const DEFAULT_COVER_COLOR = '#FFD9E6'

function getAgeRangeLabel(book: Book): string | null {
  if (book.ageMinMonths != null && book.ageMaxMonths != null) {
    return `${book.ageMinMonths}–${book.ageMaxMonths}月龄`
  }
  if (book.ageMinMonths != null) {
    return `${book.ageMinMonths}月龄+`
  }
  return null
}

export default function BooksPage() {
  const [activeTab, setActiveTab] = useState<BookTab>('all')
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    async function fetchBooks() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/books?tab=${activeTab}`)
        if (!res.ok) throw new Error('加载失败')
        const data = await res.json()
        const list = Array.isArray(data) ? data : data.data || data.books || []
        setBooks(list)
      } catch (err: any) {
        setError(err.message || '未知错误')
      } finally {
        setLoading(false)
      }
    }
    fetchBooks()
  }, [activeTab])

  const filteredBooks = search.trim()
    ? books.filter(b =>
        b.title.toLowerCase().includes(search.trim().toLowerCase()) ||
        (b.author && (Array.isArray(b.author) ? b.author.join(' ') : b.author).toLowerCase().includes(search.trim().toLowerCase()))
      )
    : books

  const toggleFavorite = async (id: string) => {
    const target = books.find(b => b.id === id)
    const next = !target?.isFavorite

    // Optimistic update
    setBooks(prev => prev.map(b =>
      b.id === id ? { ...b, isFavorite: next } : b
    ))
    try {
      const res = await fetch(`/api/books/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFavorite: next }),
      })
      if (!res.ok) throw new Error('保存失败')
    } catch {
      // Revert on error
      setBooks(prev => prev.map(b =>
        b.id === id ? { ...b, isFavorite: !next } : b
      ))
    }
  }

  return (
    <div className="min-h-screen bg-bg pb-8">
      <AppHeader title="绘本馆" />

      <div className="px-4 pt-4 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-2xl bg-pink-100">
            <BookOpen size={18} className="text-pink-500" />
          </div>
          <div>
            <p className="text-lg font-bold text-gray-800">精选绘本</p>
            <p className="text-xs text-gray-400">陪伴宝宝成长的阅读时光</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索绘本或作者..."
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

        {/* Tabs */}
        <SegmentControl
          options={tabs}
          value={activeTab}
          onChange={(v) => setActiveTab(v as BookTab)}
        />

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="w-8 h-8 border-3 border-pink-200 border-t-pink-500 rounded-full animate-spin mx-auto mb-2" />
              <p className="text-xs text-gray-400">加载中...</p>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
            <BookOpen className="w-6 h-6 text-red-300 mx-auto mb-1" />
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        {/* Book list */}
        {!loading && (
          <div className="space-y-3">
            {filteredBooks.map((book: Book) => {
              const coverColor = book.coverColor || DEFAULT_COVER_COLOR
              const ageRange = getAgeRangeLabel(book)

              return (
                <CuteCard key={book.id}>
                  <div className="flex gap-3">
                    {/* Cover */}
                    <div
                      className="w-[72px] h-[96px] rounded-xl shrink-0 relative overflow-hidden"
                      style={{ backgroundColor: coverColor }}
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-white/25 to-transparent" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <BookOpen size={24} className="text-white/40" />
                      </div>
                      {ageRange && (
                        <div className="absolute bottom-1.5 left-0 right-0 text-center">
                          <span className="text-[8px] text-white/70 font-medium tracking-tight leading-tight">
                            {ageRange}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0 py-0.5">
                      <h3 className="font-semibold text-gray-800 text-sm leading-tight truncate">
                        {book.title}
                      </h3>
                      {book.author && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {Array.isArray(book.author) ? book.author.join('、') : book.author}
                        </p>
                      )}
                      {book.description && (
                        <p className="text-xs text-gray-400 mt-1 line-clamp-2 leading-relaxed">
                          {book.description}
                        </p>
                      )}

                      {/* Tags */}
                      {book.tags && book.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {book.tags.slice(0, 3).map((tag, i) => (
                            <span key={i} className="px-2 py-0.5 rounded-full bg-pink-50 border border-pink-100 text-[10px] text-pink-500">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center gap-1 mt-2">
                        {/* Star rating — only if ratingScore is not null */}
                        {book.ratingScore != null && (
                          <div className="flex items-center gap-0.5">
                            {Array.from({ length: 5 }, (_, i) => (
                              <Star
                                key={i}
                                size={12}
                                className={
                                  i < Math.round(book.ratingScore!)
                                    ? 'text-yellow-400 fill-yellow-400'
                                    : 'text-gray-200'
                                }
                              />
                            ))}
                          </div>
                        )}

                        {book.readCount != null && book.readCount > 0 && (
                          <span className="text-[10px] text-gray-300 ml-1">
                            读过{book.readCount}次
                          </span>
                        )}

                        <div className="flex-1" />

                        {/* Favorite */}
                        <button
                          type="button"
                          onClick={() => toggleFavorite(book.id)}
                          className="p-1.5 hover:bg-pink-50 rounded-full transition cursor-pointer"
                          aria-label={book.isFavorite ? '取消收藏' : '收藏'}
                        >
                          <Heart
                            size={18}
                            className={
                              book.isFavorite
                                ? 'text-red-400 fill-red-400'
                                : 'text-gray-200'
                            }
                          />
                        </button>
                      </div>
                    </div>
                  </div>
                </CuteCard>
              )
            })}
          </div>
        )}

        {/* Empty state */}
        {!loading && filteredBooks.length === 0 && (
          <div className="text-center py-12">
            <BookOpen size={40} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-300">
              {activeTab === 'read' ? '暂无已读绘本' : activeTab === 'favorites' ? '暂无收藏绘本' : '暂无绘本数据'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
