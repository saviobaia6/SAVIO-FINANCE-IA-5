import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { usePrivacy } from '../../contexts/PrivacyContext';
import { formatarValor } from '../../utils/formatters';

export interface ChartSeriesConfig {
  dataKey: string;
  name: string;
  color: string;
  stackId?: string;
}

interface FinanceChartProps {
  title: string;
  subtitle?: string;
  variant: 'bar' | 'line' | 'area' | 'donut';
  data: Array<Record<string, unknown>>;
  xKey?: string;
  series?: ChartSeriesConfig[];
  nameKey?: string;
  valueKey?: string;
  colors?: string[];
  height?: number;
  emptyMessage?: string;
  onSliceClick?: (entry: Record<string, unknown>) => void;
  action?: React.ReactNode;
}

const DEFAULT_COLORS = [
  '#059669',
  '#2563EB',
  '#0EA5E9',
  '#7C3AED',
  '#F59E0B',
  '#EF4444',
  '#64748B',
];

export const FinanceChart: React.FC<FinanceChartProps> = ({
  title,
  subtitle,
  variant,
  data,
  xKey = 'label',
  series = [],
  nameKey = 'name',
  valueKey = 'value',
  colors = DEFAULT_COLORS,
  height = 240,
  emptyMessage = 'Sem dados suficientes no período selecionado.',
  onSliceClick,
  action,
}) => {
  const { hideValues } = usePrivacy();
  const isDark =
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  const gridStroke = isDark ? 'rgba(255,255,255,0.1)' : '#E2E8F0';
  const tickColor = isDark ? '#CBD5E1' : '#64748B';
  const tooltipStyle = {
    backgroundColor: isDark ? '#11185A' : '#FFFFFF',
    borderColor: isDark ? 'rgba(255,255,255,0.16)' : '#CBD5E1',
    borderRadius: '12px',
    color: isDark ? '#F8FAFC' : '#0F172A',
    fontSize: '12px',
  };

  const yAxisFmt = (v: number) => {
    if (hideValues) return 'R$ •••';
    const num = Number(v);
    if (Math.abs(num) >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(1).replace('.', ',')}M`;
    }
    if (Math.abs(num) >= 1_000) {
      const k = num / 1_000;
      return `${Number.isInteger(k) ? k : k.toFixed(1).replace('.', ',')}k`;
    }
    return `${num.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
  };

  return (
    <div className="sf-card p-3.5 sm:p-5 space-y-3 min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <h3 className="font-display text-sm sm:text-base font-bold text-[#0F172A] dark:text-white">
            {title}
          </h3>
          {subtitle && (
            <p className="font-sans text-xs text-[#64748B] dark:text-slate-300 mt-0.5 leading-snug">
              {subtitle}
            </p>
          )}
        </div>
        {action}
      </div>

      {data.length === 0 ? (
        <div
          style={{ height: Math.min(height, 180) }}
          className="flex items-center justify-center rounded-xl border border-dashed border-[#E2E8F0] dark:border-white/15 text-xs text-[#64748B] dark:text-slate-300 px-4 text-center"
        >
          {emptyMessage}
        </div>
      ) : variant === 'donut' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center min-w-0">
          <div className="w-full min-w-0 h-[180px] sm:h-[210px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey={valueKey}
                  nameKey={nameKey}
                  cx="50%"
                  cy="50%"
                  innerRadius="46%"
                  outerRadius="78%"
                  paddingAngle={2}
                  onClick={(entry) => {
                    const raw =
                      (entry as unknown as { payload?: Record<string, unknown> })?.payload ??
                      (entry as unknown as Record<string, unknown>);
                    onSliceClick?.(raw);
                  }}
                >
                  {data.map((entry, idx) => (
                    <Cell
                      key={String(entry[nameKey] || idx)}
                      fill={String(entry.color || colors[idx % colors.length])}
                      className={onSliceClick ? 'cursor-pointer' : undefined}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: unknown, name: unknown) => [
                    formatarValor(Number(value) || 0, hideValues),
                    String(name || ''),
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5 text-xs min-w-0">
            {data.map((entry, idx) => {
              const color = String(entry.color || colors[idx % colors.length]);
              const label = String(entry[nameKey] || '');
              const val = Number(entry[valueKey] || 0);
              const pct = typeof entry.percentage === 'number' ? entry.percentage : null;
              return (
                <button
                  key={`${label}-${idx}`}
                  type="button"
                  onClick={() => onSliceClick?.(entry)}
                  className="w-full min-h-10 sm:min-h-9 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-white/5 px-2 py-1.5 rounded-lg transition-colors cursor-pointer min-w-0"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="truncate text-[#0F172A] dark:text-slate-200 font-medium">
                      {label}
                    </span>
                  </span>
                  <span className="font-money font-bold text-[#0F172A] dark:text-white shrink-0">
                    {pct !== null ? `${pct.toFixed(1)}% · ` : ''}
                    {formatarValor(val, hideValues)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{ height }} className="w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            {variant === 'bar' ? (
              <BarChart data={data} margin={{ top: 8, right: 6, left: -10, bottom: 2 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey={xKey} tick={{ fill: tickColor, fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fill: tickColor, fontSize: 11 }} tickLine={false} width={52} tickFormatter={yAxisFmt} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: unknown, name: unknown) => [
                    formatarValor(Number(value) || 0, hideValues),
                    String(name || ''),
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                {series.map((s) => (
                  <Bar
                    key={s.dataKey}
                    dataKey={s.dataKey}
                    name={s.name}
                    fill={s.color}
                    stackId={s.stackId}
                    radius={[4, 4, 0, 0]}
                    onClick={(entry) => onSliceClick?.(entry as unknown as Record<string, unknown>)}
                    className={onSliceClick ? 'cursor-pointer' : undefined}
                  />
                ))}
              </BarChart>
            ) : variant === 'area' ? (
              <AreaChart data={data} margin={{ top: 8, right: 6, left: -10, bottom: 2 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey={xKey} tick={{ fill: tickColor, fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fill: tickColor, fontSize: 11 }} tickLine={false} width={52} tickFormatter={yAxisFmt} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: unknown, name: unknown) => [
                    formatarValor(Number(value) || 0, hideValues),
                    String(name || ''),
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                {series.map((s) => (
                  <Area
                    key={s.dataKey}
                    type="monotone"
                    dataKey={s.dataKey}
                    name={s.name}
                    stroke={s.color}
                    fill={s.color}
                    fillOpacity={0.18}
                    strokeWidth={2.25}
                  />
                ))}
              </AreaChart>
            ) : (
              <LineChart data={data} margin={{ top: 8, right: 6, left: -10, bottom: 2 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey={xKey} tick={{ fill: tickColor, fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fill: tickColor, fontSize: 11 }} tickLine={false} width={52} tickFormatter={yAxisFmt} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: unknown, name: unknown) => [
                    formatarValor(Number(value) || 0, hideValues),
                    String(name || ''),
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                {series.map((s) => (
                  <Line
                    key={s.dataKey}
                    type="monotone"
                    dataKey={s.dataKey}
                    name={s.name}
                    stroke={s.color}
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};
