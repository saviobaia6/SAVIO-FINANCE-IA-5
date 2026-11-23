import React from 'react';
import { ChevronRight } from 'lucide-react';
import type { IncomeChartItem } from '../../domain/finance/FinanceConsolidationService';
import { usePrivacy } from '../../contexts/PrivacyContext';
import { formatarValor } from '../../utils/formatters';

interface IncomeSourceCardProps {
  item: IncomeChartItem;
  onSelect?: (item: IncomeChartItem) => void;
  active?: boolean;
}

export const IncomeSourceCard: React.FC<IncomeSourceCardProps> = ({
  item,
  onSelect,
  active = false,
}) => {
  const { hideValues } = usePrivacy();

  return (
    <button
      type="button"
      onClick={() => onSelect?.(item)}
      className={`w-full min-w-0 text-left p-3.5 sm:p-4 rounded-xl border transition-colors cursor-pointer space-y-2 ${
        active
          ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-[#059669]'
          : 'bg-white dark:bg-[#11185A] border-[#E2E8F0] dark:border-white/12 hover:border-[#CBD5E1] dark:hover:border-white/25'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-sm shrink-0"
            style={{ backgroundColor: item.color }}
            aria-hidden="true"
          />
          <span className="font-display text-xs sm:text-sm font-bold text-[#0F172A] dark:text-white truncate">
            {item.sourceName}
          </span>
        </div>
        <span className="font-money text-xs font-bold text-[#64748B] dark:text-slate-300 shrink-0">
          {item.percentage.toFixed(1)}%
        </span>
      </div>

      <div className="font-money text-base sm:text-lg font-extrabold text-[#059669] dark:text-[#10B981]">
        {formatarValor(item.totalAmount, hideValues)}
      </div>

      <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.min(100, Math.max(2, item.percentage))}%`,
            backgroundColor: item.color,
          }}
        />
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px] text-[#64748B] dark:text-slate-300">
        <span className="truncate">
          Rec.: <strong className="font-money">{formatarValor(item.receivedAmount, hideValues)}</strong>
          {item.expectedAmount > 0 && (
            <> · Prev.: <strong className="font-money">{formatarValor(item.expectedAmount, hideValues)}</strong></>
          )}
        </span>
        <span className="inline-flex items-center gap-0.5 shrink-0">
          {item.count} reg.
          {onSelect && <ChevronRight size={12} strokeWidth={1.75} />}
        </span>
      </div>
    </button>
  );
};
