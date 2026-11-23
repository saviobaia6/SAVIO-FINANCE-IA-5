import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreditCard, Transaction } from '../../types';
import {
  AuditedInvoiceResultSchema,
  INVOICE_AUDITOR_CATEGORIES,
  auditCardCsvContent,
  auditCardInvoiceDocument,
  buildAuditedCardTransactions,
  computeAuditedCardMetrics,
  mapAuditedInvoiceToCardRows,
  sanitizeAuditedInvoiceResult,
} from '../../domain/cards/CardInvoiceAuditorService';
import { calculateCardAnalytics } from '../../domain/cards/CardAnalyticsService';
import { calculateConfirmedExpenseCents } from '../../domain/accounts/BalanceCalculator';
import { AuditCardInvoiceRequestSchema } from '../../server/aiGuard';
import { cents } from '../../domain/money/money';

const sampleCard: CreditCard = {
  id: 'card-audit-1',
  entityId: 'CPF',
  institutionName: 'Banco do Brasil',
  bankCode: '001',
  cardName: 'Ourocard Platinum',
  last4: '7742',
  limit: 15000,
  closingDay: 10,
  dueDay: 17,
  currentInvoiceAmount: 0,
  status: 'OPEN',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Auditor Financeiro de Faturas (PDF / Imagem / CSV) & Integração Geral', () => {
  it('ignora pagamento de fatura/saldo anterior/limites, preserva IOF/tarifas, trata estornos negativos e detecta parcelas', () => {
    const csvSample = [
      'Data;Estabelecimento;Valor',
      '01/04/2026;Pagamento de fatura anterior;-2500,00',
      '01/04/2026;Saldo anterior;0,00',
      '01/04/2026;Crédito de pagamento recebido;-100,00',
      '01/04/2026;Limite disponível total;12000,00',
      '02/04/2026;IFOOD *RESTAURANTE;64,90',
      '03/04/2026;UBER *TRIP;32,50',
      '04/04/2026;MAGALU LOJA X 02/10;150,00',
      '05/04/2026;FARMACIA DROGASIL PARC 2 DE 4;80,00',
      '06/04/2026;NETFLIX.COM ASSINATURA;55,90',
      '07/04/2026;ESTORNO MAGALU LOJA X;-50,00',
      '08/04/2026;IOF COMPRA INTERNACIONAL;12,10',
    ].join('\n');

    const audited = auditCardCsvContent(csvSample, 'fatura_bb.csv');

    // Schema strictness
    expect(AuditedInvoiceResultSchema.safeParse(audited).success).toBe(true);

    // Ignored lines excluded
    const descs = audited.transacoes.map((t) => t.descricao.toLowerCase());
    expect(descs.some((d) => d.includes('pagamento de fatura'))).toBe(false);
    expect(descs.some((d) => d.includes('saldo anterior'))).toBe(false);
    expect(descs.some((d) => d.includes('crédito de pagamento'))).toBe(false);
    expect(descs.some((d) => d.includes('limite disponível'))).toBe(false);

    expect(audited.transacoes).toHaveLength(7);

    // Categories strictly in the 9 categories
    for (const tx of audited.transacoes) {
      expect(INVOICE_AUDITOR_CATEGORIES).toContain(tx.categoria);
    }

    const ifood = audited.transacoes[0];
    expect(ifood.data).toBe('2026-04-02');
    expect(ifood.tipo).toBe('avista');
    expect(ifood.parcela_atual).toBe(1);
    expect(ifood.total_parcelas).toBe(1);
    expect(ifood.categoria).toBe('Alimentação');

    const uber = audited.transacoes[1];
    expect(uber.categoria).toBe('Transporte');

    const magalu = audited.transacoes[2];
    expect(magalu.descricao).toBe('MAGALU LOJA X');
    expect(magalu.tipo).toBe('parcelada');
    expect(magalu.parcela_atual).toBe(2);
    expect(magalu.total_parcelas).toBe(10);
    expect(magalu.categoria).toBe('Compras');

    const drogasil = audited.transacoes[3];
    expect(drogasil.tipo).toBe('parcelada');
    expect(drogasil.parcela_atual).toBe(2);
    expect(drogasil.total_parcelas).toBe(4);
    expect(drogasil.categoria).toBe('Saúde');

    const netflix = audited.transacoes[4];
    expect(netflix.categoria).toBe('Assinaturas');

    const estorno = audited.transacoes[5];
    expect(estorno.valor).toBe(-50);

    const iof = audited.transacoes[6];
    expect(iof.categoria).toBe('Serviços');
    expect(iof.valor).toBe(12.1);
  });

  it('distribui exatamente Fatura atual, Compras à vista, Compras parceladas e Previsão próxima fatura e gera parcelas futuras', () => {
    const now = new Date();
    const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 5);
    const nextYm = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;

    const sanitized = sanitizeAuditedInvoiceResult({
      resumo_fatura: {
        vencimento: `${curYm}-17`,
        valor_total_identificado: 345.0,
      },
      transacoes: [
        {
          data: `${curYm}-02`,
          descricao: 'Supermercado Dia',
          valor: 200.0,
          tipo: 'avista',
          parcela_atual: 1,
          total_parcelas: 1,
          categoria: 'Alimentação',
        },
        {
          data: `${curYm}-03`,
          descricao: 'Notebook Store 02/04',
          valor: 150.0,
          tipo: 'parcelada',
          parcela_atual: 2,
          total_parcelas: 4,
          categoria: 'Compras',
        },
        {
          data: `${curYm}-04`,
          descricao: 'Desconto na fatura',
          valor: 25.0, // defense-in-depth forces negative on discount/reversal keywords
          tipo: 'avista',
          parcela_atual: 1,
          total_parcelas: 1,
          categoria: 'Outros',
        },
        {
          data: `${curYm}-05`,
          descricao: 'Cinema Cinemark 03/03',
          valor: 45.0,
          tipo: 'parcelada',
          parcela_atual: 3,
          total_parcelas: 3, // already last installment -> no future installment
          categoria: 'Lazer',
        },
        {
          data: `${curYm}-01`,
          descricao: 'Pagamento de fatura',
          valor: -500.0,
          tipo: 'avista',
          parcela_atual: 1,
          total_parcelas: 1,
          categoria: 'Outros',
        },
      ],
    });

    // Ignored Pagamento de fatura, kept 4 items, forced Desconto na fatura negative
    expect(sanitized.transacoes).toHaveLength(4);
    expect(sanitized.transacoes[2].valor).toBe(-25);

    const kpis = computeAuditedCardMetrics(sanitized);
    // À vista positive = 200.00; estorno = 25.00; parcelada atual = 150 + 45 = 195.00
    // Fatura atual net = 200 + 195 - 25 = 370.00 (37000 cents)
    expect(kpis.comprasAVistaCents).toBe(20000);
    expect(kpis.estornosCents).toBe(2500);
    expect(kpis.comprasParceladasAtualCents).toBe(19500);
    expect(kpis.comprasParceladasCount).toBe(2);
    expect(kpis.faturaAtualCents).toBe(37000);
    // Only Notebook Store has remaining installments (3/4 and 4/4 -> 2 future installments, 150 in next bill)
    expect(kpis.previsaoProximaFaturaCents).toBe(15000);
    expect(kpis.futurasParcelasCount).toBe(2);
    expect(kpis.previsaoTotalFuturoCents).toBe(30000);

    const mapped = mapAuditedInvoiceToCardRows({
      audited: sanitized,
      targetCard: sampleCard,
      existingTransactions: [],
    });
    expect(mapped).toHaveLength(4);
    expect(mapped[2].cardEntryKind).toBe('REVERSAL');
    expect(mapped[2].direction).toBe('INCOME');

    const batch = buildAuditedCardTransactions({
      rows: mapped,
      targetCard: sampleCard,
      importBatchId: 'batch-audit-1',
      generateFutureInstallments: true,
      existingTransactions: [],
    });

    // 4 current (CONFIRMED) + 2 future (PENDING for Notebook Store 3/4 and 4/4) = 6
    expect(batch).toHaveLength(6);
    const confirmed = batch.filter((t) => t.status === 'CONFIRMED');
    const pending = batch.filter((t) => t.status === 'PENDING');
    expect(confirmed).toHaveLength(4);
    expect(pending).toHaveLength(2);
    expect(pending.map((p) => p.installmentCurrent)).toEqual([3, 4]);
    expect(pending[0].installmentGroupId).toBe(confirmed[1].installmentGroupId);
    expect(pending[0].billingCycleYm).toBe(nextYm);

    // Integrate into CardAnalyticsService & BalanceCalculator cleanly
    const storedTxs: Transaction[] = batch.map((t, i) => ({ ...t, id: `tx-aud-${i}` }));
    const analytics = calculateCardAnalytics(
      { ...sampleCard, currentInvoiceAmount: 370 },
      storedTxs
    );
    expect(analytics.nextBillEstimate).toBe(150);

    // Confirmed consumption expenses exclude future PENDING installments and REVERSALs
    const confirmedExpenseCents = calculateConfirmedExpenseCents(storedTxs);
    // 200 + 150 + 45 = 395.00 (39500 cents)
    expect(confirmedExpenseCents).toBe(cents(39500));
  });

  it('valida schema do endpoint /api/ai/audit-card-invoice e processa resposta remota com segurança', async () => {
    expect(
      AuditCardInvoiceRequestSchema.safeParse({
        fileName: 'fatura.pdf',
        fileData: { mimeType: 'application/pdf', base64: 'JVBERi0xLjQK' },
      }).success
    ).toBe(true);

    expect(
      AuditCardInvoiceRequestSchema.safeParse({
        fileName: 'fatura.exe',
        fileData: { mimeType: 'application/x-msdownload', base64: 'TVqQAAMA' },
      }).success
    ).toBe(false);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            resumo_fatura: {
              vencimento: '2026-05-17',
              valor_total_identificado: 199.9,
            },
            transacoes: [
              {
                data: '2026-05-03',
                descricao: 'AMAZON BR 01/02',
                valor: 199.9,
                tipo: 'parcelada',
                parcela_atual: 1,
                total_parcelas: 2,
                categoria: 'Compras',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );

    const remote = await auditCardInvoiceDocument({
      fileName: 'fatura.png',
      mimeType: 'image/png',
      base64Data: 'iVBORw0KGgoAAAANSUhEUg==',
    });

    expect(remote.resumo_fatura.vencimento).toBe('2026-05-17');
    expect(remote.transacoes).toHaveLength(1);
    expect(remote.transacoes[0].descricao).toBe('AMAZON BR');
    expect(remote.transacoes[0].parcela_atual).toBe(1);
    expect(remote.transacoes[0].total_parcelas).toBe(2);
  });
});
