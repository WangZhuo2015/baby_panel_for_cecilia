import React from 'react';
import { CuteRabbit } from '@/components/illustrations/CuteRabbit';

interface AiAssistantCardProps {
  message: string;
  actionText?: string;
  onAction?: () => void;
}

export const AiAssistantCard: React.FC<AiAssistantCardProps> = ({
  message,
  actionText,
  onAction,
}) => {
  return (
    <div className="bg-gradient-to-r from-[#F5EEFF] to-primary-light rounded-[24px] p-4 shadow-soft">
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          <CuteRabbit size={48} />
        </div>
        <div className="flex-1 min-w-0 pt-1">
          <p className="text-sm text-text-primary leading-relaxed">{message}</p>
        </div>
      </div>
      {actionText && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="btn-press mt-3 w-full py-2.5 rounded-[14px] bg-white/70 text-sm font-medium text-primary text-center cursor-pointer"
        >
          {actionText}
        </button>
      )}
    </div>
  );
};
