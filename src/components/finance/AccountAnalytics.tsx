import React, { useMemo, useState } from 'react';
import { ArrowLeft, ArrowLeftRight, ArrowUpRight, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import type { Account, Transaction } from '../../types';
import { APP_CATEGORIES } from '../../types';
import { calculateAccountAnalytics } from '../../domain/accounts/AccountAnalyticsService';
import type { FinanceFilters } from '../../domain/finance/FinanceConsolidationService';
import { InstitutionAvatar } from '../InstitutionAvatar';
import { FinanceSummaryCard } from './FinanceSummaryCard';
import { FinanceChart } from './FinanceChart';
import { MonthlyComparison } from './MonthlyComparison';
import { PeriodFilter } from './PeriodFilter';
import { TransactionList } from './TransactionList';
import { usePrivacy } from '../../contexts/PrivacyContext';
import { formatarValor } from '../../utils/formatters';

interface AccountAnalyticsProps {
  account: Account;
  transactions: readonly Transaction[];
  onBack: () => void;
  onEditTransaction?: (tx: Transaction) => void;
  onInspectInLedger?: (account: Account) => void;
}

const ACCOUNT_TYPE_LABELS: Record<Account['accountType'], string> = {
  checking: 'Conta Corrente',
  savings: 'Poupança',
  business: 'Empresarial PJ',
  investment: 'Investimento',
};

export const AccountAnalytics: React.FC<AccountAnalyticsProps> = ({
  account,
  transactions,
  onBack,
  onEditTransaction,
  onInspectInLedger,
}) => {
  const { hideValues } = usePrivacy();
  const [filters, setFilters] = useState<FinanceFilters>({});

  const analytics = useMemo(
    () => calculateAccountAnalytics(account, transactions, filters),
    [account, transactions, filters]
  );

  const availableCategories = useMemo(() => {
    const set = new Set<string>(APP_CATEGORIES);
    for (const tx of transactions) {
      if (tx.accountId === account.id && tx.category) set.add(tx.category);
    }
    return Array.from(set);
  }, [transactions, account.id]);

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="min-h-10 px-3 rounded-xl border border-[#E2E8F0] dark:border-white/15 bg-white dark:bg-[#11185A] text-xs font-semibold text-[#0F172A] dark:text-white flex items-center gap-1.5 hover:border-[#CBD5E1] cursor-pointer shrink-0"
          >
            <ArrowLeft size={15} /> Voltar
          </button>
          <InstitutionAvatar name={account.institutionName} size="lg" />
          <div className="min-w-0">
            <h2 className="font-display text-lg sm:text-xl font-bold text-[#0F172A] dark:text-white truncate">
              {account.institutionName} · {account.accountName}
            </h2>
            <p className="text-xs text-[#64748B] dark:text-slate-300">
              {ACCOUNT_TYPE_LABELS[account.accountType]} · {account.entityId} · Saldo inicial{' '}
              <span className="font-money font-semibold">
                {formatarValor(analytics.initialBalance, hideValues)}
              </span>
            </p>
          </div>
        </div>

        {onInspectInLedger && (
          <button
            type="button"
            onClick={() => onInspectInLedger(account)}
            className="min-h-10 px-3.5 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            Extrato completo <ArrowUpRight size={14} />
          </button>
        )}
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <FinanceSummaryCard
          title="Saldo atual"
          value={analytics.currentBalance}
          subtitle={`Projetado: ${formatarValor(analytics.projectedBalance, hideValues)}`}
          tone="navy"
          icon={<Wallet size={18} strokeWidth={1.75} />}
        />
        <FinanceSummaryCard
          title="Entradas na conta"
          value={analytics.totalInflows}
          subtitle={
            analytics.transfersIn > 0
              ? `Transf. recebidas: ${formatarValor(analytics.transfersIn, hideValues)}`
              : 'Receitas operacionais'
          }
          tone="income"
          icon={<TrendingUp size={18} strokeWidth={1.75} />}
        />
        <FinanceSummaryCard
          title="Saídas da conta"
          value={analytics.totalOutflows}
          subtitle={
            analytics.cardBillPaymentsTotal > 0
              ? `Inclui ${formatarValor(analytics.cardBillPaymentsTotal, hideValues)} em faturas`
              : 'Despesas operacionais'
          }
          tone="expense"
          icon={<TrendingDown size={18} strokeWidth={1.75} />}
        />
        <FinanceSummaryCard
          title="Transferências internas"
          value={analytics.transfersIn - analytics.transfersOut}
          subtitle={`Ent: ${formatarValor(analytics.transfersIn, hideValues)} · Saí: ${formatarValor(analytics.transfersOut, hideValues)}`}
          tone="neutral"
          icon={<ArrowLeftRight size={18} strokeWidth={1.75} />}
        />
      </div>

      {/* Period & Attribute Filter */}
      <PeriodFilter
        filters={filters}
        onChange={setFilters}
        categories={availableCategories}
        showAccountFilter={false}
        showCardFilter={false}
        showSourceFilter={true}
        showTypeFilter={true}
        compact
      />

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <FinanceChart
          title="Evolução do saldo da conta"
          subtitle="Saldo acumulado ao final de cada competência"
          variant="area"
          data={analytics.monthlySeries as unknown as Array<Record<string, unknown>>}
          xKey="label"
          series={[{ dataKey: 'closingBalance', name: 'Saldo acumulado', color: '#059669' }]}
        />

        <MonthlyComparison
          title="Entradas vs Saídas da conta"
          subtitle="Sem contar transferências internas como receita ou despesa"
          data={analytics.monthlySeries.map((m) => ({
            label: m.label,
            income: m.inflows,
            expense: m.outflows,
            net: m.net,
          }))}
        />

        <FinanceChart
          title="Despesas por categoria nesta conta"
          variant="donut"
          data={analytics.expensesByCategory.map((e) => ({
            name: e.category,
            value: e.totalAmount,
            percentage: e.percentage,
          }))}
          emptyMessage="Nenhuma despesa operacional nesta conta no filtro selecionado."
        />

        <FinanceChart
          title="Receitas por origem nesta conta"
          variant="donut"
          data={analytics.incomesBySource.map((i) => ({
            name: i.sourceName,
            value: i.totalAmount,
            percentage: i.percentage,
            color: i.color,
          }))}
          emptyMessage="Nenhuma receita operacional nesta conta no filtro selecionado."
        />
      </div>

      {/* Account Filtered Transactions */}
      <TransactionList
        transactions={analytics.transactions}
        accounts={[account]}
        title={`Movimentações de ${account.institutionName}`}
        onEditTransaction={onEditTransaction}
      />
    </div>
  );
};
