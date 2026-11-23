import React, { useState, useMemo, useEffect } from 'react';
import {
  Account,
  Boleto,
  CategoryRule,
  CROSS_ENTITY_NATURE_LABELS,
  CrossEntityTransferNature,
  Transaction,
} from '../types';
import { toCents, fromCents } from '../utils/financeCalculations';
import { MoneyCents, parseMoneyInput } from '../domain/money/money';
import { todayLocal } from '../utils/dateLocal';
import { canDeleteAccount, AccountDeletionCheck } from '../services/accountService';
import { useIsDesktop } from '../hooks/useMediaQuery';
import { MoneyInputField } from './MoneyInputField';
import {
  Wallet,
  Plus,
  CheckCircle2,
  Trash2,
  AlertCircle,
  Archive,
  ArchiveRestore,
  Lock,
  ArrowLeftRight,
  ArrowUpRight,
  ArrowRight,
  BarChart3,
  BookOpen,
  FileSpreadsheet,
  Cloud,
} from 'lucide-react';
import { Sheet } from './Sheet';
import { usePrivacy } from '../contexts/PrivacyContext';
import { formatarValor } from '../utils/formatters';
import { BankLogo } from './BankLogo';
import { InstitutionSelectorDrawer } from './InstitutionSelectorDrawer';
import { AccountAnalytics } from './finance/AccountAnalytics';
import { CashBookModule } from './accounts/CashBookModule';
import { SpreadsheetImportTab } from './accounts/SpreadsheetImportTab';

type AccountsSubTab = 'ACCOUNTS' | 'CASH_BOOK' | 'IMPORT_LOCAL' | 'IMPORT_DRIVE';

interface AccountsViewProps {
  accounts: Account[];
  transactions: Transaction[];
  boletos?: Boleto[];
  categoryRules?: CategoryRule[];
  selectedAccountId?: string | null;
  onClearSelectedAccount?: () => void;
  onAddAccount: (account: Omit<Account, 'id'>) => void;
  onDeleteAccount: (id: string) => void;
  onToggleArchiveAccount: (id: string) => void;
  onInspectAccount?: (account: Account) => void;
  onEditTransaction?: (tx: Transaction) => void;
  onSaveTransaction?: (tx: Omit<Transaction, 'id'>, editId?: string) => void;
  onDeleteTransaction?: (id: string) => void;
  onRestoreTransaction?: (id: string) => void;
  onCommitSpreadsheetImport?: (
    items: Omit<Transaction, 'id'>[],
    meta: { fileName: string; batchFingerprint: string; accountId: string }
  ) => { acceptedCount: number; skippedDuplicatesCount: number };
  onExecuteTransfer?: (params: {
    originAccountId: string;
    destinationAccountId: string;
    amountCents: MoneyCents;
    date: string;
    description: string;
    notes?: string;
    crossEntityNature?: CrossEntityTransferNature;
  }) => { ok: boolean; error?: string };
}

export const AccountsView: React.FC<AccountsViewProps> = ({
  accounts,
  transactions,
  boletos,
  categoryRules = [],
  selectedAccountId = null,
  onClearSelectedAccount,
  onAddAccount,
  onDeleteAccount,
  onToggleArchiveAccount,
  onInspectAccount,
  onEditTransaction,
  onSaveTransaction,
  onDeleteTransaction,
  onRestoreTransaction,
  onCommitSpreadsheetImport,
  onExecuteTransfer,
}) => {
  const { hideValues } = usePrivacy();
  const isDesktop = useIsDesktop();
  const [subTab, setSubTab] = useState<AccountsSubTab>('ACCOUNTS');
  const [modalOpen, setModalOpen] = useState(false);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(selectedAccountId);

  useEffect(() => {
    if (selectedAccountId) {
      setActiveAccountId(selectedAccountId);
    }
  }, [selectedAccountId]);

  const activeAnalyticAccount = useMemo(
    () => (activeAccountId ? accounts.find((a) => a.id === activeAccountId) || null : null),
    [accounts, activeAccountId]
  );
  const [institutionName, setInstitutionName] = useState('');
  const [institutionCode, setInstitutionCode] = useState<string | undefined>(undefined);
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState<Account['accountType']>('checking');
  const [entityId, setEntityId] = useState<'CPF' | 'CNPJ'>('CPF');
  const [openingBalanceStr, setOpeningBalanceStr] = useState('0,00');
  const [errorMsg, setErrorMsg] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [originAccountId, setOriginAccountId] = useState('');
  const [destinationAccountId, setDestinationAccountId] = useState('');
  const [transferAmountStr, setTransferAmountStr] = useState('');
  const [transferDate, setTransferDate] = useState(() => todayLocal());
  const [transferDesc, setTransferDesc] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [crossEntityNature, setCrossEntityNature] =
    useState<CrossEntityTransferNature>('TRANSFERENCIA_NEUTRA');
  const [awaitingTransferConfirm, setAwaitingTransferConfirm] = useState(false);
  const [transferError, setTransferError] = useState('');

  const activeAccounts = useMemo(() => accounts.filter((a) => !a.archived), [accounts]);

  const deletionChecks = useMemo(() => {
    const map = new Map<string, AccountDeletionCheck>();
    for (const acc of accounts) {
      map.set(
        acc.id,
        canDeleteAccount(acc.id, { transactions, boletos, account: acc })
      );
    }
    return map;
  }, [accounts, transactions, boletos]);

  const totalBalance = fromCents(
    accounts.reduce((acc, a) => acc + (a.balanceCents ?? toCents(a.balance)), 0)
  );
  const totalProjectedBalance = fromCents(
    accounts.reduce(
      (acc, a) => acc + (a.projectedBalanceCents ?? a.balanceCents ?? toCents(a.balance)),
      0
    )
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    let openingCents: MoneyCents;
    try {
      openingCents = openingBalanceStr.trim() ? parseMoneyInput(openingBalanceStr) : toCents(0);
    } catch {
      setErrorMsg('Saldo inicial inválido.');
      return;
    }
    if (!institutionName.trim() || !accountName.trim()) {
      setErrorMsg('Informe o banco/instituição e o nome da conta.');
      return;
    }

    onAddAccount({
      entityId,
      institutionName: institutionName.trim(),
      ...(institutionCode ? { bankCode: institutionCode } : {}),
      accountName: accountName.trim(),
      accountType,
      openingBalance: fromCents(openingCents),
      openingBalanceCents: openingCents,
      balance: fromCents(openingCents),
      balanceCents: openingCents,
    });

    setInstitutionName('');
    setInstitutionCode(undefined);
    setAccountName('');
    setOpeningBalanceStr('0,00');
    setModalOpen(false);
  };

  const typeLabels: Record<Account['accountType'], string> = {
    checking: 'Corrente',
    savings: 'Poupança',
    business: 'Empresarial PJ',
    investment: 'Investimento',
  };

  if (activeAnalyticAccount) {
    return (
      <AccountAnalytics
        account={activeAnalyticAccount}
        transactions={transactions}
        onBack={() => {
          setActiveAccountId(null);
          onClearSelectedAccount?.();
        }}
        onEditTransaction={onEditTransaction}
        onInspectInLedger={onInspectAccount}
      />
    );
  }

  const selectedOriginAcc = useMemo(
    () => activeAccounts.find((a) => a.id === originAccountId) || null,
    [activeAccounts, originAccountId]
  );
  const selectedDestAcc = useMemo(
    () => activeAccounts.find((a) => a.id === destinationAccountId) || null,
    [activeAccounts, destinationAccountId]
  );
  const isCrossEntityTransfer = Boolean(
    selectedOriginAcc &&
      selectedDestAcc &&
      selectedOriginAcc.entityId !== selectedDestAcc.entityId
  );

  return (
    <div className="space-y-4 sm:space-y-6 animate-fadeIn">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl sm:text-2xl font-bold text-[#0F172A] dark:text-white">
            Contas Bancárias & Livro Caixa
          </h2>
          <p className="font-sans text-xs sm:text-sm text-[#64748B] dark:text-slate-400">
            Saldos por instituição, Livro Caixa PF/PJ separado, calendário financeiro e importação de planilhas.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onExecuteTransfer && activeAccounts.length >= 2 && (
            <button
              type="button"
              onClick={() => {
                setTransferError('');
                setAwaitingTransferConfirm(false);
                setOriginAccountId(activeAccounts[0]?.id || '');
                setDestinationAccountId(activeAccounts[1]?.id || '');
                setTransferAmountStr('');
                setTransferDate(todayLocal());
                setTransferDesc('');
                setTransferNotes('');
                setCrossEntityNature('TRANSFERENCIA_NEUTRA');
                setTransferModalOpen(true);
              }}
              className="sf-card-interactive px-4 min-h-11 text-xs sm:text-sm font-semibold text-[#0F172A] dark:text-slate-200 flex items-center justify-center gap-2 cursor-pointer"
            >
              <ArrowLeftRight className="w-4 h-4 text-[#059669]" />
              Transferir entre contas
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setErrorMsg('');
              setInstitutionCode(undefined);
              setModalOpen(true);
            }}
            className="bg-[#061E3E] hover:bg-[#0F172A] dark:bg-[#059669] dark:hover:bg-emerald-700 text-white px-4 min-h-11 rounded-xl text-xs sm:text-sm font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Nova conta
          </button>
        </div>
      </div>

      {/* Sub-navigation bar inside Contas Bancárias */}
      <nav
        aria-label="Submódulos de Contas Bancárias"
        className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-1.5 rounded-2xl bg-slate-100/90 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/70"
      >
        {(
          [
            { id: 'ACCOUNTS', label: 'Contas', icon: <Wallet size={14} /> },
            { id: 'CASH_BOOK', label: 'Livro Caixa', icon: <BookOpen size={14} /> },
            { id: 'IMPORT_LOCAL', label: 'Importar planilha', icon: <FileSpreadsheet size={14} /> },
            { id: 'IMPORT_DRIVE', label: 'Importar do Drive', icon: <Cloud size={14} /> },
          ] as const
        ).map((tab) => {
          const active = subTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`min-h-10 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                active
                  ? 'bg-white dark:bg-slate-900 text-[#061E3E] dark:text-[#10B981] shadow-xs border border-slate-200/70 dark:border-slate-700'
                  : 'text-[#64748B] dark:text-slate-300 hover:text-[#0F172A] dark:hover:text-white'
              }`}
            >
              {tab.icon}
              <span className="truncate">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {subTab === 'CASH_BOOK' && (
        <CashBookModule
          accounts={accounts}
          transactions={transactions}
          onSaveTransaction={(tx, editId) => onSaveTransaction?.(tx, editId)}
          onExecuteTransfer={(params) =>
            onExecuteTransfer
              ? onExecuteTransfer(params)
              : { ok: false, error: 'Transferência indisponível nesta sessão.' }
          }
          onDeleteTransaction={onDeleteTransaction}
          onRestoreTransaction={onRestoreTransaction}
        />
      )}

      {(subTab === 'IMPORT_LOCAL' || subTab === 'IMPORT_DRIVE') && (
        <SpreadsheetImportTab
          mode={subTab === 'IMPORT_DRIVE' ? 'DRIVE' : 'LOCAL'}
          accounts={accounts}
          transactions={transactions}
          categoryRules={categoryRules}
          onCommitImport={(items, meta) =>
            onCommitSpreadsheetImport
              ? onCommitSpreadsheetImport(items, meta)
              : { acceptedCount: 0, skippedDuplicatesCount: 0 }
          }
        />
      )}

      {subTab === 'ACCOUNTS' && (
        <>

      <div className="sf-card p-5 sm:p-6 flex items-center justify-between gap-4">
        <div>
          <span className="font-sans text-xs font-medium text-[#64748B] dark:text-slate-400">Saldo Realizado em Contas</span>
          {accounts.length === 0 ? (
            <>
              <div className="font-display text-xl sm:text-2xl font-bold text-[#0F172A] dark:text-white mt-1">
                Nenhuma conta cadastrada
              </div>
              <p className="text-xs text-[#64748B] dark:text-slate-400 mt-1">
                Toque em <strong>Nova conta</strong> para registrar seu banco ou carteira.
              </p>
            </>
          ) : (
            <>
              <div className="font-money text-2xl sm:text-3xl font-extrabold text-[#0F172A] dark:text-white mt-1">
                {formatarValor(totalBalance, hideValues)}
              </div>
              {Math.abs(totalProjectedBalance - totalBalance) >= 0.01 && (
                <p className="font-money text-xs text-amber-700 dark:text-amber-300 font-semibold mt-1">
                  Saldo projetado (com pendentes/planejados): {formatarValor(totalProjectedBalance, hideValues)}
                </p>
              )}
            </>
          )}
        </div>
        <div className="sf-icon-badge">
          <Wallet size={20} strokeWidth={2} />
        </div>
      </div>

      {actionMsg && (
        <div className="p-4 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2">
          <AlertCircle size={16} className="shrink-0" />
          <span>{actionMsg}</span>
        </div>
      )}

      <div className="sf-card overflow-hidden">
        <div className="px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-[#0F172A] dark:text-white">
            Instituições cadastradas ({accounts.length})
          </h3>
          <span className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-[#64748B] dark:text-slate-300 rounded-md text-[10px] font-bold">
            Saldo derivado
          </span>
        </div>

        {accounts.length === 0 ? (
          <div className="p-8 text-center space-y-3">
            <p className="font-display text-sm font-bold text-[#0F172A] dark:text-slate-200">
              Você ainda não possui contas bancárias cadastradas.
            </p>
            <p className="text-xs text-[#64748B] dark:text-slate-400">
              Novas instalações iniciam zeradas. Adicione sua primeira conta ou restaure um backup em Configurações.
            </p>
            <button
              type="button"
              onClick={() => {
                setErrorMsg('');
                setModalOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 min-h-11 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
            >
              <Plus size={15} /> Cadastrar primeira conta
            </button>
          </div>
        ) : !isDesktop ? (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {accounts.map((acc) => {
              const check = deletionChecks.get(acc.id);
              const txCount = check?.linkedTransactionsCount || 0;
              const blocked = check ? !check.allowed : txCount > 0;
              return (
                <div key={acc.id} className={`p-4 space-y-2 ${acc.archived ? 'opacity-70 bg-slate-50/60 dark:bg-slate-800/30' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <BankLogo
                        bankName={acc.institutionName}
                        bankCode={acc.bankCode}
                        logoUrl={acc.logoUrl}
                        size={40}
                        className="mt-0.5"
                      />
                      <button
                        type="button"
                        onClick={() => setActiveAccountId(acc.id)}
                        className="min-w-0 text-left cursor-pointer group"
                      >
                        <div className="font-display font-bold text-sm text-[#0F172A] dark:text-white flex items-center gap-2 group-hover:text-[#059669]">
                          <span className="truncate">{acc.institutionName}</span>
                          {acc.archived && (
                            <span className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded text-[10px] font-bold shrink-0">
                              Arquivada
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[#64748B] dark:text-slate-400 truncate">
                          {acc.accountName} · {txCount} lançamento{txCount !== 1 ? 's' : ''}
                        </div>
                      </button>
                    </div>
                    <div className="text-right">
                      <div className="font-money text-base font-bold text-[#0F172A] dark:text-[#10B981]">
                        {formatarValor(acc.balance, hideValues)}
                      </div>
                      {typeof acc.projectedBalance === 'number' &&
                        Math.abs(acc.projectedBalance - acc.balance) >= 0.01 && (
                          <div className="font-money text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                            Proj.: {formatarValor(acc.projectedBalance, hideValues)}
                          </div>
                        )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded text-xs font-medium">
                        {typeLabels[acc.accountType]}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          acc.entityId === 'CPF'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                        }`}
                      >
                        {acc.entityId}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setActiveAccountId(acc.id)}
                        className="px-2.5 min-h-9 rounded-lg bg-[#061E3E] dark:bg-white/10 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <BarChart3 size={13} /> Analisar
                      </button>
                      {onInspectAccount && (
                        <button
                          type="button"
                          onClick={() => onInspectAccount(acc)}
                          className="px-2.5 min-h-9 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                        >
                          Extrato <ArrowUpRight size={13} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          onToggleArchiveAccount(acc.id);
                          setActionMsg(
                            acc.archived
                              ? `Conta "${acc.institutionName} · ${acc.accountName}" reativada.`
                              : `Conta "${acc.institutionName} · ${acc.accountName}" arquivada (histórico e saldo preservados).`
                          );
                        }}
                        className="min-w-10 min-h-10 grid place-items-center text-slate-500 hover:text-[#0F172A] dark:text-slate-400 dark:hover:text-white cursor-pointer"
                        aria-label={acc.archived ? `Reativar ${acc.accountName}` : `Arquivar ${acc.accountName}`}
                        title={acc.archived ? 'Reativar conta' : 'Arquivar conta (oculta em novos lançamentos)'}
                      >
                        {acc.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                      </button>
                      {blocked ? (
                        <button
                          type="button"
                          onClick={() =>
                            setActionMsg(
                              check?.reason ||
                                `Exclusão bloqueada: "${acc.institutionName} · ${acc.accountName}" possui ${txCount} lançamento(s) vinculado(s). Arquive a conta para preservar o histórico sem deixar saldos órfãos.`
                            )
                          }
                          className="min-w-10 min-h-10 grid place-items-center text-slate-300 dark:text-slate-600 cursor-not-allowed"
                          aria-label={`Exclusão bloqueada para ${acc.accountName}`}
                          title={check?.reason || `Possui ${txCount} lançamento(s) — use Arquivar`}
                        >
                          <Lock size={15} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onDeleteAccount(acc.id)}
                          className="min-w-10 min-h-10 grid place-items-center text-slate-400 hover:text-red-600 cursor-pointer"
                          aria-label={`Excluir ${acc.accountName}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="py-3 px-6 font-semibold">Instituição / Conta</th>
                <th className="py-3 px-6 font-semibold">Tipo</th>
                <th className="py-3 px-6 font-semibold">Vínculo</th>
                <th className="py-3 px-6 font-semibold text-right">Saldo Inicial</th>
                <th className="py-3 px-6 font-semibold text-right">Saldo Atual</th>
                <th className="py-3 px-6 font-semibold text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {accounts.map((acc) => {
                const check = deletionChecks.get(acc.id);
                const txCount = check?.linkedTransactionsCount || 0;
                const blocked = check ? !check.allowed : txCount > 0;
                return (
                  <tr
                    key={acc.id}
                    className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${
                      acc.archived ? 'opacity-70 bg-slate-50/50 dark:bg-slate-800/20' : ''
                    }`}
                  >
                    <td className="py-4 px-6">
                      <button
                        type="button"
                        onClick={() => setActiveAccountId(acc.id)}
                        className="flex items-center gap-3 text-left cursor-pointer group"
                      >
                        <BankLogo
                          bankName={acc.institutionName}
                          bankCode={acc.bankCode}
                          logoUrl={acc.logoUrl}
                          size={36}
                        />
                        <div>
                          <div className="font-bold text-slate-800 dark:text-white flex items-center gap-2 group-hover:text-[#059669]">
                            <span>{acc.institutionName}</span>
                            {acc.archived && (
                              <span className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded text-[10px] font-bold">
                                Arquivada
                              </span>
                            )}
                          </div>
                          <small className="text-slate-400">
                            {acc.accountName} · {txCount} lançamento{txCount !== 1 ? 's' : ''}
                          </small>
                        </div>
                      </button>
                    </td>
                    <td className="py-4 px-6">
                      <span className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-md text-[10px] font-medium">
                        {typeLabels[acc.accountType]}
                      </span>
                    </td>
                    <td className="py-4 px-6">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          acc.entityId === 'CPF'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                        }`}
                      >
                        {acc.entityId}
                      </span>
                    </td>
                    <td className="font-money py-4 px-6 text-right text-[#64748B] dark:text-slate-400">
                      {formatarValor(acc.openingBalance, hideValues)}
                    </td>
                    <td className="font-money py-4 px-6 text-right font-extrabold text-[#0F172A] dark:text-[#10B981]">
                      <div>{formatarValor(acc.balance, hideValues)}</div>
                      {typeof acc.projectedBalance === 'number' &&
                        Math.abs(acc.projectedBalance - acc.balance) >= 0.01 && (
                          <small className="block font-semibold text-amber-700 dark:text-amber-300">
                            Proj.: {formatarValor(acc.projectedBalance, hideValues)}
                          </small>
                        )}
                    </td>
                    <td className="py-4 px-6 text-center">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setActiveAccountId(acc.id)}
                          className="px-2.5 py-1.5 rounded-lg bg-[#061E3E] hover:bg-[#0F172A] dark:bg-white/10 dark:hover:bg-white/20 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                          title="Abrir painel analítico desta conta"
                        >
                          <BarChart3 size={13} /> Analisar
                        </button>
                        {onInspectAccount && (
                          <button
                            type="button"
                            onClick={() => onInspectAccount(acc)}
                            className="px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                            title="Abrir extrato filtrado desta conta"
                          >
                            Extrato <ArrowUpRight size={13} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            onToggleArchiveAccount(acc.id);
                            setActionMsg(
                              acc.archived
                                ? `Conta "${acc.institutionName} · ${acc.accountName}" reativada.`
                                : `Conta "${acc.institutionName} · ${acc.accountName}" arquivada (histórico preservado).`
                            );
                          }}
                          className="p-2 text-slate-500 hover:text-[#0F172A] dark:text-slate-400 dark:hover:text-white rounded-lg cursor-pointer"
                          title={acc.archived ? 'Reativar conta' : 'Arquivar conta'}
                        >
                          {acc.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                        </button>
                        {blocked ? (
                          <button
                            type="button"
                            onClick={() =>
                              setActionMsg(
                                check?.reason ||
                                  `Exclusão bloqueada: "${acc.institutionName}" possui ${txCount} lançamento(s). Arquive a conta para preservar a integridade dos saldos.`
                              )
                            }
                            className="p-2 text-slate-300 dark:text-slate-600 rounded-lg cursor-not-allowed"
                            title={check?.reason || `Bloqueada (${txCount} lançamentos) — use Arquivar`}
                          >
                            <Lock size={15} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onDeleteAccount(acc.id)}
                            className="p-2 text-slate-400 hover:text-red-600 rounded-lg cursor-pointer"
                            title="Excluir conta sem lançamentos"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
      </div>
        </>
      )}

      {/* Add Account Sheet */}
      <Sheet
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Nova conta bancária"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {errorMsg && (
            <div className="p-3 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle size={16} /> {errorMsg}
            </div>
          )}

          <InstitutionSelectorDrawer
            selectedName={institutionName}
            onSelect={(inst) => {
              setInstitutionName(inst.nome);
              setInstitutionCode(inst.codigo);
              setErrorMsg('');
            }}
            defaultOpen
            title="Selecionar Instituição"
          />

          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
              Instituição / Banco
            </label>
            <div className="flex items-center gap-2.5">
              {institutionName.trim() && (
                <BankLogo
                  bankName={institutionName}
                  bankCode={institutionCode}
                  size={42}
                />
              )}
              <input
                type="text"
                required
                placeholder="Ex.: 99Pay, Nubank, Sicredi, Caixa"
                value={institutionName}
                onChange={(e) => {
                  setInstitutionName(e.target.value);
                  setInstitutionCode(undefined);
                }}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
              Nome da conta
            </label>
            <input
              type="text"
              required
              placeholder="Ex.: Conta Corrente, Conta PJ"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Tipo
              </label>
              <select
                value={accountType}
                onChange={(e) => setAccountType(e.target.value as Account['accountType'])}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
              >
                <option value="checking">Corrente</option>
                <option value="savings">Poupança</option>
                <option value="business">Empresarial PJ</option>
                <option value="investment">Investimento</option>
              </select>
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

          <MoneyInputField
            label="Saldo inicial (R$)"
            allowZero
            required
            value={openingBalanceStr}
            onChange={setOpeningBalanceStr}
          />

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
              <CheckCircle2 size={16} /> Salvar conta
            </button>
          </div>
        </form>
      </Sheet>

      {/* Transfer Between Accounts Sheet */}
      <Sheet
        open={transferModalOpen}
        onClose={() => setTransferModalOpen(false)}
        title="Transferência entre contas próprias"
        subtitle="Gera saída e entrada pareadas com visualização de origem e destino"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setTransferError('');
            if (!onExecuteTransfer) return;

            let amountCents: MoneyCents;
            try {
              amountCents = parseMoneyInput(transferAmountStr);
            } catch (err) {
              setTransferError(
                err instanceof Error ? err.message : 'Informe um valor válido.'
              );
              return;
            }

            if (amountCents <= 0) {
              setTransferError('Informe um valor maior que zero.');
              return;
            }

            if (originAccountId === destinationAccountId) {
              setTransferError('Selecione contas diferentes para origem e destino.');
              return;
            }

            if (!awaitingTransferConfirm) {
              setAwaitingTransferConfirm(true);
              return;
            }

            const result = onExecuteTransfer({
              originAccountId,
              destinationAccountId,
              amountCents,
              date: transferDate || todayLocal(),
              description: transferDesc.trim(),
              notes: transferNotes.trim() || undefined,
              crossEntityNature: isCrossEntityTransfer ? crossEntityNature : 'TRANSFERENCIA_NEUTRA',
            });

            if (!result.ok) {
              setAwaitingTransferConfirm(false);
              setTransferError(result.error || 'Não foi possível concluir a transferência.');
              return;
            }

            setTransferModalOpen(false);
          }}
          className="space-y-4"
        >
          {transferError && (
            <div className="p-3 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle size={16} /> {transferError}
            </div>
          )}

          {selectedOriginAcc && selectedDestAcc && (
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <BankLogo
                  bankName={selectedOriginAcc.institutionName}
                  bankCode={selectedOriginAcc.bankCode}
                  logoUrl={selectedOriginAcc.logoUrl}
                  size={38}
                />
                <div className="min-w-0">
                  <span className="block text-[10px] font-bold uppercase text-slate-400">Origem</span>
                  <strong className="block text-xs text-[#0F172A] dark:text-white truncate">
                    {selectedOriginAcc.institutionName} · {selectedOriginAcc.accountName}
                  </strong>
                  <span className="text-[10px] font-semibold text-[#64748B]">
                    {selectedOriginAcc.entityId}
                  </span>
                </div>
              </div>

              <div className="text-center px-1 shrink-0">
                <ArrowRight size={18} className="text-[#059669] mx-auto" />
                {transferAmountStr && (
                  <span className="block font-money text-[11px] font-extrabold text-[#059669] dark:text-[#10B981]">
                    R$ {transferAmountStr}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 min-w-0 flex-1 justify-end text-right">
                <div className="min-w-0">
                  <span className="block text-[10px] font-bold uppercase text-slate-400">Destino</span>
                  <strong className="block text-xs text-[#0F172A] dark:text-white truncate">
                    {selectedDestAcc.institutionName} · {selectedDestAcc.accountName}
                  </strong>
                  <span className="text-[10px] font-semibold text-[#64748B]">
                    {selectedDestAcc.entityId}
                  </span>
                </div>
                <BankLogo
                  bankName={selectedDestAcc.institutionName}
                  bankCode={selectedDestAcc.bankCode}
                  logoUrl={selectedDestAcc.logoUrl}
                  size={38}
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
              Conta de origem (saída)
            </label>
            <select
              value={originAccountId}
              onChange={(e) => {
                setOriginAccountId(e.target.value);
                setAwaitingTransferConfirm(false);
              }}
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
            >
              {activeAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.institutionName} · {acc.accountName} ({acc.entityId}) — {formatarValor(acc.balance, hideValues)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
              Conta de destino (entrada)
            </label>
            <select
              value={destinationAccountId}
              onChange={(e) => {
                setDestinationAccountId(e.target.value);
                setAwaitingTransferConfirm(false);
              }}
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
            >
              {activeAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.institutionName} · {acc.accountName} ({acc.entityId}) — {formatarValor(acc.balance, hideValues)}
                </option>
              ))}
            </select>
          </div>

          {isCrossEntityTransfer && (
            <div className="p-3 rounded-xl bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 space-y-1.5">
              <label className="block text-xs font-bold text-amber-900 dark:text-amber-200">
                Movimentação entre CPF e CNPJ — Natureza Contábil
              </label>
              <select
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Valor (R$)
              </label>
              <input
                type="text"
                inputMode="decimal"
                required
                placeholder="0,00"
                value={transferAmountStr}
                onChange={(e) => {
                  setTransferAmountStr(e.target.value);
                  setAwaitingTransferConfirm(false);
                }}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Data
              </label>
              <input
                type="date"
                required
                value={transferDate}
                onChange={(e) => setTransferDate(e.target.value)}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
              Descrição (opcional)
            </label>
            <input
              type="text"
              placeholder="Ex.: Aporte reserva, transferência entre titularidades"
              value={transferDesc}
              onChange={(e) => setTransferDesc(e.target.value)}
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
              Observações (opcional)
            </label>
            <input
              type="text"
              placeholder="Anotação para controle no Livro Caixa"
              value={transferNotes}
              onChange={(e) => setTransferNotes(e.target.value)}
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-h-12"
            />
          </div>

          {awaitingTransferConfirm && selectedOriginAcc && selectedDestAcc && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-700 text-xs text-emerald-900 dark:text-emerald-200">
              Confirma a transferência de <strong className="font-money">R$ {transferAmountStr}</strong> de{' '}
              <strong>{selectedOriginAcc.institutionName} · {selectedOriginAcc.accountName}</strong> para{' '}
              <strong>{selectedDestAcc.institutionName} · {selectedDestAcc.accountName}</strong>?
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setTransferModalOpen(false)}
              className="flex-1 min-h-12 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-[1.5] min-h-12 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
            >
              <ArrowLeftRight size={16} />{' '}
              {awaitingTransferConfirm ? 'Confirmar transferência' : 'Conferir transferência'}
            </button>
          </div>
        </form>
      </Sheet>
    </div>
  );
};
