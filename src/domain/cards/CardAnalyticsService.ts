import type { CreditCard, Transaction } from '../../types';
import { isCardBillPaymentTransaction } from '../accounts/BalanceCalculator';
import {
  filterTransactions,
  groupExpensesByCategory,
  type ExpenseCategoryItem,
  type FinanceFilters,
} from '../finance/FinanceConsolidationService';
import { cents, fromCents, getTransactionAmountCents, toCents } from '../money/money';
import { todayLocal } from '../../utils/dateUtils';

export interface CardLimitAnalysis {
  totalLimit: number;
  usedLimit: number;
  availableLimit: number;
  usagePercentage: number;
  isNearLimit: boolean;
}

export interface CardMonthlyPoint {
  ym: string;
  label: string;
  totalSpent: number;
  cashSpent: number;
  installmentSpent: number;
}

export interface CardAnalyticsResult {
  card: CreditCard;
  limitAnalysis: CardLimitAnalysis;
  currentBillAmount: number;
  nextBillEstimate: number;
  totalPurchasesFiltered: number;
  cashPurchasesTotal: number;
  installmentPurchasesTotal: number;
  installmentCount: number;
  purchasesCount: number;
  expensesByCategory: ExpenseCategoryItem[];
  monthlySeries: CardMonthlyPoint[];
  purchases: Transaction[];
  billPayments: Transaction[];
}

const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export function calculateCardLimit(totalLimit: number, usedLimit: number): CardLimitAnalysis {
  const safeTotal = Math.max(0, Number.isFinite(totalLimit) ? totalLimit : 0);
  const safeUsed = Math.max(0, Number.isFinite(usedLimit) ? usedLimit : 0);
  const available = Math.max(0, Number((safeTotal - safeUsed).toFixed(2)));
  const usagePercentage = safeTotal > 0 ? Number(((safeUsed / safeTotal) * 100).toFixed(1)) : 0;

  return {
    totalLimit: safeTotal,
    usedLimit: safeUsed,
    availableLimit: available,
    usagePercentage,
    isNearLimit: usagePercentage >= 80,
  };
}

function isInstallmentTx(tx: Transaction): boolean {
  return (
    (typeof tx.installmentTotal === 'number' && tx.installmentTotal > 1) ||
    /\(\d{1,2}\/\d{1,2}\)/.test(tx.description || '')
  );
}

export function calculateCardAnalytics(
  card: CreditCard,
  allTransactions: readonly Transaction[],
  filters: FinanceFilters = {}
): CardAnalyticsResult {
  const cardAllTx = allTransactions.filter(
    (t) =>
      t.status !== 'CANCELLED' &&
      (t.creditCardId === card.id || t.accountId === card.id)
  );

  // Separate consumption purchases vs invoice payments (avoid double counting!)
  const allPurchases = cardAllTx.filter(
    (t) => t.direction === 'EXPENSE' && !isCardBillPaymentTransaction(t) && !t.isInternalTransfer
  );
  const billPayments = cardAllTx
    .filter((t) => isCardBillPaymentTransaction(t))
    .sort((a, b) => b.date.localeCompare(a.date));

  const filteredPurchases = filterTransactions([...allPurchases], {
    ...filters,
    accountId: undefined,
    cardId: undefined,
  }).sort((a, b) => b.date.localeCompare(a.date));

  const currentMonth = todayLocal().slice(0, 7);
  const nextMonthDate = new Date();
  nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
  const nextMonth = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}`;

  let cashCents = 0;
  let installmentCents = 0;
  let installmentCount = 0;

  for (const tx of filteredPurchases) {
    const amt = getTransactionAmountCents(tx);
    if (isInstallmentTx(tx)) {
      installmentCents += amt;
      installmentCount += 1;
    } else {
      cashCents += amt;
    }
  }

  // Next month bill estimate from scheduled/pending/planned purchases dated in nextMonth
  let nextBillCents = 0;
  for (const tx of allPurchases) {
    if (tx.date.startsWith(nextMonth)) {
      nextBillCents += getTransactionAmountCents(tx);
    }
  }

  // Future committed balance includes current open invoice + future pending/planned installments
  const futureInstallmentsCents = allPurchases
    .filter((t) => t.date.slice(0, 7) > currentMonth && (t.status === 'PENDING' || t.status === 'PLANNED'))
    .reduce((sum, t) => sum + getTransactionAmountCents(t), 0);

  const currentBillCents = Math.max(0, toCents(card.currentInvoiceAmount));
  const usedLimitTotal = fromCents(cents(currentBillCents + futureInstallmentsCents));

  const limitAnalysis = calculateCardLimit(card.limit, usedLimitTotal);

  const byMonth = new Map<string, { cash: number; installment: number }>();
  for (const tx of allPurchases) {
    const ym = tx.date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    const curr = byMonth.get(ym) || { cash: 0, installment: 0 };
    const amt = getTransactionAmountCents(tx);
    if (isInstallmentTx(tx)) curr.installment += amt;
    else curr.cash += amt;
    byMonth.set(ym, curr);
  }

  const monthlySeries: CardMonthlyPoint[] = Array.from(byMonth.keys())
    .sort()
    .map((ym) => {
      const m = byMonth.get(ym)!;
      const mIdx = Number(ym.slice(5, 7)) - 1;
      return {
        ym,
        label: `${MONTH_SHORT[mIdx] || ym.slice(5, 7)}/${ym.slice(2, 4)}`,
        totalSpent: fromCents(cents(m.cash + m.installment)),
        cashSpent: fromCents(cents(m.cash)),
        installmentSpent: fromCents(cents(m.installment)),
      };
    });

  return {
    card,
    limitAnalysis,
    currentBillAmount: fromCents(cents(currentBillCents)),
    nextBillEstimate: fromCents(cents(nextBillCents)),
    totalPurchasesFiltered: fromCents(cents(cashCents + installmentCents)),
    cashPurchasesTotal: fromCents(cents(cashCents)),
    installmentPurchasesTotal: fromCents(cents(installmentCents)),
    installmentCount,
    purchasesCount: filteredPurchases.length,
    expensesByCategory: groupExpensesByCategory(filteredPurchases),
    monthlySeries,
    purchases: filteredPurchases,
    billPayments,
  };
}
