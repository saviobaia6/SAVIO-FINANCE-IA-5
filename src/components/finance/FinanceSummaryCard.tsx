import React from 'react';
import { ChevronRight } from 'lucide-react';
import { usePrivacy } from '../../contexts/PrivacyContext';
import { formatarValor } from '../../utils/formatters';

interface FinanceSummaryCardProps {
  title: string;
  value: number;
  subtitle?: string;
  tone?: 'neutral' | 'income' | 'expense' | 'amber' | 'navy';
  icon?: React.ReactNode;
  onClick?: () => void;
  footerRight?: React.ReactNode;
}

export const FinanceSummaryCard: React.FC<FinanceSummaryCardProps> = ({
  title,
  value,
  subtitle,
  tone = 'neutral',
  icon,
  onClick,
  footerRight,
}) => {
  const { hideValues } = usePrivacy();

  const valueColorClass =
    tone === 'income'
      ? 'text-[#059669] dark:text-[#10B981]'
      : tone === 'expense'
        ? 'text-[#DC3545] dark:text-red-400'
        : tone === 'amber'
          ? 'text-amber-600 dark:text-amber-300'
          : 'text-[#0F172A] dark:text-white';

  const badgeClass =
    tone === 'income'
      ? 'sf-icon-badge'
      : tone === 'expense'
        ? 'sf-icon-badge-danger'
        : tone === 'amber'
          ? 'sf-icon-badge-amber'
          : 'sf-icon-badge-navy';

  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="font-sans text-xs font-medium text-[#64748B] dark:text-slate-300 truncate">
          {title}
        </span>
        {icon && <span className={badgeClass}>{icon}</span>}
      </div>
      <div className={`font-money text-lg sm:text-2xl font-extrabold mt-1 ${valueColorClass}`}>
        {formatarValor(value, hideValues)}
      </div>
      {(subtitle || footerRight || onClick) && (
        <div className="flex items-center justify-between gap-2 mt-1.5 text-[11px] text-[#64748B] dark:text-slate-300">
          <span className="truncate">{subtitle}</span>
          {footerRight || (onClick && <ChevronRight size={13} strokeWidth={1.75} className="shrink-0" />)}
        </div>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="sf-card-interactive text-left p-4 sm:p-5 flex flex-col justify-between cursor-pointer w-full"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="sf-card p-4 sm:p-5 flex flex-col justify-between">
      {content}
    </div>
  );
};
