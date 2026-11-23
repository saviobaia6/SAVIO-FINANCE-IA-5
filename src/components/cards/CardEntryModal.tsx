import React, { useEffect, useMemo, useState } from 'react';
import {
  Account,
  CreditCard,
  Transaction,
  TransactionStatus,
} from '../../types';
import { ALL_CARD_CATEGORIES } from '../../domain/cards/CardInvoiceAuditorService';
import {
  buildCardInstallmentPlan,
  CARD_ENTRY_KIND_LABELS,
  CardEntryKind,
  classifyCardTransactionKind,
  computeBillingCycleDates,
  getCardPostingDate,
  getCardPurchaseDate,
} from '../../domain/cards/CardLedgerService';
import { fromCents, getTransactionAmountCents, parseMoneyInput } from '../../domain/money/money';
import { formatDateBR, todayLocal } from '../../utils/dateUtils';
import { formatarValor } from '../../utils/formatters';
import { usePrivacy } from '../../contexts/PrivacyContext';
import { Sheet } from '../Sheet';
import { MoneyInputField } from '../MoneyInputField';
import { BankLogo } from '../BankLogo';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  CreditCard as CreditCardIcon,
  Layers,
  ReceiptText,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';

interface CardEntryModalProps {
  open: boolean;
  card: CreditCard;
  accounts: readonly Account[];
  initialDate: string;
  editingTransaction?: Transaction | null;
  onClose: () => void;
  onSaveSingle: (txData: Omit<Transaction, 'id'>, editId?: string) => void;
  onSaveInstallments: (batch: Transaction[]) => void;
  onPayCardInvoice: (cardId: string, accountId?: string, paidAmount?: number) => void;
}

export const CardEntryModal: React.FC<CardEntryModalProps> = ({
  open,
  card,
  accounts,
  initialDate,
  editingTransaction = null,
  onClose,
  onSaveSingle,
  onSaveInstallments,
  onPayCardInvoice,
}) => {
  const { hideValues } = usePrivacy();
  const activeAccounts = useMemo(
    () => accounts.filter((a) => !a.archived),
    [accounts]
  );

  const [kind, setKind] = useState<CardEntryKind>('PURCHASE');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>('Cartão');
  const [amountStr, setAmountStr] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(initialDate || todayLocal());
  const [postingDate, setPostingDate] = useState(initialDate || todayLocal());
  const [installmentsStr, setInstallmentsStr] = useState('2');
  const [amountMode, setAmountMode] = useState<'SPLIT_TOTAL' | 'PER_OCCURRENCE'>('SPLIT_TOTAL');
  const [status, setStatus] = useState<Exclude<TransactionStatus, 'CANCELLED'>>('CONFIRMED');
  const [paymentAccountId, setPaymentAccountId] = useState('');
  const [notes, setNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [awaitingUpdateConfirm, setAwaitingUpdateConfirm] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrorMsg('');
    setAwaitingUpdateConfirm(false);

    if (editingTransaction) {
      const detectedKind = classifyCardTransactionKind(editingTransaction);
      setKind(detectedKind);
      setDescription(editingTransaction.description);
      setCategory(editingTransaction.category || 'Cartão');
      setAmountStr(
        fromCents(getTransactionAmountCents(editingTransaction))
          .toFixed(2)
          .replace('.', ',')
      );
      setPurchaseDate(getCardPurchaseDate(editingTransaction));
      setPostingDate(getCardPostingDate(editingTransaction));
      setStatus(
        editingTransaction.status === 'PENDING' || editingTransaction.status === 'PLANNED'
          ? editingTransaction.status
          : 'CONFIRMED'
      );
      setNotes(editingTransaction.notes || '');
      setInstallmentsStr(String(editingTransaction.installmentTotal || 2));
      setPaymentAccountId(editingTransaction.accountId || '');
    } else {
      const targetDate = initialDate || todayLocal();
      setKind('PURCHASE');
      setDescription('');
      setCategory('Cartão');
      setAmountStr('');
      setPurchaseDate(targetDate);
      setPostingDate(targetDate);
      setInstallmentsStr('3');
      setAmountMode('SPLIT_TOTAL');
      setStatus('CONFIRMED');
      const prefAcc =
        activeAccounts.find((a) => a.id === card.linkedAccountId) ||
        activeAccounts.find((a) => a.entityId === card.entityId) ||
        activeAccounts[0];
      setPaymentAccountId(prefAcc?.id || '');
      setNotes('');
    }
  }, [open, editingTransaction, initialDate, card, activeAccounts]);

  const cyclePreview = useMemo(
    () => computeBillingCycleDates(postingDate || purchaseDate, card.closingDay, card.dueDay),
    [postingDate, purchaseDate, card.closingDay, card.dueDay]
  );

  const performCommit = () => {
    setErrorMsg('');
    let parsedCents;
    try {
      parsedCents = parseMoneyInput(amountStr);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Informe um valor válido.');
      return;
    }

    if (parsedCents <= 0) {
      setErrorMsg('Informe um valor maior que zero.');
      return;
    }

    if (kind === 'PAYMENT' && !editingTransaction) {
      onPayCardInvoice(card.id, paymentAccountId || undefined, fromCents(parsedCents));
      onClose();
      return;
    }

    if (!description.trim()) {
      setErrorMsg('Informe uma descrição para o lançamento do cartão.');
      return;
    }

    if (kind === 'INSTALLMENT' && !editingTransaction) {
      const count = Math.max(2, Math.min(36, Math.trunc(Number(installmentsStr) || 2)));
      try {
        const plan = buildCardInstallmentPlan({
          card,
          description: description.trim(),
          category,
          purchaseDate,
          firstPostingDate: postingDate || purchaseDate,
          amountCents: parsedCents,
          amountMode,
          installments: count,
          notes,
        });
        onSaveInstallments(plan);
        onClose();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Erro ao gerar parcelamento.');
      }
      return;
    }

    const isReversal = kind === 'REVERSAL';
    const isPayment = kind === 'PAYMENT';
    const isFee = kind === 'FEE';
    const cleanNotes = notes.trim() || undefined;

    const payload: Omit<Transaction, 'id'> = {
      entityId: card.entityId,
      accountId: isPayment && paymentAccountId ? paymentAccountId : card.id,
      creditCardId: card.id,
      date: postingDate || purchaseDate,
      purchaseDate,
      postingDate: postingDate || purchaseDate,
      billingCycleYm: cyclePreview.cycleYm,
      billingClosingDate: cyclePreview.closingDate,
      billingDueDate: cyclePreview.dueDate,
      cardEntryKind: kind,
      description: description.trim(),
      originalDescription: editingTransaction?.originalDescription || description.trim(),
      category: category || (isFee ? 'Outros' : 'Cartão'),
      account: `${card.institutionName} · ${card.cardName}`,
      amountCents: parsedCents,
      amount: fromCents(parsedCents),
      direction: isReversal ? 'INCOME' : 'EXPENSE',
      status: editingTransaction ? status : status,
      origin: editingTransaction?.origin || 'MANUAL',
      operationType: isFee ? 'TARIFA' : 'CARTAO',
      ...(isPayment ? { isCardBillPayment: true } : {}),
      ...(editingTransaction?.installmentCurrent
        ? {
            installmentCurrent: editingTransaction.installmentCurrent,
            installmentTotal: editingTransaction.installmentTotal,
            installmentGroupId: editingTransaction.installmentGroupId,
          }
        : {}),
      ...(cleanNotes ? { notes: cleanNotes } : {}),
    };

    onSaveSingle(payload, editingTransaction?.id);
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    // Always ask explicit confirmation before updating an existing record or paying invoice
    if ((editingTransaction || kind === 'PAYMENT') && !awaitingUpdateConfirm) {
      try {
        const parsedCents = parseMoneyInput(amountStr);
        if (parsedCents <= 0) {
          setErrorMsg('Informe um valor maior que zero.');
          return;
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Informe um valor válido.');
        return;
      }
      if (kind !== 'PAYMENT' && !description.trim()) {
        setErrorMsg('Informe uma descrição para o lançamento.');
        return;
      }
      setAwaitingUpdateConfirm(true);
      return;
    }

    performCommit();
  };

  const kindOptions: Array<{ key: CardEntryKind; label: string; icon: React.ReactNode }> = [
    { key: 'PURCHASE', label: 'Compra', icon: <CreditCardIcon size={14} /> },
    { key: 'INSTALLMENT', label: 'Parcelada', icon: <Layers size={14} /> },
    { key: 'FEE', label: 'Tarifa', icon: <ReceiptText size={14} /> },
    { key: 'REVERSAL', label: 'Estorno', icon: <RotateCcw size={14} /> },
    { key: 'PAYMENT', label: 'Pagamento', icon: <CheckCircle2 size={14} /> },
  ];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        editingTransaction
          ? `Editar lançamento · ${card.cardName}`
          : `Novo registro · ${card.cardName}`
      }
      subtitle={`Final •••• ${card.last4} (${card.institutionName} · ${card.entityId})`}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Card header */}
        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 flex items-center gap-3">
          <BankLogo
            bankName={card.institutionName}
            bankCode={card.bankCode}
            logoUrl={card.logoUrl}
            size={38}
          />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-[#0F172A] dark:text-white truncate">
              {card.cardName} · •••• {card.last4}
            </div>
            <div className="text-[11px] text-[#64748B] dark:text-slate-400">
              Ciclo {cyclePreview.cycleLabel} · Fecha {formatDateBR(cyclePreview.closingDate)} · Vence{' '}
              {formatDateBR(cyclePreview.dueDate)}
            </div>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
            <AlertCircle size={15} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Kind selector */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
            Tipo de movimentação
          </label>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
            {kindOptions.map((opt) => {
              const disabled = Boolean(editingTransaction && opt.key === 'INSTALLMENT' && kind !== 'INSTALLMENT');
              return (
                <button
                  key={opt.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setKind(opt.key);
                    setAwaitingUpdateConfirm(false);
                    if (opt.key === 'FEE') setCategory('Outros');
                    else if (opt.key === 'PAYMENT') {
                      setDescription(`Pgto Fatura: ${card.cardName}`);
                      setCategory('Cartão');
                    }
                  }}
                  className={`min-h-10 px-2 rounded-xl text-[11px] font-bold border flex items-center justify-center gap-1 transition-all cursor-pointer disabled:opacity-40 ${
                    kind === opt.key
                      ? 'bg-[#061E3E] text-white border-[#061E3E] dark:bg-[#059669] dark:border-[#059669]'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {opt.icon}
                  <span className="truncate">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {kind === 'PAYMENT' && (
          <div className="space-y-3 p-3.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
            <div className="text-xs text-emerald-900 dark:text-emerald-200 font-semibold">
              Pagamento de fatura ({formatarValor(card.currentInvoiceAmount, hideValues)} em aberto) — não é contado como nova despesa de consumo.
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Debitar da conta bancária:
              </label>
              <select
                value={paymentAccountId}
                onChange={(e) => {
                  setPaymentAccountId(e.target.value);
                  setAwaitingUpdateConfirm(false);
                }}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-11"
              >
                <option value="">Apenas abater saldo da fatura</option>
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.institutionName} · {a.accountName} ({a.entityId})
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {kind !== 'PAYMENT' && (
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
              Descrição
            </label>
            <input
              type="text"
              required
              placeholder={
                kind === 'REVERSAL'
                  ? 'Ex.: Estorno loja online'
                  : kind === 'FEE'
                    ? 'Ex.: Anuidade / IOF internacional'
                    : 'Ex.: Supermercado / Notebook'
              }
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setAwaitingUpdateConfirm(false);
              }}
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
            />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <MoneyInputField
            label={
              kind === 'INSTALLMENT' && amountMode === 'SPLIT_TOTAL'
                ? 'Valor total da compra (R$)'
                : kind === 'INSTALLMENT'
                  ? 'Valor de cada parcela (R$)'
                  : 'Valor (R$)'
            }
            required
            placeholder="0,00"
            value={amountStr}
            onChange={(val) => {
              setAmountStr(val);
              setAwaitingUpdateConfirm(false);
            }}
          />

          {kind !== 'PAYMENT' && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Categoria
              </label>
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setAwaitingUpdateConfirm(false);
                }}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
              >
                {ALL_CARD_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Distinct Dates: Data da Compra vs Data de Lançamento */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
              <Calendar size={12} className="inline mr-1" />
              Data da compra
            </label>
            <input
              type="date"
              required
              value={purchaseDate}
              onChange={(e) => {
                const next = e.target.value;
                setPurchaseDate(next);
                if (!editingTransaction && postingDate === purchaseDate) {
                  setPostingDate(next);
                }
                setAwaitingUpdateConfirm(false);
              }}
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-11"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
              <Calendar size={12} className="inline mr-1" />
              Data de lançamento na fatura
            </label>
            <input
              type="date"
              required
              value={postingDate}
              onChange={(e) => {
                setPostingDate(e.target.value);
                setAwaitingUpdateConfirm(false);
              }}
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-11"
            />
          </div>
        </div>

        {/* Installment configuration */}
        {kind === 'INSTALLMENT' && !editingTransaction && (
          <div className="p-3.5 rounded-xl bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Número de parcelas
                </label>
                <input
                  type="number"
                  min={2}
                  max={36}
                  value={installmentsStr}
                  onChange={(e) => setInstallmentsStr(e.target.value)}
                  className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-11"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Modo do valor
                </label>
                <select
                  value={amountMode}
                  onChange={(e) =>
                    setAmountMode(e.target.value as 'SPLIT_TOTAL' | 'PER_OCCURRENCE')
                  }
                  className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-11"
                >
                  <option value="SPLIT_TOTAL">Dividir valor total</option>
                  <option value="PER_OCCURRENCE">Valor por parcela</option>
                </select>
              </div>
            </div>
            <p className="text-[11px] text-sky-800 dark:text-sky-200">
              Todas as {Math.max(2, Math.min(36, Math.trunc(Number(installmentsStr) || 2)))} parcelas serão vinculadas com identificador único de parcelamento e alocadas nos ciclos mensais futuros sem duplicar compras.
            </p>
          </div>
        )}

        {editingTransaction && (
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
              Situação
            </label>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as Exclude<TransactionStatus, 'CANCELLED'>);
                setAwaitingUpdateConfirm(false);
              }}
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-11"
            >
              <option value="CONFIRMED">Confirmado</option>
              <option value="PENDING">Pendente</option>
              <option value="PLANNED">Planejado</option>
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
            Observações
          </label>
          <textarea
            rows={2}
            placeholder="Detalhes opcionais sobre a compra, comprovante ou ciclo..."
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setAwaitingUpdateConfirm(false);
            }}
            className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
          />
        </div>

        {/* Mandatory confirmation prompt before updating existing records or executing bill payment */}
        {awaitingUpdateConfirm && (
          <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 space-y-2">
            <div className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200 font-semibold">
              <ShieldAlert size={16} className="shrink-0 mt-0.5" />
              <span>
                {editingTransaction
                  ? `Confirmar atualização deste registro (${CARD_ENTRY_KIND_LABELS[kind]}) no cartão ${card.cardName}? A alteração será registrada na trilha de auditoria.`
                  : `Confirmar o pagamento no cartão ${card.cardName}? Isso atualizará o saldo da fatura e a conta selecionada.`}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAwaitingUpdateConfirm(false)}
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
        )}

        {!awaitingUpdateConfirm && (
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-12 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-[1.5] min-h-12 bg-[#061E3E] hover:bg-[#0F172A] dark:bg-[#059669] dark:hover:bg-emerald-700 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
            >
              <CheckCircle2 size={16} />
              {editingTransaction
                ? 'Revisar e atualizar'
                : kind === 'PAYMENT'
                  ? 'Revisar pagamento'
                  : 'Salvar no cartão'}
            </button>
          </div>
        )}
      </form>
    </Sheet>
  );
};
