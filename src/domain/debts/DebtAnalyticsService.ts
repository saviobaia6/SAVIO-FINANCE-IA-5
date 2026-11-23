import type { Debt, EntityScope } from '../../types';
import { cents, fromCents, safeToCents, ZERO_CENTS } from '../money/money';
import { todayLocal } from '../../utils/dateUtils';

export interface DebtItemBreakdown {
  debt: Debt;
  paidAmount: number;
  paidPct: number;
  remainingInstallmentsEstimate: number;
  nextDueDate: string;
}

export interface DebtPayoffPoint {
  monthIndex: number;
  label: string;
  projectedOutstanding: number;
  monthlyInstallmentPaid: number;
}

export interface DebtAnalyticsResult {
  totalContracted: number;
  totalOutstanding: number;
  totalPaid: number;
  paidPercentage: number;
  monthlyCommitments: number;
  incomeCommitmentPct: number;
  activeCount: number;
  paidCount: number;
  estimatedMonthsToPayoff: number;
  items: DebtItemBreakdown[];
  payoffProjection: DebtPayoffPoint[];
}

const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export function calculateDebtAnalytics(
  debts: readonly Debt[],
  monthlyIncomeReference = 0,
  scope: EntityScope = 'CONSOLIDATED'
): DebtAnalyticsResult {
  const scoped = debts.filter((d) => (scope === 'CONSOLIDATED' ? true : d.entityId === scope));
  const today = todayLocal();
  const baseYm = today.slice(0, 7);

  let contractedCents = 0;
  let outstandingCents = 0;
  let monthlyCommitCents = 0;
  let activeCount = 0;
  let paidCount = 0;

  const items: DebtItemBreakdown[] = scoped.map((debt) => {
    const origCents = safeToCents(debt.originalAmount, ZERO_CENTS);
    const outCents = debt.status === 'PAID' ? 0 : safeToCents(debt.outstandingAmount, ZERO_CENTS);
    const paidCents = Math.max(0, origCents - outCents);

    contractedCents += origCents;
    outstandingCents += outCents;

    if (debt.status === 'PAID' || outCents === 0) {
      paidCount += 1;
    } else {
      activeCount += 1;
      if (debt.installmentAmount && debt.installmentAmount > 0) {
        monthlyCommitCents += safeToCents(debt.installmentAmount, ZERO_CENTS);
      }
    }

    const paidPct = origCents > 0 ? Number(((paidCents / origCents) * 100).toFixed(1)) : 100;

    let remainingInstallments = 0;
    if (outCents > 0) {
      if (
        typeof debt.totalInstallments === 'number' &&
        typeof debt.paidInstallments === 'number' &&
        debt.totalInstallments >= debt.paidInstallments
      ) {
        remainingInstallments = debt.totalInstallments - debt.paidInstallments;
      } else if (debt.installmentAmount && debt.installmentAmount > 0) {
        remainingInstallments = Math.ceil(fromCents(cents(outCents)) / debt.installmentAmount);
      }
    }

    const dueDayClamped = String(Math.min(28, Math.max(1, debt.dueDay || 10))).padStart(2, '0');
    const nextDueDate = debt.nextDueDate || `${baseYm}-${dueDayClamped}`;

    return {
      debt,
      paidAmount: fromCents(cents(paidCents)),
      paidPct,
      remainingInstallmentsEstimate: remainingInstallments,
      nextDueDate,
    };
  });

  const totalContracted = fromCents(cents(contractedCents));
  const totalOutstanding = fromCents(cents(outstandingCents));
  const totalPaid = Math.max(0, Number((totalContracted - totalOutstanding).toFixed(2)));
  const paidPercentage =
    totalContracted > 0 ? Number(((totalPaid / totalContracted) * 100).toFixed(1)) : 0;
  const monthlyCommitments = fromCents(cents(monthlyCommitCents));

  const incomeCommitmentPct =
    monthlyIncomeReference > 0
      ? Number(((monthlyCommitments / monthlyIncomeReference) * 100).toFixed(1))
      : 0;

  // Build 12-month payoff projection using installment amortization + optional monthly interest rate
  const maxMonths = 12;
  const payoffProjection: DebtPayoffPoint[] = [];
  const simBalances = scoped
    .filter((d) => d.status !== 'PAID' && d.outstandingAmount > 0)
    .map((d) => ({
      balance: d.outstandingAmount,
      installment: d.installmentAmount && d.installmentAmount > 0 ? d.installmentAmount : d.outstandingAmount / 12,
      monthlyRate: d.interestRate && d.interestRate > 0 ? d.interestRate / 100 : 0,
    }));

  const now = new Date();
  let remainingTotal = totalOutstanding;
  let estimatedMonthsToPayoff = 0;

  if (totalOutstanding > 0 && monthlyCommitments > 0) {
    estimatedMonthsToPayoff = Math.ceil(totalOutstanding / monthlyCommitments);
  }

  for (let i = 0; i < maxMonths; i++) {
    const dt = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const label = `${MONTH_SHORT[dt.getMonth()]}/${String(dt.getFullYear()).slice(2)}`;
    let monthPaid = 0;

    if (i > 0) {
      remainingTotal = 0;
      for (const s of simBalances) {
        if (s.balance <= 0) continue;
        const withInterest = s.balance * (1 + s.monthlyRate);
        const pay = Math.min(withInterest, s.installment);
        s.balance = Math.max(0, withInterest - pay);
        monthPaid += pay;
        remainingTotal += s.balance;
      }
    } else {
      monthPaid = Math.min(totalOutstanding, monthlyCommitments);
    }

    payoffProjection.push({
      monthIndex: i,
      label,
      projectedOutstanding: Number(remainingTotal.toFixed(2)),
      monthlyInstallmentPaid: Number(monthPaid.toFixed(2)),
    });
  }

  return {
    totalContracted,
    totalOutstanding,
    totalPaid,
    paidPercentage,
    monthlyCommitments,
    incomeCommitmentPct,
    activeCount,
    paidCount,
    estimatedMonthsToPayoff,
    items,
    payoffProjection,
  };
}
