/** A row of task boxes, ticked up to the number done. */
export function TaskTicks({ done, total }: { done: number; total: number }) {
  return (
    <span
      className="hx-ticks"
      role="img"
      aria-label={`${done} of ${total} tasks done`}
    >
      {Array.from({ length: total }, (_, index) => (
        <i
          key={index}
          className={index < done ? "on" : undefined}
          style={{ "--i": index } as React.CSSProperties}
        />
      ))}
    </span>
  );
}

const QR_SIZE = 25;

function qrCells() {
  // A fixed pattern for illustration. It is not a scannable code.
  let seed = 7;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const cells: [number, number][] = [];
  for (let y = 0; y < QR_SIZE; y += 1) {
    for (let x = 0; x < QR_SIZE; x += 1) {
      const inFinder =
        (x < 8 && y < 8) ||
        (x > QR_SIZE - 9 && y < 8) ||
        (x < 8 && y > QR_SIZE - 9);
      const filled = next() < 0.47;
      if (!inFinder && filled) cells.push([x, y]);
    }
  }
  return cells;
}

const cells = qrCells();

function Finder({ x, y }: { x: number; y: number }) {
  return (
    <>
      <rect x={x} y={y} width="7" height="7" />
      <rect x={x + 1} y={y + 1} width="5" height="5" fill="#fff" />
      <rect x={x + 2} y={y + 2} width="3" height="3" />
    </>
  );
}

export function QrPattern() {
  return (
    <svg viewBox={`0 0 ${QR_SIZE} ${QR_SIZE}`} fill="#21334b" aria-hidden="true">
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" />
      ))}
      <Finder x={0} y={0} />
      <Finder x={QR_SIZE - 7} y={0} />
      <Finder x={0} y={QR_SIZE - 7} />
    </svg>
  );
}
