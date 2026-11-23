import React, { useEffect, useMemo, useState } from 'react';
import {
  Account,
  APP_CATEGORIES,
  CategoryRule,
  Direction,
  EntityId,
  Transaction,
} from '../../types';
import {
  autoDetectSpreadsheetColumns,
  buildImportBatchFingerprint,
  buildTransactionsFromMappedRows,
  MappedSpreadsheetRow,
  mapSpreadsheetRowsForAccount,
  ParsedSpreadsheetWorkbook,
  parseSpreadsheetBuffer,
  parseSpreadsheetGrid,
  SpreadsheetColumnMapping,
} from '../../domain/imports/SpreadsheetImportService';
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
import { fromCents } from '../../domain/money/money';
import { formatDateBR } from '../../utils/dateUtils';
import { usePrivacy } from '../../contexts/PrivacyContext';
import { formatarValor } from '../../utils/formatters';
import { BankLogo } from '../BankLogo';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  FileSpreadsheet,
  FolderOpen,
  RefreshCw,
  Upload,
} from 'lucide-react';

interface SpreadsheetImportTabProps {
  mode: 'LOCAL' | 'DRIVE';
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  categoryRules?: readonly CategoryRule[];
  onCommitImport: (
    items: Omit<Transaction, 'id'>[],
    meta: { fileName: string; batchFingerprint: string; accountId: string }
  ) => { acceptedCount: number; skippedDuplicatesCount: number };
}

export const SpreadsheetImportTab: React.FC<SpreadsheetImportTabProps> = ({
  mode,
  accounts,
  transactions,
  categoryRules = [],
  onCommitImport,
}) => {
  const { hideValues } = usePrivacy();
  const activeAccounts = useMemo(
    () => accounts.filter((a) => !a.archived),
    [accounts]
  );

  const [entityId, setEntityId] = useState<EntityId>('CPF');
  const [targetAccountId, setTargetAccountId] = useState<string>('');
  const [workbook, setWorkbook] = useState<ParsedSpreadsheetWorkbook | null>(null);
  const [selectedSheetIndex, setSelectedSheetIndex] = useState(0);
  const [mapping, setMapping] = useState<SpreadsheetColumnMapping | null>(null);
  const [mappedRows, setMappedRows] = useState<MappedSpreadsheetRow[]>([]);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);

  // Google Drive / Sheets state
  const [token, setToken] = useState<string | null>(() => getWorkspaceAccessToken());
  const [driveFiles, setDriveFiles] = useState<DrivePickedFile[]>([]);
  const [selectedGoogleMeta, setSelectedGoogleMeta] =
    useState<GoogleSpreadsheetMetadata | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [importSummary, setImportSummary] = useState<{
    acceptedCount: number;
    skippedDuplicatesCount: number;
    accountLabel: string;
    fileName: string;
  } | null>(null);

  const entityAccounts = useMemo(
    () => activeAccounts.filter((a) => a.entityId === entityId),
    [activeAccounts, entityId]
  );

  useEffect(() => {
    if (!entityAccounts.some((a) => a.id === targetAccountId)) {
      setTargetAccountId(entityAccounts[0]?.id || '');
    }
  }, [entityAccounts, targetAccountId]);

  const targetAccount = useMemo(
    () => entityAccounts.find((a) => a.id === targetAccountId) || entityAccounts[0] || null,
    [entityAccounts, targetAccountId]
  );

  const activeSheet = useMemo(
    () => workbook?.sheets[selectedSheetIndex] || workbook?.sheets[0] || null,
    [workbook, selectedSheetIndex]
  );

  // Re-run column mapping when sheet, mapping, or targetAccount changes
  useEffect(() => {
    if (!activeSheet || !targetAccount) {
      setMappedRows([]);
      return;
    }
    const effectiveMapping = mapping || autoDetectSpreadsheetColumns(activeSheet.rows);
    if (!mapping) {
      setMapping(effectiveMapping);
    }
    const nextRows = mapSpreadsheetRowsForAccount({
      rows: activeSheet.rows,
      mapping: effectiveMapping,
      targetAccount,
      existingTransactions: transactions,
      categoryRules,
    });
    setMappedRows(nextRows);
  }, [activeSheet, mapping, targetAccount, transactions, categoryRules]);

  const batchFingerprint = useMemo(() => {
    if (!workbook || !activeSheet || !targetAccount) return '';
    const sampleSig = activeSheet.rows
      .slice(0, 5)
      .map((r) => r.join('|'))
      .join('~');
    return buildImportBatchFingerprint({
      fileName: workbook.fileName,
      sheetName: activeSheet.name,
      accountId: targetAccount.id,
      rowCount: activeSheet.rows.length,
      sampleSignature: sampleSig,
    });
  }, [workbook, activeSheet, targetAccount]);

  const alreadyImportedBatch = useMemo(
    () =>
      Boolean(
        batchFingerprint &&
          transactions.some(
            (t) => t.status !== 'CANCELLED' && t.importBatchId === batchFingerprint
          )
      ),
    [batchFingerprint, transactions]
  );

  const handleLocalFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setErrorMsg('');
    setStatusMsg('');
    setImportSummary(null);
    setAwaitingConfirm(false);
    setSelectedGoogleMeta(null);

    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseSpreadsheetBuffer(buffer, file.name, 'LOCAL_EXCEL_CSV');
      if (parsed.sheets.length === 0) {
        setErrorMsg('A planilha selecionada não possui abas com dados válidos.');
        setWorkbook(null);
        return;
      }
      setWorkbook(parsed);
      setSelectedSheetIndex(0);
      setMapping(autoDetectSpreadsheetColumns(parsed.sheets[0].rows));
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Não foi possível ler o arquivo Excel/CSV.'
      );
    }
  };

  const handleConnectGoogle = async () => {
    setBusy(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const res = await signInWithGoogleWorkspace();
      setToken(res.accessToken);
      setStatusMsg('Conectado ao Google Drive e Google Sheets com sucesso.');
      const recent = await listDriveSpreadsheetFiles(res.accessToken).catch(() => []);
      setDriveFiles(recent);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao autenticar com Google.');
    } finally {
      setBusy(false);
    }
  };

  const loadDriveFile = async (activeToken: string, file: DrivePickedFile) => {
    setBusy(true);
    setErrorMsg('');
    setStatusMsg('');
    setImportSummary(null);
    setAwaitingConfirm(false);

    try {
      if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
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
        setSelectedGoogleMeta(null);
        const buffer = await downloadDriveFileArrayBuffer(activeToken, file.id);
        const parsed = parseSpreadsheetBuffer(buffer, file.name, 'GOOGLE_DRIVE');
        if (parsed.sheets.length === 0) {
          setErrorMsg('O arquivo do Google Drive não possui linhas válidas.');
          setWorkbook(null);
          return;
        }
        setWorkbook(parsed);
        setSelectedSheetIndex(0);
        setMapping(autoDetectSpreadsheetColumns(parsed.sheets[0].rows));
        setStatusMsg(`Arquivo "${file.name}" carregado do Google Drive.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao carregar planilha do Drive.';
      if (msg.toLowerCase().includes('expirad') || msg.includes('401')) {
        setToken(null);
      }
      setErrorMsg(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleOpenPicker = async () => {
    if (!token) {
      setErrorMsg('Conecte sua conta Google antes de abrir o seletor.');
      return;
    }
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
          : 'Não foi possível abrir o Google Picker neste ambiente.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSelectGoogleTab = async (tabTitle: string) => {
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
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao carregar aba selecionada.');
    } finally {
      setBusy(false);
    }
  };

  const selectedValidRows = useMemo(
    () => mappedRows.filter((r) => r.selected && !r.hasValidationError && r.amountCents > 0),
    [mappedRows]
  );

  const handleConfirmImport = () => {
    if (!targetAccount || !workbook) return;
    if (selectedValidRows.length === 0) {
      setErrorMsg('Selecione pelo menos um lançamento válido para importar.');
      return;
    }

    const batchId = batchFingerprint || `batch-${Date.now()}`;
    const items = buildTransactionsFromMappedRows({
      rows: mappedRows,
      targetAccount,
      importBatchId: batchId,
      entityOverride: targetAccount.entityId,
    });

    const result = onCommitImport(items, {
      fileName: workbook.fileName,
      batchFingerprint: batchId,
      accountId: targetAccount.id,
    });

    setImportSummary({
      acceptedCount: result.acceptedCount,
      skippedDuplicatesCount: result.skippedDuplicatesCount,
      accountLabel: `${targetAccount.institutionName} · ${targetAccount.accountName}`,
      fileName: workbook.fileName,
    });
    setAwaitingConfirm(false);
    setWorkbook(null);
    setMappedRows([]);
  };

  const columnOptions = useMemo(() => {
    if (!activeSheet || !mapping) return [];
    const headerRow = activeSheet.rows[mapping.headerRowIndex] || [];
    const maxCols = Math.max(headerRow.length, 6);
    return Array.from({ length: maxCols }, (_, idx) => ({
      index: idx,
      label: headerRow[idx]?.trim()
        ? `Coluna ${idx + 1}: ${headerRow[idx].trim()}`
        : `Coluna ${idx + 1}`,
    }));
  }, [activeSheet, mapping]);

  return (
    <div className="space-y-4 min-w-0 animate-fadeIn">
      {/* Header + Target Entity & Account Selector */}
      <div className="sf-card p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-base sm:text-lg font-bold text-[#0F172A] dark:text-white flex items-center gap-2">
              {mode === 'DRIVE' ? (
                <Cloud size={18} className="text-blue-600" />
              ) : (
                <FileSpreadsheet size={18} className="text-[#059669]" />
              )}
              {mode === 'DRIVE'
                ? 'Importar Planilha do Google Drive / Google Sheets'
                : 'Importar Planilha Excel (.xlsx, .xls) ou CSV'}
            </h3>
            <p className="text-xs text-[#64748B] dark:text-slate-400 mt-0.5">
              Associe a planilha a uma conta específica ({entityId}), confira o mapeamento de colunas e valide duplicidades antes de salvar.
            </p>
          </div>
        </div>

        {/* Target Entity + Exact Account ID */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="md:col-span-4">
            <label className="block text-xs font-semibold text-[#64748B] dark:text-slate-400 mb-1">
              Titularidade de destino
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {(['CPF', 'CNPJ'] as const).map((ent) => (
                <button
                  key={ent}
                  type="button"
                  onClick={() => setEntityId(ent)}
                  className={`min-h-11 rounded-xl text-xs font-bold border cursor-pointer ${
                    entityId === ent
                      ? 'bg-[#061E3E] dark:bg-[#059669] text-white border-[#061E3E] dark:border-[#059669]'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {ent === 'CPF' ? 'PF · CPF' : 'PJ · CNPJ'}
                </button>
              ))}
            </div>
          </div>

          <div className="md:col-span-8">
            <label
              htmlFor="sheet-import-account"
              className="block text-xs font-semibold text-[#64748B] dark:text-slate-400 mb-1"
            >
              Conta bancária vinculada ({entityId})
            </label>
            <div className="flex items-center gap-2.5">
              {targetAccount && (
                <BankLogo
                  bankName={targetAccount.institutionName}
                  bankCode={targetAccount.bankCode}
                  logoUrl={targetAccount.logoUrl}
                  size={38}
                />
              )}
              <select
                id="sheet-import-account"
                value={targetAccount?.id || ''}
                onChange={(e) => setTargetAccountId(e.target.value)}
                className="flex-1 min-w-0 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm font-semibold bg-white dark:bg-slate-900 text-[#0F172A] dark:text-white min-h-11"
              >
                {entityAccounts.length === 0 ? (
                  <option value="">Nenhuma conta {entityId} ativa cadastrada</option>
                ) : (
                  entityAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.institutionName} · {acc.accountName} ({acc.entityId})
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>
        </div>

        {/* File Picker / Google Drive Controls */}
        {mode === 'LOCAL' ? (
          <label className="border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-[#059669] rounded-2xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer bg-slate-50/70 dark:bg-slate-800/40 transition-colors">
            <Upload size={26} className="text-[#059669]" />
            <span className="text-xs sm:text-sm font-bold text-[#0F172A] dark:text-white text-center">
              {workbook
                ? `Arquivo selecionado: ${workbook.fileName} (clique para trocar)`
                : 'Toque para selecionar planilha .xlsx, .xls ou .csv'}
            </span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleLocalFileChange}
              className="hidden"
            />
          </label>
        ) : (
          <div className="space-y-3">
            {!token ? (
              <button
                type="button"
                disabled={busy}
                onClick={handleConnectGoogle}
                className="w-full min-h-12 rounded-xl bg-[#061E3E] hover:bg-[#0F172A] dark:bg-[#059669] dark:hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                <Cloud size={16} /> Conectar com Google Drive & Sheets
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleOpenPicker}
                    className="px-4 min-h-11 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-2 cursor-pointer"
                  >
                    <FolderOpen size={15} /> Selecionar planilha no Google Picker
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      if (!token) return;
                      setBusy(true);
                      try {
                        const list = await listDriveSpreadsheetFiles(token);
                        setDriveFiles(list);
                      } catch (err) {
                        setErrorMsg(
                          err instanceof Error ? err.message : 'Erro ao listar arquivos.'
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="px-3.5 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-[#0F172A] dark:text-white inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw size={14} /> Atualizar lista recente
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleConnectGoogle}
                    className="px-3.5 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                  >
                    Reconectar conta Google
                  </button>
                </div>

                {driveFiles.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-bold text-[#64748B] dark:text-slate-400">
                      Planilhas recentes no Google Drive:
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto">
                      {driveFiles.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          disabled={busy}
                          onClick={() => token && loadDriveFile(token, f)}
                          className="text-left p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-[#059669] flex items-center gap-2.5 cursor-pointer"
                        >
                          <FileSpreadsheet size={16} className="text-[#059669] shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold text-[#0F172A] dark:text-white truncate">
                              {f.name}
                            </div>
                            <div className="text-[10px] text-[#64748B] dark:text-slate-400">
                              {f.mimeType.includes('google-apps') ? 'Google Sheets' : 'Excel/CSV'}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {statusMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 size={15} className="shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-semibold flex items-center gap-2">
          <AlertCircle size={15} className="shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {importSummary && (
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-700 text-xs text-emerald-900 dark:text-emerald-100 space-y-1">
          <div className="font-bold text-sm flex items-center gap-2">
            <CheckCircle2 size={16} /> Importação concluída com sucesso
          </div>
          <div>
            Arquivo: <strong>{importSummary.fileName}</strong> · Conta:{' '}
            <strong>{importSummary.accountLabel}</strong>
          </div>
          <div>
            <strong>{importSummary.acceptedCount}</strong> lançamento(s) registrado(s) ·{' '}
            <strong>{importSummary.skippedDuplicatesCount}</strong> duplicata(s) protegida(s).
          </div>
        </div>
      )}

      {/* Loaded Workbook Mapping + Preview */}
      {workbook && activeSheet && mapping && targetAccount && (
        <div className="sf-card p-4 sm:p-5 space-y-4">
          {alreadyImportedBatch && (
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 text-xs font-semibold flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0" />
              <span>
                Atenção: uma planilha com assinatura equivalente ({workbook.fileName}) já foi importada nesta conta. Linhas duplicadas foram automaticamente desmarcadas.
              </span>
            </div>
          )}

          {/* Sheet/Tab selectors */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {selectedGoogleMeta && selectedGoogleMeta.sheets.length > 1 ? (
              <div>
                <label className="block text-[11px] font-semibold text-[#64748B] mb-1">
                  Aba do Google Sheets
                </label>
                <select
                  value={activeSheet.name}
                  onChange={(e) => handleSelectGoogleTab(e.target.value)}
                  className="border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold bg-white dark:bg-slate-900 text-[#0F172A] dark:text-white min-h-10"
                >
                  {selectedGoogleMeta.sheets.map((s) => (
                    <option key={s.sheetId} value={s.title}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </div>
            ) : workbook.sheets.length > 1 ? (
              <div>
                <label className="block text-[11px] font-semibold text-[#64748B] mb-1">
                  Aba da planilha
                </label>
                <select
                  value={selectedSheetIndex}
                  onChange={(e) => {
                    const idx = Number(e.target.value);
                    setSelectedSheetIndex(idx);
                    if (workbook.sheets[idx]) {
                      setMapping(autoDetectSpreadsheetColumns(workbook.sheets[idx].rows));
                    }
                  }}
                  className="border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold bg-white dark:bg-slate-900 text-[#0F172A] dark:text-white min-h-10"
                >
                  {workbook.sheets.map((s, idx) => (
                    <option key={s.name} value={idx}>
                      {s.name} ({s.rows.length} linhas)
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="text-xs font-bold text-[#0F172A] dark:text-white">
                Aba: {activeSheet.name} ({mappedRows.length} linha(s) detectadas)
              </div>
            )}

            <div className="text-xs text-[#64748B] dark:text-slate-400">
              Selecionadas para importar:{' '}
              <strong className="text-[#059669] dark:text-[#10B981]">
                {selectedValidRows.length}
              </strong>{' '}
              de {mappedRows.length}
            </div>
          </div>

          {/* Column Mapping Controls */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/70 text-xs">
            {[
              { label: 'Data', key: 'dateCol' as const, allowNone: false },
              { label: 'Descrição', key: 'descriptionCol' as const, allowNone: false },
              { label: 'Valor único', key: 'amountCol' as const, allowNone: true },
              { label: 'Coluna Entrada', key: 'entradaCol' as const, allowNone: true },
              { label: 'Coluna Saída', key: 'saidaCol' as const, allowNone: true },
              { label: 'Categoria', key: 'categoryCol' as const, allowNone: true },
            ].map((field) => (
              <div key={field.key}>
                <label className="block text-[10px] font-bold text-[#64748B] dark:text-slate-400 mb-1">
                  {field.label}
                </label>
                <select
                  value={mapping[field.key]}
                  onChange={(e) =>
                    setMapping((prev) =>
                      prev ? { ...prev, [field.key]: Number(e.target.value) } : prev
                    )
                  }
                  className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-[11px] bg-white dark:bg-slate-900 text-[#0F172A] dark:text-white"
                >
                  {field.allowNone && <option value={-1}>Não usar</option>}
                  {columnOptions.map((col) => (
                    <option key={col.index} value={col.index}>
                      {col.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {/* Preview Rows */}
          <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200/80 dark:border-slate-800 rounded-xl max-h-96 overflow-y-auto">
            {mappedRows.map((row) => (
              <div
                key={row.rowId}
                className={`p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                  row.isDuplicate ? 'bg-amber-50/40 dark:bg-amber-950/20' : ''
                }`}
              >
                <label className="flex items-start gap-2.5 min-w-0 flex-1 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={row.hasValidationError}
                    checked={row.selected}
                    onChange={(e) =>
                      setMappedRows((prev) =>
                        prev.map((r) =>
                          r.rowId === row.rowId ? { ...r, selected: e.target.checked } : r
                        )
                      )
                    }
                    className="w-4 h-4 accent-emerald-600 mt-0.5 shrink-0"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <input
                      type="text"
                      value={row.description}
                      onChange={(e) =>
                        setMappedRows((prev) =>
                          prev.map((r) =>
                            r.rowId === row.rowId ? { ...r, description: e.target.value } : r
                          )
                        )
                      }
                      className="w-full text-xs font-bold text-[#0F172A] dark:text-white bg-transparent border-b border-transparent focus:border-slate-300 outline-none"
                    />
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#64748B] dark:text-slate-400">
                      <span>Linha {row.sourceRowIndex}</span>
                      <span>·</span>
                      <span>{formatDateBR(row.date)}</span>
                      {row.isDuplicate && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[10px] font-bold">
                          Duplicada ({row.duplicateReason})
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
                    value={row.direction}
                    onChange={(e) =>
                      setMappedRows((prev) =>
                        prev.map((r) =>
                          r.rowId === row.rowId
                            ? { ...r, direction: e.target.value as Direction }
                            : r
                        )
                      )
                    }
                    className="border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-[11px] bg-white dark:bg-slate-900 text-[#0F172A] dark:text-white"
                  >
                    <option value="INCOME">Entrada</option>
                    <option value="EXPENSE">Saída</option>
                  </select>

                  <select
                    value={row.category}
                    onChange={(e) =>
                      setMappedRows((prev) =>
                        prev.map((r) =>
                          r.rowId === row.rowId ? { ...r, category: e.target.value } : r
                        )
                      )
                    }
                    className="border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-[11px] bg-white dark:bg-slate-900 text-[#0F172A] dark:text-white"
                  >
                    {APP_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>

                  <span
                    className={`font-money text-xs font-extrabold ${
                      row.direction === 'INCOME'
                        ? 'text-[#059669] dark:text-[#10B981]'
                        : 'text-[#DC3545] dark:text-red-400'
                    }`}
                  >
                    {hideValues
                      ? formatarValor(row.amount, true)
                      : `${row.direction === 'INCOME' ? '+' : '−'} ${formatarValor(fromCents(row.amountCents), false)}`}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Explicit Confirmation Step */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <div className="text-xs text-[#64748B] dark:text-slate-300">
              Destino:{' '}
              <strong className="text-[#0F172A] dark:text-white">
                {targetAccount.institutionName} · {targetAccount.accountName} ({targetAccount.entityId})
              </strong>
            </div>

            {!awaitingConfirm ? (
              <button
                type="button"
                disabled={selectedValidRows.length === 0}
                onClick={() => setAwaitingConfirm(true)}
                className="px-5 min-h-11 rounded-xl bg-[#061E3E] hover:bg-[#0F172A] dark:bg-[#059669] dark:hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-bold cursor-pointer"
              >
                Revisar e confirmar ({selectedValidRows.length})
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAwaitingConfirm(false)}
                  className="px-3.5 min-h-11 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmImport}
                  className="px-5 min-h-11 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                >
                  Confirmar e importar {selectedValidRows.length} lançamento(s)
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
