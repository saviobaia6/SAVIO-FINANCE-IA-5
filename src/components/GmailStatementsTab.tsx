import React, { useEffect, useMemo, useState } from 'react';
import {
  Account,
  CategoryRule,
  CreditCard,
  Direction,
  Transaction,
} from '../types';
import {
  downloadGmailAttachmentBytes,
  getGmailMessageDetail,
  getWorkspaceAccessToken,
  GmailAttachmentMeta,
  GmailMessageDetail,
  GmailMessageSummary,
  searchGmailStatementMessages,
  signInWithGoogleWorkspace,
} from '../services/googleWorkspace';
import {
  autoDetectSpreadsheetColumns,
  buildImportBatchFingerprint,
  buildTransactionsFromMappedRows,
  mapSpreadsheetRowsForAccount,
  parseSpreadsheetBuffer,
} from '../domain/imports/SpreadsheetImportService';
import { CardEntryKind } from '../domain/cards/CardLedgerService';
import {
  ALL_CARD_CATEGORIES,
  auditCardCsvContent,
  auditCardInvoiceDocument,
  buildAuditedCardTransactions,
  classifyAuditedCategory,
  fileOrBufferToBase64,
} from '../domain/cards/CardInvoiceAuditorService';
import { decodeTextBuffer, parseOfxStatement } from '../domain/extractions/parsers/ofxParser';
import {
  extractTextFromPdfBufferAsync,
  parseTextualPdfContent,
} from '../domain/extractions/parsers/pdfAndImageParser';
import { detectBankFromStatementAsync } from '../domain/extractions/banksRepository';
import { categorizeTransactionDescription } from '../domain/transactions/CategorizationService';
import { isCardBillPaymentTransaction } from '../domain/accounts/BalanceCalculator';
import { checkDuplicateTransaction } from '../utils/financeCalculations';
import { fromCents, MoneyCents, toCents } from '../domain/money/money';
import { generateEntityId } from '../domain/common/id';
import { formatDateBR, todayLocal } from '../utils/dateUtils';
import { formatarValor } from '../utils/formatters';
import { usePrivacy } from '../contexts/PrivacyContext';
import { BankLogo } from './BankLogo';
import {
  AlertCircle,
  CheckCircle2,
  CreditCard as CreditCardIcon,
  FileSpreadsheet,
  FileText,
  Landmark,
  Mail,
  Paperclip,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react';

interface GmailStatementsTabProps {
  accounts: readonly Account[];
  creditCards?: readonly CreditCard[];
  transactions: readonly Transaction[];
  categoryRules?: readonly CategoryRule[];
  onImportAccountTransactions: (
    items: Omit<Transaction, 'id'>[],
    meta?: { fileName: string; batchFingerprint: string; accountId: string }
  ) => void;
  onImportCardTransactions?: (
    items: Omit<Transaction, 'id'>[],
    meta: { fileName: string; batchFingerprint: string; cardId: string }
  ) => void;
}

interface GmailParsedRow {
  rowId: string;
  date: string;
  description: string;
  amountCents: MoneyCents;
  amount: number;
  direction: Direction;
  category: string;
  cardEntryKind?: CardEntryKind;
  parcelaAtual?: number;
  totalParcelas?: number;
  externalId?: string;
  idempotencyKey?: string;
  isDuplicate: boolean;
  selected: boolean;
}

function parsePlainEmailBodyLines(text: string): Array<{
  date: string;
  description: string;
  amountCents: MoneyCents;
  direction: Direction;
}> {
  const lines = text
    .split(/\r?\n|(?<=\d{2}\/\d{2}\/\d{4})/)
    .map((l) => l.trim())
    .filter(Boolean);
  const currentYear = todayLocal().slice(0, 4);
  const out: Array<{
    date: string;
    description: string;
    amountCents: MoneyCents;
    direction: Direction;
  }> = [];

  for (const line of lines) {
    const dateMatch = line.match(/(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}(?:\/\d{2,4})?)/);
    const amtMatch = line.match(
      /([-+]?\s*R?\$?\s*\d{1,3}(?:\.\d{3})*,\d{2}|[-+]?\s*\d+\.\d{2})/
    );
    if (!dateMatch || !amtMatch) continue;

    let isoDate = todayLocal();
    const rawD = dateMatch[1];
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawD)) {
      isoDate = rawD;
    } else {
      const parts = rawD.split('/');
      const dd = parts[0].padStart(2, '0');
      const mm = parts[1].padStart(2, '0');
      const yy = parts[2]
        ? parts[2].length === 2
          ? `20${parts[2]}`
          : parts[2]
        : currentYear;
      isoDate = `${yy}-${mm}-${dd}`;
    }

    const cleanedAmt = amtMatch[1].replace(/[R$\s]/gi, '');
    const normalized = cleanedAmt.includes(',')
      ? cleanedAmt.replace(/\./g, '').replace(',', '.')
      : cleanedAmt;
    const num = Number(normalized);
    if (!Number.isFinite(num) || num === 0) continue;

    const direction: Direction =
      num > 0 && /cr[eé]dito|pix\s*recebido|estorno|entrada|dep[oó]sito/i.test(line)
        ? 'INCOME'
        : num < 0
          ? 'EXPENSE'
          : 'EXPENSE';

    const desc = line
      .replace(dateMatch[1], '')
      .replace(amtMatch[1], '')
      .replace(/\s+/g, ' ')
      .trim();

    out.push({
      date: isoDate,
      description: desc || 'Movimentação via Gmail',
      amountCents: toCents(Math.abs(num)),
      direction,
    });
  }
  return out;
}

export const GmailStatementsTab: React.FC<GmailStatementsTabProps> = ({
  accounts,
  creditCards = [],
  transactions,
  categoryRules = [],
  onImportAccountTransactions,
  onImportCardTransactions,
}) => {
  const { hideValues } = usePrivacy();
  const activeAccounts = useMemo(() => accounts.filter((a) => !a.archived), [accounts]);

  const [token, setToken] = useState<string | null>(() => getWorkspaceAccessToken());
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<GmailMessageSummary[]>([]);
  const [selectedDetail, setSelectedDetail] = useState<GmailMessageDetail | null>(null);
  const [activeAttachmentName, setActiveAttachmentName] = useState('');
  const [parsedRows, setParsedRows] = useState<GmailParsedRow[]>([]);
  const [detectedBankName, setDetectedBankName] = useState('');
  const [detectedBankCode, setDetectedBankCode] = useState<string | undefined>(undefined);

  const [destinationType, setDestinationType] = useState<'ACCOUNT' | 'CARD'>('ACCOUNT');
  const [targetAccountId, setTargetAccountId] = useState(activeAccounts[0]?.id || '');
  const [targetCardId, setTargetCardId] = useState(creditCards[0]?.id || '');

  const [busy, setBusy] = useState(false);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!activeAccounts.some((a) => a.id === targetAccountId)) {
      setTargetAccountId(activeAccounts[0]?.id || '');
    }
  }, [activeAccounts, targetAccountId]);

  useEffect(() => {
    if (!creditCards.some((c) => c.id === targetCardId)) {
      setTargetCardId(creditCards[0]?.id || '');
    }
  }, [creditCards, targetCardId]);

  const loadStatements = async (activeToken: string, customQ = query) => {
    setBusy(true);
    setErrorMsg('');
    try {
      const list = await searchGmailStatementMessages(activeToken, customQ, 15);
      setMessages(list);
      if (list.length === 0) {
        setStatusMsg('Nenhum e-mail com extrato ou fatura encontrado para esta busca.');
      } else {
        setStatusMsg(`${list.length} e-mail(s) financeiro(s) localizado(s) no Gmail.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao consultar Gmail.';
      if (msg.includes('401')) setToken(null);
      setErrorMsg(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleConnectGmail = async () => {
    setBusy(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const auth = await signInWithGoogleWorkspace();
      setToken(auth.accessToken);
      await loadStatements(auth.accessToken, query);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao conectar com o Gmail.');
      setBusy(false);
    }
  };

  const applyExtractedRows = (
    rawList: Array<{
      date: string;
      description: string;
      amountCents: MoneyCents;
      direction: Direction;
      category?: string;
      cardEntryKind?: CardEntryKind;
      parcelaAtual?: number;
      totalParcelas?: number;
      externalId?: string;
      idempotencyKey?: string;
    }>
  ) => {
    const confirmed = transactions.filter((t) => t.status === 'CONFIRMED');
    const nextRows: GmailParsedRow[] = rawList.map((r) => {
      const dup =
        (r.idempotencyKey && transactions.some((t) => t.idempotencyKey === r.idempotencyKey)) ||
        checkDuplicateTransaction(confirmed, {
          date: r.date,
          description: r.description,
          amount: fromCents(r.amountCents),
          amountCents: r.amountCents,
        });
      const catRes = categorizeTransactionDescription({
        description: r.description,
        direction: r.direction,
        customRules: [...categoryRules],
        fallbackCategory: r.category || (destinationType === 'CARD' ? 'Cartão' : 'Outros'),
      });
      return {
        rowId: generateEntityId('gmrow'),
        date: r.date,
        description: r.description,
        amountCents: r.amountCents,
        amount: fromCents(r.amountCents),
        direction: r.direction,
        category: r.category && r.category !== 'Outros' ? r.category : catRes.category,
        cardEntryKind: r.cardEntryKind,
        parcelaAtual: r.parcelaAtual,
        totalParcelas: r.totalParcelas,
        externalId: r.externalId,
        idempotencyKey: r.idempotencyKey,
        isDuplicate: dup,
        selected: !dup && r.amountCents > 0,
      };
    });
    setParsedRows(nextRows);
  };

  const handleInspectMessage = async (summary: GmailMessageSummary) => {
    if (!token) return;
    setBusy(true);
    setErrorMsg('');
    setStatusMsg('');
    setAwaitingConfirm(false);
    setActiveAttachmentName('');
    setParsedRows([]);

    try {
      const detail = await getGmailMessageDetail(token, summary.id);
      setSelectedDetail(detail);

      const detected = await detectBankFromStatementAsync(
        `${detail.from} ${detail.subject} ${detail.plainText.slice(0, 1200)}`,
        detail.subject
      );
      setDetectedBankName(detected.name || '');
      setDetectedBankCode(detected.code);

      if (/fatura|cart[aã]o/i.test(`${detail.subject} ${detail.snippet}`) && creditCards.length > 0) {
        setDestinationType('CARD');
      }

      const bodyRows = parsePlainEmailBodyLines(detail.plainText);
      if (bodyRows.length > 0) {
        applyExtractedRows(bodyRows);
        setStatusMsg(
          `Extraído(s) ${bodyRows.length} lançamento(s) do corpo do e-mail "${detail.subject}".`
        );
      } else if (detail.attachments.length > 0) {
        setStatusMsg(
          `E-mail aberto. Selecione um anexo abaixo (${detail.attachments.map((a) => a.filename).join(', ')}) para extrair os lançamentos.`
        );
      } else {
        setStatusMsg(
          'E-mail aberto sem lançamentos estruturados no texto. Você pode buscar outro extrato ou anexo.'
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao abrir mensagem do Gmail.';
      if (msg.includes('401')) setToken(null);
      setErrorMsg(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleReadAttachment = async (att: GmailAttachmentMeta) => {
    if (!token || !selectedDetail) return;
    setBusy(true);
    setErrorMsg('');
    setStatusMsg('');
    setAwaitingConfirm(false);

    try {
      const buffer = await downloadGmailAttachmentBytes(token, selectedDetail.id, att.attachmentId);
      const lower = att.filename.toLowerCase();
      setActiveAttachmentName(att.filename);

      const isLikelyCardEmail =
        destinationType === 'CARD' ||
        /fatura|cart[aã]o|mastercard|visa|elo|amex|nubank.*fatura/i.test(
          `${selectedDetail.subject} ${att.filename}`
        );

      if (lower.endsWith('.csv') && isLikelyCardEmail && creditCards.length > 0 && onImportCardTransactions) {
        const csvText = decodeTextBuffer(buffer);
        const audited = auditCardCsvContent(csvText, att.filename);
        if (audited.transacoes.length > 0) {
          setDestinationType('CARD');
          applyExtractedRows(
            audited.transacoes.map((t) => {
              const isReversal = t.valor < 0;
              const isFee = !isReversal && /\b(iof|tarifa|anuidade|juros|multa)\b/i.test(t.descricao);
              const isInst = !isReversal && (t.tipo === 'parcelada' || t.total_parcelas > 1);
              return {
                date: t.data,
                description: isInst ? `${t.descricao} (${t.parcela_atual}/${t.total_parcelas})` : t.descricao,
                amountCents: toCents(Math.abs(t.valor)),
                direction: isReversal ? 'INCOME' : 'EXPENSE',
                category: t.categoria,
                cardEntryKind: isReversal ? 'REVERSAL' : isFee ? 'FEE' : isInst ? 'INSTALLMENT' : 'PURCHASE',
                parcelaAtual: t.parcela_atual,
                totalParcelas: t.total_parcelas,
              };
            })
          );
          setStatusMsg(
            `Auditor Financeiro extraiu ${audited.transacoes.length} lançamento(s) da fatura CSV "${att.filename}".`
          );
          return;
        }
      }

      if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) {
        const wb = parseSpreadsheetBuffer(buffer, att.filename, 'LOCAL_EXCEL_CSV');
        const firstSheet = wb.sheets[0];
        if (!firstSheet) {
          setErrorMsg('A planilha anexada não possui linhas válidas.');
          return;
        }
        const mapping = autoDetectSpreadsheetColumns(firstSheet.rows);
        const refAccount = activeAccounts.find((a) => a.id === targetAccountId) || activeAccounts[0];
        if (refAccount) {
          const mapped = mapSpreadsheetRowsForAccount({
            rows: firstSheet.rows,
            mapping,
            targetAccount: refAccount,
            existingTransactions: transactions,
            categoryRules,
          });
          applyExtractedRows(
            mapped.map((m) => ({
              date: m.date,
              description: m.description,
              amountCents: m.amountCents,
              direction: m.direction,
              category: m.category,
              externalId: m.externalId,
              idempotencyKey: m.idempotencyKey,
            }))
          );
          setStatusMsg(`${mapped.length} linha(s) lida(s) do anexo "${att.filename}".`);
        }
      } else if (lower.endsWith('.ofx')) {
        const text = decodeTextBuffer(buffer);
        const ofx = parseOfxStatement(text, att.filename);
        const bank = await detectBankFromStatementAsync(text, att.filename);
        if (bank.name) {
          setDetectedBankName(bank.name);
          setDetectedBankCode(bank.code);
        }
        applyExtractedRows(
          ofx.rows.map((r) => ({
            date: r.date || todayLocal(),
            description: r.description,
            amountCents: toCents(Math.abs(fromCents(r.amountSignedCents))),
            direction: r.amountSignedCents >= 0 ? 'INCOME' : 'EXPENSE',
            externalId: r.bankTransactionId,
          }))
        );
        setStatusMsg(`${ofx.rows.length} movimento(s) OFX lido(s) do anexo "${att.filename}".`);
      } else if (lower.endsWith('.pdf') || /\.(png|jpg|jpeg|webp)$/i.test(lower)) {
        if (lower.endsWith('.pdf') && !isLikelyCardEmail) {
          const pdfRes = await extractTextFromPdfBufferAsync(buffer);
          const parsedPdf = parseTextualPdfContent(pdfRes.text, att.filename);
          if (parsedPdf.identifiedAccount.bankName) {
            setDetectedBankName(parsedPdf.identifiedAccount.bankName);
            setDetectedBankCode(parsedPdf.identifiedAccount.bankCode);
          }
          if (parsedPdf.rows.length > 0) {
            applyExtractedRows(
              parsedPdf.rows.map((r) => ({
                date: r.date || todayLocal(),
                description: r.description,
                amountCents: toCents(Math.abs(fromCents(r.amountSignedCents))),
                direction: r.amountSignedCents >= 0 ? 'INCOME' : 'EXPENSE',
                externalId: r.bankTransactionId,
              }))
            );
            setStatusMsg(`${parsedPdf.rows.length} linha(s) extraída(s) do PDF "${att.filename}".`);
            return;
          }
        }

        // Fallback / Card invoice audit via /api/ai/audit-card-invoice
        const mime = lower.endsWith('.pdf')
          ? 'application/pdf'
          : lower.endsWith('.png')
            ? 'image/png'
            : lower.endsWith('.webp')
              ? 'image/webp'
              : 'image/jpeg';
        const base64Data = await fileOrBufferToBase64(buffer);
        const audited = await auditCardInvoiceDocument({
          fileName: att.filename,
          mimeType: mime,
          base64Data,
        });
        if (audited.transacoes.length === 0) {
          setErrorMsg(
            `Nenhuma transação legível encontrada no anexo "${att.filename}".`
          );
          return;
        }
        if (isLikelyCardEmail && creditCards.length > 0) {
          setDestinationType('CARD');
        }
        applyExtractedRows(
          audited.transacoes.map((t) => {
            const isReversal = t.valor < 0;
            const isFee = !isReversal && /\b(iof|tarifa|anuidade|juros|multa)\b/i.test(t.descricao);
            const isInst = !isReversal && (t.tipo === 'parcelada' || t.total_parcelas > 1);
            return {
              date: t.data,
              description: isInst ? `${t.descricao} (${t.parcela_atual}/${t.total_parcelas})` : t.descricao,
              amountCents: toCents(Math.abs(t.valor)),
              direction: isReversal ? 'INCOME' : 'EXPENSE',
              category: t.categoria,
              cardEntryKind: isReversal ? 'REVERSAL' : isFee ? 'FEE' : isInst ? 'INSTALLMENT' : 'PURCHASE',
              parcelaAtual: t.parcela_atual,
              totalParcelas: t.total_parcelas,
            };
          })
        );
        setStatusMsg(
          `Auditor IA extraiu ${audited.transacoes.length} lançamento(s) de "${att.filename}".`
        );
      } else {
        setErrorMsg(
          `Formato do anexo "${att.filename}" ainda não suportado. Utilize .pdf, .png, .jpg, .ofx, .csv, .xlsx ou .xls.`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao processar anexo do Gmail.';
      if (msg.includes('401')) setToken(null);
      setErrorMsg(msg);
    } finally {
      setBusy(false);
    }
  };

  const selectedCount = parsedRows.filter((r) => r.selected && r.amountCents > 0).length;

  const commitImport = () => {
    const chosen = parsedRows.filter((r) => r.selected && r.amountCents > 0);
    if (chosen.length === 0) {
      setErrorMsg('Selecione ao menos um lançamento para importar.');
      setAwaitingConfirm(false);
      return;
    }

    const label = activeAttachmentName || selectedDetail?.subject || 'Extrato Gmail';
    const batchId = buildImportBatchFingerprint({
      fileName: label,
      sheetName: selectedDetail?.id || 'gmail',
      accountId: destinationType === 'CARD' ? targetCardId : targetAccountId,
      rowCount: chosen.length,
      sampleSignature: chosen.slice(0, 3).map((r) => r.description).join('|'),
    });

    if (destinationType === 'CARD') {
      const card = creditCards.find((c) => c.id === targetCardId);
      if (!card || !onImportCardTransactions) {
        setErrorMsg('Selecione um cartão de crédito válido.');
        setAwaitingConfirm(false);
        return;
      }

      const mappedCard = chosen.map((r, idx) => {
        const curP = r.parcelaAtual || 1;
        const totP = r.totalParcelas || 1;
        const kind: CardEntryKind =
          r.cardEntryKind ||
          (r.direction === 'INCOME' ? 'REVERSAL' : totP > 1 ? 'INSTALLMENT' : 'PURCHASE');
        return {
          rowId: r.rowId,
          sourceRowIndex: idx + 1,
          date: r.date,
          purchaseDate: r.date,
          postingDate: r.date,
          description: r.description,
          amountCents: r.amountCents,
          amount: r.amount,
          direction: r.direction,
          category: r.category || 'Outros',
          operationType: (kind === 'FEE' ? 'TARIFA' : 'CARTAO') as 'TARIFA' | 'CARTAO',
          cardEntryKind: kind,
          installmentCurrent: totP > 1 ? curP : undefined,
          installmentTotal: totP > 1 ? totP : undefined,
          auditedTipo: (totP > 1 ? 'parcelada' : 'avista') as 'parcelada' | 'avista',
          parcelaAtual: curP,
          totalParcelas: totP,
          auditedCategory: classifyAuditedCategory(r.description, r.category),
          idempotencyKey:
            r.idempotencyKey || `gmail-card-${card.id}-${r.date}-${r.amountCents}-${r.rowId}`,
          isDuplicate: r.isDuplicate,
          hasValidationError: false,
          selected: true,
        };
      });

      const cardTxs = buildAuditedCardTransactions({
        rows: mappedCard,
        targetCard: card,
        importBatchId: batchId,
        generateFutureInstallments: true,
        existingTransactions: transactions,
      });

      onImportCardTransactions(cardTxs, {
        fileName: label,
        batchFingerprint: batchId,
        cardId: card.id,
      });
      const futureCount = cardTxs.filter((t) => t.status === 'PENDING').length;
      setStatusMsg(
        `${cardTxs.length} lançamento(s) do Gmail importado(s) para o cartão ${card.cardName}${
          futureCount > 0 ? ` (${futureCount} parcela(s) futura(s) gerada(s))` : ''
        }.`
      );
      setParsedRows([]);
      setAwaitingConfirm(false);
      return;
    }

    const acc = activeAccounts.find((a) => a.id === targetAccountId);
    if (!acc) {
      setErrorMsg('Selecione uma conta bancária de destino.');
      setAwaitingConfirm(false);
      return;
    }

    const mappedAcc = buildTransactionsFromMappedRows({
      rows: chosen.map((r) => ({
        rowId: r.rowId,
        sourceRowIndex: 1,
        date: r.date,
        description: r.description,
        amountCents: r.amountCents,
        amount: r.amount,
        direction: r.direction,
        category: r.category,
        operationType: /pix/i.test(r.description)
          ? 'PIX'
          : /boleto/i.test(r.description)
            ? 'BOLETO'
            : 'OUTRO',
        externalId: r.externalId,
        idempotencyKey:
          r.idempotencyKey || `gmail-acc-${acc.id}-${r.date}-${r.amountCents}-${r.rowId}`,
        isDuplicate: r.isDuplicate,
        hasValidationError: false,
        selected: true,
      })),
      targetAccount: acc,
      importBatchId: batchId,
    }).map((t) => ({
      ...t,
      ...(isCardBillPaymentTransaction(t) ? { isCardBillPayment: true } : {}),
    }));

    onImportAccountTransactions(mappedAcc, {
      fileName: label,
      batchFingerprint: batchId,
      accountId: acc.id,
    });
    setStatusMsg(
      `${mappedAcc.length} lançamento(s) do Gmail importado(s) para ${acc.institutionName} · ${acc.accountName}.`
    );
    setParsedRows([]);
    setAwaitingConfirm(false);
  };

  return (
    <div className="space-y-4 min-w-0">
      <div className="sf-card p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="sf-icon-badge shrink-0">
              <Mail size={18} strokeWidth={2} />
            </span>
            <div>
              <h3 className="font-display text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">
                Leitor de Extratos e Faturas no Gmail
              </h3>
              <p className="text-xs text-[#64748B] dark:text-slate-400">
                Consulte e-mails financeiros e leia anexos (.pdf, .ofx, .csv, .xlsx) antes de confirmar a importação.
              </p>
            </div>
          </div>

          {!token ? (
            <button
              type="button"
              onClick={handleConnectGmail}
              disabled={busy}
              className="min-h-11 px-4 rounded-xl bg-[#061E3E] hover:bg-[#0F172A] dark:bg-[#059669] dark:hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
            >
              <Mail size={15} /> Conectar Gmail
            </button>
          ) : (
            <button
              type="button"
              onClick={() => loadStatements(token, query)}
              disabled={busy}
              className="min-h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-[#0F172A] dark:text-white flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Atualizar caixa
            </button>
          )}
        </div>

        {token && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void loadStatements(token, query);
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <div className="relative flex-1">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                placeholder="Buscar no Gmail (ex.: fatura nubank, extrato itau, has:attachment)..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full min-h-11 pl-9 pr-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs sm:text-sm text-[#0F172A] dark:text-white"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="min-h-11 px-4 rounded-xl bg-[#061E3E] dark:bg-[#059669] text-white text-xs font-bold cursor-pointer"
            >
              Buscar e-mails
            </button>
          </form>
        )}

        {statusMsg && (
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
            <CheckCircle2 size={15} className="shrink-0" />
            <span>{statusMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-xs font-semibold text-red-700 dark:text-red-300 flex items-center gap-2">
            <AlertCircle size={15} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      {/* Email List & Detail Reader */}
      {token && messages.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          <div className="lg:col-span-5 sf-card overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 text-xs font-bold text-[#0F172A] dark:text-white">
              Mensagens financeiras ({messages.length})
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-96 overflow-y-auto">
              {messages.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleInspectMessage(m)}
                  className={`w-full text-left p-3.5 transition-colors cursor-pointer ${
                    selectedDetail?.id === m.id
                      ? 'bg-emerald-50/70 dark:bg-emerald-950/30'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-bold text-[#0F172A] dark:text-white line-clamp-1">
                      {m.subject}
                    </span>
                    {m.hasAttachments && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-[#059669] shrink-0">
                        <Paperclip size={11} /> {m.attachments.length}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[#64748B] dark:text-slate-400 truncate mt-0.5">
                    {m.from}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate mt-0.5">
                    {m.snippet}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-7 sf-card p-4 space-y-3.5 min-w-0">
            {!selectedDetail ? (
              <div className="py-10 text-center text-xs text-[#64748B] dark:text-slate-400">
                Selecione um e-mail à esquerda para ler o extrato ou abrir seus anexos.
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <BankLogo
                      bankName={detectedBankName || selectedDetail.from}
                      bankCode={detectedBankCode}
                      size={36}
                    />
                    <div className="min-w-0">
                      <h4 className="font-display text-sm font-bold text-[#0F172A] dark:text-white truncate">
                        {selectedDetail.subject}
                      </h4>
                      <p className="text-[11px] text-[#64748B] dark:text-slate-400 truncate">
                        {selectedDetail.from}
                      </p>
                    </div>
                  </div>
                </div>

                {selectedDetail.attachments.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-bold text-[#64748B] dark:text-slate-400 block">
                      Anexos do e-mail (clique para ler extrato):
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {selectedDetail.attachments.map((att) => (
                        <button
                          key={att.attachmentId}
                          type="button"
                          disabled={busy}
                          onClick={() => handleReadAttachment(att)}
                          className={`min-h-10 px-3 rounded-xl border text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                            activeAttachmentName === att.filename
                              ? 'bg-[#061E3E] text-white border-[#061E3E] dark:bg-[#059669] dark:border-[#059669]'
                              : 'border-slate-200 dark:border-slate-700 text-[#0F172A] dark:text-white hover:border-[#059669]'
                          }`}
                        >
                          {att.filename.toLowerCase().endsWith('.pdf') ? (
                            <FileText size={14} />
                          ) : (
                            <FileSpreadsheet size={14} />
                          )}
                          <span className="truncate max-w-[180px]">{att.filename}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {selectedDetail.plainText && (
                  <details className="rounded-xl border border-slate-200 dark:border-slate-700 p-2.5 text-xs">
                    <summary className="cursor-pointer font-semibold text-[#64748B] dark:text-slate-300">
                      Ver texto do e-mail ({selectedDetail.plainText.length} caracteres)
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap text-[11px] text-[#0F172A] dark:text-slate-200 max-h-40 overflow-y-auto font-sans">
                      {selectedDetail.plainText}
                    </pre>
                  </details>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Extracted Preview & Target Confirmation */}
      {parsedRows.length > 0 && (
        <div className="sf-card p-4 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h4 className="font-display text-sm font-bold text-[#0F172A] dark:text-white">
                Pré-visualização do Extrato do Gmail ({parsedRows.length} registros)
              </h4>
              <p className="text-[11px] text-[#64748B] dark:text-slate-400">
                Escolha a conta ou cartão de destino e confirme antes de gravar no financeiro.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setDestinationType('ACCOUNT')}
                  className={`min-h-9 px-2.5 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer ${
                    destinationType === 'ACCOUNT'
                      ? 'bg-white dark:bg-slate-900 text-[#0F172A] dark:text-white shadow-xs'
                      : 'text-slate-500'
                  }`}
                >
                  <Landmark size={13} /> Conta
                </button>
                {creditCards.length > 0 && onImportCardTransactions && (
                  <button
                    type="button"
                    onClick={() => setDestinationType('CARD')}
                    className={`min-h-9 px-2.5 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer ${
                      destinationType === 'CARD'
                        ? 'bg-white dark:bg-slate-900 text-[#0F172A] dark:text-white shadow-xs'
                        : 'text-slate-500'
                    }`}
                  >
                    <CreditCardIcon size={13} /> Cartão
                  </button>
                )}
              </div>

              {destinationType === 'ACCOUNT' ? (
                <select
                  value={targetAccountId}
                  onChange={(e) => setTargetAccountId(e.target.value)}
                  className="min-h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-[#0F172A] dark:text-white"
                >
                  {activeAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.institutionName} · {a.accountName} ({a.entityId})
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  value={targetCardId}
                  onChange={(e) => setTargetCardId(e.target.value)}
                  className="min-h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-[#0F172A] dark:text-white"
                >
                  {creditCards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.institutionName} · {c.cardName} (•••• {c.last4})
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-80 overflow-y-auto border border-slate-100 dark:border-slate-800 rounded-xl">
            {parsedRows.map((row) => (
              <div
                key={row.rowId}
                className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <label className="flex items-start gap-2.5 min-w-0 flex-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={row.selected}
                    onChange={(e) =>
                      setParsedRows((prev) =>
                        prev.map((item) =>
                          item.rowId === row.rowId
                            ? { ...item, selected: e.target.checked }
                            : item
                        )
                      )
                    }
                    className="w-4 h-4 mt-0.5 accent-emerald-600 shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#0F172A] dark:text-white truncate">
                      {row.description}
                    </div>
                    <div className="text-[11px] text-[#64748B] dark:text-slate-400 flex flex-wrap gap-1.5">
                      <span>{formatDateBR(row.date)}</span>
                      {row.isDuplicate && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[10px] font-bold">
                          Possível duplicidade
                        </span>
                      )}
                    </div>
                  </div>
                </label>

                <div className="flex items-center justify-between sm:justify-end gap-2 pl-6 sm:pl-0 shrink-0">
                  <select
                    value={row.category}
                    onChange={(e) =>
                      setParsedRows((prev) =>
                        prev.map((item) =>
                          item.rowId === row.rowId
                            ? { ...item, category: e.target.value }
                            : item
                        )
                      )
                    }
                    className="min-h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px]"
                  >
                    {ALL_CARD_CATEGORIES.map((c: string) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <span
                    className={`font-money text-xs font-extrabold ${
                      row.direction === 'INCOME'
                        ? 'text-[#059669] dark:text-[#10B981]'
                        : 'text-red-700 dark:text-red-400'
                    }`}
                  >
                    {row.direction === 'INCOME' ? '+ ' : '− '}
                    {formatarValor(row.amount, hideValues)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {awaitingConfirm ? (
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 space-y-2">
              <div className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200 font-semibold">
                <ShieldAlert size={16} className="shrink-0 mt-0.5" />
                <span>
                  Confirmar gravação de {selectedCount} lançamento(s) extraído(s) do Gmail no{' '}
                  {destinationType === 'CARD' ? 'cartão de crédito' : 'extrato bancário'} selecionado?
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAwaitingConfirm(false)}
                  className="min-h-10 px-4 rounded-xl border border-amber-300 dark:border-amber-700 text-xs font-semibold text-amber-900 dark:text-amber-200 cursor-pointer"
                >
                  Revisar
                </button>
                <button
                  type="button"
                  onClick={commitImport}
                  className="min-h-10 px-4 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                >
                  Sim, confirmar importação
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end">
              <button
                type="button"
                disabled={selectedCount === 0}
                onClick={() => setAwaitingConfirm(true)}
                className="min-h-11 px-5 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold disabled:opacity-40 cursor-pointer"
              >
                Revisar e importar {selectedCount} lançamento(s)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
