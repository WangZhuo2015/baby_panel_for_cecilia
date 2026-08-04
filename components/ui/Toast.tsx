"use client";
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';

interface ToastContextType {
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({
    message: '',
    visible: false,
  });

  const showToast = useCallback((message: string) => {
    setToast({ message, visible: true });
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 2200);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast.visible && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[100] animate-slide-up">
          <div className="flex items-center gap-2 px-5 py-3 bg-white rounded-2xl shadow-elevated border border-mint/30">
            <CheckCircle2 size={18} className="text-mint" />
            <span className="text-sm font-medium text-text-primary">{toast.message}</span>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
