import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { usePrivacy } from '../../contexts/PrivacyContext';

interface BalanceVisibilityToggleProps {
  className?: string;
  compact?: boolean;
}

export const BalanceVisibilityToggle: React.FC<BalanceVisibilityToggleProps> = ({
  className = '',
  compact = false,
}) => {
  const { isPrivacyMode, togglePrivacyMode } = usePrivacy();

  return (
    <button
      type="button"
      onClick={togglePrivacyMode}
      aria-pressed={isPrivacyMode}
      aria-label={isPrivacyMode ? 'Exibir valores financeiros' : 'Ocultar valores financeiros'}
      title={isPrivacyMode ? 'Exibir valores' : 'Ocultar valores'}
      className={`inline-flex items-center justify-center gap-1.5 min-h-10 px-3 rounded-xl border border-[#E2E8F0] dark:border-white/15 bg-white dark:bg-[#11185A] text-xs font-semibold text-[#0F172A] dark:text-white hover:border-[#CBD5E1] dark:hover:border-white/30 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${className}`}
    >
      {isPrivacyMode ? <EyeOff size={15} strokeWidth={1.75} /> : <Eye size={15} strokeWidth={1.75} />}
      {!compact && <span>{isPrivacyMode ? 'Valores ocultos' : 'Ocultar valores'}</span>}
    </button>
  );
};
