import React, { useEffect, useMemo, useState } from 'react';
import {
  Account,
  CategoryRule,
  CreditCard as CreditCardType,
  Transaction,
} from '../types';
import { addMoney, fromCents, parseMoneyInput, subtractMoney, toCents } from '../domain/money/money';
import { todayLocal } from '../utils/dateUtils';
import { formatarValor } from '../utils/formatters';
import { usePrivacy } from '../contexts/PrivacyContext';
import { resolveBankIdentity } from '../domain/extractions/banksRepository';
import { BankLogo } from './BankLogo';
import { InstitutionSelectorDrawer } from './InstitutionSelectorDrawer';
import { Sheet } from './Sheet';
import { MoneyInputField } from './MoneyInputField';
import { CreditCardAnalytics } from './finance/CreditCardAnalytics';
import { CardFinancialCalendar } from './cards/CardFinancialCalendar';
import { CardSpreadsheetViews } from './cards/CardSpreadsheetViews';
import { CardSpreadsheetImportTab } from './cards/CardSpreadsheetImportTab';
import { CardEntryModal } from './cards/CardEntryModal';
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  Calendar as CalendarIcon,
  CalendarDays,
  CheckCircle2,
  Clock,
  CreditCard,
  FileSpreadsheet,
  Plus,
  ReceiptText,
  Settings,
  ShieldAlert,
  Trash2,
  Upload,
} from 'lucide-react';

type CardWorkspaceTab =
  | 'CALENDAR'
  | 'DAILY'
  | 'ANNUAL'
  | 'SPREADSHEET'
  | 'IMPORT'
  | 'ANALYTICS';

interface CardsViewProps {
  cards: CreditCardType[];
  accounts: Account[];
  transactions?: Transaction[];
  categoryRules?: CategoryRule[];
  selectedCardId?: string | null;
  onClearSelectedCard?: () => void;
  onAddCard: (card: Omit<CreditCardType, 'id'>) => void;
  onUpdateCard?: (cardId: string, updates: Partial<Omit<CreditCardType, 'id'>>) => void;
  onPayCardInvoice: (cardId: string, accountId?: string, paidAmount?: number) => void;
  onUpdateCardInvoice?: (cardId: string, amount: number, mode: 'add' | 'set') => void;
  onDeleteCard: (id: string) => void;
  onSaveTransaction?: (txData: Omit<Transaction, 'id'>, editId?: string) => void;
  onSaveTransactionBatch?: (batch: Transaction[]) => void;
  onDeleteTransaction?: (id: string) => void;
  onCommitCardImport?: (
    items: Omit<Transaction, 'id'>[],
    meta: { fileName: string; batchFingerprint: string; cardId: string }
  ) => { acceptedCount: number; skippedDuplicatesCount: number };
  onEditTransaction?: (tx: Transaction) => void;
  onRegisterPurchase?: (card: CreditCardType) => void;
}

export const CardsView: React.FC<CardsViewProps> = ({
  cards,
  accounts,
  transactions = [],
  categoryRules = [],
  selectedCardId = null,
  onClearSelectedCard,
  onAddCard,
  onUpdateCard,
  onPayCardInvoice,
  onUpdateCardInvoice,
  onDeleteCard,
  onSaveTransaction,
  onSaveTransactionBatch,
  onDeleteTransaction,
  onCommitCardImport,
  onEditTransaction,
  onRegisterPurchase,
}) => {
  const { hideValues } = usePrivacy();
  const [modalOpen, setModalOpen] = useState(false);
  const [activeCardId, setActiveCardId] = useState<string | null>(selectedCardId);
  const [workspaceTab, setWorkspaceTab] = useState<CardWorkspaceTab>('CALENDAR');

  // Independent calendar navigation state per workspace session
  const today = todayLocal();
  const [calYear, setCalYear] = useState<number>(() => Number(today.slice(0, 4)));
  const [calMonth, setCalMonth] = useState<number>(() => Number(today.slice(5, 7)));
  const [selectedDate, setSelectedDate] = useState<string>(today);

  // Card Entry Modal (Add/Edit/Installment/Fee/Reversal/Payment)
  const [entryModalOpen, setEntryModalOpen] = useState(false);
  const [entryInitialDate, setEntryInitialDate] = useState(today);
  const [editingCardTx, setEditingCardTx] = useState<Transaction | null>(null);

  // Edit Card Cycle & Settings Modal (always prompts confirmation before updating)
  const [editingCardSettings, setEditingCardSettings] = useState<CreditCardType | null>(null);
  const [editCardName, setEditCardName] = useState('');
  const [editClosingDay, setEditClosingDay] = useState('10');
  const [editDueDay, setEditDueDay] = useState('17');
  const [editLimitStr, setEditLimitStr] = useState('');
  const [editLinkedAccountId, setEditLinkedAccountId] = useState('');
  const [awaitingCardUpdateConfirm, setAwaitingCardUpdateConfirm] = useState(false);
  const [editCardError, setEditCardError] = useState('');

  // Pay Invoice / Adjust Invoice Modals
  const [payModalCard, setPayModalCard] = useState<CreditCardType | null>(null);
  const [paymentAccountId, setPaymentAccountId] = useState('');
  const [paymentAmountStr, setPaymentAmountStr] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const [awaitingPayConfirm, setAwaitingPayConfirm] = useState(false);

  const [chargeModalCard, setChargeModalCard] = useState<CreditCardType | null>(null);
  const [chargeMode, setChargeMode] = useState<'add' | 'set'>('add');
  const [chargeAmountStr, setChargeAmountStr] = useState('');
  const [chargeError, setChargeError] = useState('');
  const [awaitingChargeConfirm, setAwaitingChargeConfirm] = useState(false);

  // Add Card form state
  const [cardName, setCardName] = useState('');
  const [institutionName, setInstitutionName] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | undefined>(undefined);
  const [last4, setLast4] = useState('');
  const [entityId, setEntityId] = useState<'CPF' | 'CNPJ'>('CPF');
  const [limitStr, setLimitStr] = useState('');
  const [invoiceStr, setInvoiceStr] = useState('0,00');
  const [closingDay, setClosingDay] = useState('10');
  const [dueDay, setDueDay] = useState('17');
  const [linkedAccountId, setLinkedAccountId] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (selectedCardId) {
      setActiveCardId(selectedCardId);
    }
  }, [selectedCardId]);

  const activeCard = useMemo(
    () => (activeCardId ? cards.find((c) => c.id === activeCardId) || null : null),
    [cards, activeCardId]
  );

  const activeAccounts = useMemo(
    () => accounts.filter((a) => !a.archived),
    [accounts]
  );

  const handleSubmitNewCard = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    let limitCents;
    let invoiceCents;
    try {
      limitCents = parseMoneyInput(limitStr);
    } catch {
      setErrorMsg('Informe um limite válido maior que zero.');
      return;
    }
    try {
      invoiceCents = invoiceStr.trim() ? parseMoneyInput(invoiceStr) : toCents(0);
    } catch {
      setErrorMsg('Informe um valor de fatura válido.');
      return;
    }
    const cleanLast4 = last4.replace(/\D/g, '').slice(0, 4);
    const cDay = Number(closingDay);
    const dDay = Number(dueDay);

    if (!cardName.trim() || !institutionName.trim()) {
      setErrorMsg('Informe o nome e a instituição do cartão.');
      return;
    }
    if (cleanLast4.length !== 4) {
      setErrorMsg('Informe exatamente os 4 últimos dígitos do cartão (nunca o número completo).');
      return;
    }
    if (limitCents <= 0) {
      setErrorMsg('Informe um limite válido maior que zero.');
      return;
    }
    if (cDay < 1 || cDay > 31 || dDay < 1 || dDay > 31) {
      setErrorMsg('Dias de fechamento e vencimento devem estar entre 1 e 31.');
      return;
    }

    const identity = resolveBankIdentity(institutionName.trim(), bankCode || undefined);
    onAddCard({
      entityId,
      institutionName: institutionName.trim(),
      bankCode: bankCode || identity.codigo || undefined,
      logoUrl,
      linkedAccountId: linkedAccountId || undefined,
      cardName: cardName.trim(),
      last4: cleanLast4,
      limit: fromCents(limitCents),
      closingDay: cDay,
      dueDay: dDay,
      currentInvoiceAmount: fromCents(invoiceCents),
      status: invoiceCents > 0 ? 'OPEN' : 'PAID',
    });

    setCardName('');
    setInstitutionName('');
    setBankCode('');
    setLogoUrl(undefined);
    setLast4('');
    setLimitStr('');
    setInvoiceStr('0,00');
    setLinkedAccountId('');
    setModalOpen(false);
  };

  const openPayModal = (card: CreditCardType) => {
    const preferred =
      activeAccounts.find((a) => a.id === card.linkedAccountId) ||
      activeAccounts.find((a) => a.entityId === card.entityId) ||
      activeAccounts[0];
    setPaymentAccountId(preferred?.id || '');
    setPaymentAmountStr(card.currentInvoiceAmount.toFixed(2).replace('.', ','));
    setPaymentError('');
    setAwaitingPayConfirm(false);
    setPayModalCard(card);
  };

  const confirmPayInvoice = () => {
    if (!payModalCard) return;
    setPaymentError('');
    let paidCents;
    try {
      paidCents = parseMoneyInput(paymentAmountStr);
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Informe um valor válido.');
      return;
    }
    if (paidCents <= 0) {
      setPaymentError('Informe um valor maior que zero.');
      return;
    }
    if (!awaitingPayConfirm) {
      setAwaitingPayConfirm(true);
      return;
    }
    onPayCardInvoice(payModalCard.id, paymentAccountId || undefined, fromCents(paidCents));
    setPayModalCard(null);
    setAwaitingPayConfirm(false);
  };

  const openChargeModal = (card: CreditCardType) => {
    setChargeMode('add');
    setChargeAmountStr('');
    setChargeError('');
    setAwaitingChargeConfirm(false);
    setChargeModalCard(card);
  };

  const confirmUpdateInvoice = () => {
    if (!chargeModalCard || !onUpdateCardInvoice) return;
    setChargeError('');
    let amountCents;
    try {
      amountCents = parseMoneyInput(chargeAmountStr);
    } catch (err) {
      setChargeError(err instanceof Error ? err.message : 'Informe um valor válido.');
      return;
    }
    if (chargeMode === 'add' && amountCents <= 0) {
      setChargeError('Informe um valor maior que zero para lançar na fatura.');
      return;
    }
    if (amountCents < 0) {
      setChargeError('O valor da fatura não pode ser negativo.');
      return;
    }
    if (!awaitingChargeConfirm) {
      setAwaitingChargeConfirm(true);
      return;
    }
    onUpdateCardInvoice(chargeModalCard.id, fromCents(amountCents), chargeMode);
    setChargeModalCard(null);
    setAwaitingChargeConfirm(false);
  };

  const openEditCardSettings = (card: CreditCardType) => {
    setEditingCardSettings(card);
    setEditCardName(card.cardName);
    setEditClosingDay(String(card.closingDay));
    setEditDueDay(String(card.dueDay));
    setEditLimitStr(card.limit.toFixed(2).replace('.', ','));
    setEditLinkedAccountId(card.linkedAccountId || '');
    setEditCardError('');
    setAwaitingCardUpdateConfirm(false);
  };

  const submitEditCardSettings = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCardSettings || !onUpdateCard) return;
    setEditCardError('');

    let limitCents;
    try {
      limitCents = parseMoneyInput(editLimitStr);
    } catch {
      setEditCardError('Informe um limite válido.');
      return;
    }
    const cDay = Number(editClosingDay);
    const dDay = Number(editDueDay);
    if (!editCardName.trim()) {
      setEditCardError('Informe o nome do cartão.');
      return;
    }
    if (limitCents <= 0 || cDay < 1 || cDay > 31 || dDay < 1 || dDay > 31) {
      setEditCardError('Verifique limite e dias de fechamento/vencimento (1 a 31).');
      return;
    }

    if (!awaitingCardUpdateConfirm) {
      setAwaitingCardUpdateConfirm(true);
      return;
    }

    onUpdateCard(editingCardSettings.id, {
      cardName: editCardName.trim(),
      closingDay: cDay,
      dueDay: dDay,
      limit: fromCents(limitCents),
      linkedAccountId: editLinkedAccountId || undefined,
    });
    setEditingCardSettings(null);
    setAwaitingCardUpdateConfirm(false);
  };

  const handleOpenCardWorkspace = (card: CreditCardType, tab: CardWorkspaceTab = 'CALENDAR') => {
    setActiveCardId(card.id);
    setWorkspaceTab(tab);
  };

  const handleOpenAddEntryForDate = (date: string) => {
    if (onSaveTransaction && onSaveTransactionBatch) {
      setEditingCardTx(null);
      setEntryInitialDate(date);
      setEntryModalOpen(true);
    } else if (activeCard && onRegisterPurchase) {
      onRegisterPurchase(activeCard);
    }
  };

  const handleOpenEditEntry = (tx: Transaction) => {
    if (onSaveTransaction) {
      setEditingCardTx(tx);
      setEntryInitialDate(tx.date);
      setEntryModalOpen(true);
    } else {
      onEditTransaction?.(tx);
    }
  };

  const handleDeleteOrReverseEntry = (tx: Transaction) => {
    if (onDeleteTransaction) {
      onDeleteTransaction(tx.id);
    }
  };

  const handleChangeMonthYear = (nextYear: number, nextMonth: number) => {
    setCalYear(nextYear);
    setCalMonth(nextMonth);
    const ym = `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
    if (!selectedDate.startsWith(ym)) {
      setSelectedDate(`${ym}-01`);
    }
  };

  const workspaceTabs: Array<{ key: CardWorkspaceTab; label: string; icon: React.ReactNode }> = [
    { key: 'CALENDAR', label: 'Calendário', icon: <CalendarIcon size={14} /> },
    { key: 'DAILY', label: 'Diário', icon: <Clock size={14} /> },
    { key: 'ANNUAL', label: 'Anual', icon: <CalendarDays size={14} /> },
    { key: 'SPREADSHEET', label: 'Planilha', icon: <FileSpreadsheet size={14} /> },
    { key: 'IMPORT', label: 'Importar', icon: <Upload size={14} /> },
    { key: 'ANALYTICS', label: 'Análise', icon: <BarChart3 size={14} /> },
  ];

  return (
    <div className="space-y-5 animate-fadeIn min-w-0">
      {activeCard ? (
        /* Dedicated Independent Per-Card Spreadsheet & Financial Calendar Workspace */
        <div className="space-y-4 min-w-0">
          {/* Top Bar */}
          <div className="sf-card p-3.5 sm:p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    setActiveCardId(null);
                    onClearSelectedCard?.();
                  }}
                  className="min-h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-[#0F172A] dark:text-white flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <ArrowLeft size={14} /> Cartões
                </button>
                <BankLogo
                  bankName={activeCard.institutionName}
                  bankCode={activeCard.bankCode}
                  logoUrl={activeCard.logoUrl}
                  size={40}
                />
                <div className="min-w-0">
                  <h2 className="font-display text-base sm:text-lg font-extrabold text-[#0F172A] dark:text-white truncate">
                    {activeCard.cardName} · •••• {activeCard.last4}
                  </h2>
                  <p className="text-[11px] text-[#64748B] dark:text-slate-400 truncate">
                    {activeCard.institutionName} ({activeCard.entityId}) · Fecha dia{' '}
                    {activeCard.closingDay} · Vence dia {activeCard.dueDay}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {cards.length > 1 && (
                  <select
                    value={activeCard.id}
                    onChange={(e) => setActiveCardId(e.target.value)}
                    aria-label="Trocar cartão de crédito"
                    className="min-h-10 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-[#0F172A] dark:text-white max-w-[190px]"
                  >
                    {cards.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.institutionName} · {c.cardName} ({c.last4})
                      </option>
                    ))}
                  </select>
                )}

                {onUpdateCard && (
                  <button
                    type="button"
                    onClick={() => openEditCardSettings(activeCard)}
                    className="min-h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-[#0F172A] dark:text-white flex items-center gap-1 cursor-pointer"
                    title="Configurar fechamento, vencimento e limite"
                  >
                    <Settings size={14} /> Ciclo
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => handleOpenAddEntryForDate(selectedDate)}
                  className="min-h-10 px-3.5 rounded-xl bg-[#061E3E] hover:bg-[#0F172A] dark:bg-[#059669] dark:hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus size={14} /> Novo lançamento
                </button>
              </div>
            </div>

            {/* Sub-Tabs (Wrap cleanly on mobile, zero horizontal overflow) */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
              {workspaceTabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setWorkspaceTab(t.key)}
                  className={`min-h-10 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    workspaceTab === t.key
                      ? 'bg-[#061E3E] text-white dark:bg-[#059669]'
                      : 'bg-slate-50 dark:bg-slate-800/70 text-[#64748B] dark:text-slate-300 hover:text-[#0F172A] dark:hover:text-white'
                  }`}
                >
                  {t.icon}
                  <span className="truncate">{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {workspaceTab === 'CALENDAR' && (
            <CardFinancialCalendar
              card={activeCard}
              transactions={transactions}
              year={calYear}
              month={calMonth}
              selectedDate={selectedDate}
              onChangeMonthYear={handleChangeMonthYear}
              onSelectDate={(d) => setSelectedDate(d)}
              onAddEntryForDate={handleOpenAddEntryForDate}
              onEditEntry={handleOpenEditEntry}
              onDeleteEntry={handleDeleteOrReverseEntry}
            />
          )}

          {workspaceTab === 'DAILY' && (
            <CardSpreadsheetViews
              mode="DAILY"
              card={activeCard}
              transactions={transactions}
              year={calYear}
              selectedDate={selectedDate}
              onSelectDate={(d) => {
                setSelectedDate(d);
                setCalYear(Number(d.slice(0, 4)) || calYear);
                setCalMonth(Number(d.slice(5, 7)) || calMonth);
              }}
              onChangeYear={setCalYear}
              onDrillToMonth={(y, m) => {
                handleChangeMonthYear(y, m);
                setWorkspaceTab('CALENDAR');
              }}
              onAddEntryForDate={handleOpenAddEntryForDate}
              onEditEntry={handleOpenEditEntry}
              onDeleteEntry={handleDeleteOrReverseEntry}
            />
          )}

          {workspaceTab === 'ANNUAL' && (
            <CardSpreadsheetViews
              mode="ANNUAL"
              card={activeCard}
              transactions={transactions}
              year={calYear}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              onChangeYear={setCalYear}
              onDrillToMonth={(y, m) => {
                handleChangeMonthYear(y, m);
                setWorkspaceTab('CALENDAR');
              }}
              onAddEntryForDate={handleOpenAddEntryForDate}
              onEditEntry={handleOpenEditEntry}
              onDeleteEntry={handleDeleteOrReverseEntry}
            />
          )}

          {workspaceTab === 'SPREADSHEET' && (
            <CardSpreadsheetViews
              mode="TABLE"
              card={activeCard}
              transactions={transactions}
              year={calYear}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              onChangeYear={setCalYear}
              onDrillToMonth={(y, m) => {
                handleChangeMonthYear(y, m);
                setWorkspaceTab('CALENDAR');
              }}
              onAddEntryForDate={handleOpenAddEntryForDate}
              onEditEntry={handleOpenEditEntry}
              onDeleteEntry={handleDeleteOrReverseEntry}
            />
          )}

          {workspaceTab === 'IMPORT' && (
            <CardSpreadsheetImportTab
              card={activeCard}
              transactions={transactions}
              categoryRules={categoryRules}
              onCommitCardImport={(items, meta) => {
                if (onCommitCardImport) {
                  return onCommitCardImport(items, meta);
                }
                if (onSaveTransactionBatch) {
                  const full = items.map((item, i) => ({
                    ...item,
                    id: `tr-card-imp-${Date.now()}-${i}`,
                  })) as Transaction[];
                  onSaveTransactionBatch(full);
                  return { acceptedCount: full.length, skippedDuplicatesCount: 0 };
                }
                return { acceptedCount: 0, skippedDuplicatesCount: 0 };
              }}
            />
          )}

          {workspaceTab === 'ANALYTICS' && (
            <CreditCardAnalytics
              card={activeCard}
              transactions={transactions}
              onBack={() => setWorkspaceTab('CALENDAR')}
              onPayInvoice={(card) => openPayModal(card)}
              onEditTransaction={handleOpenEditEntry}
              onRegisterPurchase={(card) => handleOpenAddEntryForDate(selectedDate || today)}
            />
          )}

          {onSaveTransaction && onSaveTransactionBatch && (
            <CardEntryModal
              open={entryModalOpen}
              card={activeCard}
              accounts={accounts}
              initialDate={entryInitialDate}
              editingTransaction={editingCardTx}
              onClose={() => {
                setEntryModalOpen(false);
                setEditingCardTx(null);
              }}
              onSaveSingle={onSaveTransaction}
              onSaveInstallments={onSaveTransactionBatch}
              onPayCardInvoice={onPayCardInvoice}
            />
          )}
        </div>
      ) : (
        /* Credit Cards Portfolio Overview */
        <>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-xl sm:text-2xl font-bold text-[#0F172A] dark:text-white">
                Cartões de Crédito
              </h2>
              <p className="font-sans text-xs sm:text-sm text-[#64748B] dark:text-slate-400">
                Cada cartão possui planilha própria, calendário independente, parcelamentos e ciclo de fechamento.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setErrorMsg('');
                setModalOpen(true);
              }}
              className="bg-[#061E3E] hover:bg-[#0F172A] dark:bg-[#059669] dark:hover:bg-emerald-700 text-white px-4 min-h-11 rounded-xl text-xs sm:text-sm font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Novo cartão
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {cards.map((card) => {
              const limitCents = toCents(card.limit);
              const invoiceCents = toCents(card.currentInvoiceAmount);
              const available = Math.max(0, fromCents(subtractMoney(limitCents, invoiceCents)));
              const usagePct =
                limitCents > 0 ? Math.min(100, Math.round((invoiceCents / limitCents) * 100)) : 0;

              return (
                <div
                  key={card.id}
                  className="sf-card p-5 flex flex-col justify-between min-w-0"
                >
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2.5">
                        <BankLogo
                          bankName={card.institutionName}
                          bankCode={card.bankCode}
                          logoUrl={card.logoUrl}
                          size={42}
                        />
                        <span className="sf-icon-badge !w-8 !h-8 !rounded-lg">
                          <CreditCard size={16} strokeWidth={2} />
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                            card.entityId === 'CPF'
                              ? 'bg-[#ECFDF5] text-[#059669] dark:bg-emerald-950/60 dark:text-[#10B981]'
                              : 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                          }`}
                        >
                          {card.entityId}
                        </span>
                        {onUpdateCard && (
                          <button
                            type="button"
                            onClick={() => openEditCardSettings(card)}
                            className="p-1.5 text-slate-400 hover:text-[#0F172A] dark:hover:text-white cursor-pointer"
                            aria-label={`Editar ciclo do ${card.cardName}`}
                          >
                            <Settings size={15} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onDeleteCard(card.id)}
                          className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                          aria-label={`Remover ${card.cardName}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleOpenCardWorkspace(card, 'CALENDAR')}
                      className="text-left w-full group cursor-pointer"
                    >
                      <h3 className="font-display text-base font-bold text-[#0F172A] dark:text-white group-hover:text-[#059669] transition-colors truncate">
                        {card.cardName}
                      </h3>
                      <p className="text-xs text-[#64748B] mb-4 truncate">
                        Final ···· {card.last4} ({card.institutionName})
                      </p>
                    </button>

                    <div className="space-y-2 text-xs py-3 border-y border-slate-100 dark:border-slate-800">
                      <div className="flex justify-between">
                        <span className="text-[#64748B] dark:text-slate-400">Limite total:</span>
                        <span className="font-money font-bold text-[#0F172A] dark:text-slate-200">
                          {formatarValor(card.limit, hideValues)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#64748B] dark:text-slate-400">Disponível:</span>
                        <span className="font-money font-bold text-[#059669] dark:text-[#10B981]">
                          {formatarValor(available, hideValues)}
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${usagePct > 80 ? 'bg-red-500' : 'bg-[#059669]'}`}
                          style={{ width: `${usagePct}%` }}
                        />
                      </div>
                      <div className="flex justify-between pt-1">
                        <span className="text-[#64748B] dark:text-slate-400">
                          Fechamento / Vencimento:
                        </span>
                        <span className="font-semibold text-[#0F172A] dark:text-slate-300">
                          Dia {card.closingDay} / Dia {card.dueDay}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <small className="text-[11px] text-slate-400 block">
                          {card.status === 'PAID' ? 'Fatura quitada' : 'Fatura atual em aberto'}
                        </small>
                        <span
                          className={`font-money text-base font-extrabold ${
                            card.currentInvoiceAmount > 0
                              ? 'text-red-700 dark:text-red-400'
                              : 'text-[#059669] dark:text-[#10B981]'
                          }`}
                        >
                          {formatarValor(card.currentInvoiceAmount, hideValues)}
                        </span>
                      </div>
                      {card.currentInvoiceAmount > 0 && (
                        <button
                          type="button"
                          onClick={() => openPayModal(card)}
                          className="px-3.5 min-h-10 bg-[#061E3E] dark:bg-[#059669] text-white rounded-xl text-xs font-semibold hover:bg-[#0F172A] dark:hover:bg-emerald-700 transition-colors cursor-pointer"
                        >
                          Pagar Fatura
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleOpenCardWorkspace(card, 'CALENDAR')}
                        className="min-h-10 px-2 rounded-xl bg-[#F8FAFC] dark:bg-white/10 border border-[#E2E8F0] dark:border-white/15 text-[#0F172A] dark:text-white text-[11px] font-bold flex items-center justify-center gap-1 hover:border-[#059669] cursor-pointer"
                      >
                        <CalendarIcon size={13} /> Calendário
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenCardWorkspace(card, 'SPREADSHEET')}
                        className="min-h-10 px-2 rounded-xl bg-[#F8FAFC] dark:bg-white/10 border border-[#E2E8F0] dark:border-white/15 text-[#0F172A] dark:text-white text-[11px] font-bold flex items-center justify-center gap-1 hover:border-[#059669] cursor-pointer"
                      >
                        <FileSpreadsheet size={13} /> Planilha
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenCardWorkspace(card, 'IMPORT')}
                        className="min-h-10 px-2 rounded-xl bg-[#ECFDF5] dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-[#059669] dark:text-[#10B981] text-[11px] font-bold flex items-center justify-center gap-1 hover:border-[#059669] cursor-pointer"
                      >
                        <Upload size={13} /> Fatura
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleOpenCardWorkspace(card, 'ANALYTICS')}
                        className="flex-1 min-h-9 px-2 rounded-xl border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-600 dark:text-slate-300 flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <BarChart3 size={13} /> Análise
                      </button>
                      {onUpdateCardInvoice && (
                        <button
                          type="button"
                          onClick={() => openChargeModal(card)}
                          className="flex-1 min-h-9 px-2 rounded-xl border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-600 dark:text-slate-300 flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <ReceiptText size={13} /> Ajustar Fatura
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Add Card Sheet */}
      <Sheet
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Novo cartão"
        subtitle="Armazenamos apenas os 4 últimos dígitos"
      >
        <form onSubmit={handleSubmitNewCard} className="space-y-4">
          {errorMsg && (
            <div className="p-3 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle size={16} /> {errorMsg}
            </div>
          )}

          <InstitutionSelectorDrawer
            selectedName={institutionName}
            onSelect={(inst) => {
              setInstitutionName(inst.nome);
              setBankCode(inst.codigo || '');
              setLogoUrl(undefined);
              setErrorMsg('');
            }}
            defaultOpen={false}
            title="Selecionar Banco Emissor"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              required
              placeholder="Nome do cartão (ex.: Inter Black)"
              value={cardName}
              onChange={(e) => setCardName(e.target.value)}
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
            />
            <div className="flex items-center gap-2">
              {institutionName.trim() && (
                <BankLogo
                  bankName={institutionName}
                  bankCode={bankCode || undefined}
                  logoUrl={logoUrl}
                  size={38}
                />
              )}
              <input
                type="text"
                required
                placeholder="Instituição (ex.: Banco Inter)"
                value={institutionName}
                onChange={(e) => {
                  setInstitutionName(e.target.value);
                  setBankCode('');
                  setLogoUrl(undefined);
                }}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                4 últimos dígitos
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                required
                placeholder="Ex.: 4821"
                value={last4}
                onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Vínculo
              </label>
              <select
                value={entityId}
                onChange={(e) => setEntityId(e.target.value as 'CPF' | 'CNPJ')}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
              >
                <option value="CPF">CPF</option>
                <option value="CNPJ">CNPJ</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
              Conta padrão para pagamento da fatura (opcional)
            </label>
            <select
              value={linkedAccountId}
              onChange={(e) => setLinkedAccountId(e.target.value)}
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
            >
              <option value="">Selecionar ao pagar</option>
              {activeAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.institutionName} · {a.accountName} ({a.entityId})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <MoneyInputField
              label="Limite total (R$)"
              required
              placeholder="8000,00"
              value={limitStr}
              onChange={setLimitStr}
            />
            <MoneyInputField
              label="Fatura atual (R$)"
              allowZero
              value={invoiceStr}
              onChange={setInvoiceStr}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Dia fechamento
              </label>
              <input
                type="number"
                min={1}
                max={31}
                value={closingDay}
                onChange={(e) => setClosingDay(e.target.value)}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Dia vencimento
              </label>
              <input
                type="number"
                min={1}
                max={31}
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="flex-1 min-h-12 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-[1.5] min-h-12 bg-[#061E3E] hover:bg-[#0F172A] dark:bg-[#059669] dark:hover:bg-emerald-700 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
            >
              <CheckCircle2 size={16} /> Salvar cartão
            </button>
          </div>
        </form>
      </Sheet>

      {/* Edit Card Cycle & Config Sheet (Mandatory Confirmation Prompt) */}
      <Sheet
        open={Boolean(editingCardSettings)}
        onClose={() => setEditingCardSettings(null)}
        title={editingCardSettings ? `Configurar ciclo · ${editingCardSettings.cardName}` : 'Ciclo'}
        subtitle="Altere fechamento, vencimento ou limite com confirmação"
      >
        {editingCardSettings && (
          <form onSubmit={submitEditCardSettings} className="space-y-4">
            {editCardError && (
              <div className="p-3 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle size={15} /> {editCardError}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Nome do cartão
              </label>
              <input
                type="text"
                value={editCardName}
                onChange={(e) => {
                  setEditCardName(e.target.value);
                  setAwaitingCardUpdateConfirm(false);
                }}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
              />
            </div>

            <MoneyInputField
              label="Limite total (R$)"
              required
              value={editLimitStr}
              onChange={(v) => {
                setEditLimitStr(v);
                setAwaitingCardUpdateConfirm(false);
              }}
            />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Dia fechamento
                </label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={editClosingDay}
                  onChange={(e) => {
                    setEditClosingDay(e.target.value);
                    setAwaitingCardUpdateConfirm(false);
                  }}
                  className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Dia vencimento
                </label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={editDueDay}
                  onChange={(e) => {
                    setEditDueDay(e.target.value);
                    setAwaitingCardUpdateConfirm(false);
                  }}
                  className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Conta vinculada ao pagamento
              </label>
              <select
                value={editLinkedAccountId}
                onChange={(e) => {
                  setEditLinkedAccountId(e.target.value);
                  setAwaitingCardUpdateConfirm(false);
                }}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
              >
                <option value="">Sem vínculo fixo</option>
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.institutionName} · {a.accountName} ({a.entityId})
                  </option>
                ))}
              </select>
            </div>

            {awaitingCardUpdateConfirm ? (
              <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 space-y-2">
                <div className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200 font-semibold">
                  <ShieldAlert size={16} className="shrink-0 mt-0.5" />
                  <span>
                    Confirmar atualização das configurações e ciclo de fechamento/vencimento de {editingCardSettings.cardName}?
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAwaitingCardUpdateConfirm(false)}
                    className="flex-1 min-h-10 rounded-xl border border-amber-300 dark:border-amber-700 text-xs font-semibold text-amber-900 dark:text-amber-200 cursor-pointer"
                  >
                    Revisar
                  </button>
                  <button
                    type="submit"
                    className="flex-[1.5] min-h-10 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                  >
                    Sim, confirmar atualização
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setEditingCardSettings(null)}
                  className="flex-1 min-h-12 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-[1.5] min-h-12 bg-[#061E3E] hover:bg-[#0F172A] dark:bg-[#059669] text-white rounded-xl text-sm font-bold cursor-pointer"
                >
                  Revisar alteração
                </button>
              </div>
            )}
          </form>
        )}
      </Sheet>

      {/* Pay Invoice Sheet */}
      <Sheet
        open={Boolean(payModalCard)}
        onClose={() => setPayModalCard(null)}
        title={payModalCard ? `Pagar fatura · ${payModalCard.cardName}` : 'Pagar fatura'}
      >
        {payModalCard && (
          <div className="space-y-4">
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 text-sm">
              Valor da fatura:{' '}
              <strong className="font-money text-red-700 dark:text-red-400">
                {formatarValor(payModalCard.currentInvoiceAmount, hideValues)}
              </strong>
            </div>

            {paymentError && (
              <div className="p-3 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle size={16} /> {paymentError}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Valor do pagamento (R$)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={paymentAmountStr}
                onChange={(e) => {
                  setPaymentAmountStr(e.target.value);
                  setAwaitingPayConfirm(false);
                }}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Debitar pagamento da conta:
              </label>
              <select
                value={paymentAccountId}
                onChange={(e) => {
                  setPaymentAccountId(e.target.value);
                  setAwaitingPayConfirm(false);
                }}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
              >
                <option value="">Apenas abater fatura</option>
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.institutionName} · {a.accountName} ({a.entityId})
                  </option>
                ))}
              </select>
            </div>

            {awaitingPayConfirm ? (
              <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 space-y-2">
                <div className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200 font-semibold">
                  <ShieldAlert size={16} className="shrink-0 mt-0.5" />
                  <span>
                    Confirmar o pagamento de R$ {paymentAmountStr} na fatura de {payModalCard.cardName}?
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAwaitingPayConfirm(false)}
                    className="flex-1 min-h-10 rounded-xl border border-amber-300 text-xs font-semibold text-amber-900 dark:text-amber-200 cursor-pointer"
                  >
                    Revisar
                  </button>
                  <button
                    type="button"
                    onClick={confirmPayInvoice}
                    className="flex-[1.5] min-h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                  >
                    Sim, confirmar pagamento
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPayModalCard(null)}
                  className="flex-1 min-h-12 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmPayInvoice}
                  className="flex-[1.5] min-h-12 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold cursor-pointer"
                >
                  Revisar pagamento
                </button>
              </div>
            )}
          </div>
        )}
      </Sheet>

      {/* Charge / Adjust Invoice Sheet */}
      <Sheet
        open={Boolean(chargeModalCard)}
        onClose={() => setChargeModalCard(null)}
        title={chargeModalCard ? `Atualizar fatura · ${chargeModalCard.cardName}` : 'Atualizar fatura'}
        subtitle="Soma novas compras ou ajusta o total fechado sem alterar saldo bancário até o pagamento."
      >
        {chargeModalCard && (
          <div className="space-y-4">
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 text-sm flex justify-between items-center">
              <span className="text-slate-600 dark:text-slate-300">Fatura atual:</span>
              <strong className="font-money text-[#0F172A] dark:text-white">
                {formatarValor(chargeModalCard.currentInvoiceAmount, hideValues)}
              </strong>
            </div>

            {chargeError && (
              <div className="p-3 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle size={16} /> {chargeError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setChargeMode('add');
                  setChargeAmountStr('');
                  setChargeError('');
                  setAwaitingChargeConfirm(false);
                }}
                className={`min-h-11 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  chargeMode === 'add'
                    ? 'bg-[#061E3E] text-white border-[#061E3E] dark:bg-[#059669] dark:border-[#059669]'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                Somar compra (+)
              </button>
              <button
                type="button"
                onClick={() => {
                  setChargeMode('set');
                  setChargeAmountStr(chargeModalCard.currentInvoiceAmount.toFixed(2).replace('.', ','));
                  setChargeError('');
                  setAwaitingChargeConfirm(false);
                }}
                className={`min-h-11 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  chargeMode === 'set'
                    ? 'bg-[#061E3E] text-white border-[#061E3E] dark:bg-[#059669] dark:border-[#059669]'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                Definir valor total
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                {chargeMode === 'add' ? 'Valor da compra/lançamento (R$)' : 'Novo valor da fatura (R$)'}
              </label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={chargeAmountStr}
                onChange={(e) => {
                  setChargeAmountStr(e.target.value);
                  setChargeError('');
                  setAwaitingChargeConfirm(false);
                }}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
              />
              {(() => {
                try {
                  const parsedCents = parseMoneyInput(chargeAmountStr);
                  const currentCents = toCents(chargeModalCard.currentInvoiceAmount);
                  const nextCents =
                    chargeMode === 'add' ? addMoney(currentCents, parsedCents) : parsedCents;
                  return (
                    <p className="text-[11px] font-semibold text-[#64748B] dark:text-slate-400 mt-1.5">
                      Fatura resultante:{' '}
                      <strong className="font-money text-[#0F172A] dark:text-[#10B981]">
                        {formatarValor(fromCents(nextCents), hideValues)}
                      </strong>
                    </p>
                  );
                } catch {
                  return null;
                }
              })()}
            </div>

            {awaitingChargeConfirm ? (
              <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 space-y-2">
                <div className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200 font-semibold">
                  <ShieldAlert size={16} className="shrink-0 mt-0.5" />
                  <span>
                    Confirmar atualização manual do saldo da fatura de {chargeModalCard.cardName}?
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAwaitingChargeConfirm(false)}
                    className="flex-1 min-h-10 rounded-xl border border-amber-300 text-xs font-semibold text-amber-900 dark:text-amber-200 cursor-pointer"
                  >
                    Revisar
                  </button>
                  <button
                    type="button"
                    onClick={confirmUpdateInvoice}
                    className="flex-[1.5] min-h-10 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                  >
                    Sim, confirmar ajuste
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setChargeModalCard(null)}
                  className="flex-1 min-h-12 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmUpdateInvoice}
                  className="flex-[1.5] min-h-12 bg-[#061E3E] hover:bg-[#0F172A] dark:bg-[#059669] dark:hover:bg-emerald-700 text-white rounded-xl text-sm font-bold cursor-pointer"
                >
                  Revisar ajuste
                </button>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
};
