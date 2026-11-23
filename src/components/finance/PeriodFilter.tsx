import React from 'react';
import { Filter, X } from 'lucide-react';
import type { Account, CreditCard } from '../../types';
import {
  INCOME_ORIGIN_META,
  type FinanceFilters,
} from '../../domain/finance/FinanceConsolidationService';

interface PeriodFilterProps {
  filters: FinanceFilters;
  onChange: (next: FinanceFilters) => void;
  accounts?: readonly Account[];
  cards?: readonly CreditCard[];
  categories?: readonly string[];
  showAccountFilter?: boolean;
  showCardFilter?: boolean;
  showSourceFilter?: boolean;
  showTypeFilter?: boolean;
  showInstallmentToggle?: boolean;
  compact?: boolean;
}

export const PeriodFilter: React.FC<PeriodFilterProps> = ({
  filters,
  onChange,
  accounts = [],
  cards = [],
  categories = [],
  showAccountFilter = true,
  showCardFilter = false,
  showSourceFilter = true,
  showTypeFilter = true,
  showInstallmentToggle = false,
  compact = false,
}) => {
  const hasActiveFilters = Boolean(
    filters.startDate ||
      filters.endDate ||
      filters.accountId ||
      filters.cardId ||
      filters.category ||
      filters.source ||
      (filters.type && filters.type !== 'all') ||
      filters.installmentOnly ||
      filters.search
  );

  const update = (patch: Partial<FinanceFilters>) => {
    onChange({
      ...filters,
      ...patch,
    });
  };

  const reset = () => {
    onChange({
      scope: filters.scope,
    });
  };

  return (
    <div className="sf-card p-3 sm:p-4 space-y-2.5 min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-bold text-[#0F172A] dark:text-white">
          <Filter size={14} strokeWidth={1.75} className="text-[#059669] dark:text-[#10B981]" />
          <span>Filtros analíticos</span>
        </div>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1 px-2.5 min-h-8 rounded-lg text-[11px] font-semibold text-[#64748B] hover:text-[#0F172A] dark:text-slate-300 dark:hover:text-white bg-slate-100 dark:bg-white/10 cursor-pointer whitespace-nowrap shrink-0"
          >
            <X size={12} /> Limpar filtros
          </button>
        )}
      </div>

      <div className={`grid gap-2.5 min-w-0 ${compact ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 lg:grid-cols-4 xl:grid-cols-6'}`}>
        <div className="min-w-0">
          <label className="block text-[11px] font-medium text-[#64748B] dark:text-slate-300 mb-1">
            De
          </label>
          <input
            type="date"
            aria-label="Data inicial"
            value={filters.startDate || ''}
            onChange={(e) => update({ startDate: e.target.value || undefined })}
            className="w-full min-w-0 min-h-10 px-2.5 py-1.5 rounded-xl border border-[#E2E8F0] dark:border-white/15 bg-white dark:bg-[#0B1252] text-xs text-[#0F172A] dark:text-white"
          />
        </div>

        <div className="min-w-0">
          <label className="block text-[11px] font-medium text-[#64748B] dark:text-slate-300 mb-1">
            Até
          </label>
          <input
            type="date"
            aria-label="Data final"
            value={filters.endDate || ''}
            onChange={(e) => update({ endDate: e.target.value || undefined })}
            className="w-full min-w-0 min-h-10 px-2.5 py-1.5 rounded-xl border border-[#E2E8F0] dark:border-white/15 bg-white dark:bg-[#0B1252] text-xs text-[#0F172A] dark:text-white"
          />
        </div>

        {showTypeFilter && (
          <div>
            <label className="block text-[11px] font-medium text-[#64748B] dark:text-slate-300 mb-1">
              Tipo
            </label>
            <select
              aria-label="Filtrar por tipo"
              value={filters.type || 'all'}
              onChange={(e) =>
                update({ type: e.target.value as 'income' | 'expense' | 'all' })
              }
              className="w-full min-h-10 px-2.5 py-1.5 rounded-xl border border-[#E2E8F0] dark:border-white/15 bg-white dark:bg-[#0B1252] text-xs text-[#0F172A] dark:text-white"
            >
              <option value="all">Receitas e Despesas</option>
              <option value="income">Somente Receitas</option>
              <option value="expense">Somente Despesas</option>
            </select>
          </div>
        )}

        {showAccountFilter && accounts.length > 0 && (
          <div>
            <label className="block text-[11px] font-medium text-[#64748B] dark:text-slate-300 mb-1">
              Conta
            </label>
            <select
              aria-label="Filtrar por conta"
              value={filters.accountId || ''}
              onChange={(e) => update({ accountId: e.target.value || undefined })}
              className="w-full min-h-10 px-2.5 py-1.5 rounded-xl border border-[#E2E8F0] dark:border-white/15 bg-white dark:bg-[#0B1252] text-xs text-[#0F172A] dark:text-white"
            >
              <option value="">Todas as contas</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.institutionName} · {acc.accountName}
                </option>
              ))}
            </select>
          </div>
        )}

        {showCardFilter && cards.length > 0 && (
          <div>
            <label className="block text-[11px] font-medium text-[#64748B] dark:text-slate-300 mb-1">
              Cartão
            </label>
            <select
              aria-label="Filtrar por cartão"
              value={filters.cardId || ''}
              onChange={(e) => update({ cardId: e.target.value || undefined })}
              className="w-full min-h-10 px-2.5 py-1.5 rounded-xl border border-[#E2E8F0] dark:border-white/15 bg-white dark:bg-[#0B1252] text-xs text-[#0F172A] dark:text-white"
            >
              <option value="">Todos os cartões</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.cardName} (•••• {c.last4})
                </option>
              ))}
            </select>
          </div>
        )}

        {categories.length > 0 && (
          <div>
            <label className="block text-[11px] font-medium text-[#64748B] dark:text-slate-300 mb-1">
              Categoria
            </label>
            <select
              aria-label="Filtrar por categoria"
              value={filters.category || ''}
              onChange={(e) => update({ category: e.target.value || undefined })}
              className="w-full min-h-10 px-2.5 py-1.5 rounded-xl border border-[#E2E8F0] dark:border-white/15 bg-white dark:bg-[#0B1252] text-xs text-[#0F172A] dark:text-white"
            >
              <option value="">Todas categorias</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        )}

        {showSourceFilter && (
          <div>
            <label className="block text-[11px] font-medium text-[#64748B] dark:text-slate-300 mb-1">
              Origem da renda
            </label>
            <select
              aria-label="Filtrar por origem"
              value={filters.source || ''}
              onChange={(e) => update({ source: e.target.value || undefined })}
              className="w-full min-h-10 px-2.5 py-1.5 rounded-xl border border-[#E2E8F0] dark:border-white/15 bg-white dark:bg-[#0B1252] text-xs text-[#0F172A] dark:text-white"
            >
              <option value="">Todas as origens</option>
              {Object.entries(INCOME_ORIGIN_META).map(([key, meta]) => (
                <option key={key} value={key}>
                  {meta.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {showInstallmentToggle && (
          <div className="flex items-end">
            <label className="w-full min-h-10 px-3 py-1.5 rounded-xl border border-[#E2E8F0] dark:border-white/15 bg-white dark:bg-[#0B1252] flex items-center gap-2 text-xs font-medium text-[#0F172A] dark:text-white cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(filters.installmentOnly)}
                onChange={(e) => update({ installmentOnly: e.target.checked || undefined })}
                className="accent-[#059669]"
              />
              <span>Só parceladas</span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
};
