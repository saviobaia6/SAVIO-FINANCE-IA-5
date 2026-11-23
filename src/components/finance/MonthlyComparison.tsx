import React from 'react';
import { FinanceChart } from './FinanceChart';
import { usePrivacy } from '../../contexts/PrivacyContext';
import { formatarValor } from '../../utils/formatters';

export interface MonthlyComparisonItem {
  label: string;
  income: number;
  expense: number;
  net: number;
}

interface MonthlyComparisonProps {
  title?: string;
  subtitle?: string;
  data: MonthlyComparisonItem[];
}

export const MonthlyComparison: React.FC<MonthlyComparisonProps> = ({
  title = 'Comparativo mensal (Entradas vs Saídas)',
  subtitle = 'Evolução mês a mês com saldo líquido resultante',
  data,
}) => {
  const { hideValues } = usePrivacy();

  const latest = data.length > 0 ? data[data.length - 1] : null;
  const previous = data.length > 1 ? data[data.length - 2] : null;
  const deltaNet = latest && previous ? latest.net - previous.net : null;

  return (
    <div className="space-y-3">
      <FinanceChart
        title={title}
        subtitle={subtitle}
        variant="bar"
        data={data as unknown as Array<Record<string, unknown>>}
        xKey="label"
        series={[
          { dataKey: 'income', name: 'Receitas / Entradas', color: '#10B981' },
          { dataKey: 'expense', name: 'Despesas / Saídas', color: '#EF4444' },
        ]}
        action={
          latest ? (
            <div className="text-right text-[11px] text-[#64748B] dark:text-slate-300">
              <span>Último mês ({latest.label}): </span>
              <strong
                className={`font-money ${
                  latest.net >= 0
                    ? 'text-[#059669] dark:text-[#10B981]'
                    : 'text-[#DC3545] dark:text-red-400'
                }`}
              >
                {formatarValor(latest.net, hideValues)}
              </strong>
              {deltaNet !== null && (
                <span className="ml-2 font-money">
                  ({deltaNet >= 0 ? '+' : ''}
                  {formatarValor(deltaNet, hideValues)} vs ant.)
                </span>
              )}
            </div>
          ) : undefined
        }
      />
    </div>
  );
};
