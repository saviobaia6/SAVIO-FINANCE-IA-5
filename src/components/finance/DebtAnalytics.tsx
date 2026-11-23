import React, { useMemo } from 'react';
import { CalendarClock, CheckCircle2, Percent, ShieldAlert } from 'lucide-react';
import type { Debt, EntityScope } from '../../types';
import { calculateDebtAnalytics } from '../../domain/debts/DebtAnalyticsService';
import { FinanceSummaryCard } from './FinanceSummaryCard';
import { FinanceChart } from './FinanceChart';
import { usePrivacy } from '../../contexts/PrivacyContext';
import { formatarValor } from '../../utils/formatters';

interface DebtAnalyticsProps {
  debts: readonly Debt[];
  monthlyIncomeReference?: number;
  scope?: EntityScope;
}

export const DebtAnalytics: React.FC<DebtAnalyticsProps> = ({
  debts,
  monthlyIncomeReference = 0,
  scope = 'CONSOLIDATED',
}) => {
  const { hideValues } = usePrivacy();

  const analytics = useMemo(
    () => calculateDebtAnalytics(debts, monthlyIncomeReference, scope),
    [debts, monthlyIncomeReference, scope]
  );

  const debtBreakdownData = useMemo(
    () =>
      analytics.items
        .filter((i) => i.debt.outstandingAmount > 0 && i.debt.status !== 'PAID')
        .map((i) => ({
          name: i.debt.creditorName,
          value: i.debt.outstandingAmount,
        })),
    [analytics.items]
  );

  if (debts.length === 0) return null;

  return (
    <div className="space-y-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <FinanceSummaryCard
          title="Saldo devedor total"
          value={analytics.totalOutstanding}
          subtitle={`Contratado: ${formatarValor(analytics.totalContracted, hideValues)}`}
          tone="expense"
          icon={<ShieldAlert size={18} strokeWidth={1.75} />}
        />
        <FinanceSummaryCard
          title="Total já amortizado"
          value={analytics.totalPaid}
          subtitle={`${analytics.paidPercentage.toFixed(1)}% quitado`}
          tone="income"
          icon={<CheckCircle2 size={18} strokeWidth={1.75} />}
        />
        <FinanceSummaryCard
          title="Parcelas mensais"
          value={analytics.monthlyCommitments}
          subtitle={
            analytics.estimatedMonthsToPayoff > 0
              ? `Prazo est.: ~${analytics.estimatedMonthsToPayoff} meses`
              : `${analytics.activeCount} contrato(s) ativo(s)`
          }
          tone="amber"
          icon={<CalendarClock size={18} strokeWidth={1.75} />}
        />
        <div className="sf-card p-4 sm:p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="font-sans text-xs font-medium text-[#64748B] dark:text-slate-300">
              Comprometimento da renda
            </span>
            <span
              className={
                analytics.incomeCommitmentPct > 30 ? 'sf-icon-badge-danger' : 'sf-icon-badge-navy'
              }
            >
              <Percent size={18} strokeWidth={1.75} />
            </span>
          </div>
          <div
            className={`font-money text-lg sm:text-2xl font-extrabold mt-1 ${
              analytics.incomeCommitmentPct > 30
                ? 'text-[#DC3545] dark:text-red-400'
                : 'text-[#0F172A] dark:text-white'
            }`}
          >
            {monthlyIncomeReference > 0 ? `${analytics.incomeCommitmentPct.toFixed(1)}%` : '—'}
          </div>
          <div className="text-[11px] text-[#64748B] dark:text-slate-300 mt-1.5">
            {monthlyIncomeReference > 0
              ? `Ref. renda: ${formatarValor(monthlyIncomeReference, hideValues)}`
              : 'Cadastre receitas para calcular'}
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="sf-card p-5 space-y-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-[#0F172A] dark:text-white">
            Progresso de quitação das dívidas
          </span>
          <span className="font-money font-bold text-[#059669] dark:text-[#10B981]">
            {analytics.paidPercentage.toFixed(1)}% pago
          </span>
        </div>
        <div className="w-full h-2.5 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-[#059669] transition-all"
            style={{ width: `${Math.min(100, analytics.paidPercentage)}%` }}
          />
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <FinanceChart
          title="Projeção de quitação (12 meses)"
          subtitle="Saldo devedor estimado considerando parcelas mensais e juros"
          variant="area"
          data={analytics.payoffProjection as unknown as Array<Record<string, unknown>>}
          xKey="label"
          series={[
            {
              dataKey: 'projectedOutstanding',
              name: 'Saldo devedor projetado',
              color: '#EF4444',
            },
          ]}
        />

        <FinanceChart
          title="Distribuição por credor"
          variant="donut"
          data={debtBreakdownData}
          emptyMessage="Nenhuma dívida em aberto."
        />
      </div>
    </div>
  );
};
