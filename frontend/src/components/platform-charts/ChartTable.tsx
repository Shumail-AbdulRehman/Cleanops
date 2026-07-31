import { useLanguage } from '@/i18n/context';
import { CHART_PLANS, PLAN_LABELS, chartFormatter, stackTotal, type ChartMoney, type ChartPoint, type StackedChartPoint } from './chartScale';
import './axis-charts.css';

export interface ChartTableProps {
  label: string;
  data: readonly (ChartPoint | StackedChartPoint)[];
  labelHeading?: string;
  valueHeading?: string;
  money?: ChartMoney;
  partialLast?: boolean;
  showPlans?: boolean;
}

export function ChartTable({
  label, data, labelHeading = 'Period', valueHeading, money, partialLast, showPlans,
}: ChartTableProps) {
  const { t } = useLanguage();
  const formatNumber = chartFormatter(money);
  const format = (value: number | null) => value === null ? t('Not available') : formatNumber(value);
  const plans = showPlans ?? data.some(point => 'parts' in point);

  return (
    <table className="px-axis-table" aria-label={t(label)}>
      <thead>
        <tr>
          <th scope="col">{t(labelHeading)}</th>
          {plans && CHART_PLANS.map(plan => <th key={plan} scope="col">{t(PLAN_LABELS[plan])}</th>)}
          <th scope="col">{t(valueHeading ?? (plans ? 'Total' : 'Value'))}</th>
        </tr>
      </thead>
      <tbody>
        {data.map((point, index) => (
          <tr key={index}>
            <th scope="row">
              {partialLast && index === data.length - 1
                ? t('{label} ({period})', { label: point.label, period: t('so far') })
                : point.label}
            </th>
            {plans && CHART_PLANS.map(plan => (
              <td key={plan}>{format('parts' in point ? point.parts[plan] : null)}</td>
            ))}
            <td>{format('parts' in point ? stackTotal(point) : point.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
