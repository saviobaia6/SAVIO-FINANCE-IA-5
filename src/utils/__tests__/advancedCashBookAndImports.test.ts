import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as XLSX from 'xlsx';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BankLogo } from '../../components/BankLogo';
import { resolveBankIdentity } from '../../domain/extractions/banksRepository';
import {
  buildAnnualLedgerSummary,
  buildCashBookExcelWorkbook,
  buildMonthlyLedgerSheet,
  calculateDailyCashBook,
  calculateDailyCashBookSummary,
  filterCashBookTransactions,
  selectScopedCashBookAccounts,
} from '../../domain/accounts/CashBookService';
import { executeInternalTransfer } from '../../domain/transactions/TransferService';
import {
  cancelUnconfirmedTransaction,
  restoreCancelledTransaction,
  reverseConfirmedTransaction,
} from '../../domain/transactions/ReversalService';
import { deriveAccountBalances } from '../../domain/accounts/BalanceCalculator';
import {
  autoDetectSpreadsheetColumns,
  buildImportBatchFingerprint,
  buildTransactionsFromMappedRows,
  mapSpreadsheetRowsForAccount,
  parseSpreadsheetBuffer,
  parseSpreadsheetGrid,
} from '../../domain/imports/SpreadsheetImportService';
import { reconcileImportBatch } from '../../domain/transactions/ImportReconciliationService';
import {
  generateTransactionsCsv,
  validateDatasetIntegrity,
} from '../../services/backupService';
import {
  clearWorkspaceToken,
  exportToGoogleSheets,
  fetchGoogleSpreadsheetMetadata,
  fetchGoogleSheetValues,
  listDriveSpreadsheetFiles,
} from '../../services/googleWorkspace';
import { sanitizeCellForSheet } from '../sheetGuard';
import { cents, fromCents } from '../../domain/money/money';
import type { Account, Transaction } from '../../types';

const sampleAccounts: Account[] = [
  {
    id: 'acc-itau-1',
    entityId: 'CPF',
    institutionName: 'Itaú Unibanco',
    bankCode: '341',
    accountName: 'Conta Corrente Principal',
    accountType: 'checking',
    openingBalanceCents: cents(100_000), // R$ 1.000,00
    openingBalance: 1000,
    balance: 1000,
  },
  {
    id: 'acc-itau-2',
    entityId: 'CPF',
    institutionName: 'Itaú Unibanco',
    bankCode: '341',
    accountName: 'Reserva Pessoal',
    accountType: 'savings',
    openingBalanceCents: cents(50_000), // R$ 500,00
    openingBalance: 500,
    balance: 500,
  },
  {
    id: 'acc-nubank-pj',
    entityId: 'CNPJ',
    institutionName: 'Nubank',
    bankCode: '260',
    accountName: 'Conta Empresa PJ',
    accountType: 'business',
    openingBalanceCents: cents(200_000), // R$ 2.000,00
    openingBalance: 2000,
    balance: 2000,
  },
  {
    id: 'acc-archived',
    entityId: 'CPF',
    institutionName: 'Banco Antigo Desconhecido',
    accountName: 'Conta Encerrada',
    accountType: 'checking',
    openingBalanceCents: cents(0),
    openingBalance: 0,
    balance: 0,
    archived: true,
  },
];

const sampleTransactions: Transaction[] = [
  {
    id: 'tx-pf-1',
    entityId: 'CPF',
    accountId: 'acc-itau-1',
    date: '2026-01-10',
    description: 'Salário Janeiro',
    category: 'Salário / Pró-labore',
    account: 'Itaú Unibanco · Conta Corrente Principal',
    amountCents: cents(300_000),
    amount: 3000,
    direction: 'INCOME',
    status: 'CONFIRMED',
    origin: 'MANUAL',
    notes: 'Competência 01/2026',
  },
  {
    id: 'tx-pf-2',
    entityId: 'CPF',
    accountId: 'acc-itau-1',
    date: '2026-02-05',
    description: 'Aluguel Apartamento',
    category: 'Moradia / Contas',
    account: 'Itaú Unibanco · Conta Corrente Principal',
    amountCents: cents(120_000),
    amount: 1200,
    direction: 'EXPENSE',
    status: 'CONFIRMED',
    origin: 'MANUAL',
  },
  {
    id: 'tx-pf-3',
    entityId: 'CPF',
    accountId: 'acc-itau-2',
    date: '2026-02-05',
    description: 'Rendimento CDB Reserva',
    category: 'Rendimentos / Investimentos',
    account: 'Itaú Unibanco · Reserva Pessoal',
    amountCents: cents(25_000),
    amount: 250,
    direction: 'INCOME',
    status: 'CONFIRMED',
    origin: 'MANUAL',
  },
  {
    id: 'tx-pj-1',
    entityId: 'CNPJ',
    accountId: 'acc-nubank-pj',
    date: '2026-02-05',
    description: 'Faturamento Cliente Alpha',
    category: 'Vendas / Receita PJ',
    account: 'Nubank · Conta Empresa PJ',
    amountCents: cents(500_000),
    amount: 5000,
    direction: 'INCOME',
    status: 'CONFIRMED',
    origin: 'MANUAL',
  },
];

afterEach(() => {
  vi.restoreAllMocks();
  clearWorkspaceToken();
});

describe('Bank Visual Identity, Cash Book, Transfers & Spreadsheet Imports', () => {
  // 1. Exibição de logotipo de banco conhecido
  it('1. resolves and renders visual identity for known catalog banks', () => {
    const itau = resolveBankIdentity('Itaú Unibanco', '341');
    expect(itau.isKnownCatalogBank).toBe(true);
    expect(itau.codigo).toBe('341');
    expect(itau.catalogId).toBe('itau');

    const html = renderToStaticMarkup(
      React.createElement(BankLogo, {
        bankName: 'Itaú Unibanco',
        bankCode: '341',
        size: 40,
      })
    );
    expect(html).toContain('bank-logo');
    expect(html).toContain('width:40px;height:40px');
    expect(html).toContain('itaú');
  });

  // 2. Fallback visual quando banco não tem logo ou imagem falha
  it('2. renders clean generic bank icon fallback for unknown banks and safe image prop when logoUrl provided', () => {
    const unknown = resolveBankIdentity('Cooperativa Regional XYZ');
    expect(unknown.isKnownCatalogBank).toBe(false);

    const fallbackHtml = renderToStaticMarkup(
      React.createElement(BankLogo, {
        bankName: 'Cooperativa Regional XYZ',
        size: 38,
      })
    );
    expect(fallbackHtml).toContain('<svg');
    expect(fallbackHtml).toContain('Cooperativa Regional XYZ');

    const withLogoHtml = renderToStaticMarkup(
      React.createElement(BankLogo, {
        bankName: 'Banco Custom',
        logoUrl: 'https://example.com/logo.png',
        size: 40,
      })
    );
    expect(withLogoHtml).toContain('<img');
    expect(withLogoHtml).toContain('https://example.com/logo.png');
  });

  // 3. Separação estrita CPF vs CNPJ no Livro Caixa
  it('3. strictly separates CPF and CNPJ accounts and transactions in Cash Book', () => {
    const cpfAccounts = selectScopedCashBookAccounts({
      accounts: sampleAccounts,
      entityId: 'CPF',
    });
    const cnpjAccounts = selectScopedCashBookAccounts({
      accounts: sampleAccounts,
      entityId: 'CNPJ',
    });

    expect(cpfAccounts.every((a) => a.entityId === 'CPF')).toBe(true);
    expect(cnpjAccounts.every((a) => a.entityId === 'CNPJ')).toBe(true);

    const cpfTxs = filterCashBookTransactions({
      accounts: sampleAccounts,
      transactions: sampleTransactions,
      entityId: 'CPF',
    });
    const cnpjTxs = filterCashBookTransactions({
      accounts: sampleAccounts,
      transactions: sampleTransactions,
      entityId: 'CNPJ',
    });

    expect(cpfTxs.every((t) => t.entityId === 'CPF')).toBe(true);
    expect(cpfTxs.some((t) => t.id === 'tx-pj-1')).toBe(false);
    expect(cnpjTxs.map((t) => t.id)).toEqual(['tx-pj-1']);
  });

  // 4. Filtro por conta bancária específica (duas contas distintas do mesmo banco)
  it('4. filters by exact account.id without mixing two accounts from the same bank (Itaú)', () => {
    const acc1Sheet = buildMonthlyLedgerSheet({
      accounts: sampleAccounts,
      transactions: sampleTransactions,
      yearMonth: '2026-02',
      entityId: 'CPF',
      accountId: 'acc-itau-1',
    });
    const acc2Sheet = buildMonthlyLedgerSheet({
      accounts: sampleAccounts,
      transactions: sampleTransactions,
      yearMonth: '2026-02',
      entityId: 'CPF',
      accountId: 'acc-itau-2',
    });

    expect(acc1Sheet.rows.map((r) => r.transaction.id)).toEqual(['tx-pf-2']);
    expect(acc2Sheet.rows.map((r) => r.transaction.id)).toEqual(['tx-pf-3']);
    // acc-itau-1: 1000 + 3000 (Jan) = 4000 opening in Feb; -1200 = 2800
    expect(acc1Sheet.openingBalanceCents).toBe(400_000);
    expect(acc1Sheet.closingBalanceCents).toBe(280_000);
    // acc-itau-2: 500 opening in Feb; +250 = 750
    expect(acc2Sheet.openingBalanceCents).toBe(50_000);
    expect(acc2Sheet.closingBalanceCents).toBe(75_000);
  });

  // 5. Consistência entre visões Diário ↔ Mensal ↔ Anual
  it('5. maintains exact mathematical consistency across Daily, Monthly, and Annual views', () => {
    const daily = calculateDailyCashBook(
      sampleAccounts[0],
      sampleTransactions,
      '2026-02-05'
    );
    const monthly = buildMonthlyLedgerSheet({
      accounts: sampleAccounts,
      transactions: sampleTransactions,
      yearMonth: '2026-02',
      entityId: 'CPF',
      accountId: 'acc-itau-1',
    });
    const annual = buildAnnualLedgerSummary({
      accounts: sampleAccounts,
      transactions: sampleTransactions,
      year: 2026,
      entityId: 'CPF',
      accountId: 'acc-itau-1',
    });

    const febAnnual = annual.months.find((m) => m.yearMonth === '2026-02')!;
    expect(daily.closingBalanceCents).toBe(monthly.closingBalanceCents);
    expect(febAnnual.openingBalanceCents).toBe(monthly.openingBalanceCents);
    expect(febAnnual.closingBalanceCents).toBe(monthly.closingBalanceCents);
    expect(febAnnual.inflowsCents).toBe(monthly.totalEntradasCents);
    expect(febAnnual.outflowsCents).toBe(monthly.totalSaidasCents);
  });

  // 6. Cálculo correto de saldo diário (entradas, saídas, transferências recebidas/enviadas)
  it('6. computes daily opening, inflows, outflows, transfers in/out, and closing balance accurately', () => {
    const txsWithXfer: Transaction[] = [
      ...sampleTransactions,
      {
        id: 'tx-xfer-in',
        entityId: 'CPF',
        accountId: 'acc-itau-1',
        date: '2026-02-05',
        description: 'Transf. Reserva -> Principal',
        category: 'Transferência',
        account: 'Itaú Unibanco · Conta Corrente Principal',
        amountCents: cents(30_000),
        amount: 300,
        direction: 'INCOME',
        status: 'CONFIRMED',
        origin: 'MANUAL',
        isInternalTransfer: true,
        transferId: 'xfer-1',
      },
      {
        id: 'tx-xfer-out',
        entityId: 'CPF',
        accountId: 'acc-itau-1',
        date: '2026-02-05',
        description: 'Envio para Reserva',
        category: 'Transferência',
        account: 'Itaú Unibanco · Conta Corrente Principal',
        amountCents: cents(10_000),
        amount: 100,
        direction: 'EXPENSE',
        status: 'CONFIRMED',
        origin: 'MANUAL',
        isInternalTransfer: true,
        transferId: 'xfer-2',
      },
    ];

    const summary = calculateDailyCashBookSummary({
      accounts: sampleAccounts,
      transactions: txsWithXfer,
      date: '2026-02-05',
      entityId: 'CPF',
      accountId: 'acc-itau-1',
    });

    expect(summary.openingBalanceCents).toBe(400_000);
    expect(summary.inflowsCents).toBe(0);
    expect(summary.outflowsCents).toBe(120_000);
    expect(summary.transfersInCents).toBe(30_000);
    expect(summary.transfersOutCents).toBe(10_000);
    // 4000 - 1200 + 300 - 100 = 3000 (300_000 cents)
    expect(summary.closingBalanceCents).toBe(300_000);
  });

  // 7. Cálculo correto de saldo acumulado na planilha mensal
  it('7. computes progressive runningBalanceCents across every row of the monthly ledger sheet', () => {
    const txs: Transaction[] = [
      {
        id: 'm1',
        entityId: 'CPF',
        accountId: 'acc-itau-2',
        date: '2026-03-01',
        description: 'Depósito A',
        category: 'Outros',
        account: 'Itaú Unibanco · Reserva Pessoal',
        amountCents: cents(20_000),
        amount: 200,
        direction: 'INCOME',
        status: 'CONFIRMED',
        origin: 'MANUAL',
      },
      {
        id: 'm2',
        entityId: 'CPF',
        accountId: 'acc-itau-2',
        date: '2026-03-10',
        description: 'Saída B',
        category: 'Outros',
        account: 'Itaú Unibanco · Reserva Pessoal',
        amountCents: cents(5_000),
        amount: 50,
        direction: 'EXPENSE',
        status: 'CONFIRMED',
        origin: 'MANUAL',
      },
    ];

    const sheet = buildMonthlyLedgerSheet({
      accounts: [sampleAccounts[1]],
      transactions: txs,
      yearMonth: '2026-03',
      entityId: 'CPF',
      accountId: 'acc-itau-2',
    });

    expect(sheet.openingBalanceCents).toBe(50_000);
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0].runningBalanceCents).toBe(70_000);
    expect(sheet.rows[1].runningBalanceCents).toBe(65_000);
    expect(sheet.closingBalanceCents).toBe(65_000);
  });

  // 8. Consolidação correta dos 12 meses na visão anual
  it('8. consolidates 12 months with annual result and month-over-month variation', () => {
    const annual = buildAnnualLedgerSummary({
      accounts: sampleAccounts,
      transactions: sampleTransactions,
      year: 2026,
      entityId: 'CPF',
      accountId: 'acc-itau-1',
    });

    expect(annual.months).toHaveLength(12);
    expect(annual.openingBalanceCents).toBe(100_000);
    expect(annual.totalInflowsCents).toBe(300_000);
    expect(annual.totalOutflowsCents).toBe(120_000);
    expect(annual.annualResultCents).toBe(180_000);
    expect(annual.closingBalanceCents).toBe(280_000);

    // Jan result = +3000, Feb result = -1200 -> (-1200 - 3000) / 3000 = -140.0%
    expect(annual.months[0].monthlyResultCents).toBe(300_000);
    expect(annual.months[1].monthlyResultCents).toBe(-120_000);
    expect(annual.months[1].momVariationPct).toBe(-140);
  });

  // 9. Lançamento manual a partir de data + vínculo correto
  it('9. reflects manual dated transaction with exact accountId and notes in daily cash book', () => {
    const manualEntry: Transaction = {
      id: 'tx-manual-dated',
      entityId: 'CPF',
      accountId: 'acc-itau-2',
      date: '2026-04-15',
      description: 'Freela Consultoria',
      category: 'Vendas / Serviços',
      account: 'Itaú Unibanco · Reserva Pessoal',
      amountCents: cents(45_000),
      amount: 450,
      direction: 'INCOME',
      status: 'CONFIRMED',
      origin: 'MANUAL',
      notes: 'Nota fiscal #42',
    };

    const daily = calculateDailyCashBookSummary({
      accounts: sampleAccounts,
      transactions: [...sampleTransactions, manualEntry],
      date: '2026-04-15',
      entityId: 'CPF',
      accountId: 'acc-itau-2',
    });

    expect(daily.transactions).toHaveLength(1);
    expect(daily.transactions[0].accountId).toBe('acc-itau-2');
    expect(daily.transactions[0].notes).toBe('Nota fiscal #42');
    expect(daily.inflowsCents).toBe(45_000);
  });

  // 10. Edição, cancelamento/estorno e restauração mantendo integridade de saldo
  it('10. preserves ledger balance integrity through edit, reversal, cancellation, and restoration', () => {
    const initialConfirmed = sampleTransactions[1]; // -1200 on acc-itau-1
    const rev = reverseConfirmedTransaction({
      transaction: initialConfirmed,
      existingTransactions: sampleTransactions,
      reason: 'Estorno por lançamento duplicado',
      reversalDate: '2026-02-06',
    });

    expect(rev.reversalTransaction.direction).toBe('INCOME');
    expect(rev.reversalTransaction.amountCents).toBe(120_000);
    const derivedAfterRev = deriveAccountBalances(sampleAccounts, rev.updatedTransactions);
    const acc1AfterRev = derivedAfterRev.find((a) => a.id === 'acc-itau-1')!;
    // 1000 + 3000 - 1200 + 1200 = 4000
    expect(acc1AfterRev.balanceCents).toBe(400_000);

    const pendingTx: Transaction = {
      id: 'tx-pending-cancel',
      entityId: 'CPF',
      accountId: 'acc-itau-1',
      date: '2026-02-15',
      description: 'Boleto Energia',
      category: 'Moradia / Contas',
      account: 'Itaú Unibanco · Conta Corrente Principal',
      amountCents: cents(25_000),
      amount: 250,
      direction: 'EXPENSE',
      status: 'PENDING',
      origin: 'MANUAL',
    };
    const cancelled = cancelUnconfirmedTransaction({
      transaction: pendingTx,
      existingTransactions: [pendingTx],
      reason: 'Cancelamento pelo usuário',
    });
    expect(cancelled.cancelledTransaction.status).toBe('CANCELLED');

    const restored = restoreCancelledTransaction({
      transaction: cancelled.cancelledTransaction,
      existingTransactions: cancelled.updatedTransactions,
      targetStatus: 'PENDING',
    });
    expect(restored.restoredTransaction.status).toBe('PENDING');
  });

  // 11. Transferência dentro da mesma entidade
  it('11. executes same-entity internal transfer between two accounts of the same bank', () => {
    const res = executeInternalTransfer({
      originAccountId: 'acc-itau-1',
      destinationAccountId: 'acc-itau-2',
      amountCents: cents(40_000),
      date: '2026-02-20',
      description: 'Aplicação na reserva',
      accounts: sampleAccounts,
      existingTransactions: sampleTransactions,
      idempotencyKey: 'xfer-same-entity',
    });

    expect(res.isCrossEntity).toBe(false);
    expect(res.debitTransaction.isInternalTransfer).toBe(true);
    expect(res.creditTransaction.isInternalTransfer).toBe(true);
    expect(res.debitTransaction.transferId).toBe(res.transferId);
    expect(res.creditTransaction.transferId).toBe(res.transferId);

    const balances = deriveAccountBalances(sampleAccounts, res.updatedTransactions);
    const a1 = balances.find((a) => a.id === 'acc-itau-1')!;
    const a2 = balances.find((a) => a.id === 'acc-itau-2')!;
    expect(a1.balanceCents).toBe(240_000); // 2800 - 400
    expect(a2.balanceCents).toBe(115_000); // 750 + 400
  });

  // 12. Transferência entre CPF e CNPJ respeitando natureza contábil
  it('12. executes cross-entity PF<->PJ transfer preserving accounting nature vs neutral mode', () => {
    const aporte = executeInternalTransfer({
      originAccountId: 'acc-itau-1',
      destinationAccountId: 'acc-nubank-pj',
      amountCents: cents(100_000),
      date: '2026-02-21',
      crossEntityNature: 'APORTE_CAPITAL',
      notes: 'Integralização sócio',
      accounts: sampleAccounts,
      existingTransactions: [],
      idempotencyKey: 'xfer-cross-aporte',
    });

    expect(aporte.isCrossEntity).toBe(true);
    expect(aporte.crossEntityNature).toBe('APORTE_CAPITAL');
    expect(aporte.debitTransaction.category).toBe('Aporte de Capital');
    expect(aporte.debitTransaction.isInternalTransfer).toBe(false);
    expect(aporte.creditTransaction.isInternalTransfer).toBe(false);
    expect(aporte.debitTransaction.notes).toBe('Integralização sócio');
    expect(aporte.auditEntry.nextState?.crossEntityNature).toBe('APORTE_CAPITAL');

    const neutral = executeInternalTransfer({
      originAccountId: 'acc-nubank-pj',
      destinationAccountId: 'acc-itau-1',
      amountCents: cents(20_000),
      date: '2026-02-22',
      crossEntityNature: 'TRANSFERENCIA_NEUTRA',
      accounts: sampleAccounts,
      existingTransactions: [],
      idempotencyKey: 'xfer-cross-neutral',
    });
    expect(neutral.debitTransaction.isInternalTransfer).toBe(true);
    expect(neutral.creditTransaction.isInternalTransfer).toBe(true);
  });

  // 13. Leitura e importação de planilha .xlsx local e .csv
  it('13. parses local .xlsx and .csv spreadsheets, detects columns, and builds confirmed transactions', () => {
    const aoa = [
      ['Data', 'Descrição', 'Categoria', 'Entrada', 'Saída', 'Observações'],
      ['10/03/2026', 'PIX Cliente XPTO', 'Vendas / Serviços', '1500,50', '', 'Fatura 01'],
      ['11/03/2026', 'Pagamento Internet Fibra', 'Moradia / Contas', '', '129,90', 'Mensalidade'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ExtratoMar');
    const xlsxBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

    const parsed = parseSpreadsheetBuffer(xlsxBuf, 'extrato_marco.xlsx', 'LOCAL_EXCEL_CSV');
    expect(parsed.sheets).toHaveLength(1);
    expect(parsed.sheets[0].name).toBe('ExtratoMar');

    const mapping = autoDetectSpreadsheetColumns(parsed.sheets[0].rows);
    expect(mapping.dateCol).toBe(0);
    expect(mapping.descriptionCol).toBe(1);
    expect(mapping.entradaCol).toBe(3);
    expect(mapping.saidaCol).toBe(4);

    const mapped = mapSpreadsheetRowsForAccount({
      rows: parsed.sheets[0].rows,
      mapping,
      targetAccount: sampleAccounts[0],
      existingTransactions: sampleTransactions,
    });

    expect(mapped).toHaveLength(2);
    expect(mapped[0].direction).toBe('INCOME');
    expect(mapped[0].amountCents).toBe(150_050);
    expect(mapped[1].direction).toBe('EXPENSE');
    expect(mapped[1].amountCents).toBe(12_990);

    const built = buildTransactionsFromMappedRows({
      rows: mapped,
      targetAccount: sampleAccounts[0],
      importBatchId: 'batch-xlsx-1',
    });
    expect(built).toHaveLength(2);
    expect(built[0].accountId).toBe('acc-itau-1');
    expect(built[0].entityId).toBe('CPF');
    expect(built[0].notes).toBe('Fatura 01');

    // CSV parsing via TextEncoder
    const csvText = 'Data;Descrição;Valor\n12/03/2026;Padaria Central;-35,40\n';
    const csvBuf = new TextEncoder().encode(csvText).buffer;
    const parsedCsv = parseSpreadsheetBuffer(csvBuf, 'extrato.csv', 'LOCAL_EXCEL_CSV');
    const csvMap = autoDetectSpreadsheetColumns(parsedCsv.sheets[0].rows);
    const csvRows = mapSpreadsheetRowsForAccount({
      rows: parsedCsv.sheets[0].rows,
      mapping: csvMap,
      targetAccount: sampleAccounts[0],
      existingTransactions: sampleTransactions,
    });
    expect(csvRows).toHaveLength(1);
    expect(csvRows[0].direction).toBe('EXPENSE');
    expect(csvRows[0].amountCents).toBe(3_540);
  });

  // 14. Bloqueio de duplicidade de linha e lote na importação
  it('14. prevents duplicate rows inside batch and across re-imports via idempotency keys & batch fingerprint', () => {
    const grid = [
      ['Data', 'Descrição', 'Valor'],
      ['10/01/2026', 'Salário Janeiro', '3000,00'], // already exists in sampleTransactions on acc-itau-1
      ['15/03/2026', 'Compra Nova', '-100,00'],
      ['15/03/2026', 'Compra Nova', '-100,00'], // duplicate inside same sheet
    ];
    const parsed = parseSpreadsheetGrid(grid, 'planilha_dup.xlsx', 'Aba1', 'LOCAL_EXCEL_CSV');
    const mapping = autoDetectSpreadsheetColumns(parsed.sheets[0].rows);
    const mapped = mapSpreadsheetRowsForAccount({
      rows: parsed.sheets[0].rows,
      mapping,
      targetAccount: sampleAccounts[0],
      existingTransactions: sampleTransactions,
    });

    expect(mapped[0].isDuplicate).toBe(true);
    expect(mapped[1].isDuplicate).toBe(false);
    expect(mapped[2].isDuplicate).toBe(true);

    const fp1 = buildImportBatchFingerprint({
      fileName: 'planilha_dup.xlsx',
      sheetName: 'Aba1',
      accountId: 'acc-itau-1',
      rowCount: mapped.length,
      sampleSignature: mapped.map((r) => r.idempotencyKey).join(','),
    });
    const fp2 = buildImportBatchFingerprint({
      fileName: 'planilha_dup.xlsx',
      sheetName: 'Aba1',
      accountId: 'acc-itau-1',
      rowCount: mapped.length,
      sampleSignature: mapped.map((r) => r.idempotencyKey).join(','),
    });
    expect(fp1).toBe(fp2);

    const items = buildTransactionsFromMappedRows({
      rows: mapped,
      targetAccount: sampleAccounts[0],
      importBatchId: fp1,
    });
    const firstCommit = reconcileImportBatch(items, sampleTransactions);
    expect(firstCommit.accepted).toHaveLength(1);

    const secondCommit = reconcileImportBatch(items, [
      ...sampleTransactions,
      ...firstCommit.accepted,
    ]);
    expect(secondCommit.accepted).toHaveLength(0);
    expect(secondCommit.skippedDuplicatesCount).toBe(1);
  });

  // 15. Integração e parsing de planilha Google Drive / Google Sheets
  it('15. fetches Google Drive spreadsheets and Google Sheets tabs/values with mocked API and resets token on 401', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('drive/v3/files')) {
        return new Response(
          JSON.stringify({
            files: [
              {
                id: 'sheet-123',
                name: 'Fluxo PJ 2026',
                mimeType: 'application/vnd.google-apps.spreadsheet',
                modifiedTime: '2026-03-01T10:00:00Z',
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('fields=spreadsheetId')) {
        return new Response(
          JSON.stringify({
            spreadsheetId: 'sheet-123',
            properties: { title: 'Fluxo PJ 2026' },
            sheets: [{ properties: { sheetId: 0, title: 'Março' } }],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/values/')) {
        return new Response(
          JSON.stringify({
            values: [
              ['Data', 'Descrição', 'Valor'],
              ['05/03/2026', 'Recebimento Nota PJ', '2400,00'],
            ],
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);

    const files = await listDriveSpreadsheetFiles('token-ok');
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('Fluxo PJ 2026');

    const meta = await fetchGoogleSpreadsheetMetadata('token-ok', 'sheet-123');
    expect(meta.sheets[0].title).toBe('Março');

    const grid = await fetchGoogleSheetValues('token-ok', 'sheet-123', 'Março');
    const wb = parseSpreadsheetGrid(grid, meta.title, 'Março', 'GOOGLE_SHEETS');
    const mapped = mapSpreadsheetRowsForAccount({
      rows: wb.sheets[0].rows,
      mapping: autoDetectSpreadsheetColumns(wb.sheets[0].rows),
      targetAccount: sampleAccounts[2], // CNPJ Nubank PJ
      existingTransactions: sampleTransactions,
    });
    expect(mapped).toHaveLength(1);
    expect(mapped[0].amountCents).toBe(240_000);
    expect(mapped[0].direction).toBe('INCOME');

    // Verify 401 token error handling
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Invalid Credentials' } }), { status: 401 }))
    );
    await expect(listDriveSpreadsheetFiles('expired-token')).rejects.toThrow(/401/);
  });

  // 16. Inclusão de nome do banco, código e conta em exportação Excel, CSV e Google Sheets
  it('16. includes bank name, bank code, and account identification in Excel, CSV, and Google Sheets exports', async () => {
    const { workbook, fileName } = buildCashBookExcelWorkbook({
      accounts: sampleAccounts,
      transactions: sampleTransactions,
      entityId: 'CPF',
      accountId: 'acc-itau-1',
      viewMode: 'MONTHLY',
      date: '2026-02-05',
      yearMonth: '2026-02',
      year: 2026,
    });
    expect(fileName).toContain('Livro_Caixa_PF_CPF_2026-02');
    const firstSheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheetName], { header: 1 });
    expect(rows[0]).toContain('Banco');
    expect(rows[0]).toContain('Código Banco');
    expect(rows[0]).toContain('Conta');
    expect(rows[1]).toContain('Itaú Unibanco');
    expect(rows[1]).toContain('341');
    expect(rows[1]).toContain('Conta Corrente Principal');

    const csv = generateTransactionsCsv(sampleTransactions, sampleAccounts);
    expect(csv).toContain('Banco;Cód. Banco;Conta');
    expect(csv).toContain('Itaú Unibanco;341;Itaú Unibanco · Conta Corrente Principal');
    expect(csv).toContain('Nubank;260;Nubank · Conta Empresa PJ');

    let appendedBody: { values?: unknown[][] } = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url).endsWith('/spreadsheets')) {
          return new Response(
            JSON.stringify({ spreadsheetId: 'new-ss-1', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/new-ss-1' }),
            { status: 200 }
          );
        }
        appendedBody = JSON.parse(String(init?.body || '{}'));
        return new Response(JSON.stringify({}), { status: 200 });
      })
    );

    const url = await exportToGoogleSheets('token-ok', sampleTransactions, sampleAccounts);
    expect(url).toContain('new-ss-1');
    expect(appendedBody.values?.[0]).toContain('Banco');
    expect(appendedBody.values?.[0]).toContain('Cód. Banco');
    expect(appendedBody.values?.[0]).toContain('Conta');
    expect(appendedBody.values?.[1]).toContain('341');
  });

  // 17. Sanitização contra injeção de fórmulas em planilhas Excel e CSV
  it('17. sanitizes dangerous leading formula characters (=, +, -, @) in Excel and CSV exports', () => {
    expect(sanitizeCellForSheet('=cmd|"/C calc"!A0')).toBe('\'=cmd|"/C calc"!A0');
    expect(sanitizeCellForSheet('+1+1')).toBe("'+1+1");
    expect(sanitizeCellForSheet('-100')).toBe("'-100");
    expect(sanitizeCellForSheet('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");

    const evilTx: Transaction = {
      ...sampleTransactions[0],
      id: 'tx-evil',
      date: '2026-02-12',
      description: '=HYPERLINK("http://evil.example","Clique")',
      notes: '@malicious',
    };

    const { workbook } = buildCashBookExcelWorkbook({
      accounts: sampleAccounts,
      transactions: [evilTx],
      entityId: 'CPF',
      accountId: 'acc-itau-1',
      viewMode: 'MONTHLY',
      date: '2026-02-12',
      yearMonth: '2026-02',
      year: 2026,
    });
    const rows = XLSX.utils.sheet_to_json<string[]>(
      workbook.Sheets[workbook.SheetNames[0]],
      { header: 1 }
    );
    expect(String(rows[1][5])).toBe('\'=HYPERLINK("http://evil.example","Clique")');
    expect(String(rows[1][13])).toBe("'@malicious");

    const csv = generateTransactionsCsv([evilTx], sampleAccounts);
    expect(csv).toContain('\'=HYPERLINK');
    expect(csv).toContain("'@malicious");
  });

  // 18. Proteção contra dataset inválido / linha inválida / tentativa de transferência inválida
  it('18. protects ledger from corrupt datasets, invalid spreadsheet rows, and invalid transfers', () => {
    const badDatasetCheck = validateDatasetIntegrity({
      accounts: [{ id: '', entityId: 'CPF', institutionName: '', accountName: '', accountType: 'checking', openingBalance: 0, balance: 0 }],
      transactions: [],
      creditCards: [],
      boletos: [],
      debts: [],
      assets: [],
      documents: [],
    });
    expect(badDatasetCheck.ok).toBe(false);

    // Invalid spreadsheet rows (zero amount + unparseable date) flagged and excluded from commit
    const badGrid = [
      ['Data', 'Descrição', 'Valor'],
      ['data-invalida', 'Sem data', '100,00'],
      ['10/03/2026', 'Valor zero', '0,00'],
      ['12/03/2026', 'Linha Válida', fromCents(cents(9_900)).toFixed(2).replace('.', ',')],
    ];
    const mappedBad = mapSpreadsheetRowsForAccount({
      rows: badGrid,
      mapping: autoDetectSpreadsheetColumns(badGrid),
      targetAccount: sampleAccounts[0],
      existingTransactions: sampleTransactions,
    });
    expect(mappedBad[0].hasValidationError).toBe(true);
    expect(mappedBad[0].selected).toBe(false);
    expect(mappedBad[1].hasValidationError).toBe(true);
    expect(mappedBad[1].selected).toBe(false);
    expect(mappedBad[2].hasValidationError).toBe(false);
    expect(mappedBad[2].selected).toBe(true);

    // Invalid transfers must throw and leave original history untouched
    const snapshotBefore = JSON.stringify(sampleTransactions);
    expect(() =>
      executeInternalTransfer({
        originAccountId: 'acc-itau-1',
        destinationAccountId: 'acc-itau-1', // same account
        amountCents: cents(5_000),
        accounts: sampleAccounts,
        existingTransactions: sampleTransactions,
      })
    ).toThrow();

    expect(() =>
      executeInternalTransfer({
        originAccountId: 'acc-itau-1',
        destinationAccountId: 'acc-itau-2',
        amountCents: cents(0), // zero amount
        accounts: sampleAccounts,
        existingTransactions: sampleTransactions,
      })
    ).toThrow();

    expect(() =>
      executeInternalTransfer({
        originAccountId: 'acc-itau-1',
        destinationAccountId: 'acc-archived', // archived account
        amountCents: cents(1_000),
        accounts: sampleAccounts,
        existingTransactions: sampleTransactions,
      })
    ).toThrow();

    expect(JSON.stringify(sampleTransactions)).toBe(snapshotBefore);
  });
});
