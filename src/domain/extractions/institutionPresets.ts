export interface InstitutionPreset {
  id: string;
  name: string;
  shortName: string;
  ispb: string;
  compe?: string;
  type: 'brokerage_and_bank' | 'brokerage';
  brandColor: string;
  badgeText: string;
  supportsCreditCard: boolean;
  defaultCardConfig?: {
    cardName: string;
    brand: 'Visa' | 'Mastercard';
    closingDay: number;
    dueDay: number;
    isInvestbackEnabled: boolean;
  };
  androidPackageNames: string[];
}

export const RICO_CLEAR_PRESETS: InstitutionPreset[] = [
  {
    id: 'inst_rico',
    name: 'Rico Investimentos',
    shortName: 'Rico',
    ispb: '02332886',
    compe: '102',
    type: 'brokerage_and_bank',
    brandColor: '#FF5500', // Laranja oficial Rico
    badgeText: 'RICO',
    supportsCreditCard: true,
    defaultCardConfig: {
      cardName: 'Cartão Rico Visa Infinite',
      brand: 'Visa',
      closingDay: 5,
      dueDay: 12,
      isInvestbackEnabled: true, // Rico gera Investback em compras no crédito
    },
    androidPackageNames: ['br.com.rico.mobile', 'br.com.rico.homebroker'],
  },
  {
    id: 'inst_clear',
    name: 'Clear Corretora',
    shortName: 'Clear',
    ispb: '02332886',
    compe: '102',
    type: 'brokerage',
    brandColor: '#00D4FF', // Azul ciano oficial Clear
    badgeText: 'CLEAR',
    supportsCreditCard: false, // Clear foca em conta margem/corretagem e transferências
    androidPackageNames: ['br.com.clear.mobile', 'br.com.clear.pit'],
  },
];
