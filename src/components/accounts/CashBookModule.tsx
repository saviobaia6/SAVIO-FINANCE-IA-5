import React, { useEffect, useMemo, useState } from 'react';
import {
  Account,
  CrossEntityTransferNature,
  EntityId,
  Transaction,
} from '../../types';
import {
  CashBookViewMode,
  exportCashBookToExcel,
  selectScopedCashBookAccounts,
} from '../../domain/accounts/CashBookService';
import { MoneyCents } from '../../domain/money/money';
import { todayLocal } from '../../utils/dateUtils';
import { usePrivacy } from '../../contexts/PrivacyContext';
import { formatarValor } from '../../utils/formatters';
import { BankLogo } from '../BankLogo';
import {
  InteractiveFinanceCalendar,
} from './InteractiveFinanceCalendar';
import { CashBookSpreadsheetViews } from './CashBookSpreadsheetViews';
import { CashBookDateModal, CashBookModalMode } from './CashBookDateModal';
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  User,
} from 'lucide-react';

interface CashBookModuleProps {
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  onSaveTransaction: (tx: Omit<Transaction, 'id'>, editId?: string) => void;
  onExecuteTransfer: (params: {
    originAccountId: string;
    destinationAccountId: string;
    amountCents: MoneyCents;
    date: string;
    description: string;
    notes?: string;
    crossEntityNature?: CrossEntityTransferNature;
  }) => { ok: boolean; error?: string };
  onDeleteTransaction?: (id: string) => void;
  onRestoreTransaction?: (id: string) => void;
}

export const CashBookModule: React.FC<CashBookModuleProps> = ({
  accounts,
  transactions,
  onSaveTransaction,
  onExecuteTransfer,
  onDeleteTransaction,
  onRestoreTransaction,
}) => {
  const { hideValues } = usePrivacy();
  const [entityId, setEntityId] = useState<EntityId>('CPF');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<CashBookViewMode>('DAILY');
  const [includePending, setIncludePending] = useState(false);

  const initialToday = todayLocal();
  const [selectedDate, setSelectedDate] = useState<string>(initialToday);
  const [year, setYear] = useState<number>(() => Number(initialToday.slice(0, 4)));
  const [month, setMonth] = useState<number>(() => Number(initialToday.slice(5, 7)));
  const [exportStatus, setExportStatus] = useState('');

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<CashBookModalMode>('EXPENSE');
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);

  const entityAccounts = useMemo(
    () => selectScopedCashBookAccounts({ accounts, entityId }),
    [accounts, entityId]
  );

  useEffect(() => {
    if (
      selectedAccountId !== 'ALL' &&
      !entityAccounts.some((a) => a.id === selectedAccountId)
    ) {
      setSelectedAccountId('ALL');
    }
  }, [entityAccounts, selectedAccountId]);

  const activeAccountObj = useMemo(
    () =>
      selectedAccountId === 'ALL'
        ? null
        : entityAccounts.find((a) => a.id === selectedAccountId) || null,
    [entityAccounts, selectedAccountId]
  );

  const handleChangeMonthYear = (nextYear: number, nextMonth: number) => {
    setYear(nextYear);
    setMonth(nextMonth);
    const mm = String(nextMonth).padStart(2, '0');
    if (!selectedDate.startsWith(`${nextYear}-${mm}`)) {
      setSelectedDate(`${nextYear}-${mm}-01`);
    }
  };

  const handleDrillToMonth = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    if (y && m) {
      setYear(y);
      setMonth(m);
      setSelectedDate(`${ym}-01`);
      setViewMode('MONTHLY');
    }
  };

  const handleExportExcel = () => {
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const fileName = exportCashBookToExcel({
      accounts,
      transactions,
      entityId,
      accountId: selectedAccountId === 'ALL' ? undefined : selectedAccountId,
      viewMode,
      date: selectedDate,
      yearMonth: ym,
      year,
      includePending,
    });
    setExportStatus(`Planilha "${fileName}" exportada com banco, código e conta identificados.`);
    window.setTimeout(() => setExportStatus(''), 5000);
  };

  return (
    <div className="space-y-4 min-w-0 animate-fadeIn">
      {/* Control Header */}
      <div className="sf-card p-3.5 sm:p-5 space-y-3.5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* CPF vs CNPJ switcher */}
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 w-full lg:w-auto">
            <button
              type="button"
              onClick={() => setEntityId('CPF')}
              className={`min-h-10 px-3.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                entityId === 'CPF'
                  ? 'bg-white dark:bg-slate-900 text-[#059669] dark:text-[#10B981] shadow-xs'
                  : 'text-[#64748B] dark:text-slate-300'
              }`}
            >
              <User size={14} /> Pessoa Física · CPF
            </button>
            <button
              type="button"
              onClick={() => setEntityId('CNPJ')}
              className={`min-h-10 px-3.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                entityId === 'CNPJ'
                  ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-xs'
                  : 'text-[#64748B] dark:text-slate-300'
              }`}
            >
              <Building2 size={14} /> Pessoa Jurídica · CNPJ
            </button>
          </div>

          {/* View Mode Switcher: Diário / Mensal / Anual */}
          <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 w-full lg:w-auto">
            {(
              [
                { id: 'DAILY', label: 'Diário' },
                { id: 'MONTHLY', label: 'Mensal' },
                { id: 'ANNUAL', label: 'Anual' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setViewMode(opt.id)}
                className={`min-h-10 px-3.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  viewMode === opt.id
                    ? 'bg-[#061E3E] dark:bg-[#059669] text-white'
                    : 'text-[#64748B] dark:text-slate-300'
                }`}
              >
                {opt.id === 'DAILY' ? <CalendarDays size={13} /> : <FileSpreadsheet size={13} />}
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Account Disambiguation Selector + Export */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-1 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            {activeAccountObj ? (
              <BankLogo
                bankName={activeAccountObj.institutionName}
                bankCode={activeAccountObj.bankCode}
                logoUrl={activeAccountObj.logoUrl}
                size={38}
              />
            ) : (
              <div className="w-[38px] h-[38px] rounded-xl bg-slate-100 dark:bg-slate-800 grid place-items-center text-slate-600 dark:text-slate-300 shrink-0">
                {entityId === 'CPF' ? <User size={18} /> : <Building2 size={18} />}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <label
                htmlFor="cashbook-account-filter"
                className="block text-[11px] font-semibold text-[#64748B] dark:text-slate-400 mb-0.5"
              >
                Conta bancária ({entityId})
              </label>
              <select
                id="cashbook-account-filter"
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs sm:text-sm font-semibold bg-white dark:bg-slate-900 text-[#0F172A] dark:text-white min-h-10"
              >
                <option value="ALL">
                  Todas as contas {entityId} ({entityAccounts.length})
                </option>
                {entityAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.institutionName} · {acc.accountName} — {formatarValor(acc.balance, hideValues)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <label className="inline-flex items-center gap-2 px-3 min-h-10 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={includePending}
                onChange={(e) => setIncludePending(e.target.checked)}
                className="accent-emerald-600"
              />
              Incluir pendentes/planejados
            </label>

            <button
              type="button"
              onClick={handleExportExcel}
              className="px-4 min-h-10 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download size={14} /> Exportar Excel (.xlsx)
            </button>
          </div>
        </div>
      </div>

      {exportStatus && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 size={15} className="shrink-0" />
          <span>{exportStatus}</span>
        </div>
      )}

      {entityAccounts.length === 0 ? (
        <div className="sf-card p-8 text-center space-y-2">
          <p className="font-display text-sm font-bold text-[#0F172A] dark:text-white">
            Nenhuma conta {entityId} cadastrada.
          </p>
          <p className="text-xs text-[#64748B] dark:text-slate-400">
            Cadastre uma conta na aba <strong>Contas</strong> com vínculo {entityId} para utilizar o Livro Caixa e o Calendário Financeiro.
          </p>
        </div>
      ) : viewMode === 'DAILY' ? (
        <InteractiveFinanceCalendar
          accounts={accounts}
          transactions={transactions}
          entityId={entityId}
          selectedAccountId={selectedAccountId}
          includePending={includePending}
          year={year}
          month={month}
          selectedDate={selectedDate}
          onChangeMonthYear={handleChangeMonthYear}
          onSelectDate={setSelectedDate}
          onAddMovement={(dateStr, mode) => {
            setSelectedDate(dateStr);
            setEditingTx(null);
            setModalMode(mode);
            setModalOpen(true);
          }}
          onEditTransaction={(tx) => {
            setEditingTx(tx);
            setModalMode(tx.direction === 'INCOME' ? 'INCOME' : 'EXPENSE');
            setModalOpen(true);
          }}
          onDeleteTransaction={onDeleteTransaction}
          onRestoreTransaction={onRestoreTransaction}
        />
      ) : (
        <CashBookSpreadsheetViews
          mode={viewMode}
          accounts={accounts}
          transactions={transactions}
          entityId={entityId}
          selectedAccountId={selectedAccountId}
          includePending={includePending}
          year={year}
          month={month}
          onChangeMonthYear={handleChangeMonthYear}
          onDrillToMonth={handleDrillToMonth}
          onEditTransaction={(tx) => {
            setEditingTx(tx);
            setModalMode(tx.direction === 'INCOME' ? 'INCOME' : 'EXPENSE');
            setModalOpen(true);
          }}
          onDeleteTransaction={onDeleteTransaction}
          onRestoreTransaction={onRestoreTransaction}
        />
      )}

      <CashBookDateModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingTx(null);
        }}
        accounts={accounts}
        defaultEntityId={entityId}
        defaultAccountId={selectedAccountId}
        defaultDate={selectedDate}
        defaultMode={modalMode}
        editingTransaction={editingTx}
        onSaveTransaction={onSaveTransaction}
        onExecuteTransfer={onExecuteTransfer}
        onDeleteTransaction={onDeleteTransaction}
        onRestoreTransaction={onRestoreTransaction}
      />
    </div>
  );
};
