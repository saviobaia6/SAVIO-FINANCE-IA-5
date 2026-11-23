import React, { useEffect, useMemo, useState } from 'react';
import {
  CategoryRule,
  CreditCard,
  Transaction,
} from '../../types';
import {
  autoDetectSpreadsheetColumns,
  buildImportBatchFingerprint,
  ParsedSpreadsheetWorkbook,
  parseSpreadsheetBuffer,
  parseSpreadsheetGrid,
  SpreadsheetColumnMapping,
} from '../../domain/imports/SpreadsheetImportService';
import {
  buildCardTransactionsFromMappedRows,
  CARD_ENTRY_KIND_LABELS,
  CardEntryKind,
  MappedCardSpreadsheetRow,
  mapSpreadsheetRowsForCard,
} from '../../domain/cards/CardLedgerService';
import {
  ALL_CARD_CATEGORIES,
  auditCardCsvContent,
  auditCardInvoiceDocument,
  AuditedInvoiceResult,
  buildAuditedCardTransactions,
  computeAuditedCardMetrics,
  fileOrBufferToBase64,
  mapAuditedInvoiceToCardRows,
  MappedAuditedCardRow,
} from '../../domain/cards/CardInvoiceAuditorService';
import {
  downloadDriveFileArrayBuffer,
  DrivePickedFile,
  fetchGoogleSpreadsheetMetadata,
  fetchGoogleSheetValues,
  getWorkspaceAccessToken,
  GoogleSpreadsheetMetadata,
  listDriveSpreadsheetFiles,
  openGoogleDrivePicker,
  signInWithGoogleWorkspace,
} from '../../services/googleWorkspace';
import { decodeTextBuffer } from '../../domain/extractions/parsers/ofxParser';
import { fromCents } from '../../domain/money/money';
import { formatDateBR } from '../../utils/dateUtils';
import { formatarValor } from '../../utils/formatters';
import { usePrivacy } from '../../contexts/PrivacyContext';
import { BankLogo } from '../BankLogo';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Cloud,
  Code2,
  Copy,
  FileSpreadsheet,
  FolderOpen,
  Layers,
  ReceiptText,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Upload,
  Wallet,
} from 'lucide-react';

interface CardSpreadsheetImportTabProps {
  card: CreditCard;
  transactions: readonly Transaction[];
  categoryRules?: readonly CategoryRule[];
  onCommitCardImport: (
    items: Omit<Transaction, 'id'>[],
    meta: { fileName: string; batchFingerprint: string; cardId: string }
  ) => { acceptedCount: number; skippedDuplicatesCount: number };
}

function inferInvoiceMimeType(fileName: string, rawMime?: string): string {
  const low = fileName.toLowerCase();
  if (low.endsWith('.pdf')) return 'application/pdf';
  if (low.endsWith('.png')) return 'image/png';
  if (low.endsWith('.webp')) return 'image/webp';
  if (low.endsWith('.jpg') || low.endsWith('.jpeg')) return 'image/jpeg';
  if (low.endsWith('.csv')) return 'text/csv';
  return rawMime || 'application/octet-stream';
}

function isAuditorFile(fileName: string, rawMime?: string): boolean {
  const low = fileName.toLowerCase();
  const mime = (rawMime || '').toLowerCase();
  return (
    low.endsWith('.pdf') ||
    low.endsWith('.png') ||
    low.endsWith('.jpg') ||
    low.endsWith('.jpeg') ||
    low.endsWith('.webp') ||
    low.endsWith('.csv') ||
    mime.includes('pdf') ||
    mime.startsWith('image/') ||
    mime.includes('csv')
  );
}

export const CardSpreadsheetImportTab: React.FC<CardSpreadsheetImportTabProps> = ({
  card,
  transactions,
  categoryRules = [],
  onCommitCardImport,
}) => {
  const { hideValues } = usePrivacy();
  const [sourceMode, setSourceMode] = useState<'AUDITOR' | 'SPREADSHEET' | 'DRIVE'>('AUDITOR');

  // Spreadsheet mapping mode state (.xlsx, .xls, or manual CSV column mapping)
  const [workbook, setWorkbook] = useState<ParsedSpreadsheetWorkbook | null>(null);
  const [selectedSheetIndex, setSelectedSheetIndex] = useState(0);
  const [mapping, setMapping] = useState<SpreadsheetColumnMapping | null>(null);
  const [mappedRows, setMappedRows] = useState<MappedCardSpreadsheetRow[]>([]);

  // Financial Auditor AI / CSV mode state (.pdf, .png, .jpg, .webp, .csv)
  const [auditedFileName, setAuditedFileName] = useState('');
  const [auditedRawContext, setAuditedRawContext] = useState<{
    fileName: string;
    mimeType: string;
    base64Data: string;
    csvText?: string;
  } | null>(null);
  const [auditedResult, setAuditedResult] = useState<AuditedInvoiceResult | null>(null);
  const [auditedRows, setAuditedRows] = useState<MappedAuditedCardRow[]>([]);
  const [generateFutureInstallments, setGenerateFutureInstallments] = useState(true);
  const [showRawJson, setShowRawJson] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [token, setToken] = useState<string | null>(() => getWorkspaceAccessToken());
  const [driveFiles, setDriveFiles] = useState<DrivePickedFile[]>([]);
  const [selectedGoogleMeta, setSelectedGoogleMeta] =
    useState<GoogleSpreadsheetMetadata | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const activeSheet = useMemo(
    () => workbook?.sheets[selectedSheetIndex] || workbook?.sheets[0] || null,
    [workbook, selectedSheetIndex]
  );

  useEffect(() => {
    if (!activeSheet) {
      setMappedRows([]);
      return;
    }
    const effective = mapping || autoDetectSpreadsheetColumns(activeSheet.rows);
    if (!mapping) setMapping(effective);
    const nextRows = mapSpreadsheetRowsForCard({
      rows: activeSheet.rows,
      mapping: effective,
      targetCard: card,
      existingTransactions: transactions,
      categoryRules,
    });
    setMappedRows(nextRows);
  }, [activeSheet, mapping, card, transactions, categoryRules]);

  // Recompute audited mapped rows whenever card or existing transactions change
  useEffect(() => {
    if (!auditedResult) {
      setAuditedRows([]);
      return;
    }
    setAuditedRows(
      mapAuditedInvoiceToCardRows({
        audited: auditedResult,
        targetCard: card,
        existingTransactions: transactions,
        categoryRules,
      })
    );
  }, [auditedResult, card, transactions, categoryRules]);

  const auditedMetrics = useMemo(
    () => (auditedResult ? computeAuditedCardMetrics(auditedResult) : null),
    [auditedResult]
  );

  const batchFingerprint = useMemo(() => {
    if (auditedResult) {
      const sampleSig = auditedResult.transacoes
        .slice(0, 5)
        .map((t) => `${t.data}|${t.descricao}|${t.valor}`)
        .join('~');
      return buildImportBatchFingerprint({
        fileName: auditedFileName || 'fatura_auditada',
        sheetName: 'auditor_fatura',
        accountId: card.id,
        rowCount: auditedResult.transacoes.length,
        sampleSignature: sampleSig,
      });
    }
    if (!workbook || !activeSheet) return '';
    const sampleSig = activeSheet.rows
      .slice(0, 5)
      .map((r) => r.join('|'))
      .join('~');
    return buildImportBatchFingerprint({
      fileName: workbook.fileName,
      sheetName: activeSheet.name,
      accountId: card.id,
      rowCount: activeSheet.rows.length,
      sampleSignature: sampleSig,
    });
  }, [auditedResult, auditedFileName, workbook, activeSheet, card.id]);

  const processBufferForCard = async (
    buffer: ArrayBuffer,
    fileName: string,
    rawMime?: string,
    forceAiForCsv = false
  ) => {
    const mime = inferInvoiceMimeType(fileName, rawMime);
    const lower = fileName.toLowerCase();

    setErrorMsg('');
    setStatusMsg('');
    setAwaitingConfirm(false);
    setSelectedGoogleMeta(null);

    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      setAuditedResult(null);
      setAuditedRawContext(null);
      const parsed = parseSpreadsheetBuffer(buffer, fileName, 'LOCAL_EXCEL_CSV');
      if (parsed.sheets.length === 0) {
        setErrorMsg('A planilha selecionada não possui dados válidos.');
        setWorkbook(null);
        return;
      }
      setWorkbook(parsed);
      setSelectedSheetIndex(0);
      setMapping(autoDetectSpreadsheetColumns(parsed.sheets[0].rows));
      setStatusMsg(`Planilha "${fileName}" carregada para mapeamento de colunas.`);
      return;
    }

    // CSV: run deterministic local auditor immediately (and keep context for optional AI re-audit)
    if (lower.endsWith('.csv') || mime.includes('csv')) {
      const csvText = decodeTextBuffer(buffer);
      const base64Data = await fileOrBufferToBase64(buffer);
      setAuditedRawContext({ fileName, mimeType: 'text/csv', base64Data, csvText });
      setAuditedFileName(fileName);
      setWorkbook(null);

      if (forceAiForCsv) {
        setBusy(true);
        try {
          const aiRes = await auditCardInvoiceDocument({
            fileName,
            mimeType: 'text/csv',
            base64Data,
            textContent: csvText,
          });
          setAuditedResult(aiRes);
          setStatusMsg(
            `Auditor IA analisou "${fileName}": ${aiRes.transacoes.length} lançamento(s) extraído(s) sem pagamentos de fatura anterior.`
          );
        } finally {
          setBusy(false);
        }
        return;
      }

      const csvAudited = auditCardCsvContent(csvText, fileName);
      if (csvAudited.transacoes.length > 0) {
        setAuditedResult(csvAudited);
        setStatusMsg(
          `Auditor Financeiro leu "${fileName}": ${csvAudited.transacoes.length} lançamento(s) válidos (pagamentos/limites ignorados).`
        );
      } else {
        // Fallback to manual spreadsheet column mapping if CSV layout is custom
        const parsed = parseSpreadsheetBuffer(buffer, fileName, 'LOCAL_EXCEL_CSV');
        if (parsed.sheets.length > 0) {
          setAuditedResult(null);
          setWorkbook(parsed);
          setSelectedSheetIndex(0);
          setMapping(autoDetectSpreadsheetColumns(parsed.sheets[0].rows));
          setStatusMsg(`CSV "${fileName}" aberto no mapeamento manual de colunas.`);
        } else {
          setErrorMsg(
            'Nenhuma transação de compra ou estorno foi identificada no CSV. Você pode tentar "Reanalisar com IA".'
          );
        }
      }
      return;
    }

    // PDF or Image/Print -> send to server-side Financial Auditor (/api/ai/audit-card-invoice)
    if (isAuditorFile(fileName, mime)) {
      setWorkbook(null);
      setBusy(true);
      try {
        const base64Data = await fileOrBufferToBase64(buffer);
        setAuditedRawContext({ fileName, mimeType: mime, base64Data });
        setAuditedFileName(fileName);
        const aiRes = await auditCardInvoiceDocument({
          fileName,
          mimeType: mime,
          base64Data,
        });
        setAuditedResult(aiRes);
        if (aiRes.transacoes.length === 0) {
          setErrorMsg(
            `Nenhuma compra, tarifa ou estorno identificado em "${fileName}". Verifique se o arquivo está legível.`
          );
        } else {
          setStatusMsg(
            `Auditor Financeiro extraiu ${aiRes.transacoes.length} transação(ões) de "${fileName}" (pagamentos anteriores e limites ignorados).`
          );
        }
      } catch (err) {
        setAuditedResult(null);
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Falha ao auditar a fatura em PDF/imagem.'
        );
      } finally {
        setBusy(false);
      }
      return;
    }

    setErrorMsg('Formato não suportado. Envie PDF, PNG, JPG, WEBP, CSV ou Excel (.xlsx/.xls).');
  };

  const handleLocalFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      if (sourceMode === 'SPREADSHEET' && file.name.toLowerCase().endsWith('.csv')) {
        // Explicit spreadsheet column-mapping mode requested by user
        setAuditedResult(null);
        setAuditedRawContext(null);
        const parsed = parseSpreadsheetBuffer(buffer, file.name, 'LOCAL_EXCEL_CSV');
        if (parsed.sheets.length === 0) {
          setErrorMsg('A planilha selecionada não possui dados válidos.');
          setWorkbook(null);
          return;
        }
        setWorkbook(parsed);
        setSelectedSheetIndex(0);
        setMapping(autoDetectSpreadsheetColumns(parsed.sheets[0].rows));
        return;
      }
      await processBufferForCard(buffer, file.name, file.type);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Falha ao ler o arquivo selecionado.'
      );
    }
  };

  const handleReanalyzeWithAi = async () => {
    if (!auditedRawContext) return;
    setBusy(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const aiRes = await auditCardInvoiceDocument({
        fileName: auditedRawContext.fileName,
        mimeType: auditedRawContext.mimeType,
        base64Data: auditedRawContext.base64Data,
        textContent: auditedRawContext.csvText,
      });
      setAuditedResult(aiRes);
      setStatusMsg(
        `Auditoria por IA concluída: ${aiRes.transacoes.length} transação(ões) extraída(s).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao reanalisar com IA.');
    } finally {
      setBusy(false);
    }
  };

  const handleConnectGoogle = async () => {
    setBusy(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const res = await signInWithGoogleWorkspace();
      setToken(res.accessToken);
      setStatusMsg('Google Drive conectado com sucesso.');
      const recent = await listDriveSpreadsheetFiles(res.accessToken).catch(() => []);
      setDriveFiles(recent);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao conectar com Google.');
    } finally {
      setBusy(false);
    }
  };

  const loadDriveFile = async (activeToken: string, file: DrivePickedFile) => {
    setBusy(true);
    setErrorMsg('');
    setStatusMsg('');
    setAwaitingConfirm(false);
    try {
      if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
        setAuditedResult(null);
        setAuditedRawContext(null);
        const meta = await fetchGoogleSpreadsheetMetadata(activeToken, file.id);
        setSelectedGoogleMeta(meta);
        const firstTab = meta.sheets[0]?.title || 'Planilha1';
        const values = await fetchGoogleSheetValues(activeToken, meta.spreadsheetId, firstTab);
        const parsed = parseSpreadsheetGrid(
          values,
          meta.title || file.name,
          firstTab,
          'GOOGLE_SHEETS'
        );
        if (parsed.sheets.length === 0) {
          setErrorMsg('A aba selecionada da planilha Google Sheets está vazia.');
          setWorkbook(null);
          return;
        }
        setWorkbook(parsed);
        setSelectedSheetIndex(0);
        setMapping(autoDetectSpreadsheetColumns(parsed.sheets[0].rows));
        setStatusMsg(`Planilha "${file.name}" carregada do Google Sheets.`);
      } else {
        const buffer = await downloadDriveFileArrayBuffer(activeToken, file.id);
        await processBufferForCard(buffer, file.name, file.mimeType);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao carregar arquivo do Drive.';
      if (msg.includes('401')) setToken(null);
      setErrorMsg(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleOpenPicker = async () => {
    if (!token) return;
    setBusy(true);
    setErrorMsg('');
    try {
      const picked = await openGoogleDrivePicker(token);
      if (picked) {
        await loadDriveFile(token, picked);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Não foi possível abrir o Google Picker. Use a lista de planilhas recentes.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleSheetTabChange = async (tabTitle: string) => {
    if (!token || !selectedGoogleMeta) return;
    setBusy(true);
    setErrorMsg('');
    try {
      const values = await fetchGoogleSheetValues(
        token,
        selectedGoogleMeta.spreadsheetId,
        tabTitle
      );
      const parsed = parseSpreadsheetGrid(
        values,
        selectedGoogleMeta.title,
        tabTitle,
        'GOOGLE_SHEETS'
      );
      setWorkbook(parsed);
      setSelectedSheetIndex(0);
      if (parsed.sheets[0]) {
        setMapping(autoDetectSpreadsheetColumns(parsed.sheets[0].rows));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao trocar aba do Google Sheets.');
    } finally {
      setBusy(false);
    }
  };

  const isAuditedMode = Boolean(auditedResult);

  const selectedCount = isAuditedMode
    ? auditedRows.filter((r) => r.selected && !r.hasValidationError && r.amountCents > 0).length
    : mappedRows.filter((r) => r.selected && !r.hasValidationError && r.amountCents > 0).length;

  const duplicateCount = isAuditedMode
    ? auditedRows.filter((r) => r.isDuplicate).length
    : mappedRows.filter((r) => r.isDuplicate).length;

  const commitImport = () => {
    if (isAuditedMode) {
      const items = buildAuditedCardTransactions({
        rows: auditedRows,
        targetCard: card,
        importBatchId: batchFingerprint,
        generateFutureInstallments,
        existingTransactions: transactions,
      });
      if (items.length === 0) {
        setErrorMsg('Selecione ao menos um lançamento válido para importar.');
        setAwaitingConfirm(false);
        return;
      }

      const res = onCommitCardImport(items, {
        fileName: auditedFileName || 'fatura_auditada',
        batchFingerprint,
        cardId: card.id,
      });
      const futureCount = items.filter((i) => i.status === 'PENDING').length;
      setStatusMsg(
        `Fatura auditada importada em ${card.cardName}: ${res.acceptedCount} registro(s) salvo(s)${
          futureCount > 0
            ? ` (incluindo ${futureCount} parcela(s) futura(s) para previsão das próximas faturas)`
            : ''
        }${
          res.skippedDuplicatesCount > 0
            ? ` · ${res.skippedDuplicatesCount} duplicata(s) ignorada(s)`
            : ''
        }.`
      );
      setAwaitingConfirm(false);
      setAuditedResult(null);
      setAuditedRows([]);
      setAuditedRawContext(null);
      return;
    }

    if (!workbook) return;
    const items = buildCardTransactionsFromMappedRows({
      rows: mappedRows,
      targetCard: card,
      importBatchId: batchFingerprint,
    });
    if (items.length === 0) {
      setErrorMsg('Selecione ao menos um lançamento válido para importar.');
      setAwaitingConfirm(false);
      return;
    }

    const res = onCommitCardImport(items, {
      fileName: workbook.fileName,
      batchFingerprint,
      cardId: card.id,
    });
    setStatusMsg(
      `Importação concluída no cartão ${card.cardName}: ${res.acceptedCount} registro(s) salvo(s)${
        res.skippedDuplicatesCount > 0
          ? ` · ${res.skippedDuplicatesCount} duplicata(s) ignorada(s)`
          : ''
      }.`
    );
    setAwaitingConfirm(false);
    setWorkbook(null);
    setMappedRows([]);
  };

  const handleCopyJson = async () => {
    if (!auditedResult || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(auditedResult, null, 2));
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2500);
    } catch {
      // Clipboard unavailable in embedded frame
    }
  };

  const headers = activeSheet && mapping ? activeSheet.rows[mapping.headerRowIndex] || [] : [];

  return (
    <div className="space-y-4 min-w-0">
      <div className="sf-card p-4 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <BankLogo
              bankName={card.institutionName}
              bankCode={card.bankCode}
              logoUrl={card.logoUrl}
              size={38}
            />
            <div className="min-w-0">
              <h3 className="font-display text-sm sm:text-base font-bold text-[#0F172A] dark:text-white truncate">
                Importar Fatura · {card.cardName}
              </h3>
              <p className="text-[11px] text-[#64748B] dark:text-slate-400">
                Auditor financeiro de PDF, prints/imagens, CSV e Excel com detecção de parcelas e estornos.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80">
            <button
              type="button"
              onClick={() => setSourceMode('AUDITOR')}
              className={`min-h-9 px-2.5 rounded-lg text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1 cursor-pointer ${
                sourceMode === 'AUDITOR'
                  ? 'bg-white dark:bg-slate-900 text-[#0F172A] dark:text-white shadow-xs'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Sparkles size={12} /> Auditor IA
            </button>
            <button
              type="button"
              onClick={() => setSourceMode('SPREADSHEET')}
              className={`min-h-9 px-2.5 rounded-lg text-[11px] sm:text-xs font-bold cursor-pointer ${
                sourceMode === 'SPREADSHEET'
                  ? 'bg-white dark:bg-slate-900 text-[#0F172A] dark:text-white shadow-xs'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              Excel / CSV
            </button>
            <button
              type="button"
              onClick={() => setSourceMode('DRIVE')}
              className={`min-h-9 px-2.5 rounded-lg text-[11px] sm:text-xs font-bold cursor-pointer ${
                sourceMode === 'DRIVE'
                  ? 'bg-white dark:bg-slate-900 text-[#0F172A] dark:text-white shadow-xs'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              Google Drive
            </button>
          </div>
        </div>

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

        {sourceMode !== 'DRIVE' ? (
          <label className="border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-[#059669] rounded-2xl p-6 flex flex-col items-center justify-center cursor-pointer transition-colors bg-slate-50/70 dark:bg-slate-800/40 text-center">
            {busy ? (
              <RefreshCw className="w-7 h-7 text-[#059669] animate-spin mb-2" />
            ) : (
              <Upload className="w-7 h-7 text-[#64748B] mb-2" />
            )}
            <span className="text-xs sm:text-sm font-bold text-[#0F172A] dark:text-white">
              {busy
                ? 'Auditando fatura e extraindo compras, parcelas e estornos...'
                : auditedFileName && auditedResult
                  ? auditedFileName
                  : workbook
                    ? workbook.fileName
                    : sourceMode === 'AUDITOR'
                      ? 'Importar Fatura (PDF, Print/Imagem PNG/JPG ou CSV)'
                      : 'Selecionar planilha (.xlsx, .xls, .csv)'}
            </span>
            <span className="text-[11px] text-[#64748B] dark:text-slate-400 mt-1 max-w-lg">
              Ignora pagamento de fatura anterior e saldo anterior; identifica estornos negativos, compras parceladas (02/10) e gera previsão dos próximos ciclos em {card.cardName} (•••• {card.last4}).
            </span>
            <input
              type="file"
              disabled={busy}
              accept={
                sourceMode === 'AUDITOR'
                  ? '.pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx,.xls'
                  : '.xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.webp'
              }
              onChange={handleLocalFileChange}
              className="hidden"
            />
          </label>
        ) : (
          <div className="space-y-3">
            {!token ? (
              <button
                type="button"
                onClick={handleConnectGoogle}
                disabled={busy}
                className="w-full min-h-11 px-4 rounded-xl bg-[#061E3E] hover:bg-[#0F172A] dark:bg-[#059669] text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                <Cloud size={16} /> Conectar ao Google Drive &amp; Sheets
              </button>
            ) : (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleOpenPicker}
                    disabled={busy}
                    className="min-h-10 px-3.5 rounded-xl bg-[#061E3E] dark:bg-[#059669] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <FolderOpen size={14} /> Abrir Google Drive Picker
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!token) return;
                      setBusy(true);
                      try {
                        setDriveFiles(await listDriveSpreadsheetFiles(token));
                      } finally {
                        setBusy(false);
                      }
                    }}
                    disabled={busy}
                    className="min-h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw size={13} /> Atualizar lista
                  </button>
                </div>

                {driveFiles.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                    {driveFiles.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => token && loadDriveFile(token, f)}
                        className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-left hover:border-[#059669] flex items-center gap-2 cursor-pointer"
                      >
                        <FileSpreadsheet size={16} className="text-[#059669] shrink-0" />
                        <span className="text-xs font-semibold text-[#0F172A] dark:text-white truncate">
                          {f.name}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* AUDITED INVOICE VIEW (PDF / IMAGE / CSV FINANCIAL AUDITOR) */}
      {auditedResult && auditedMetrics && (
        <div className="space-y-4">
          {/* Invoice Summary Header + 4 Card Distribution Metrics */}
          <div className="sf-card p-4 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="font-display text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">
                  Auditoria da Fatura · {auditedFileName}
                </h4>
                <p className="text-[11px] text-[#64748B] dark:text-slate-400">
                  {auditedResult.resumo_fatura.vencimento
                    ? `Vencimento identificado: ${formatDateBR(auditedResult.resumo_fatura.vencimento)} · `
                    : ''}
                  Total identificado: {formatarValor(auditedResult.resumo_fatura.valor_total_identificado, hideValues)} ·{' '}
                  {selectedCount} selecionada(s) · {duplicateCount} duplicata(s)
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {auditedRawContext && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleReanalyzeWithAi}
                    className="min-h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-[#0F172A] dark:text-white flex items-center gap-1.5 cursor-pointer"
                  >
                    <Sparkles size={13} className="text-[#059669]" />
                    Reanalisar com IA
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowRawJson((v) => !v)}
                  className="min-h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-[#0F172A] dark:text-white flex items-center gap-1.5 cursor-pointer"
                >
                  <Code2 size={13} />
                  {showRawJson ? 'Ocultar JSON' : 'Ver JSON'}
                </button>
              </div>
            </div>

            {/* 4 Cards Logic: Fatura atual | Compras à vista | Compras parceladas | Previsão próxima fatura */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700">
                <div className="flex items-center justify-between text-[11px] text-[#64748B] dark:text-slate-400">
                  <span>Fatura atual</span>
                  <ReceiptText size={13} />
                </div>
                <div className="font-money text-sm sm:text-base font-extrabold text-red-700 dark:text-red-400 mt-1">
                  {formatarValor(fromCents(auditedMetrics.faturaAtualCents), hideValues)}
                </div>
                <span className="text-[10px] text-[#64748B] dark:text-slate-400">
                  À vista + parcela atual − estornos
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700">
                <div className="flex items-center justify-between text-[11px] text-[#64748B] dark:text-slate-400">
                  <span>Compras à vista</span>
                  <Wallet size={13} />
                </div>
                <div className="font-money text-sm sm:text-base font-extrabold text-[#0F172A] dark:text-white mt-1">
                  {formatarValor(fromCents(auditedMetrics.comprasAVistaCents), hideValues)}
                </div>
                <span className="text-[10px] text-[#059669] dark:text-[#10B981]">
                  {auditedMetrics.estornosCents > 0
                    ? `Estornos: −${formatarValor(fromCents(auditedMetrics.estornosCents), hideValues)}`
                    : 'Sem parcelamentos'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700">
                <div className="flex items-center justify-between text-[11px] text-[#64748B] dark:text-slate-400">
                  <span>Compras parceladas</span>
                  <Layers size={13} />
                </div>
                <div className="font-money text-sm sm:text-base font-extrabold text-sky-700 dark:text-sky-400 mt-1">
                  {formatarValor(fromCents(auditedMetrics.comprasParceladasAtualCents), hideValues)}
                </div>
                <span className="text-[10px] text-[#64748B] dark:text-slate-400">
                  {auditedMetrics.comprasParceladasCount} item(ns) neste ciclo
                </span>
              </div>

              <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70">
                <div className="flex items-center justify-between text-[11px] text-amber-800 dark:text-amber-300">
                  <span>Previsão próxima fatura</span>
                  <CalendarClock size={13} />
                </div>
                <div className="font-money text-sm sm:text-base font-extrabold text-amber-800 dark:text-amber-300 mt-1">
                  {formatarValor(fromCents(auditedMetrics.previsaoProximaFaturaCents), hideValues)}
                </div>
                <span className="text-[10px] text-amber-700 dark:text-amber-400">
                  {auditedMetrics.futurasParcelasCount} parcela(s) futura(s) a gerar
                </span>
              </div>
            </div>

            {showRawJson && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-950 text-slate-100 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-emerald-400">
                    JSON Estruturado do Auditor
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyJson}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Copy size={12} /> {copiedJson ? 'Copiado!' : 'Copiar JSON'}
                  </button>
                </div>
                <pre className="text-[11px] overflow-x-auto max-h-56 font-mono leading-relaxed">
                  {JSON.stringify(auditedResult, null, 2)}
                </pre>
              </div>
            )}

            {auditedMetrics.futurasParcelasCount > 0 && (
              <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/70 text-xs text-[#0F172A] dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={generateFutureInstallments}
                  onChange={(e) => setGenerateFutureInstallments(e.target.checked)}
                  className="w-4 h-4 accent-emerald-600 shrink-0"
                />
                <span>
                  Criar automaticamente <strong>{auditedMetrics.futurasParcelasCount}</strong> parcela(s) futura(s) (de{' '}
                  <code>parcela_atual + 1</code> até <code>total_parcelas</code>) no calendário e na previsão das próximas faturas.
                </span>
              </label>
            )}

            {/* Audited Transactions Review List */}
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-80 overflow-y-auto border border-slate-100 dark:border-slate-800 rounded-xl">
              {auditedRows.map((row) => (
                <div
                  key={row.rowId}
                  className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <label className="flex items-start gap-2.5 min-w-0 flex-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={row.selected}
                      disabled={row.hasValidationError}
                      onChange={(e) =>
                        setAuditedRows((prev) =>
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
                      <div className="text-[11px] text-[#64748B] dark:text-slate-400 flex flex-wrap items-center gap-1.5">
                        <span>{formatDateBR(row.date)}</span>
                        <span>· {CARD_ENTRY_KIND_LABELS[row.cardEntryKind]}</span>
                        {row.totalParcelas > 1 && (
                          <span className="px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300 text-[10px] font-bold">
                            Parc. {row.parcelaAtual}/{row.totalParcelas}
                          </span>
                        )}
                        {row.isDuplicate && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[10px] font-bold">
                            {row.duplicateReason}
                          </span>
                        )}
                      </div>
                    </div>
                  </label>

                  <div className="flex items-center justify-between sm:justify-end gap-2 pl-6 sm:pl-0 shrink-0">
                    <select
                      value={row.cardEntryKind}
                      onChange={(e) =>
                        setAuditedRows((prev) =>
                          prev.map((item) =>
                            item.rowId === row.rowId
                              ? {
                                  ...item,
                                  cardEntryKind: e.target.value as CardEntryKind,
                                  direction: e.target.value === 'REVERSAL' ? 'INCOME' : 'EXPENSE',
                                }
                              : item
                          )
                        )
                      }
                      className="min-h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px]"
                    >
                      <option value="PURCHASE">À vista</option>
                      <option value="INSTALLMENT">Parcelada</option>
                      <option value="FEE">Tarifa / IOF</option>
                      <option value="REVERSAL">Estorno</option>
                    </select>
                    <select
                      value={row.category}
                      onChange={(e) =>
                        setAuditedRows((prev) =>
                          prev.map((item) =>
                            item.rowId === row.rowId
                              ? { ...item, category: e.target.value }
                              : item
                          )
                        )
                      }
                      className="min-h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px]"
                    >
                      {ALL_CARD_CATEGORIES.map((c) => (
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
                      {row.direction === 'INCOME' ? '−' : ''}
                      {formatarValor(fromCents(row.amountCents), hideValues)}
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
                    Confirmar gravação de {selectedCount} lançamento(s) auditado(s)
                    {generateFutureInstallments && auditedMetrics.futurasParcelasCount > 0
                      ? ` e ${auditedMetrics.futurasParcelasCount} parcela(s) futura(s)`
                      : ''}{' '}
                    na fatura e planilha do cartão {card.cardName}?
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
                  Importar {selectedCount} lançamento(s) para {card.cardName}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MANUAL COLUMN MAPPING VIEW (Excel / Drive / Custom CSV) */}
      {!auditedResult && workbook && activeSheet && mapping && (
        <div className="sf-card p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="font-display text-sm font-bold text-[#0F172A] dark:text-white">
                Mapeamento &amp; Pré-visualização ({mappedRows.length} linhas)
              </h4>
              <p className="text-[11px] text-[#64748B] dark:text-slate-400">
                {selectedCount} selecionada(s) · {duplicateCount} duplicata(s) bloqueada(s)
              </p>
            </div>

            {selectedGoogleMeta && selectedGoogleMeta.sheets.length > 1 && (
              <select
                value={activeSheet.name}
                onChange={(e) => handleGoogleSheetTabChange(e.target.value)}
                className="min-h-9 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
              >
                {selectedGoogleMeta.sheets.map((s) => (
                  <option key={s.sheetId} value={s.title}>
                    Aba: {s.title}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                Coluna Data
              </label>
              <select
                value={mapping.dateCol}
                onChange={(e) => setMapping({ ...mapping, dateCol: Number(e.target.value) })}
                className="w-full min-h-9 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
              >
                {headers.map((h, i) => (
                  <option key={i} value={i}>
                    Col {i + 1}: {h || '—'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                Coluna Descrição
              </label>
              <select
                value={mapping.descriptionCol}
                onChange={(e) =>
                  setMapping({ ...mapping, descriptionCol: Number(e.target.value) })
                }
                className="w-full min-h-9 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
              >
                {headers.map((h, i) => (
                  <option key={i} value={i}>
                    Col {i + 1}: {h || '—'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                Coluna Valor
              </label>
              <select
                value={mapping.amountCol}
                onChange={(e) => setMapping({ ...mapping, amountCol: Number(e.target.value) })}
                className="w-full min-h-9 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
              >
                <option value={-1}>Usar Entrada/Saída</option>
                {headers.map((h, i) => (
                  <option key={i} value={i}>
                    Col {i + 1}: {h || '—'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                Coluna Categoria
              </label>
              <select
                value={mapping.categoryCol}
                onChange={(e) =>
                  setMapping({ ...mapping, categoryCol: Number(e.target.value) })
                }
                className="w-full min-h-9 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
              >
                <option value={-1}>Auto-categorizar</option>
                {headers.map((h, i) => (
                  <option key={i} value={i}>
                    Col {i + 1}: {h || '—'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-80 overflow-y-auto border border-slate-100 dark:border-slate-800 rounded-xl">
            {mappedRows.map((row) => (
              <div
                key={row.rowId}
                className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <label className="flex items-start gap-2.5 min-w-0 flex-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={row.selected}
                    disabled={row.hasValidationError}
                    onChange={(e) =>
                      setMappedRows((prev) =>
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
                      <span>· {CARD_ENTRY_KIND_LABELS[row.cardEntryKind]}</span>
                      {row.isDuplicate && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[10px] font-bold">
                          {row.duplicateReason}
                        </span>
                      )}
                      {row.hasValidationError && (
                        <span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 text-[10px] font-bold">
                          {row.validationError}
                        </span>
                      )}
                    </div>
                  </div>
                </label>

                <div className="flex items-center justify-between sm:justify-end gap-2 pl-6 sm:pl-0 shrink-0">
                  <select
                    value={row.cardEntryKind}
                    onChange={(e) =>
                      setMappedRows((prev) =>
                        prev.map((item) =>
                          item.rowId === row.rowId
                            ? {
                                ...item,
                                cardEntryKind: e.target.value as CardEntryKind,
                                direction: e.target.value === 'REVERSAL' ? 'INCOME' : 'EXPENSE',
                              }
                            : item
                        )
                      )
                    }
                    className="min-h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px]"
                  >
                    <option value="PURCHASE">Compra</option>
                    <option value="INSTALLMENT">Parcela</option>
                    <option value="FEE">Tarifa</option>
                    <option value="REVERSAL">Estorno</option>
                    <option value="PAYMENT">Pgto Fatura</option>
                  </select>
                  <select
                    value={row.category}
                    onChange={(e) =>
                      setMappedRows((prev) =>
                        prev.map((item) =>
                          item.rowId === row.rowId
                            ? { ...item, category: e.target.value }
                            : item
                        )
                      )
                    }
                    className="min-h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px]"
                  >
                    {ALL_CARD_CATEGORIES.map((c) => (
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
                    {formatarValor(fromCents(row.amountCents), hideValues)}
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
                  Confirmar importação de {selectedCount} lançamento(s) na planilha e fatura do cartão {card.cardName}?
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
                Importar {selectedCount} lançamento(s) para {card.cardName}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
