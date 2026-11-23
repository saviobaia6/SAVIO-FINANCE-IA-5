import * as XLSX from 'xlsx';
import type {
  CategoryRule,
  CreditCard,
  Direction,
  Transaction,
  TransactionStatus,
} from '../../types';
import {
  MoneyCents,
  ZERO_CENTS,
  cents,
  fromCents,
  getTransactionAmountCents,
  toCents,
} from '../money/money';
import { isCardBillPaymentTransaction } from '../accounts/BalanceCalculator';
import {
  splitCentsAcrossInstallments,
  type InstallmentAmountMode,
} from '../transactions/RecurrenceService';
import { resolveBankIdentity } from '../extractions/banksRepository';
import { categorizeTransactionDescription } from '../transactions/CategorizationService';
import { sanitizeCellForSheet } from '../../utils/sheetGuard';
import { addMonthsLocal, formatDateBR, todayLocal } from '../../utils/dateUtils';
import { generateEntityId } from '../common/id';
import {
  normalizeCellValueToDate,
  type MappedSpreadsheetRow,
  type SpreadsheetColumnMapping,
} from '../imports/SpreadsheetImportService';

export type CardEntryKind = 'PURCHASE' | 'INSTALLMENT' | 'REVERSAL' | 'FEE' | 'PAYMENT';

export const CARD_ENTRY_KIND_LABELS: Record<CardEntryKind, string> = {
  PURCHASE: 'Compra à vista',
  INSTALLMENT: 'Parcelada',
  FEE: 'Tarifa / Encargo',
  REVERSAL: 'Estorno / Crédito',
  PAYMENT: 'Pagamento fatura',
};

export interface BillingCycleDates {
  cycleYm: string; // YYYY-MM (closing month/year identifier)
  closingDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  cycleLabel: string; // MM/YYYY
}

export interface CardCalendarDaySummary {
  date: string;
  dayNumber: number;
  isClosingDay: boolean;
  isDueDay: boolean;
  hasPurchase: boolean;
  hasInstallment: boolean;
  hasFee: boolean;
  hasReversal: boolean;
  hasPayment: boolean;
  purchasesCents: MoneyCents;
  installmentsCents: MoneyCents;
  feesCents: MoneyCents;
  reversalsCents: MoneyCents;
  paymentsCents: MoneyCents;
  netChargesCents: MoneyCents;
  movementCount: number;
  transactions: Transaction[];
}

export interface CardMonthlyCalendarResult {
  year: number;
  month: number;
  yearMonth: string;
  closingDateForMonth: string;
  dueDateForMonth: string;
  days: Map<string, CardCalendarDaySummary>;
  purchasesCents: MoneyCents;
  installmentsCents: MoneyCents;
  feesCents: MoneyCents;
  reversalsCents: MoneyCents;
  paymentsCents: MoneyCents;
  grossChargesCents: MoneyCents;
  netInvoiceCents: MoneyCents;
  remainingCycleCents: MoneyCents;
  cycleStatus: 'OPEN' | 'CLOSED' | 'PAID' | 'FUTURE';
  transactions: Transaction[];
}

export interface CardAnnualMonthRow {
  monthNumber: number;
  yearMonth: string;
  label: string;
  closingDate: string;
  dueDate: string;
  purchasesCents: MoneyCents;
  installmentsCents: MoneyCents;
  feesCents: MoneyCents;
  reversalsCents: MoneyCents;
  paymentsCents: MoneyCents;
  netInvoiceCents: MoneyCents;
  remainingCents: MoneyCents;
  cycleStatus: 'OPEN' | 'CLOSED' | 'PAID' | 'FUTURE';
  transactionCount: number;
}

export interface CardAnnualSummary {
  year: number;
  months: CardAnnualMonthRow[];
  totalPurchasesCents: MoneyCents;
  totalInstallmentsCents: MoneyCents;
  totalFeesCents: MoneyCents;
  totalReversalsCents: MoneyCents;
  totalPaymentsCents: MoneyCents;
  totalNetChargesCents: MoneyCents;
}

export interface CardLedgerTableRow {
  transaction: Transaction;
  kind: CardEntryKind;
  kindLabel: string;
  purchaseDate: string;
  postingDate: string;
  closingDate: string;
  dueDate: string;
  cycleYm: string;
  installmentLabel: string;
  signedAmountCents: MoneyCents;
}

export interface CardTableFilterParams {
  search?: string;
  kind?: CardEntryKind | 'ALL';
  category?: string;
  status?: TransactionStatus | 'ALL';
  cycleYm?: string;
  sortBy?: 'date' | 'purchaseDate' | 'amount' | 'description' | 'kind' | 'cycle';
  sortDir?: 'asc' | 'desc';
}

const MONTH_LABELS_PT = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
];

function clampDayInMonth(year: number, month: number, day: number): string {
  const maxDay = new Date(year, month, 0).getDate();
  const safeDay = Math.max(1, Math.min(maxDay, Math.trunc(day || 1)));
  return `${year}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
}

function addMonthsToYm(ym: string, delta: number): { year: number; month: number; ym: string } {
  const [yStr, mStr] = ym.split('-');
  const baseIdx = Number(yStr) * 12 + (Number(mStr) - 1) + delta;
  const year = Math.floor(baseIdx / 12);
  const month = ((baseIdx % 12) + 12) % 12 + 1;
  return {
    year,
    month,
    ym: `${year}-${String(month).padStart(2, '0')}`,
  };
}

export function computeBillingCycleDates(
  txDate: string,
  closingDay: number,
  dueDay: number
): BillingCycleDates {
  const cleanDate = /^\d{4}-\d{2}-\d{2}$/.test(txDate) ? txDate : todayLocal();
  const [yStr, mStr, dStr] = cleanDate.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);

  const safeClosingDay = Math.max(1, Math.min(31, Math.trunc(closingDay || 10)));
  const safeDueDay = Math.max(1, Math.min(31, Math.trunc(dueDay || 17)));

  const baseYm = `${year}-${String(month).padStart(2, '0')}`;
  // Purchases on or after closingDay roll over to next billing cycle
  const closingYmObj = day >= safeClosingDay ? addMonthsToYm(baseYm, 1) : { year, month, ym: baseYm };
  const closingDate = clampDayInMonth(closingYmObj.year, closingYmObj.month, safeClosingDay);

  // If dueDay <= closingDay, due date falls in the month after closingDate
  const dueYmObj =
    safeDueDay <= safeClosingDay
      ? addMonthsToYm(closingYmObj.ym, 1)
      : closingYmObj;
  const dueDate = clampDayInMonth(dueYmObj.year, dueYmObj.month, safeDueDay);

  return {
    cycleYm: closingYmObj.ym,
    closingDate,
    dueDate,
    cycleLabel: `${String(closingYmObj.month).padStart(2, '0')}/${closingYmObj.year}`,
  };
}

export function computeCycleClosingAndDueForYm(
  year: number,
  month: number,
  closingDay: number,
  dueDay: number
): { closingDate: string; dueDate: string } {
  const safeClosingDay = Math.max(1, Math.min(31, Math.trunc(closingDay || 10)));
  const safeDueDay = Math.max(1, Math.min(31, Math.trunc(dueDay || 17)));
  const closingDate = clampDayInMonth(year, month, safeClosingDay);
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const dueYmObj = safeDueDay <= safeClosingDay ? addMonthsToYm(ym, 1) : { year, month, ym };
  const dueDate = clampDayInMonth(dueYmObj.year, dueYmObj.month, safeDueDay);
  return { closingDate, dueDate };
}

export function classifyCardTransactionKind(tx: Transaction): CardEntryKind {
  if (tx.cardEntryKind) return tx.cardEntryKind;
  if (isCardBillPaymentTransaction(tx)) return 'PAYMENT';
  if (tx.reversedTransactionId || tx.direction === 'INCOME') return 'REVERSAL';
  if (tx.operationType === 'TARIFA' || /tarifa|anuidade|iof|juros|multa/i.test(tx.description)) {
    return 'FEE';
  }
  if ((tx.installmentTotal && tx.installmentTotal > 1) || /\(\d{1,2}\/\d{1,2}\)/.test(tx.description)) {
    return 'INSTALLMENT';
  }
  return 'PURCHASE';
}

export function getCardPurchaseDate(tx: Transaction): string {
  return tx.purchaseDate || tx.date;
}

export function getCardPostingDate(tx: Transaction): string {
  return tx.postingDate || tx.date;
}

export function filterCardLedgerTransactions(
  cardId: string,
  allTransactions: readonly Transaction[],
  includeCancelled = false
): Transaction[] {
  return allTransactions
    .filter((t) => {
      if (!includeCancelled && t.status === 'CANCELLED') return false;
      return t.creditCardId === cardId || t.accountId === cardId;
    })
    .slice()
    .sort((a, b) => getCardPostingDate(b).localeCompare(getCardPostingDate(a)) || b.id.localeCompare(a.id));
}

export interface BuildCardInstallmentPlanParams {
  card: CreditCard;
  description: string;
  category: string;
  purchaseDate: string; // YYYY-MM-DD
  firstPostingDate?: string; // YYYY-MM-DD
  amountCents: MoneyCents;
  amountMode: InstallmentAmountMode;
  installments: number;
  notes?: string;
  groupId?: string;
}

export function buildCardInstallmentPlan(
  params: BuildCardInstallmentPlanParams
): Transaction[] {
  const count = Math.max(2, Math.min(36, Math.trunc(params.installments)));
  if (params.amountCents <= 0) {
    throw new Error('O valor da compra parcelada deve ser maior que zero.');
  }

  const groupId = params.groupId || generateEntityId('cinst');
  const firstPosting = params.firstPostingDate?.trim() || params.purchaseDate;
  const perInstallmentAmounts =
    params.amountMode === 'SPLIT_TOTAL'
      ? splitCentsAcrossInstallments(params.amountCents, count)
      : Array.from({ length: count }, () => params.amountCents);

  const cleanDesc = params.description.trim();
  const cleanNotes = params.notes?.trim() || undefined;
  const currentYm = todayLocal().slice(0, 7);

  return perInstallmentAmounts.map((occCents, idx) => {
    const postingDate = addMonthsLocal(firstPosting, idx);
    const cycle = computeBillingCycleDates(
      postingDate,
      params.card.closingDay,
      params.card.dueDay
    );
    const status: TransactionStatus =
      cycle.cycleYm <= currentYm && idx === 0 ? 'CONFIRMED' : 'PENDING';

    return {
      id: generateEntityId('tr-card'),
      entityId: params.card.entityId,
      accountId: params.card.id,
      creditCardId: params.card.id,
      date: postingDate,
      purchaseDate: params.purchaseDate,
      postingDate,
      billingCycleYm: cycle.cycleYm,
      billingClosingDate: cycle.closingDate,
      billingDueDate: cycle.dueDate,
      cardEntryKind: 'INSTALLMENT',
      installmentGroupId: groupId,
      installmentCurrent: idx + 1,
      installmentTotal: count,
      description: `${cleanDesc} (${idx + 1}/${count})`,
      originalDescription: cleanDesc,
      category: params.category || 'Cartão',
      account: `${params.card.institutionName} · ${params.card.cardName}`,
      amountCents: occCents,
      amount: fromCents(occCents),
      direction: 'EXPENSE',
      status,
      origin: 'MANUAL',
      operationType: 'CARTAO',
      counterparty: cleanDesc,
      ...(cleanNotes ? { notes: cleanNotes } : {}),
      idempotencyKey: `card-inst:${groupId}:${idx + 1}/${count}`,
    };
  });
}

function txMatchesMonthCalendar(tx: Transaction, yearMonth: string): boolean {
  const posting = getCardPostingDate(tx);
  const purchase = getCardPurchaseDate(tx);
  return posting.startsWith(yearMonth) || purchase.startsWith(yearMonth);
}

function getEffectiveTxCycleYm(card: CreditCard, tx: Transaction): string {
  if (tx.billingCycleYm && /^\d{4}-\d{2}$/.test(tx.billingCycleYm)) {
    return tx.billingCycleYm;
  }
  const kind = classifyCardTransactionKind(tx);
  if (kind === 'PAYMENT') {
    return getCardPostingDate(tx).slice(0, 7);
  }
  return computeBillingCycleDates(
    getCardPostingDate(tx),
    card.closingDay,
    card.dueDay
  ).cycleYm;
}

function resolveCycleStatus(params: {
  cycleYm: string;
  closingDate: string;
  dueDate: string;
  grossChargesCents: number;
  reversalsCents: number;
  paymentsCents: number;
}): 'OPEN' | 'CLOSED' | 'PAID' | 'FUTURE' {
  const today = todayLocal();
  const currentYm = today.slice(0, 7);
  const netCharges = Math.max(0, params.grossChargesCents - params.reversalsCents);
  const remaining = Math.max(0, netCharges - params.paymentsCents);

  if (params.cycleYm > currentYm) return 'FUTURE';
  if (netCharges > 0 && remaining === 0) return 'PAID';
  if (today >= params.closingDate || params.cycleYm < currentYm) {
    return remaining === 0 && params.paymentsCents > 0 ? 'PAID' : 'CLOSED';
  }
  return 'OPEN';
}

export function buildCardCalendarMonthMarkers(params: {
  card: CreditCard;
  transactions: readonly Transaction[];
  year: number;
  month: number;
  filterByCycleOnly?: boolean;
}): CardMonthlyCalendarResult {
  const mm = String(params.month).padStart(2, '0');
  const yearMonth = `${params.year}-${mm}`;
  const totalDays = new Date(params.year, params.month, 0).getDate();
  const { closingDate, dueDate } = computeCycleClosingAndDueForYm(
    params.year,
    params.month,
    params.card.closingDay,
    params.card.dueDay
  );

  const cardTxs = filterCardLedgerTransactions(params.card.id, params.transactions, false);
  const monthTxs = cardTxs.filter((tx) => {
    if (params.filterByCycleOnly) {
      return getEffectiveTxCycleYm(params.card, tx) === yearMonth;
    }
    return txMatchesMonthCalendar(tx, yearMonth);
  });

  const days = new Map<string, CardCalendarDaySummary>();
  for (let d = 1; d <= totalDays; d += 1) {
    const date = `${yearMonth}-${String(d).padStart(2, '0')}`;
    days.set(date, {
      date,
      dayNumber: d,
      isClosingDay: date === closingDate,
      isDueDay: date === dueDate,
      hasPurchase: false,
      hasInstallment: false,
      hasFee: false,
      hasReversal: false,
      hasPayment: false,
      purchasesCents: ZERO_CENTS,
      installmentsCents: ZERO_CENTS,
      feesCents: ZERO_CENTS,
      reversalsCents: ZERO_CENTS,
      paymentsCents: ZERO_CENTS,
      netChargesCents: ZERO_CENTS,
      movementCount: 0,
      transactions: [],
    });
  }

  let purchasesTotal = 0;
  let installmentsTotal = 0;
  let feesTotal = 0;
  let reversalsTotal = 0;
  let paymentsTotal = 0;

  for (const tx of monthTxs) {
    const postingDate = getCardPostingDate(tx);
    const kind = classifyCardTransactionKind(tx);
    const amt = getTransactionAmountCents(tx) as number;

    if (kind === 'PURCHASE') purchasesTotal += amt;
    else if (kind === 'INSTALLMENT') installmentsTotal += amt;
    else if (kind === 'FEE') feesTotal += amt;
    else if (kind === 'REVERSAL') reversalsTotal += amt;
    else if (kind === 'PAYMENT') paymentsTotal += amt;

    const targetDate = postingDate.startsWith(yearMonth) ? postingDate : getCardPurchaseDate(tx);
    const dayCell = days.get(targetDate);
    if (dayCell) {
      dayCell.transactions.push(tx);
      dayCell.movementCount += 1;
      if (kind === 'PURCHASE') {
        dayCell.hasPurchase = true;
        dayCell.purchasesCents = cents((dayCell.purchasesCents as number) + amt);
      } else if (kind === 'INSTALLMENT') {
        dayCell.hasInstallment = true;
        dayCell.installmentsCents = cents((dayCell.installmentsCents as number) + amt);
      } else if (kind === 'FEE') {
        dayCell.hasFee = true;
        dayCell.feesCents = cents((dayCell.feesCents as number) + amt);
      } else if (kind === 'REVERSAL') {
        dayCell.hasReversal = true;
        dayCell.reversalsCents = cents((dayCell.reversalsCents as number) + amt);
      } else if (kind === 'PAYMENT') {
        dayCell.hasPayment = true;
        dayCell.paymentsCents = cents((dayCell.paymentsCents as number) + amt);
      }
      dayCell.netChargesCents = cents(
        (dayCell.purchasesCents as number) +
          (dayCell.installmentsCents as number) +
          (dayCell.feesCents as number) -
          (dayCell.reversalsCents as number)
      );
    }
  }

  const grossCharges = purchasesTotal + installmentsTotal + feesTotal;
  const netInvoice = Math.max(0, grossCharges - reversalsTotal);
  const remainingCycle = Math.max(0, netInvoice - paymentsTotal);

  return {
    year: params.year,
    month: params.month,
    yearMonth,
    closingDateForMonth: closingDate,
    dueDateForMonth: dueDate,
    days,
    purchasesCents: cents(purchasesTotal),
    installmentsCents: cents(installmentsTotal),
    feesCents: cents(feesTotal),
    reversalsCents: cents(reversalsTotal),
    paymentsCents: cents(paymentsTotal),
    grossChargesCents: cents(grossCharges),
    netInvoiceCents: cents(netInvoice),
    remainingCycleCents: cents(remainingCycle),
    cycleStatus: resolveCycleStatus({
      cycleYm: yearMonth,
      closingDate,
      dueDate,
      grossChargesCents: grossCharges,
      reversalsCents: reversalsTotal,
      paymentsCents: paymentsTotal,
    }),
    transactions: monthTxs,
  };
}

export function buildCardAnnualSummary(params: {
  card: CreditCard;
  transactions: readonly Transaction[];
  year: number;
  byBillingCycle?: boolean;
}): CardAnnualSummary {
  const months: CardAnnualMonthRow[] = [];
  let totalPurchases = 0;
  let totalInstallments = 0;
  let totalFees = 0;
  let totalReversals = 0;
  let totalPayments = 0;

  for (let m = 1; m <= 12; m += 1) {
    const res = buildCardCalendarMonthMarkers({
      card: params.card,
      transactions: params.transactions,
      year: params.year,
      month: m,
      filterByCycleOnly: params.byBillingCycle,
    });

    totalPurchases += res.purchasesCents as number;
    totalInstallments += res.installmentsCents as number;
    totalFees += res.feesCents as number;
    totalReversals += res.reversalsCents as number;
    totalPayments += res.paymentsCents as number;

    months.push({
      monthNumber: m,
      yearMonth: res.yearMonth,
      label: `${MONTH_LABELS_PT[m - 1]}/${params.year}`,
      closingDate: res.closingDateForMonth,
      dueDate: res.dueDateForMonth,
      purchasesCents: res.purchasesCents,
      installmentsCents: res.installmentsCents,
      feesCents: res.feesCents,
      reversalsCents: res.reversalsCents,
      paymentsCents: res.paymentsCents,
      netInvoiceCents: res.netInvoiceCents,
      remainingCents: res.remainingCycleCents,
      cycleStatus: res.cycleStatus,
      transactionCount: res.transactions.length,
    });
  }

  const totalNet = Math.max(0, totalPurchases + totalInstallments + totalFees - totalReversals);

  return {
    year: params.year,
    months,
    totalPurchasesCents: cents(totalPurchases),
    totalInstallmentsCents: cents(totalInstallments),
    totalFeesCents: cents(totalFees),
    totalReversalsCents: cents(totalReversals),
    totalPaymentsCents: cents(totalPayments),
    totalNetChargesCents: cents(totalNet),
  };
}

export function buildCardLedgerTableRows(
  card: CreditCard,
  allTransactions: readonly Transaction[],
  filters: CardTableFilterParams = {}
): CardLedgerTableRow[] {
  const txs = filterCardLedgerTransactions(card.id, allTransactions, false);
  const q = (filters.search || '').trim().toLowerCase();

  const rows: CardLedgerTableRow[] = txs
    .map((tx) => {
      const kind = classifyCardTransactionKind(tx);
      const purchaseDate = getCardPurchaseDate(tx);
      const postingDate = getCardPostingDate(tx);
      const computed = computeBillingCycleDates(postingDate, card.closingDay, card.dueDay);
      const cycleYm = tx.billingCycleYm || (kind === 'PAYMENT' ? postingDate.slice(0, 7) : computed.cycleYm);
      const closingDate = tx.billingClosingDate || computed.closingDate;
      const dueDate = tx.billingDueDate || computed.dueDate;
      const amt = getTransactionAmountCents(tx) as number;
      const signed = kind === 'REVERSAL' || kind === 'PAYMENT' ? cents(-amt) : cents(amt);
      const installmentLabel =
        tx.installmentCurrent && tx.installmentTotal
          ? `${tx.installmentCurrent}/${tx.installmentTotal}`
          : kind === 'INSTALLMENT'
            ? tx.description.match(/\((\d{1,2}\/\d{1,2})\)/)?.[1] || 'Parc.'
            : 'À vista';

      return {
        transaction: tx,
        kind,
        kindLabel: CARD_ENTRY_KIND_LABELS[kind],
        purchaseDate,
        postingDate,
        closingDate,
        dueDate,
        cycleYm,
        installmentLabel,
        signedAmountCents: signed,
      };
    })
    .filter((row) => {
      if (filters.kind && filters.kind !== 'ALL' && row.kind !== filters.kind) return false;
      if (filters.category && filters.category !== 'ALL' && row.transaction.category !== filters.category) {
        return false;
      }
      if (filters.status && filters.status !== 'ALL' && row.transaction.status !== filters.status) {
        return false;
      }
      if (filters.cycleYm && filters.cycleYm !== 'ALL' && row.cycleYm !== filters.cycleYm) {
        return false;
      }
      if (q) {
        const hay = `${row.transaction.description} ${row.transaction.category} ${row.transaction.notes || ''} ${row.kindLabel} ${row.cycleYm}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

  const sortBy = filters.sortBy || 'date';
  const dirMul = filters.sortDir === 'asc' ? 1 : -1;

  rows.sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'date') cmp = a.postingDate.localeCompare(b.postingDate);
    else if (sortBy === 'purchaseDate') cmp = a.purchaseDate.localeCompare(b.purchaseDate);
    else if (sortBy === 'amount') {
      cmp = (getTransactionAmountCents(a.transaction) as number) - (getTransactionAmountCents(b.transaction) as number);
    } else if (sortBy === 'description') {
      cmp = a.transaction.description.localeCompare(b.transaction.description, 'pt-BR');
    } else if (sortBy === 'kind') {
      cmp = a.kindLabel.localeCompare(b.kindLabel, 'pt-BR');
    } else if (sortBy === 'cycle') {
      cmp = a.cycleYm.localeCompare(b.cycleYm);
    }
    return cmp * dirMul;
  });

  return rows;
}

export function buildCardLedgerExcelWorkbook(params: {
  card: CreditCard;
  transactions: readonly Transaction[];
  filters?: CardTableFilterParams;
  year?: number;
}): { workbook: XLSX.WorkBook; fileName: string } {
  const wb = XLSX.utils.book_new();
  const bank = resolveBankIdentity(params.card.institutionName, params.card.bankCode);
  const rows = buildCardLedgerTableRows(params.card, params.transactions, params.filters);

  const header = [
    'Banco',
    'Cód. Banco',
    'Cartão',
    'Final',
    'Titularidade',
    'Data da Compra',
    'Data de Lançamento',
    'Fechamento Ciclo',
    'Vencimento Fatura',
    'Ciclo (YYYY-MM)',
    'Tipo',
    'Parcela',
    'Descrição',
    'Categoria',
    'Valor (R$)',
    'Situação',
    'Observações',
  ].map(sanitizeCellForSheet);

  const dataRows = rows.map((r) => [
    sanitizeCellForSheet(params.card.institutionName || bank.nome),
    sanitizeCellForSheet(params.card.bankCode || bank.codigo || ''),
    sanitizeCellForSheet(params.card.cardName),
    sanitizeCellForSheet(params.card.last4),
    sanitizeCellForSheet(params.card.entityId),
    sanitizeCellForSheet(formatDateBR(r.purchaseDate)),
    sanitizeCellForSheet(formatDateBR(r.postingDate)),
    sanitizeCellForSheet(formatDateBR(r.closingDate)),
    sanitizeCellForSheet(formatDateBR(r.dueDate)),
    sanitizeCellForSheet(r.cycleYm),
    sanitizeCellForSheet(r.kindLabel),
    sanitizeCellForSheet(r.installmentLabel),
    sanitizeCellForSheet(r.transaction.description),
    sanitizeCellForSheet(r.transaction.category),
    fromCents(r.signedAmountCents),
    sanitizeCellForSheet(r.transaction.status),
    sanitizeCellForSheet(r.transaction.notes || ''),
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
  XLSX.utils.book_append_sheet(wb, ws, 'Planilha Cartão');

  const targetYear = params.year || Number(todayLocal().slice(0, 4));
  const annual = buildCardAnnualSummary({
    card: params.card,
    transactions: params.transactions,
    year: targetYear,
    byBillingCycle: true,
  });

  const annualHeader = [
    'Competência',
    'Fechamento',
    'Vencimento',
    'Compras à Vista (R$)',
    'Parceladas (R$)',
    'Tarifas (R$)',
    'Estornos (R$)',
    'Pagamentos (R$)',
    'Fatura Líquida (R$)',
    'Saldo Restante (R$)',
    'Status Ciclo',
  ].map(sanitizeCellForSheet);

  const annualRows = annual.months.map((m) => [
    sanitizeCellForSheet(m.label),
    sanitizeCellForSheet(formatDateBR(m.closingDate)),
    sanitizeCellForSheet(formatDateBR(m.dueDate)),
    fromCents(m.purchasesCents),
    fromCents(m.installmentsCents),
    fromCents(m.feesCents),
    fromCents(m.reversalsCents),
    fromCents(m.paymentsCents),
    fromCents(m.netInvoiceCents),
    fromCents(m.remainingCents),
    sanitizeCellForSheet(m.cycleStatus),
  ]);

  const wsAnnual = XLSX.utils.aoa_to_sheet([annualHeader, ...annualRows]);
  XLSX.utils.book_append_sheet(wb, wsAnnual, `Ciclos ${targetYear}`);

  const cleanCardSlug = params.card.cardName
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);

  return {
    workbook: wb,
    fileName: `Planilha_Cartao_${cleanCardSlug || 'Cartao'}_${params.card.last4}_${todayLocal()}.xlsx`,
  };
}

export function buildCardLedgerExcelArrayBuffer(params: {
  card: CreditCard;
  transactions: readonly Transaction[];
  filters?: CardTableFilterParams;
  year?: number;
}): { bytes: Uint8Array; fileName: string } {
  const { workbook, fileName } = buildCardLedgerExcelWorkbook(params);
  const out = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return { bytes: new Uint8Array(out), fileName };
}

export function exportCardLedgerToExcel(params: {
  card: CreditCard;
  transactions: readonly Transaction[];
  filters?: CardTableFilterParams;
  year?: number;
}): string {
  const { workbook, fileName } = buildCardLedgerExcelWorkbook(params);
  XLSX.writeFile(workbook, fileName);
  return fileName;
}

export function generateCardLedgerCsv(
  card: CreditCard,
  transactions: readonly Transaction[],
  filters: CardTableFilterParams = {}
): string {
  const bank = resolveBankIdentity(card.institutionName, card.bankCode);
  const rows = buildCardLedgerTableRows(card, transactions, filters);

  const escapeCsv = (val: string | number): string => {
    const safe = String(sanitizeCellForSheet(val) ?? '');
    if (safe.includes(';') || safe.includes('"') || safe.includes('\n')) {
      return `"${safe.replace(/"/g, '""')}"`;
    }
    return safe;
  };

  const header = [
    'Banco',
    'Cód. Banco',
    'Cartão',
    'Final',
    'Titularidade',
    'Data da Compra',
    'Data de Lançamento',
    'Fechamento',
    'Vencimento',
    'Ciclo',
    'Tipo',
    'Parcela',
    'Descrição',
    'Categoria',
    'Valor (R$)',
    'Situação',
    'Observações',
  ];

  const lines = [
    header,
    ...rows.map((r) => [
      card.institutionName || bank.nome,
      card.bankCode || bank.codigo || '',
      card.cardName,
      card.last4,
      card.entityId,
      r.purchaseDate,
      r.postingDate,
      r.closingDate,
      r.dueDate,
      r.cycleYm,
      r.kindLabel,
      r.installmentLabel,
      r.transaction.description,
      r.transaction.category,
      fromCents(r.signedAmountCents).toFixed(2).replace('.', ','),
      r.transaction.status,
      r.transaction.notes || '',
    ]),
  ].map((line) => line.map(escapeCsv).join(';'));

  return '\uFEFF' + lines.join('\r\n');
}

export interface MappedCardSpreadsheetRow extends MappedSpreadsheetRow {
  purchaseDate: string;
  postingDate: string;
  cardEntryKind: CardEntryKind;
  installmentCurrent?: number;
  installmentTotal?: number;
}

export function mapSpreadsheetRowsForCard(params: {
  rows: string[][];
  mapping: SpreadsheetColumnMapping;
  targetCard: CreditCard;
  existingTransactions: readonly Transaction[];
  categoryRules?: readonly CategoryRule[];
}): MappedCardSpreadsheetRow[] {
  const { rows, mapping, targetCard, existingTransactions, categoryRules = [] } = params;
  const cardExisting = existingTransactions.filter(
    (t) =>
      t.status !== 'CANCELLED' &&
      (t.creditCardId === targetCard.id || t.accountId === targetCard.id)
  );
  const existingKeys = new Set(
    existingTransactions.map((t) => t.idempotencyKey).filter(Boolean) as string[]
  );
  const seenInBatch = new Set<string>();
  const dataRows = rows.slice(mapping.headerRowIndex + 1);
  const mapped: MappedCardSpreadsheetRow[] = [];

  for (let idx = 0; idx < dataRows.length; idx += 1) {
    const row = dataRows[idx];
    if (!row || row.every((c) => !c.trim())) continue;

    const rawDateCell = mapping.dateCol >= 0 ? row[mapping.dateCol] : '';
    const parsedDate =
      normalizeCellValueToDate(
        /^\d+(\.\d+)?$/.test(rawDateCell) ? Number(rawDateCell) : rawDateCell
      ) || todayLocal();
    const dateValid = Boolean(
      normalizeCellValueToDate(
        /^\d+(\.\d+)?$/.test(rawDateCell) ? Number(rawDateCell) : rawDateCell
      )
    );

    const description =
      (mapping.descriptionCol >= 0 ? row[mapping.descriptionCol] : '').trim() ||
      'Compra no cartão';

    let amountCents: MoneyCents = ZERO_CENTS;
    let direction: Direction = 'EXPENSE';

    const rawAmtCell = mapping.amountCol >= 0 ? (row[mapping.amountCol] || '').trim() : '';
    const entradaRaw = mapping.entradaCol >= 0 ? (row[mapping.entradaCol] || '').trim() : '';
    const saidaRaw = mapping.saidaCol >= 0 ? (row[mapping.saidaCol] || '').trim() : '';

    const parseMoneyCell = (txt: string): number | null => {
      if (!txt) return null;
      const cleaned = txt.replace(/[R$\s]/gi, '');
      const hasComma = cleaned.includes(',');
      const normalized = hasComma
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned;
      const num = Number(normalized);
      return Number.isFinite(num) ? num : null;
    };

    if (entradaRaw || saidaRaw) {
      const ent = parseMoneyCell(entradaRaw);
      const sai = parseMoneyCell(saidaRaw);
      if (sai && Math.abs(sai) > 0) {
        amountCents = toCents(Math.abs(sai));
        direction = 'EXPENSE';
      } else if (ent && Math.abs(ent) > 0) {
        amountCents = toCents(Math.abs(ent));
        direction = 'INCOME';
      }
    } else if (rawAmtCell) {
      const num = parseMoneyCell(rawAmtCell);
      if (num !== null && num !== 0) {
        amountCents = toCents(Math.abs(num));
        // On card bills, negative or credit keywords represent reversal/credit; positive numbers represent charges
        direction = num < 0 ? 'INCOME' : 'EXPENSE';
      }
    }

    const tipoRaw = mapping.typeCol >= 0 ? (row[mapping.typeCol] || '').toLowerCase() : '';
    let cardEntryKind: CardEntryKind = 'PURCHASE';
    if (/estorno|cr[eé]dito|cashback|devolu/i.test(`${tipoRaw} ${description}`)) {
      cardEntryKind = 'REVERSAL';
      direction = 'INCOME';
    } else if (/pagamento\s*(?:de\s*)?fatura|pgto\s*fatura/i.test(`${tipoRaw} ${description}`)) {
      cardEntryKind = 'PAYMENT';
      direction = 'EXPENSE';
    } else if (/tarifa|anuidade|iof|juros|multa/i.test(`${tipoRaw} ${description}`)) {
      cardEntryKind = 'FEE';
      direction = 'EXPENSE';
    }

    const instMatch = description.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
    const instCur = instMatch ? Number(instMatch[1]) : undefined;
    const instTot = instMatch ? Number(instMatch[2]) : undefined;
    if (instTot && instTot > 1 && instCur && instCur <= instTot && cardEntryKind === 'PURCHASE') {
      cardEntryKind = 'INSTALLMENT';
    }

    const rawCat = mapping.categoryCol >= 0 ? (row[mapping.categoryCol] || '').trim() : '';
    const autoCat = categorizeTransactionDescription({
      description,
      direction,
      customRules: [...categoryRules],
      fallbackCategory: rawCat || 'Cartão',
    });

    const notes = mapping.notesCol >= 0 ? (row[mapping.notesCol] || '').trim() || undefined : undefined;
    const externalId =
      mapping.externalIdCol >= 0 ? (row[mapping.externalIdCol] || '').trim() || undefined : undefined;

    const cleanDescKey = description.trim().toLowerCase().replace(/\s+/g, ' ');
    const keyBase = `${targetCard.id}|${parsedDate}|${cardEntryKind}|${amountCents}|${cleanDescKey}`;
    let h = 2166136261;
    for (let i = 0; i < keyBase.length; i += 1) {
      h ^= keyBase.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idempotencyKey = externalId
      ? `card-ext-${targetCard.id}-${externalId}`
      : `card-row-${(h >>> 0).toString(16)}`;

    const dupByKey = existingKeys.has(idempotencyKey);
    const dupByHeuristic = cardExisting.some(
      (t) =>
        t.date === parsedDate &&
        getTransactionAmountCents(t) === amountCents &&
        t.description.trim().toLowerCase() === cleanDescKey
    );
    const dupInside = seenInBatch.has(idempotencyKey);
    seenInBatch.add(idempotencyKey);

    const isDuplicate = dupByKey || dupByHeuristic || dupInside;
    const hasValidationError = amountCents <= 0 || !dateValid;

    mapped.push({
      rowId: generateEntityId('crow'),
      sourceRowIndex: mapping.headerRowIndex + 2 + idx,
      date: parsedDate,
      purchaseDate: parsedDate,
      postingDate: parsedDate,
      description,
      amountCents,
      amount: fromCents(amountCents),
      direction,
      category: rawCat || autoCat.category || 'Cartão',
      operationType: cardEntryKind === 'FEE' ? 'TARIFA' : 'CARTAO',
      cardEntryKind,
      installmentCurrent: instCur,
      installmentTotal: instTot,
      notes,
      externalId,
      idempotencyKey,
      isDuplicate,
      duplicateReason: dupByKey
        ? 'Registro já importado neste cartão'
        : dupByHeuristic
          ? 'Compra equivalente já lançada nesta data/cartão'
          : dupInside
            ? 'Linha duplicada nesta planilha'
            : undefined,
      hasValidationError,
      validationError:
        amountCents <= 0
          ? 'Valor inválido ou zerado'
          : !dateValid
            ? 'Data inválida'
            : undefined,
      selected: !isDuplicate && !hasValidationError,
    });
  }

  return mapped;
}

export function buildCardTransactionsFromMappedRows(params: {
  rows: readonly MappedCardSpreadsheetRow[];
  targetCard: CreditCard;
  importBatchId: string;
}): Omit<Transaction, 'id'>[] {
  const { rows, targetCard, importBatchId } = params;
  return rows
    .filter((r) => r.selected && !r.hasValidationError && r.amountCents > 0)
    .map((r) => {
      const cycle = computeBillingCycleDates(
        r.postingDate || r.date,
        targetCard.closingDay,
        targetCard.dueDay
      );
      const isPayment = r.cardEntryKind === 'PAYMENT';
      return {
        entityId: targetCard.entityId,
        accountId: targetCard.id,
        creditCardId: targetCard.id,
        date: r.postingDate || r.date,
        purchaseDate: r.purchaseDate || r.date,
        postingDate: r.postingDate || r.date,
        billingCycleYm: cycle.cycleYm,
        billingClosingDate: cycle.closingDate,
        billingDueDate: cycle.dueDate,
        cardEntryKind: r.cardEntryKind,
        description: r.description,
        originalDescription: r.description,
        category: r.category || 'Cartão',
        account: `${targetCard.institutionName} · ${targetCard.cardName}`,
        amountCents: r.amountCents,
        amount: fromCents(r.amountCents),
        direction: r.direction,
        status: 'CONFIRMED',
        origin: 'IMPORT',
        operationType: r.operationType,
        importBatchId,
        idempotencyKey: r.idempotencyKey,
        ...(isPayment ? { isCardBillPayment: true } : {}),
        ...(r.installmentCurrent ? { installmentCurrent: r.installmentCurrent } : {}),
        ...(r.installmentTotal ? { installmentTotal: r.installmentTotal } : {}),
        ...(r.externalId ? { externalId: r.externalId } : {}),
        ...(r.notes ? { notes: r.notes } : {}),
      };
    });
}
