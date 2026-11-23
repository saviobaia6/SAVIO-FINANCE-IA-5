import { describe, expect, it } from 'vitest';
import type { Account, Asset, Boleto, CreditCard, Debt, Transaction } from '../../types';
import type { SalaryDataset } from '../../types/salary';
import { cents } from '../../domain/money/money';
import { consolidateFinance, filterTransactions } from '../../domain/finance/FinanceConsolidationService';
import { calculateAccountAnalytics } from '../../domain/accounts/AccountAnalyticsService';
import { calculateCardAnalytics, calculateCardLimit } from '../../domain/cards/CardAnalyticsService';
import { calculateDebtAnalytics } from '../../domain/debts/DebtAnalyticsService';

describe('ETAPA 11 — Motor Financeiro Unificado, Contas, Cartões e Dívidas', () => {
  const accounts: Account[] = [
    {
      id: 'acc-nubank-cpf',
      entityId: 'CPF',
      institutionName: 'Nubank',
      accountName: 'Conta Nubank',
      accountType: 'checking',
      openingBalance: 1000,
      openingBalanceCents: cents(100000),
      balance: 1000,
      balanceCents: cents(100000),
    },
    {
      id: 'acc-recarga-cpf',
      entityId: 'CPF',
      institutionName: 'RecargaPay',
      accountName: 'Carteira RecargaPay',
      accountType: 'checking',
      openingBalance: 500,
      openingBalanceCents: cents(50000),
      balance: 500,
      balanceCents: cents(50000),
    },
    {
      id: 'acc-mei-cnpj',
      entityId: 'CNPJ',
      institutionName: 'Banco Inter PJ',
      accountName: 'Conta MEI',
      accountType: 'business',
      openingBalance: 2000,
      openingBalanceCents: cents(200000),
      balance: 2000,
      balanceCents: cents(200000),
    },
  ];

  const cards: CreditCard[] = [
    {
      id: 'card-nu',
      entityId: 'CPF',
      institutionName: 'Nubank',
      cardName: 'Roxinho Platinum',
      last4: '4321',
      limit: 3000,
      closingDay: 5,
      dueDay: 12,
      currentInvoiceAmount: 750,
      status: 'OPEN',
    },
  ];

  const boletos: Boleto[] = [
    {
      id: 'bol-1',
      entityId: 'CPF',
      beneficiario: 'Energia S/A',
      pagador: 'Titular',
      instituicao: 'Nubank',
      linhaDigitavel: '34191000000000000000000000000000000000025000',
      vencimento: '2026-11-28',
      valorOriginal: 250,
      descricao: 'Conta de Energia',
      status: 'PENDING',
      category: 'Moradia',
    },
  ];

  const debts: Debt[] = [
    {
      id: 'debt-1',
      entityId: 'CPF',
      creditorName: 'Banco Parceiro',
      description: 'Financiamento Equipamento',
      originalAmount: 6000,
      outstandingAmount: 3000,
      installmentAmount: 500,
      interestRate: 1.5,
      totalInstallments: 12,
      paidInstallments: 6,
      dueDay: 15,
      status: 'ACTIVE',
    },
    {
      id: 'debt-2',
      entityId: 'CNPJ',
      creditorName: 'Fornecedor Boticário',
      description: 'Parcelamento Estoque',
      originalAmount: 2000,
      outstandingAmount: 0,
      dueDay: 10,
      status: 'PAID',
    },
  ];

  const assets: Asset[] = [
    {
      id: 'asset-1',
      entityId: 'CPF',
      assetType: 'Renda Fixa',
      institutionName: 'Nubank',
      description: 'Caixinha Reserva CDI',
      currentValue: 4000,
      valuationDate: '2026-11-20',
    },
  ];

  const salaryData: SalaryDataset = {
    sources: [
      {
        id: 'src-clt',
        name: 'Empresa Principal',
        institution: 'Empresa Principal',
        category: 'salary',
        paymentFrequency: 'monthly',
        active: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'src-bot',
        name: 'Boticário Comissões',
        institution: 'Grupo Boticário',
        category: 'credit',
        paymentFrequency: 'monthly',
        active: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    records: [
      {
        id: 'sal-rec-1',
        sourceId: 'src-clt',
        year: 2026,
        month: 11,
        referenceMonth: '2026-11',
        paymentDate: '2026-11-05',
        grossAmount: 4000,
        grossAmountCents: cents(400000),
        deductions: 500,
        deductionsCents: cents(50000),
        amount: 3500,
        amountCents: cents(350000),
        status: 'received',
        origin: 'manual',
        linkedTransactionId: 'tx-sal-linked',
        createdAt: '2026-11-05T10:00:00.000Z',
        updatedAt: '2026-11-05T10:00:00.000Z',
      },
      {
        id: 'sal-rec-2',
        sourceId: 'src-bot',
        year: 2026,
        month: 11,
        referenceMonth: '2026-11',
        expectedDate: '2026-11-28',
        amount: 1200,
        amountCents: cents(120000),
        status: 'expected',
        origin: 'manual',
        createdAt: '2026-11-01T10:00:00.000Z',
        updatedAt: '2026-11-01T10:00:00.000Z',
      },
    ],
    adjustments: [],
  };

  const transactions: Transaction[] = [
    // Linked salary transaction (must NOT double count with sal-rec-1!)
    {
      id: 'tx-sal-linked',
      entityId: 'CPF',
      accountId: 'acc-nubank-cpf',
      salaryRecordId: 'sal-rec-1',
      date: '2026-11-05',
      description: 'Salário Empresa Principal',
      category: 'Salário',
      account: 'Nubank · Conta Nubank',
      amountCents: cents(350000),
      amount: 3500,
      direction: 'INCOME',
      status: 'CONFIRMED',
      origin: 'MANUAL',
    },
    // MEI revenue (CNPJ)
    {
      id: 'tx-mei-1',
      entityId: 'CNPJ',
      accountId: 'acc-mei-cnpj',
      date: '2026-11-10',
      description: 'Serviço MEI Consultoria',
      category: 'Serviço MEI',
      account: 'Banco Inter PJ · Conta MEI',
      amountCents: cents(250000),
      amount: 2500,
      direction: 'INCOME',
      status: 'CONFIRMED',
      origin: 'MANUAL',
    },
    // RecargaPay cashback/yield
    {
      id: 'tx-recarga-1',
      entityId: 'CPF',
      accountId: 'acc-recarga-cpf',
      date: '2026-11-12',
      description: 'Cashback e rendimento RecargaPay',
      category: 'Outros',
      account: 'RecargaPay · Carteira RecargaPay',
      amountCents: cents(15000),
      amount: 150,
      direction: 'INCOME',
      status: 'CONFIRMED',
      origin: 'IMPORT',
    },
    // Credit card cash purchase (counts once in expenses!)
    {
      id: 'tx-card-cash',
      entityId: 'CPF',
      accountId: 'card-nu',
      creditCardId: 'card-nu',
      date: '2026-11-14',
      description: 'Mercado Mensal',
      category: 'Alimentação',
      account: 'Nubank · Roxinho Platinum',
      amountCents: cents(45000),
      amount: 450,
      direction: 'EXPENSE',
      status: 'CONFIRMED',
      origin: 'MANUAL',
      operationType: 'CARTAO',
      isCardBillPayment: false,
    },
    // Credit card installment purchase (counts in operational expenses & installment breakdown)
    {
      id: 'tx-card-parc',
      entityId: 'CPF',
      accountId: 'card-nu',
      creditCardId: 'card-nu',
      date: '2026-11-15',
      description: 'Notebook Trabalho (1/3)',
      category: 'Outros',
      account: 'Nubank · Roxinho Platinum',
      amountCents: cents(30000),
      amount: 300,
      direction: 'EXPENSE',
      status: 'CONFIRMED',
      origin: 'MANUAL',
      operationType: 'CARTAO',
      isCardBillPayment: false,
      installmentCurrent: 1,
      installmentTotal: 3,
    },
    // Future planned card installment
    {
      id: 'tx-card-future',
      entityId: 'CPF',
      accountId: 'card-nu',
      creditCardId: 'card-nu',
      date: '2099-12-15',
      description: 'Notebook Trabalho (2/3)',
      category: 'Outros',
      account: 'Nubank · Roxinho Platinum',
      amountCents: cents(30000),
      amount: 300,
      direction: 'EXPENSE',
      status: 'PLANNED',
      origin: 'MANUAL',
      operationType: 'CARTAO',
      isCardBillPayment: false,
      installmentCurrent: 2,
      installmentTotal: 3,
    },
    // Credit card bill payment from Nubank checking (must reduce bank balance, MUST NOT double-count operational expense!)
    {
      id: 'tx-bill-pay',
      entityId: 'CPF',
      accountId: 'acc-nubank-cpf',
      creditCardId: 'card-nu',
      date: '2026-11-18',
      description: 'Pgto Fatura Roxinho',
      category: 'Cartão',
      account: 'Nubank · Conta Nubank',
      amountCents: cents(75000),
      amount: 750,
      direction: 'EXPENSE',
      status: 'CONFIRMED',
      origin: 'MANUAL',
      operationType: 'CARTAO',
      isCardBillPayment: true,
    },
    // Internal transfer Nubank -> RecargaPay (must move balance, MUST NOT count as revenue/expense!)
    {
      id: 'tx-xfer-out',
      entityId: 'CPF',
      accountId: 'acc-nubank-cpf',
      date: '2026-11-19',
      description: 'Transferência para RecargaPay',
      category: 'Transferência',
      account: 'Nubank · Conta Nubank',
      amountCents: cents(40000),
      amount: 400,
      direction: 'EXPENSE',
      status: 'CONFIRMED',
      origin: 'MANUAL',
      isInternalTransfer: true,
      operationType: 'TRANSFERENCIA_PROPRIA',
      transferId: 'trf-1',
    },
    {
      id: 'tx-xfer-in',
      entityId: 'CPF',
      accountId: 'acc-recarga-cpf',
      date: '2026-11-19',
      description: 'Transferência de Nubank',
      category: 'Transferência',
      account: 'RecargaPay · Carteira RecargaPay',
      amountCents: cents(40000),
      amount: 400,
      direction: 'INCOME',
      status: 'CONFIRMED',
      origin: 'MANUAL',
      isInternalTransfer: true,
      operationType: 'TRANSFERENCIA_PROPRIA',
      transferId: 'trf-1',
    },
  ];

  it('consolida múltiplas fontes de receita sem duplicar salários vinculados e ignora transferências/pagamento de fatura nas despesas', () => {
    const result = consolidateFinance({
      accounts,
      transactions,
      creditCards: cards,
      boletos,
      debts,
      assets,
      salaryData,
      filters: {
        scope: 'CONSOLIDATED',
        startDate: '2026-11-01',
        endDate: '2026-11-30',
      },
    });

    // Confirmed incomes: 3500 (salário linked counted ONCE) + 2500 (MEI) + 150 (RecargaPay) = 6150
    expect(result.summary.totalIncome).toBe(6150);
    // Expected incomes: 1200 (Boticário PREVISTO)
    expect(result.summary.expectedIncome).toBe(1200);

    // Operational expenses in Nov: 450 (card cash) + 300 (card installment) = 750.
    // Bill payment (750) and internal transfer (400) MUST NOT be added!
    expect(result.summary.totalExpenses).toBe(750);

    // Consolidated account balances:
    // Nubank: 1000 + 3500 - 750 - 400 = 3350
    // RecargaPay: 500 + 150 + 400 = 1050
    // MEI: 2000 + 2500 = 4500
    // Total = 8900
    expect(result.summary.consolidatedBalance).toBe(8900);

    // Open invoices (750) & pending boletos (250)
    expect(result.summary.openInvoices).toBe(750);
    expect(result.summary.totalPendingBoletos).toBe(250);

    // Estimated Free Balance: 8900 - 750 (openInvoices) - 250 (pendingBoletos) = 7900
    expect(result.summary.estimatedFreeBalance).toBe(7900);

    // Net worth: Accounts (8900) + Assets (4000) - Active Debts (3000) - Open Invoices (750) = 9150
    expect(result.summary.netWorth).toBe(9150);

    // Income sources should group Salário, MEI, Boticário, RecargaPay cleanly
    const originKeys = result.incomeBySource.map((i) => i.originKey);
    expect(originKeys).toContain('salary');
    expect(originKeys).toContain('mei');
    expect(originKeys).toContain('boticario');
    expect(originKeys).toContain('recargapay');
  });

  it('calcula analítico individual de conta separando entradas, saídas, transferências e pagamento de fatura', () => {
    const nubankAcc = accounts[0];
    const analytics = calculateAccountAnalytics(nubankAcc, transactions, {
      startDate: '2026-11-01',
      endDate: '2026-11-30',
    });

    expect(analytics.initialBalance).toBe(1000);
    expect(analytics.totalInflows).toBe(3500);
    expect(analytics.cardBillPaymentsTotal).toBe(750);
    expect(analytics.transfersOut).toBe(400);
    expect(analytics.currentBalance).toBe(3350);
  });

  it('calcula analítico de cartão com limite comprometido, compras à vista vs parceladas e pagamento de fatura separado', () => {
    expect(calculateCardLimit(3000, 2400).isNearLimit).toBe(true);
    expect(calculateCardLimit(3000, 2400).availableLimit).toBe(600);

    const cardAnalytics = calculateCardAnalytics(cards[0], transactions, {
      startDate: '2026-11-01',
      endDate: '2026-11-30',
    });

    expect(cardAnalytics.cashPurchasesTotal).toBe(450);
    expect(cardAnalytics.installmentPurchasesTotal).toBe(300);
    expect(cardAnalytics.installmentCount).toBe(1);
    expect(cardAnalytics.billPayments).toHaveLength(1);
    // Open invoice (750) + future planned installment (300) = 1050 used limit
    expect(cardAnalytics.limitAnalysis.usedLimit).toBe(1050);
    expect(cardAnalytics.limitAnalysis.availableLimit).toBe(1950);
  });

  it('calcula analítico de dívidas com percentual quitado, parcelas restantes, comprometimento da renda e projeção de quitação', () => {
    const debtAnalytics = calculateDebtAnalytics(debts, 5000, 'CONSOLIDATED');

    expect(debtAnalytics.activeCount).toBe(1);
    expect(debtAnalytics.paidCount).toBe(1);
    expect(debtAnalytics.totalContracted).toBe(8000);
    expect(debtAnalytics.totalOutstanding).toBe(3000);
    expect(debtAnalytics.totalPaid).toBe(5000);
    expect(debtAnalytics.paidPercentage).toBe(62.5);
    expect(debtAnalytics.monthlyCommitments).toBe(500);
    expect(debtAnalytics.incomeCommitmentPct).toBe(10);
    expect(debtAnalytics.estimatedMonthsToPayoff).toBe(6);
    expect(debtAnalytics.payoffProjection).toHaveLength(12);
    expect(debtAnalytics.payoffProjection[1].projectedOutstanding).toBeLessThan(3000);
  });

  it('aplica filtros combinados de tipo, escopo, categoria, origem e compras parceladas corretamente', () => {
    const installmentOnly = filterTransactions(transactions, {
      scope: 'CPF',
      installmentOnly: true,
    });
    expect(installmentOnly).toHaveLength(2);

    const meiOnly = filterTransactions(transactions, {
      scope: 'CNPJ',
      type: 'income',
    });
    expect(meiOnly).toHaveLength(1);
    expect(meiOnly[0].id).toBe('tx-mei-1');
  });
});
