import React, { useEffect, useMemo, useState } from 'react';
import {
  Account,
  APP_CATEGORIES,
  CROSS_ENTITY_NATURE_LABELS,
  CrossEntityTransferNature,
  EntityId,
  OPERATION_TYPE_LABELS,
  OPERATION_TYPES,
  OperationType,
  Transaction,
  TransactionStatus,
} from '../../types';
import {
  fromCents,
  getTransactionAmountCents,
  MoneyCents,
  parseMoneyInput,
} from '../../domain/money/money';
import { todayLocal, formatDateBR } from '../../utils/dateUtils';
import { usePrivacy } from '../../contexts/PrivacyContext';
import { formatarValor } from '../../utils/formatters';
import { BankLogo } from '../BankLogo';
import { MoneyInputField } from '../MoneyInputField';
import { Sheet } from '../Sheet';
import { AlertCircle, ArrowRight, CheckCircle2, RotateCcw, Trash2 } from 'lucide-react';

export type CashBookModalMode = 'INCOME' | 'EXPENSE' | 'TRANSFER';

interface CashBookDateModalProps {
  open: boolean;
  onClose: () => void;
  accounts: readonly Account[];
  defaultEntityId: EntityId;
  defaultAccountId?: string;
  defaultDate: string;
  defaultMode: CashBookModalMode;
  editingTransaction?: Transaction | null;
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

export const CashBookDateModal: React.FC<CashBookDateModalProps> = ({
  open,
  onClose,
  accounts,
  defaultEntityId,
  defaultAccountId,
  defaultDate,
  defaultMode,
  editingTransaction = null,
  onSaveTransaction,
  onExecuteTransfer,
  onDeleteTransaction,
  onRestoreTransaction,
}) => {
  const { hideValues } = usePrivacy();
  const [mode, setMode] = useState<CashBookModalMode>(defaultMode);
  const [date, setDate] = useState(defaultDate || todayLocal());
  const [amountStr, setAmountStr] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>('Outros');
  const [originAccountId, setOriginAccountId] = useState('');
  const [destinationAccountId, setDestinationAccountId] = useState('');
  const [operationType, setOperationType] = useState<OperationType>('PIX');
  const [status, setStatus] = useState<Exclude<TransactionStatus, 'CANCELLED'>>('CONFIRMED');
  const [notes, setNotes] = useState('');
  const [crossEntityNature, setCrossEntityNature] =
    useState<CrossEntityTransferNature>('TRANSFERENCIA_NEUTRA');
  const [awaitingTransferConfirm, setAwaitingTransferConfirm] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const activeAccounts = useMemo(
    () => accounts.filter((a) => !a.archived),
    [accounts]
  );

  const entityAccounts = useMemo(() => {
    const scoped = activeAccounts.filter((a) => a.entityId === defaultEntityId);
    return scoped.length > 0 ? scoped : activeAccounts;
  }, [activeAccounts, defaultEntityId]);

  useEffect(() => {
    if (!open) return;
    setErrorMsg('');
    setAwaitingTransferConfirm(false);

    if (editingTransaction) {
      setMode(editingTransaction.direction === 'INCOME' ? 'INCOME' : 'EXPENSE');
      setDate(editingTransaction.date);
      setAmountStr(
        fromCents(getTransactionAmountCents(editingTransaction))
          .toFixed(2)
          .replace('.', ',')
      );
      setDescription(editingTransaction.description);
      setCategory(editingTransaction.category || 'Outros');
      setOriginAccountId(editingTransaction.accountId);
      setDestinationAccountId('');
      setOperationType(editingTransaction.operationType || 'OUTRO');
      setStatus(
        editingTransaction.status === 'PENDING' || editingTransaction.status === 'PLANNED'
          ? editingTransaction.status
          : 'CONFIRMED'
      );
      setNotes(editingTransaction.notes || '');
      return;
    }

    const initialOrigin =
      (defaultAccountId && defaultAccountId !== 'ALL'
        ? activeAccounts.find((a) => a.id === defaultAccountId)
        : undefined) ||
      entityAccounts[0] ||
      activeAccounts[0];

    const initialDest =
      activeAccounts.find((a) => a.id !== initialOrigin?.id && a.entityId === defaultEntityId) ||
      activeAccounts.find((a) => a.id !== initialOrigin?.id) ||
      initialOrigin;

    setMode(defaultMode);
    setDate(defaultDate || todayLocal());
    setAmountStr('');
    setDescription('');
    setCategory(
      defaultMode === 'INCOME'
        ? defaultEntityId === 'CNPJ'
          ? 'Serviço MEI'
          : 'Salário'
        : 'Outros'
    );
    setOriginAccountId(initialOrigin?.id || '');
    setDestinationAccountId(initialDest?.id || '');
    setOperationType(defaultMode === 'TRANSFER' ? 'TRANSFERENCIA_PROPRIA' : 'PIX');
    setStatus('CONFIRMED');
    setNotes('');
    setCrossEntityNature('TRANSFERENCIA_NEUTRA');
  }, [
    open,
    editingTransaction,
    defaultMode,
    defaultDate,
    defaultAccountId,
    defaultEntityId,
    activeAccounts,
    entityAccounts,
  ]);

  const originAcc = useMemo(
    () => accounts.find((a) => a.id === originAccountId) || entityAccounts[0] || null,
    [accounts, originAccountId, entityAccounts]
  );

  const destinationAcc = useMemo(
    () => activeAccounts.find((a) => a.id === destinationAccountId) || null,
    [activeAccounts, destinationAccountId]
  );

  const isCrossEntityTransfer = Boolean(
    mode === 'TRANSFER' &&
      originAcc &&
      destinationAcc &&
      originAcc.entityId !== destinationAcc.entityId
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    let amountCents: MoneyCents;
    try {
      amountCents = parseMoneyInput(amountStr);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Informe um valor válido.');
      return;
    }

    if (amountCents <= 0) {
      setErrorMsg('Informe um valor maior que zero.');
      return;
    }

    if (!date) {
      setErrorMsg('Informe a data do lançamento.');
      return;
    }

    if (mode === 'TRANSFER' && !editingTransaction) {
      if (!originAcc || !destinationAcc) {
        setErrorMsg('Selecione a conta de origem e a conta de destino.');
        return;
      }
      if (originAcc.id === destinationAcc.id) {
        setErrorMsg('Selecione contas diferentes para origem e destino.');
        return;
      }
      if (!awaitingTransferConfirm) {
        setAwaitingTransferConfirm(true);
        return;
      }
      const res = onExecuteTransfer({
        originAccountId: originAcc.id,
        destinationAccountId: destinationAcc.id,
        amountCents,
        date,
        description: description.trim(),
        notes: notes.trim() || undefined,
        crossEntityNature: isCrossEntityTransfer ? crossEntityNature : 'TRANSFERENCIA_NEUTRA',
      });
      if (!res.ok) {
        setAwaitingTransferConfirm(false);
        setErrorMsg(res.error || 'Não foi possível concluir a transferência.');
        return;
      }
      onClose();
      return;
    }

    if (!originAcc) {
      setErrorMsg(`Nenhuma conta ${defaultEntityId} disponível para registrar a movimentação.`);
      return;
    }

    if (!description.trim()) {
      setErrorMsg('Informe a descrição da movimentação.');
      return;
    }

    onSaveTransaction(
      {
        entityId: editingTransaction ? editingTransaction.entityId : originAcc.entityId,
        accountId: originAcc.id,
        date,
        description: description.trim(),
        originalDescription: editingTransaction?.originalDescription || description.trim(),
        category,
        account: `${originAcc.institutionName} · ${originAcc.accountName}`,
        amountCents,
        amount: fromCents(amountCents),
        direction: mode === 'INCOME' ? 'INCOME' : 'EXPENSE',
        status: editingTransaction?.status === 'CANCELLED' ? 'CANCELLED' : status,
        origin: editingTransaction?.origin || 'MANUAL',
        operationType,
        notes: notes.trim() || undefined,
        isInternalTransfer: editingTransaction?.isInternalTransfer || operationType === 'TRANSFERENCIA_PROPRIA',
        ...(editingTransaction?.transferId ? { transferId: editingTransaction.transferId } : {}),
        ...(editingTransaction?.destinationAccountId
          ? { destinationAccountId: editingTransaction.destinationAccountId }
          : {}),
      },
      editingTransaction?.id
    );
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        editingTransaction
          ? 'Editar movimentação do Livro Caixa'
          : mode === 'TRANSFER'
            ? 'Nova transferência entre contas'
            : 'Adicionar movimentação no Livro Caixa'
      }
      subtitle={`Competência ${formatDateBR(date)} · Titularidade ${defaultEntityId}`}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-semibold flex items-center gap-2">
            <AlertCircle size={15} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Mode selector for new entries */}
        {!editingTransaction && (
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: 'INCOME', label: 'Entrada (+)' },
                { id: 'EXPENSE', label: 'Saída (−)' },
                { id: 'TRANSFER', label: 'Transferência' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setMode(opt.id);
                  setAwaitingTransferConfirm(false);
                  if (opt.id === 'TRANSFER') {
                    setOperationType('TRANSFERENCIA_PROPRIA');
                  } else if (operationType === 'TRANSFERENCIA_PROPRIA') {
                    setOperationType('PIX');
                  }
                }}
                className={`min-h-11 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                  mode === opt.id
                    ? opt.id === 'INCOME'
                      ? 'bg-[#ECFDF5] dark:bg-emerald-950/60 border-[#059669] text-[#059669] dark:text-[#10B981]'
                      : opt.id === 'EXPENSE'
                        ? 'bg-red-50 dark:bg-red-950/60 border-red-400 text-red-700 dark:text-red-300'
                        : 'bg-blue-50 dark:bg-blue-950/60 border-blue-500 text-blue-700 dark:text-blue-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* Visual Transfer Summary Card when TRANSFER */}
        {mode === 'TRANSFER' && originAcc && destinationAcc && (
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <BankLogo
                  bankName={originAcc.institutionName}
                  bankCode={originAcc.bankCode}
                  logoUrl={originAcc.logoUrl}
                  size={36}
                />
                <div className="min-w-0">
                  <span className="block text-[10px] uppercase font-bold text-slate-400">Origem</span>
                  <strong className="block text-xs text-[#0F172A] dark:text-white truncate">
                    {originAcc.institutionName} · {originAcc.accountName}
                  </strong>
                  <span className="text-[10px] font-bold text-[#64748B]">{originAcc.entityId}</span>
                </div>
              </div>

              <ArrowRight size={18} className="text-[#059669] shrink-0" />

              <div className="flex items-center gap-2 min-w-0 flex-1 justify-end text-right">
                <div className="min-w-0">
                  <span className="block text-[10px] uppercase font-bold text-slate-400">Destino</span>
                  <strong className="block text-xs text-[#0F172A] dark:text-white truncate">
                    {destinationAcc.institutionName} · {destinationAcc.accountName}
                  </strong>
                  <span className="text-[10px] font-bold text-[#64748B]">{destinationAcc.entityId}</span>
                </div>
                <BankLogo
                  bankName={destinationAcc.institutionName}
                  bankCode={destinationAcc.bankCode}
                  logoUrl={destinationAcc.logoUrl}
                  size={36}
                />
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="cb-date" className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
              Data
            </label>
            <input
              id="cb-date"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-[#0F172A] dark:text-white min-h-11"
            />
          </div>

          <MoneyInputField
            id="cb-amount"
            label="Valor (R$)"
            required
            value={amountStr}
            onChange={(val) => {
              setAmountStr(val);
              setAwaitingTransferConfirm(false);
            }}
            placeholder="0,00"
          />
        </div>

        {/* Account Selector(s) with BankLogo preview */}
        <div>
          <label htmlFor="cb-origin-account" className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
            {mode === 'TRANSFER' ? 'Conta de origem (saída)' : 'Conta bancária'}
          </label>
          <div className="flex items-center gap-2.5">
            {originAcc && (
              <BankLogo
                bankName={originAcc.institutionName}
                bankCode={originAcc.bankCode}
                logoUrl={originAcc.logoUrl}
                size={38}
              />
            )}
            <select
              id="cb-origin-account"
              value={originAccountId}
              onChange={(e) => {
                setOriginAccountId(e.target.value);
                setAwaitingTransferConfirm(false);
              }}
              className="flex-1 min-w-0 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-[#0F172A] dark:text-white min-h-11"
            >
              {(mode === 'TRANSFER' ? activeAccounts : entityAccounts).map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.institutionName} · {acc.accountName} ({acc.entityId}) — {formatarValor(acc.balance, hideValues)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {mode === 'TRANSFER' && (
          <>
            <div>
              <label htmlFor="cb-dest-account" className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Conta de destino (entrada)
              </label>
              <div className="flex items-center gap-2.5">
                {destinationAcc && (
                  <BankLogo
                    bankName={destinationAcc.institutionName}
                    bankCode={destinationAcc.bankCode}
                    logoUrl={destinationAcc.logoUrl}
                    size={38}
                  />
                )}
                <select
                  id="cb-dest-account"
                  value={destinationAccountId}
                  onChange={(e) => {
                    setDestinationAccountId(e.target.value);
                    setAwaitingTransferConfirm(false);
                  }}
                  className="flex-1 min-w-0 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-[#0F172A] dark:text-white min-h-11"
                >
                  {activeAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.institutionName} · {acc.accountName} ({acc.entityId}) — {formatarValor(acc.balance, hideValues)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {isCrossEntityTransfer && (
              <div className="p-3 rounded-xl bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 space-y-1.5">
                <label
                  htmlFor="cb-cross-nature"
                  className="block text-xs font-bold text-amber-900 dark:text-amber-200"
                >
                  Transferência entre CPF e CNPJ — Natureza Contábil
                </label>
                <select
                  id="cb-cross-nature"
                  value={crossEntityNature}
                  onChange={(e) =>
                    setCrossEntityNature(e.target.value as CrossEntityTransferNature)
                  }
                  className="w-full border border-amber-300 dark:border-amber-700 rounded-xl px-3 py-2 text-xs font-semibold bg-white dark:bg-slate-900 text-[#0F172A] dark:text-white min-h-10"
                >
                  {(Object.keys(CROSS_ENTITY_NATURE_LABELS) as CrossEntityTransferNature[]).map(
                    (k) => (
                      <option key={k} value={k}>
                        {CROSS_ENTITY_NATURE_LABELS[k]}
                      </option>
                    )
                  )}
                </select>
              </div>
            )}
          </>
        )}

        <div>
          <label htmlFor="cb-description" className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
            Descrição {mode === 'TRANSFER' ? '(opcional)' : ''}
          </label>
          <input
            id="cb-description"
            type="text"
            required={mode !== 'TRANSFER'}
            placeholder={
              mode === 'TRANSFER'
                ? 'Ex.: Aporte de capital, Reserva mensal'
                : 'Ex.: Recebimento de cliente, Energia elétrica...'
            }
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm bg-white dark:bg-slate-800 text-[#0F172A] dark:text-white min-h-11"
          />
        </div>

        {mode !== 'TRANSFER' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="cb-category" className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Categoria
              </label>
              <select
                id="cb-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-[#0F172A] dark:text-white min-h-11"
              >
                {APP_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="cb-optype" className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Forma de movimentação
              </label>
              <select
                id="cb-optype"
                value={operationType}
                onChange={(e) => setOperationType(e.target.value as OperationType)}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-[#0F172A] dark:text-white min-h-11"
              >
                {OPERATION_TYPES.map((op) => (
                  <option key={op} value={op}>
                    {OPERATION_TYPE_LABELS[op]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="cb-status" className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Situação
              </label>
              <select
                id="cb-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as Exclude<TransactionStatus, 'CANCELLED'>)}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-[#0F172A] dark:text-white min-h-11"
              >
                <option value="CONFIRMED">Confirmado</option>
                <option value="PENDING">Pendente</option>
                <option value="PLANNED">Planejado</option>
              </select>
            </div>
          </div>
        )}

        <div>
          <label htmlFor="cb-notes" className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
            Observações (opcional)
          </label>
          <textarea
            id="cb-notes"
            rows={2}
            placeholder="Detalhes adicionais para conciliação contábil..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2 text-sm bg-white dark:bg-slate-800 text-[#0F172A] dark:text-white resize-none"
          />
        </div>

        {awaitingTransferConfirm && mode === 'TRANSFER' && originAcc && destinationAcc && (
          <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-700 text-xs text-emerald-900 dark:text-emerald-200 space-y-1">
            <div className="font-bold">Confirme os dados da transferência:</div>
            <div>
              De <strong>{originAcc.institutionName} · {originAcc.accountName}</strong> ({originAcc.entityId}) → Para{' '}
              <strong>{destinationAcc.institutionName} · {destinationAcc.accountName}</strong> ({destinationAcc.entityId})
            </div>
            <div>
              Valor: <strong className="font-money">R$ {amountStr || '0,00'}</strong> · Data:{' '}
              <strong>{formatDateBR(date)}</strong>
            </div>
          </div>
        )}

        {editingTransaction && (
          <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
            {editingTransaction.status === 'CANCELLED' && onRestoreTransaction ? (
              <button
                type="button"
                onClick={() => {
                  onRestoreTransaction(editingTransaction.id);
                  onClose();
                }}
                className="px-3 min-h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw size={14} /> Restaurar lançamento
              </button>
            ) : onDeleteTransaction ? (
              <button
                type="button"
                onClick={() => {
                  onDeleteTransaction(editingTransaction.id);
                  onClose();
                }}
                className="px-3 min-h-10 rounded-xl bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                {editingTransaction.status === 'CONFIRMED' ? (
                  <>
                    <RotateCcw size={14} /> Estornar lançamento
                  </>
                ) : (
                  <>
                    <Trash2 size={14} /> Cancelar lançamento
                  </>
                )}
              </button>
            ) : null}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-12 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            Fechar
          </button>
          <button
            type="submit"
            className="flex-[1.5] min-h-12 bg-[#061E3E] hover:bg-[#0F172A] dark:bg-[#059669] dark:hover:bg-emerald-700 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
          >
            <CheckCircle2 size={16} />
            {editingTransaction
              ? 'Salvar alterações'
              : mode === 'TRANSFER'
                ? awaitingTransferConfirm
                  ? 'Confirmar transferência'
                  : 'Conferir transferência'
                : 'Registrar no Livro Caixa'}
          </button>
        </div>
      </form>
    </Sheet>
  );
};
