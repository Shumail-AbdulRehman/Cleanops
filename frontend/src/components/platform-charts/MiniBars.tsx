import './shape-charts.css';

interface MiniBarsProps {
  values: readonly (number | null)[];
  highlightLast?: boolean;
}

export function MiniBars({ values, highlightLast = true }: MiniBarsProps) {
  const max = Math.max(1, ...values.map((value) => value ?? 0));
  return (
    <svg className="px-mini-bars" viewBox={`0 0 ${Math.max(values.length, 1) * 10} 32`}
      preserveAspectRatio="none" aria-hidden="true">
      {values.map((value, index) => {
        if (value === null || value <= 0) return null;
        const height = value / max * 32;
        return (
          <rect key={index} x={index * 10 + 2} y={32 - height} width="6" height={height} rx="1"
            data-highlight={highlightLast && index === values.length - 1 ? 'true' : undefined} />
        );
      })}
    </svg>
  );
}
