import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFrappeGetCall } from "frappe-react-sdk";
import { Eye } from "lucide-react";

/**
 * The reason a lot stopped short, shown wherever that lot turns up.
 *
 * An operator who reverts a program or completes only two of six batches has to say why,
 * and that sentence belongs to the LOT rather than to the program — the same material
 * comes back on the finished-patti list, in the entry picker, on the machine board and on
 * the next inward for that lot, and it has to read the same in all of them. This file is
 * the read half of that: one hook that fetches a screen's worth of remarks, and one eye
 * icon that shows a row's.
 */

export type LotRemark = {
  name: string;
  lot?: string | null;
  lot_id?: string | null;
  reason: string;
  event_type?: string | null;
  program?: string | null;
  owner: string;
  creation: string;
  resolved?: number;
};

export type LotRemarkMaps = {
  /** Keyed by MM Lot doc name — what cuttings, programs and productions carry. */
  by_lot: Record<string, LotRemark[]>;
  /** Keyed by COLOUR + printed id (see `lotIdKey`) — never by the id alone. */
  by_lot_id: Record<string, LotRemark[]>;
};

/** A printed lot id and the colour it belongs to. Both are needed to name one lot. */
export type LotKey = { id?: string | null; colour?: string | null };

const REMARKS_API = "mahaveermetalic.mahaveer_metallic.api.lot_remark.remarks";
const NONE: LotRemarkMaps = { by_lot: {}, by_lot_id: {} };

/**
 * The `by_lot_id` key: colour + printed id.
 *
 * A LOT ID IS NOT A KEY ON ITS OWN. Lot numbers run per colour, per financial year, so
 * LT1/26-27 exists once for every colour ever received — the lot master says so outright.
 * Keyed on the bare id, one colour's reason was handed to every other colour holding that
 * number: the eye turned up on material nothing had been said about, and the lot the
 * reason was really about was lost among them.
 *
 * Must produce byte-for-byte what `lot_remark.lot_id_key` produces on the server, which is
 * why the normalisation (lowercase, spaces stripped) is spelled the same way in both.
 */
export function lotIdKey(colour?: string | null, id?: string | null): string {
  return `${(colour ?? "").toLowerCase().replace(/\s+/g, "")}||${id ?? ""}`;
}

/** Distinct, sorted, blanks dropped — so the same screen always produces the same key. */
function stable(values?: (string | null | undefined)[]): string[] {
  if (!values || !values.length) return [];
  return Array.from(new Set(values.filter(Boolean) as string[])).sort();
}

/** Newest-first, one entry per remark — a lot reached by two keys must not read twice. */
function dedupe(rows: LotRemark[]): LotRemark[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.name) ? false : (seen.add(r.name), true)));
}

/**
 * Every remark for the lots a screen is showing, in ONE request.
 *
 * Called once per screen and the maps handed down, never once per row: the Program board
 * polls every twenty seconds and carries dozens of tiles, and a hook per tile would turn
 * that poll into dozens of round trips. The SWR key is derived from the sorted distinct
 * keys, so it only changes when the set of lots on screen actually changes — a re-render
 * that happens to rebuild the array does not refetch.
 */
export function useLotRemarks(keys: { lots?: (string | null | undefined)[]; lotIds?: LotKey[] }) {
  const lots = stable(keys.lots);
  // Only the ids are asked for: the server derives each remark's colour from MM Lot and
  // answers with colour-keyed buckets, so sending the colours too would change nothing
  // about the reply and would refetch every time a row's colour was re-read.
  const lotIds = stable((keys.lotIds ?? []).map((k) => k.id));
  const lotKey = lots.join("|");
  const idKey = lotIds.join("|");

  const args = useMemo(
    () => ({
      lots: JSON.stringify(lotKey ? lotKey.split("|") : []),
      lot_ids: JSON.stringify(idKey ? idKey.split("|") : []),
    }),
    [lotKey, idKey],
  );

  // A null SWR key is how the request is skipped entirely — a screen with nothing on it
  // yet must not ask the server for the remarks of no lots.
  const { data, mutate } = useFrappeGetCall<{ message: LotRemarkMaps }>(
    REMARKS_API,
    args,
    lotKey || idKey ? `mm-lotrem-${lotKey}-${idKey}` : null,
  );

  const maps = data?.message ?? NONE;
  return {
    maps,
    /** Remarks for a row, by whichever key that row happens to hold. */
    forLot: (lot?: string | null) => (lot ? maps.by_lot[lot] ?? [] : []),
    /**
     * Remarks for a printed lot id IN A COLOUR. Pass the colour the row is showing — an id
     * on its own names as many lots as there are colours.
     *
     * The empty-colour bucket is always folded in: a handful of older remarks were filed
     * before the colour was recorded and their lot has since been released, so nothing can
     * attribute them. Showing those on every colour of the id is the old behaviour, kept
     * deliberately for them alone — losing a reason is worse than repeating one. A caller
     * with no colour to give gets every bucket for the id, which is that same fallback.
     */
    forLotId: (lotId?: string | null, colour?: string | null) => {
      if (!lotId) return [];
      const unattributed = maps.by_lot_id[lotIdKey("", lotId)] ?? [];
      if (!colour) {
        const suffix = `||${lotId}`;
        return dedupe(
          Object.keys(maps.by_lot_id)
            .filter((k) => k.endsWith(suffix))
            .flatMap((k) => maps.by_lot_id[k]),
        );
      }
      return dedupe([...(maps.by_lot_id[lotIdKey(colour, lotId)] ?? []), ...unattributed]);
    },
    refresh: mutate,
  };
}

/** Frappe timestamps come as "YYYY-MM-DD HH:mm:ss"; Safari refuses that without the T. */
function when(value?: string): string {
  if (!value) return "";
  const d = new Date(value.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** The person, not their login — "ravi@mahaveer.com" tells the floor nothing extra. */
function who(owner?: string): string {
  if (!owner) return "";
  return owner === "Administrator" ? owner : owner.split("@")[0];
}

type Pos = { top: number; left: number };

/**
 * The eye. Rendered only when the lot HAS an unresolved reason — an icon that is always
 * there is an icon nobody looks at, so its presence is itself the signal.
 *
 * It sits inside rows and tiles that are themselves clickable (picking a patty, opening a
 * program), so every click is stopped dead here: opening the reason must never also
 * select the row underneath it. The panel is portalled to <body> because those rows live
 * inside horizontally scrolling tables, and `overflow-x: auto` clips vertically too — an
 * in-flow popover simply would not be visible.
 */
export function LotRemarkBadge({ remarks, label }: { remarks?: LotRemark[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  /** Set once the panel is on screen, so its placement can be redone against its real height. */
  const [measured, setMeasured] = useState(false);

  const shown = useMemo(() => (remarks ?? []).filter((r) => !r.resolved), [remarks]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function place() {
      const el = btn.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = 260;
      // Right-aligned to the icon and clamped to the viewport: the eye usually sits at the
      // end of a row, where a left-aligned panel would hang off the screen.
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width));
      const below = window.innerHeight - r.bottom;
      // Flip above when there is more room there, measured against the panel's own height —
      // a two-line remark and a six-line one want different decisions. The panel only
      // renders once `pos` is set, so the FIRST pass has nothing to measure and estimates;
      // `measured` below re-runs this the moment it is on screen, which is what turns the
      // estimate into the real height. Without that second pass a tall panel opened near
      // the bottom of the window was simply clipped.
      const h = panel.current?.offsetHeight || 140;
      setPos({ top: below < h + 16 && r.top > below ? Math.max(8, r.top - h - 6) : r.bottom + 6, left });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, shown.length, measured]);

  // Flips `measured` once the panel has actually mounted, so the effect above re-runs with
  // a real height in hand. Guarded on `pos` being set, or it would loop.
  useLayoutEffect(() => {
    if (open && pos && panel.current && !measured) setMeasured(true);
    if (!open && measured) setMeasured(false);
  }, [open, pos, measured]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (btn.current?.contains(t) || panel.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  if (!shown.length) return null;

  const aria = `${shown.length} reason${shown.length > 1 ? "s" : ""} recorded${label ? ` for ${label}` : ""}`;

  return (
    <>
      <button
        type="button"
        ref={btn}
        className={`mm-lotrem-eye${open ? " mm-lotrem-eye-open" : ""}`}
        aria-label={aria}
        aria-expanded={open}
        title={aria}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
        }}
      >
        <Eye size={13} />
        {shown.length > 1 && <span className="mm-lotrem-count">{shown.length}</span>}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panel}
            className="mm-lotrem-pop"
            role="dialog"
            aria-label={aria}
            style={{ top: pos.top, left: pos.left }}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
          >
            <div className="mm-lotrem-head">{label ? `Why — ${label}` : "Why this lot stopped"}</div>
            {shown.map((r) => (
              <div key={r.name} className="mm-lotrem-item">
                <span className="mm-lotrem-type">{r.event_type || "Other"}</span>
                <p className="mm-lotrem-reason">{r.reason}</p>
                <span className="mm-lotrem-meta">
                  {who(r.owner)}
                  {r.owner && r.creation ? " · " : ""}
                  {when(r.creation)}
                </span>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

// Named and default both, so a screen can import it either way alongside the hook.
export default LotRemarkBadge;
