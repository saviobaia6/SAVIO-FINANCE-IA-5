import type { Account, Transaction } from '../../types';
import {
  calculateFinancialBalances,
  getAccountOpeningCents,
  isCardBillPaymentTransaction,
} from './BalanceCalculator';
import {
  classifyIncomeOrigin,
  filterTransactions,
  type ExpenseCategoryItem,
  type FinanceFilters,
  type IncomeChartItem,
  groupExpensesByCategory,
  groupIncomesBySource,
} from '../finance/FinanceConsolidationService';
import { cents, fromCents, getTransactionAmountCents } from '../money/money';

export interface AccountMonthlyFlowPoint {
  ym: string;
  label: string;
  inflows: number;
  outflows: number;
  transfersIn: number;
  transfersOut: number;
  closingBalance: number;
  net: number;
}

export interface AccountAnalyticsResult {
  account: Account;
  initialBalance: number;
  currentBalance: number;
  projectedBalance: number;
  totalInflows: number;
  totalOutflows: number;
  transfersIn: number;
  transfersOut: number;
  cardBillPaymentsTotal: number;
  periodNet: number;
  transactionCount: number;
  monthlySeries: AccountMonthlyFlowPoint[];
  expensesByCategory: ExpenseCategoryItem[];
  incomesBySource: IncomeChartItem[];
  transactions: Transaction[];
}

const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export function calculateAccountAnalytics(
  account: Account,
  allTransactions: readonly Transaction[],
  filters: FinanceFilters = {}
): AccountAnalyticsResult {
  const openingCents = getAccountOpeningCents(account);
  const allAccountTx = allTransactions.filter(
    (t) => t.accountId === account.id && t.status !== 'CANCELLED'
  );
  const balances = calculateFinancialBalances(openingCents, allAccountTx);

  const filteredAccountTx = filterTransactions([...allAccountTx], {
    ...filters,
    accountId: account.id,
  }).sort((a, b) => b.date.localeCompare(a.date));

  let inflowsCents = 0;
  let outflowsCents = 0;
  let transfersInCents = 0;
  let transfersOutCents = 0;
  let cardBillsCents = 0;

  const incomeEntriesForGrouping = [];

  for (const tx of filteredAccountTx) {
    const amt = getTransactionAmountCents(tx);
    if (tx.status !== 'CONFIRMED') continue;

    if (tx.isInternalTransfer || tx.operationType === 'TRANSFERENCIA_PROPRIA') {
      if (tx.direction === 'INCOME') transfersInCents += amt;
      else transfersOutCents += amt;
      continue;
    }

    if (isCardBillPaymentTransaction(tx)) {
      cardBillsCents += amt;
      outflowsCents += amt;
      continue;
    }

    if (tx.direction === 'INCOME') {
      inflowsCents += amt;
      const origin = classifyIncomeOrigin({
        description: tx.description,
        category: tx.category,
        counterparty: tx.counterparty,
        account: tx.account,
        entityId: tx.entityId,
        incomeOrigin: tx.incomeOrigin,
        incomeSourceName: tx.incomeSourceName,
      });
      incomeEntriesForGrouping.push({
        id: tx.id,
        date: tx.date,
        description: tx.description,
        originKey: origin.originKey,
        sourceName: origin.sourceName,
        category: tx.category,
        accountId: tx.accountId,
        institution: account.institutionName,
        amount: fromCents(amt),
        amountCents: amt,
        status: 'received' as const,
        originType: 'transaction' as const,
        entityId: tx.entityId,
      });
    } else {
      outflowsCents += amt;
    }
  }

  // Monthly balance evolution and inflows vs outflows across confirmed history
  const byMonth = new Map<
    string,
    { inflows: number; outflows: number; transfersIn: number; transfersOut: number; signedNet: number }
  >();

  for (const tx of allAccountTx) {
    if (tx.status !== 'CONFIRMED') continue;
    const ym = tx.date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    const curr = byMonth.get(ym) || {
      inflows: 0,
      outflows: 0,
      transfersIn: 0,
      transfersOut: 0,
      signedNet: 0,
    };
    const amt = getTransactionAmountCents(tx);
    curr.signedNet += tx.direction === 'INCOME' ? amt : -amt;
    if (tx.isInternalTransfer || tx.operationType === 'TRANSFERENCIA_PROPRIA') {
      if (tx.direction === 'INCOME') curr.transfersIn += amt;
      else curr.transfersOut += amt;
    } else if (tx.direction === 'INCOME') {
      curr.inflows += amt;
    } else {
      curr.outflows += amt;
    }
    byMonth.set(ym, curr);
  }

  const sortedMonths = Array.from(byMonth.keys()).sort();
  let runningCents = openingCents as number;
  const fullSeries: AccountMonthlyFlowPoint[] = sortedMonths.map((ym) => {
    const m = byMonth.get(ym)!;
    runningCents += m.signedNet;
    const mIdx = Number(ym.slice(5, 7)) - 1;
    return {
      ym,
      label: `${MONTH_SHORT[mIdx] || ym.slice(5, 7)}/${ym.slice(2, 4)}`,
      inflows: fromCents(cents(m.inflows)),
      outflows: fromCents(cents(m.outflows)),
      transfersIn: fromCents(cents(m.transfersIn)),
      transfersOut: fromCents(cents(m.transfersOut)),
      closingBalance: fromCents(cents(runningCents)),
      net: fromCents(cents(m.inflows - m.outflows)),
    };
  });

  const filteredSeries = fullSeries.filter((p) => {
    if (filters.startDate && p.ym < filters.startDate.slice(0, 7)) return false;
    if (filters.endDate && p.ym > filters.endDate.slice(0, 7)) return false;
    return true;
  });

  return {
    account,
    initialBalance: fromCents(openingCents),
    currentBalance: fromCents(balances.realizedBalanceCents),
    projectedBalance: fromCents(balances.projectedBalanceCents),
    totalInflows: fromCents(cents(inflowsCents)),
    totalOutflows: fromCents(cents(outflowsCents)),
    transfersIn: fromCents(cents(transfersInCents)),
    transfersOut: fromCents(cents(transfersOutCents)),
    cardBillPaymentsTotal: fromCents(cents(cardBillsCents)),
    periodNet: fromCents(cents(inflowsCents - outflowsCents)),
    transactionCount: filteredAccountTx.length,
    monthlySeries: filteredSeries,
    expensesByCategory: groupExpensesByCategory(filteredAccountTx),
    incomesBySource: groupIncomesBySource(incomeEntriesForGrouping),
    transactions: filteredAccountTx,
  };
}
