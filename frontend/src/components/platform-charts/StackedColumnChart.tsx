import { useLanguage } from '@/i18n/context';
import { AxisChart, type ChartProps } from './ColumnChart';
import { CHART_PLANS, PLAN_LABELS, roundedColumn, stackTotal, type StackedChartPoint } from './chartScale';
import './axis-charts.css';

export interface StackedColumnChartProps extends Omit<ChartProps, 'data'> {
  data: readonly StackedChartPoint[];
}

export function StackedColumnChart({ data, ...props }: StackedColumnChartProps) {
  const { t } = useLanguage();
  const totals = data.map(point => ({ label: point.label, value: stackTotal(point) }));

  return (
    <AxisChart
      {...props}
      data={totals}
      tooltipDetails={(index, format) => (
        <dl className="px-axis-breakdown">
          {CHART_PLANS.map(plan => (
            <div key={plan}>
              <dt>{t(PLAN_LABELS[plan])}</dt>
              <dd>{format(data[index].parts[plan])}</dd>
            </div>
          ))}
        </dl>
      )}
    >
      {({ positions, baseline, band, y, active }) => {
        const width = Math.min(24, band * 0.62);
        return data.map(({ parts }, index) => {
          const total = totals[index].value;
          if (total === null || total === 0) return null;
          const plans = CHART_PLANS.filter(plan => (parts[plan] ?? 0) > 0);
          const height = baseline - y(total);
          const gaps = plans.length - 1;
          const gap = gaps ? Math.min(2, height / (2 * gaps)) : 0;
          const usableHeight = height - gap * gaps;
          let bottom = baseline;
          return (
            <g key={index} opacity={props.partialLast && index === data.length - 1 ? 0.55 : undefined}>
              {plans.map((plan, partIndex) => {
                const partHeight = usableHeight * (parts[plan] ?? 0) / total;
                const top = bottom - partHeight;
                const x = positions[index] - width / 2;
                bottom = top - gap;
                const style = { fill: `var(--px-plan-${PLAN_LABELS[plan].toLowerCase()})` };
                return partIndex === gaps
                  ? <path key={plan} style={style} d={roundedColumn(x, top, width, partHeight)} />
                  : <rect key={plan} style={style} x={x} y={top} width={width} height={partHeight} />;
              })}
              {active === index && (
                <path className="px-axis-stack-outline" d={roundedColumn(positions[index] - width / 2, y(total), width, height)} />
              )}
            </g>
          );
        });
      }}
    </AxisChart>
  );
}
