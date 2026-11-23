import type {
  Account,
  Asset,
  Boleto,
  CreditCard,
  Debt,
  EntityScope,
  IncomeOriginKey,
  Transaction,
  TransactionStatus,
} from '../../types';
import type { SalaryCategory, SalaryDataset, SalarySource } from '../../types/salary';
import {
  deriveAccountBalances,
  isCardBillPaymentTransaction,
} from '../accounts/BalanceCalculator';
import {
  addMoney,
  cents,
  fromCents,
  getTransactionAmountCents,
  safeToCents,
  subtractMoney,
  toCents,
  ZERO_CENTS,
} from '../money/money';
import type { MoneyCents } from '../money/money';
import { todayLocal } from '../../utils/dateUtils';
import { normalizeDescription } from '../../utils/financeCalculations';

export interface FinanceFilters {
  startDate?: string;
  endDate?: string;
  accountId?: string;
  cardId?: string;
  category?: string;
  source?: string;
  type?: 'income' | 'expense' | 'all';
  scope?: EntityScope;
  status?: TransactionStatus | 'all';
  search?: string;
  installmentOnly?: boolean;
}

export interface IncomeSource {
  id: string;
  name: string;
  originKey: IncomeOriginKey;
  type: 'salary' | 'commission' | 'mei' | 'investment' | 'extra' | 'other';
  category: string;
  accountId?: string;
  institution?: string;
  frequency: 'monthly' | 'weekly' | 'biweekly' | 'occasional';
  expectedAmount?: number;
  expectedDay?: number;
  isRecurring: boolean;
  isActive: boolean;
}

export interface UnifiedIncomeEntry {
  id: string;
  date: string;
  description: string;
  originKey: IncomeOriginKey;
  sourceName: string;
  sourceId?: string;
  category: string;
  accountId?: string;
  institution?: string;
  amount: number;
  amountCents: MoneyCents;
  status: 'received' | 'expected' | 'overdue' | 'cancelled';
  originType: 'transaction' | 'salary_record';
  entityId: 'CPF' | 'CNPJ';
  linkedTransactionId?: string;
}

export interface IncomeChartItem {
  originKey: IncomeOriginKey;
  sourceName: string;
  receivedAmount: number;
  expectedAmount: number;
  totalAmount: number;
  receivedCents: MoneyCents;
  expectedCents: MoneyCents;
  totalCents: MoneyCents;
  percentage: number;
  count: number;
  color: string;
}

export interface ExpenseCategoryItem {
  category: string;
  realizedAmount: number;
  expectedAmount: number;
  totalAmount: number;
  realizedCents: MoneyCents;
  expectedCents: MoneyCents;
  percentage: number;
  count: number;
}

export interface MonthlyFlowPoint {
  ym: string;
  label: string;
  income: number;
  expense: number;
  net: number;
  accumulatedBalance: number;
}

export interface FinanceSummary {
  consolidatedBalance: number;
  projectedBalance: number;
  estimatedFreeBalance: number;
  totalIncome: number;
  expectedIncome: number;
  totalExpenses: number;
  expectedExpenses: number;
  openInvoices: number;
  totalPendingBoletos: number;
  totalDebt: number;
  monthlyDebtCommitment: number;
  monthlyCommitments: number;
  assetsTotal: number;
  netWorth: number;
  savingsRatePct: number;
}

export interface UpcomingDueItem {
  id: string;
  kind: 'BOLETO' | 'CARD' | 'DEBT' | 'TRANSACTION';
  title: string;
  subtitle: string;
  date: string;
  amount: number;
  entityId: 'CPF' | 'CNPJ';
  targetTab: string;
}

export interface ConsolidationResult {
  summary: FinanceSummary;
  scopedAccounts: Account[];
  scopedCards: CreditCard[];
  scopedDebts: Debt[];
  scopedBoletos: Boleto[];
  filteredTransactions: Transaction[];
  unifiedIncomes: UnifiedIncomeEntry[];
  incomeBySource: IncomeChartItem[];
  expensesByCategory: ExpenseCategoryItem[];
  monthlyFlow: MonthlyFlowPoint[];
  upcomingDues: UpcomingDueItem[];
}

export const INCOME_ORIGIN_META: Record<
  IncomeOriginKey,
  { label: string; color: string; shortLabel: string }
> = {
  salary: { label: 'Salário', color: '#059669', shortLabel: 'Salário' },
  boticario: { label: 'Boticário', color: '#0EA5E9', shortLabel: 'Boticário' },
  mei: { label: 'MEI / Serviços', color: '#2563EB', shortLabel: 'MEI' },
  recargapay: { label: 'RecargaPay', color: '#7C3AED', shortLabel: 'RecargaPay' },
  nubank: { label: 'Nubank', color: '#8B5CF6', shortLabel: 'Nubank' },
  investment: { label: 'Rendimentos / Investimentos', color: '#10B981', shortLabel: 'Investimentos' },
  extra: { label: 'Extras', color: '#F59E0B', shortLabel: 'Extras' },
  other: { label: 'Outras fontes', color: '#64748B', shortLabel: 'Outras' },
};

const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

type FilterableTx = Partial<Transaction> & {
  cardId?: string;
  source?: string;
  type?: 'income' | 'expense';
};

export function filterTransactions<T extends FilterableTx>(
  transactions: T[],
  filters: FinanceFilters
): T[] {
  const searchNorm = filters.search ? normalizeDescription(filters.search) : '';

  return transactions.filter((transaction) => {
    if (filters.scope && filters.scope !== 'CONSOLIDATED' && transaction.entityId !== filters.scope) {
      return false;
    }

    if (filters.status && filters.status !== 'all') {
      if (transaction.status !== filters.status) return false;
    } else if (transaction.status === 'CANCELLED') {
      return false;
    }

    if (filters.accountId && transaction.accountId !== filters.accountId) {
      return false;
    }

    const effectiveCardId = transaction.cardId ?? transaction.creditCardId;
    if (filters.cardId && effectiveCardId !== filters.cardId) {
      return false;
    }

    if (filters.category && transaction.category !== filters.category) {
      return false;
    }

    const effectiveSource =
      transaction.source ??
      transaction.incomeOrigin ??
      transaction.incomeSourceName ??
      (transaction.direction === 'INCOME'
        ? classifyIncomeOrigin({
            description: transaction.description || '',
            category: transaction.category || '',
            counterparty: transaction.counterparty,
            account: transaction.account,
            entityId: transaction.entityId,
            incomeOrigin: transaction.incomeOrigin,
          }).originKey
        : undefined);

    if (filters.source && effectiveSource !== filters.source) {
      return false;
    }

    const effectiveType =
      transaction.type ??
      (transaction.direction === 'INCOME'
        ? 'income'
        : transaction.direction === 'EXPENSE'
          ? 'expense'
          : undefined);

    if (filters.type && filters.type !== 'all' && effectiveType !== filters.type) {
      return false;
    }

    if (filters.installmentOnly) {
      const hasInstallment =
        (typeof transaction.installmentTotal === 'number' && transaction.installmentTotal > 1) ||
        /\(\d{1,2}\/\d{1,2}\)/.test(transaction.description || '');
      if (!hasInstallment) return false;
    }

    if (searchNorm) {
      const hay = normalizeDescription(
        `${transaction.description || ''} ${transaction.category || ''} ${transaction.counterparty || ''} ${transaction.account || ''}`
      );
      if (!hay.includes(searchNorm)) return false;
    }

    const transactionDate = transaction.date?.slice(0, 10) || '';

    if (filters.startDate && transactionDate < filters.startDate) {
      return false;
    }

    if (filters.endDate && transactionDate > filters.endDate) {
      return false;
    }

    return true;
  });
}

export function getPeriodDateRange(period: string): { startDate?: string; endDate?: string } {
  if (!period || period === 'ALL') return {};
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [y, m] = period.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return {
      startDate: `${period}-01`,
      endDate: `${period}-${String(lastDay).padStart(2, '0')}`,
    };
  }
  if (/^\d{4}$/.test(period)) {
    return {
      startDate: `${period}-01-01`,
      endDate: `${period}-12-31`,
    };
  }
  return {};
}

export function classifyIncomeOrigin(params: {
  description?: string;
  category?: string;
  counterparty?: string;
  account?: string;
  entityId?: 'CPF' | 'CNPJ';
  incomeOrigin?: IncomeOriginKey;
  incomeSourceName?: string;
  salaryCategory?: SalaryCategory;
}): { originKey: IncomeOriginKey; sourceName: string } {
  if (params.incomeOrigin && INCOME_ORIGIN_META[params.incomeOrigin]) {
    return {
      originKey: params.incomeOrigin,
      sourceName: params.incomeSourceName || INCOME_ORIGIN_META[params.incomeOrigin].label,
    };
  }

  const text = normalizeDescription(
    `${params.description || ''} ${params.counterparty || ''} ${params.category || ''} ${params.account || ''}`
  );

  if (/\bboticario\b|\bo boticario\b|\brevenda\b|\bconsultor[a]?\b/.test(text)) {
    return { originKey: 'boticario', sourceName: params.incomeSourceName || 'Boticário' };
  }

  if (/\brecargapay\b|\brecarga pay\b/.test(text)) {
    return { originKey: 'recargapay', sourceName: params.incomeSourceName || 'RecargaPay' };
  }

  if (/\bnubank\b|\bnu pagamentos\b|\bcaixinha\b/.test(text) && /rend|cashback|bonus|juros|cdb|rdb|credito/.test(text)) {
    return { originKey: 'nubank', sourceName: params.incomeSourceName || 'Nubank' };
  }

  if (
    params.salaryCategory === 'salary' ||
    params.salaryCategory === 'teaching' ||
    params.salaryCategory === 'benefit' ||
    params.category === 'Salário' ||
    /\bsalario\b|\bfolha\b|\bremuneracao\b|\bpro-?labore\b|\badiantamento salarial\b/.test(text)
  ) {
    return { originKey: 'salary', sourceName: params.incomeSourceName || 'Salário' };
  }

  if (
    params.category === 'Serviço MEI' ||
    params.entityId === 'CNPJ' ||
    /\bmei\b|\bnfse\b|\bnota fiscal\b|\bservico\b|\bcliente\b|\bfaturamento\b/.test(text)
  ) {
    return { originKey: 'mei', sourceName: params.incomeSourceName || 'MEI / Serviços' };
  }

  if (
    params.category === 'Investimento' ||
    /\brendimento\b|\bprovento\b|\bdividendo\b|\bjcp\b|\bcdb\b|\brdb\b|\btesouro\b|\bfii\b|\binvest/.test(text)
  ) {
    if (/\bnubank\b/.test(text)) {
      return { originKey: 'nubank', sourceName: params.incomeSourceName || 'Nubank' };
    }
    if (/\brecargapay\b/.test(text)) {
      return { originKey: 'recargapay', sourceName: params.incomeSourceName || 'RecargaPay' };
    }
    return {
      originKey: 'investment',
      sourceName: params.incomeSourceName || 'Rendimentos / Investimentos',
    };
  }

  if (
    params.salaryCategory === 'thirteenth' ||
    params.salaryCategory === 'vacation' ||
    params.salaryCategory === 'occasional' ||
    params.salaryCategory === 'credit' ||
    /\bextra\b|\bfreelance\b|\b13[oº]?\b|\bferias\b|\bbonificacao\b|\bcomissao\b|\bcashback\b/.test(text)
  ) {
    return { originKey: 'extra', sourceName: params.incomeSourceName || 'Extras' };
  }

  if (/\bnubank\b/.test(text)) {
    return { originKey: 'nubank', sourceName: params.incomeSourceName || 'Nubank' };
  }

  return { originKey: 'other', sourceName: params.incomeSourceName || 'Outras fontes' };
}

function mapSalaryStatusToIncomeStatus(
  status: SalaryDataset['records'][number]['status'],
  date: string,
  today: string
): UnifiedIncomeEntry['status'] {
  if (status === 'received') return 'received';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'expected' || status === 'partially_received' || status === 'unknown') {
    return date < today ? 'overdue' : 'expected';
  }
  return 'expected';
}

export function buildUnifiedIncomes(params: {
  transactions: readonly Transaction[];
  salaryData?: SalaryDataset;
  filters?: FinanceFilters;
  accounts?: readonly Account[];
}): UnifiedIncomeEntry[] {
  const { transactions, salaryData, filters = {}, accounts = [] } = params;
  const today = todayLocal();
  const entries: UnifiedIncomeEntry[] = [];
  const linkedSalaryIds = new Set<string>();
  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  for (const tx of transactions) {
    if (tx.salaryRecordId && tx.status !== 'CANCELLED') {
      linkedSalaryIds.add(tx.salaryRecordId);
    }
    if (tx.direction !== 'INCOME' || tx.isInternalTransfer || tx.status === 'CANCELLED') {
      continue;
    }

    const origin = classifyIncomeOrigin({
      description: tx.description,
      category: tx.category,
      counterparty: tx.counterparty,
      account: tx.account,
      entityId: tx.entityId,
      incomeOrigin: tx.incomeOrigin,
      incomeSourceName: tx.incomeSourceName,
    });

    const txAccount = accountMap.get(tx.accountId);
    const amtCents = getTransactionAmountCents(tx);
    let mappedStatus: UnifiedIncomeEntry['status'] = 'received';
    if (tx.status === 'PENDING' || tx.status === 'PLANNED') {
      mappedStatus = tx.date < today ? 'overdue' : 'expected';
    }

    entries.push({
      id: `tx:${tx.id}`,
      date: tx.date,
      description: tx.description,
      originKey: origin.originKey,
      sourceName: origin.sourceName,
      sourceId: tx.incomeSourceId,
      category: tx.category,
      accountId: tx.accountId,
      institution: txAccount?.institutionName || tx.account,
      amount: fromCents(amtCents),
      amountCents: amtCents,
      status: mappedStatus,
      originType: 'transaction',
      entityId: tx.entityId,
      linkedTransactionId: tx.id,
    });
  }

  // Add unlinked SalaryDataset entries (when scope allows CPF/CONSOLIDATED and no account/card filter restricts to a bank account)
  if (
    salaryData &&
    (!filters.scope || filters.scope === 'CONSOLIDATED' || filters.scope === 'CPF') &&
    !filters.accountId &&
    !filters.cardId
  ) {
    const sourceMap = new Map<string, SalarySource>(salaryData.sources.map((s) => [s.id, s]));

    for (const rec of salaryData.records) {
      if (rec.linkedTransactionId || linkedSalaryIds.has(rec.id)) continue;
      if (rec.status === 'cancelled') continue;

      const amtCents =
        typeof rec.amountCents === 'number' && Number.isSafeInteger(rec.amountCents)
          ? cents(rec.amountCents)
          : typeof rec.amount === 'number' && Number.isFinite(rec.amount)
            ? toCents(rec.amount)
            : ZERO_CENTS;
      if (amtCents <= 0) continue;

      const src = sourceMap.get(rec.sourceId);
      if (src?.category === 'loan') continue;

      const entryDate =
        rec.paymentDate ||
        rec.expectedDate ||
        `${rec.year}-${String(rec.month).padStart(2, '0')}-05`;

      const origin = classifyIncomeOrigin({
        description: rec.description || src?.name || 'Salário',
        category: src?.category === 'occasional' ? 'Extras' : 'Salário',
        counterparty: src?.institution || src?.name,
        entityId: 'CPF',
        incomeSourceName: src?.name,
        salaryCategory: src?.category,
      });

      entries.push({
        id: `sal:${rec.id}`,
        date: entryDate,
        description: rec.description || `${src?.name || 'Renda'} (${String(rec.month).padStart(2, '0')}/${rec.year})`,
        originKey: origin.originKey,
        sourceName: src?.name || origin.sourceName,
        sourceId: rec.sourceId,
        category: origin.originKey === 'extra' ? 'Extras' : 'Salário',
        institution: src?.institution || src?.name,
        amount: fromCents(amtCents),
        amountCents: amtCents,
        status: mapSalaryStatusToIncomeStatus(rec.status, entryDate, today),
        originType: 'salary_record',
        entityId: 'CPF',
      });
    }
  }

  return entries
    .filter((entry) => {
      if (filters.scope && filters.scope !== 'CONSOLIDATED' && entry.entityId !== filters.scope) {
        return false;
      }
      if (filters.type === 'expense') return false;
      if (filters.accountId && entry.accountId !== filters.accountId) return false;
      if (filters.source && entry.originKey !== filters.source && entry.sourceId !== filters.source) {
        return false;
      }
      if (filters.category && entry.category !== filters.category) return false;
      if (filters.startDate && entry.date < filters.startDate) return false;
      if (filters.endDate && entry.date > filters.endDate) return false;
      if (filters.search) {
        const s = normalizeDescription(filters.search);
        const h = normalizeDescription(`${entry.description} ${entry.sourceName} ${entry.institution || ''}`);
        if (!h.includes(s)) return false;
      }
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function groupIncomesBySource(entries: readonly UnifiedIncomeEntry[]): IncomeChartItem[] {
  const map = new Map<
    IncomeOriginKey,
    { receivedCents: number; expectedCents: number; count: number }
  >();

  let grandTotalCents = 0;

  for (const entry of entries) {
    if (entry.status === 'cancelled') continue;
    const curr = map.get(entry.originKey) || { receivedCents: 0, expectedCents: 0, count: 0 };
    if (entry.status === 'received') {
      curr.receivedCents += entry.amountCents;
    } else {
      curr.expectedCents += entry.amountCents;
    }
    curr.count += 1;
    grandTotalCents += entry.amountCents;
    map.set(entry.originKey, curr);
  }

  return Array.from(map.entries())
    .map(([originKey, vals]) => {
      const totalCentsVal = vals.receivedCents + vals.expectedCents;
      const meta = INCOME_ORIGIN_META[originKey];
      return {
        originKey,
        sourceName: meta.label,
        receivedAmount: fromCents(cents(vals.receivedCents)),
        expectedAmount: fromCents(cents(vals.expectedCents)),
        totalAmount: fromCents(cents(totalCentsVal)),
        receivedCents: cents(vals.receivedCents),
        expectedCents: cents(vals.expectedCents),
        totalCents: cents(totalCentsVal),
        percentage: grandTotalCents > 0 ? Number(((totalCentsVal / grandTotalCents) * 100).toFixed(1)) : 0,
        count: vals.count,
        color: meta.color,
      };
    })
    .sort((a, b) => b.totalCents - a.totalCents);
}

export function groupExpensesByCategory(transactions: readonly Transaction[]): ExpenseCategoryItem[] {
  const map = new Map<
    string,
    { realizedCents: number; expectedCents: number; count: number }
  >();
  let grandTotal = 0;

  for (const tx of transactions) {
    if (
      tx.direction !== 'EXPENSE' ||
      tx.status === 'CANCELLED' ||
      tx.isInternalTransfer ||
      isCardBillPaymentTransaction(tx)
    ) {
      continue;
    }
    const amt = getTransactionAmountCents(tx);
    const cat = tx.category || 'Outros';
    const curr = map.get(cat) || { realizedCents: 0, expectedCents: 0, count: 0 };
    if (tx.status === 'CONFIRMED') curr.realizedCents += amt;
    else curr.expectedCents += amt;
    curr.count += 1;
    grandTotal += amt;
    map.set(cat, curr);
  }

  return Array.from(map.entries())
    .map(([category, vals]) => {
      const total = vals.realizedCents + vals.expectedCents;
      return {
        category,
        realizedAmount: fromCents(cents(vals.realizedCents)),
        expectedAmount: fromCents(cents(vals.expectedCents)),
        totalAmount: fromCents(cents(total)),
        realizedCents: cents(vals.realizedCents),
        expectedCents: cents(vals.expectedCents),
        percentage: grandTotal > 0 ? Number(((total / grandTotal) * 100).toFixed(1)) : 0,
        count: vals.count,
      };
    })
    .sort((a, b) => b.totalAmount - a.totalAmount);
}

export function buildMonthlyFlowSeries(
  transactions: readonly Transaction[],
  openingBalanceCents: MoneyCents,
  salaryData?: SalaryDataset,
  scope: EntityScope = 'CONSOLIDATED',
  yearFilter?: string
): MonthlyFlowPoint[] {
  const targetYear =
    yearFilter && /^\d{4}/.test(yearFilter) ? yearFilter.slice(0, 4) : todayLocal().slice(0, 4);

  const byMonth = new Map<string, { incomeCents: number; expenseCents: number }>();

  for (const tx of transactions) {
    if (tx.status === 'CANCELLED' || tx.isInternalTransfer) continue;
    if (scope !== 'CONSOLIDATED' && tx.entityId !== scope) continue;
    if (tx.direction === 'EXPENSE' && isCardBillPaymentTransaction(tx)) continue;
    if (yearFilter !== 'ALL' && !tx.date.startsWith(targetYear)) continue;

    const ym = tx.date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    const curr = byMonth.get(ym) || { incomeCents: 0, expenseCents: 0 };
    const amt = getTransactionAmountCents(tx);
    if (tx.direction === 'INCOME') curr.incomeCents += amt;
    else curr.expenseCents += amt;
    byMonth.set(ym, curr);
  }

  // Merge unlinked salary records for monthly flow without double counting
  if (salaryData && (scope === 'CONSOLIDATED' || scope === 'CPF')) {
    const linkedSalIds = new Set(
      transactions.filter((t) => t.salaryRecordId && t.status !== 'CANCELLED').map((t) => t.salaryRecordId!)
    );
    const sourceMap = new Map(salaryData.sources.map((s) => [s.id, s]));
    for (const rec of salaryData.records) {
      if (rec.linkedTransactionId || linkedSalIds.has(rec.id)) continue;
      if (rec.status === 'cancelled' || rec.amount === null || rec.amount <= 0) continue;
      const src = sourceMap.get(rec.sourceId);
      if (src?.category === 'loan') continue;
      const ym = `${rec.year}-${String(rec.month).padStart(2, '0')}`;
      if (yearFilter !== 'ALL' && !ym.startsWith(targetYear)) continue;
      const curr = byMonth.get(ym) || { incomeCents: 0, expenseCents: 0 };
      curr.incomeCents += toCents(rec.amount);
      byMonth.set(ym, curr);
    }
  }

  const sortedKeys = Array.from(byMonth.keys()).sort();
  let runningCents = openingBalanceCents as number;

  return sortedKeys.map((ym) => {
    const item = byMonth.get(ym)!;
    const mIdx = Number(ym.slice(5, 7)) - 1;
    const netCents = item.incomeCents - item.expenseCents;
    runningCents += netCents;
    return {
      ym,
      label: `${MONTH_SHORT[mIdx] || ym.slice(5, 7)}/${ym.slice(2, 4)}`,
      income: fromCents(cents(item.incomeCents)),
      expense: fromCents(cents(item.expenseCents)),
      net: fromCents(cents(netCents)),
      accumulatedBalance: fromCents(cents(runningCents)),
    };
  });
}

export function consolidateFinance(params: {
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  creditCards: readonly CreditCard[];
  boletos?: readonly Boleto[];
  debts?: readonly Debt[];
  assets?: readonly Asset[];
  salaryData?: SalaryDataset;
  scope?: EntityScope;
  period?: string;
  filters?: FinanceFilters;
}): ConsolidationResult {
  const scope = params.filters?.scope ?? params.scope ?? 'CONSOLIDATED';
  const period = params.period ?? 'ALL';
  const periodRange = getPeriodDateRange(period);

  const effectiveFilters: FinanceFilters = {
    ...periodRange,
    ...params.filters,
    scope,
  };

  // Re-derive live account balances deterministically
  const derivedAccounts = deriveAccountBalances(params.accounts, params.transactions);

  const scopedAccounts = derivedAccounts.filter((a) => {
    if (scope !== 'CONSOLIDATED' && a.entityId !== scope) return false;
    if (effectiveFilters.accountId && a.id !== effectiveFilters.accountId) return false;
    return true;
  });

  const scopedCards = params.creditCards.filter((c) => {
    if (scope !== 'CONSOLIDATED' && c.entityId !== scope) return false;
    if (effectiveFilters.cardId && c.id !== effectiveFilters.cardId) return false;
    return true;
  });

  const scopedDebts = (params.debts ?? []).filter((d) =>
    scope === 'CONSOLIDATED' ? true : d.entityId === scope
  );

  const scopedBoletos = (params.boletos ?? []).filter((b) =>
    scope === 'CONSOLIDATED' ? true : b.entityId === scope
  );

  const scopedAssets = (params.assets ?? []).filter((a) =>
    scope === 'CONSOLIDATED' ? true : a.entityId === scope
  );

  const filteredTransactions = filterTransactions([...params.transactions], effectiveFilters);

  const unifiedIncomes = buildUnifiedIncomes({
    transactions: params.transactions,
    salaryData: params.salaryData,
    filters: effectiveFilters,
    accounts: derivedAccounts,
  });

  // Balances
  const realizedBalanceCents = cents(
    scopedAccounts.reduce((acc, a) => acc + (a.balanceCents ?? safeToCents(a.balance, ZERO_CENTS)), 0)
  );
  const projectedBalanceCents = cents(
    scopedAccounts.reduce(
      (acc, a) => acc + (a.projectedBalanceCents ?? a.balanceCents ?? safeToCents(a.balance, ZERO_CENTS)),
      0
    )
  );

  // Incomes from unified source (transactions + unlinked salary records)
  let receivedIncomeCents = 0;
  let expectedIncomeCents = 0;
  for (const inc of unifiedIncomes) {
    if (inc.status === 'received') receivedIncomeCents += inc.amountCents;
    else if (inc.status === 'expected' || inc.status === 'overdue') expectedIncomeCents += inc.amountCents;
  }

  // Expenses from filteredTransactions (excluding internal transfers & card bill payments)
  let realizedExpenseCents = 0;
  let expectedExpenseCents = 0;
  for (const tx of filteredTransactions) {
    if (tx.direction !== 'EXPENSE' || tx.isInternalTransfer || isCardBillPaymentTransaction(tx)) {
      continue;
    }
    const amt = getTransactionAmountCents(tx);
    if (tx.status === 'CONFIRMED') realizedExpenseCents += amt;
    else if (tx.status === 'PENDING' || tx.status === 'PLANNED') expectedExpenseCents += amt;
  }

  // Open Card Invoices
  const openInvoicesCents = cents(
    scopedCards.reduce((sum, c) => {
      if (c.status === 'PAID') return sum;
      return sum + Math.max(0, safeToCents(c.currentInvoiceAmount, ZERO_CENTS));
    }, 0)
  );

  // Pending Boletos
  const pendingBoletos = scopedBoletos.filter((b) => b.status === 'PENDING');
  const pendingBoletosCents = cents(
    pendingBoletos.reduce((sum, b) => sum + safeToCents(b.valorOriginal, ZERO_CENTS), 0)
  );

  // Debts & Monthly Debt Commitments
  let totalDebtCents = 0;
  let monthlyDebtCommitmentCents = 0;
  for (const d of scopedDebts) {
    if (d.status === 'PAID') continue;
    totalDebtCents += safeToCents(d.outstandingAmount, ZERO_CENTS);
    if (d.installmentAmount && d.installmentAmount > 0) {
      monthlyDebtCommitmentCents += safeToCents(d.installmentAmount, ZERO_CENTS);
    }
  }

  const assetsTotalCents = cents(
    scopedAssets.reduce((sum, a) => sum + safeToCents(a.currentValue, ZERO_CENTS), 0)
  );

  // Monthly Commitments = expected period expenses + open card invoices + monthly debt installments + pending boletos (deduped conceptually by keeping pending boletos + open invoices + monthly debt)
  const monthlyCommitmentsCents = addMoney(
    addMoney(openInvoicesCents, pendingBoletosCents),
    cents(monthlyDebtCommitmentCents)
  );

  // Estimated Free Balance = current realized cash - open card invoices - pending boletos - remaining expected outflows
  const estimatedFreeBalanceCents = subtractMoney(
    realizedBalanceCents,
    addMoney(addMoney(openInvoicesCents, pendingBoletosCents), cents(expectedExpenseCents))
  );

  const netWorthCents = subtractMoney(
    addMoney(realizedBalanceCents, assetsTotalCents),
    addMoney(cents(totalDebtCents), openInvoicesCents)
  );

  const totalIncomeForRate = receivedIncomeCents;
  const savingsRatePct =
    totalIncomeForRate > 0
      ? Number((((totalIncomeForRate - realizedExpenseCents) / totalIncomeForRate) * 100).toFixed(1))
      : 0;

  // Upcoming Due Dates (Boletos, Cards, Debts, Pending Expenses)
  const today = todayLocal();
  const upcomingDues: UpcomingDueItem[] = [];

  for (const b of pendingBoletos) {
    upcomingDues.push({
      id: `bol-${b.id}`,
      kind: 'BOLETO',
      title: b.beneficiario,
      subtitle: `${b.category} · Boleto`,
      date: b.vencimento,
      amount: b.valorOriginal,
      entityId: b.entityId,
      targetTab: 'boletos',
    });
  }

  for (const c of scopedCards) {
    if (c.status !== 'PAID' && c.currentInvoiceAmount > 0) {
      const baseYm = period && /^\d{4}-\d{2}$/.test(period) ? period : today.slice(0, 7);
      const dueStr = `${baseYm}-${String(Math.min(28, Math.max(1, c.dueDay))).padStart(2, '0')}`;
      upcomingDues.push({
        id: `card-${c.id}`,
        kind: 'CARD',
        title: `Fatura ${c.cardName}`,
        subtitle: `${c.institutionName} · Final ${c.last4}`,
        date: dueStr,
        amount: c.currentInvoiceAmount,
        entityId: c.entityId,
        targetTab: 'cards',
      });
    }
  }

  for (const d of scopedDebts) {
    if (d.status !== 'PAID' && d.installmentAmount && d.installmentAmount > 0) {
      const baseYm = period && /^\d{4}-\d{2}$/.test(period) ? period : today.slice(0, 7);
      const dueStr = d.nextDueDate || `${baseYm}-${String(Math.min(28, Math.max(1, d.dueDay))).padStart(2, '0')}`;
      upcomingDues.push({
        id: `debt-${d.id}`,
        kind: 'DEBT',
        title: `${d.creditorName}`,
        subtitle: `${d.description} · Parcela`,
        date: dueStr,
        amount: d.installmentAmount,
        entityId: d.entityId,
        targetTab: 'debts',
      });
    }
  }

  for (const tx of filteredTransactions) {
    if (tx.direction === 'EXPENSE' && (tx.status === 'PENDING' || tx.status === 'PLANNED')) {
      upcomingDues.push({
        id: `tx-${tx.id}`,
        kind: 'TRANSACTION',
        title: tx.description,
        subtitle: `${tx.category} · ${tx.status === 'PENDING' ? 'Pendente' : 'Planejado'}`,
        date: tx.date,
        amount: fromCents(getTransactionAmountCents(tx)),
        entityId: tx.entityId,
        targetTab: tx.entityId === 'CNPJ' ? 'cnpj' : 'cpf',
      });
    }
  }

  upcomingDues.sort((a, b) => a.date.localeCompare(b.date));

  const openingSumCents = cents(
    scopedAccounts.reduce(
      (sum, a) => sum + (a.openingBalanceCents ?? safeToCents(a.openingBalance, ZERO_CENTS)),
      0
    )
  );

  const flowSourceTransactions = filterTransactions([...params.transactions], {
    scope,
    accountId: effectiveFilters.accountId,
    cardId: effectiveFilters.cardId,
    category: effectiveFilters.category,
    source: effectiveFilters.source,
    type: effectiveFilters.type,
  });

  return {
    summary: {
      consolidatedBalance: fromCents(realizedBalanceCents),
      projectedBalance: fromCents(projectedBalanceCents),
      estimatedFreeBalance: fromCents(estimatedFreeBalanceCents),
      totalIncome: fromCents(cents(receivedIncomeCents)),
      expectedIncome: fromCents(cents(expectedIncomeCents)),
      totalExpenses: fromCents(cents(realizedExpenseCents)),
      expectedExpenses: fromCents(cents(expectedExpenseCents)),
      openInvoices: fromCents(openInvoicesCents),
      totalPendingBoletos: fromCents(pendingBoletosCents),
      totalDebt: fromCents(cents(totalDebtCents)),
      monthlyDebtCommitment: fromCents(cents(monthlyDebtCommitmentCents)),
      monthlyCommitments: fromCents(monthlyCommitmentsCents),
      assetsTotal: fromCents(assetsTotalCents),
      netWorth: fromCents(netWorthCents),
      savingsRatePct,
    },
    scopedAccounts,
    scopedCards,
    scopedDebts,
    scopedBoletos,
    filteredTransactions,
    unifiedIncomes,
    incomeBySource: groupIncomesBySource(unifiedIncomes),
    expensesByCategory: groupExpensesByCategory(filteredTransactions),
    monthlyFlow: buildMonthlyFlowSeries(
      flowSourceTransactions,
      openingSumCents,
      params.salaryData,
      scope,
      effectiveFilters.startDate ? effectiveFilters.startDate.slice(0, 4) : period
    ),
    upcomingDues: upcomingDues.slice(0, 8),
  };
}
