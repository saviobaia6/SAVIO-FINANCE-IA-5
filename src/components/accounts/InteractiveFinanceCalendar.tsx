import React, { useMemo } from 'react';
import {
  Account,
  EntityId,
  OPERATION_TYPE_LABELS,
  Transaction,
} from '../../types';
import {
  buildCalendarMonthMarkers,
  calculateDailyCashBookSummary,
} from '../../domain/accounts/CashBookService';
import { fromCents, getTransactionAmountCents } from '../../domain/money/money';
import { formatDateBR, todayLocal } from '../../utils/dateUtils';
import { usePrivacy } from '../../contexts/PrivacyContext';
import { formatarValor } from '../../utils/formatters';
import { BankLogo } from '../BankLogo';
import {
  ArrowLeftRight,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';

interface InteractiveFinanceCalendarProps {
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  entityId: EntityId;
  selectedAccountId: string; // 'ALL' or specific account.id
  includePending: boolean;
  year: number;
  month: number; // 1..12
  selectedDate: string; // YYYY-MM-DD
  onChangeMonthYear: (year: number, month: number) => void;
  onSelectDate: (date: string) => void;
  onAddMovement: (date: string, mode: 'INCOME' | 'EXPENSE' | 'TRANSFER') => void;
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

const WEEKDAY_HEADERS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export const InteractiveFinanceCalendar: React.FC<InteractiveFinanceCalendarProps> = ({
  accounts,
  transactions,
  entityId,
  selectedAccountId,
  includePending,
  year,
  month,
  selectedDate,
  onChangeMonthYear,
  onSelectDate,
  onAddMovement,
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

  const markers = useMemo(
    () =>
      buildCalendarMonthMarkers({
        accounts,
        transactions,
        year,
        month,
        entityId,
        accountId: effectiveAccountId,
        includePending,
      }),
    [accounts, transactions, year, month, entityId, effectiveAccountId, includePending]
  );

  const daySummary = useMemo(
    () =>
      calculateDailyCashBookSummary({
        accounts,
        transactions,
        date: selectedDate,
        entityId,
        accountId: effectiveAccountId,
        includePending,
      }),
    [accounts, transactions, selectedDate, entityId, effectiveAccountId, includePending]
  );

  const cells = useMemo(() => {
    const firstWeekday = new Date(year, month - 1, 1).getDay();
    const totalDays = new Date(year, month, 0).getDate();
    const items: Array<{ day: number | null; date: string | null }> = [];
    for (let i = 0; i < firstWeekday; i += 1) {
      items.push({ day: null, date: null });
    }
    const mm = String(month).padStart(2, '0');
    for (let d = 1; d <= totalDays; d += 1) {
      const dd = String(d).padStart(2, '0');
      items.push({ day: d, date: `${year}-${mm}-${dd}` });
    }
    return items;
  }, [year, month]);

  const yearOptions = useMemo(() => {
    const baseYear = new Date().getFullYear();
    const years: number[] = [];
    for (let y = baseYear - 5; y <= baseYear + 2; y += 1) {
      years.push(y);
    }
    if (!years.includes(year)) years.push(year);
    return years.sort((a, b) => a - b);
  }, [year]);

  const handlePrevMonth = () => {
    if (month === 1) onChangeMonthYear(year - 1, 12);
    else onChangeMonthYear(year, month - 1);
  };

  const handleNextMonth = () => {
    if (month === 12) onChangeMonthYear(year + 1, 1);
    else onChangeMonthYear(year, month + 1);
  };

  const handleGoToday = () => {
    const today = todayLocal();
    const [y, m] = today.split('-').map(Number);
    onChangeMonthYear(y, m);
    onSelectDate(today);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start min-w-0">
      {/* Left/Top: Interactive Calendar */}
      <div className="xl:col-span-7 sf-card p-3.5 sm:p-5 space-y-3 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="sf-icon-badge shrink-0">
              <CalendarIcon size={16} />
            </span>
            <h3 className="font-display text-sm sm:text-base font-bold text-[#0F172A] dark:text-white truncate">
              Calendário Financeiro · {entityId}
            </h3>
          </div>

          <button
            type="button"
            onClick={handleGoToday}
            className="px-2.5 min-h-9 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-[#059669] dark:text-[#10B981] hover:bg-emerald-50 dark:hover:bg-emerald-950/50 cursor-pointer"
          >
            Hoje
          </button>
        </div>

        {/* Month & Year selectors */}
        <div className="flex items-center justify-between gap-2 bg-slate-50 dark:bg-slate-800/60 p-2 rounded-xl border border-slate-200/80 dark:border-slate-700/80">
          <button
            type="button"
            onClick={handlePrevMonth}
            aria-label="Mês anterior"
            className="min-w-10 min-h-10 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 grid place-items-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
          >
            <ChevronLeft size={16} />
          </button>

          <div className="flex items-center gap-1.5 min-w-0">
            <select
              aria-label="Selecionar mês"
              value={month}
              onChange={(e) => onChangeMonthYear(year, Number(e.target.value))}
              className="border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs sm:text-sm font-bold bg-white dark:bg-slate-900 text-[#0F172A] dark:text-white min-h-9 cursor-pointer"
            >
              {MONTH_NAMES_PT.map((label, idx) => (
                <option key={label} value={idx + 1}>
                  {label}
                </option>
              ))}
            </select>

            <select
              aria-label="Selecionar ano"
              value={year}
              onChange={(e) => onChangeMonthYear(Number(e.target.value), month)}
              className="border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs sm:text-sm font-bold bg-white dark:bg-slate-900 text-[#0F172A] dark:text-white min-h-9 cursor-pointer"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleNextMonth}
            aria-label="Próximo mês"
            className="min-w-10 min-h-10 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 grid place-items-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] text-[#64748B] dark:text-slate-300">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#10B981]" /> Entradas
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#EF4444]" /> Saídas
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#3B82F6]" /> Transferências
          </span>
        </div>

        {/* Weekday Headers */}
        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEKDAY_HEADERS.map((w) => (
            <div
              key={w}
              className="text-[11px] font-bold text-[#64748B] dark:text-slate-400 py-1"
            >
              {w}
            </div>
          ))}
        </div>

        {/* Day Grid */}
        <div className="grid grid-cols-7 gap-1">
          {cells.map((cell, idx) => {
            if (!cell.day || !cell.date) {
              return <div key={`empty-${idx}`} className="h-12 sm:h-14" />;
            }
            const info = markers.get(cell.date);
            const isSelected = cell.date === selectedDate;
            const isToday = cell.date === todayLocal();
            const hasAny = Boolean(info && info.movementCount > 0);

            return (
              <button
                key={cell.date}
                type="button"
                onClick={() => onSelectDate(cell.date!)}
                aria-label={`Dia ${cell.day} (${formatDateBR(cell.date)})`}
                aria-pressed={isSelected}
                className={`h-12 sm:h-14 rounded-xl p-1 flex flex-col items-center justify-between transition-all border cursor-pointer ${
                  isSelected
                    ? 'border-[#061E3E] dark:border-[#10B981] bg-emerald-50/80 dark:bg-emerald-950/50 ring-2 ring-[#059669]/25'
                    : hasAny
                      ? 'border-slate-200 dark:border-white/15 bg-white dark:bg-slate-900/90 hover:border-[#059669]'
                      : 'border-slate-100 dark:border-white/10 bg-slate-50/70 dark:bg-slate-900/40 hover:border-slate-300'
                }`}
              >
                <div className="w-full flex items-center justify-between px-0.5">
                  <span
                    className={`text-xs font-bold leading-none ${
                      isToday
                        ? 'text-[#059669] dark:text-[#10B981] underline'
                        : 'text-[#0F172A] dark:text-white'
                    }`}
                  >
                    {cell.day}
                  </span>
                  {hasAny && info && (
                    <span className="text-[9px] font-extrabold text-slate-400 dark:text-slate-400 leading-none">
                      {info.movementCount}
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-center gap-1 h-2">
                  {info?.hasIncome && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" title="Entradas" />
                  )}
                  {info?.hasExpense && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444]" title="Saídas" />
                  )}
                  {info?.hasTransfer && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]" title="Transferências" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right/Bottom: Selected Date Detail & Daily Summary */}
      <div className="xl:col-span-5 sf-card p-3.5 sm:p-5 space-y-3.5 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#059669] dark:text-[#10B981]">
              Movimentações do dia
            </span>
            <h4 className="font-display text-base sm:text-lg font-extrabold text-[#0F172A] dark:text-white">
              {formatDateBR(selectedDate)}
            </h4>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onAddMovement(selectedDate, 'EXPENSE')}
              className="px-3 min-h-10 rounded-xl bg-[#061E3E] hover:bg-[#0F172A] dark:bg-[#059669] dark:hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus size={14} /> Adicionar
            </button>
            <button
              type="button"
              onClick={() => onAddMovement(selectedDate, 'TRANSFER')}
              className="px-3 min-h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-[#0F172A] dark:text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeftRight size={14} className="text-[#059669]" /> Transferir
            </button>
          </div>
        </div>

        {/* 6 Daily Ledger KPIs in compact 2-column grid */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/70">
            <span className="block text-[11px] text-[#64748B] dark:text-slate-400">
              Saldo inicial do dia
            </span>
            <strong className="font-money text-sm font-extrabold text-[#0F172A] dark:text-white">
              {formatarValor(fromCents(daySummary.openingBalanceCents), hideValues)}
            </strong>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900 dark:bg-emerald-950/60 border border-slate-800 dark:border-emerald-800/60">
            <span className="block text-[11px] text-emerald-300">
              Saldo final do dia
            </span>
            <strong className="font-money text-sm font-extrabold text-white">
              {formatarValor(fromCents(daySummary.closingBalanceCents), hideValues)}
            </strong>
          </div>

          <div className="p-2.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/40">
            <span className="block text-[11px] text-emerald-800 dark:text-emerald-300">
              Total de entradas
            </span>
            <strong className="font-money text-sm font-bold text-[#059669] dark:text-[#10B981]">
              + {formatarValor(fromCents(daySummary.inflowsCents), hideValues)}
            </strong>
          </div>

          <div className="p-2.5 rounded-xl bg-red-50/70 dark:bg-red-950/30 border border-red-200/60 dark:border-red-800/40">
            <span className="block text-[11px] text-red-800 dark:text-red-300">
              Total de saídas
            </span>
            <strong className="font-money text-sm font-bold text-[#DC3545] dark:text-red-400">
              − {formatarValor(fromCents(daySummary.outflowsCents), hideValues)}
            </strong>
          </div>

          <div className="p-2.5 rounded-xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-800/40">
            <span className="block text-[11px] text-blue-800 dark:text-blue-300">
              Transf. recebidas
            </span>
            <strong className="font-money text-xs sm:text-sm font-bold text-blue-700 dark:text-blue-300">
              + {formatarValor(fromCents(daySummary.transfersInCents), hideValues)}
            </strong>
          </div>

          <div className="p-2.5 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200/60 dark:border-indigo-800/40">
            <span className="block text-[11px] text-indigo-800 dark:text-indigo-300">
              Transf. enviadas
            </span>
            <strong className="font-money text-xs sm:text-sm font-bold text-indigo-700 dark:text-indigo-300">
              − {formatarValor(fromCents(daySummary.transfersOutCents), hideValues)}
            </strong>
          </div>
        </div>

        {/* Movement list for the selected date */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-[#0F172A] dark:text-white">
              Lançamentos do dia ({daySummary.transactions.length})
            </span>
            {daySummary.transactions.length > 0 && (
              <span className="text-[11px] text-[#64748B] dark:text-slate-400">
                Toque para editar ou estornar
              </span>
            )}
          </div>

          {daySummary.transactions.length === 0 ? (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-700 text-center space-y-2">
              <p className="text-xs text-[#64748B] dark:text-slate-400">
                Nenhuma movimentação registrada em {formatDateBR(selectedDate)}.
              </p>
              <button
                type="button"
                onClick={() => onAddMovement(selectedDate, 'EXPENSE')}
                className="px-3.5 min-h-9 rounded-lg bg-[#059669] hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Plus size={13} /> Lançar nesta data
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200/80 dark:border-slate-800 rounded-xl overflow-hidden max-h-80 overflow-y-auto">
              {daySummary.transactions.map((tx) => {
                const acc = accountById.get(tx.accountId);
                const amt = fromCents(getTransactionAmountCents(tx));
                const isXfer = Boolean(tx.isInternalTransfer || tx.transferId);
                const isIncome = tx.direction === 'INCOME';
                const hasReversalLock = Boolean(tx.reversedTransactionId || tx.reversalTransactionId);

                return (
                  <div
                    key={tx.id}
                    className="p-3 bg-white dark:bg-slate-900/80 flex items-start justify-between gap-2.5"
                  >
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <BankLogo
                        bankName={acc?.institutionName || tx.account || 'Banco'}
                        bankCode={acc?.bankCode}
                        logoUrl={acc?.logoUrl}
                        size={36}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs sm:text-sm font-bold text-[#0F172A] dark:text-white truncate">
                          {tx.description}
                        </div>
                        <div className="text-[11px] text-[#64748B] dark:text-slate-400 truncate">
                          {acc ? `${acc.institutionName} · ${acc.accountName}` : tx.account} · {tx.category}
                        </div>
                        <div className="flex flex-wrap items-center gap-1 mt-1">
                          {isXfer && (
                            <span className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 text-[10px] font-bold">
                              Transferência
                            </span>
                          )}
                          {tx.operationType && (
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-semibold">
                              {OPERATION_TYPE_LABELS[tx.operationType]}
                            </span>
                          )}
                          {tx.status !== 'CONFIRMED' && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 text-[10px] font-bold">
                              {tx.status === 'PENDING' ? 'Pendente' : tx.status === 'PLANNED' ? 'Planejado' : 'Cancelado'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0 space-y-1">
                      <div
                        className={`font-money text-xs sm:text-sm font-extrabold ${
                          isXfer
                            ? 'text-blue-600 dark:text-blue-400'
                            : isIncome
                              ? 'text-[#059669] dark:text-[#10B981]'
                              : 'text-[#DC3545] dark:text-red-400'
                        }`}
                      >
                        {hideValues
                          ? formatarValor(amt, true)
                          : `${isIncome ? '+ ' : '− '}${formatarValor(amt, false)}`}
                      </div>

                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onEditTransaction(tx)}
                          aria-label={`Editar ${tx.description}`}
                          title="Editar lançamento"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-[#0F172A] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <Pencil size={13} />
                        </button>
                        {tx.status === 'CANCELLED' && onRestoreTransaction ? (
                          <button
                            type="button"
                            onClick={() => onRestoreTransaction(tx.id)}
                            aria-label={`Restaurar ${tx.description}`}
                            title="Restaurar lançamento"
                            className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 cursor-pointer"
                          >
                            <RotateCcw size={13} />
                          </button>
                        ) : onDeleteTransaction ? (
                          <button
                            type="button"
                            disabled={tx.status === 'CONFIRMED' && hasReversalLock}
                            onClick={() => onDeleteTransaction(tx.id)}
                            aria-label={
                              tx.status === 'CONFIRMED'
                                ? `Estornar ${tx.description}`
                                : `Cancelar ${tx.description}`
                            }
                            title={tx.status === 'CONFIRMED' ? 'Estornar lançamento' : 'Cancelar lançamento'}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 disabled:opacity-30 cursor-pointer"
                          >
                            {tx.status === 'CONFIRMED' ? <RotateCcw size={13} /> : <Trash2 size={13} />}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
