import * as XLSX from 'xlsx';
import type { Account, EntityId, Transaction } from '../../types';
import {
  MoneyCents,
  ZERO_CENTS,
  cents,
  fromCents,
  getTransactionAmountCents,
} from '../money/money';
import { getAccountOpeningCents } from './BalanceCalculator';
import { resolveBankIdentity } from '../extractions/banksRepository';
import { sanitizeCellForSheet } from '../../utils/sheetGuard';
import { formatDateBR, todayLocal } from '../../utils/dateUtils';

export type CashBookViewMode = 'DAILY' | 'MONTHLY' | 'ANNUAL';

export interface CashBookFilterParams {
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  entityId?: EntityId;
  accountId?: string;
  includePending?: boolean;
  includeCancelled?: boolean;
}

export interface DailyCashBookSummary {
  date: string;
  openingBalanceCents: MoneyCents;
  inflowsCents: MoneyCents;
  outflowsCents: MoneyCents;
  transfersInCents: MoneyCents;
  transfersOutCents: MoneyCents;
  netDayCents: MoneyCents;
  closingBalanceCents: MoneyCents;
  transactions: Transaction[];
}

export interface CalendarDaySummary {
  date: string;
  dayNumber: number;
  hasIncome: boolean;
  hasExpense: boolean;
  hasTransfer: boolean;
  inflowsCents: MoneyCents;
  outflowsCents: MoneyCents;
  transfersInCents: MoneyCents;
  transfersOutCents: MoneyCents;
  openingBalanceCents: MoneyCents;
  closingBalanceCents: MoneyCents;
  movementCount: number;
}

export interface MonthlyLedgerRow {
  transaction: Transaction;
  date: string;
  description: string;
  category: string;
  operationLabel: string;
  entityId: EntityId;
  accountId: string;
  bankName: string;
  bankCode?: string;
  accountName: string;
  accountLabel: string;
  isTransfer: boolean;
  entradaCents: MoneyCents;
  saidaCents: MoneyCents;
  transferenciaCents: MoneyCents;
  transferDirection?: 'IN' | 'OUT';
  runningBalanceCents: MoneyCents;
}

export interface MonthlyLedgerSheet {
  yearMonth: string;
  openingBalanceCents: MoneyCents;
  rows: MonthlyLedgerRow[];
  totalEntradasCents: MoneyCents;
  totalSaidasCents: MoneyCents;
  totalTransfersInCents: MoneyCents;
  totalTransfersOutCents: MoneyCents;
  netOperationalCents: MoneyCents;
  closingBalanceCents: MoneyCents;
}

export interface AnnualMonthRow {
  monthNumber: number;
  yearMonth: string;
  label: string;
  openingBalanceCents: MoneyCents;
  inflowsCents: MoneyCents;
  outflowsCents: MoneyCents;
  transfersInCents: MoneyCents;
  transfersOutCents: MoneyCents;
  monthlyResultCents: MoneyCents;
  closingBalanceCents: MoneyCents;
  momVariationPct: number | null;
  transactionCount: number;
}

export interface AnnualLedgerSummary {
  year: number;
  openingBalanceCents: MoneyCents;
  months: AnnualMonthRow[];
  totalInflowsCents: MoneyCents;
  totalOutflowsCents: MoneyCents;
  totalTransfersInCents: MoneyCents;
  totalTransfersOutCents: MoneyCents;
  annualResultCents: MoneyCents;
  closingBalanceCents: MoneyCents;
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

function isActiveBalanceStatus(status: Transaction['status'], includePending: boolean): boolean {
  if (status === 'CONFIRMED') return true;
  if (includePending && (status === 'PENDING' || status === 'PLANNED')) return true;
  return false;
}

function signedTxCents(tx: Transaction): MoneyCents {
  const amt = getTransactionAmountCents(tx);
  return tx.direction === 'INCOME' ? amt : cents(-amt);
}

function isTransferMovement(tx: Transaction): boolean {
  return Boolean(tx.isInternalTransfer || tx.transferId || tx.operationType === 'TRANSFERENCIA_PROPRIA');
}

export function selectScopedCashBookAccounts(params: {
  accounts: readonly Account[];
  entityId?: EntityId;
  accountId?: string;
}): Account[] {
  return params.accounts.filter((acc) => {
    if (params.entityId && acc.entityId !== params.entityId) return false;
    if (params.accountId && acc.id !== params.accountId) return false;
    return true;
  });
}

export function filterCashBookTransactions(params: CashBookFilterParams): Transaction[] {
  const scopedAccounts = selectScopedCashBookAccounts({
    accounts: params.accounts,
    entityId: params.entityId,
    accountId: params.accountId,
  });
  const allowedAccountIds = new Set(scopedAccounts.map((a) => a.id));

  return params.transactions
    .filter((tx) => {
      if (!params.includeCancelled && tx.status === 'CANCELLED') return false;
      if (!isActiveBalanceStatus(tx.status, Boolean(params.includePending)) && !params.includeCancelled) {
        return false;
      }
      if (params.entityId && tx.entityId !== params.entityId) return false;
      if (params.accountId) {
        return tx.accountId === params.accountId;
      }
      if (params.entityId && allowedAccountIds.size > 0) {
        return allowedAccountIds.has(tx.accountId) || tx.entityId === params.entityId;
      }
      return true;
    })
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export function calculateOpeningBalanceBeforeDate(params: {
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  beforeDate: string;
  entityId?: EntityId;
  accountId?: string;
  includePending?: boolean;
}): MoneyCents {
  const scopedAccounts = selectScopedCashBookAccounts({
    accounts: params.accounts,
    entityId: params.entityId,
    accountId: params.accountId,
  });

  let running = scopedAccounts.reduce(
    (sum, acc) => sum + (getAccountOpeningCents(acc) as number),
    0
  );

  const relevantTxs = filterCashBookTransactions({
    accounts: params.accounts,
    transactions: params.transactions,
    entityId: params.entityId,
    accountId: params.accountId,
    includePending: params.includePending,
    includeCancelled: false,
  });

  for (const tx of relevantTxs) {
    if (tx.date < params.beforeDate) {
      running += signedTxCents(tx) as number;
    }
  }

  return cents(running);
}

export function calculateDailyCashBook(
  account: Account,
  transactions: readonly Transaction[],
  date: string,
  includePending = false
): DailyCashBookSummary {
  return calculateDailyCashBookSummary({
    accounts: [account],
    transactions,
    date,
    entityId: account.entityId,
    accountId: account.id,
    includePending,
  });
}

export function calculateDailyCashBookSummary(params: {
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  date: string;
  entityId?: EntityId;
  accountId?: string;
  includePending?: boolean;
}): DailyCashBookSummary {
  const { date, includePending = false } = params;
  const openingBalanceCents = calculateOpeningBalanceBeforeDate({
    accounts: params.accounts,
    transactions: params.transactions,
    beforeDate: date,
    entityId: params.entityId,
    accountId: params.accountId,
    includePending,
  });

  const allScoped = filterCashBookTransactions({
    accounts: params.accounts,
    transactions: params.transactions,
    entityId: params.entityId,
    accountId: params.accountId,
    includePending,
    includeCancelled: false,
  });

  const dayTxs = allScoped.filter((t) => t.date === date);

  let inflows = 0;
  let outflows = 0;
  let transfersIn = 0;
  let transfersOut = 0;

  for (const tx of dayTxs) {
    const amt = getTransactionAmountCents(tx) as number;
    const isXfer = isTransferMovement(tx);
    if (isXfer) {
      if (tx.direction === 'INCOME') transfersIn += amt;
      else transfersOut += amt;
    } else {
      if (tx.direction === 'INCOME') inflows += amt;
      else outflows += amt;
    }
  }

  const netDay = inflows - outflows + transfersIn - transfersOut;
  const closingBalanceCents = cents((openingBalanceCents as number) + netDay);

  return {
    date,
    openingBalanceCents,
    inflowsCents: cents(inflows),
    outflowsCents: cents(outflows),
    transfersInCents: cents(transfersIn),
    transfersOutCents: cents(transfersOut),
    netDayCents: cents(netDay),
    closingBalanceCents,
    transactions: dayTxs,
  };
}

export function buildCalendarMonthMarkers(params: {
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  year: number;
  month: number; // 1..12
  entityId?: EntityId;
  accountId?: string;
  includePending?: boolean;
}): Map<string, CalendarDaySummary> {
  const mm = String(params.month).padStart(2, '0');
  const firstDay = `${params.year}-${mm}-01`;
  const totalDays = new Date(params.year, params.month, 0).getDate();
  const lastDay = `${params.year}-${mm}-${String(totalDays).padStart(2, '0')}`;

  let runningBalance = calculateOpeningBalanceBeforeDate({
    accounts: params.accounts,
    transactions: params.transactions,
    beforeDate: firstDay,
    entityId: params.entityId,
    accountId: params.accountId,
    includePending: params.includePending,
  }) as number;

  const monthTxs = filterCashBookTransactions({
    accounts: params.accounts,
    transactions: params.transactions,
    entityId: params.entityId,
    accountId: params.accountId,
    includePending: params.includePending,
    includeCancelled: false,
  }).filter((tx) => tx.date >= firstDay && tx.date <= lastDay);

  const byDate = new Map<string, Transaction[]>();
  for (const tx of monthTxs) {
    const arr = byDate.get(tx.date) || [];
    arr.push(tx);
    byDate.set(tx.date, arr);
  }

  const result = new Map<string, CalendarDaySummary>();
  for (let d = 1; d <= totalDays; d += 1) {
    const dd = String(d).padStart(2, '0');
    const date = `${params.year}-${mm}-${dd}`;
    const dayTxs = byDate.get(date) || [];

    const dayOpening = runningBalance;
    let inflows = 0;
    let outflows = 0;
    let transfersIn = 0;
    let transfersOut = 0;
    let hasIncome = false;
    let hasExpense = false;
    let hasTransfer = false;

    for (const tx of dayTxs) {
      const amt = getTransactionAmountCents(tx) as number;
      if (isTransferMovement(tx)) {
        hasTransfer = true;
        if (tx.direction === 'INCOME') transfersIn += amt;
        else transfersOut += amt;
      } else if (tx.direction === 'INCOME') {
        hasIncome = true;
        inflows += amt;
      } else {
        hasExpense = true;
        outflows += amt;
      }
    }

    const dayClosing = dayOpening + inflows - outflows + transfersIn - transfersOut;
    runningBalance = dayClosing;

    result.set(date, {
      date,
      dayNumber: d,
      hasIncome,
      hasExpense,
      hasTransfer,
      inflowsCents: cents(inflows),
      outflowsCents: cents(outflows),
      transfersInCents: cents(transfersIn),
      transfersOutCents: cents(transfersOut),
      openingBalanceCents: cents(dayOpening),
      closingBalanceCents: cents(dayClosing),
      movementCount: dayTxs.length,
    });
  }

  return result;
}

export function buildMonthlyLedgerSheet(params: {
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  yearMonth: string; // YYYY-MM
  entityId?: EntityId;
  accountId?: string;
  includePending?: boolean;
}): MonthlyLedgerSheet {
  const startDate = `${params.yearMonth}-01`;
  const endDate = `${params.yearMonth}-31`;

  const openingBalanceCents = calculateOpeningBalanceBeforeDate({
    accounts: params.accounts,
    transactions: params.transactions,
    beforeDate: startDate,
    entityId: params.entityId,
    accountId: params.accountId,
    includePending: params.includePending,
  });

  const accountById = new Map(params.accounts.map((a) => [a.id, a]));
  const monthTxs = filterCashBookTransactions({
    accounts: params.accounts,
    transactions: params.transactions,
    entityId: params.entityId,
    accountId: params.accountId,
    includePending: params.includePending,
    includeCancelled: false,
  }).filter((t) => t.date >= startDate && t.date <= endDate);

  let running = openingBalanceCents as number;
  let totalEntradas = 0;
  let totalSaidas = 0;
  let totalTransfersIn = 0;
  let totalTransfersOut = 0;

  const rows: MonthlyLedgerRow[] = monthTxs.map((tx) => {
    const acc = accountById.get(tx.accountId);
    const identity = resolveBankIdentity(
      acc?.institutionName || tx.account,
      acc?.bankCode
    );
    const bankName = acc?.institutionName || identity.nome;
    const bankCode = acc?.bankCode || identity.codigo;
    const accountName = acc?.accountName || tx.account || 'Conta vinculada';
    const accountLabel = `${bankName} · ${accountName}`;

    const amt = getTransactionAmountCents(tx) as number;
    const isXfer = isTransferMovement(tx);
    const isIncome = tx.direction === 'INCOME';

    running += isIncome ? amt : -amt;

    let entradaCents = ZERO_CENTS;
    let saidaCents = ZERO_CENTS;
    let transferenciaCents = ZERO_CENTS;
    let transferDirection: 'IN' | 'OUT' | undefined;

    if (isXfer) {
      transferenciaCents = cents(amt);
      transferDirection = isIncome ? 'IN' : 'OUT';
      if (isIncome) totalTransfersIn += amt;
      else totalTransfersOut += amt;
    } else if (isIncome) {
      entradaCents = cents(amt);
      totalEntradas += amt;
    } else {
      saidaCents = cents(amt);
      totalSaidas += amt;
    }

    return {
      transaction: tx,
      date: tx.date,
      description: tx.description,
      category: tx.category,
      operationLabel: tx.operationType || 'OUTRO',
      entityId: tx.entityId,
      accountId: tx.accountId,
      bankName,
      bankCode,
      accountName,
      accountLabel,
      isTransfer: isXfer,
      entradaCents,
      saidaCents,
      transferenciaCents,
      transferDirection,
      runningBalanceCents: cents(running),
    };
  });

  return {
    yearMonth: params.yearMonth,
    openingBalanceCents,
    rows,
    totalEntradasCents: cents(totalEntradas),
    totalSaidasCents: cents(totalSaidas),
    totalTransfersInCents: cents(totalTransfersIn),
    totalTransfersOutCents: cents(totalTransfersOut),
    netOperationalCents: cents(totalEntradas - totalSaidas),
    closingBalanceCents: cents(running),
  };
}

export function buildAnnualLedgerSummary(params: {
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  year: number;
  entityId?: EntityId;
  accountId?: string;
  includePending?: boolean;
}): AnnualLedgerSummary {
  const yearStart = `${params.year}-01-01`;
  const openingBalanceCents = calculateOpeningBalanceBeforeDate({
    accounts: params.accounts,
    transactions: params.transactions,
    beforeDate: yearStart,
    entityId: params.entityId,
    accountId: params.accountId,
    includePending: params.includePending,
  });

  let running = openingBalanceCents as number;
  let totalInflows = 0;
  let totalOutflows = 0;
  let totalTransfersIn = 0;
  let totalTransfersOut = 0;
  let prevResultCents: number | null = null;

  const scopedTxs = filterCashBookTransactions({
    accounts: params.accounts,
    transactions: params.transactions,
    entityId: params.entityId,
    accountId: params.accountId,
    includePending: params.includePending,
    includeCancelled: false,
  });

  const months: AnnualMonthRow[] = [];

  for (let m = 1; m <= 12; m += 1) {
    const mm = String(m).padStart(2, '0');
    const yearMonth = `${params.year}-${mm}`;
    const start = `${yearMonth}-01`;
    const end = `${yearMonth}-31`;
    const monthTxs = scopedTxs.filter((t) => t.date >= start && t.date <= end);

    const monthOpening = running;
    let inflows = 0;
    let outflows = 0;
    let transfersIn = 0;
    let transfersOut = 0;

    for (const tx of monthTxs) {
      const amt = getTransactionAmountCents(tx) as number;
      if (isTransferMovement(tx)) {
        if (tx.direction === 'INCOME') transfersIn += amt;
        else transfersOut += amt;
      } else if (tx.direction === 'INCOME') {
        inflows += amt;
      } else {
        outflows += amt;
      }
    }

    const monthlyResult = inflows - outflows;
    const monthClosing = monthOpening + monthlyResult + transfersIn - transfersOut;
    running = monthClosing;

    totalInflows += inflows;
    totalOutflows += outflows;
    totalTransfersIn += transfersIn;
    totalTransfersOut += transfersOut;

    let momVariationPct: number | null = null;
    if (prevResultCents !== null && prevResultCents !== 0) {
      momVariationPct = Number(
        (((monthlyResult - prevResultCents) / Math.abs(prevResultCents)) * 100).toFixed(1)
      );
    }
    prevResultCents = monthlyResult;

    months.push({
      monthNumber: m,
      yearMonth,
      label: `${MONTH_LABELS_PT[m - 1]}/${params.year}`,
      openingBalanceCents: cents(monthOpening),
      inflowsCents: cents(inflows),
      outflowsCents: cents(outflows),
      transfersInCents: cents(transfersIn),
      transfersOutCents: cents(transfersOut),
      monthlyResultCents: cents(monthlyResult),
      closingBalanceCents: cents(monthClosing),
      momVariationPct,
      transactionCount: monthTxs.length,
    });
  }

  return {
    year: params.year,
    openingBalanceCents,
    months,
    totalInflowsCents: cents(totalInflows),
    totalOutflowsCents: cents(totalOutflows),
    totalTransfersInCents: cents(totalTransfersIn),
    totalTransfersOutCents: cents(totalTransfersOut),
    annualResultCents: cents(totalInflows - totalOutflows),
    closingBalanceCents: cents(running),
  };
}

export function buildCashBookExcelWorkbook(params: {
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  entityId: EntityId;
  accountId?: string;
  viewMode: CashBookViewMode;
  date: string;
  yearMonth: string;
  year: number;
  includePending?: boolean;
}): { workbook: XLSX.WorkBook; fileName: string } {
  const wb = XLSX.utils.book_new();
  const scopeLabel = params.entityId === 'CPF' ? 'PF_CPF' : 'PJ_CNPJ';

  if (params.viewMode === 'ANNUAL') {
    const annual = buildAnnualLedgerSummary({
      accounts: params.accounts,
      transactions: params.transactions,
      year: params.year,
      entityId: params.entityId,
      accountId: params.accountId,
      includePending: params.includePending,
    });

    const header = [
      'Competência',
      'Saldo Inicial (R$)',
      'Entradas (R$)',
      'Saídas (R$)',
      'Transf. Recebidas (R$)',
      'Transf. Enviadas (R$)',
      'Resultado Mensal (R$)',
      'Saldo Final (R$)',
      'Variação M/M (%)',
      'Qtd. Mov.',
    ].map(sanitizeCellForSheet);

    const rows = annual.months.map((m) => [
      sanitizeCellForSheet(m.label),
      fromCents(m.openingBalanceCents),
      fromCents(m.inflowsCents),
      fromCents(m.outflowsCents),
      fromCents(m.transfersInCents),
      fromCents(m.transfersOutCents),
      fromCents(m.monthlyResultCents),
      fromCents(m.closingBalanceCents),
      m.momVariationPct !== null ? m.momVariationPct : '',
      m.transactionCount,
    ]);

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, 'Resumo Anual');

    const monthlyAll = buildMonthlyLedgerSheet({
      accounts: params.accounts,
      transactions: params.transactions,
      yearMonth: `${params.year}`,
      entityId: params.entityId,
      accountId: params.accountId,
      includePending: params.includePending,
    });
    const detailHeader = [
      'Data',
      'Banco',
      'Código Banco',
      'Conta',
      'Titularidade',
      'Descrição',
      'Categoria',
      'Tipo',
      'Entrada (R$)',
      'Saída (R$)',
      'Transferência (R$)',
      'Saldo Acumulado (R$)',
      'Observações',
    ].map(sanitizeCellForSheet);
    const detailRows = monthlyAll.rows.map((r) => [
      sanitizeCellForSheet(formatDateBR(r.date)),
      sanitizeCellForSheet(r.bankName),
      sanitizeCellForSheet(r.bankCode || ''),
      sanitizeCellForSheet(r.accountName),
      sanitizeCellForSheet(r.entityId),
      sanitizeCellForSheet(r.description),
      sanitizeCellForSheet(r.category),
      sanitizeCellForSheet(r.operationLabel),
      r.entradaCents > 0 ? fromCents(r.entradaCents) : '',
      r.saidaCents > 0 ? fromCents(r.saidaCents) : '',
      r.transferenciaCents > 0
        ? (r.transferDirection === 'IN' ? 1 : -1) * fromCents(r.transferenciaCents)
        : '',
      fromCents(r.runningBalanceCents),
      sanitizeCellForSheet(r.transaction.notes || ''),
    ]);
    const wsDetail = XLSX.utils.aoa_to_sheet([detailHeader, ...detailRows]);
    XLSX.utils.book_append_sheet(wb, wsDetail, 'Lançamentos Ano');

    return {
      workbook: wb,
      fileName: `Livro_Caixa_${scopeLabel}_${params.year}_${todayLocal()}.xlsx`,
    };
  }

  const sheetData = buildMonthlyLedgerSheet({
    accounts: params.accounts,
    transactions: params.transactions,
    yearMonth: params.yearMonth,
    entityId: params.entityId,
    accountId: params.accountId,
    includePending: params.includePending,
  });

  const rowsFiltered =
    params.viewMode === 'DAILY'
      ? sheetData.rows.filter((r) => r.date === params.date)
      : sheetData.rows;

  const header = [
    'Data',
    'Banco',
    'Código Banco',
    'Conta',
    'Titularidade',
    'Descrição',
    'Categoria',
    'Forma',
    'Entrada (R$)',
    'Saída (R$)',
    'Transferência (R$)',
    'Saldo Acumulado (R$)',
    'Situação',
    'Observações',
  ].map(sanitizeCellForSheet);

  const dataRows = rowsFiltered.map((r) => [
    sanitizeCellForSheet(formatDateBR(r.date)),
    sanitizeCellForSheet(r.bankName),
    sanitizeCellForSheet(r.bankCode || ''),
    sanitizeCellForSheet(r.accountName),
    sanitizeCellForSheet(r.entityId),
    sanitizeCellForSheet(r.description),
    sanitizeCellForSheet(r.category),
    sanitizeCellForSheet(r.operationLabel),
    r.entradaCents > 0 ? fromCents(r.entradaCents) : '',
    r.saidaCents > 0 ? fromCents(r.saidaCents) : '',
    r.transferenciaCents > 0
      ? (r.transferDirection === 'IN' ? 1 : -1) * fromCents(r.transferenciaCents)
      : '',
    fromCents(r.runningBalanceCents),
    sanitizeCellForSheet(r.transaction.status),
    sanitizeCellForSheet(r.transaction.notes || ''),
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
  XLSX.utils.book_append_sheet(
    wb,
    ws,
    params.viewMode === 'DAILY' ? `Dia ${formatDateBR(params.date).replace(/\//g, '-')}` : `Livro ${params.yearMonth}`
  );

  const suffix = params.viewMode === 'DAILY' ? params.date : params.yearMonth;
  return {
    workbook: wb,
    fileName: `Livro_Caixa_${scopeLabel}_${suffix}.xlsx`,
  };
}

export function exportCashBookToExcel(params: {
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  entityId: EntityId;
  accountId?: string;
  viewMode: CashBookViewMode;
  date: string;
  yearMonth: string;
  year: number;
  includePending?: boolean;
}): string {
  const { workbook, fileName } = buildCashBookExcelWorkbook(params);
  XLSX.writeFile(workbook, fileName);
  return fileName;
}
