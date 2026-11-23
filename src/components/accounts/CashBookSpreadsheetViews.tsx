import React, { useMemo } from 'react';
import {
  Account,
  EntityId,
  OPERATION_TYPE_LABELS,
  OperationType,
  Transaction,
} from '../../types';
import {
  buildAnnualLedgerSummary,
  buildMonthlyLedgerSheet,
  CashBookViewMode,
} from '../../domain/accounts/CashBookService';
import { cents, fromCents } from '../../domain/money/money';
import { formatDateBR } from '../../utils/dateUtils';
import { usePrivacy } from '../../contexts/PrivacyContext';
import { formatarValor } from '../../utils/formatters';
import { BankLogo } from '../BankLogo';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Pencil,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface CashBookSpreadsheetViewsProps {
  mode: Exclude<CashBookViewMode, 'DAILY'>;
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  entityId: EntityId;
  selectedAccountId: string; // 'ALL' or account.id
  includePending: boolean;
  year: number;
  month: number; // 1..12
  onChangeMonthYear: (year: number, month: number) => void;
  onDrillToMonth: (yearMonth: string) => void;
  onEditTransaction: (tx: Transaction) => void;
  onDeleteTransaction?: (id: string) => void;
  onRestoreTransaction?: (id: string) => void;
}

const MONTH_NAMES_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

export const CashBookSpreadsheetViews: React.FC<CashBookSpreadsheetViewsProps> = ({
  mode,
  accounts,
  transactions,
  entityId,
  selectedAccountId,
  includePending,
  year,
  month,
  onChangeMonthYear,
  onDrillToMonth,
  onEditTransaction,
  onDeleteTransaction,
  onRestoreTransaction,
}) => {
  const { hideValues } = usePrivacy();
  const effectiveAccountId = selectedAccountId === 'ALL' ? undefined : selectedAccountId;
  const accountById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts]
  );

  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;

  const monthlySheet = useMemo(
    () =>
      buildMonthlyLedgerSheet({
        accounts,
        transactions,
        yearMonth,
        entityId,
        accountId: effectiveAccountId,
        includePending,
      }),
    [accounts, transactions, yearMonth, entityId, effectiveAccountId, includePending]
  );

  const annualSummary = useMemo(
    () =>
      buildAnnualLedgerSummary({
        accounts,
        transactions,
        year,
        entityId,
        accountId: effectiveAccountId,
        includePending,
      }),
    [accounts, transactions, year, entityId, effectiveAccountId, includePending]
  );

  if (mode === 'MONTHLY') {
    const netXfer = monthlySheet.totalTransfersInCents - monthlySheet.totalTransfersOutCents;

    return (
      <div className="space-y-4 min-w-0">
        {/* Monthly Header Bar */}
        <div className="sf-card p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                month === 1 ? onChangeMonthYear(year - 1, 12) : onChangeMonthYear(year, month - 1)
              }
              aria-label="Mês anterior"
              className="min-w-9 min-h-9 rounded-lg border border-slate-200 dark:border-slate-700 grid place-items-center text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="font-display text-sm sm:text-base font-extrabold text-[#0F172A] dark:text-white">
              Planilha Mensal · {MONTH_NAMES_PT[month - 1]} {year}
            </div>
            <button
              type="button"
              onClick={() =>
                month === 12 ? onChangeMonthYear(year + 1, 1) : onChangeMonthYear(year, month + 1)
              }
              aria-label="Próximo mês"
              className="min-w-9 min-h-9 rounded-lg border border-slate-200 dark:border-slate-700 grid place-items-center text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <span className="text-xs font-semibold text-[#64748B] dark:text-slate-400">
            {monthlySheet.rows.length} lançamento{monthlySheet.rows.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Monthly Totals */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          <div className="sf-card p-3">
            <span className="block text-[11px] text-[#64748B] dark:text-slate-400">Saldo inicial</span>
            <strong className="font-money text-sm font-extrabold text-[#0F172A] dark:text-white">
              {formatarValor(fromCents(monthlySheet.openingBalanceCents), hideValues)}
            </strong>
          </div>
          <div className="sf-card p-3">
            <span className="block text-[11px] text-[#64748B] dark:text-slate-400">Entradas</span>
            <strong className="font-money text-sm font-extrabold text-[#059669] dark:text-[#10B981]">
              + {formatarValor(fromCents(monthlySheet.totalEntradasCents), hideValues)}
            </strong>
          </div>
          <div className="sf-card p-3">
            <span className="block text-[11px] text-[#64748B] dark:text-slate-400">Saídas</span>
            <strong className="font-money text-sm font-extrabold text-[#DC3545] dark:text-red-400">
              − {formatarValor(fromCents(monthlySheet.totalSaidasCents), hideValues)}
            </strong>
          </div>
          <div className="sf-card p-3">
            <span className="block text-[11px] text-[#64748B] dark:text-slate-400">Transf. líq.</span>
            <strong className="font-money text-sm font-extrabold text-blue-600 dark:text-blue-400">
              {formatarValor(fromCents(cents(netXfer)), hideValues)}
            </strong>
          </div>
          <div className="sf-card p-3 col-span-2 sm:col-span-1">
            <span className="block text-[11px] text-[#64748B] dark:text-slate-400">Saldo final</span>
            <strong className="font-money text-sm font-extrabold text-[#0F172A] dark:text-white">
              {formatarValor(fromCents(monthlySheet.closingBalanceCents), hideValues)}
            </strong>
          </div>
        </div>

        {/* Monthly Ledger Table / Mobile Cards */}
        <div className="sf-card overflow-hidden">
          {monthlySheet.rows.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#64748B] dark:text-slate-400">
              Nenhuma movimentação registrada em {MONTH_NAMES_PT[month - 1]} de {year}.
            </div>
          ) : (
            <>
              {/* Mobile cards (< md) */}
              <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
                {monthlySheet.rows.map((r) => {
                  const acc = accountById.get(r.accountId);
                  return (
                    <div key={r.transaction.id} className="p-3.5 space-y-2">
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <BankLogo
                            bankName={r.bankName}
                            bankCode={r.bankCode}
                            logoUrl={acc?.logoUrl}
                            size={36}
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-[#0F172A] dark:text-white truncate">
                              {r.description}
                            </div>
                            <div className="text-[11px] text-[#64748B] dark:text-slate-400 truncate">
                              {formatDateBR(r.date)} · {r.accountLabel}
                            </div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                {r.category}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-[10px] font-semibold text-blue-700 dark:text-blue-300">
                                {OPERATION_TYPE_LABELS[r.operationLabel as OperationType] || r.operationLabel}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          {r.entradaCents > 0 && (
                            <div className="font-money text-xs font-extrabold text-[#059669] dark:text-[#10B981]">
                              + {formatarValor(fromCents(r.entradaCents), hideValues)}
                            </div>
                          )}
                          {r.saidaCents > 0 && (
                            <div className="font-money text-xs font-extrabold text-[#DC3545] dark:text-red-400">
                              − {formatarValor(fromCents(r.saidaCents), hideValues)}
                            </div>
                          )}
                          {r.transferenciaCents > 0 && (
                            <div className="font-money text-xs font-extrabold text-blue-600 dark:text-blue-400">
                              {r.transferDirection === 'IN' ? '+ ' : '− '}
                              {formatarValor(fromCents(r.transferenciaCents), hideValues)}
                            </div>
                          )}
                          <div className="font-money text-[10px] text-[#64748B] dark:text-slate-400 mt-0.5">
                            Saldo: {formatarValor(fromCents(r.runningBalanceCents), hideValues)}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={() => onEditTransaction(r.transaction)}
                          className="px-2.5 min-h-8 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-600 dark:text-slate-300 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Pencil size={12} /> Editar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop spreadsheet table (>= md) */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/70 text-[#64748B] dark:text-slate-300 border-b border-slate-100 dark:border-slate-800">
                      <th className="py-3 px-4 font-semibold">Data</th>
                      <th className="py-3 px-4 font-semibold">Descrição</th>
                      <th className="py-3 px-4 font-semibold">Categoria</th>
                      <th className="py-3 px-4 font-semibold">Tipo</th>
                      <th className="py-3 px-4 font-semibold">Banco / Conta</th>
                      <th className="py-3 px-4 font-semibold text-right">Entrada</th>
                      <th className="py-3 px-4 font-semibold text-right">Saída</th>
                      <th className="py-3 px-4 font-semibold text-right">Transferência</th>
                      <th className="py-3 px-4 font-semibold text-right">Saldo acumulado</th>
                      <th className="py-3 px-4 font-semibold text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {monthlySheet.rows.map((r) => {
                      const acc = accountById.get(r.accountId);
                      const hasLock = Boolean(
                        r.transaction.reversedTransactionId || r.transaction.reversalTransactionId
                      );
                      return (
                        <tr key={r.transaction.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="py-3 px-4 whitespace-nowrap text-[#64748B] dark:text-slate-400">
                            {formatDateBR(r.date)}
                          </td>
                          <td className="py-3 px-4 font-semibold text-[#0F172A] dark:text-white max-w-[220px]">
                            <div className="truncate">{r.description}</div>
                            {r.transaction.notes && (
                              <div className="text-[10px] text-[#64748B] dark:text-slate-400 truncate">
                                {r.transaction.notes}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-semibold text-slate-700 dark:text-slate-300">
                              {r.category}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-[#64748B] dark:text-slate-300 whitespace-nowrap">
                            {OPERATION_TYPE_LABELS[r.operationLabel as OperationType] || r.operationLabel}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2 min-w-0">
                              <BankLogo
                                bankName={r.bankName}
                                bankCode={r.bankCode}
                                logoUrl={acc?.logoUrl}
                                size={28}
                              />
                              <div className="min-w-0">
                                <div className="font-semibold text-[#0F172A] dark:text-white truncate">
                                  {r.bankName}
                                </div>
                                <div className="text-[10px] text-[#64748B] dark:text-slate-400 truncate">
                                  {r.accountName}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right font-money font-bold text-[#059669] dark:text-[#10B981] whitespace-nowrap">
                            {r.entradaCents > 0 ? formatarValor(fromCents(r.entradaCents), hideValues) : '—'}
                          </td>
                          <td className="py-3 px-4 text-right font-money font-bold text-[#DC3545] dark:text-red-400 whitespace-nowrap">
                            {r.saidaCents > 0 ? formatarValor(fromCents(r.saidaCents), hideValues) : '—'}
                          </td>
                          <td className="py-3 px-4 text-right font-money font-bold text-blue-600 dark:text-blue-400 whitespace-nowrap">
                            {r.transferenciaCents > 0
                              ? `${r.transferDirection === 'IN' ? '+' : '−'} ${formatarValor(fromCents(r.transferenciaCents), hideValues)}`
                              : '—'}
                          </td>
                          <td className="py-3 px-4 text-right font-money font-extrabold text-[#0F172A] dark:text-white whitespace-nowrap">
                            {formatarValor(fromCents(r.runningBalanceCents), hideValues)}
                          </td>
                          <td className="py-3 px-4 text-center whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => onEditTransaction(r.transaction)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-[#0F172A] dark:hover:text-white cursor-pointer"
                                title="Editar"
                              >
                                <Pencil size={14} />
                              </button>
                              {r.transaction.status === 'CANCELLED' && onRestoreTransaction ? (
                                <button
                                  type="button"
                                  onClick={() => onRestoreTransaction(r.transaction.id)}
                                  className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 cursor-pointer"
                                  title="Restaurar"
                                >
                                  <RotateCcw size={14} />
                                </button>
                              ) : onDeleteTransaction ? (
                                <button
                                  type="button"
                                  disabled={r.transaction.status === 'CONFIRMED' && hasLock}
                                  onClick={() => onDeleteTransaction(r.transaction.id)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 disabled:opacity-30 cursor-pointer"
                                  title={r.transaction.status === 'CONFIRMED' ? 'Estornar' : 'Cancelar'}
                                >
                                  {r.transaction.status === 'CONFIRMED' ? <RotateCcw size={14} /> : <Trash2 size={14} />}
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ANNUAL VIEW
  const chartData = annualSummary.months.map((m) => ({
    label: MONTH_NAMES_PT[m.monthNumber - 1].slice(0, 3),
    yearMonth: m.yearMonth,
    Entradas: fromCents(m.inflowsCents),
    Saídas: fromCents(m.outflowsCents),
    Resultado: fromCents(m.monthlyResultCents),
  }));

  return (
    <div className="space-y-4 min-w-0">
      {/* Year Bar */}
      <div className="sf-card p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onChangeMonthYear(year - 1, month)}
            aria-label="Ano anterior"
            className="min-w-9 min-h-9 rounded-lg border border-slate-200 dark:border-slate-700 grid place-items-center text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="font-display text-sm sm:text-base font-extrabold text-[#0F172A] dark:text-white">
            Consolidação Anual · {year}
          </div>
          <button
            type="button"
            onClick={() => onChangeMonthYear(year + 1, month)}
            aria-label="Próximo ano"
            className="min-w-9 min-h-9 rounded-lg border border-slate-200 dark:border-slate-700 grid place-items-center text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <span className="text-xs text-[#64748B] dark:text-slate-400">
          Toque em qualquer mês para abrir a planilha mensal
        </span>
      </div>

      {/* Annual Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="sf-card p-3.5">
          <span className="block text-[11px] text-[#64748B] dark:text-slate-400">Entradas no ano</span>
          <strong className="font-money text-base font-extrabold text-[#059669] dark:text-[#10B981]">
            + {formatarValor(fromCents(annualSummary.totalInflowsCents), hideValues)}
          </strong>
        </div>
        <div className="sf-card p-3.5">
          <span className="block text-[11px] text-[#64748B] dark:text-slate-400">Saídas no ano</span>
          <strong className="font-money text-base font-extrabold text-[#DC3545] dark:text-red-400">
            − {formatarValor(fromCents(annualSummary.totalOutflowsCents), hideValues)}
          </strong>
        </div>
        <div className="sf-card p-3.5">
          <span className="block text-[11px] text-[#64748B] dark:text-slate-400">Resultado operacional</span>
          <strong
            className={`font-money text-base font-extrabold ${
              annualSummary.annualResultCents >= 0
                ? 'text-[#059669] dark:text-[#10B981]'
                : 'text-[#DC3545] dark:text-red-400'
            }`}
          >
            {formatarValor(fromCents(annualSummary.annualResultCents), hideValues)}
          </strong>
        </div>
        <div className="sf-card p-3.5">
          <span className="block text-[11px] text-[#64748B] dark:text-slate-400">Saldo final de {year}</span>
          <strong className="font-money text-base font-extrabold text-[#0F172A] dark:text-white">
            {formatarValor(fromCents(annualSummary.closingBalanceCents), hideValues)}
          </strong>
        </div>
      </div>

      {/* Annual Chart */}
      <div className="sf-card p-4 space-y-2 min-w-0">
        <div className="font-display text-xs sm:text-sm font-bold text-[#0F172A] dark:text-white">
          Comparativo Mensal {year} (Entradas vs Saídas)
        </div>
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} hide={hideValues} />
              <Tooltip
                formatter={(value: unknown) =>
                  hideValues ? '••••' : formatarValor(Number(value) || 0, false)
                }
              />
              <Bar dataKey="Entradas" fill="#10B981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Saídas" fill="#EF4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 12 Months Grid/Table */}
      <div className="sf-card overflow-hidden">
        <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
          {annualSummary.months.map((m) => (
            <button
              key={m.yearMonth}
              type="button"
              onClick={() => onDrillToMonth(m.yearMonth)}
              className="w-full text-left p-3.5 flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer"
            >
              <div>
                <div className="font-display text-sm font-bold text-[#0F172A] dark:text-white flex items-center gap-2">
                  <span>{MONTH_NAMES_PT[m.monthNumber - 1]}</span>
                  {m.momVariationPct !== null && (
                    <span
                      className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${
                        m.momVariationPct >= 0 ? 'text-[#059669]' : 'text-[#DC3545]'
                      }`}
                    >
                      {m.momVariationPct >= 0 ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                      {Math.abs(m.momVariationPct).toFixed(1).replace('.', ',')}%
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-[#64748B] dark:text-slate-400 font-money">
                  Ent: {formatarValor(fromCents(m.inflowsCents), hideValues)} · Saí:{' '}
                  {formatarValor(fromCents(m.outflowsCents), hideValues)}
                </div>
              </div>
              <div className="text-right">
                <div
                  className={`font-money text-xs font-extrabold ${
                    m.monthlyResultCents >= 0
                      ? 'text-[#059669] dark:text-[#10B981]'
                      : 'text-[#DC3545] dark:text-red-400'
                  }`}
                >
                  {formatarValor(fromCents(m.monthlyResultCents), hideValues)}
                </div>
                <div className="font-money text-[11px] text-[#64748B] dark:text-slate-400">
                  Saldo: {formatarValor(fromCents(m.closingBalanceCents), hideValues)}
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/70 text-[#64748B] dark:text-slate-300 border-b border-slate-100 dark:border-slate-800">
                <th className="py-3 px-4 font-semibold">Mês</th>
                <th className="py-3 px-4 font-semibold text-right">Entradas</th>
                <th className="py-3 px-4 font-semibold text-right">Saídas</th>
                <th className="py-3 px-4 font-semibold text-right">Transferências (Líq.)</th>
                <th className="py-3 px-4 font-semibold text-right">Resultado mensal</th>
                <th className="py-3 px-4 font-semibold text-right">Saldo final</th>
                <th className="py-3 px-4 font-semibold text-right">Var. M/M</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {annualSummary.months.map((m) => {
                const netTransf = m.transfersInCents - m.transfersOutCents;
                return (
                  <tr
                    key={m.yearMonth}
                    onClick={() => onDrillToMonth(m.yearMonth)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4 font-bold text-[#0F172A] dark:text-white">
                      {MONTH_NAMES_PT[m.monthNumber - 1]} / {year}
                    </td>
                    <td className="py-3 px-4 text-right font-money font-semibold text-[#059669] dark:text-[#10B981]">
                      {formatarValor(fromCents(m.inflowsCents), hideValues)}
                    </td>
                    <td className="py-3 px-4 text-right font-money font-semibold text-[#DC3545] dark:text-red-400">
                      {formatarValor(fromCents(m.outflowsCents), hideValues)}
                    </td>
                    <td className="py-3 px-4 text-right font-money font-semibold text-blue-600 dark:text-blue-400">
                      {formatarValor(fromCents(cents(netTransf)), hideValues)}
                    </td>
                    <td
                      className={`py-3 px-4 text-right font-money font-extrabold ${
                        m.monthlyResultCents >= 0
                          ? 'text-[#059669] dark:text-[#10B981]'
                          : 'text-[#DC3545] dark:text-red-400'
                      }`}
                    >
                      {formatarValor(fromCents(m.monthlyResultCents), hideValues)}
                    </td>
                    <td className="py-3 px-4 text-right font-money font-extrabold text-[#0F172A] dark:text-white">
                      {formatarValor(fromCents(m.closingBalanceCents), hideValues)}
                    </td>
                    <td className="py-3 px-4 text-right font-money">
                      {m.momVariationPct === null ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-0.5 font-bold ${
                            m.momVariationPct >= 0 ? 'text-[#059669]' : 'text-[#DC3545]'
                          }`}
                        >
                          {m.momVariationPct >= 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                          {Math.abs(m.momVariationPct).toFixed(1).replace('.', ',')}%
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
