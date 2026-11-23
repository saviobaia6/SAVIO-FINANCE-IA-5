import React, { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Account, Transaction } from '../../types';
import { usePrivacy } from '../../contexts/PrivacyContext';
import { formatarValor } from '../../utils/formatters';
import { fromCents, getTransactionAmountCents } from '../../domain/money/money';
import { formatDateBR } from '../../utils/dateUtils';
import { isCardBillPaymentTransaction } from '../../domain/accounts/BalanceCalculator';
import { BankLogo } from '../BankLogo';

interface TransactionListProps {
  transactions: readonly Transaction[];
  accounts?: readonly Account[];
  title?: string;
  emptyMessage?: string;
  maxItems?: number;
  onEditTransaction?: (tx: Transaction) => void;
  action?: React.ReactNode;
}

export const TransactionList: React.FC<TransactionListProps> = ({
  transactions,
  accounts = [],
  title = 'Lançamentos',
  emptyMessage = 'Nenhuma movimentação encontrada para os filtros atuais.',
  maxItems,
  onEditTransaction,
  action,
}) => {
  const { hideValues } = usePrivacy();
  const visible = typeof maxItems === 'number' ? transactions.slice(0, maxItems) : transactions;
  const accountById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts]
  );

  return (
    <div className="sf-card overflow-hidden">
      <div className="px-5 py-4 border-b border-[#E2E8F0] dark:border-white/10 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">
            {title}
          </h3>
          <p className="text-xs text-[#64748B] dark:text-slate-300">
            {transactions.length} registro{transactions.length !== 1 ? 's' : ''}
          </p>
        </div>
        {action}
      </div>

      {visible.length === 0 ? (
        <p className="p-6 text-center text-xs sm:text-sm text-[#64748B] dark:text-slate-300">
          {emptyMessage}
        </p>
      ) : (
        <>
          {/* Mobile View */}
          <div className="md:hidden divide-y divide-[#F1F5F9] dark:divide-white/10">
            {visible.map((t) => {
              const val = fromCents(getTransactionAmountCents(t));
              const isBillPay = isCardBillPaymentTransaction(t);
              const acc = accountById.get(t.accountId);
              const bankName = acc?.institutionName || t.account.split('·')[0]?.trim() || 'Banco';
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onEditTransaction?.(t)}
                  className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <BankLogo
                    bankName={bankName}
                    bankCode={acc?.bankCode}
                    logoUrl={acc?.logoUrl}
                    size={36}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[#0F172A] dark:text-white truncate">
                      {t.description}
                    </div>
                    <div className="text-[11px] text-[#64748B] dark:text-slate-300 mt-0.5 truncate">
                      {formatDateBR(t.date)} · {t.category} · {acc ? acc.accountName : t.entityId}
                      {t.isInternalTransfer ? ' · Transferência' : ''}
                      {isBillPay ? ' · Pagto Fatura' : ''}
                      {t.status === 'PENDING' ? ' · Pendente' : t.status === 'PLANNED' ? ' · Planejado' : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`font-money text-sm font-bold ${
                        t.direction === 'INCOME'
                          ? 'text-[#059669] dark:text-[#10B981]'
                          : 'text-[#DC3545] dark:text-red-400'
                      }`}
                    >
                      {hideValues
                        ? formatarValor(val, true)
                        : `${t.direction === 'INCOME' ? '+ ' : '− '}${formatarValor(val, false)}`}
                    </span>
                    {onEditTransaction && (
                      <ChevronRight size={14} strokeWidth={1.75} className="text-[#94A3B8]" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-[#F8FAFC] dark:bg-white/5 text-[#64748B] dark:text-slate-300 border-b border-[#E2E8F0] dark:border-white/10">
                  <th className="py-3 px-5 font-semibold">Data</th>
                  <th className="py-3 px-5 font-semibold">Descrição</th>
                  <th className="py-3 px-5 font-semibold">Categoria</th>
                  <th className="py-3 px-5 font-semibold">Situação</th>
                  <th className="py-3 px-5 font-semibold text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9] dark:divide-white/10">
                {visible.map((t) => {
                  const val = fromCents(getTransactionAmountCents(t));
                  const isBillPay = isCardBillPaymentTransaction(t);
                  const acc = accountById.get(t.accountId);
                  const bankName = acc?.institutionName || t.account.split('·')[0]?.trim() || 'Banco';
                  const statusLabel =
                    t.status === 'CONFIRMED'
                      ? 'Confirmado'
                      : t.status === 'PENDING'
                        ? 'Pendente'
                        : t.status === 'PLANNED'
                          ? 'Planejado'
                          : 'Cancelado';
                  return (
                    <tr
                      key={t.id}
                      onClick={() => onEditTransaction?.(t)}
                      className={
                        onEditTransaction
                          ? 'hover:bg-slate-50 dark:hover:bg-white/5 transition-colors cursor-pointer'
                          : ''
                      }
                    >
                      <td className="py-3 px-5 text-[#64748B] dark:text-slate-300 whitespace-nowrap">
                        {formatDateBR(t.date)}
                      </td>
                      <td className="py-3 px-5 font-medium text-[#0F172A] dark:text-white">
                        <div className="flex items-center gap-2.5">
                          <BankLogo
                            bankName={bankName}
                            bankCode={acc?.bankCode}
                            logoUrl={acc?.logoUrl}
                            size={28}
                          />
                          <div className="min-w-0">
                            <div className="truncate">{t.description}</div>
                            <div className="text-[11px] text-[#64748B] dark:text-slate-300">
                              {acc ? `${acc.institutionName} · ${acc.accountName}` : t.account} · {t.entityId}
                              {t.isInternalTransfer ? ' · Transferência interna' : ''}
                              {isBillPay ? ' · Pagamento de fatura' : ''}
                              {t.reviewRequired ? ' · Revisar classificação' : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-5 text-[#0F172A] dark:text-slate-200">{t.category}</td>
                      <td className="py-3 px-5 text-[#64748B] dark:text-slate-300">{statusLabel}</td>
                      <td
                        className={`font-money py-3 px-5 text-right font-bold whitespace-nowrap ${
                          t.direction === 'INCOME'
                            ? 'text-[#059669] dark:text-[#10B981]'
                            : 'text-[#DC3545] dark:text-red-400'
                        }`}
                      >
                        {hideValues
                          ? formatarValor(val, true)
                          : `${t.direction === 'INCOME' ? '+ ' : '− '}${formatarValor(val, false)}`}
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
  );
};
