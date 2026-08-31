import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useFrappeGetCall } from "frappe-react-sdk";
import { ArrowLeft, CheckCheck, RefreshCw, X } from "lucide-react";
import PattyTile from "@/components/PattyTile";
import { useLotRemarks, type LotRemark } from "@/components/LotRemarkBadge";
import { filterPatties, groupPatties, type PattySource, type PattyTile as Tile } from "@/utils/finishedPatty";

const API = "mahaveermetalic.mahaveer_metallic.api.program";

/**
 * Every finished patty on one page, read down the columns.
 *
 * The Program screen's shelf is a rail: it shows what fits across and no more, because the
 * machine board underneath it is what that screen is for. This is the same shelf with the
 * whole floor's material on it — arranged COLUMN-WISE, because that is how the patty are
 * counted off in the shop, and the eye goes down a column of fifteen far faster than it
 * scans a wrapped grid for the one colour it wants.
 *
 * It opens on whatever the shelf was showing: the colour filter and the machine's cut
 * scope arrive in the URL, so "View all" widens the view without changing the question.
 */

/** Patti per column. Fifteen is what fits a shop-floor screen without scrolling. */
const PER_COLUMN = 15;

export default function FinishedPattyPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  // The scope is fixed by the link that opened the page; the search stays live, seeded
  // from it — arriving on a filter you cannot then widen is a dead end.
  const scopeCut = params.get("cut") || "";
  const scopeMachine = params.get("machine") || "";
  const [q, setQ] = useState(params.get("q") || "");

  const pattyCall = useFrappeGetCall<{ message: PattySource[] }>(
    `${API}.available_rolls`, { finished_only: 1 }, "fp-patties",
    { refreshInterval: 20000, revalidateOnFocus: true, keepPreviousData: true },
  );
  const patties = useMemo(() => pattyCall.data?.message ?? [], [pattyCall.data]);

  const tiles = useMemo(() => groupPatties(patties, scopeCut), [patties, scopeCut]);
  const shown = useMemo(() => filterPatties(tiles, q), [tiles, q]);

  const { maps } = useLotRemarks({
    lots: tiles.flatMap((t) => t.lots),
    lotIds: tiles.flatMap((t) => t.lotIds),
  });
  /** Every unresolved reason across a tile's lots, deduplicated — same rule as the shelf. */
  const remarksFor = (t: Tile): LotRemark[] => {
    const seen = new Set<string>();
    const out: LotRemark[] = [];
    for (const r of [
      ...t.lots.flatMap((l) => (l ? maps.by_lot[l] ?? [] : [])),
      ...t.lotIds.flatMap((l) => (l ? maps.by_lot_id[l] ?? [] : [])),
    ]) {
      if (seen.has(r.name)) continue;
      seen.add(r.name);
      out.push(r);
    }
    return out;
  };

  // Split into columns of PER_COLUMN, filled top-to-bottom so a column reads in order.
  // Done in JS rather than with CSS columns because the tiles must not be broken across a
  // column boundary, and because the last column has to be allowed to be short.
  const columns = useMemo(() => {
    const out: Tile[][] = [];
    for (let i = 0; i < shown.length; i += PER_COLUMN) out.push(shown.slice(i, i + PER_COLUMN));
    return out;
  }, [shown]);

  const patti = shown.reduce((n, t) => n + t.count, 0);

  return (
    <div className="mm-screen">
      <header className="mm-screen-head">
        <div>
          <div className="mm-fp-crumb">
            <button type="button" className="mm-mini" onClick={() => nav("/program")}>
              <ArrowLeft size={13} /> Program
            </button>
          </div>
          <h1 className="mm-page-title"><CheckCheck size={20} /> Finished patty</h1>
          <p className="mm-page-sub">
            Every patty ready for a machine, read down the columns. Click one to program it.
          </p>
        </div>
        <button type="button" className="mm-btn-secondary mm-btn-compact" onClick={() => void pattyCall.mutate()}>
          <RefreshCw size={14} /> Refresh
        </button>
      </header>

      <div className="mm-fp-bar">
        <span className="mm-fp-tally">
          <strong>{shown.length}</strong> {shown.length === 1 ? "patty" : "patties"}
          <span className="mm-fp-tally-sub"> · {patti.toLocaleString()} patti free</span>
        </span>
        {/* A machine with no cut on its master scopes by machine and nothing else — the
            shelf says "Machine 4 · any cut" for that, and so does this. Keyed on the cut
            alone, the chip disappeared on exactly those machines and the page lost every
            trace of which machine had been asked about. */}
        {scopeCut || scopeMachine ? (
          <span className="mm-patty-scope">
            {scopeMachine ? `Machine ${scopeMachine}` : ""}
            {scopeMachine && scopeCut ? " · " : ""}
            {scopeCut ? `cut ${scopeCut}` : scopeMachine ? " · any cut" : ""}
            <button type="button" className="mm-icon-btn" aria-label="Show every finished patty"
              title="Show every finished patty" onClick={() => nav("/finished-patty")}>
              <X size={13} />
            </button>
          </span>
        ) : null}
        <input className="mm-input mm-input-compact mm-fp-filter" placeholder="Filter colour, lot or challan…"
          value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {pattyCall.isLoading && shown.length === 0 ? (
        <p className="mm-flow-empty-state">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="mm-flow-empty-state">
          {tiles.length > 0
            ? "No patty of that colour."
            : scopeCut
              ? `No finished patty cut to ${scopeCut}${scopeMachine ? ` — that is what Machine ${scopeMachine} runs.` : "."}`
              : "No finished patty available — finish a cutting first."}
        </p>
      ) : (
        <div className="mm-fp-columns">
          {columns.map((col, i) => (
            <div className="mm-fp-column" key={i}>
              {col.map((t) => (
                <PattyTile
                  key={t.key}
                  tile={t}
                  remarks={remarksFor(t)}
                  // Programming happens on the Program screen, where the machine board and
                  // everything the dialog validates against already live. The pick travels
                  // back in the URL rather than this page growing its own copy of it.
                  onPick={(x) =>
                    nav(`/program?colour=${encodeURIComponent(x.colour)}${x.lotId ? `&lot=${encodeURIComponent(x.lotId)}` : ""}`)
                  }
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
