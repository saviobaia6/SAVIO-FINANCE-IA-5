import { z } from 'zod';
import {
  APP_CATEGORIES,
  type CategoryRule,
  type CreditCard,
  type Direction,
  type Transaction,
  type TransactionStatus,
} from '../../types';
import {
  cents,
  fromCents,
  getTransactionAmountCents,
  toCents,
  ZERO_CENTS,
  type MoneyCents,
} from '../money/money';
import { addMonthsLocal, normalizeToIsoDate, todayLocal } from '../../utils/dateUtils';
import { generateEntityId } from '../common/id';
import {
  computeBillingCycleDates,
  type CardEntryKind,
  type MappedCardSpreadsheetRow,
} from './CardLedgerService';

export const INVOICE_AUDITOR_CATEGORIES = [
  'Alimentação',
  'Transporte',
  'Saúde',
  'Educação',
  'Lazer',
  'Compras',
  'Assinaturas',
  'Serviços',
  'Outros',
] as const;

export type AuditedInvoiceCategory = (typeof INVOICE_AUDITOR_CATEGORIES)[number];

export const ALL_CARD_CATEGORIES: string[] = Array.from(
  new Set<string>([...INVOICE_AUDITOR_CATEGORIES, ...APP_CATEGORIES])
);

export const AuditedInvoiceTransactionSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  descricao: z.string().min(1),
  valor: z.number().finite(),
  tipo: z.enum(['avista', 'parcelada']),
  parcela_atual: z.number().int().min(1).default(1),
  total_parcelas: z.number().int().min(1).default(1),
  categoria: z.enum(INVOICE_AUDITOR_CATEGORIES).default('Outros'),
});

export const AuditedInvoiceSummarySchema = z.object({
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  valor_total_identificado: z.number().finite().default(0),
});

export const AuditedInvoiceResultSchema = z.object({
  resumo_fatura: AuditedInvoiceSummarySchema,
  transacoes: z.array(AuditedInvoiceTransactionSchema).default([]),
});

export type AuditedInvoiceTransaction = z.infer<typeof AuditedInvoiceTransactionSchema>;
export type AuditedInvoiceSummary = z.infer<typeof AuditedInvoiceSummarySchema>;
export type AuditedInvoiceResult = z.infer<typeof AuditedInvoiceResultSchema>;

export interface AuditedCardKpiMetrics {
  faturaAtualCents: MoneyCents;
  comprasAVistaCents: MoneyCents;
  estornosCents: MoneyCents;
  comprasParceladasAtualCents: MoneyCents;
  comprasParceladasCount: number;
  previsaoProximaFaturaCents: MoneyCents;
  previsaoTotalFuturoCents: MoneyCents;
  futurasParcelasCount: number;
}

export interface MappedAuditedCardRow extends MappedCardSpreadsheetRow {
  auditedTipo: 'avista' | 'parcelada';
  parcelaAtual: number;
  totalParcelas: number;
  auditedCategory: AuditedInvoiceCategory;
}

const IGNORED_INVOICE_LINE_PATTERNS: RegExp[] = [
  /\bpagamento\s*(?:de\s*)?fatura\b/i,
  /\bpgto\s*(?:de\s*)?fatura\b/i,
  /\bpagamento\s*recebido\b/i,
  /\bpagamento\s*efetuado\b/i,
  /\bcr[eé]dito\s*(?:de\s*)?pagamento\b/i,
  /\bsaldo\s*anterior\b/i,
  /\bsaldo\s*em\s*aberto\b/i,
  /\blimite\s*(?:total|dispon[ií]vel|de\s*cr[eé]dito|saque)\b/i,
  /\btotal\s*da\s*fatura\b/i,
  /\bvalor\s*da\s*fatura\b/i,
  /\bpagamento\s*m[ií]nimo\b/i,
  /\bencargos\s*rotativo/i,
  /\bfatura\s*anterior\b/i,
  /\bdeb\.?\s*autom[aá]tico\s*fatura\b/i,
];

export function shouldIgnoreInvoiceLine(description: string): boolean {
  const clean = (description || '').trim();
  if (!clean) return true;
  // Never ignore IOF, anuidade, juros, or legitimate store reversals
  if (/\b(?:iof|tarifa|anuidade|estorno|reembolso|cashback|devolu[cç][aã]o)\b/i.test(clean)) {
    return false;
  }
  return IGNORED_INVOICE_LINE_PATTERNS.some((re) => re.test(clean));
}

export function cleanEstablishmentName(raw: string): string {
  let out = (raw || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip explicit installment markers when extracting clean establishment name
  out = out
    .replace(/\bparc(?:ela)?\.?\s*\d{1,2}\s*(?:de|\/)\s*\d{1,2}\b/gi, '')
    .replace(/\(\s*\d{1,2}\s*\/\s*\d{1,2}\s*\)/g, '')
    .replace(/\b\d{1,2}\s*\/\s*\d{1,2}\b\s*$/g, '')
    .replace(/\*+/g, ' ')
    .replace(/\s+-\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return out || (raw || '').trim() || 'Estabelecimento não identificado';
}

export function extractInstallmentInfo(description: string): {
  tipo: 'avista' | 'parcelada';
  parcela_atual: number;
  total_parcelas: number;
  cleanDescription: string;
} {
  const raw = (description || '').trim();
  // Match "PARC 2 DE 10", "PARCELA 02/10", "02/10" (avoiding full dates DD/MM/YYYY)
  const parcDeMatch = raw.match(/\bparc(?:ela)?\.?\s*(\d{1,2})\s*(?:de|\/)\s*(\d{1,2})\b/i);
  const slashMatch =
    parcDeMatch ||
    raw.match(/(?:^|\s|\()(\d{1,2})\s*\/\s*(\d{1,2})(?!\/\d)(?:\s|\)|$)/);

  if (slashMatch) {
    const cur = Number(slashMatch[1]);
    const tot = Number(slashMatch[2]);
    if (cur >= 1 && tot > 1 && tot <= 48 && cur <= tot) {
      return {
        tipo: 'parcelada',
        parcela_atual: cur,
        total_parcelas: tot,
        cleanDescription: cleanEstablishmentName(raw),
      };
    }
  }

  return {
    tipo: 'avista',
    parcela_atual: 1,
    total_parcelas: 1,
    cleanDescription: cleanEstablishmentName(raw),
  };
}

export function classifyAuditedCategory(
  description: string,
  hintCategory?: string
): AuditedInvoiceCategory {
  if (
    hintCategory &&
    (INVOICE_AUDITOR_CATEGORIES as readonly string[]).includes(hintCategory)
  ) {
    return hintCategory as AuditedInvoiceCategory;
  }

  const d = (description || '').toLowerCase();

  if (
    /\b(ifood|rappi|ubereats|restaurante|lanchonete|padaria|pizzaria|hamburgu|caf[eé]|starbucks|supermercado|mercado|atacad|hortifruti|açougue|acougue|carrefour|assai|extra|p[aã]o\s*de\s*a[cç][uú]car|mcdonald|burger|outback|coco\s*bambu)\b/i.test(
      d
    )
  ) {
    return 'Alimentação';
  }
  if (
    /\b(uber|99app|99\s*pop|cabify|posto|combust[ií]vel|gasolina|etanol|ipiranga|shell|petrobras|estacionamento|ped[aá]gio|sem\s*parar|veloe|passagem|latam|gol|azul|metro|metr[oô]|onibus|bilhete)\b/i.test(
      d
    )
  ) {
    return 'Transporte';
  }
  if (
    /\b(farm[aá]cia|drogaria|droga\s*raia|drogasil|pacheco|pague\s*menos|cl[ií]nica|hospital|laborat[oó]rio|m[eé]dico|odonto|dentista|unimed|amil|sulamerica|exame|psic[oó]log|consulta)\b/i.test(
      d
    )
  ) {
    return 'Saúde';
  }
  if (
    /\b(escola|faculdade|universidade|curso|udemy|alura|coursera|livro|livraria|saraiva|cultura|duolingo|ingl[eê]s|mensalidade\s*escolar|material\s*escolar)\b/i.test(
      d
    )
  ) {
    return 'Educação';
  }
  if (
    /\b(cinema|cinemark|ingresso|show|teatro|parque|viagem|hotel|airbnb|booking|playstation|xbox|steam|nintendo|bar|pub|clube|entretenimento)\b/i.test(
      d
    )
  ) {
    return 'Lazer';
  }
  if (
    /\b(netflix|spotify|amazon\s*prime|disney|hbo|max|globoplay|apple\.com|icloud|google\s*one|youtube\s*premium|chatgpt|openai|adobe|canva|microsoft\s*365|assinatura)\b/i.test(
      d
    )
  ) {
    return 'Assinaturas';
  }
  if (
    /\b(amazon|mercadolivre|mercado\s*livre|shopee|shein|magalu|magazine\s*luiza|americanas|casas\s*bahia|renner|riachuelo|cea|c&a|zara|centauro|netshoes|loja|kalunga|kabum|pichau|aliexpress)\b/i.test(
      d
    )
  ) {
    return 'Compras';
  }
  if (
    /\b(vivo|claro|tim|oi|internet|energia|luz|enel|cpfl|sabesp|[aá]gua|g[aá]s|condom[ií]nio|sal[aã]o|barbearia|lavanderia|manuten[cç][aã]o|oficina|iof|tarifa|anuidade|seguro|cart[oã]rio)\b/i.test(
      d
    )
  ) {
    return 'Serviços';
  }

  return 'Outros';
}

export function sanitizeAuditedInvoiceResult(raw: unknown): AuditedInvoiceResult {
  const parsed = AuditedInvoiceResultSchema.safeParse(raw);
  const baseObj = parsed.success
    ? parsed.data
    : {
        resumo_fatura: { vencimento: null, valor_total_identificado: 0 },
        transacoes: [],
      };

  const today = todayLocal();
  const cleanTxs: AuditedInvoiceTransaction[] = [];

  for (const item of baseObj.transacoes) {
    if (shouldIgnoreInvoiceLine(item.descricao)) continue;
    if (!Number.isFinite(item.valor) || item.valor === 0) continue;

    const isoDate = normalizeToIsoDate(item.data) || today;
    const inst = extractInstallmentInfo(item.descricao);
    const totalParcelas =
      item.total_parcelas > 1
        ? Math.min(48, Math.trunc(item.total_parcelas))
        : inst.total_parcelas;
    const parcelaAtual =
      totalParcelas > 1
        ? Math.max(
            1,
            Math.min(
              totalParcelas,
              item.total_parcelas > 1 ? Math.trunc(item.parcela_atual) : inst.parcela_atual
            )
          )
        : 1;
    const tipo: 'avista' | 'parcelada' = totalParcelas > 1 ? 'parcelada' : 'avista';

    // Guarantee reversals/discounts stay negative
    const isReversalText =
      /\b(estorno|reembolso|devolu[cç][aã]o|desconto\s*(?:na\s*)?fatura|cr[eé]dito\s*(?:em\s*)?fatura|cashback)\b/i.test(
        item.descricao
      );
    const normalizedValor =
      item.valor < 0 || isReversalText
        ? -Math.abs(Number(item.valor.toFixed(2)))
        : Math.abs(Number(item.valor.toFixed(2)));

    const cleanDesc = cleanEstablishmentName(item.descricao);
    const category = classifyAuditedCategory(cleanDesc, item.categoria);

    cleanTxs.push({
      data: isoDate,
      descricao: cleanDesc,
      valor: normalizedValor,
      tipo,
      parcela_atual: parcelaAtual,
      total_parcelas: totalParcelas,
      categoria: category,
    });
  }

  const netSum = Number(
    cleanTxs.reduce((acc, t) => acc + t.valor, 0).toFixed(2)
  );
  const rawTotal = baseObj.resumo_fatura.valor_total_identificado;
  const totalIdentificado =
    typeof rawTotal === 'number' && Number.isFinite(rawTotal) && rawTotal > 0
      ? Number(rawTotal.toFixed(2))
      : Math.max(0, netSum);

  const vencimento = baseObj.resumo_fatura.vencimento
    ? normalizeToIsoDate(baseObj.resumo_fatura.vencimento)
    : null;

  return {
    resumo_fatura: {
      vencimento,
      valor_total_identificado: totalIdentificado,
    },
    transacoes: cleanTxs,
  };
}

function splitCsvLine(line: string, delimiter: string): string[] {
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

function parseBrazilianAmountNumber(raw: string): number | null {
  const cleaned = raw.replace(/[R$\s]/gi, '').replace(/^'+/, '');
  if (!cleaned) return null;
  const hasComma = cleaned.includes(',');
  const normalized = hasComma
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned;
  const n = Number(normalized);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function parseFlexibleInvoiceDate(raw: string, fallbackYear: string): string | null {
  const trimmed = raw.trim();
  const direct = normalizeToIsoDate(trimmed);
  if (direct) return direct;

  const ddMm = trimmed.match(/^(\d{2})\/(\d{2})$/);
  if (ddMm) {
    const candidate = `${fallbackYear}-${ddMm[2]}-${ddMm[1]}`;
    return normalizeToIsoDate(candidate);
  }
  return null;
}

export function auditCardCsvContent(
  csvText: string,
  _fileName?: string
): AuditedInvoiceResult {
  const cleanText = csvText.replace(/^\uFEFF/, '');
  const lines = cleanText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return {
      resumo_fatura: { vencimento: null, valor_total_identificado: 0 },
      transacoes: [],
    };
  }

  // Try extracting vencimento from metadata header lines if present
  let detectedDueDate: string | null = null;
  for (const line of lines.slice(0, 8)) {
    const dueMatch = line.match(/vencimento[^0-9]*(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/i);
    if (dueMatch) {
      detectedDueDate = normalizeToIsoDate(dueMatch[1]);
      if (detectedDueDate) break;
    }
  }

  // Detect delimiter from first 5 non-empty lines
  const sample = lines.slice(0, 5).join('\n');
  const semiCount = (sample.match(/;/g) || []).length;
  const commaCount = (sample.match(/,/g) || []).length;
  const tabCount = (sample.match(/\t/g) || []).length;
  const delimiter =
    tabCount > semiCount && tabCount > commaCount
      ? '\t'
      : semiCount >= commaCount
        ? ';'
        : ',';

  const matrix = lines.map((l) => splitCsvLine(l, delimiter));

  // Locate header row
  let headerIdx = 0;
  let dateCol = -1;
  let descCol = -1;
  let amountCol = -1;
  let categoryCol = -1;

  for (let r = 0; r < Math.min(10, matrix.length); r += 1) {
    const row = matrix[r];
    const lower = row.map((c) => c.toLowerCase());
    const dIdx = lower.findIndex((c) => /data|dt\b|compra/.test(c));
    const descIdx = lower.findIndex((c) =>
      /descri|estabelecimento|title|hist|lan[cç]amento|memo|merchant/.test(c)
    );
    const valIdx = lower.findIndex((c) => /valor|amount|montante|pre[cç]o/.test(c));
    const catIdx = lower.findIndex((c) => /categ/.test(c));

    if (dIdx >= 0 && (descIdx >= 0 || valIdx >= 0)) {
      headerIdx = r;
      dateCol = dIdx;
      descCol = descIdx >= 0 ? descIdx : dIdx + 1;
      amountCol = valIdx >= 0 ? valIdx : row.length - 1;
      categoryCol = catIdx;
      break;
    }
  }

  // Fallback headerless heuristic
  if (dateCol < 0) {
    headerIdx = -1;
    const firstRow = matrix[0] || [];
    dateCol = firstRow.findIndex((c) => /\d{2}\/\d{2}|\d{4}-\d{2}-\d{2}/.test(c));
    amountCol = firstRow.findIndex((c) => /^-?\s*(?:R\$)?\s*[\d.,]+$/.test(c));
    if (dateCol < 0) dateCol = 0;
    if (amountCol < 0) amountCol = Math.max(1, firstRow.length - 1);
    descCol = firstRow.findIndex((_, idx) => idx !== dateCol && idx !== amountCol);
    if (descCol < 0) descCol = 1;
  }

  const currentYear = todayLocal().slice(0, 4);
  const rawTxs: AuditedInvoiceTransaction[] = [];

  for (let r = headerIdx + 1; r < matrix.length; r += 1) {
    const row = matrix[r];
    if (!row || row.length < 2) continue;

    const rawDate = row[dateCol] || '';
    const isoDate = parseFlexibleInvoiceDate(rawDate, currentYear);
    if (!isoDate) continue;

    const rawDesc = row[descCol] || '';
    if (!rawDesc || shouldIgnoreInvoiceLine(rawDesc)) continue;

    const rawVal = row[amountCol] || '';
    const numVal = parseBrazilianAmountNumber(rawVal);
    if (numVal === null || numVal === 0) continue;

    const inst = extractInstallmentInfo(rawDesc);
    const rawCat = categoryCol >= 0 ? row[categoryCol] || '' : '';
    const category = classifyAuditedCategory(inst.cleanDescription, rawCat);

    rawTxs.push({
      data: isoDate,
      descricao: inst.cleanDescription,
      valor: numVal,
      tipo: inst.tipo,
      parcela_atual: inst.parcela_atual,
      total_parcelas: inst.total_parcelas,
      categoria: category,
    });
  }

  return sanitizeAuditedInvoiceResult({
    resumo_fatura: {
      vencimento: detectedDueDate,
      valor_total_identificado: Number(
        rawTxs.reduce((acc, t) => acc + t.valor, 0).toFixed(2)
      ),
    },
    transacoes: rawTxs,
  });
}

export function computeAuditedCardMetrics(
  audited: AuditedInvoiceResult
): AuditedCardKpiMetrics {
  let faturaAtual = 0;
  let comprasAVista = 0;
  let estornos = 0;
  let comprasParceladasAtual = 0;
  let comprasParceladasCount = 0;
  let previsaoProximaFatura = 0;
  let previsaoTotalFuturo = 0;
  let futurasParcelasCount = 0;

  for (const tx of audited.transacoes) {
    const valCents = toCents(Math.abs(tx.valor)) as number;
    if (tx.valor < 0) {
      estornos += valCents;
      faturaAtual -= valCents;
      continue;
    }

    if (tx.tipo === 'avista' && tx.total_parcelas <= 1) {
      comprasAVista += valCents;
      faturaAtual += valCents;
    } else {
      comprasParceladasAtual += valCents;
      comprasParceladasCount += 1;
      faturaAtual += valCents;

      const remaining = Math.max(0, tx.total_parcelas - tx.parcela_atual);
      if (remaining > 0) {
        previsaoProximaFatura += valCents;
        previsaoTotalFuturo += valCents * remaining;
        futurasParcelasCount += remaining;
      }
    }
  }

  return {
    faturaAtualCents: cents(Math.max(0, faturaAtual)),
    comprasAVistaCents: cents(comprasAVista),
    estornosCents: cents(estornos),
    comprasParceladasAtualCents: cents(comprasParceladasAtual),
    comprasParceladasCount,
    previsaoProximaFaturaCents: cents(previsaoProximaFatura),
    previsaoTotalFuturoCents: cents(previsaoTotalFuturo),
    futurasParcelasCount,
  };
}

export function mapAuditedInvoiceToCardRows(params: {
  audited: AuditedInvoiceResult;
  targetCard: CreditCard;
  existingTransactions: readonly Transaction[];
  categoryRules?: readonly CategoryRule[];
}): MappedAuditedCardRow[] {
  const { audited, targetCard, existingTransactions } = params;

  const cardExisting = existingTransactions.filter(
    (t) =>
      t.status !== 'CANCELLED' &&
      (t.creditCardId === targetCard.id || t.accountId === targetCard.id)
  );
  const existingKeys = new Set(
    existingTransactions.map((t) => t.idempotencyKey).filter(Boolean) as string[]
  );
  const seenInBatch = new Set<string>();

  return audited.transacoes.map((tx, idx) => {
    const isReversal = tx.valor < 0;
    const isFee =
      !isReversal &&
      /\b(iof|tarifa|anuidade|juros|multa|encargo)\b/i.test(tx.descricao);
    const isInstallment = !isReversal && (tx.tipo === 'parcelada' || tx.total_parcelas > 1);

    const cardEntryKind: CardEntryKind = isReversal
      ? 'REVERSAL'
      : isFee
        ? 'FEE'
        : isInstallment
          ? 'INSTALLMENT'
          : 'PURCHASE';

    const direction: Direction = isReversal ? 'INCOME' : 'EXPENSE';
    const amountCents = toCents(Math.abs(tx.valor));
    const displayDesc = isInstallment
      ? `${tx.descricao} (${tx.parcela_atual}/${tx.total_parcelas})`
      : tx.descricao;

    const cleanKeyDesc = displayDesc.trim().toLowerCase().replace(/\s+/g, ' ');
    const keyBase = `${targetCard.id}|${tx.data}|${cardEntryKind}|${amountCents}|${cleanKeyDesc}`;
    let h = 2166136261;
    for (let i = 0; i < keyBase.length; i += 1) {
      h ^= keyBase.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idempotencyKey = `card-audit-${(h >>> 0).toString(16)}`;

    const dupByKey = existingKeys.has(idempotencyKey);
    const dupByHeuristic = cardExisting.some(
      (existing) =>
        existing.date === tx.data &&
        getTransactionAmountCents(existing) === amountCents &&
        existing.description.trim().toLowerCase() === cleanKeyDesc
    );
    const dupInside = seenInBatch.has(idempotencyKey);
    seenInBatch.add(idempotencyKey);
    const isDuplicate = dupByKey || dupByHeuristic || dupInside;

    return {
      rowId: generateEntityId('acrow'),
      sourceRowIndex: idx + 1,
      date: tx.data,
      purchaseDate: tx.data,
      postingDate: tx.data,
      description: displayDesc,
      amountCents,
      amount: fromCents(amountCents),
      direction,
      category: tx.categoria,
      operationType: cardEntryKind === 'FEE' ? 'TARIFA' : 'CARTAO',
      cardEntryKind,
      installmentCurrent: isInstallment ? tx.parcela_atual : undefined,
      installmentTotal: isInstallment ? tx.total_parcelas : undefined,
      auditedTipo: tx.tipo,
      parcelaAtual: tx.parcela_atual,
      totalParcelas: tx.total_parcelas,
      auditedCategory: tx.categoria,
      idempotencyKey,
      isDuplicate,
      duplicateReason: dupByKey
        ? 'Lançamento já auditado neste cartão'
        : dupByHeuristic
          ? 'Compra equivalente já lançada nesta data'
          : dupInside
            ? 'Linha duplicada nesta fatura'
            : undefined,
      hasValidationError: amountCents <= 0,
      validationError: amountCents <= 0 ? 'Valor zerado ou inválido' : undefined,
      selected: !isDuplicate && amountCents > 0,
    };
  });
}

export function buildAuditedCardTransactions(params: {
  rows: readonly MappedAuditedCardRow[];
  targetCard: CreditCard;
  importBatchId: string;
  generateFutureInstallments?: boolean;
  existingTransactions?: readonly Transaction[];
}): Omit<Transaction, 'id'>[] {
  const {
    rows,
    targetCard,
    importBatchId,
    generateFutureInstallments = true,
    existingTransactions = [],
  } = params;

  const existingKeys = new Set(
    existingTransactions.map((t) => t.idempotencyKey).filter(Boolean) as string[]
  );
  const out: Omit<Transaction, 'id'>[] = [];

  for (const row of rows) {
    if (!row.selected || row.hasValidationError || row.amountCents <= 0) continue;

    const baseDate = row.postingDate || row.date;
    const baseCycle = computeBillingCycleDates(
      baseDate,
      targetCard.closingDay,
      targetCard.dueDay
    );
    const isInstallment =
      row.cardEntryKind === 'INSTALLMENT' &&
      (row.totalParcelas > 1 || (row.installmentTotal ?? 1) > 1);
    const curParc = row.installmentCurrent || row.parcelaAtual || 1;
    const totParc = row.installmentTotal || row.totalParcelas || 1;
    const cleanMerchant = cleanEstablishmentName(row.description);
    const groupId = isInstallment ? generateEntityId('cinst-audit') : undefined;

    out.push({
      entityId: targetCard.entityId,
      accountId: targetCard.id,
      creditCardId: targetCard.id,
      date: baseDate,
      purchaseDate: row.purchaseDate || baseDate,
      postingDate: baseDate,
      billingCycleYm: baseCycle.cycleYm,
      billingClosingDate: baseCycle.closingDate,
      billingDueDate: baseCycle.dueDate,
      cardEntryKind: row.cardEntryKind,
      ...(groupId ? { installmentGroupId: groupId } : {}),
      ...(isInstallment
        ? { installmentCurrent: curParc, installmentTotal: totParc }
        : {}),
      description: row.description,
      originalDescription: cleanMerchant,
      category: row.category || row.auditedCategory || 'Outros',
      account: `${targetCard.institutionName} · ${targetCard.cardName}`,
      amountCents: row.amountCents,
      amount: fromCents(row.amountCents),
      direction: row.direction,
      status: 'CONFIRMED' as TransactionStatus,
      origin: 'IMPORT',
      operationType: row.operationType,
      counterparty: cleanMerchant,
      importBatchId,
      idempotencyKey: row.idempotencyKey,
    });

    // Rule 3 from "Lógica para alimentar os Cards da sua Tela":
    // Automatically generate future installments (parcela_atual + 1 .. total_parcelas)
    if (generateFutureInstallments && isInstallment && curParc < totParc && groupId) {
      const purchaseOriginalDate = addMonthsLocal(baseDate, -(curParc - 1));
      for (let nextParc = curParc + 1; nextParc <= totParc; nextParc += 1) {
        const monthOffset = nextParc - curParc;
        const futurePostingDate = addMonthsLocal(baseDate, monthOffset);
        const futureCycle = computeBillingCycleDates(
          futurePostingDate,
          targetCard.closingDay,
          targetCard.dueDay
        );
        const futureKey = `card-audit-fut-${targetCard.id}-${purchaseOriginalDate}-${row.amountCents}-${cleanMerchant
          .toLowerCase()
          .replace(/\s+/g, '')}-${nextParc}of${totParc}`;

        if (existingKeys.has(futureKey)) continue;
        existingKeys.add(futureKey);

        out.push({
          entityId: targetCard.entityId,
          accountId: targetCard.id,
          creditCardId: targetCard.id,
          date: futurePostingDate,
          purchaseDate: purchaseOriginalDate,
          postingDate: futurePostingDate,
          billingCycleYm: futureCycle.cycleYm,
          billingClosingDate: futureCycle.closingDate,
          billingDueDate: futureCycle.dueDate,
          cardEntryKind: 'INSTALLMENT',
          installmentGroupId: groupId,
          installmentCurrent: nextParc,
          installmentTotal: totParc,
          description: `${cleanMerchant} (${nextParc}/${totParc})`,
          originalDescription: cleanMerchant,
          category: row.category || row.auditedCategory || 'Outros',
          account: `${targetCard.institutionName} · ${targetCard.cardName}`,
          amountCents: row.amountCents,
          amount: fromCents(row.amountCents),
          direction: 'EXPENSE',
          status: 'PENDING',
          origin: 'IMPORT',
          operationType: 'CARTAO',
          counterparty: cleanMerchant,
          importBatchId,
          idempotencyKey: futureKey,
        });
      }
    }
  }

  return out;
}

export async function fileOrBufferToBase64(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export async function auditCardInvoiceDocument(params: {
  fileName: string;
  mimeType: string;
  base64Data?: string;
  textContent?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}): Promise<AuditedInvoiceResult> {
  const fetchImpl = params.fetcher || fetch;
  const apiBase =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      ?.VITE_API_BASE_URL?.replace(/\/+$/, '') || '';

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 55000);

  const onAbort = () => controller.abort();
  if (params.signal) {
    if (params.signal.aborted) {
      clearTimeout(timer);
      throw new Error('Auditoria cancelada pelo usuário.');
    }
    params.signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const response = await fetchImpl(`${apiBase}/api/ai/audit-card-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        fileName: params.fileName,
        ...(params.textContent ? { textContent: params.textContent } : {}),
        ...(params.base64Data
          ? {
              fileData: {
                mimeType: params.mimeType,
                base64: params.base64Data,
              },
            }
          : {}),
      }),
    });

    const rawText = await response.text();
    let payload: unknown = null;
    try {
      payload = rawText ? JSON.parse(rawText) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const serverErr =
        payload && typeof payload === 'object' && 'error' in payload
          ? String((payload as { error: unknown }).error)
          : `Erro HTTP ${response.status} ao auditar fatura com IA.`;
      throw new Error(serverErr);
    }

    const validated = AuditedInvoiceResultSchema.safeParse(payload);
    if (!validated.success) {
      throw new Error('A resposta do auditor financeiro não seguiu o formato JSON esperado.');
    }

    return sanitizeAuditedInvoiceResult(validated.data);
  } catch (err) {
    if (timedOut) {
      throw new Error(
        'Tempo limite excedido ao auditar a fatura. Tente um PDF/imagem menor ou envie em CSV.'
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (params.signal) {
      params.signal.removeEventListener('abort', onAbort);
    }
  }
}
