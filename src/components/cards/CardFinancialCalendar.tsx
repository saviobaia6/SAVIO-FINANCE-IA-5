import React, { useMemo, useState } from 'react';
import { CreditCard, Transaction } from '../../types';
import {
  buildCardCalendarMonthMarkers,
  CARD_ENTRY_KIND_LABELS,
  CardEntryKind,
  classifyCardTransactionKind,
  getCardPostingDate,
  getCardPurchaseDate,
} from '../../domain/cards/CardLedgerService';
import { cents, fromCents, getTransactionAmountCents } from '../../domain/money/money';
import { formatDateBR, todayLocal } from '../../utils/dateUtils';
import { formatarValor } from '../../utils/formatters';
import { usePrivacy } from '../../contexts/PrivacyContext';
import { BankLogo } from '../BankLogo';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  CreditCard as CreditCardIcon,
  Layers,
  List,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  Trash2,
} from 'lucide-react';

interface CardFinancialCalendarProps {
  card: CreditCard;
  transactions: readonly Transaction[];
  year: number;
  month: number; // 1..12
  selectedDate: string;
  onChangeMonthYear: (year: number, month: number) => void;
  onSelectDate: (date: string) => void;
  onAddEntryForDate: (date: string) => void;
  onEditEntry: (tx: Transaction) => void;
  onDeleteEntry: (tx: Transaction) => void;
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

const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const KIND_BADGE_COLORS: Record<CardEntryKind, string> = {
  PURCHASE: 'text-[#0F172A] dark:text-white bg-slate-100 dark:bg-slate-800',
  INSTALLMENT: 'text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/60',
  FEE: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60',
  REVERSAL: 'text-[#059669] dark:text-[#10B981] bg-emerald-50 dark:bg-emerald-950/60',
  PAYMENT: 'text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60',
};

const KIND_ICON: Record<CardEntryKind, React.ReactNode> = {
  PURCHASE: <CreditCardIcon size={13} />,
  INSTALLMENT: <Layers size={13} />,
  FEE: <ReceiptText size={13} />,
  REVERSAL: <RotateCcw size={13} />,
  PAYMENT: <CalendarIcon size={13} />,
};

export const CardFinancialCalendar: React.FC<CardFinancialCalendarProps> = ({
  card,
  transactions,
  year,
  month,
  selectedDate,
  onChangeMonthYear,
  onSelectDate,
  onAddEntryForDate,
  onEditEntry,
  onDeleteEntry,
}) => {
  const { hideValues } = usePrivacy();
  const [viewLayout, setViewLayout] = useState<'CALENDAR' | 'LIST'>('CALENDAR');
  const [filterByCycle, setFilterByCycle] = useState(false);

  const monthData = useMemo(
    () =>
      buildCardCalendarMonthMarkers({
        card,
        transactions,
        year,
        month,
        filterByCycleOnly: filterByCycle,
      }),
    [card, transactions, year, month, filterByCycle]
  );

  const firstWeekday = useMemo(
    () => new Date(year, month - 1, 1).getDay(),
    [year, month]
  );
  const daysInMonth = useMemo(
    () => new Date(year, month, 0).getDate(),
    [year, month]
  );
  const today = todayLocal();

  const selectedDay = monthData.days.get(selectedDate) || {
    date: selectedDate,
    dayNumber: Number(selectedDate.slice(8, 10)) || 1,
    isClosingDay: selectedDate === monthData.closingDateForMonth,
    isDueDay: selectedDate === monthData.dueDateForMonth,
    hasPurchase: false,
    hasInstallment: false,
    hasFee: false,
    hasReversal: false,
    hasPayment: false,
    purchasesCents: 0,
    installmentsCents: 0,
    feesCents: 0,
    reversalsCents: 0,
    paymentsCents: 0,
    netChargesCents: 0,
    movementCount: 0,
    transactions: [] as Transaction[],
  };

  const prevMonth = () => {
    if (month === 1) onChangeMonthYear(year - 1, 12);
    else onChangeMonthYear(year, month - 1);
  };

  const nextMonth = () => {
    if (month === 12) onChangeMonthYear(year + 1, 1);
    else onChangeMonthYear(year, month + 1);
  };

  const statusLabel =
    monthData.cycleStatus === 'PAID'
      ? 'Fatura Paga'
      : monthData.cycleStatus === 'CLOSED'
        ? 'Fatura Fechada'
        : monthData.cycleStatus === 'FUTURE'
          ? 'Ciclo Futuro'
          : 'Fatura Aberta';

  return (
    <div className="space-y-4 min-w-0">
      {/* Month / Year Navigator & Controls */}
      <div className="sf-card p-3.5 sm:p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={prevMonth}
              className="min-h-11 min-w-11 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              aria-label="Mês anterior"
            >
              <ChevronLeft size={18} />
            </button>

            <div className="flex items-center gap-1.5">
              <select
                value={month}
                onChange={(e) => onChangeMonthYear(year, Number(e.target.value))}
                aria-label="Selecionar mês"
                className="min-h-11 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs sm:text-sm font-bold text-[#0F172A] dark:text-white"
              >
                {MONTH_NAMES_PT.map((label, idx) => (
                  <option key={label} value={idx + 1}>
                    {label}
                  </option>
                ))}
              </select>

              <select
                value={year}
                onChange={(e) => onChangeMonthYear(Number(e.target.value), month)}
                aria-label="Selecionar ano"
                className="min-h-11 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs sm:text-sm font-bold text-[#0F172A] dark:text-white"
              >
                {[year - 2, year - 1, year, year + 1, year + 2].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={nextMonth}
              className="min-h-11 min-w-11 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              aria-label="Próximo mês"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFilterByCycle((v) => !v)}
              className={`min-h-10 px-3 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                filterByCycle
                  ? 'bg-[#061E3E] text-white border-[#061E3E] dark:bg-[#059669] dark:border-[#059669]'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              {filterByCycle ? 'Por ciclo de fatura' : 'Por data calendário'}
            </button>

            <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-800/60">
              <button
                type="button"
                onClick={() => setViewLayout('CALENDAR')}
                className={`min-h-9 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer ${
                  viewLayout === 'CALENDAR'
                    ? 'bg-white dark:bg-slate-900 text-[#0F172A] dark:text-white shadow-xs'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <CalendarIcon size={13} /> Calendário
              </button>
              <button
                type="button"
                onClick={() => setViewLayout('LIST')}
                className={`min-h-9 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer ${
                  viewLayout === 'LIST'
                    ? 'bg-white dark:bg-slate-900 text-[#0F172A] dark:text-white shadow-xs'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <List size={13} /> Lista
              </button>
            </div>
          </div>
        </div>

        {/* Cycle dates banner */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs text-[#64748B] dark:text-slate-300">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              Ciclo: <strong className="text-[#0F172A] dark:text-white">{statusLabel}</strong>
            </span>
            <span>·</span>
            <span>
              Fechamento:{' '}
              <strong className="text-amber-700 dark:text-amber-400">
                {formatDateBR(monthData.closingDateForMonth)}
              </strong>
            </span>
            <span>·</span>
            <span>
              Vencimento:{' '}
              <strong className="text-red-700 dark:text-red-400">
                {formatDateBR(monthData.dueDateForMonth)}
              </strong>
            </span>
          </div>
          <span className="font-semibold text-[#0F172A] dark:text-white">
            {monthData.transactions.length} registro(s) no mês
          </span>
        </div>
      </div>

      {/* Monthly KPI Summary (2 columns on mobile, 4 on desktop) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        <div className="sf-card p-3 sm:p-3.5">
          <span className="block text-[11px] text-[#64748B] dark:text-slate-400">
            Compras à vista + Tarifas
          </span>
          <strong className="font-money text-sm sm:text-base font-extrabold text-[#0F172A] dark:text-white">
            {formatarValor(
              fromCents(cents((monthData.purchasesCents as number) + (monthData.feesCents as number))),
              hideValues
            )}
          </strong>
        </div>
        <div className="sf-card p-3 sm:p-3.5">
          <span className="block text-[11px] text-[#64748B] dark:text-slate-400">
            Parcelas do ciclo
          </span>
          <strong className="font-money text-sm sm:text-base font-extrabold text-sky-700 dark:text-sky-400">
            {formatarValor(fromCents(monthData.installmentsCents), hideValues)}
          </strong>
        </div>
        <div className="sf-card p-3 sm:p-3.5">
          <span className="block text-[11px] text-[#64748B] dark:text-slate-400">
            Estornos / Pagamentos
          </span>
          <strong className="font-money text-sm sm:text-base font-extrabold text-[#059669] dark:text-[#10B981]">
            {formatarValor(
              fromCents(cents((monthData.reversalsCents as number) + (monthData.paymentsCents as number))),
              hideValues
            )}
          </strong>
        </div>
        <div className="sf-card p-3 sm:p-3.5">
          <span className="block text-[11px] text-[#64748B] dark:text-slate-400">
            Fatura líquida / Restante
          </span>
          <strong className="font-money text-sm sm:text-base font-extrabold text-red-700 dark:text-red-400">
            {formatarValor(fromCents(monthData.remainingCycleCents), hideValues)}
          </strong>
        </div>
      </div>

      {/* Main Content: Calendar Grid + Day Panel OR List View */}
      {viewLayout === 'CALENDAR' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Calendar Grid */}
          <div className="lg:col-span-7 sf-card p-3 sm:p-4 min-w-0">
            <div className="grid grid-cols-7 gap-1 mb-1.5">
              {WEEKDAYS_SHORT.map((wd) => (
                <div
                  key={wd}
                  className="text-center text-[10px] sm:text-[11px] font-bold text-[#64748B] dark:text-slate-400 py-1"
                >
                  {wd}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: firstWeekday }).map((_, i) => (
                <div key={`empty-${i}`} className="min-h-[50px] sm:min-h-[60px]" />
              ))}

              {Array.from({ length: daysInMonth }).map((_, idx) => {
                const dayNum = idx + 1;
                const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(
                  2,
                  '0'
                )}`;
                const summary = monthData.days.get(isoDate);
                const isSelected = isoDate === selectedDate;
                const isToday = isoDate === today;

                return (
                  <button
                    key={isoDate}
                    type="button"
                    onClick={() => onSelectDate(isoDate)}
                    className={`min-h-[50px] sm:min-h-[60px] p-1 rounded-xl border flex flex-col items-center justify-between transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#061E3E] text-white border-[#061E3E] dark:bg-[#059669] dark:border-[#059669]'
                        : summary?.isDueDay
                          ? 'bg-red-50/70 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-[#0F172A] dark:text-white'
                          : summary?.isClosingDay
                            ? 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-[#0F172A] dark:text-white'
                            : isToday
                              ? 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-[#0F172A] dark:text-white'
                              : 'bg-white dark:bg-slate-900/50 border-slate-100 dark:border-slate-800 text-[#0F172A] dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <div className="w-full flex items-center justify-between px-0.5">
                      <span className="text-[11px] sm:text-xs font-bold tabular-nums">
                        {dayNum}
                      </span>
                      {summary?.isDueDay && (
                        <span
                          className={`text-[8px] font-extrabold ${
                            isSelected ? 'text-white' : 'text-red-700 dark:text-red-300'
                          }`}
                          title="Vencimento da fatura"
                        >
                          VENC
                        </span>
                      )}
                      {!summary?.isDueDay && summary?.isClosingDay && (
                        <span
                          className={`text-[8px] font-extrabold ${
                            isSelected ? 'text-white' : 'text-amber-700 dark:text-amber-300'
                          }`}
                          title="Fechamento da fatura"
                        >
                          FECH
                        </span>
                      )}
                    </div>

                    {/* Event indicators */}
                    <div className="flex items-center justify-center gap-0.5 flex-wrap">
                      {(summary?.hasPurchase || summary?.hasInstallment) && (
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isSelected ? 'bg-white' : 'bg-red-500'
                          }`}
                          title="Compra"
                        />
                      )}
                      {summary?.hasFee && (
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isSelected ? 'bg-amber-200' : 'bg-amber-500'
                          }`}
                          title="Tarifa"
                        />
                      )}
                      {summary?.hasReversal && (
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isSelected ? 'bg-emerald-200' : 'bg-[#059669]'
                          }`}
                          title="Estorno"
                        />
                      )}
                      {summary?.hasPayment && (
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isSelected ? 'bg-indigo-200' : 'bg-indigo-600'
                          }`}
                          title="Pagamento"
                        />
                      )}
                    </div>

                    <span
                      className={`text-[9px] font-money truncate max-w-full ${
                        isSelected ? 'text-white/90' : 'text-[#64748B] dark:text-slate-400'
                      }`}
                    >
                      {summary && summary.movementCount > 0
                        ? `${summary.movementCount}x`
                        : ''}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Compact legend */}
            <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] sm:text-[11px] text-[#64748B] dark:text-slate-400">
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500" /> Compras/Parcelas
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-500" /> Tarifas
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#059669]" /> Estornos
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-indigo-600" /> Pagamentos
              </span>
            </div>
          </div>

          {/* Clicked Day Detail Panel */}
          <div className="lg:col-span-5 sf-card p-4 space-y-3.5 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <BankLogo
                  bankName={card.institutionName}
                  bankCode={card.bankCode}
                  logoUrl={card.logoUrl}
                  size={36}
                />
                <div className="min-w-0">
                  <h4 className="font-display text-sm sm:text-base font-bold text-[#0F172A] dark:text-white truncate">
                    {formatDateBR(selectedDate)}
                  </h4>
                  <p className="text-[11px] text-[#64748B] dark:text-slate-400 truncate">
                    {selectedDay.isDueDay
                      ? 'Dia de vencimento da fatura'
                      : selectedDay.isClosingDay
                        ? 'Dia de fechamento do ciclo'
                        : `${selectedDay.movementCount} movimentação(ões) na data`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onAddEntryForDate(selectedDate)}
                className="min-h-10 px-3 rounded-xl bg-[#061E3E] hover:bg-[#0F172A] dark:bg-[#059669] dark:hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <Plus size={14} /> Lançar
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70">
                <span className="text-[10px] text-[#64748B] dark:text-slate-400 block">
                  Compras + Tarifas
                </span>
                <strong className="font-money font-bold text-[#0F172A] dark:text-white">
                  {formatarValor(
                    fromCents(
                      cents(
                        (selectedDay.purchasesCents as number) +
                          (selectedDay.installmentsCents as number) +
                          (selectedDay.feesCents as number)
                      )
                    ),
                    hideValues
                  )}
                </strong>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70">
                <span className="text-[10px] text-[#64748B] dark:text-slate-400 block">
                  Estornos + Pagamentos
                </span>
                <strong className="font-money font-bold text-[#059669] dark:text-[#10B981]">
                  {formatarValor(
                    fromCents(
                      cents(
                        (selectedDay.reversalsCents as number) +
                          (selectedDay.paymentsCents as number)
                      )
                    ),
                    hideValues
                  )}
                </strong>
              </div>
            </div>

            {selectedDay.transactions.length === 0 ? (
              <div className="py-6 text-center text-xs text-[#64748B] dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                Nenhum lançamento nesta data para {card.cardName}.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-96 overflow-y-auto">
                {selectedDay.transactions.map((tx) => {
                  const kind = classifyCardTransactionKind(tx);
                  const val = fromCents(getTransactionAmountCents(tx));
                  const pDate = getCardPurchaseDate(tx);
                  const lDate = getCardPostingDate(tx);
                  return (
                    <div key={tx.id} className="py-2.5 flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-[#0F172A] dark:text-white truncate">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${KIND_BADGE_COLORS[kind]}`}>
                            {KIND_ICON[kind]}
                            {CARD_ENTRY_KIND_LABELS[kind]}
                          </span>
                          <span className="truncate">{tx.description}</span>
                        </div>
                        <div className="text-[11px] text-[#64748B] dark:text-slate-400 mt-0.5">
                          {tx.category} · Compra {formatDateBR(pDate)} · Lanç. {formatDateBR(lDate)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span
                          className={`font-money text-xs font-extrabold ${
                            kind === 'REVERSAL' || kind === 'PAYMENT'
                              ? 'text-[#059669] dark:text-[#10B981]'
                              : 'text-red-700 dark:text-red-400'
                          }`}
                        >
                          {kind === 'REVERSAL' || kind === 'PAYMENT' ? '− ' : ''}
                          {formatarValor(val, hideValues)}
                        </span>
                        <button
                          type="button"
                          onClick={() => onEditEntry(tx)}
                          className="p-2 text-slate-500 hover:text-[#0F172A] dark:hover:text-white cursor-pointer"
                          title="Editar"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteEntry(tx)}
                          className="p-2 text-slate-400 hover:text-red-600 cursor-pointer"
                          title="Estornar ou cancelar"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Alternative Mobile-Friendly Monthly List View */
        <div className="sf-card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
            <h4 className="font-display text-sm font-bold text-[#0F172A] dark:text-white">
              Lista do mês — {MONTH_NAMES_PT[month - 1]} / {year}
            </h4>
            <button
              type="button"
              onClick={() => onAddEntryForDate(selectedDate)}
              className="min-h-10 px-3 rounded-xl bg-[#061E3E] dark:bg-[#059669] text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <Plus size={14} /> Novo
            </button>
          </div>
          {monthData.transactions.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#64748B] dark:text-slate-400">
              Nenhuma movimentação registrada neste mês para este cartão.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {monthData.transactions.map((tx) => {
                const kind = classifyCardTransactionKind(tx);
                const val = fromCents(getTransactionAmountCents(tx));
                return (
                  <div
                    key={tx.id}
                    className="px-4 py-3 flex items-center justify-between gap-2.5"
                  >
                    <BankLogo
                      bankName={card.institutionName}
                      bankCode={card.bankCode}
                      logoUrl={card.logoUrl}
                      size={36}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs sm:text-sm font-bold text-[#0F172A] dark:text-white truncate">
                        {tx.description}
                      </div>
                      <div className="text-[11px] text-[#64748B] dark:text-slate-400 truncate">
                        {CARD_ENTRY_KIND_LABELS[kind]} · Compra {formatDateBR(getCardPurchaseDate(tx))} · Lanç.{' '}
                        {formatDateBR(getCardPostingDate(tx))}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span
                        className={`font-money text-xs sm:text-sm font-extrabold ${
                          kind === 'REVERSAL' || kind === 'PAYMENT'
                            ? 'text-[#059669] dark:text-[#10B981]'
                            : 'text-red-700 dark:text-red-400'
                        }`}
                      >
                        {formatarValor(val, hideValues)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onEditEntry(tx)}
                        className="p-2 text-slate-500 hover:text-[#0F172A] dark:hover:text-white cursor-pointer"
                        aria-label="Editar lançamento"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteEntry(tx)}
                        className="p-2 text-slate-400 hover:text-red-600 cursor-pointer"
                        aria-label="Estornar ou cancelar"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
