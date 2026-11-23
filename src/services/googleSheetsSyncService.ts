import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { firebaseAuth } from './firebaseClient';
import { sanitizeCellForSheet } from '../utils/sheetGuard';
import { getWorkspaceAccessToken } from './googleWorkspace';

// Escopos necessários para ler/editar planilhas e salvar backups no Drive
export const SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
] as const;

export interface SheetTransactionRow {
  id: string;
  date: string;
  description: string;
  category: string;
  amount: number;
  creditCardId?: string;
  accountId?: string;
  status: string;
  updatedAt: string;
}

/**
 * Extrai o ID limpo de uma planilha a partir de uma URL completa ou do próprio ID.
 * Ex: https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit -> 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
 */
export function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }
  return trimmed;
}

/**
 * 1. Solicita permissão do Google Sheets/Drive usando o login atual do Firebase
 */
export async function authorizeGoogleSheets(): Promise<string> {
  const existingToken = getWorkspaceAccessToken() || sessionStorage.getItem('google_sheets_token');
  if (existingToken) {
    return existingToken;
  }

  const auth = firebaseAuth;
  const provider = new GoogleAuthProvider();
  SHEETS_SCOPES.forEach((scope) => provider.addScope(scope));
  provider.setCustomParameters({ prompt: 'consent select_account' });

  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);

  if (!credential?.accessToken) {
    throw new Error('Não foi possível obter o token de acesso do Google.');
  }

  sessionStorage.setItem('google_sheets_token', credential.accessToken);
  return credential.accessToken;
}

/**
 * 2. PUXAR ALTERAÇÕES: Lê a planilha da nuvem e retorna os dados para atualizar o sistema
 */
export async function pullFromGoogleSheet(
  spreadsheetId: string,
  range = 'Transacoes!A2:I'
): Promise<SheetTransactionRow[]> {
  const cleanId = extractSpreadsheetId(spreadsheetId);
  if (!cleanId) {
    throw new Error('ID ou URL da planilha não informado.');
  }

  const token =
    sessionStorage.getItem('google_sheets_token') ||
    getWorkspaceAccessToken() ||
    (await authorizeGoogleSheets());

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(cleanId)}/values/${encodeURIComponent(range)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!response.ok) {
    if (response.status === 401) {
      sessionStorage.removeItem('google_sheets_token');
      throw new Error('Sessão Google expirada (401). Conecte novamente.');
    }
    const errData = await response.json().catch(() => ({}));
    const msg = errData?.error?.message || response.statusText;
    throw new Error(`Falha ao ler dados da planilha: ${msg}`);
  }

  const data = await response.json();
  const rows: unknown[][] = data.values || [];

  return rows.map((row) => {
    const r = Array.isArray(row) ? row : [];
    const rawAmount = String(r[4] ?? '0').trim().replace(/\./g, '').replace(',', '.');
    const parsedAmount = parseFloat(rawAmount) || 0;

    return {
      id: String(r[0] || '').trim() || `sheet_${crypto.randomUUID()}`,
      date: String(r[1] || '').trim() || new Date().toISOString().split('T')[0],
      description: String(r[2] || '').trim() || 'Lançamento via Planilha',
      category: String(r[3] || '').trim() || 'Outros',
      amount: parsedAmount,
      creditCardId: String(r[5] || '').trim() || undefined,
      accountId: String(r[6] || '').trim() || undefined,
      status: String(r[7] || '').trim() || 'paid',
      updatedAt: String(r[8] || '').trim() || new Date().toISOString(),
    };
  });
}

/**
 * 3. BACKUP / EXPORTAÇÃO: Envia todas as transações do sistema para a planilha no Drive
 */
export async function pushBackupToGoogleSheet(
  spreadsheetId: string,
  transactions: SheetTransactionRow[],
  range = 'Transacoes!A1:I'
): Promise<void> {
  const cleanId = extractSpreadsheetId(spreadsheetId);
  if (!cleanId) {
    throw new Error('ID ou URL da planilha não informado.');
  }

  const token =
    sessionStorage.getItem('google_sheets_token') ||
    getWorkspaceAccessToken() ||
    (await authorizeGoogleSheets());

  const header = [
    ['ID', 'Data', 'Descrição', 'Categoria', 'Valor', 'ID_Cartao', 'ID_Conta', 'Status', 'Atualizado_Em'].map(
      sanitizeCellForSheet
    ),
  ];

  const rows = transactions.map((tx) => [
    sanitizeCellForSheet(tx.id),
    sanitizeCellForSheet(tx.date),
    sanitizeCellForSheet(tx.description),
    sanitizeCellForSheet(tx.category),
    sanitizeCellForSheet(tx.amount),
    sanitizeCellForSheet(tx.creditCardId || ''),
    sanitizeCellForSheet(tx.accountId || ''),
    sanitizeCellForSheet(tx.status),
    sanitizeCellForSheet(tx.updatedAt),
  ]);

  const body = {
    values: [...header, ...rows],
  };

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(cleanId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    if (response.status === 401) {
      sessionStorage.removeItem('google_sheets_token');
      throw new Error('Sessão Google expirada (401). Conecte novamente.');
    }
    const errData = await response.json().catch(() => ({}));
    const msg = errData?.error?.message || response.statusText;
    throw new Error(`Falha ao enviar backup para o Google Sheets: ${msg}`);
  }
}
