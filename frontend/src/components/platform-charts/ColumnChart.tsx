import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useLanguage } from '@/i18n/context';
import { chartFormatter, chartScale, roundedColumn, thinLabels, type ChartMoney, type ChartPoint } from './chartScale';
import './axis-charts.css';

export interface ChartProps {
  label: string;
  data: readonly ChartPoint[];
  height?: number;
  money?: ChartMoney;
  partialLast?: boolean;
  unit?: string;
}

export interface ReferenceChartProps extends ChartProps {
  average?: boolean | string;
  labelLast?: boolean;
}

interface Plot {
  positions: number[];
  baseline: number;
  band: number;
  y: (value: number) => number;
  active: number | null;
}

interface AxisChartProps extends ReferenceChartProps {
  compact?: boolean;
  line?: boolean;
  tooltipDetails?: (index: number, format: (value: number | null) => string) => ReactNode;
  children: (plot: Plot) => ReactNode;
}

export function AxisChart({
  label, data, height, money, partialLast, unit, average, labelLast, compact, line, tooltipDetails, children,
}: AxisChartProps) {
  const { t } = useLanguage();
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [active, setActive] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const resize = (next: number) => {
      if (next > 0) setWidth(Math.round(next));
    };
    resize(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => resize(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const formatNumber = chartFormatter(money);
  const formatTick = chartFormatter(money, true);
  const unavailable = t('Not available');
  const format = (value: number | null) => value === null ? unavailable : formatNumber(value);
  const last = data.at(-1);
  const values = data.flatMap(point => point.value === null ? [] : [point.value]);
  const highest = values.length ? Math.max(...values) : null;
  const { ticks, top } = chartScale(highest ?? 0, money);
  const tickLabels = ticks.map(formatTick);
  const left = compact ? 5 : Math.max(36, ...tickLabels.map(tick => tick.length * 8 + 8));
  const right = Math.max(left + 1, width - (compact ? 5 : 10));
  const plotWidth = right - left;
  const chartHeight = height ?? (compact ? 64 : 220);
  const plotTop = labelLast ? 35 : compact ? 8 : 18;
  const baseline = Math.max(plotTop + 1, chartHeight - (compact ? 4 : partialLast ? 38 : 24));
  const band = plotWidth / Math.max(1, data.length);
  const positions = data.map((_, index) => line && data.length > 1
    ? left + plotWidth * index / (data.length - 1)
    : left + band * (index + 0.5));
  const y = (value: number) => baseline - (baseline - plotTop) * value / top;
  const xLabels = compact ? [] : thinLabels(data.map(point => point.label), positions, width);
  const mean = average && highest !== null && !compact
    ? values.reduce((total, value) => total + value / values.length, 0)
    : null;

  const latestValue = last ? format(last.value) : unavailable;
  const soFar = t('so far');
  const latest = last && partialLast ? t('{value} {period}', { value: latestValue, period: soFar }) : latestValue;
  const title = last
    ? t('{label}, {start} to {end}. Latest {latest}, highest {highest}.', {
      label: t(label), start: data[0].label, end: last.label, latest, highest: format(highest),
    })
    : t('{label}. No data. Latest {latest}, highest {highest}.', {
      label: t(label), latest, highest: unavailable,
    });
  const hovered = active === null ? undefined : data[active];
  const isPartial = active === data.length - 1 && partialLast;
  const lastX = positions.at(-1) ?? right;
  const hoverX = active === null ? 0 : positions[active] ?? 0;
  const hoverY = hovered?.value == null ? plotTop : y(hovered.value);

  return (
    <div ref={host} className="px-axis-chart">
      <svg role="img" aria-label={title} viewBox={`0 0 ${width} ${chartHeight}`} width="100%" height={chartHeight}>
        {!compact && ticks.map((value, index) => (
          <g key={value}>
            <line className="px-axis-grid" x1={left} x2={right} y1={y(value)} y2={y(value)} />
            <text className="px-axis-tick" x={left - 8} y={y(value) + 4} textAnchor="end">{tickLabels[index]}</text>
          </g>
        ))}
        {children({ positions, baseline, band, y, active })}
        {mean !== null && (
          <g>
            <line className="px-axis-average" x1={left} x2={right} y1={y(mean)} y2={y(mean)} />
            <text className="px-axis-tick px-axis-average-label" x={left + 4} y={Math.max(13, y(mean) - 6)}>
              {t('{label} {value}', { label: t(typeof average === 'string' ? average : 'Average'), value: format(mean) })}
            </text>
          </g>
        )}
        {xLabels.map(tick => (
          <text className="px-axis-tick" key={tick.index} x={tick.x} y={baseline + 18} textAnchor="middle">
            {tick.text}
            {partialLast && tick.index === data.length - 1 && (
              <tspan x={Math.min(width - 24, tick.x)} dy={14}>{soFar}</tspan>
            )}
          </text>
        ))}
        {data.length > 0 && highest === null && (
          <text className="px-axis-tick" x={width / 2} y={(baseline + plotTop) / 2} textAnchor="middle">{unavailable}</text>
        )}
        {positions.map((position, index) => {
          const start = index === 0 ? left : (positions[index - 1] + position) / 2;
          const end = index === positions.length - 1 ? right : (position + positions[index + 1]) / 2;
          return (
            <rect
              key={index}
              aria-hidden="true"
              className="px-axis-hit"
              x={start}
              y={plotTop}
              width={end - start}
              height={baseline - plotTop}
              onPointerEnter={event => { if (event.pointerType !== 'touch') setActive(index); }}
              onPointerLeave={() => setActive(null)}
            />
          );
        })}
      </svg>
      {labelLast && last && active === null && (
        <span className="px-axis-chip px-axis-callout" aria-hidden="true" style={{
          right: `${(width - lastX) / width * 100}%`,
          top: (last.value === null ? plotTop : y(last.value)) - 5,
        }}>{latest}</span>
      )}
      {hovered && active !== null && (
        <div className="px-axis-chip px-axis-tooltip" role="tooltip" style={{
          ...(hoverX > width / 2 ? { right: `${(width - hoverX) / width * 100}%` } : { left: `${hoverX / width * 100}%` }),
          top: Math.min(hoverY + 8, plotTop + (baseline - plotTop) / 2),
        }}>
          <span>{isPartial ? t('{label} ({period})', { label: hovered.label, period: soFar }) : hovered.label}</span>
          <strong>{format(hovered.value)}{unit && hovered.value !== null ? ` ${t(unit)}` : ''}</strong>
          {tooltipDetails?.(active, format)}
        </div>
      )}
    </div>
  );
}

export function ColumnChart(props: ReferenceChartProps) {
  return (
    <AxisChart {...props}>
      {({ positions, baseline, band, y, active }) => {
        const width = Math.min(24, band * 0.62);
        return props.data.map(({ value }, index) => {
          if (value === null || value === 0) return null;
          const partial = props.partialLast && index === props.data.length - 1;
          return (
            <path
              key={index}
              className="px-axis-column"
              d={roundedColumn(positions[index] - width / 2, y(value), width, baseline - y(value))}
              opacity={partial ? 0.55 : undefined}
              data-active={active === index || undefined}
            />
          );
        });
      }}
    </AxisChart>
  );
}
