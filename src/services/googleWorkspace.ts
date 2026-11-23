import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import { firebaseAuth } from './firebaseClient';
import { sanitizeCellForSheet } from '../utils/sheetGuard';
import { todayLocal, todayDisplayPtBr, addDaysLocal } from '../utils/dateLocal';
import type { Account, Transaction } from '../types';
import { resolveBankIdentity } from '../domain/extractions/banksRepository';

const auth = firebaseAuth;

const provider = new GoogleAuthProvider();
// Preserve existing Drive, Calendar & Sheets scopes and merge Gmail scopes
const GOOGLE_WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.addons.current.action.compose',
  'https://www.googleapis.com/auth/gmail.addons.current.message.action',
  'https://www.googleapis.com/auth/gmail.addons.current.message.metadata',
  'https://www.googleapis.com/auth/gmail.addons.current.message.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.insert',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/gmail.metadata',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/gmail.settings.sharing',
] as const;

GOOGLE_WORKSPACE_SCOPES.forEach((scope) => provider.addScope(scope));

let cachedAccessToken: string | null = null;
let pickerScriptPromise: Promise<void> | null = null;

export interface DrivePickedFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  sizeBytes?: number;
  url?: string;
}

export interface GoogleSheetTabInfo {
  sheetId: number;
  title: string;
  rowCount?: number;
  columnCount?: number;
}

export interface GoogleSpreadsheetMetadata {
  spreadsheetId: string;
  title: string;
  sheets: GoogleSheetTabInfo[];
}

export const DRIVE_SPREADSHEET_MIME_TYPES = [
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
] as const;

export const initGoogleAuth = (
  onSuccess: (user: User, token: string) => void,
  onFailure: () => void
) => {
  return onAuthStateChanged(auth, async (user) => {
    if (user && cachedAccessToken) {
      onSuccess(user, cachedAccessToken);
    } else {
      cachedAccessToken = null;
      onFailure();
    }
  });
};

export const signInWithGoogleWorkspace = async (): Promise<{
  user: User;
  accessToken: string;
}> => {
  provider.setCustomParameters({ prompt: 'consent select_account' });
  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error('Falha ao obter token de acesso do Google Workspace.');
  }
  cachedAccessToken = credential.accessToken;
  return { user: result.user, accessToken: cachedAccessToken };
};

export const getWorkspaceAccessToken = () => cachedAccessToken;

export const clearWorkspaceToken = () => {
  cachedAccessToken = null;
};

async function ensureOkResponse(res: Response, fallbackMessage: string): Promise<Response> {
  if (res.ok) return res;
  if (res.status === 401) {
    clearWorkspaceToken();
    throw new Error('Sessão Google expirada ou token inválido (401). Conecte novamente.');
  }
  const errData = await res.json().catch(() => ({}));
  const apiMsg = errData?.error?.message;
  throw new Error(apiMsg ? `${fallbackMessage}: ${apiMsg}` : `${fallbackMessage} (${res.status})`);
}

function loadGooglePickerApi(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(
      new Error('Google Picker requer navegador web interativo.')
    );
  }
  const w = window as unknown as {
    gapi?: { load: (api: string, opts: { callback: () => void; onerror?: () => void }) => void };
    google?: { picker?: unknown };
  };

  if (w.google?.picker) {
    return Promise.resolve();
  }

  if (pickerScriptPromise) {
    return pickerScriptPromise;
  }

  pickerScriptPromise = new Promise<void>((resolve, reject) => {
    const startPickerLoad = () => {
      if (!w.gapi) {
        pickerScriptPromise = null;
        reject(new Error('Biblioteca Google API (gapi) não disponível.'));
        return;
      }
      w.gapi.load('picker', {
        callback: () => resolve(),
        onerror: () => {
          pickerScriptPromise = null;
          reject(new Error('Falha ao carregar o Google Drive Picker.'));
        },
      });
    };

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://apis.google.com/js/api.js"]'
    );
    if (existing && w.gapi) {
      startPickerLoad();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.defer = true;
    script.onload = startPickerLoad;
    script.onerror = () => {
      pickerScriptPromise = null;
      reject(new Error('Não foi possível carregar o script do Google Picker.'));
    };
    document.head.appendChild(script);
  });

  return pickerScriptPromise;
}

export async function openGoogleDrivePicker(
  token: string
): Promise<DrivePickedFile | null> {
  await loadGooglePickerApi();

  return new Promise<DrivePickedFile | null>((resolve, reject) => {
    const w = window as unknown as {
      google?: {
        picker?: {
          ViewId: { DOCS: unknown };
          Action: { PICKED: string; CANCEL: string };
          DocsView: new (viewId: unknown) => {
            setMimeTypes: (mimes: string) => unknown;
            setIncludeFolders: (flag: boolean) => unknown;
          };
          PickerBuilder: new () => {
            setTitle: (title: string) => unknown;
            addView: (view: unknown) => unknown;
            setOAuthToken: (oauthToken: string) => unknown;
            setOrigin: (origin: string) => unknown;
            setCallback: (cb: (data: {
              action: string;
              docs?: Array<{
                id: string;
                name: string;
                mimeType: string;
                sizeBytes?: number;
                url?: string;
              }>;
            }) => void) => unknown;
            build: () => { setVisible: (visible: boolean) => void };
          };
        };
      };
    };

    const pickerNs = w.google?.picker;
    if (!pickerNs) {
      reject(new Error('Google Picker não inicializado neste ambiente.'));
      return;
    }

    try {
      const originCandidates = window.location as Location & {
        ancestorOrigins?: DOMStringList;
      };
      const pickerOrigin =
        originCandidates.ancestorOrigins && originCandidates.ancestorOrigins.length > 0
          ? originCandidates.ancestorOrigins[0]
          : window.location.origin;

      const view = new pickerNs.DocsView(pickerNs.ViewId.DOCS);
      view.setMimeTypes(DRIVE_SPREADSHEET_MIME_TYPES.join(','));
      view.setIncludeFolders(true);

      const builder = new pickerNs.PickerBuilder();
      builder.setTitle('Selecionar planilha no Google Drive');
      builder.addView(view);
      builder.setOAuthToken(token);
      if (pickerOrigin && !pickerOrigin.startsWith('capacitor:')) {
        builder.setOrigin(pickerOrigin);
      }
      builder.setCallback((data) => {
        if (data.action === pickerNs.Action.PICKED && data.docs && data.docs.length > 0) {
          const docItem = data.docs[0];
          resolve({
            id: docItem.id,
            name: docItem.name,
            mimeType: docItem.mimeType,
            sizeBytes: docItem.sizeBytes,
            url: docItem.url,
          });
        } else if (data.action === pickerNs.Action.CANCEL) {
          resolve(null);
        }
      });

      const picker = builder.build();
      picker.setVisible(true);
    } catch (err) {
      reject(
        err instanceof Error
          ? err
          : new Error('Não foi possível abrir o seletor do Google Drive.')
      );
    }
  });
}

export async function listDriveSpreadsheetFiles(
  token: string,
  searchTerm = ''
): Promise<DrivePickedFile[]> {
  const mimeClause = DRIVE_SPREADSHEET_MIME_TYPES.map((m) => `mimeType='${m}'`).join(' or ');
  const safeSearch = searchTerm.trim().replace(/'/g, "\\'");
  const q = safeSearch
    ? `trashed=false and (${mimeClause}) and name contains '${safeSearch}'`
    : `trashed=false and (${mimeClause})`;

  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink)',
    orderBy: 'modifiedTime desc',
    pageSize: '20',
  });

  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await ensureOkResponse(res, 'Falha ao listar planilhas do Google Drive');

  const payload = (await res.json()) as {
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      modifiedTime?: string;
      size?: string;
      webViewLink?: string;
    }>;
  };

  return (payload.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime,
    sizeBytes: f.size ? Number(f.size) : undefined,
    url: f.webViewLink,
  }));
}

export async function fetchGoogleSpreadsheetMetadata(
  token: string,
  spreadsheetId: string
): Promise<GoogleSpreadsheetMetadata> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}?fields=spreadsheetId,properties.title,sheets.properties(sheetId,title,gridProperties)`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  await ensureOkResponse(res, 'Falha ao ler metadados da planilha Google Sheets');
  const data = (await res.json()) as {
    spreadsheetId?: string;
    properties?: { title?: string };
    sheets?: Array<{
      properties?: {
        sheetId?: number;
        title?: string;
        gridProperties?: { rowCount?: number; columnCount?: number };
      };
    }>;
  };

  return {
    spreadsheetId: data.spreadsheetId || spreadsheetId,
    title: data.properties?.title || 'Planilha Google Sheets',
    sheets: (data.sheets || [])
      .map((s) => ({
        sheetId: s.properties?.sheetId ?? 0,
        title: s.properties?.title || 'Planilha1',
        rowCount: s.properties?.gridProperties?.rowCount,
        columnCount: s.properties?.gridProperties?.columnCount,
      }))
      .filter((s) => Boolean(s.title)),
  };
}

export async function fetchGoogleSheetValues(
  token: string,
  spreadsheetId: string,
  sheetTitle: string
): Promise<string[][]> {
  const quotedTitle = `'${sheetTitle.replace(/'/g, "''")}'!A1:Z2000`;
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(quotedTitle)}?valueRenderOption=FORMATTED_VALUE`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  await ensureOkResponse(res, 'Falha ao carregar linhas da aba do Google Sheets');
  const data = (await res.json()) as { values?: unknown[][] };
  return (data.values || []).map((row) =>
    (Array.isArray(row) ? row : []).map((cell) => (cell == null ? '' : String(cell).trim()))
  );
}

export async function downloadDriveFileArrayBuffer(
  token: string,
  fileId: string
): Promise<ArrayBuffer> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  await ensureOkResponse(
    res,
    'Falha ao baixar arquivo do Google Drive (se o arquivo não foi criado pelo app, selecione-o pelo Google Picker para liberar o acesso)'
  );
  return await res.arrayBuffer();
}

// Google Sheets Export with formula injection protection + Banco / Código Banco / Conta
export const exportToGoogleSheets = async (
  token: string,
  transactions: Transaction[],
  accounts: readonly Account[] = []
) => {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title: `Sávio Finanças - Relatório ${todayDisplayPtBr()}` },
    }),
  });
  await ensureOkResponse(createRes, 'Falha ao criar planilha no Google Sheets');
  const spreadsheet = await createRes.json();
  const spreadsheetId = spreadsheet.spreadsheetId;

  const rows = [
    [
      'Data',
      'Descrição',
      'Categoria',
      'Vínculo',
      'Banco',
      'Cód. Banco',
      'Conta',
      'Direção',
      'Valor (R$)',
      'Observações',
    ].map(sanitizeCellForSheet),
    ...transactions.map((t) => {
      const acc = accountById.get(t.accountId);
      const bank = resolveBankIdentity(acc?.institutionName || t.account, acc?.bankCode);
      const accountLabel = acc ? `${acc.institutionName} · ${acc.accountName}` : t.account;
      return [
        sanitizeCellForSheet(t.date),
        sanitizeCellForSheet(t.description),
        sanitizeCellForSheet(t.category),
        sanitizeCellForSheet(t.entityId),
        sanitizeCellForSheet(acc?.institutionName || bank.nome),
        sanitizeCellForSheet(acc?.bankCode || bank.codigo || ''),
        sanitizeCellForSheet(accountLabel),
        sanitizeCellForSheet(
          t.isInternalTransfer
            ? 'Transferência'
            : t.direction === 'INCOME'
              ? 'Receita'
              : 'Despesa'
        ),
        sanitizeCellForSheet(t.amount),
        sanitizeCellForSheet(t.notes || ''),
      ];
    }),
  ];

  const appendRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1:append?valueInputOption=USER_ENTERED`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        range: 'A1',
        majorDimension: 'ROWS',
        values: rows,
      }),
    }
  );

  await ensureOkResponse(appendRes, 'Falha ao inserir dados no Google Sheets');

  return spreadsheet.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
};

// Google Calendar Event Sync with exclusive end date for all-day events and res.ok check
export const syncBoletoToCalendar = async (
  token: string,
  boleto: {
    beneficiario: string;
    valorOriginal: number;
    vencimento: string;
    descricao: string;
  }
) => {
  const exclusiveEndDate = addDaysLocal(boleto.vencimento, 1);

  const event = {
    summary: `[Sávio Finanças] Vencimento: ${boleto.beneficiario} - R$ ${boleto.valorOriginal}`,
    description: `Boleto / Conta a pagar: ${boleto.descricao}`,
    start: { date: boleto.vencimento },
    end: { date: exclusiveEndDate },
    reminders: {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 1440 }],
    },
  };

  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    }
  );

  await ensureOkResponse(res, 'Falha ao sincronizar com Google Calendar');
  return await res.json();
};

// Google Drive Backup with res.ok check
export const backupToGoogleDrive = async (token: string, financialData: unknown) => {
  const fileContent = JSON.stringify(financialData, null, 2);
  const metadata = {
    name: `Savio_Financas_Backup_${todayLocal()}.json`,
    mimeType: 'application/json',
  };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', new Blob([fileContent], { type: 'application/json' }));

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    }
  );

  await ensureOkResponse(res, 'Falha ao enviar backup para o Google Drive');
  return await res.json();
};

export const uploadExcelToGoogleDrive = async (
  token: string,
  fileName: string,
  workbookBytes: ArrayBuffer | Uint8Array
) => {
  const metadata = {
    name: fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  const bytesCopy =
    workbookBytes instanceof Uint8Array
      ? new Uint8Array(workbookBytes)
      : new Uint8Array(workbookBytes);
  form.append(
    'file',
    new Blob([bytesCopy], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  );

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    }
  );

  await ensureOkResponse(res, 'Falha ao enviar planilha Excel para o Google Drive');
  return (await res.json()) as { id: string; name?: string };
};

export interface GmailAttachmentMeta {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  hasAttachments: boolean;
  attachments: GmailAttachmentMeta[];
}

export interface GmailMessageDetail extends GmailMessageSummary {
  plainText: string;
}

interface GmailPartPayload {
  mimeType?: string;
  filename?: string;
  body?: {
    data?: string;
    attachmentId?: string;
    size?: number;
  };
  parts?: GmailPartPayload[];
}

interface GmailHeader {
  name?: string;
  value?: string;
}

export function decodeBase64UrlToUint8Array(base64Url: string): Uint8Array {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const normalized = padded + '='.repeat(padLen);
  const binary = atob(normalized);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function decodeBase64UrlToUtf8(base64Url: string): string {
  const bytes = decodeBase64UrlToUint8Array(base64Url);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectGmailParts(
  part: GmailPartPayload | undefined,
  textChunks: string[],
  htmlChunks: string[],
  attachments: GmailAttachmentMeta[]
): void {
  if (!part) return;
  const mime = (part.mimeType || '').toLowerCase();
  const filename = (part.filename || '').trim();

  if (filename && part.body?.attachmentId) {
    attachments.push({
      attachmentId: part.body.attachmentId,
      filename,
      mimeType: mime || 'application/octet-stream',
      size: Number(part.body.size || 0),
    });
  } else if (part.body?.data) {
    const decoded = decodeBase64UrlToUtf8(part.body.data);
    if (mime === 'text/plain') textChunks.push(decoded);
    else if (mime === 'text/html') htmlChunks.push(decoded);
  }

  if (Array.isArray(part.parts)) {
    for (const sub of part.parts) {
      collectGmailParts(sub, textChunks, htmlChunks, attachments);
    }
  }
}

function extractHeaderValue(headers: GmailHeader[] | undefined, name: string): string {
  if (!headers) return '';
  const target = name.toLowerCase();
  return headers.find((h) => (h.name || '').toLowerCase() === target)?.value || '';
}

export async function searchGmailStatementMessages(
  token: string,
  customQuery = '',
  maxResults = 15
): Promise<GmailMessageSummary[]> {
  const defaultQuery =
    '(extrato OR fatura OR cartao OR "cartão" OR comprovante OR nubank OR itau OR bradesco OR santander OR inter OR bb OR caixa OR c6 OR sicredi OR sicoob)';
  const q = customQuery.trim() ? customQuery.trim() : defaultQuery;

  const listParams = new URLSearchParams({
    q,
    maxResults: String(Math.max(1, Math.min(30, maxResults))),
  });

  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${listParams.toString()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  await ensureOkResponse(listRes, 'Falha ao buscar mensagens financeiras no Gmail');
  const listData = (await listRes.json()) as {
    messages?: Array<{ id: string; threadId: string }>;
  };
  const items = listData.messages || [];
  if (items.length === 0) return [];

  const details = await Promise.all(
    items.slice(0, maxResults).map(async (item): Promise<GmailMessageSummary | null> => {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=full`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!msgRes.ok) {
        if (msgRes.status === 401) {
          clearWorkspaceToken();
          throw new Error('Sessão Google expirada ou token inválido (401). Conecte novamente.');
        }
        return null;
      }
      const msgData = (await msgRes.json()) as {
        id: string;
        threadId: string;
        snippet?: string;
        payload?: GmailPartPayload & { headers?: GmailHeader[] };
      };
      const headers = msgData.payload?.headers;
      const attachments: GmailAttachmentMeta[] = [];
      collectGmailParts(msgData.payload, [], [], attachments);

      return {
        id: msgData.id,
        threadId: msgData.threadId,
        subject: extractHeaderValue(headers, 'Subject') || '(Sem assunto)',
        from: extractHeaderValue(headers, 'From') || 'Remetente desconhecido',
        date: extractHeaderValue(headers, 'Date') || '',
        snippet: msgData.snippet || '',
        hasAttachments: attachments.length > 0,
        attachments,
      };
    })
  );

  return details.filter((d): d is GmailMessageSummary => Boolean(d));
}

export async function getGmailMessageDetail(
  token: string,
  messageId: string
): Promise<GmailMessageDetail> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  await ensureOkResponse(res, 'Falha ao ler conteúdo do e-mail no Gmail');
  const msgData = (await res.json()) as {
    id: string;
    threadId: string;
    snippet?: string;
    payload?: GmailPartPayload & { headers?: GmailHeader[] };
  };

  const textChunks: string[] = [];
  const htmlChunks: string[] = [];
  const attachments: GmailAttachmentMeta[] = [];
  collectGmailParts(msgData.payload, textChunks, htmlChunks, attachments);

  const plainText =
    textChunks.join('\n').trim() ||
    stripHtmlTags(htmlChunks.join('\n')) ||
    msgData.snippet ||
    '';

  const headers = msgData.payload?.headers;
  return {
    id: msgData.id,
    threadId: msgData.threadId,
    subject: extractHeaderValue(headers, 'Subject') || '(Sem assunto)',
    from: extractHeaderValue(headers, 'From') || 'Remetente desconhecido',
    date: extractHeaderValue(headers, 'Date') || '',
    snippet: msgData.snippet || '',
    hasAttachments: attachments.length > 0,
    attachments,
    plainText,
  };
}

export async function downloadGmailAttachmentBytes(
  token: string,
  messageId: string,
  attachmentId: string
): Promise<ArrayBuffer> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(
      messageId
    )}/attachments/${encodeURIComponent(attachmentId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  await ensureOkResponse(res, 'Falha ao baixar anexo do Gmail');
  const payload = (await res.json()) as { data?: string };
  if (!payload.data) {
    throw new Error('O anexo retornado pelo Gmail está vazio.');
  }
  const bytes = decodeBase64UrlToUint8Array(payload.data);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

