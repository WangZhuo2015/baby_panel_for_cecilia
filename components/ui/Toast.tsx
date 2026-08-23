"use client";
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{
    message: string;
    type: ToastType;
    visible: boolean;
  }>({
    message: '',
    type: 'success',
    visible: false,
  });

  const showToast = useCallback((message: string, explicitType?: ToastType) => {
    // Auto-detect type if not explicitly specified
    let detectedType: ToastType = explicitType || 'success';
    if (!explicitType) {
      if (
        message.includes('失败') ||
        message.includes('错误') ||
        message.includes('不能') ||
        message.includes('无效') ||
        message.includes('拒绝') ||
        message.includes('异常')
      ) {
        detectedType = 'error';
      } else if (message.includes('请') && !message.includes('✨')) {
        detectedType = 'info';
      }
    }

    setToast({ message, type: detectedType, visible: true });
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 2400);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast.visible && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[100] animate-slide-up pointer-events-none">
          <div
            className={`flex items-center gap-2.5 px-5 py-3 rounded-2xl shadow-elevated border bg-white ${
              toast.type === 'error'
                ? 'border-red-200 text-red-600'
                : toast.type === 'info'
                ? 'border-sky-200 text-sky-600'
                : 'border-mint/30 text-mint'
            }`}
          >
            {toast.type === 'error' ? (
              <AlertCircle size={18} className="text-red-500 shrink-0" />
            ) : toast.type === 'info' ? (
              <Info size={18} className="text-sky-500 shrink-0" />
            ) : (
              <CheckCircle2 size={18} className="text-mint shrink-0" />
            )}
            <span className="text-sm font-medium text-text-primary">{toast.message}</span>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

