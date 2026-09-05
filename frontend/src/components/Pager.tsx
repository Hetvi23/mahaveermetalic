/**
 * Page controls for a register.
 *
 * The registers hold a couple of thousand rows at most and every footer total is a total
 * of the WHOLE filtered set, so the paging is done in the browser: doing it on the server
 * would mean a second query for no reason other than keeping those totals honest.
 *
 * Written once and shared, because two reports drawing their own page buttons is how they
 * end up disagreeing about what "page 1" shows.
 */

/** How many rows sit on one page, everywhere. */
export const PAGE_SIZE = 20;

/**
 * The page numbers to draw: always the first and last, always the current and its
 * neighbours, and a gap standing in for whatever is skipped. A register of 200 pages
 * cannot show 200 buttons, and a plain prev/next loses where you are.
 */
export function pageNumbers(current: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = new Set([1, pages, current, current - 1, current + 1]);
  const out: (number | null)[] = [];
  let gap = false;
  for (let n = 1; n <= pages; n++) {
    if (keep.has(n)) {
      out.push(n);
      gap = false;
    } else if (!gap) {
      out.push(null);
      gap = true;
    }
  }
  return out;
}

/** Clamp a page to what actually exists — a filter change can strand you past the end. */
export function pageSlice<T>(rows: T[], page: number) {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const start = (current - 1) * PAGE_SIZE;
  return { pages, current, start, rows: rows.slice(start, start + PAGE_SIZE) };
}

export default function Pager({
  total,
  start,
  pages,
  current,
  onPage,
  noun = "rows",
  children,
}: {
  total: number;
  start: number;
  pages: number;
  current: number;
  onPage: (n: number) => void;
  /** What is being counted — "orders", "rolls". */
  noun?: string;
  /** Anything that belongs beside the pager, e.g. a "load more from the server" button. */
  children?: React.ReactNode;
}) {
  if (total === 0) return null;
  return (
    <div className="mm-orep-pager mm-no-print">
      <span className="mm-muted">
        Showing <b>{start + 1}</b>–<b>{Math.min(start + PAGE_SIZE, total)}</b> of <b>{total}</b> {noun}
      </span>
      <div className="mm-orep-pagebtns">
        {children}
        {pages > 1 && (
          <>
            <button type="button" className="mm-mini" disabled={current <= 1}
              aria-label="Previous page" onClick={() => onPage(current - 1)}>‹</button>
            {pageNumbers(current, pages).map((n, i) =>
              n === null ? (
                <span key={`gap${i}`} className="mm-muted">…</span>
              ) : (
                <button key={n} type="button"
                  className={`mm-mini ${n === current ? "mm-mini-on" : ""}`}
                  aria-current={n === current ? "page" : undefined}
                  onClick={() => onPage(n)}>{n}</button>
              ),
            )}
            <button type="button" className="mm-mini" disabled={current >= pages}
              aria-label="Next page" onClick={() => onPage(current + 1)}>›</button>
          </>
        )}
      </div>
    </div>
  );
}
