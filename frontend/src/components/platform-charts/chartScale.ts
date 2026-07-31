export interface ChartPoint {
  label: string;
  value: number | null;
}

export const PLAN_LABELS = {
  STARTER: 'Starter',
  PRO: 'Pro',
  ADVANCED: 'Enterprise',
} as const;

export type ChartPlan = keyof typeof PLAN_LABELS;
export const CHART_PLANS = Object.keys(PLAN_LABELS) as ChartPlan[];

export interface StackedChartPoint {
  label: string;
  parts: Readonly<Record<ChartPlan, number | null>>;
}

export type ChartMoney = boolean | string;

export function stackTotal({ parts }: StackedChartPoint) {
  const { STARTER, PRO, ADVANCED } = parts;
  return STARTER === null || PRO === null || ADVANCED === null ? null : STARTER + PRO + ADVANCED;
}

export function roundedColumn(x: number, top: number, width: number, height: number) {
  const radius = Math.min(4, width / 2, height);
  return `M ${x} ${top + height} V ${top + radius}
    q 0 ${-radius} ${radius} ${-radius} h ${width - 2 * radius}
    q ${radius} 0 ${radius} ${radius} v ${height - radius} Z`;
}

export function chartScale(max: number, money: ChartMoney = false) {
  const target = (max || 1) / 4;
  const power = 10 ** Math.floor(Math.log10(target));
  const steps = [1, 2, 2.5, 5, 10].map(multiplier => multiplier * power);
  const step = steps.find(candidate => candidate >= target && (money || Number.isInteger(candidate))) ?? 1;
  const intervals = Math.ceil((max || 1) / step);
  const ticks = Array.from({ length: intervals + 1 }, (_, index) => Number((index * step).toPrecision(12)));
  return { ticks, top: ticks[ticks.length - 1] };
}

export function chartFormatter(money: ChartMoney = false, compact = false) {
  const options: Intl.NumberFormatOptions = {
    maximumFractionDigits: compact ? 2 : 6,
    notation: compact ? 'compact' : 'standard',
  };
  if (money) {
    options.style = 'currency';
    options.currency = typeof money === 'string' ? money : 'USD';
    options.minimumFractionDigits = 0;
  }
  return new Intl.NumberFormat('en-US', options).format;
}

export function thinLabels(labels: readonly string[], positions: readonly number[], width: number) {
  // Reserve space for the endpoints before considering any interior ticks.
  const midpoint = (positions[0] + positions[positions.length - 1]) / 2;
  const candidates = labels.map((label, index) => {
    const start = labels.length > 1 && index === labels.length - 1 ? midpoint + 4 : 0;
    const end = labels.length > 1 && index === 0 ? midpoint - 4 : width;
    const limit = Math.max(1, Math.min(20, Math.floor((end - start) / 10)));
    const text = label.length > limit ? label.slice(0, limit - 1) + '…' : label;
    const half = text.length * 5;
    const x = Math.max(start + half, Math.min(end - half, positions[index]));
    return { text, x, start: x - half, end: x + half, index };
  });
  if (candidates.length < 2) return candidates;

  const first = candidates[0];
  const last = candidates[candidates.length - 1];
  const labelsToShow = [first];
  let end = first.end;
  for (const candidate of candidates.slice(1, -1)) {
    if (candidate.start >= end + 8 && candidate.end <= last.start - 8) {
      labelsToShow.push(candidate);
      end = candidate.end;
    }
  }
  return [...labelsToShow, last];
}
