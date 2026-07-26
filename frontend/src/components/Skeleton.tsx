/** Shimmer placeholders shown while data loads — feels faster than a "Loading…" line. */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="mm-sk-table" aria-hidden="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div className="mm-sk-row" key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <span className="mm-sk" key={c} style={{ maxWidth: c === 0 ? "45%" : c === cols - 1 ? "60%" : "100%" }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="mm-sk-cards" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div className="mm-sk-card" key={i}>
          <span className="mm-sk" style={{ height: 16, width: "60%" }} />
          <span className="mm-sk" style={{ height: 12, width: "90%" }} />
          <span className="mm-sk" style={{ height: 12, width: "40%" }} />
        </div>
      ))}
    </div>
  );
}
