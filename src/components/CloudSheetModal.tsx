import React, { useState } from 'react';
import {
  extractSpreadsheetId,
  pullFromGoogleSheet,
  pushBackupToGoogleSheet,
  SheetTransactionRow,
} from '../services/googleSheetsSyncService';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  UploadCloud,
  X,
} from 'lucide-react';

export interface CloudSheetModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  spreadsheetId?: string; // Ex: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
  onSaveSpreadsheetId?: (id: string) => void;
  currentTransactions: SheetTransactionRow[];
  onSyncTransactions: (updatedRows: SheetTransactionRow[]) => Promise<void>;
}

export function CloudSheetModal({
  isOpen = true,
  onClose,
  spreadsheetId: initialSpreadsheetId = '',
  onSaveSpreadsheetId,
  currentTransactions,
  onSyncTransactions,
}: CloudSheetModalProps) {
  const [spreadsheetInput, setSpreadsheetInput] = useState(initialSpreadsheetId);
  const [activeSpreadsheetId, setActiveSpreadsheetId] = useState(
    extractSpreadsheetId(initialSpreadsheetId)
  );
  const [rangeInput, setRangeInput] = useState('Transacoes!A2:I');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(
    null
  );

  if (!isOpen) return null;

  const handleApplySpreadsheetId = () => {
    const clean = extractSpreadsheetId(spreadsheetInput);
    if (!clean) {
      setStatusMsg({ text: 'Informe um ID ou link válido de planilha Google.', type: 'error' });
      return;
    }
    setActiveSpreadsheetId(clean);
    onSaveSpreadsheetId?.(clean);
    setStatusMsg({ text: `Planilha vinculada com sucesso (ID: ${clean}).`, type: 'info' });
  };

  // Atualiza o sistema com o que você alterou na planilha
  const handlePullUpdates = async () => {
    const targetId = activeSpreadsheetId || extractSpreadsheetId(spreadsheetInput);
    if (!targetId) {
      setStatusMsg({ text: 'Informe a planilha do Google antes de sincronizar.', type: 'error' });
      return;
    }

    setLoading(true);
    setStatusMsg({ text: 'Lendo alterações da planilha...', type: 'info' });
    try {
      const rows = await pullFromGoogleSheet(targetId, rangeInput.trim() || 'Transacoes!A2:I');
      await onSyncTransactions(rows);
      setStatusMsg({
        text: `Sincronizado! ${rows.length} lançamentos lidos da planilha Google com sucesso.`,
        type: 'success',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao sincronizar planilha.';
      setStatusMsg({ text: `Erro: ${msg}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // Salva uma cópia de segurança do sistema na planilha do Google Drive
  const handleBackupToDrive = async () => {
    const targetId = activeSpreadsheetId || extractSpreadsheetId(spreadsheetInput);
    if (!targetId) {
      setStatusMsg({ text: 'Informe a planilha do Google antes de enviar o backup.', type: 'error' });
      return;
    }

    setLoading(true);
    setStatusMsg({ text: 'Enviando backup para o Google Drive...', type: 'info' });
    try {
      await pushBackupToGoogleSheet(
        targetId,
        currentTransactions,
        rangeInput.startsWith('Transacoes') ? 'Transacoes!A1:I' : rangeInput
      );
      setStatusMsg({
        text: `Backup de ${currentTransactions.length} lançamentos concluído com sucesso no Google Sheets!`,
        type: 'success',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao enviar backup.';
      setStatusMsg({ text: `Erro: ${msg}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="flex flex-col w-full max-w-4xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 grid place-items-center">
              <FileSpreadsheet size={22} />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                Planilha na Nuvem & Backup Google Drive
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Edite na nuvem, puxe alterações para o sistema ou salve backups com 1 toque
              </p>
            </div>
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-lg grid place-items-center text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Fechar"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Controls & Configuration Bar */}
        <div className="p-4 sm:p-5 space-y-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
            <div className="flex-1 flex gap-2">
              <input
                type="text"
                value={spreadsheetInput}
                onChange={(e) => setSpreadsheetInput(e.target.value)}
                placeholder="Cole o Link ou ID da Planilha Google (ex: 1BxiMVs0XRA5...)"
                className="flex-1 px-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="button"
                onClick={handleApplySpreadsheetId}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg cursor-pointer whitespace-nowrap transition-colors"
              >
                Vincular
              </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handlePullUpdates}
                disabled={loading || !activeSpreadsheetId}
                className="flex-1 sm:flex-none px-3.5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-sm"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Atualizar Sistema (Puxar)
              </button>

              <button
                type="button"
                onClick={handleBackupToDrive}
                disabled={loading || !activeSpreadsheetId}
                className="flex-1 sm:flex-none px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <UploadCloud size={14} />
                Salvar Backup no Drive
              </button>

              {activeSpreadsheetId && (
                <a
                  href={`https://docs.google.com/spreadsheets/d/${activeSpreadsheetId}/edit`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 rounded-lg border border-slate-200 dark:border-slate-700 grid place-items-center transition-colors"
                  title="Abrir no Google Sheets em nova aba"
                >
                  <ExternalLink size={15} />
                </a>
              )}
            </div>
          </div>

          {statusMsg && (
            <div
              className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium rounded-lg border ${
                statusMsg.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800'
                  : statusMsg.type === 'error'
                    ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border-rose-200 dark:border-rose-800'
                    : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
              }`}
            >
              {statusMsg.type === 'success' ? (
                <CheckCircle2 size={15} className="shrink-0 text-emerald-600" />
              ) : statusMsg.type === 'error' ? (
                <AlertCircle size={15} className="shrink-0 text-rose-600" />
              ) : (
                <RefreshCw size={15} className="shrink-0 text-slate-500 animate-spin" />
              )}
              <span>{statusMsg.text}</span>
            </div>
          )}
        </div>

        {/* Embedded Google Sheet or Empty State */}
        <div className="flex-1 p-4 sm:p-5 overflow-auto bg-slate-100/50 dark:bg-slate-950/40 min-h-[350px]">
          {activeSpreadsheetId ? (
            <div className="w-full h-[520px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-inner">
              <iframe
                src={`https://docs.google.com/spreadsheets/d/${activeSpreadsheetId}/edit?rm=minimal`}
                className="w-full h-full border-0"
                title="Planilha Google Sheets Finance IA"
                allow="clipboard-read; clipboard-write"
              />
            </div>
          ) : (
            <div className="h-64 flex flex-col items-center justify-center text-center p-6 bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
              <FileSpreadsheet size={40} className="text-slate-300 dark:text-slate-600 mb-2" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                Nenhuma planilha vinculada no momento
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md">
                Cole o link ou ID da sua planilha do Google Sheets no campo acima e clique em{' '}
                <strong>Vincular</strong> para visualizar e sincronizar diretamente aqui.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
