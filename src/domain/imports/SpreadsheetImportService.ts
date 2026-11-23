import * as XLSX from 'xlsx';
import {
  Account,
  APP_CATEGORIES,
  CategoryRule,
  Direction,
  EntityId,
  OperationType,
  Transaction,
} from '../../types';
import {
  MoneyCents,
  cents,
  fromCents,
  parseSignedMoneyInput,
  toCents,
} from '../money/money';
import { generateEntityId } from '../common/id';
import { categorizeTransactionDescription } from '../transactions/CategorizationService';
import { checkDuplicateTransaction } from '../../utils/financeCalculations';
import { todayLocal } from '../../utils/dateUtils';
import { isCardBillPaymentTransaction } from '../accounts/BalanceCalculator';
import { classifyIncomeOrigin } from '../finance/FinanceConsolidationService';

export interface ParsedSpreadsheetSheet {
  name: string;
  rows: string[][]; // raw 2D grid
}

export interface ParsedSpreadsheetWorkbook {
  fileName: string;
  sourceType: 'LOCAL_EXCEL_CSV' | 'GOOGLE_DRIVE' | 'GOOGLE_SHEETS';
  sheets: ParsedSpreadsheetSheet[];
}

export interface SpreadsheetColumnMapping {
  headerRowIndex: number;
  dateCol: number;
  descriptionCol: number;
  amountCol: number; // used when single signed amount column OR fallback
  entradaCol: number; // -1 if unused
  saidaCol: number; // -1 if unused
  typeCol: number; // -1 if unused
  categoryCol: number; // -1 if unused
  notesCol: number; // -1 if unused
  externalIdCol: number; // -1 if unused
}

export interface MappedSpreadsheetRow {
  rowId: string;
  sourceRowIndex: number;
  date: string;
  description: string;
  amountCents: MoneyCents;
  amount: number;
  direction: Direction;
  category: string;
  operationType: OperationType;
  notes?: string;
  externalId?: string;
  idempotencyKey: string;
  isDuplicate: boolean;
  duplicateReason?: string;
  hasValidationError: boolean;
  validationError?: string;
  selected: boolean;
}

function normalizeHeader(cell: string): string {
  return (cell || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeCellValueToDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 25000 && raw < 80000) {
    // Excel serial date number (1900 epoch)
    const utcDays = Math.floor(raw - 25569);
    const dt = new Date(utcDays * 86400 * 1000);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(raw).trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }
  const brMatch = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (brMatch) {
    const p1 = Number(brMatch[1]);
    const p2 = Number(brMatch[2]);
    const yRaw = Number(brMatch[3]);
    const year = yRaw < 100 ? 2000 + yRaw : yRaw;
    // Assume DD/MM/YYYY unless second part > 12 (US MM/DD/YYYY)
    const day = p2 > 12 ? p2 : p1;
    const month = p2 > 12 ? p1 : p2;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseSpreadsheetBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  sourceType: ParsedSpreadsheetWorkbook['sourceType'] = 'LOCAL_EXCEL_CSV'
): ParsedSpreadsheetWorkbook {
  if (/\.csv$/i.test(fileName)) {
    let text = '';
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      text = new TextDecoder('windows-1252').decode(buffer);
    }
    const cleanText = text.replace(/^\uFEFF/, '');
    const lines = cleanText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) {
      return { fileName, sourceType, sheets: [] };
    }
    const sampleHeader = lines[0];
    const semiCount = (sampleHeader.match(/;/g) || []).length;
    const commaCount = (sampleHeader.match(/,/g) || []).length;
    const delimiter = semiCount >= commaCount && semiCount > 0 ? ';' : ',';
    const rows = lines.map((line) => parseCsvLine(line, delimiter));
    return {
      fileName,
      sourceType,
      sheets: rows.length > 0 ? [{ name: 'CSV', rows }] : [],
    };
  }

  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheets: ParsedSpreadsheetSheet[] = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: '',
      blankrows: false,
      raw: true,
    });
    const rows = aoa.map((row) =>
      (Array.isArray(row) ? row : []).map((cell) => {
        if (cell === null || cell === undefined) return '';
        if (typeof cell === 'number') return String(cell);
        return String(cell).trim();
      })
    );
    return { name, rows };
  }).filter((s) => s.rows.length > 0);

  return { fileName, sourceType, sheets };
}

export function parseSpreadsheetGrid(
  rows: unknown[][],
  fileName: string,
  sheetName = 'Planilha1',
  sourceType: ParsedSpreadsheetWorkbook['sourceType'] = 'GOOGLE_SHEETS'
): ParsedSpreadsheetWorkbook {
  const normalizedRows = rows
    .map((r) => (Array.isArray(r) ? r.map((c) => (c == null ? '' : String(c).trim())) : []))
    .filter((r) => r.some((cell) => cell.length > 0));
  return {
    fileName,
    sourceType,
    sheets: normalizedRows.length > 0 ? [{ name: sheetName, rows: normalizedRows }] : [],
  };
}

export function autoDetectSpreadsheetColumns(rows: string[][]): SpreadsheetColumnMapping {
  let headerRowIndex = 0;
  for (let r = 0; r < Math.min(10, rows.length); r += 1) {
    const nonEmpty = rows[r].filter((c) => c.trim().length > 0).length;
    if (nonEmpty >= 2) {
      const joined = rows[r].map(normalizeHeader).join(' ');
      if (/(data|date|descri|historico|valor|amount|entrada|saida|credito|debito)/.test(joined)) {
        headerRowIndex = r;
        break;
      }
    }
  }

  const headers = (rows[headerRowIndex] || []).map(normalizeHeader);
  const findCol = (patterns: RegExp[]): number => {
    for (const pat of patterns) {
      const idx = headers.findIndex((h) => pat.test(h));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const dateCol = findCol([/^data$/, /\bdata\b/, /\bdate\b/, /vencimento/, /dt/]);
  const descriptionCol = findCol([
    /^descricao$/,
    /descri/,
    /historico/,
    /lancamento/,
    /memorando/,
    /memo/,
    /titulo/,
    /establishment/,
  ]);
  const entradaCol = findCol([/^entrada/, /^credito/, /receita/]);
  const saidaCol = findCol([/^saida/, /^debito/, /despesa/]);
  const amountCol = findCol([/^valor$/, /valor/, /amount/, /quantia/, /total/]);
  const typeCol = findCol([/^tipo$/, /direcao/, /natureza/, /movimentacao/]);
  const categoryCol = findCol([/^categoria$/, /categ/]);
  const notesCol = findCol([/observa/, /nota/, /notes/]);
  const externalIdCol = findCol([/e2e/, /id externo/, /codigo/, /identificador/, /documento/]);

  return {
    headerRowIndex,
    dateCol: dateCol >= 0 ? dateCol : 0,
    descriptionCol: descriptionCol >= 0 ? descriptionCol : Math.min(1, Math.max(0, headers.length - 1)),
    amountCol: amountCol >= 0 ? amountCol : Math.max(0, headers.length - 1),
    entradaCol,
    saidaCol,
    typeCol,
    categoryCol,
    notesCol,
    externalIdCol,
  };
}

export function buildImportBatchFingerprint(params: {
  fileName: string;
  sheetName: string;
  accountId: string;
  rowCount: number;
  sampleSignature: string;
}): string {
  const raw = `${params.fileName}|${params.sheetName}|${params.accountId}|${params.rowCount}|${params.sampleSignature}`;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `batch-${(hash >>> 0).toString(16)}`;
}

export function buildImportRowIdempotencyKey(params: {
  accountId: string;
  date: string;
  description: string;
  amountCents: MoneyCents;
  direction: Direction;
  externalId?: string;
}): string {
  if (params.externalId?.trim()) {
    return `sheet-ext-${params.accountId}-${params.externalId.trim()}`;
  }
  const cleanDesc = params.description.trim().toLowerCase().replace(/\s+/g, ' ');
  const keyBase = `${params.accountId}|${params.date}|${params.direction}|${params.amountCents}|${cleanDesc}`;
  let h = 2166136261;
  for (let i = 0; i < keyBase.length; i += 1) {
    h ^= keyBase.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `sheet-row-${(h >>> 0).toString(16)}`;
}

function parseUnsignedOrSignedMoney(raw: string): MoneyCents | null {
  const cleaned = (raw || '').trim();
  if (!cleaned) return null;
  try {
    // Support parentheses negative notation "(150,00)"
    if (/^\(.*\)$/.test(cleaned)) {
      const inner = cleaned.slice(1, -1);
      const val = parseSignedMoneyInput(inner);
      return cents(-Math.abs(val));
    }
    // Check if US decimal like "1234.56" (dot with 1-2 decimals and no comma)
    if (/^[-+]?R?\$?\s*\d+(?:,\d{3})*\.\d{1,2}$/i.test(cleaned)) {
      const stripped = cleaned.replace(/[R$\s,]/g, '');
      const num = Number(stripped);
      if (Number.isFinite(num)) return toCents(num);
    }
    return parseSignedMoneyInput(cleaned);
  } catch {
    return null;
  }
}

export function mapSpreadsheetRowsForAccount(params: {
  rows: string[][];
  mapping: SpreadsheetColumnMapping;
  targetAccount: Account;
  existingTransactions: readonly Transaction[];
  categoryRules?: readonly CategoryRule[];
}): MappedSpreadsheetRow[] {
  const { rows, mapping, targetAccount, existingTransactions, categoryRules = [] } = params;
  const activeExisting = existingTransactions.filter(
    (t) => t.status !== 'CANCELLED' && t.accountId === targetAccount.id
  );
  const existingKeys = new Set(
    existingTransactions.map((t) => t.idempotencyKey).filter(Boolean) as string[]
  );
  const existingExternalIds = new Set(
    activeExisting.map((t) => t.externalId).filter(Boolean) as string[]
  );

  const seenInBatch = new Set<string>();
  const dataRows = rows.slice(mapping.headerRowIndex + 1);
  const mapped: MappedSpreadsheetRow[] = [];

  for (let idx = 0; idx < dataRows.length; idx += 1) {
    const row = dataRows[idx];
    if (!row || row.every((c) => !c.trim())) continue;

    const rawDateCell = mapping.dateCol >= 0 ? row[mapping.dateCol] : '';
    const parsedDate =
      normalizeCellValueToDate(
        /^\d+(\.\d+)?$/.test(rawDateCell) ? Number(rawDateCell) : rawDateCell
      ) || todayLocal();
    const dateValid = Boolean(
      normalizeCellValueToDate(
        /^\d+(\.\d+)?$/.test(rawDateCell) ? Number(rawDateCell) : rawDateCell
      )
    );

    const description =
      (mapping.descriptionCol >= 0 ? row[mapping.descriptionCol] : '').trim() ||
      'Movimentação importada';

    let amountCents: MoneyCents = cents(0);
    let direction: Direction = 'EXPENSE';

    const entradaRaw = mapping.entradaCol >= 0 ? (row[mapping.entradaCol] || '').trim() : '';
    const saidaRaw = mapping.saidaCol >= 0 ? (row[mapping.saidaCol] || '').trim() : '';

    if (entradaRaw || saidaRaw) {
      const entCents = parseUnsignedOrSignedMoney(entradaRaw);
      const saiCents = parseUnsignedOrSignedMoney(saidaRaw);
      if (entCents && Math.abs(entCents) > 0) {
        amountCents = cents(Math.abs(entCents));
        direction = 'INCOME';
      } else if (saiCents && Math.abs(saiCents) > 0) {
        amountCents = cents(Math.abs(saiCents));
        direction = 'EXPENSE';
      }
    } else if (mapping.amountCol >= 0) {
      const rawAmt = (row[mapping.amountCol] || '').trim();
      const parsed = parseUnsignedOrSignedMoney(rawAmt);
      if (parsed !== null && parsed !== 0) {
        amountCents = cents(Math.abs(parsed));
        direction = parsed >= 0 ? 'INCOME' : 'EXPENSE';
      }
    }

    if (mapping.typeCol >= 0 && row[mapping.typeCol]) {
      const tVal = normalizeHeader(row[mapping.typeCol]);
      if (/entrada|receita|credito|\bcr\b|\bincome\b|\+\b/.test(tVal)) {
        direction = 'INCOME';
      } else if (/saida|despesa|debito|\bdb\b|\bexpense\b|pagamento/.test(tVal)) {
        direction = 'EXPENSE';
      }
    }

    const rawCat = mapping.categoryCol >= 0 ? (row[mapping.categoryCol] || '').trim() : '';
    const matchedCat =
      (APP_CATEGORIES as readonly string[]).find(
        (c) => normalizeHeader(c) === normalizeHeader(rawCat)
      ) || '';

    const autoCat = categorizeTransactionDescription({
      description,
      direction,
      customRules: [...categoryRules],
      fallbackCategory: matchedCat || 'Outros',
    });

    const category = matchedCat || autoCat.category;
    const notes = mapping.notesCol >= 0 ? (row[mapping.notesCol] || '').trim() || undefined : undefined;
    const externalId =
      mapping.externalIdCol >= 0 ? (row[mapping.externalIdCol] || '').trim() || undefined : undefined;

    const idempotencyKey = buildImportRowIdempotencyKey({
      accountId: targetAccount.id,
      date: parsedDate,
      description,
      amountCents,
      direction,
      externalId,
    });

    const dupByKey = existingKeys.has(idempotencyKey);
    const dupByExternal = Boolean(externalId && existingExternalIds.has(externalId));
    const dupByHeuristic =
      amountCents > 0 &&
      checkDuplicateTransaction(activeExisting, {
        date: parsedDate,
        description,
        amount: fromCents(amountCents),
        amountCents,
      });
    const dupInsideBatch = seenInBatch.has(idempotencyKey);
    seenInBatch.add(idempotencyKey);

    const isDuplicate = dupByKey || dupByExternal || dupByHeuristic || dupInsideBatch;
    const duplicateReason = dupByKey
      ? 'Chave de idempotência já importada nesta conta'
      : dupByExternal
        ? 'ID externo já existente nesta conta'
        : dupByHeuristic
          ? 'Lançamento equivalente já confirmado nesta data/conta'
          : dupInsideBatch
            ? 'Linha repetida na mesma planilha'
            : undefined;

    const hasValidationError = amountCents <= 0 || !dateValid;
    const validationError =
      amountCents <= 0
        ? 'Valor inválido ou zerado'
        : !dateValid
          ? 'Data não reconhecida'
          : undefined;

    mapped.push({
      rowId: generateEntityId('srow'),
      sourceRowIndex: mapping.headerRowIndex + 2 + idx,
      date: parsedDate,
      description,
      amountCents,
      amount: fromCents(amountCents),
      direction,
      category,
      operationType: /pix/i.test(description)
        ? 'PIX'
        : /boleto/i.test(description)
          ? 'BOLETO'
          : /ted|doc/i.test(description)
            ? 'TED_DOC'
            : 'OUTRO',
      notes,
      externalId,
      idempotencyKey,
      isDuplicate,
      duplicateReason,
      hasValidationError,
      validationError,
      selected: !isDuplicate && !hasValidationError,
    });
  }

  return mapped;
}

export function buildTransactionsFromMappedRows(params: {
  rows: readonly MappedSpreadsheetRow[];
  targetAccount: Account;
  importBatchId: string;
  entityOverride?: EntityId;
}): Omit<Transaction, 'id'>[] {
  const { rows, targetAccount, importBatchId, entityOverride } = params;
  const resolvedEntity = entityOverride || targetAccount.entityId;

  return rows
    .filter((r) => r.selected && !r.hasValidationError && r.amountCents > 0)
    .map((r) => {
      const billFlag = isCardBillPaymentTransaction({
        description: r.description,
        category: r.category,
        direction: r.direction,
      });
      const incomeMatch =
        r.direction === 'INCOME'
          ? classifyIncomeOrigin({
              description: r.description,
              category: r.category,
              account: `${targetAccount.institutionName} · ${targetAccount.accountName}`,
              entityId: resolvedEntity,
            })
          : null;

      return {
        entityId: resolvedEntity,
        accountId: targetAccount.id,
        date: r.date,
        description: r.description,
        originalDescription: r.description,
        category: r.category,
        account: `${targetAccount.institutionName} · ${targetAccount.accountName}`,
        amountCents: r.amountCents,
        amount: fromCents(r.amountCents),
        direction: r.direction,
        status: 'CONFIRMED',
        origin: 'IMPORT',
        operationType: r.operationType,
        importBatchId,
        idempotencyKey: r.idempotencyKey,
        ...(r.externalId ? { externalId: r.externalId } : {}),
        ...(r.notes ? { notes: r.notes } : {}),
        ...(billFlag ? { isCardBillPayment: true, isInternalTransfer: true } : {}),
        ...(incomeMatch
          ? {
              incomeOrigin: incomeMatch.originKey,
              incomeSourceName: incomeMatch.sourceName,
            }
          : {}),
      };
    });
}
