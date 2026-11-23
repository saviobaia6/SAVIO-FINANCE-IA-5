import React, { useMemo, useState } from 'react';
import { CreditCard, Transaction, TransactionStatus } from '../../types';
import { ALL_CARD_CATEGORIES } from '../../domain/cards/CardInvoiceAuditorService';
import {
  buildCardAnnualSummary,
  buildCardCalendarMonthMarkers,
  buildCardLedgerExcelArrayBuffer,
  buildCardLedgerTableRows,
  CARD_ENTRY_KIND_LABELS,
  CardEntryKind,
  CardTableFilterParams,
  classifyCardTransactionKind,
  exportCardLedgerToExcel,
  generateCardLedgerCsv,
  getCardPostingDate,
  getCardPurchaseDate,
} from '../../domain/cards/CardLedgerService';
import { cents, fromCents, getTransactionAmountCents } from '../../domain/money/money';
import { formatDateBR, todayLocal } from '../../utils/dateUtils';
import { formatarValor } from '../../utils/formatters';
import { usePrivacy } from '../../contexts/PrivacyContext';
import {
  getWorkspaceAccessToken,
  signInWithGoogleWorkspace,
  uploadExcelToGoogleDrive,
} from '../../services/googleWorkspace';
import { BankLogo } from '../BankLogo';
import {
  AlertCircle,
  ArrowUpDown,
  CalendarDays,
  CheckCircle2,
  CloudUpload,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react';

interface CardSpreadsheetViewsProps {
  mode: 'DAILY' | 'ANNUAL' | 'TABLE';
  card: CreditCard;
  transactions: readonly Transaction[];
  year: number;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onChangeYear: (year: number) => void;
  onDrillToMonth: (year: number, month: number) => void;
  onAddEntryForDate: (date: string) => void;
  onEditEntry: (tx: Transaction) => void;
  onDeleteEntry: (tx: Transaction) => void;
}

export const CardSpreadsheetViews: React.FC<CardSpreadsheetViewsProps> = ({
  mode,
  card,
  transactions,
  year,
  selectedDate,
  onSelectDate,
  onChangeYear,
  onDrillToMonth,
  onAddEntryForDate,
  onEditEntry,
  onDeleteEntry,
}) => {
  const { hideValues } = usePrivacy();

  // Table filter / sort state
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<CardEntryKind | 'ALL'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<TransactionStatus | 'ALL'>('ALL');
  const [cycleFilter, setCycleFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<CardTableFilterParams['sortBy']>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Export & confirmation state ("sempre pergunta para atualizar/exportar")
  const [pendingAction, setPendingAction] = useState<'EXCEL' | 'CSV' | 'DRIVE' | null>(null);
  const [busyExport, setBusyExport] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const [exportError, setExportError] = useState('');
  const [driveFileId, setDriveFileId] = useState<string | null>(null);

  const tableFilters: CardTableFilterParams = useMemo(
    () => ({
      search,
      kind: kindFilter,
      category: categoryFilter,
      status: statusFilter,
      cycleYm: cycleFilter,
      sortBy,
      sortDir,
    }),
    [search, kindFilter, categoryFilter, statusFilter, cycleFilter, sortBy, sortDir]
  );

  const tableRows = useMemo(
    () => buildCardLedgerTableRows(card, transactions, tableFilters),
    [card, transactions, tableFilters]
  );

  const allCardCycles = useMemo(() => {
    const base = buildCardLedgerTableRows(card, transactions, {});
    return Array.from(new Set(base.map((r) => r.cycleYm))).sort().reverse();
  }, [card, transactions]);

  const annual = useMemo(
    () =>
      buildCardAnnualSummary({
        card,
        transactions,
        year,
        byBillingCycle: true,
      }),
    [card, transactions, year]
  );

  const dailySummary = useMemo(() => {
    const dYear = Number(selectedDate.slice(0, 4)) || year;
    const dMonth = Number(selectedDate.slice(5, 7)) || 1;
    const cal = buildCardCalendarMonthMarkers({
      card,
      transactions,
      year: dYear,
      month: dMonth,
      filterByCycleOnly: false,
    });
    return cal.days.get(selectedDate) || null;
  }, [card, transactions, selectedDate, year]);

  const toggleSort = (col: CardTableFilterParams['sortBy']) => {
    if (sortBy === col) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
  };

  const executeConfirmedExport = async () => {
    const action = pendingAction;
    if (!action) return;
    setPendingAction(null);
    setExportError('');
    setExportStatus('');
    setDriveFileId(null);

    if (action === 'EXCEL') {
      const fileName = exportCardLedgerToExcel({
        card,
        transactions,
        filters: tableFilters,
        year,
      });
      setExportStatus(`Planilha "${fileName}" exportada com abas de lançamentos e ciclos.`);
      return;
    }

    if (action === 'CSV') {
      const csv = generateCardLedgerCsv(card, transactions, tableFilters);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Planilha_${card.cardName.replace(/\s+/g, '_')}_${card.last4}_${todayLocal()}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setExportStatus('Planilha CSV exportada com identificação do banco e cartão.');
      return;
    }

    if (action === 'DRIVE') {
      setBusyExport(true);
      try {
        let token = getWorkspaceAccessToken();
        if (!token) {
          const auth = await signInWithGoogleWorkspace();
          token = auth.accessToken;
        }
        const { bytes, fileName } = buildCardLedgerExcelArrayBuffer({
          card,
          transactions,
          filters: tableFilters,
          year,
        });
        const uploaded = await uploadExcelToGoogleDrive(token, fileName, bytes);
        setDriveFileId(uploaded.id);
        setExportStatus(`Planilha "${fileName}" salva no seu Google Drive com sucesso.`);
      } catch (err) {
        setExportError(
          err instanceof Error ? err.message : 'Falha ao exportar planilha para o Google Drive.'
        );
      } finally {
        setBusyExport(false);
      }
    }
  };

  if (mode === 'DAILY') {
    const dayTxs = dailySummary?.transactions || [];
    return (
      <div className="space-y-4 min-w-0">
        <div className="sf-card p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <BankLogo
              bankName={card.institutionName}
              bankCode={card.bankCode}
              logoUrl={card.logoUrl}
              size={38}
            />
            <div>
              <h3 className="font-display text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">
                Visão Diária · {formatDateBR(selectedDate)}
              </h3>
              <p className="text-[11px] text-[#64748B] dark:text-slate-400">
                {card.cardName} (•••• {card.last4}) — Compra vs Lançamento
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => onSelectDate(e.target.value)}
              aria-label="Selecionar data diária do cartão"
              className="min-h-11 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs sm:text-sm font-semibold text-[#0F172A] dark:text-white"
            />
            <button
              type="button"
              onClick={() => onAddEntryForDate(selectedDate)}
              className="min-h-11 px-3.5 rounded-xl bg-[#061E3E] hover:bg-[#0F172A] dark:bg-[#059669] dark:hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Plus size={14} /> Novo lançamento
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div className="sf-card p-3">
            <span className="text-[11px] text-[#64748B] dark:text-slate-400 block">
              Compras à vista
            </span>
            <strong className="font-money text-sm font-extrabold text-[#0F172A] dark:text-white">
              {formatarValor(fromCents(cents(dailySummary?.purchasesCents || 0)), hideValues)}
            </strong>
          </div>
          <div className="sf-card p-3">
            <span className="text-[11px] text-[#64748B] dark:text-slate-400 block">
              Parcelas lançadas
            </span>
            <strong className="font-money text-sm font-extrabold text-sky-700 dark:text-sky-400">
              {formatarValor(fromCents(cents(dailySummary?.installmentsCents || 0)), hideValues)}
            </strong>
          </div>
          <div className="sf-card p-3">
            <span className="text-[11px] text-[#64748B] dark:text-slate-400 block">
              Tarifas
            </span>
            <strong className="font-money text-sm font-extrabold text-amber-700 dark:text-amber-400">
              {formatarValor(fromCents(cents(dailySummary?.feesCents || 0)), hideValues)}
            </strong>
          </div>
          <div className="sf-card p-3">
            <span className="text-[11px] text-[#64748B] dark:text-slate-400 block">
              Estornos &amp; Pagamentos
            </span>
            <strong className="font-money text-sm font-extrabold text-[#059669] dark:text-[#10B981]">
              {formatarValor(
                fromCents(
                  cents(
                    ((dailySummary?.reversalsCents as number) || 0) +
                      ((dailySummary?.paymentsCents as number) || 0)
                  )
                ),
                hideValues
              )}
            </strong>
          </div>
        </div>

        <div className="sf-card overflow-hidden">
          {dayTxs.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#64748B] dark:text-slate-400">
              Nenhuma movimentação registrada em {formatDateBR(selectedDate)} para {card.cardName}.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {dayTxs.map((tx) => {
                const kind = classifyCardTransactionKind(tx);
                const val = fromCents(getTransactionAmountCents(tx));
                return (
                  <div
                    key={tx.id}
                    className="p-3.5 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-700 dark:text-slate-200">
                          {CARD_ENTRY_KIND_LABELS[kind]}
                        </span>
                        <span className="text-xs sm:text-sm font-bold text-[#0F172A] dark:text-white truncate">
                          {tx.description}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#64748B] dark:text-slate-400 mt-0.5">
                        Compra: {formatDateBR(getCardPurchaseDate(tx))} · Lançamento:{' '}
                        {formatDateBR(getCardPostingDate(tx))} · Categoria: {tx.category}
                        {tx.billingCycleYm ? ` · Ciclo ${tx.billingCycleYm}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
                      <span
                        className={`font-money text-sm font-extrabold ${
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
      </div>
    );
  }

  if (mode === 'ANNUAL') {
    return (
      <div className="space-y-4 min-w-0">
        <div className="sf-card p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <BankLogo
              bankName={card.institutionName}
              bankCode={card.bankCode}
              logoUrl={card.logoUrl}
              size={38}
            />
            <div>
              <h3 className="font-display text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">
                Resumo Anual por Ciclo · {year}
              </h3>
              <p className="text-[11px] text-[#64748B] dark:text-slate-400">
                12 meses do cartão {card.cardName} (Toque em um mês para abrir no calendário)
              </p>
            </div>
          </div>

          <select
            value={year}
            onChange={(e) => onChangeYear(Number(e.target.value))}
            aria-label="Selecionar ano do resumo anual"
            className="min-h-11 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs sm:text-sm font-bold text-[#0F172A] dark:text-white"
          >
            {[year - 2, year - 1, year, year + 1, year + 2].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        {/* Annual Totals */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div className="sf-card p-3">
            <span className="text-[11px] text-[#64748B] dark:text-slate-400 block">
              À vista + Tarifas ({year})
            </span>
            <strong className="font-money text-sm font-extrabold text-[#0F172A] dark:text-white">
              {formatarValor(
                fromCents(
                  cents((annual.totalPurchasesCents as number) + (annual.totalFeesCents as number))
                ),
                hideValues
              )}
            </strong>
          </div>
          <div className="sf-card p-3">
            <span className="text-[11px] text-[#64748B] dark:text-slate-400 block">
              Parcelado ({year})
            </span>
            <strong className="font-money text-sm font-extrabold text-sky-700 dark:text-sky-400">
              {formatarValor(fromCents(annual.totalInstallmentsCents), hideValues)}
            </strong>
          </div>
          <div className="sf-card p-3">
            <span className="text-[11px] text-[#64748B] dark:text-slate-400 block">
              Estornos &amp; Pagamentos
            </span>
            <strong className="font-money text-sm font-extrabold text-[#059669] dark:text-[#10B981]">
              {formatarValor(
                fromCents(
                  cents((annual.totalReversalsCents as number) + (annual.totalPaymentsCents as number))
                ),
                hideValues
              )}
            </strong>
          </div>
          <div className="sf-card p-3">
            <span className="text-[11px] text-[#64748B] dark:text-slate-400 block">
              Total líquido faturado
            </span>
            <strong className="font-money text-sm font-extrabold text-red-700 dark:text-red-400">
              {formatarValor(fromCents(annual.totalNetChargesCents), hideValues)}
            </strong>
          </div>
        </div>

        {/* 12 Months Grid (Mobile-friendly cards + Desktop compact list) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {annual.months.map((m) => (
            <button
              key={m.yearMonth}
              type="button"
              onClick={() => onDrillToMonth(year, m.monthNumber)}
              className="sf-card p-3.5 text-left hover:border-[#059669] transition-colors cursor-pointer space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-sm font-extrabold text-[#0F172A] dark:text-white flex items-center gap-1.5">
                  <CalendarDays size={14} className="text-[#059669]" />
                  {m.label}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    m.cycleStatus === 'PAID'
                      ? 'bg-emerald-50 text-[#059669] dark:bg-emerald-950/60 dark:text-[#10B981]'
                      : m.cycleStatus === 'CLOSED'
                        ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                        : m.cycleStatus === 'FUTURE'
                          ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                          : 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                  }`}
                >
                  {m.cycleStatus === 'PAID'
                    ? 'Paga'
                    : m.cycleStatus === 'CLOSED'
                      ? 'Fechada'
                      : m.cycleStatus === 'FUTURE'
                        ? 'Futura'
                        : 'Aberta'}
                </span>
              </div>

              <div className="text-[11px] text-[#64748B] dark:text-slate-400">
                Fecha {formatDateBR(m.closingDate)} · Vence {formatDateBR(m.dueDate)} ·{' '}
                {m.transactionCount} lançamento(s)
              </div>

              <div className="flex items-center justify-between pt-1.5 border-t border-slate-100 dark:border-slate-800 text-xs">
                <span className="text-[#64748B] dark:text-slate-400">Fatura líquida:</span>
                <strong className="font-money font-extrabold text-[#0F172A] dark:text-white">
                  {formatarValor(fromCents(m.netInvoiceCents), hideValues)}
                </strong>
              </div>
              {m.paymentsCents > 0 && (
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[#64748B] dark:text-slate-400">Pago / Restante:</span>
                  <span className="font-money font-bold text-[#059669] dark:text-[#10B981]">
                    {formatarValor(fromCents(m.paymentsCents), hideValues)} /{' '}
                    {formatarValor(fromCents(m.remainingCents), hideValues)}
                  </span>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // TABLE / SPREADSHEET MODE
  return (
    <div className="space-y-4 min-w-0">
      {exportStatus && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={15} />
            <span>{exportStatus}</span>
          </div>
          {driveFileId && (
            <a
              href={`https://drive.google.com/file/d/${driveFileId}/view`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline font-bold"
            >
              Abrir no Drive <ExternalLink size={13} />
            </a>
          )}
        </div>
      )}

      {exportError && (
        <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-xs font-semibold text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertCircle size={15} />
          <span>{exportError}</span>
        </div>
      )}

      {/* Confirmation prompt before exporting/updating spreadsheet externally */}
      {pendingAction && (
        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 space-y-2.5">
          <div className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200 font-semibold">
            <ShieldAlert size={16} className="shrink-0 mt-0.5" />
            <span>
              {pendingAction === 'DRIVE'
                ? `Confirmar envio da planilha "${card.cardName}" (${tableRows.length} registros) para sua conta do Google Drive?`
                : pendingAction === 'EXCEL'
                  ? `Confirmar download do arquivo Excel (.xlsx) da planilha "${card.cardName}"?`
                  : `Confirmar download do arquivo CSV da planilha "${card.cardName}"?`}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPendingAction(null)}
              className="min-h-10 px-4 rounded-xl border border-amber-300 dark:border-amber-700 text-xs font-semibold text-amber-900 dark:text-amber-200 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={executeConfirmedExport}
              className="min-h-10 px-4 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
            >
              Sim, confirmar
            </button>
          </div>
        </div>
      )}

      {/* Filters & Export Toolbar */}
      <div className="sf-card p-3.5 sm:p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={18} className="text-[#059669]" />
            <h3 className="font-display text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">
              Planilha Própria · {card.cardName} ({tableRows.length})
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPendingAction('EXCEL')}
              disabled={busyExport}
              className="min-h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-[#0F172A] dark:text-white hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer"
            >
              <Download size={14} /> Excel
            </button>
            <button
              type="button"
              onClick={() => setPendingAction('CSV')}
              disabled={busyExport}
              className="min-h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-[#0F172A] dark:text-white hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer"
            >
              <Download size={14} /> CSV
            </button>
            <button
              type="button"
              onClick={() => setPendingAction('DRIVE')}
              disabled={busyExport}
              className="min-h-10 px-3 rounded-xl bg-[#061E3E] hover:bg-[#0F172A] dark:bg-[#059669] dark:hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <CloudUpload size={14} /> Salvar no Drive
            </button>
          </div>
        </div>

        {/* Search + Filter Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
          <div className="relative sm:col-span-2 lg:col-span-2">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              placeholder="Buscar estabelecimento, categoria ou nota..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full min-h-10 pl-9 pr-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-[#0F172A] dark:text-white"
            />
          </div>

          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as CardEntryKind | 'ALL')}
            aria-label="Filtrar por tipo"
            className="min-h-10 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-[#0F172A] dark:text-white"
          >
            <option value="ALL">Todos os tipos</option>
            <option value="PURCHASE">Compra à vista</option>
            <option value="INSTALLMENT">Parcelada</option>
            <option value="FEE">Tarifa / Encargo</option>
            <option value="REVERSAL">Estorno / Crédito</option>
            <option value="PAYMENT">Pagamento fatura</option>
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filtrar por categoria"
            className="min-h-10 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-[#0F172A] dark:text-white"
          >
            <option value="ALL">Todas categorias</option>
            {ALL_CARD_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            value={cycleFilter}
            onChange={(e) => setCycleFilter(e.target.value)}
            aria-label="Filtrar por ciclo"
            className="min-h-10 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-[#0F172A] dark:text-white"
          >
            <option value="ALL">Todos os ciclos</option>
            {allCardCycles.map((ym) => (
              <option key={ym} value={ym}>
                Ciclo {ym}
              </option>
            ))}
          </select>
        </div>

        {/* Sort quick bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[#64748B] dark:text-slate-400">Ordenar:</span>
            {(
              [
                ['date', 'Lançamento'],
                ['purchaseDate', 'Compra'],
                ['amount', 'Valor'],
                ['description', 'Descrição'],
                ['cycle', 'Ciclo'],
              ] as Array<[CardTableFilterParams['sortBy'], string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => toggleSort(key)}
                className={`px-2 py-1 rounded-lg border inline-flex items-center gap-1 cursor-pointer ${
                  sortBy === key
                    ? 'bg-[#061E3E] text-white border-[#061E3E] dark:bg-[#059669] dark:border-[#059669]'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                {label}
                {sortBy === key && <ArrowUpDown size={10} />}
              </button>
            ))}
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as TransactionStatus | 'ALL')}
            aria-label="Filtrar por situação"
            className="min-h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] text-[#0F172A] dark:text-white"
          >
            <option value="ALL">Situação: Todas</option>
            <option value="CONFIRMED">Confirmado</option>
            <option value="PENDING">Pendente</option>
            <option value="PLANNED">Planejado</option>
          </select>
        </div>
      </div>

      {/* Spreadsheet Grid: Responsive cards on small mobile (<640px) + Full spreadsheet table on >=640px */}
      {tableRows.length === 0 ? (
        <div className="sf-card p-8 text-center text-xs text-[#64748B] dark:text-slate-400">
          Nenhum lançamento corresponde aos filtros aplicados na planilha deste cartão.
        </div>
      ) : (
        <>
          {/* Mobile stacked spreadsheet cards (zero horizontal page scroll) */}
          <div className="sm:hidden space-y-2.5">
            {tableRows.map((row) => (
              <div key={row.transaction.id} className="sf-card p-3.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#0F172A] dark:text-white truncate">
                      {row.transaction.description}
                    </div>
                    <div className="text-[11px] text-[#64748B] dark:text-slate-400">
                      {row.kindLabel} · {row.installmentLabel} · {row.transaction.category}
                    </div>
                  </div>
                  <strong
                    className={`font-money text-xs font-extrabold shrink-0 ${
                      row.kind === 'REVERSAL' || row.kind === 'PAYMENT'
                        ? 'text-[#059669] dark:text-[#10B981]'
                        : 'text-red-700 dark:text-red-400'
                    }`}
                  >
                    {formatarValor(fromCents(row.signedAmountCents), hideValues)}
                  </strong>
                </div>

                <div className="grid grid-cols-2 gap-1.5 text-[10px] text-[#64748B] dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 p-2 rounded-xl">
                  <span>Compra: {formatDateBR(row.purchaseDate)}</span>
                  <span>Lanç.: {formatDateBR(row.postingDate)}</span>
                  <span>Fecha: {formatDateBR(row.closingDate)}</span>
                  <span>Vence: {formatDateBR(row.dueDate)}</span>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                    Ciclo {row.cycleYm} · {row.transaction.status}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onEditEntry(row.transaction)}
                      className="min-h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1 cursor-pointer"
                    >
                      <Pencil size={12} /> Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteEntry(row.transaction)}
                      className="min-h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-red-600 flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 size={12} /> Estornar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop / Tablet Spreadsheet Table */}
          <div className="hidden sm:block sf-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-[#64748B] dark:text-slate-300">
                    <th className="py-2.5 px-3 font-bold">Compra</th>
                    <th className="py-2.5 px-3 font-bold">Lançamento</th>
                    <th className="py-2.5 px-3 font-bold">Fech. / Venc.</th>
                    <th className="py-2.5 px-3 font-bold">Tipo</th>
                    <th className="py-2.5 px-3 font-bold">Descrição</th>
                    <th className="py-2.5 px-3 font-bold">Categoria</th>
                    <th className="py-2.5 px-3 font-bold">Parcela</th>
                    <th className="py-2.5 px-3 font-bold text-right">Valor</th>
                    <th className="py-2.5 px-3 font-bold text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {tableRows.map((row) => (
                    <tr
                      key={row.transaction.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                    >
                      <td className="py-2.5 px-3 tabular-nums whitespace-nowrap">
                        {formatDateBR(row.purchaseDate)}
                      </td>
                      <td className="py-2.5 px-3 tabular-nums whitespace-nowrap">
                        {formatDateBR(row.postingDate)}
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-[#64748B] dark:text-slate-400 whitespace-nowrap">
                        F {formatDateBR(row.closingDate).slice(0, 5)} · V{' '}
                        {formatDateBR(row.dueDate).slice(0, 5)}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">{row.kindLabel}</td>
                      <td className="py-2.5 px-3 font-semibold text-[#0F172A] dark:text-white max-w-[220px] truncate">
                        {row.transaction.description}
                      </td>
                      <td className="py-2.5 px-3">{row.transaction.category}</td>
                      <td className="py-2.5 px-3 whitespace-nowrap">{row.installmentLabel}</td>
                      <td
                        className={`py-2.5 px-3 text-right font-money font-extrabold whitespace-nowrap ${
                          row.kind === 'REVERSAL' || row.kind === 'PAYMENT'
                            ? 'text-[#059669] dark:text-[#10B981]'
                            : 'text-red-700 dark:text-red-400'
                        }`}
                      >
                        {formatarValor(fromCents(row.signedAmountCents), hideValues)}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onEditEntry(row.transaction)}
                          className="p-1.5 text-slate-500 hover:text-[#0F172A] dark:hover:text-white cursor-pointer"
                          title="Editar"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteEntry(row.transaction)}
                          className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                          title="Estornar ou cancelar"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
