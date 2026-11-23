import React, { useMemo, useState } from 'react';
import { ArrowLeft, CreditCard as CreditCardIcon, Layers, ReceiptText, Wallet } from 'lucide-react';
import type { CreditCard, Transaction } from '../../types';
import { APP_CATEGORIES } from '../../types';
import { calculateCardAnalytics } from '../../domain/cards/CardAnalyticsService';
import type { FinanceFilters } from '../../domain/finance/FinanceConsolidationService';
import { InstitutionAvatar } from '../InstitutionAvatar';
import { FinanceSummaryCard } from './FinanceSummaryCard';
import { FinanceChart } from './FinanceChart';
import { PeriodFilter } from './PeriodFilter';
import { TransactionList } from './TransactionList';
import { usePrivacy } from '../../contexts/PrivacyContext';
import { formatarValor } from '../../utils/formatters';

interface CreditCardAnalyticsProps {
  card: CreditCard;
  transactions: readonly Transaction[];
  onBack: () => void;
  onPayInvoice: (card: CreditCard) => void;
  onEditTransaction?: (tx: Transaction) => void;
  onRegisterPurchase?: (card: CreditCard) => void;
}

export const CreditCardAnalytics: React.FC<CreditCardAnalyticsProps> = ({
  card,
  transactions,
  onBack,
  onPayInvoice,
  onEditTransaction,
  onRegisterPurchase,
}) => {
  const { hideValues } = usePrivacy();
  const [filters, setFilters] = useState<FinanceFilters>({});

  const analytics = useMemo(
    () => calculateCardAnalytics(card, transactions, filters),
    [card, transactions, filters]
  );

  const availableCategories = useMemo(() => {
    const set = new Set<string>(APP_CATEGORIES);
    for (const tx of transactions) {
      if ((tx.creditCardId === card.id || tx.accountId === card.id) && tx.category) {
        set.add(tx.category);
      }
    }
    return Array.from(set);
  }, [transactions, card.id]);

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
          <InstitutionAvatar name={card.institutionName} size="lg" />
          <div className="min-w-0">
            <h2 className="font-display text-lg sm:text-xl font-bold text-[#0F172A] dark:text-white truncate">
              {card.cardName} · Final {card.last4}
            </h2>
            <p className="text-xs text-[#64748B] dark:text-slate-300">
              {card.institutionName} · {card.entityId} · Fecha dia {card.closingDay} · Vence dia {card.dueDay}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onRegisterPurchase && (
            <button
              type="button"
              onClick={() => onRegisterPurchase(card)}
              className="min-h-10 px-3.5 rounded-xl border border-[#E2E8F0] dark:border-white/15 bg-white dark:bg-[#11185A] text-xs font-semibold text-[#0F172A] dark:text-white cursor-pointer"
            >
              Nova compra
            </button>
          )}
          {card.currentInvoiceAmount > 0 && (
            <button
              type="button"
              onClick={() => onPayInvoice(card)}
              className="min-h-10 px-4 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
            >
              Pagar fatura
            </button>
          )}
        </div>
      </div>

      {/* Limit Usage Gauge */}
      <div className="sf-card p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="text-xs font-medium text-[#64748B] dark:text-slate-300">
              Utilização do limite total ({formatarValor(analytics.limitAnalysis.totalLimit, hideValues)})
            </span>
            <div className="font-money text-xl font-extrabold text-[#0F172A] dark:text-white mt-0.5">
              {analytics.limitAnalysis.usagePercentage.toFixed(1)}% utilizado
            </div>
          </div>
          <div className="text-right text-xs">
            <span className="text-[#64748B] dark:text-slate-300 block">Limite disponível</span>
            <strong className="font-money text-base font-bold text-[#059669] dark:text-[#10B981]">
              {formatarValor(analytics.limitAnalysis.availableLimit, hideValues)}
            </strong>
          </div>
        </div>
        <div className="w-full h-2.5 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              analytics.limitAnalysis.isNearLimit ? 'bg-[#EF4444]' : 'bg-[#059669]'
            }`}
            style={{ width: `${Math.min(100, analytics.limitAnalysis.usagePercentage)}%` }}
          />
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <FinanceSummaryCard
          title="Fatura atual"
          value={analytics.currentBillAmount}
          subtitle={`Vencimento dia ${card.dueDay}`}
          tone={analytics.currentBillAmount > 0 ? 'expense' : 'income'}
          icon={<ReceiptText size={18} strokeWidth={1.75} />}
        />
        <FinanceSummaryCard
          title="Previsão próxima fatura"
          value={analytics.nextBillEstimate}
          subtitle="Parcelas e lançamentos futuros"
          tone="amber"
          icon={<CreditCardIcon size={18} strokeWidth={1.75} />}
        />
        <FinanceSummaryCard
          title="Compras à vista"
          value={analytics.cashPurchasesTotal}
          subtitle="No período filtrado"
          tone="navy"
          icon={<Wallet size={18} strokeWidth={1.75} />}
        />
        <FinanceSummaryCard
          title="Compras parceladas"
          value={analytics.installmentPurchasesTotal}
          subtitle={`${analytics.installmentCount} parcela(s)`}
          tone="neutral"
          icon={<Layers size={18} strokeWidth={1.75} />}
        />
      </div>

      <PeriodFilter
        filters={filters}
        onChange={setFilters}
        categories={availableCategories}
        showAccountFilter={false}
        showCardFilter={false}
        showSourceFilter={false}
        showTypeFilter={false}
        showInstallmentToggle={true}
        compact
      />

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <FinanceChart
          title="Evolução mensal dos gastos no cartão"
          subtitle="À vista vs compras parceladas"
          variant="bar"
          data={analytics.monthlySeries as unknown as Array<Record<string, unknown>>}
          xKey="label"
          series={[
            { dataKey: 'cashSpent', name: 'À vista', color: '#061E3E', stackId: 'card' },
            { dataKey: 'installmentSpent', name: 'Parcelado', color: '#0EA5E9', stackId: 'card' },
          ]}
        />

        <FinanceChart
          title="Gastos por categoria no cartão"
          variant="donut"
          data={analytics.expensesByCategory.map((c) => ({
            name: c.category,
            value: c.totalAmount,
            percentage: c.percentage,
          }))}
          emptyMessage="Nenhuma compra vinculada diretamente a este cartão no filtro."
        />
      </div>

      {/* Purchase History */}
      <TransactionList
        transactions={analytics.purchases}
        title={`Compras no cartão ${card.cardName}`}
        emptyMessage="Nenhuma compra registrada diretamente neste cartão. Use 'Nova compra' ou importe uma fatura."
        onEditTransaction={onEditTransaction}
      />
    </div>
  );
};
