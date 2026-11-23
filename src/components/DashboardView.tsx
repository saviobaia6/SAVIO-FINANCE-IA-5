import React, { useMemo, useState } from 'react';
import {
  Transaction,
  EntityScope,
  Boleto,
  Account,
  CreditCard,
  Debt,
  Asset,
  CategoryBudget,
  LedgerDrilldownFilter,
  APP_CATEGORIES,
} from '../types';
import type { SalaryDataset } from '../types/salary';
import { calculateCountdown } from '../utils/countdown';
import {
  filterTransactionsByPeriod,
  calculatePeriodMetricsCents,
  getTransactionAmountCents,
  toCents,
  fromCents,
} from '../utils/financeCalculations';
import {
  consolidateFinance,
  type FinanceFilters,
  type IncomeChartItem,
} from '../domain/finance/FinanceConsolidationService';
import { analyzeCategoryBudgets } from '../domain/planning/BudgetAnalyzer';
import { buildCashFlowProjection } from '../domain/planning/CashFlowProjectionService';
import { formatDateBR, formatMonthLabelPt, todayLocal } from '../utils/dateUtils';
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ArrowUpRight,
  Clock,
  Wallet,
  CreditCard as CreditCardIcon,
  Camera,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  PieChart,
  Filter,
  ShieldAlert,
  Building2,
} from 'lucide-react';

import type { SyncStatus } from '../services/cloudSyncService';
import { FinancialCalendarWidget } from './FinancialCalendarWidget';
import { usePrivacy } from '../contexts/PrivacyContext';
import { formatarValor } from '../utils/formatters';
import { BankLogo } from './BankLogo';
import { FinanceChart } from './finance/FinanceChart';
import { PeriodFilter } from './finance/PeriodFilter';
import { IncomeSourceCard } from './finance/IncomeSourceCard';

interface DashboardViewProps {
  transactions: Transaction[];
  accounts: Account[];
  boletos: Boleto[];
  cards: CreditCard[];
  debts?: Debt[];
  assets?: Asset[];
  salaryData?: SalaryDataset;
  budgets?: CategoryBudget[];
  scope: EntityScope;
  period: string;
  syncStatus?: SyncStatus;
  onNavigate: (tab: string, filter?: LedgerDrilldownFilter) => void;
  onOpenNew: () => void;
  onEditTransaction?: (tx: Transaction) => void;
  onScopeChange?: (scope: EntityScope) => void;
  onSelectAccount?: (accountId: string) => void;
  onSelectCard?: (cardId: string) => void;
}

function getPreviousMonthKey(period: string): string {
  const baseYm = period && /^\d{4}-\d{2}$/.test(period) ? period : todayLocal().slice(0, 7);
  const [y, m] = baseYm.split('-').map(Number);
  const prevDate = new Date(y, m - 2, 1);
  return `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
}

function getComparisonBaseKey(period: string): string {
  if (period && /^\d{4}-\d{2}$/.test(period)) return period;
  return todayLocal().slice(0, 7);
}

interface VariationInfo {
  label: string;
  direction: 'UP' | 'DOWN' | 'FLAT';
  isPositiveTone: boolean;
}

function computeVariation(
  currentCents: number,
  prevCents: number,
  invertPolarity = false
): VariationInfo | null {
  if (prevCents === 0) {
    if (currentCents === 0) return null;
    return null;
  }
  const rawPct = ((currentCents - prevCents) / Math.abs(prevCents)) * 100;
  if (Math.abs(rawPct) < 0.05) {
    return {
      label: '0,0%',
      direction: 'FLAT',
      isPositiveTone: true,
    };
  }
  const isUp = rawPct > 0;
  const formatted = `${isUp ? '+' : '-'}${Math.abs(rawPct).toFixed(1).replace('.', ',')}%`;
  const isPositiveTone = invertPolarity ? !isUp : isUp;
  return {
    label: formatted,
    direction: isUp ? 'UP' : 'DOWN',
    isPositiveTone,
  };
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  transactions,
  accounts,
  boletos,
  cards,
  debts = [],
  assets = [],
  salaryData,
  budgets = [],
  scope,
  period,
  syncStatus,
  onNavigate,
  onOpenNew,
  onEditTransaction,
  onSelectAccount,
  onSelectCard,
}) => {
  const { hideValues } = usePrivacy();
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<FinanceFilters>({});

  const consolidated = useMemo(
    () =>
      consolidateFinance({
        accounts,
        transactions,
        creditCards: cards,
        boletos,
        debts,
        assets,
        salaryData,
        scope,
        period,
        filters,
      }),
    [accounts, transactions, cards, boletos, debts, assets, salaryData, scope, period, filters]
  );

  const scopedAccounts = consolidated.scopedAccounts;
  const scopedCards = consolidated.scopedCards;
  const totalBalance = consolidated.summary.consolidatedBalance;
  const estimatedFreeBalance = consolidated.summary.estimatedFreeBalance;
  const totalIncome = consolidated.summary.totalIncome;
  const expectedIncome = consolidated.summary.expectedIncome;
  const totalExpense = consolidated.summary.totalExpenses;
  const expectedExpenses = consolidated.summary.expectedExpenses;
  const netResult = Number((totalIncome - totalExpense).toFixed(2));
  const preservationRate = consolidated.summary.savingsRatePct.toFixed(1);

  const scopedTransactions = useMemo(() => {
    return transactions.filter((t) => {
      if (t.status === 'CANCELLED') return false;
      if (scope === 'CPF') return t.entityId === 'CPF';
      if (scope === 'CNPJ') return t.entityId === 'CNPJ';
      return true;
    });
  }, [transactions, scope]);

  const periodTransactions = consolidated.filteredTransactions;

  const { incomeCents, expenseCents, netCents } = useMemo(() => {
    return {
      incomeCents: toCents(totalIncome),
      expenseCents: toCents(totalExpense),
      netCents: toCents(netResult),
    };
  }, [totalIncome, totalExpense, netResult]);

  // Month-over-month comparison metrics
  const { incomeVariation, expenseVariation, netVariation } = useMemo(() => {
    const baseKey = getComparisonBaseKey(period);
    const prevKey = getPreviousMonthKey(baseKey);
    const currentBaseMetrics =
      period === 'ALL'
        ? calculatePeriodMetricsCents(filterTransactionsByPeriod(scopedTransactions, baseKey))
        : {
            confirmedIncomeCents: incomeCents,
            confirmedExpenseCents: expenseCents,
            realizedNetCents: netCents,
          };
    const prevMetrics = calculatePeriodMetricsCents(
      filterTransactionsByPeriod(scopedTransactions, prevKey)
    );

    return {
      incomeVariation: computeVariation(
        currentBaseMetrics.confirmedIncomeCents,
        prevMetrics.confirmedIncomeCents,
        false
      ),
      expenseVariation: computeVariation(
        currentBaseMetrics.confirmedExpenseCents,
        prevMetrics.confirmedExpenseCents,
        true
      ),
      netVariation: computeVariation(
        currentBaseMetrics.realizedNetCents,
        prevMetrics.realizedNetCents,
        false
      ),
    };
  }, [scopedTransactions, period, incomeCents, expenseCents, netCents]);

  const pendingBoletos = useMemo(() => {
    return consolidated.scopedBoletos
      .filter((b) => b.status === 'PENDING')
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  }, [consolidated.scopedBoletos]);

  const totalPendingBoletos = consolidated.summary.totalPendingBoletos;

  const donutData = useMemo(() => {
    const totalFlow = Math.max(0, incomeCents) + Math.max(0, expenseCents);
    const radius = 42;
    const circumference = 2 * Math.PI * radius;
    const incomeShare = totalFlow > 0 ? Math.max(0, incomeCents) / totalFlow : 0;
    const expenseShare = totalFlow > 0 ? Math.max(0, expenseCents) / totalFlow : 0;
    return {
      radius,
      circumference,
      incomePct: Math.round(incomeShare * 100),
      expensePct: Math.round(expenseShare * 100),
      incomeStroke: incomeShare * circumference,
      expenseStroke: expenseShare * circumference,
      hasData: totalFlow > 0,
    };
  }, [incomeCents, expenseCents]);

  const sortedRecent = useMemo(() => {
    return [...periodTransactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  }, [periodTransactions]);

  const budgetAlerts = useMemo(() => {
    if (budgets.length === 0) return [];
    return analyzeCategoryBudgets({
      budgets,
      transactions,
      scope,
      period,
      includeProjected: true,
    }).filter((b) => b.alertLevel !== 'OK');
  }, [budgets, transactions, scope, period]);

  const cashFlow30 = useMemo(
    () =>
      buildCashFlowProjection({
        accounts,
        transactions,
        boletos,
        scope,
        horizonDays: 30,
      }),
    [accounts, transactions, boletos, scope]
  );

  const activeFiltersCount = useMemo(() => {
    let n = 0;
    if (filters.startDate) n += 1;
    if (filters.endDate) n += 1;
    if (filters.accountId) n += 1;
    if (filters.cardId) n += 1;
    if (filters.category) n += 1;
    if (filters.source) n += 1;
    if (filters.type && filters.type !== 'all') n += 1;
    return n;
  }, [filters]);

  const availableCategories = useMemo(() => {
    const set = new Set<string>(APP_CATEGORIES);
    for (const tx of scopedTransactions) {
      if (tx.category) set.add(tx.category);
    }
    return Array.from(set);
  }, [scopedTransactions]);

  const periodSubtitleLabel = useMemo(() => {
    if (period === 'ALL') return 'Todo período';
    if (/^\d{4}-\d{2}$/.test(period)) return formatMonthLabelPt(period);
    return period;
  }, [period]);

  const renderVariationBadge = (info: VariationInfo | null) => {
    if (!info) {
      return (
        <span className="text-[11px] font-medium text-[#64748B] dark:text-slate-300">
          vs mês ant.
        </span>
      );
    }

    const toneClass = info.isPositiveTone
      ? 'text-[#059669] dark:text-[#10B981]'
      : 'text-[#DC2626] dark:text-red-300';

    return (
      <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold font-money ${toneClass}`}>
        {info.direction === 'UP' && <ArrowUp size={11} strokeWidth={2.25} />}
        {info.direction === 'DOWN' && <ArrowDown size={11} strokeWidth={2.25} />}
        <span>{info.label}</span>
      </span>
    );
  };

  const handleIncomeSourceSelect = (item: IncomeChartItem) => {
    setFilters((prev) => ({
      ...prev,
      source: prev.source === item.originKey ? undefined : item.originKey,
    }));
  };

  return (
    <div className="space-y-3.5 sm:space-y-5 min-w-0 overflow-x-clip animate-fadeIn">
      {/* Unified Mobile-First Header Row */}
      <div className="flex items-start sm:items-center justify-between gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-lg sm:text-2xl font-bold text-[#0F172A] dark:text-white tracking-tight text-balance leading-tight">
            Visão geral
          </h1>
          <p className="font-sans text-[11px] sm:text-sm text-[#64748B] dark:text-slate-300 mt-0.5 leading-snug">
            Resumo das suas finanças ·{' '}
            <span className="font-semibold text-[#0F172A] dark:text-white">
              {periodSubtitleLabel}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={`sf-card-interactive px-2.5 sm:px-3.5 min-h-10 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
              showFilters || activeFiltersCount > 0
                ? 'border-[#059669] text-[#059669] dark:text-[#10B981]'
                : 'text-[#0F172A] dark:text-white'
            }`}
          >
            <Filter size={15} strokeWidth={1.75} />
            <span>Filtros{activeFiltersCount > 0 ? ` (${activeFiltersCount})` : ''}</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('documents')}
            aria-label="Scanner de documentos"
            className="sf-card-interactive px-2.5 sm:px-3.5 min-w-10 min-h-10 text-xs font-semibold text-[#0F172A] dark:text-white flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Camera size={15} strokeWidth={1.75} className="text-[#059669] dark:text-[#10B981]" />
            <span className="hidden min-[400px]:inline">Scanner</span>
          </button>
        </div>
      </div>

      {/* Global Reactive Filters */}
      {(showFilters || activeFiltersCount > 0) && (
        <PeriodFilter
          filters={filters}
          onChange={setFilters}
          accounts={accounts}
          cards={cards}
          categories={availableCategories}
          showAccountFilter={true}
          showCardFilter={true}
          showSourceFilter={true}
          showTypeFilter={true}
        />
      )}

      {/* 1. SALDO TOTAL NAS CONTAS (MOBILE-FIRST COMPACTO) + DONUT PROPORÇÃO DO MÊS */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-3.5 sm:gap-4 items-stretch min-w-0">
        <div className="lg:col-span-2 sf-hero-card text-white p-3.5 sm:p-5 flex flex-col justify-between gap-2.5 sm:gap-3.5 min-w-0">
          {/* Kicker row */}
          <div className="flex items-center justify-between gap-2 min-w-0">
            <span className="font-sans text-xs font-semibold text-emerald-300 tracking-wide flex items-center gap-1.5 truncate">
              <Wallet size={14} strokeWidth={1.75} className="shrink-0" />
              Saldo total nas contas
            </span>
            <span className="font-sans text-[11px] text-white/75 shrink-0">
              {scopedAccounts.length} conta{scopedAccounts.length !== 1 ? 's' : ''} vinculada
              {scopedAccounts.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Primary Balance + "Ver contas" button right alongside the balance */}
          {scopedAccounts.length === 0 ? (
            <div className="flex items-center justify-between gap-3 min-w-0">
              <div className="min-w-0">
                <div className="font-display text-lg sm:text-2xl font-extrabold text-white tracking-tight">
                  Nenhuma conta cadastrada
                </div>
                <p className="font-sans text-[11px] sm:text-xs text-white/80 mt-0.5">
                  Cadastre sua primeira conta para acompanhar saldos.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('accounts')}
                className="px-3 sm:px-3.5 min-h-10 bg-white/12 hover:bg-white/20 text-white rounded-xl text-xs font-semibold border border-white/15 transition-colors inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>Ver contas</span>
                <ChevronRight size={14} strokeWidth={2} />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2.5 min-w-0">
              <div className="font-money text-2xl sm:text-3xl font-extrabold text-white tracking-tight leading-none truncate">
                {formatarValor(totalBalance, hideValues)}
              </div>
              <button
                type="button"
                onClick={() => onNavigate('accounts')}
                className="px-3 sm:px-3.5 min-h-10 bg-white/12 hover:bg-white/20 text-white rounded-xl text-xs font-semibold border border-white/15 transition-colors inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>Ver contas</span>
                <ChevronRight size={14} strokeWidth={2} />
              </button>
            </div>
          )}

          {/* Compact Bottom Line: Saldo livre estimado */}
          {scopedAccounts.length > 0 && (
            <div className="pt-2 border-t border-white/12 flex items-center justify-between gap-2 text-xs min-w-0">
              <span className="font-sans text-white/75 truncate">Saldo livre estimado</span>
              <span className="font-money text-sm sm:text-base font-bold text-emerald-300 shrink-0">
                {formatarValor(estimatedFreeBalance, hideValues)}
              </span>
            </div>
          )}

          {(syncStatus === 'PENDING_OFFLINE' ||
            syncStatus === 'UNVERIFIED_EMAIL' ||
            syncStatus === 'CONFLICT') && (
            <p className="text-[11px] text-amber-300 font-medium">
              Salvo localmente · sincronização pendente com a nuvem.
            </p>
          )}
        </div>

        {/* Donut Card: Receitas (#10B981) vs Despesas (#EF4444) */}
        <div className="sf-card p-3.5 sm:p-5 flex items-center justify-between gap-3 sm:gap-4 min-w-0">
          <div className="relative w-20 h-20 sm:w-24 sm:h-24 shrink-0 flex items-center justify-center">
            <svg viewBox="0 0 108 108" className="w-full h-full -rotate-90" aria-hidden="true">
              <circle
                cx="54"
                cy="54"
                r={donutData.radius}
                fill="none"
                stroke="currentColor"
                strokeWidth="12"
                className="text-slate-100 dark:text-white/10"
              />
              {donutData.hasData && donutData.incomeStroke > 0 && (
                <circle
                  cx="54"
                  cy="54"
                  r={donutData.radius}
                  fill="none"
                  stroke="#10B981"
                  strokeWidth="12"
                  strokeLinecap={donutData.expenseStroke === 0 ? 'round' : 'butt'}
                  strokeDasharray={`${donutData.incomeStroke} ${donutData.circumference}`}
                  strokeDashoffset="0"
                />
              )}
              {donutData.hasData && donutData.expenseStroke > 0 && (
                <circle
                  cx="54"
                  cy="54"
                  r={donutData.radius}
                  fill="none"
                  stroke="#EF4444"
                  strokeWidth="12"
                  strokeLinecap={donutData.incomeStroke === 0 ? 'round' : 'butt'}
                  strokeDasharray={`${donutData.expenseStroke} ${donutData.circumference}`}
                  strokeDashoffset={-donutData.incomeStroke}
                />
              )}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-1.5">
              <span className="text-[9px] sm:text-[10px] font-medium text-[#64748B] dark:text-slate-300 uppercase tracking-wider">
                Saldo mês
              </span>
              <span className="font-money text-[11px] sm:text-xs font-extrabold text-[#0F172A] dark:text-white leading-tight mt-0.5">
                {donutData.hasData ? `${preservationRate}%` : '0%'}
              </span>
            </div>
          </div>

          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-1.5">
              <PieChart size={15} strokeWidth={1.75} className="text-[#059669] dark:text-[#10B981] shrink-0" />
              <h3 className="font-display text-xs sm:text-sm font-bold text-[#0F172A] dark:text-white truncate">
                Proporção do mês
              </h3>
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                <span className="flex items-center gap-1.5 text-[#64748B] dark:text-slate-300 font-medium">
                  <span className="w-2 h-2 rounded-full bg-[#10B981] shrink-0" />
                  Receitas ({donutData.incomePct}%)
                </span>
                <span className="font-money font-bold text-[#0F172A] dark:text-white shrink-0">
                  {formatarValor(totalIncome, hideValues)}
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                <span className="flex items-center gap-1.5 text-[#64748B] dark:text-slate-300 font-medium">
                  <span className="w-2 h-2 rounded-full bg-[#EF4444] shrink-0" />
                  Despesas ({donutData.expensePct}%)
                </span>
                <span className="font-money font-bold text-[#0F172A] dark:text-white shrink-0">
                  {formatarValor(totalExpense, hideValues)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. KPI STRIP (2 COLUNAS NO MOBILE/TABLET · 4 COLUNAS NO DESKTOP) */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4 min-w-0">
        <button
          type="button"
          onClick={() =>
            onNavigate(scope === 'CNPJ' ? 'cnpj' : 'cpf', {
              direction: 'INCOME',
              status: 'CONFIRMED',
            })
          }
          className="sf-card-interactive text-left p-3 sm:p-4 lg:p-5 min-h-[104px] cursor-pointer flex flex-col justify-between gap-2 min-w-0"
        >
          <div className="flex items-center justify-between gap-1.5">
            <span className="font-sans text-xs font-medium text-[#64748B] dark:text-slate-300 truncate">Receitas</span>
            <span className="sf-icon-badge">
              <TrendingUp size={16} strokeWidth={1.75} />
            </span>
          </div>
          <div className="font-money text-[15px] min-[390px]:text-base sm:text-xl xl:text-2xl font-extrabold text-[#059669] dark:text-white leading-tight break-words">
            {formatarValor(totalIncome, hideValues)}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-1.5 gap-y-0.5 text-[11px] text-[#64748B] dark:text-slate-300">
            {expectedIncome > 0 ? (
              <span className="font-money truncate">Prev.: {formatarValor(expectedIncome, hideValues)}</span>
            ) : (
              renderVariationBadge(incomeVariation)
            )}
            <span className="font-sans font-medium inline-flex items-center gap-0.5 shrink-0">
              Entradas <ChevronRight size={12} strokeWidth={1.75} />
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() =>
            onNavigate(scope === 'CNPJ' ? 'cnpj' : 'cpf', {
              direction: 'EXPENSE',
              status: 'CONFIRMED',
            })
          }
          className="sf-card-interactive text-left p-3 sm:p-4 lg:p-5 min-h-[104px] cursor-pointer flex flex-col justify-between gap-2 min-w-0"
        >
          <div className="flex items-center justify-between gap-1.5">
            <span className="font-sans text-xs font-medium text-[#64748B] dark:text-slate-300 truncate">Despesas</span>
            <span className="sf-icon-badge-danger">
              <TrendingDown size={16} strokeWidth={1.75} />
            </span>
          </div>
          <div className="font-money text-[15px] min-[390px]:text-base sm:text-xl xl:text-2xl font-extrabold text-[#DC3545] dark:text-white leading-tight break-words">
            {formatarValor(totalExpense, hideValues)}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-1.5 gap-y-0.5 text-[11px] text-[#64748B] dark:text-slate-300">
            {expectedExpenses > 0 ? (
              <span className="font-money truncate">Prev.: {formatarValor(expectedExpenses, hideValues)}</span>
            ) : (
              renderVariationBadge(expenseVariation)
            )}
            <span className="font-sans font-medium inline-flex items-center gap-0.5 shrink-0">
              Saídas <ChevronRight size={12} strokeWidth={1.75} />
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('cards')}
          className="sf-card-interactive text-left p-3 sm:p-4 lg:p-5 min-h-[104px] cursor-pointer flex flex-col justify-between gap-2 min-w-0"
        >
          <div className="flex items-center justify-between gap-1.5">
            <span className="font-sans text-xs font-medium text-[#64748B] dark:text-slate-300 leading-tight">Faturas</span>
            <span className="sf-icon-badge-amber">
              <CreditCardIcon size={16} strokeWidth={1.75} />
            </span>
          </div>
          <div className="font-money text-[15px] min-[390px]:text-base sm:text-xl xl:text-2xl font-extrabold text-amber-600 dark:text-white leading-tight break-words">
            {formatarValor(consolidated.summary.openInvoices, hideValues)}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-1.5 gap-y-0.5 text-[11px] text-[#64748B] dark:text-slate-300">
            <span className="font-money truncate">
              Boletos: {formatarValor(totalPendingBoletos, hideValues)}
            </span>
            <span className="font-sans font-medium inline-flex items-center gap-0.5 shrink-0">
              Cartões <ChevronRight size={12} strokeWidth={1.75} />
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate(consolidated.summary.totalDebt > 0 ? 'debts' : 'reports')}
          className="sf-card-interactive text-left p-3 sm:p-4 lg:p-5 min-h-[104px] cursor-pointer flex flex-col justify-between gap-2 min-w-0"
        >
          <div className="flex items-center justify-between gap-1.5">
            <span className="font-sans text-xs font-medium text-[#64748B] dark:text-slate-300 leading-tight">
              {consolidated.summary.totalDebt > 0 ? 'Compromissos' : 'Resultado'}
            </span>
            <span
              className={
                consolidated.summary.totalDebt > 0
                  ? 'sf-icon-badge-danger'
                  : netResult >= 0
                    ? 'sf-icon-badge'
                    : 'sf-icon-badge-danger'
              }
            >
              {consolidated.summary.totalDebt > 0 ? (
                <ShieldAlert size={16} strokeWidth={1.75} />
              ) : (
                <ArrowUpRight size={16} strokeWidth={1.75} />
              )}
            </span>
          </div>
          <div
            className={`font-money text-[15px] min-[390px]:text-base sm:text-xl xl:text-2xl font-extrabold leading-tight break-words ${
              consolidated.summary.totalDebt > 0
                ? 'text-[#DC3545] dark:text-white'
                : netResult >= 0
                  ? 'text-[#059669] dark:text-white'
                  : 'text-[#DC3545] dark:text-white'
            }`}
          >
            {formatarValor(
              consolidated.summary.totalDebt > 0 ? consolidated.summary.totalDebt : netResult,
              hideValues
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-1.5 gap-y-0.5 text-[11px] text-[#64748B] dark:text-slate-300">
            {consolidated.summary.totalDebt > 0 ? (
              <span className="font-money truncate">
                Mês: {formatarValor(consolidated.summary.monthlyDebtCommitment, hideValues)}
              </span>
            ) : (
              renderVariationBadge(netVariation)
            )}
            <span className="font-sans font-medium inline-flex items-center gap-0.5 shrink-0">
              {consolidated.summary.totalDebt > 0 ? 'Dívidas' : `${preservationRate}%`}{' '}
              <ChevronRight size={12} strokeWidth={1.75} />
            </span>
          </div>
        </button>
      </section>

      {/* 3. RESUMO DAS CONTAS BANCÁRIAS (CLICÁVEL PARA PAINEL INDIVIDUAL) */}
      {scopedAccounts.length > 0 && (
        <section className="sf-card p-3.5 sm:p-5 space-y-3 min-w-0">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="sf-icon-badge-navy">
                <Building2 size={16} strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <h3 className="font-display text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">
                  Contas bancárias
                </h3>
                <p className="text-[11px] sm:text-xs text-[#64748B] dark:text-slate-300 truncate">
                  Toque em uma conta para abrir histórico e gráficos
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('accounts')}
              className="min-h-10 sm:min-h-9 px-2 text-xs font-semibold text-[#059669] dark:text-[#10B981] hover:underline flex items-center gap-0.5 cursor-pointer shrink-0 whitespace-nowrap"
            >
              Gerenciar <ChevronRight size={14} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 min-w-0">
            {scopedAccounts.filter((a) => !a.archived).slice(0, 4).map((acc) => (
              <button
                key={acc.id}
                type="button"
                onClick={() => (onSelectAccount ? onSelectAccount(acc.id) : onNavigate('accounts'))}
                className="sf-card-interactive text-left p-3 sm:p-3.5 min-h-[54px] flex items-center justify-between gap-2.5 cursor-pointer min-w-0"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <BankLogo
                    bankName={acc.institutionName}
                    bankCode={acc.bankCode}
                    logoUrl={acc.logoUrl}
                    size={38}
                  />
                  <div className="min-w-0">
                    <div className="font-display text-xs font-bold text-[#0F172A] dark:text-white truncate">
                      {acc.institutionName}
                    </div>
                    <div className="text-[11px] text-[#64748B] dark:text-slate-300 truncate">
                      {acc.accountName} · {acc.entityId}
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-money text-sm font-extrabold text-[#0F172A] dark:text-[#10B981]">
                    {formatarValor(acc.balance, hideValues)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 4. RECHARTS ANALÍTICOS: FLUXO MENSAL + DESPESAS POR CATEGORIA */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 sm:gap-5 min-w-0">
        <FinanceChart
          title="Fluxo financeiro mensal"
          subtitle="Receitas unificadas vs Despesas operacionais"
          variant="bar"
          height={215}
          data={consolidated.monthlyFlow as unknown as Array<Record<string, unknown>>}
          xKey="label"
          series={[
            { dataKey: 'income', name: 'Receitas', color: '#10B981' },
            { dataKey: 'expense', name: 'Despesas', color: '#EF4444' },
          ]}
        />

        <FinanceChart
          title="Despesas por categoria"
          subtitle="Toque em uma categoria para filtrar no extrato"
          variant="donut"
          data={consolidated.expensesByCategory.slice(0, 7).map((c) => ({
            name: c.category,
            value: c.totalAmount,
            percentage: c.percentage,
          }))}
          onSliceClick={(entry) => {
            const cat = String(entry.name || '');
            if (cat) {
              setFilters((prev) => ({
                ...prev,
                category: prev.category === cat ? undefined : cat,
              }));
            }
          }}
        />
      </section>

      {/* 5. FONTES DE RECEITA UNIFICADAS */}
      <section className="sf-card p-3.5 sm:p-5 space-y-3 sm:space-y-4 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-display text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">
              Receitas por origem
            </h3>
            <p className="text-[11px] sm:text-xs text-[#64748B] dark:text-slate-300 leading-snug">
              Integra salários, comissões, MEI, rendimentos e extras sem contagem dupla
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('salary')}
            className="min-h-10 sm:min-h-9 px-2 text-xs font-semibold text-[#059669] dark:text-[#10B981] hover:underline flex items-center gap-0.5 cursor-pointer shrink-0 whitespace-nowrap"
          >
            Salários & Rendas <ChevronRight size={14} />
          </button>
        </div>

        {consolidated.incomeBySource.length === 0 ? (
          <p className="text-xs text-[#64748B] dark:text-slate-300 py-3">
            Nenhuma receita registrada para os filtros atuais.
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5 sm:gap-4 items-start min-w-0">
            <div className="lg:col-span-1 min-w-0">
              <FinanceChart
                title="Distribuição das entradas"
                variant="donut"
                height={200}
                data={consolidated.incomeBySource.map((s) => ({
                  name: s.sourceName,
                  value: s.totalAmount,
                  percentage: s.percentage,
                  color: s.color,
                  originKey: s.originKey,
                }))}
                onSliceClick={(entry) => {
                  const key = entry.originKey as IncomeChartItem['originKey'] | undefined;
                  if (key) {
                    setFilters((prev) => ({
                      ...prev,
                      source: prev.source === key ? undefined : key,
                    }));
                  }
                }}
              />
            </div>

            <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {consolidated.incomeBySource.map((item) => (
                <IncomeSourceCard
                  key={item.originKey}
                  item={item}
                  active={filters.source === item.originKey}
                  onSelect={handleIncomeSourceSelect}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 6. Tabbed Transactions & Minimizable Calendar Widget */}
      <FinancialCalendarWidget
        transactions={transactions}
        accounts={accounts}
        scope={scope}
        period={period}
        onEditTransaction={onEditTransaction}
      />

      {/* RADAR DE ORÇAMENTO E FLUXO PROJETADO */}
      {(budgetAlerts.length > 0 || cashFlow30.lowestBalanceCents < 0) && (
        <section className="bg-amber-50/90 dark:bg-[#11185A] border border-amber-200 dark:border-amber-400/30 p-4 sm:p-5 rounded-2xl space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-extrabold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-300" strokeWidth={1.75} />
              Radar Financeiro (Orçamento & Liquidez 30d)
            </span>
            <div className="flex items-center gap-3">
              {budgetAlerts.length > 0 && (
                <button
                  type="button"
                  onClick={() => onNavigate('planning')}
                  className="text-xs font-bold text-amber-900 dark:text-amber-200 inline-flex items-center gap-0.5 hover:underline cursor-pointer"
                >
                  Ver tetos <ChevronRight size={13} strokeWidth={1.75} />
                </button>
              )}
              {cashFlow30.lowestBalanceCents < 0 && (
                <button
                  type="button"
                  onClick={() => onNavigate('reports')}
                  className="text-xs font-bold text-red-700 dark:text-red-300 inline-flex items-center gap-0.5 hover:underline cursor-pointer"
                >
                  Ver projeção <ChevronRight size={13} strokeWidth={1.75} />
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {budgetAlerts.map((a) => (
              <span
                key={a.budget.id}
                className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                  a.alertLevel === 'EXCEEDED'
                    ? 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200'
                    : 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200'
                }`}
              >
                {a.budget.category}: {a.utilizationPct}% do teto
              </span>
            ))}
            {cashFlow30.lowestBalanceCents < 0 && (
              <span className="px-3 py-1 rounded-lg text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200">
                Caixa projetado negativo ({formatarValor(cashFlow30.lowestBalance, hideValues)}) em{' '}
                {formatDateBR(cashFlow30.lowestBalanceDate)}
              </span>
            )}
          </div>
        </section>
      )}

      {/* 7. CENTRAL DE VENCIMENTOS & CARTÕES */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-3.5 sm:gap-5 min-w-0">
        <div className="lg:col-span-2 sf-card p-3.5 sm:p-5 space-y-3 sm:space-y-4 min-w-0">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="sf-icon-badge">
                <Clock size={16} strokeWidth={1.75} />
              </span>
              <h3 className="font-display text-sm sm:text-base font-bold text-[#0F172A] dark:text-white truncate">
                Próximos vencimentos
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('boletos')}
              className="px-3.5 min-h-10 sm:min-h-9 bg-[#059669] hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
            >
              Boletos <ChevronRight size={14} strokeWidth={2} />
            </button>
          </div>

          {pendingBoletos.length === 0 && consolidated.upcomingDues.length === 0 ? (
            <p className="font-sans text-xs sm:text-sm text-[#64748B] dark:text-slate-300 py-2">
              Nenhum boleto ou obrigação pendente para o escopo selecionado.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 min-w-0">
              {(pendingBoletos.length > 0 ? pendingBoletos.slice(0, 4) : []).map((bol) => {
                const countdown = calculateCountdown(bol.vencimento, false);
                return (
                  <div
                    key={bol.id}
                    className="p-3.5 rounded-xl bg-[#F8FAFC] dark:bg-white/5 border border-[#E2E8F0] dark:border-white/10 flex flex-col justify-between gap-2 min-w-0"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display text-xs font-bold text-[#0F172A] dark:text-white truncate">
                          {bol.beneficiario}
                        </span>
                        <span className="text-[10px] font-bold text-[#64748B] dark:text-slate-300 shrink-0">
                          {bol.entityId}
                        </span>
                      </div>
                      <div className="font-money text-base font-bold text-[#0F172A] dark:text-white mt-1">
                        {formatarValor(bol.valorOriginal, hideValues)}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${countdown.badgeColor}`}>
                        {countdown.shortLabel}
                      </span>
                      <span className="text-[11px] text-[#64748B] dark:text-slate-300">
                        {formatDateBR(bol.vencimento)}
                      </span>
                    </div>
                  </div>
                );
              })}
              {pendingBoletos.length === 0 &&
                consolidated.upcomingDues.slice(0, 4).map((due) => (
                  <button
                    key={due.id}
                    type="button"
                    onClick={() => onNavigate(due.targetTab)}
                    className="text-left p-3.5 min-h-[68px] rounded-xl bg-[#F8FAFC] dark:bg-white/5 border border-[#E2E8F0] dark:border-white/10 flex flex-col justify-between gap-1 cursor-pointer hover:border-[#CBD5E1] min-w-0"
                  >
                    <div className="font-display text-xs font-bold text-[#0F172A] dark:text-white truncate">
                      {due.title}
                    </div>
                    <div className="text-[11px] text-[#64748B] dark:text-slate-300 truncate">
                      {due.subtitle} · {formatDateBR(due.date)}
                    </div>
                    <div className="font-money text-sm font-bold text-[#DC3545] dark:text-red-300 mt-1">
                      {formatarValor(due.amount, hideValues)}
                    </div>
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* Cards Summary */}
        <div className="sf-card p-3.5 sm:p-5 space-y-3 min-w-0">
          <div className="flex items-center justify-between text-xs font-bold text-[#0F172A] dark:text-white">
            <span className="font-display flex items-center gap-1.5 text-sm truncate">
              <CreditCardIcon size={16} strokeWidth={1.75} className="text-amber-500 shrink-0" /> Cartões de crédito
            </span>
            <button
              type="button"
              onClick={() => onNavigate('cards')}
              className="min-h-10 sm:min-h-8 px-1.5 text-[#059669] dark:text-[#10B981] font-semibold hover:underline cursor-pointer whitespace-nowrap shrink-0"
            >
              Ver todos
            </button>
          </div>
          {scopedCards.length === 0 ? (
            <p className="text-xs text-[#64748B] dark:text-slate-300">
              Nenhum cartão cadastrado neste escopo.
            </p>
          ) : (
            <div className="space-y-2">
              {scopedCards.slice(0, 4).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => (onSelectCard ? onSelectCard(c.id) : onNavigate('cards'))}
                  className="w-full min-h-[52px] text-left flex justify-between items-center gap-2 text-xs bg-[#F8FAFC] dark:bg-white/5 hover:border-[#CBD5E1] px-3.5 py-2.5 rounded-xl border border-[#E2E8F0] dark:border-white/10 cursor-pointer transition-colors min-w-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[#0F172A] dark:text-white truncate font-semibold">
                      {c.cardName}
                    </div>
                    <div className="text-[11px] text-[#64748B] dark:text-slate-300 truncate">
                      Final {c.last4} · Vence dia {c.dueDay}
                    </div>
                  </div>
                  <span className="font-money font-bold text-[#DC3545] dark:text-white shrink-0">
                    {formatarValor(c.currentInvoiceAmount, hideValues)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 8. MOVIMENTAÇÕES RECENTES */}
      <section className="sf-card p-3.5 sm:p-6 min-w-0">
        <div className="flex items-center justify-between mb-3 sm:mb-4 gap-2">
          <h3 className="font-display text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">
            Últimas movimentações
          </h3>
          <button
            type="button"
            onClick={() => onNavigate(scope === 'CNPJ' ? 'cnpj' : 'cpf')}
            className="text-xs font-semibold text-[#059669] dark:text-[#10B981] hover:underline flex items-center gap-1 cursor-pointer min-h-10 sm:min-h-9 px-2 whitespace-nowrap shrink-0"
          >
            Ver todas <ChevronRight size={15} strokeWidth={1.75} />
          </button>
        </div>

        {sortedRecent.length === 0 ? (
          <p className="font-sans text-sm text-[#64748B] dark:text-slate-300 py-6 text-center">
            Nenhuma movimentação encontrada para este período e filtro.
          </p>
        ) : (
          <>
            <div className="md:hidden sf-grouped-card sf-grouped-divider">
              {sortedRecent.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onEditTransaction && onEditTransaction(t)}
                  className="w-full text-left px-3.5 py-3 flex items-center justify-between gap-3 active:bg-slate-50 dark:active:bg-white/5 transition-colors cursor-pointer"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[#0F172A] dark:text-white truncate">
                      {t.description}
                    </div>
                    <div className="text-xs text-[#64748B] dark:text-slate-300 mt-0.5 truncate">
                      {t.date.split('-').reverse().join('/')} · {t.category} · {t.entityId}
                      {t.status === 'PENDING' ? ' · Pendente' : t.status === 'PLANNED' ? ' · Planejado' : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`font-money text-sm font-bold ${
                        t.direction === 'INCOME'
                          ? 'text-[#059669] dark:text-white'
                          : 'text-[#DC3545] dark:text-white'
                      }`}
                    >
                      {hideValues
                        ? formatarValor(fromCents(getTransactionAmountCents(t)), true)
                        : `${t.direction === 'INCOME' ? '+ ' : '− '}${formatarValor(fromCents(getTransactionAmountCents(t)), false)}`}
                    </span>
                    <ChevronRight size={15} strokeWidth={1.75} className="text-[#94A3B8] dark:text-slate-400" />
                  </div>
                </button>
              ))}
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-[#64748B] dark:text-slate-300 border-b border-[#F1F5F9] dark:border-white/10">
                    <th className="pb-3 font-semibold">Data</th>
                    <th className="pb-3 font-semibold">Descrição</th>
                    <th className="pb-3 font-semibold">Categoria</th>
                    <th className="pb-3 font-semibold">Conta</th>
                    <th className="pb-3 font-semibold">Vínculo</th>
                    <th className="pb-3 font-semibold text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9] dark:divide-white/10">
                  {sortedRecent.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => onEditTransaction && onEditTransaction(t)}
                      className="hover:bg-slate-50/80 dark:hover:bg-white/5 transition-colors cursor-pointer"
                    >
                      <td className="py-3 text-[#64748B] dark:text-slate-300">
                        {t.date.split('-').reverse().join('/')}
                      </td>
                      <td className="py-3 font-medium text-[#0F172A] dark:text-white">
                        {t.description}
                        {t.isInternalTransfer ? ' · Transferência' : ''}
                        {t.status === 'PENDING' ? ' · Pendente' : t.status === 'PLANNED' ? ' · Planejado' : ''}
                      </td>
                      <td className="py-3 text-[#0F172A] dark:text-slate-200">{t.category}</td>
                      <td className="py-3 text-[#64748B] dark:text-slate-300">{t.account}</td>
                      <td className="py-3 font-semibold text-[#0F172A] dark:text-slate-200">{t.entityId}</td>
                      <td
                        className={`font-money py-3 text-right font-bold ${
                          t.direction === 'INCOME'
                            ? 'text-[#059669] dark:text-white'
                            : 'text-[#DC3545] dark:text-white'
                        }`}
                      >
                        {hideValues
                          ? formatarValor(fromCents(getTransactionAmountCents(t)), true)
                          : `${t.direction === 'INCOME' ? '+ ' : '− '}${formatarValor(fromCents(getTransactionAmountCents(t)), false)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
};
