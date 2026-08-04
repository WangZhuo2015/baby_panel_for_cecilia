"use client";
import { useState, useEffect, useMemo } from 'react';
import { Star, Heart, BookOpen } from 'lucide-react';
import { AppHeader, CuteCard, SegmentControl } from '@/components/ui';
import { useBabyStore } from '@/stores/useBabyStore';
import type { Book } from '@/types';

type BookTab = 'all' | 'read' | 'favorites';

const tabs = [
  { value: 'all', label: '推荐' },
  { value: 'read', label: '已读' },
  { value: 'favorites', label: '收藏' },
];

export default function BooksPage() {
  const [activeTab, setActiveTab] = useState<BookTab>('all');
  const books = useBabyStore((s) => s.books) ?? [];
  const fetchBooks = useBabyStore((s) => s.fetchBooks);
  const updateBook = useBabyStore((s) => s.updateBook);

  useEffect(() => {
    fetchBooks(activeTab);
  }, [activeTab, fetchBooks]);

  const filteredBooks = useMemo(() => {
    switch (activeTab) {
      case 'read':
        return books.filter((b) => b.readCount > 0);
      case 'favorites':
        return books.filter((b) => b.isFavorite);
      default:
        return books;
    }
  }, [activeTab, books]);

  const toggleFavorite = (id: string) => {
    updateBook(id, { isFavorite: !books.find((b) => b.id === id)?.isFavorite });
  };

  return (
    <div className="min-h-screen bg-bg">
      <AppHeader title="绘本馆" />

      <div className="px-4 pt-3 pb-8 space-y-4">
        {/* Age selector */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-2xl bg-primary-light">
            <BookOpen size={18} className="text-primary" />
          </div>
          <div>
            <p className="text-lg font-bold text-text-primary">绘本推荐</p>
            <p className="text-xs text-text-secondary">6月龄</p>
          </div>
        </div>

        {/* Tabs */}
        <SegmentControl
          options={tabs}
          value={activeTab}
          onChange={(v) => setActiveTab(v as BookTab)}
        />

        {/* Book list */}
        <div className="space-y-3">
          {filteredBooks.map((book: Book) => (
            <CuteCard key={book.id}>
              <div className="flex gap-3">
                {/* Cover placeholder */}
                <div
                  className="w-[72px] h-[96px] rounded-xl flex-shrink-0 relative overflow-hidden"
                  style={{ backgroundColor: book.coverColor }}
                >
                  {/* Subtle shine overlay */}
                  <div className="absolute inset-0 bg-gradient-to-br from-white/25 to-transparent" />
                  {/* Book icon */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <BookOpen size={24} className="text-white/40" />
                  </div>
                  {/* Bottom label */}
                  <div className="absolute bottom-1.5 left-0 right-0 text-center">
                    <span className="text-[8px] text-white/60 font-medium tracking-tight leading-tight">
                      {book.ageRange}
                    </span>
                  </div>
                </div>

                {/* Book info */}
                <div className="flex-1 min-w-0 py-0.5">
                  <h3 className="font-semibold text-text-primary text-sm leading-tight truncate">
                    {book.title}
                  </h3>
                  <p className="text-xs text-text-muted mt-0.5">{book.author}</p>

                  <div className="flex items-center gap-1 mt-2">
                    {/* Star rating */}
                    <div className="flex items-center gap-0.5">
                      {Array.from({ length: 5 }, (_, i) => (
                        <Star
                          key={i}
                          size={13}
                          className={
                            i < book.rating
                              ? 'text-yellow-400 fill-yellow-400'
                              : 'text-text-muted/30'
                          }
                        />
                      ))}
                    </div>

                    <span className="text-xs text-text-muted ml-1">
                      {book.readCount}次
                    </span>

                    {/* Spacer */}
                    <div className="flex-1" />

                    {/* Favorite toggle */}
                    <button
                      type="button"
                      onClick={() => toggleFavorite(book.id)}
                      className="btn-press p-1.5 cursor-pointer"
                      aria-label={book.isFavorite ? '取消收藏' : '收藏'}
                    >
                      <Heart
                        size={18}
                        className={
                          book.isFavorite
                            ? 'text-red-400 fill-red-400'
                            : 'text-text-muted/40'
                        }
                      />
                    </button>
                  </div>
                </div>
              </div>
            </CuteCard>
          ))}
        </div>

        {/* Empty state */}
        {filteredBooks.length === 0 && (
          <div className="text-center py-12">
            <BookOpen size={40} className="text-text-muted/30 mx-auto mb-3" />
            <p className="text-sm text-text-muted">
              {activeTab === 'read' ? '暂无已读绘本' : '暂无收藏绘本'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
