import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as XLSX from 'xlsx';
import type { CreditCard, Transaction } from '../../types';
import {
  buildCardAnnualSummary,
  buildCardCalendarMonthMarkers,
  buildCardInstallmentPlan,
  buildCardLedgerExcelArrayBuffer,
  buildCardLedgerTableRows,
  buildCardTransactionsFromMappedRows,
  classifyCardTransactionKind,
  computeBillingCycleDates,
  filterCardLedgerTransactions,
  generateCardLedgerCsv,
  mapSpreadsheetRowsForCard,
} from '../../domain/cards/CardLedgerService';
import {
  autoDetectSpreadsheetColumns,
  parseSpreadsheetBuffer,
} from '../../domain/imports/SpreadsheetImportService';
import {
  calculateConfirmedExpenseCents,
  calculatePeriodMetricsCents,
} from '../../domain/accounts/BalanceCalculator';
import { cents, toCents } from '../../domain/money/money';
import {
  clearWorkspaceToken,
  decodeBase64UrlToUtf8,
  downloadGmailAttachmentBytes,
  getGmailMessageDetail,
  searchGmailStatementMessages,
  uploadExcelToGoogleDrive,
} from '../../services/googleWorkspace';
import { BankLogo } from '../../components/BankLogo';
import { CardFinancialCalendar } from '../../components/cards/CardFinancialCalendar';

const cardNubank: CreditCard = {
  id: 'card-nubank-1',
  entityId: 'CPF',
  institutionName: 'Nubank',
  bankCode: '260',
  cardName: 'Ultravioleta',
  last4: '4821',
  limit: 12000,
  closingDay: 10,
  dueDay: 17,
  currentInvoiceAmount: 0,
  status: 'OPEN',
};

const cardItau: CreditCard = {
  id: 'card-itau-2',
  entityId: 'CNPJ',
  institutionName: 'Itaú',
  bankCode: '341',
  cardName: 'Itaucard Business',
  last4: '9004',
  limit: 25000,
  closingDay: 25,
  dueDay: 5,
  currentInvoiceAmount: 0,
  status: 'OPEN',
};

afterEach(() => {
  vi.unstubAllGlobals();
  clearWorkspaceToken();
});

describe('Módulo Planilha Própria & Calendário de Cartão de Crédito + Gmail', () => {
  it('calcula ciclo de fechamento e vencimento corretamente (antes vs após fechamento e virada de mês)', () => {
    const beforeClose = computeBillingCycleDates('2026-04-08', 10, 17);
    expect(beforeClose.cycleYm).toBe('2026-04');
    expect(beforeClose.closingDate).toBe('2026-04-10');
    expect(beforeClose.dueDate).toBe('2026-04-17');

    // On or after closing day moves to next cycle
    const onClose = computeBillingCycleDates('2026-04-10', 10, 17);
    expect(onClose.cycleYm).toBe('2026-05');
    expect(onClose.closingDate).toBe('2026-05-10');
    expect(onClose.dueDate).toBe('2026-05-17');

    // Due day <= closing day rolls dueDate to following month, clamping Feb cleanly
    const crossMonth = computeBillingCycleDates('2026-01-27', 25, 5);
    expect(crossMonth.cycleYm).toBe('2026-02');
    expect(crossMonth.closingDate).toBe('2026-02-25');
    expect(crossMonth.dueDate).toBe('2026-03-05');
  });

  it('separa data da compra, data de lançamento, fechamento e pagamento sem confundir competências', () => {
    const txs: Transaction[] = [
      {
        id: 'tx-sep-1',
        entityId: 'CPF',
        accountId: cardNubank.id,
        creditCardId: cardNubank.id,
        date: '2026-05-02',
        purchaseDate: '2026-04-09',
        postingDate: '2026-05-02',
        billingCycleYm: '2026-05',
        billingClosingDate: '2026-05-10',
        billingDueDate: '2026-05-17',
        cardEntryKind: 'PURCHASE',
        description: 'Compra Loja Online',
        category: 'Compras',
        account: 'Nubank · Ultravioleta',
        amount: 350,
        amountCents: cents(35000),
        direction: 'EXPENSE',
        status: 'CONFIRMED',
        origin: 'MANUAL',
      },
    ];

    const rows = buildCardLedgerTableRows(cardNubank, txs, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].purchaseDate).toBe('2026-04-09');
    expect(rows[0].postingDate).toBe('2026-05-02');
    expect(rows[0].closingDate).toBe('2026-05-10');
    expect(rows[0].dueDate).toBe('2026-05-17');
  });

  it('vincula parcelamentos com identificador único (1/N..N/N) sem duplicar compras e distribuindo centavos exatos', () => {
    const plan = buildCardInstallmentPlan({
      card: cardNubank,
      description: 'Notebook Pro',
      category: 'Trabalho',
      purchaseDate: '2026-03-05',
      firstPostingDate: '2026-03-05',
      amountCents: cents(10000), // R$ 100,00 in 3x -> 33,34 + 33,33 + 33,33
      amountMode: 'SPLIT_TOTAL',
      installments: 3,
      groupId: 'grp-notebook',
    });

    expect(plan).toHaveLength(3);
    expect(plan.map((p) => p.amountCents)).toEqual([3334, 3333, 3333]);
    expect(plan.every((p) => p.installmentGroupId === 'grp-notebook')).toBe(true);
    expect(plan[0].purchaseDate).toBe('2026-03-05');
    expect(plan[1].purchaseDate).toBe('2026-03-05');
    expect(plan[1].postingDate).toBe('2026-04-05');
    expect(plan[2].postingDate).toBe('2026-05-05');
    expect(plan[0].description).toBe('Notebook Pro (1/3)');
    expect(plan[2].description).toBe('Notebook Pro (3/3)');
  });

  it('mantém independência total entre cartões distintos e trata estorno, tarifa e pagamento sem duplicidade de despesa', () => {
    const txs: Transaction[] = [
      {
        id: 't1',
        entityId: 'CPF',
        accountId: cardNubank.id,
        creditCardId: cardNubank.id,
        date: '2026-04-04',
        cardEntryKind: 'PURCHASE',
        description: 'Supermercado',
        category: 'Alimentação',
        account: 'Nubank',
        amount: 200,
        amountCents: cents(20000),
        direction: 'EXPENSE',
        status: 'CONFIRMED',
        origin: 'MANUAL',
      },
      {
        id: 't2',
        entityId: 'CPF',
        accountId: cardNubank.id,
        creditCardId: cardNubank.id,
        date: '2026-04-05',
        cardEntryKind: 'FEE',
        description: 'IOF compra internacional',
        category: 'Outros',
        account: 'Nubank',
        amount: 15,
        amountCents: cents(1500),
        direction: 'EXPENSE',
        status: 'CONFIRMED',
        origin: 'MANUAL',
      },
      {
        id: 't3',
        entityId: 'CPF',
        accountId: cardNubank.id,
        creditCardId: cardNubank.id,
        date: '2026-04-06',
        cardEntryKind: 'REVERSAL',
        description: 'Estorno parcial',
        category: 'Compras',
        account: 'Nubank',
        amount: 50,
        amountCents: cents(5000),
        direction: 'INCOME',
        status: 'CONFIRMED',
        origin: 'MANUAL',
      },
      {
        id: 't4',
        entityId: 'CPF',
        accountId: 'acc-nu-1',
        creditCardId: cardNubank.id,
        date: '2026-04-17',
        cardEntryKind: 'PAYMENT',
        isCardBillPayment: true,
        description: 'Pgto Fatura: Ultravioleta',
        category: 'Cartão',
        account: 'Nubank Conta',
        amount: 165,
        amountCents: cents(16500),
        direction: 'EXPENSE',
        status: 'CONFIRMED',
        origin: 'MANUAL',
      },
      {
        id: 't5-other-card',
        entityId: 'CNPJ',
        accountId: cardItau.id,
        creditCardId: cardItau.id,
        date: '2026-04-08',
        cardEntryKind: 'PURCHASE',
        description: 'Servidor Cloud',
        category: 'Trabalho',
        account: 'Itaú Business',
        amount: 900,
        amountCents: cents(90000),
        direction: 'EXPENSE',
        status: 'CONFIRMED',
        origin: 'MANUAL',
      },
    ];

    const nuFiltered = filterCardLedgerTransactions(cardNubank.id, txs);
    expect(nuFiltered.map((t) => t.id).sort()).toEqual(['t1', 't2', 't3', 't4']);

    const monthRes = buildCardCalendarMonthMarkers({
      card: cardNubank,
      transactions: txs,
      year: 2026,
      month: 4,
      filterByCycleOnly: true,
    });
    expect(monthRes.purchasesCents).toBe(20000);
    expect(monthRes.feesCents).toBe(1500);
    expect(monthRes.reversalsCents).toBe(5000);
    expect(monthRes.paymentsCents).toBe(16500);
    expect(monthRes.netInvoiceCents).toBe(16500); // 200 + 15 - 50
    expect(monthRes.remainingCycleCents).toBe(0);
    expect(monthRes.cycleStatus).toBe('PAID');

    // Dashboard metrics exclude card bill payment (t4) from new consumption expenses
    const aprilTxs = txs.filter((t) => t.date.startsWith('2026-04'));
    const metrics = calculatePeriodMetricsCents(aprilTxs);
    const expensesOnly = calculateConfirmedExpenseCents(aprilTxs);
    // Consumption = 200 (t1) + 15 (t2) + 900 (t5) = 1115 (111500 cents) — t4 bill payment excluded!
    expect(metrics.confirmedExpenseCents).toBe(111500);
    expect(expensesOnly).toBe(111500);
    expect(classifyCardTransactionKind(txs[3])).toBe('PAYMENT');
  });

  it('consolida resumo anual dos 12 meses de forma consistente com a visão mensal', () => {
    const plan = buildCardInstallmentPlan({
      card: cardItau,
      description: 'Assinatura Anual',
      category: 'Trabalho',
      purchaseDate: '2026-01-10',
      firstPostingDate: '2026-01-10',
      amountCents: cents(12000),
      amountMode: 'PER_OCCURRENCE',
      installments: 4,
      groupId: 'grp-annual',
    });

    const annual = buildCardAnnualSummary({
      card: cardItau,
      transactions: plan,
      year: 2026,
      byBillingCycle: true,
    });

    expect(annual.months).toHaveLength(12);
    expect(annual.totalInstallmentsCents).toBe(48000);
    expect(annual.months[0].installmentsCents).toBe(12000);
    expect(annual.months[3].installmentsCents).toBe(12000);
    expect(annual.months[4].installmentsCents).toBe(0);
  });

  it('exporta Excel e CSV do cartão com sanitização contra fórmula maliciosa e reimporta com detecção de duplicidade', () => {
    const txs: Transaction[] = [
      {
        id: 'tx-sec-1',
        entityId: 'CPF',
        accountId: cardNubank.id,
        creditCardId: cardNubank.id,
        date: '2026-04-12',
        description: '=CMD("evil")',
        category: 'Compras',
        account: 'Nubank',
        amount: 89.9,
        amountCents: cents(8990),
        direction: 'EXPENSE',
        status: 'CONFIRMED',
        origin: 'MANUAL',
      },
    ];

    const csv = generateCardLedgerCsv(cardNubank, txs);
    expect(csv).toContain("'=CMD(");
    expect(csv).toContain('Nubank');
    expect(csv).toContain('260');
    expect(csv).toContain('Ultravioleta');

    const { bytes } = buildCardLedgerExcelArrayBuffer({
      card: cardNubank,
      transactions: txs,
      year: 2026,
    });
    const wb = XLSX.read(bytes, { type: 'array' });
    expect(wb.SheetNames).toContain('Planilha Cartão');
    expect(wb.SheetNames).toContain('Ciclos 2026');

    // Import an Excel/CSV sheet into card with duplicate check
    const rawGrid = [
      ['Data', 'Descrição', 'Valor', 'Categoria'],
      ['2026-04-12', '=CMD("evil")', '89,90', 'Compras'], // duplicate of tx-sec-1
      ['2026-04-15', 'Spotify 1/3', '21,90', 'Lazer'],
      ['2026-04-16', 'Estorno Spotify', '-21,90', 'Lazer'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rawGrid);
    const outWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(outWb, ws, 'Fatura');
    const outBuf = XLSX.write(outWb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

    const parsed = parseSpreadsheetBuffer(outBuf, 'fatura_nubank.xlsx');
    const mapping = autoDetectSpreadsheetColumns(parsed.sheets[0].rows);
    const mapped = mapSpreadsheetRowsForCard({
      rows: parsed.sheets[0].rows,
      mapping,
      targetCard: cardNubank,
      existingTransactions: txs,
    });

    expect(mapped[0].isDuplicate).toBe(true);
    expect(mapped[0].selected).toBe(false);
    expect(mapped[1].cardEntryKind).toBe('INSTALLMENT');
    expect(mapped[1].installmentCurrent).toBe(1);
    expect(mapped[1].installmentTotal).toBe(3);
    expect(mapped[2].cardEntryKind).toBe('REVERSAL');
    expect(mapped[2].direction).toBe('INCOME');

    const ready = buildCardTransactionsFromMappedRows({
      rows: mapped,
      targetCard: cardNubank,
      importBatchId: 'batch-card-1',
    });
    expect(ready).toHaveLength(2);
    expect(ready.every((r) => r.creditCardId === cardNubank.id)).toBe(true);
  });

  it('renderiza BankLogo com fallback e CardFinancialCalendar em HTML SSR sem erros', () => {
    const unknownLogoHtml = renderToStaticMarkup(
      React.createElement(BankLogo, { bankName: 'Banco Desconhecido XPTO', size: 40 })
    );
    expect(unknownLogoHtml).toContain('svg');

    const calendarHtml = renderToStaticMarkup(
      React.createElement(CardFinancialCalendar, {
        card: cardNubank,
        transactions: [],
        year: 2026,
        month: 4,
        selectedDate: '2026-04-17',
        onChangeMonthYear: () => {},
        onSelectDate: () => {},
        onAddEntryForDate: () => {},
        onEditEntry: () => {},
        onDeleteEntry: () => {},
      })
    );
    expect(calendarHtml).toContain('VENC');
    expect(calendarHtml).toContain('FECH');
    expect(calendarHtml).toContain('17/04/2026');
  });

  it('consulta mensagens financeiras no Gmail, decodifica anexo base64url, envia Excel ao Drive e trata 401', async () => {
    const sampleEmailText = 'Fatura Nubank fechada R$ 350,00';
    const b64Text = Buffer.from(sampleEmailText, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(decodeBase64UrlToUtf8(b64Text)).toBe(sampleEmailText);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/messages?')) {
        return new Response(
          JSON.stringify({ messages: [{ id: 'msg-1', threadId: 'thr-1' }] }),
          { status: 200 }
        );
      }
      if (url.includes('/messages/msg-1/attachments/att-1')) {
        return new Response(JSON.stringify({ data: b64Text }), { status: 200 });
      }
      if (url.includes('/messages/msg-1')) {
        return new Response(
          JSON.stringify({
            id: 'msg-1',
            threadId: 'thr-1',
            snippet: 'Sua fatura chegou',
            payload: {
              headers: [
                { name: 'Subject', value: 'Fatura Nubank Abril' },
                { name: 'From', value: 'fatura@nubank.com.br' },
                { name: 'Date', value: 'Wed, 01 Apr 2026 10:00:00 -0300' },
              ],
              parts: [
                { mimeType: 'text/plain', body: { data: b64Text } },
                {
                  filename: 'fatura_abril.csv',
                  mimeType: 'text/csv',
                  body: { attachmentId: 'att-1', size: 128 },
                },
              ],
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes('upload/drive/v3/files')) {
        return new Response(JSON.stringify({ id: 'drive-xlsx-1', name: 'card.xlsx' }), {
          status: 200,
        });
      }
      return new Response('{}', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);

    const msgs = await searchGmailStatementMessages('tok-123', 'fatura', 5);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].subject).toBe('Fatura Nubank Abril');
    expect(msgs[0].hasAttachments).toBe(true);

    const detail = await getGmailMessageDetail('tok-123', 'msg-1');
    expect(detail.plainText).toBe(sampleEmailText);

    const attBuf = await downloadGmailAttachmentBytes('tok-123', 'msg-1', 'att-1');
    expect(new TextDecoder('utf-8').decode(attBuf)).toBe(sampleEmailText);

    const uploaded = await uploadExcelToGoogleDrive(
      'tok-123',
      'card.xlsx',
      new Uint8Array([1, 2, 3])
    );
    expect(uploaded.id).toBe('drive-xlsx-1');

    // 401 Unauthorized handling
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Invalid' } }), { status: 401 }))
    );
    await expect(searchGmailStatementMessages('expired-tok')).rejects.toThrow('401');
  });
});
