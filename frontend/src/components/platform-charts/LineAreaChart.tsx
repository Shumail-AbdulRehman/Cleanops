import { AxisChart, type ReferenceChartProps } from './ColumnChart';
import './axis-charts.css';

export interface LineAreaChartProps extends ReferenceChartProps {
  compact?: boolean;
}

export function LineAreaChart({ compact, labelLast = !compact, ...props }: LineAreaChartProps) {
  return (
    <AxisChart {...props} compact={compact} labelLast={labelLast} line>
      {({ positions, baseline, y, active }) => {
        const segments: { x: number; y: number }[][] = [];
        let segment: { x: number; y: number }[] = [];
        props.data.forEach(({ value }, index) => {
          if (value === null) {
            segment = [];
            return;
          }
          if (segment.length === 0) segments.push(segment);
          segment.push({ x: positions[index], y: y(value) });
        });
        const last = props.data.at(-1);
        const hovered = active === null ? undefined : props.data[active];

        return (
          <>
            {segments.map(([first, ...rest]) => {
              const end = rest.at(-1) ?? first;
              const path = [`M ${first.x} ${first.y}`, ...rest.map(point => `L ${point.x} ${point.y}`)].join(' ');
              return (
                <g key={first.x}>
                  <path className="px-axis-area" d={`${path} V ${baseline} H ${first.x} Z`} />
                  <path className="px-axis-line" d={path} />
                  {first === end && <circle className="px-axis-dot" cx={first.x} cy={first.y} r={3} />}
                </g>
              );
            })}
            {last?.value != null && (
              <circle className="px-axis-dot" cx={positions.at(-1)} cy={y(last.value)} r={4} />
            )}
            {active !== null && hovered?.value != null && (
              <circle className="px-axis-dot" cx={positions[active]} cy={y(hovered.value)} r={4} />
            )}
          </>
        );
      }}
    </AxisChart>
  );
}
