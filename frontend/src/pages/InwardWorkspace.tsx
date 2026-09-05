import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Download, PackageCheck, Plus, ShoppingCart, X } from "lucide-react";
import type { FieldSchema } from "@/config/registry";
import { FieldInput } from "@/components/FieldInputs";
import LinkField from "@/components/LinkField";
import SearchSelect from "@/components/SearchSelect";
import type { SOOption } from "@/components/SalesOrderPicker";
import { toast } from "@/components/Toaster";
import { LotRemarkBadge, useLotRemarks } from "@/components/LotRemarkBadge";
import { extractErrorMessage } from "@/utils/frappeError";
import { todayISO } from "@/utils/localDate";

const today = todayISO;

const F_LOCATION: FieldSchema = { fieldname: "location", label: "Location", fieldtype: "Link", options: "MM Location Master", reqd: true };

type ChallanItem = { roll?: string; color?: string; cut?: string; qty?: number; weight?: number };
/** A vendor plus the colours it has supplied before — what orders the Supplier picker. */
type SupplierOption = {
  vendor: string; vendor_name?: string; colours?: string[];
  /** Whether anything is still on order from this supplier, and for which colours. */
  open_po?: number; open_po_count?: number; open_colours?: string[];
};
type MatchOrder = {
  sales_order: string;
  party?: string;
  color_name?: string;
  cut?: string;
  qty_weight?: number;
  required_weight?: number;
};
type ChallanVerify = {
  challan_no: string;
  /** The VM vendor, resolved server-side — fetched from VM means supplied by VM. */
  supplier?: string | null;
  expected_weight: number;
  expected_box: number;
  expected_rolls: number;
  received_weight: number;
  remaining_weight: number;
  closed: boolean;
  coating?: string;
  sales_order?: string;
  /** Colours the fetch added to the catalogue because the challan named them and this
   *  site had never seen them. Worth saying out loud — a master appeared. */
  created_colours?: string[];
  items: ChallanItem[];
  matching_orders: MatchOrder[];
};

/** One weighed roll sitting behind an entry row. Roll numbers may repeat — the floor's
 *  own numbering is not unique, and two rolls can legitimately carry the same one.
 *
 *  `stock` marks a roll as SURPLUS: it comes into stock and counts against the purchase
 *  order, but it does not fulfil the sales order. 900 kg sold against 1,200 kg bought
 *  settles the sale at 910 and still leaves 290 kg to arrive — that 290 is ticked Stock
 *  and would otherwise be refused as an over-receipt on a 900 kg order. */
type RollLine = { roll: string; qty: number | ""; weight: number | ""; stock?: boolean };

/**
 * One line of the entry grid = one LOT.
 *
 * The challan, supplier, order and colour are keyed once, then any number of rolls are
 * weighed under them. Posting expands the row into one MM Inward Item per roll — so the
 * document is roll-wise, while the grid stays one line per lot with the totals on it.
 */
type Row = {
  job_work: boolean;
  challan_no: string;
  supplier: string;
  customer_order: string;
  color: string;
  /** Not a column — carried through from a challan/order so cutting still gets the size. */
  cut: string;
  lines: RollLine[];
};

const blankLine = (): RollLine => ({ roll: "", qty: "", weight: "", stock: false });

const blankRow = (): Row => ({
  job_work: false,
  challan_no: "",
  supplier: "",
  customer_order: "",
  color: "",
  cut: "",
  lines: [blankLine()],
});

/** A roll counts as entered once anything has been typed on it. */
const lineFilled = (l: RollLine) => l.roll.trim() !== "" || l.qty !== "" || l.weight !== "";
const rollsOf = (r: Row) => r.lines.filter(lineFilled);
const rowTotals = (r: Row) =>
  r.lines.reduce(
    (t, l) => ({ qty: t.qty + (Number(l.qty) || 0), weight: t.weight + (Number(l.weight) || 0) }),
    { qty: 0, weight: 0 },
  );
const rowFilled = (r: Row) =>
  !!(r.color.trim() || r.challan_no.trim() || r.supplier || r.customer_order || rollsOf(r).length);

/**
 * Inward entry, one full-width grid.
 *
 * A row is a LOT, not a roll: challan, supplier, order and colour on the line, and the
 * rolls that arrived under them behind the cart button — roll no, qty and weight each.
 * The line shows the roll numbers and the lot's totals; the posted inward is roll-wise,
 * every roll stamped with the row's lot. Keying several rows therefore receives several
 * lots in one document, which is why the lot id sits on the row and not on the header.
 *
 * The header is only what the whole document shares: the challan date and where the stock
 * lands. Company and the lot ids are worked out from the rows.
 *
 * Veermetlon stays optional rather than being the way in: type a challan number on a row,
 * hit its Fetch button and that challan's rolls come back from VM into the row (and the
 * post is verified against it, so over-receipt and a closed challan are still blocked
 * server-side). Leave it alone and the row is a plain manual entry.
 */
export default function InwardWorkspace() {
  const [postingDate, setPostingDate] = useState(today());
  const [branch, setBranch] = useState("");
  const [location, setLocation] = useState("");
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [orders, setOrders] = useState<MatchOrder[]>([]); // matching orders from fetched challans
  /** Veermetlon's answer per challan number, so each row's challan verifies on its own. */
  const [verify, setVerify] = useState<Record<string, ChallanVerify>>({});
  const [fetchingRow, setFetchingRow] = useState<number | null>(null);
  const [isPartial, setIsPartial] = useState(false); // "more rolls to come on these challans"
  const [forceOrder, setForceOrder] = useState<string | null>(null);
  const [forcePin, setForcePin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // The roll-wise "cart": which row it is filling, and the roll lines under it.
  const [cartRow, setCartRow] = useState<number | null>(null);
  const [cartLines, setCartLines] = useState<RollLine[]>([]);
  const cartBody = useRef<HTMLDivElement>(null);
  const [cartFocus, setCartFocus] = useState(0);

  const { call: verifyCall } = useFrappePostCall<{ message: ChallanVerify }>(
    "mahaveermetalic.mahaveer_metallic.api.inward.verify_challan",
  );
  const { call: postInward, loading: posting } = useFrappePostCall<{ message: { name: string; receipt_status?: string } }>(
    "mahaveermetalic.mahaveer_metallic.api.inward.post_inward",
  );
  const { call: forceComplete, loading: forcing } = useFrappePostCall(
    "mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order.force_complete_order",
  );

  // The picker offers open orders only. This lifts that to every approved order, closed
  // ones included, for the case one was completed a shade early and the material for it
  // is standing at the gate. One switch for the grid, not one per row — it answers "the
  // picker is hiding my order", which is about the grid, not about a line.
  const [seeAllOrders, setSeeAllOrders] = useState(false);
  // Same escape hatch for suppliers, which are scoped by open PO and the row's colour.
  const [seeAllSuppliers, setSeeAllSuppliers] = useState(false);
  // Orders for the per-row Customer Order picker. The option carries the order's colours,
  // which is what lets picking an order fill the row's colour with no extra round trip.
  // The closed ones are a separate fetch, and a separate cache key, so the default list
  // stays the cheap one.
  const { data: soData } = useFrappeGetCall<{ message: SOOption[] }>(
    "mahaveermetalic.mahaveer_metallic.api.inward.sales_order_options",
    { include_closed: seeAllOrders ? 1 : 0 },
    `mm-inward-so-options-${seeAllOrders ? "all" : "open"}`,
  );
  const soOptions = useMemo(() => soData?.message ?? [], [soData]);
  const soByName = useMemo(() => new Map(soOptions.map((o) => [o.sales_order, o])), [soOptions]);

  /** One option list for every row: nothing about a row narrows it any more. */
  const orderOptions = useMemo(
    () =>
      soOptions.map((o) => ({
        value: o.sales_order,
        label: o.sales_order,
        meta: [
          o.party_name || o.party,
          (o.colours || []).join(", "),
          // WHAT IS STILL WANTED. Every line but the stock-only ones said only a party and
          // a colour, so the one number the operator is receiving against — how much this
          // order is still short — was the one thing the picker would not tell them.
          o.stock_only
            // The purchase, when it is the reason this order is still listed — 900 sold,
            // 1,200 bought, 290 kg still on the road.
            ? `stock only · ${(o.purchase_remaining || 0).toLocaleString()} kg on PO`
            : Number(o.required_weight || 0) > 0
              ? `${Number(o.required_weight).toLocaleString()} kg to come`
              : Number(o.required_box || 0) > 0
                // A box-only order has no weight target at all, so kg would read as zero
                // on an order that is very much still open.
                ? `${Number(o.required_box).toLocaleString()} box to come`
                : null,
        ].filter(Boolean).join(" · "),
        // Only meaningful with the switch on, and then it keeps the closed ones out of
        // the queue rather than mixed into it.
        group: seeAllOrders ? (o.open === 0 ? "Closed orders" : "Open orders") : undefined,
      })),
    [soOptions, seeAllOrders],
  );

  // Suppliers, each carrying the colours it has supplied before, so the row's colour can
  // order the picker without ever removing an option from it.
  const { data: supData, mutate: mutateSuppliers } = useFrappeGetCall<{ message: SupplierOption[] }>(
    "mahaveermetalic.mahaveer_metallic.api.inward.supplier_options",
    undefined,
    "mm-inward-supplier-options",
  );
  const supplierOptions = useMemo(() => supData?.message ?? [], [supData]);

  /**
   * Suppliers worth offering: the ones something is still on order from.
   *
   * Inward receives against a purchase order, so a supplier with nothing outstanding is
   * not a candidate for today's delivery — the full vendor list buries the handful that
   * are. Scoped here rather than server-side so "See all" costs no round trip.
   *
   * If nothing at all is on order the full list stands: an empty picker would block the
   * screen, and a delivery arriving without a PO behind it is unusual, not impossible.
   */
  const suppliersInScope = useMemo(() => {
    if (seeAllSuppliers) return supplierOptions;
    const open = supplierOptions.filter((v) => v.open_po);
    return open.length ? open : supplierOptions;
  }, [supplierOptions, seeAllSuppliers]);
  const openSupplierCount = useMemo(
    () => supplierOptions.filter((v) => v.open_po).length,
    [supplierOptions],
  );

  /**
   * Options for one row's picker, colour first.
   *
   * The colour is keyed before the supplier and the order now, so both lists lead with
   * what matches it — under a heading that says so — and keep everything else below.
   * Filtering by hiding would be wrong here: a colour arriving from a supplier that has
   * never sent it, or against an order the picker doesn't associate with it, is ordinary
   * and has to stay one click away.
   */
  /**
   * Options for a colour-scoped picker: only what matches the row's colour, unless the
   * operator has asked to see everything.
   *
   * Grouping the matches to the top still listed every other order, and the one being
   * looked for was rarely the first — on a row whose colour is already known, an order
   * that does not carry that colour is not a candidate. `seeAll` is the escape hatch for
   * the case the data is wrong or the order simply has not been amended yet, and a colour
   * with no matching order at all falls back to the full list rather than an empty one.
   */
  function colourOnly<T>(
    all: T[],
    colour: string,
    matches: (o: T, colour: string) => boolean,
    toOption: (o: T, group?: string) => { value: string; label: string; meta?: string; group?: string },
    labels: { hit: string; rest: string },
    seeAll: boolean,
  ) {
    const c = colour.trim().toLowerCase();
    if (!c) return all.map((o) => toOption(o));
    const hit = all.filter((o) => matches(o, c));
    if (hit.length === 0) return all.map((o) => toOption(o));
    if (!seeAll) return hit.map((o) => toOption(o));
    return [
      ...hit.map((o) => toOption(o, labels.hit)),
      ...all.filter((o) => !matches(o, c)).map((o) => toOption(o, labels.rest)),
    ];
  }

  // Branch/Location default from the logged-in user's employee profile. Location is on the
  // form (users without a profile still have to pick one); branch just rides along.
  const { data: defaults } = useFrappeGetCall<{ message: { branch: string | null; location: string | null } }>(
    "mahaveermetalic.api.session.get_branch_location",
    undefined,
    "mm-session-branch-location",
  );
  useEffect(() => {
    const d = defaults?.message;
    if (!d) return;
    setBranch((b) => b || d.branch || "");
    setLocation((l) => l || d.location || "");
  }, [defaults]);

  /* ── Lot preview ──────────────────────────────────────── */

  // Which lot each ROW will land in — the challan's existing lot, or the next colour-wise
  // LT id. Previewed for the whole grid in one call so the numbers shown are the numbers
  // posted: asked row by row, three new rows of one colour would all claim the same next
  // number. Preview only — the authoritative lot is assigned on post.
  const { call: previewLots } = useFrappePostCall<{ message: (string | null)[] }>(
    "mahaveermetalic.mahaveer_metallic.doctype.mm_lot.mm_lot.preview_lots",
  );
  const [lots, setLots] = useState<(string | null)[]>([]);
  // A lot this grid is about to add material to may already carry a reason from the floor —
  // an earlier program on it was reverted, or a run stopped short. That is exactly the
  // moment somebody should see it, before more of the same lot goes into stock.
  // `lots` runs parallel to `rows`, so each id is paired with the colour of the line it
  // was worked out for — an id alone would pull in every other colour's lot of that number.
  const { forLotId: lotNote } = useLotRemarks({
    lotIds: lots.map((id, i) => ({ id, colour: rows[i]?.color })),
  });
  // Keyed on colour + challan alone, so weighing rolls doesn't re-ask for the lots.
  const lotKey = useMemo(() => JSON.stringify(rows.map((r) => [r.color, r.challan_no.trim()])), [rows]);
  useEffect(() => {
    const groups = (JSON.parse(lotKey) as [string, string][]).map(([color, challan_number]) => ({ color, challan_number }));
    if (!groups.some((g) => g.color)) {
      setLots([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const r = await previewLots({ groups, posting_date: postingDate });
        if (!cancelled) setLots(r?.message ?? []);
      } catch {
        if (!cancelled) setLots([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lotKey, postingDate, previewLots]);

  /* ── Grid ─────────────────────────────────────────────── */

  function setRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function setLine(i: number, li: number, patch: Partial<RollLine>) {
    setRows((prev) =>
      prev.map((r, j) =>
        j === i ? { ...r, lines: r.lines.map((l, k) => (k === li ? { ...l, ...patch } : l)) } : r,
      ),
    );
  }

  function addRow() {
    setRows((prev) => [...prev, blankRow()]);
  }

  function removeRow(i: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : [blankRow()]));
  }

  /** Order → colour. The order knows its colours, so picking one fills the row instead of
   *  making the operator re-pick what the order already says. An existing colour wins —
   *  a colour read off a challan is what actually arrived. */
  /** The purchase order behind a sale, for a colour when one is known.
   *  With a single PO the colour does not have to match — one purchase, one answer. */
  function poFor(opt: SOOption | undefined, colour: string) {
    const pos = opt?.purchase ?? [];
    if (pos.length === 0) return undefined;
    const c = colour.trim().toLowerCase();
    if (c) {
      const hit = pos.find((p) => (p.color || "").trim().toLowerCase() === c);
      if (hit) return hit;
    }
    return pos.length === 1 ? pos[0] : undefined;
  }

  /** What the order is FOR, and what has been bought against it.
   *
   *  Read off the picked order, so changing the order on a row changes these with it —
   *  they are derived at render rather than copied into the row, which is what keeps them
   *  from going stale the moment somebody re-picks.
   */
  function orderTotals(sales_order: string) {
    const opt = soByName.get(sales_order);
    if (!opt) return null;
    return {
      so: Number(opt.ordered_weight ?? 0),
      purchase: (opt.purchase ?? []).reduce((t, po) => t + (Number(po.qty_kg) || 0), 0),
    };
  }

  function pickOrder(i: number, sales_order: string) {
    const opt = soByName.get(sales_order);
    const fromMatch = orders.find((o) => o.sales_order === sales_order);
    const colour = opt?.colours?.[0] || fromMatch?.color_name || "";
    const cut = opt?.cuts?.[0] || fromMatch?.cut || "";
    // The order knows who it was bought from — the operator was reading the PO to find
    // out and typing the name back in. Only fills a BLANK supplier: a name already on the
    // row is what actually delivered, and outranks the plan.
    const po = poFor(opt, colour);
    // …and what the order is still waiting for. The operator was reading the order to find
    // out and typing it back in; the order already knows. Only an UNTOUCHED first line is
    // filled — anything already weighed is what actually arrived and outranks the plan.
    const qty = Number(opt?.required_box ?? 0) || "";
    setRows((prev) =>
      prev.map((r, j) => {
        if (j !== i) return r;
        const first = r.lines[0];
        const untouched = r.lines.length === 1 && !first.roll.trim() && first.qty === "" && first.weight === "";
        return {
          ...r,
          customer_order: sales_order,
          // The ORDER's colour wins, it does not merely fill a blank. The field is
          // read-only while an order is picked, so a colour typed before the order was
          // chosen would otherwise stick there with no way to correct it.
          color: colour || r.color,
          cut: r.cut || cut,
          // Same rule as the colour: the order was placed on a supplier and the material
          // arriving against it is that supplier's. This used to keep a name already typed
          // on the row, on the reasoning that whoever actually delivered outranks the plan
          // — but with the field locked below, that name could never be corrected, and a
          // receipt filed against the wrong vendor is what the lock exists to stop.
          supplier: po?.supplier || r.supplier || "",
          // The BOX count is what the order is still waiting for and is worth offering.
          // The WEIGHT is not: it is whatever the scale says under this roll, and a figure
          // sitting in the box before anything was weighed is a figure nobody measured —
          // one Enter away from being posted as though it had been. The order's own totals
          // are shown under the picker instead, where they inform without pretending to be
          // a reading.
          lines: untouched ? [{ ...first, qty }] : r.lines,
        };
      }),
    );
  }

  /** Pull one row's challan from Veermetlon into that row. Optional: a row typed by hand
   *  never comes through here. */
  async function onFetchRow(i: number) {
    const no = rows[i].challan_no.trim();
    if (!no) return setError(`Row ${i + 1}: enter a challan number to fetch, or just type the rolls in.`);
    setError(null);
    setFlash(null);
    setFetchingRow(i);
    try {
      const r = await verifyCall({ challan_no: no });
      const m = r.message;
      const items = m.items || [];
      setVerify((prev) => ({ ...prev, [no]: m }));
      // One challan is one lot's worth of material, so its rolls all land on THIS row.
      const lines: RollLine[] = items.map((it) => ({
        roll: it.roll || "",
        qty: it.qty ?? "",
        weight: it.weight ?? "",
      }));
      setRow(i, {
        color: rows[i].color || items.find((it) => it.color)?.color || "",
        cut: rows[i].cut || items.find((it) => it.cut)?.cut || "",
        // Material off a VM challan came from VM. A supplier already typed on the row
        // wins — someone who named one meant it.
        supplier: rows[i].supplier || m.supplier || "",
        lines: lines.length ? lines : rows[i].lines,
      });
      // The vendor may have just been created by the fetch, so the picker has to hear
      // about it or it shows an id it can't name.
      if (m.supplier && !supplierOptions.some((v) => v.vendor === m.supplier)) void mutateSuppliers();
      // A challan can serve several customers, so its open orders stay on offer for every
      // row, not just the one fetched into.
      setOrders((prev) => {
        const seen = new Set(prev.map((o) => o.sales_order));
        return [...prev, ...(m.matching_orders || []).filter((o) => !seen.has(o.sales_order))];
      });
      if (m.closed) setError(`Challan ${m.challan_no} is already fully received — no further inward allowed.`);
      else if (items.length === 0) setError(`Challan ${m.challan_no} found but it has no rolls — enter them by hand.`);
      else {
        const made = m.created_colours ?? [];
        setFlash(
          `Fetched ${lines.length} roll(s) from challan ${m.challan_no} into row ${i + 1}.` +
            (made.length ? ` Added ${made.length === 1 ? "colour" : "colours"} ${made.join(", ")} to the catalogue.` : ""),
        );
      }
    } catch (e) {
      setVerify((prev) => {
        const next = { ...prev };
        delete next[no];
        return next;
      });
      setError(extractErrorMessage(e));
    } finally {
      setFetchingRow(null);
    }
  }

  // Keyboard: Enter adds another row so material can be keyed in without reaching for the
  // mouse; Cmd/Ctrl+Enter submits. Enter is left alone while a dropdown is open so it can
  // pick the highlighted suggestion, and the challan box handles its own Enter (Fetch).
  function onGridKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter") return;
    if (e.metaKey || e.ctrlKey) { e.preventDefault(); if (!busy) void onSubmit(); return; }
    const el = e.target as HTMLElement;
    if (el.tagName !== "INPUT") return;
    if (el.closest(".mm-link-wrap") && document.querySelector("[data-mm-menu]")) return;
    e.preventDefault();
    addRow();
  }

  /* ── Roll-wise cart ───────────────────────────────────── */

  function openCart(i: number) {
    const existing = rollsOf(rows[i]);
    setCartLines(
      existing.length
        ? existing.map((l) => ({ ...l, qty: l.qty === "" ? 1 : l.qty }))
        : [{ roll: "", qty: 1, weight: "", stock: false }],
    );
    setCartRow(i);
    setCartFocus((n) => n + 1);
  }

  // Focus the newest roll line, so "next roll" is a keystroke and not a mouse trip.
  useEffect(() => {
    if (cartRow === null) return;
    const inputs = cartBody.current?.querySelectorAll<HTMLInputElement>("[data-cart-roll]");
    inputs?.[inputs.length - 1]?.focus();
  }, [cartFocus, cartRow]);

  function addCartLine() {
    // The new roll inherits the last one's Stock tick: a surplus delivery is surplus for
    // all of it, and re-ticking every line of a twenty-roll lot is the sort of thing that
    // gets half-done.
    setCartLines((p) => [...p, { roll: "", qty: 1, weight: "", stock: p[p.length - 1]?.stock ?? false }]);
    setCartFocus((n) => n + 1);
  }

  const cartTotals = useMemo(
    () => ({
      qty: cartLines.reduce((s, l) => s + (Number(l.qty) || 0), 0),
      weight: cartLines.reduce((s, l) => s + (Number(l.weight) || 0), 0),
      // Split the same way the server splits it: what fulfils the order, and what is
      // surplus bought against the purchase order.
      order: cartLines.reduce((s, l) => s + (l.stock ? 0 : Number(l.weight) || 0), 0),
      stock: cartLines.reduce((s, l) => s + (l.stock ? Number(l.weight) || 0 : 0), 0),
    }),
    [cartLines],
  );

  /** What the row's order and its purchase order are still waiting for, so the operator
   *  ticking Stock can see WHY — the sale is settled, the purchase is not. */
  const cartBalance = useMemo(() => {
    if (cartRow === null) return null;
    const r = rows[cartRow];
    const opt = soByName.get(r.customer_order);
    if (!opt) return null;
    const po = poFor(opt, r.color);
    return {
      order: Number(opt.required_weight ?? 0),
      purchase: po ? Number(po.remaining_kg ?? 0) : Number(opt.purchase_remaining ?? 0),
      hasPO: !!po || (opt.purchase?.length ?? 0) > 0,
      settled: !!opt.stock_only,
    };
  }, [cartRow, rows, soByName]);

  /** The cart IS the row's roll list — saving replaces it, so reopening shows what is
   *  there and corrections are made in place rather than by adding duplicates. */
  function applyCart() {
    if (cartRow === null) return;
    const kept: RollLine[] = cartLines.filter(lineFilled).map((l) => ({
      roll: l.roll.trim(),
      // A weighed roll with no count typed is one roll — that is what a roll is.
      qty: l.qty === "" ? (Number(l.weight) > 0 ? 1 : "") : l.qty,
      weight: l.weight,
      stock: !!l.stock,
    }));
    setRow(cartRow, { lines: kept.length ? kept : [blankLine()] });
    setCartRow(null);
    toast(kept.length ? `Row ${cartRow + 1}: ${kept.length} roll${kept.length > 1 ? "s" : ""}` : `Row ${cartRow + 1} cleared`);
  }

  /* ── Totals + verification ────────────────────────────── */

  const totals = useMemo(
    () =>
      rows.reduce(
        (t, r) => {
          const rt = rowTotals(r);
          return { qty: t.qty + rt.qty, weight: t.weight + rt.weight, rolls: t.rolls + rollsOf(r).length };
        },
        { qty: 0, weight: 0, rolls: 0 },
      ),
    [rows],
  );

  // The server's own figures, not a copy of them: a mirrored constant drifts the moment
  // the setting changes, and the panel then warns about a limit that is no longer real.
  const { data: tolData } = useFrappeGetCall<{ message: { under: number; over: number } }>(
    "mahaveermetalic.mahaveer_metallic.doctype.mm_settings.mm_settings.inward_tolerances",
    undefined,
    "mm-inward-tolerances",
  );
  const overPct = (tolData?.message?.over ?? 20) / 100;

  // Only challans still typed on a row post as VM-verified. Change a challan number after
  // fetching it and that row is a plain manual entry again.
  const verifiedChallans = useMemo(() => {
    const onRows = new Set(rows.map((r) => r.challan_no.trim()).filter(Boolean));
    return Object.keys(verify).filter((ch) => onRows.has(ch));
  }, [rows, verify]);

  /** Weight being entered per challan — what each challan's own remaining is judged on. */
  const enteredByChallan = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) {
      const ch = r.challan_no.trim();
      if (ch) m[ch] = (m[ch] || 0) + rowTotals(r).weight;
    }
    return m;
  }, [rows]);

  const overTolFor = (v: ChallanVerify) => Math.max(0.5, (v.expected_weight || 0) * overPct);
  const closedChallan = verifiedChallans.find((ch) => verify[ch]?.closed);

  function clearVerify(challan: string) {
    setVerify((prev) => {
      const next = { ...prev };
      delete next[challan];
      return next;
    });
  }

  /* ── Order actions ────────────────────────────────────── */

  const rowOrders = useMemo(
    () => [...new Set(rows.map((r) => r.customer_order).filter(Boolean))],
    [rows],
  );

  async function submitForceComplete(order: string) {
    setError(null);
    try {
      await forceComplete({ order, pin: forcePin });
      setForceOrder(null);
      setForcePin("");
      setFlash(`Order ${order} force-completed.`);
      toast(`Order ${order} completed`);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  /* ── Submit ───────────────────────────────────────────── */

  function resetForm() {
    setRows([blankRow()]);
    setOrders([]);
    setVerify({});
    setIsPartial(false);
    setForceOrder(null);
    setForcePin("");
  }

  async function onSubmit() {
    setError(null);
    setFlash(null);
    // Carry each row's own number, so a complaint about row 3 names row 3 and not
    // "the third row that had something on it".
    const filled = rows.map((r, i) => ({ r, no: i + 1 })).filter(({ r }) => rowFilled(r));
    if (filled.length === 0) return setError("Add at least one item row.");
    if (!location.trim()) return setError("Choose a location (roll stock is tracked per location).");
    if (closedChallan) return setError(`Challan ${closedChallan} is already fully received — no further inward allowed.`);
    for (const { r, no } of filled) {
      // The challan is what a delivery is identified by afterwards — what the supplier is
      // paid against and what the closed / over-receipt checks key on. Refused here as
      // well as server-side so it is caught before the round trip.
      if (!r.challan_no.trim()) return setError(`Row ${no} needs a challan number.`);
      if (!r.color.trim()) return setError(`Row ${no} needs a colour.`);
      const lines = rollsOf(r);
      if (lines.length === 0) return setError(`Row ${no} needs a roll — enter a weight or qty.`);
      for (const [k, l] of lines.entries()) {
        if (!(Number(l.weight) > 0) && !(Number(l.qty) > 0))
          return setError(`Row ${no}, roll ${k + 1}${l.roll ? ` (${l.roll})` : ""} needs a weight or qty.`);
      }
    }
    // One MM Inward Item per ROLL, tagged with the row it was weighed on so the server
    // gives that row's rolls one lot between them.
    const items = filled
      .flatMap(({ r, no }) =>
        rollsOf(r).map((l) => ({
          lot_group: no,
          job_work: r.job_work ? 1 : 0,
          // Surplus: into stock, counted against the purchase order, fulfilling nothing.
          to_inventory: l.stock ? 1 : 0,
          supplier: r.supplier || null,
          roll_name: l.roll,
          color_name: r.color,
          cut: r.cut,
          qty_box: Number(l.qty) || 0,
          weight: Number(l.weight) || 0,
          customer_order: r.customer_order || null,
          challan_number: r.challan_no.trim(),
        })),
      )
      .map((it, i) => ({ ...it, idx: i + 1 }));
    const payload = {
      doctype: "MM Inward",
      posting_date: postingDate,
      branch: branch || null,
      location,
      // Challans, lots, the order and the company all come off the rows now — the server
      // stamps the header from them.
      verified_challans: verifiedChallans,
      is_partial: isPartial,
      items,
    };
    try {
      const res = await postInward({ payload });
      const name = res?.message?.name;
      const status = res?.message?.receipt_status;
      const tag = status === "Partial" ? " (Partial — challan still open)" : status === "Complete" ? " (Complete)" : "";
      toast(`Inward ${name} posted${tag}`);
      setFlash(`Inward ${name} posted${tag} — roll stock updated.`);
      resetForm();
    } catch (e) {
      const msg = extractErrorMessage(e);
      setError(msg);
      toast(msg, "error");
    }
  }

  const busy = posting;

  return (
    <div className="mm-iw">
      <header className="mm-ws-head">
        <div>
          <h1 className="mm-page-title">Inward</h1>
          <p className="mm-page-sub">
            One line per lot — challan, supplier, order and colour on the line, its rolls behind the cart.
            Fetch a Veermetlon challan on a line to fill its rolls in for you.
          </p>
        </div>
      </header>

      {/* Header fields — only what the whole document shares. */}
      <section className="mm-card mm-card-pad">
        <div className="mm-iw-head-grid mm-iw-head-tight">
          <label className="mm-field">
            <span className="mm-field-label">Chalan date *</span>
            <input className="mm-input" type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} />
          </label>
          <FieldInput field={F_LOCATION} value={location} onChange={(v) => setLocation(String(v ?? ""))} />
        </div>

        {/* When orders are on the rows: each completes once inward matches the ordered
            weight (within tolerance); this closes one early with the Admin PIN. */}
        {rowOrders.length > 0 && (
          <div className="mm-iw-force">
            <span className="mm-muted" style={{ fontSize: "0.82rem" }}>
              {rowOrders.length === 1 ? "Order " : "Orders "}
              <strong>{rowOrders.join(", ")}</strong> complete automatically when inward matches the ordered weight.
            </span>
            {rowOrders.map((order) =>
              forceOrder === order ? (
                <span key={order} style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    type="password"
                    className="mm-input mm-input-compact"
                    style={{ maxWidth: 150 }}
                    placeholder="Admin Override PIN"
                    value={forcePin}
                    autoFocus
                    onChange={(e) => setForcePin(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void submitForceComplete(order); }}
                  />
                  <button type="button" className="mm-mini mm-mini-ok" disabled={forcing || !forcePin.trim()}
                    onClick={() => void submitForceComplete(order)}>
                    {forcing ? "…" : `Complete ${order}`}
                  </button>
                  <button type="button" className="mm-mini" onClick={() => { setForceOrder(null); setForcePin(""); }}>Cancel</button>
                </span>
              ) : (
                <button key={order} type="button" className="mm-mini" onClick={() => { setForceOrder(order); setForcePin(""); }}>
                  <PackageCheck size={13} /> Force complete {order}
                </button>
              ),
            )}
          </div>
        )}

        {/* Verify panels — one per fetched challan: expected vs entered, from Veermetlon */}
        {verifiedChallans.map((ch) => {
          const v = verify[ch];
          const entering = enteredByChallan[ch] || 0;
          const over = entering > v.remaining_weight + overTolFor(v);
          return (
            <div key={ch} className={`mm-verify ${v.closed ? "mm-verify-closed" : ""}`}>
              <div className="mm-verify-row">
                <span className="mm-verify-badge"><PackageCheck size={13} /> Verified from Veermetlon · {v.challan_no}</span>
                {v.closed && <span className="mm-badge-low">Challan closed</span>}
                <button type="button" className="mm-mini" onClick={() => clearVerify(ch)} title="Drop this challan's verification">
                  Clear
                </button>
              </div>
              <div className="mm-verify-stats">
                <div><span>Challan expects</span><strong>{v.expected_weight.toLocaleString()} kg · {v.expected_rolls} rolls</strong></div>
                <div><span>Already received</span><strong>{v.received_weight.toLocaleString()} kg</strong></div>
                <div><span>Remaining</span><strong>{v.remaining_weight.toLocaleString()} kg</strong></div>
                <div className={over ? "mm-verify-over" : "mm-verify-ok"}>
                  <span>Entering now</span><strong>{entering.toLocaleString()} kg</strong>
                </div>
              </div>
              {over && (
                <p className="mm-verify-warn">
                  Entered weight exceeds this challan's remaining {v.remaining_weight.toLocaleString()} kg — posting will be blocked.
                </p>
              )}
            </div>
          );
        })}

        {error && <p className="mm-error" style={{ marginTop: "0.6rem" }}>{error}</p>}
        {flash && <p className="mm-banner mm-banner-ok" style={{ marginTop: "0.6rem" }}>{flash}</p>}
      </section>

      {/* The entry grid. */}
      <section className="mm-card mm-iw-items-card">
        {/* Scope switches live here, NOT in the column headers. The grid's columns are
            fixed widths on nowrap cells, so a button inside a header forced its column
            wider and pushed every other one out of line — the alignment is the point of
            a grid this dense. */}
        <div className="mm-iw-band mm-iw-band-split">
          <span>Inward items — one line per lot</span>
          <span className="mm-iw-scopes">
            <button type="button" className={`mm-iw-scope${seeAllSuppliers ? "" : " is-on"}`}
              aria-pressed={!seeAllSuppliers}
              title={`Supplier picker: ${seeAllSuppliers ? "every supplier" : `only the ${openSupplierCount} with an open purchase order, narrowed to the row's colour`}. Click to switch.`}
              onClick={() => setSeeAllSuppliers((v) => !v)}>
              Suppliers: {seeAllSuppliers ? "all" : `open PO (${openSupplierCount}) · row colour`}
            </button>
            <button type="button" className={`mm-iw-scope${seeAllOrders ? "" : " is-on"}`}
              aria-pressed={!seeAllOrders}
              title={`Order picker: ${seeAllOrders ? "every approved order, closed ones included" : "only orders still open for inward"}. Click to switch.`}
              onClick={() => setSeeAllOrders((v) => !v)}>
              Orders: {seeAllOrders ? "all" : `open (${soOptions.length})`}
            </button>
            {/* The grid has taken Enter and Ctrl+Enter since it was written and never said
                so anywhere. Operators were adding every row with the mouse. */}
            <span className="mm-keys">
              <kbd>Enter</kbd> new row · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> post
            </span>
          </span>
        </div>
        <div className="mm-table-scroll" onKeyDown={onGridKeyDown}>
          <table className="mm-table mm-table-dense mm-iw-grid-table">
            <thead>
              <tr>
                <th className="mm-iw-c-no">No</th>
                <th className="mm-iw-c-jw">JobWork</th>
                {/* These four are in keying order, and the header row has to STAY in the
                    body's order: the cells were resequenced to challan → order → colour →
                    supplier and this row was not, so every heading sat one column off and
                    "Color *" stood over the order picker. */}
                <th className="mm-iw-c-chalan">Chalan No *</th>
                <th className="mm-iw-c-order">Customer Order</th>
                {/* Colour is keyed after the order, which fills it in, and before the
                    supplier, which it narrows. */}
                <th className="mm-iw-c-color">Color *</th>
                <th className="mm-iw-c-supplier">Supplier</th>
                <th className="mm-iw-c-lot">Lot No</th>
                <th className="mm-iw-c-roll">Roll</th>
                <th className="mm-iw-c-qty">Qty | Weight (Kg) *</th>
                <th className="mm-iw-c-act" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const t = rowTotals(r);
                const orderWeights = r.customer_order ? orderTotals(r.customer_order) : null;
                // One roll stays inline — that is the common case and it must key as fast
                // as it ever did. Several become the row's total, edited in the cart.
                const single = r.lines.length === 1;
                const rollNos = r.lines.map((l) => l.roll.trim()).filter(Boolean);
                const challan = r.challan_no.trim();
                return (
                  <tr key={i}>
                    <td className="mm-iw-c-no">{i + 1}</td>
                    <td className="mm-iw-c-jw" data-label="JobWork">
                      <input
                        type="checkbox"
                        className="mm-iw-jw-box"
                        checked={r.job_work}
                        title="Job work — this material belongs to the customer"
                        aria-label={`Job work, row ${i + 1}`}
                        onChange={(e) => setRow(i, { job_work: e.target.checked })}
                      />
                    </td>
                    <td className="mm-iw-c-chalan" data-label="Chalan No">
                      <div className="mm-iw-rowfetch">
                        <input className="mm-input mm-input-compact" value={r.challan_no} placeholder="Chalan No"
                          onChange={(e) => setRow(i, { challan_no: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            // Enter here means Fetch, not "next row".
                            e.preventDefault();
                            e.stopPropagation();
                            void onFetchRow(i);
                          }} />
                        <button type="button" className="mm-iw-fetchbtn" disabled={fetchingRow !== null}
                          title="Pull this challan's rolls from Veermetlon into this line, and verify the receipt against it"
                          aria-label={`Fetch challan for row ${i + 1}`} onClick={() => void onFetchRow(i)}>
                          {fetchingRow === i ? "…" : <Download size={14} />}
                        </button>
                        {challan && verify[challan] && (
                          <span className="mm-iw-vmdot" title={`Verified from Veermetlon · ${challan}`}>
                            <PackageCheck size={12} />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="mm-iw-c-order" data-label="Customer Order">
                      {/* Open orders, in FIFO order, and nothing narrows them: the order is
                          keyed straight after the challan, so the row's colour does not
                          exist yet to narrow BY — it is the order that fills the colour in,
                          along with the supplier it was bought from. Scoping this by colour
                          only ever bit on a re-keyed row, where it hid orders for no reason
                          the operator could see. "Orders: all" adds the closed ones. */}
                      <SearchSelect
                        compact
                        value={r.customer_order}
                        placeholder="Select Order"
                        emptyText="No open orders"
                        options={orderOptions}
                        // The column is narrow and every option carries a party and colour
                        // under its number — the list opens wider than the field it sits in.
                        menuMinWidth={440}
                        onChange={(v) => pickOrder(i, v)}
                      />
                      {orderWeights && (
                        <span className="mm-iw-ordertot"
                          title="What this order is for, and what has been bought against it">
                          SO <b>{orderWeights.so.toLocaleString()}</b> kg · PO{" "}
                          <b>{orderWeights.purchase.toLocaleString()}</b> kg
                        </span>
                      )}
                    </td>
                    <td className="mm-iw-c-color" data-label="Color">
                      {/* THE ORDER OWNS THE COLOUR ONCE ONE IS PICKED. An order is for a
                          named colour, so material received against it is that colour by
                          definition — and typing a different one there did not correct
                          anything, it filed the receipt against an order that never asked
                          for it, silently, on the row that feeds stock and the lot.

                          Editable again the moment the order is cleared, because a row
                          with no order is stock coming in on its own and nothing else
                          knows its colour. */}
                      <LinkField
                        compact
                        label=""
                        linkDoctype="MM Item Master"
                        value={r.color}
                        placeholder={r.customer_order ? "From order" : "Select Color"}
                        disabled={!!r.customer_order}
                        createDefaults={{ item_type: "Roll" }}
                        onChange={(v) => setRow(i, { color: v })}
                      />
                    </td>
                    <td className="mm-iw-c-supplier" data-label="Supplier">
                      {/* Scoped to the row's colour, not merely sorted by it: the colour is
                          keyed first and a supplier that has never sent it is not a
                          candidate. "Suppliers: all" lifts the scope, and a colour nobody
                          has supplied falls back to the whole list rather than an empty
                          picker, so a new colour is never a dead end. */}
                      <SearchSelect
                        compact
                        value={r.supplier}
                        placeholder={r.customer_order ? "From order" : "Supplier"}
                        // Locked once an order is picked — the order names who it was
                        // bought from. Clearing the order hands it back.
                        disabled={!!r.customer_order}
                        createDoctype="MM Vendor Master"
                        emptyText="No vendors yet"
                        options={colourOnly(
                          suppliersInScope,
                          r.color,
                          (v, c) => (v.colours || []).some((x) => x.toLowerCase() === c),
                          (v, group) => ({
                            value: v.vendor,
                            label: v.vendor_name || v.vendor,
                            meta: [
                              v.open_po ? `${v.open_po_count} open PO` : null,
                              (v.colours || []).slice(0, 3).join(", ") || null,
                            ].filter(Boolean).join(" · ") || undefined,
                            group,
                          }),
                          { hit: `Supplied ${r.color}`, rest: "Other suppliers" },
                          seeAllSuppliers,
                        )}
                        onChange={(v) => setRow(i, { supplier: v })}
                      />
                    </td>
                    <td className="mm-iw-c-lot" data-label="Lot No">
                      {/* Assigned per row on post (reused when a challan is entered again) —
                          shown so the operator can see which lot this line becomes. The
                          number runs per FINANCIAL YEAR across every colour, so an id
                          identifies one lot on its own. */}
                      <span
                        className="mm-iw-lot"
                        title={
                          lots[i]
                            ? `Lot ${lots[i]} for ${r.color} — assigned when the inward is posted. Lot numbers run per financial year across all colours, so this id belongs to this lot alone.`
                            : "Pick a colour and the lot for this line is worked out"
                        }
                      >
                        {lots[i] || (r.color ? "…" : "Auto")}
                      </span>
                      <LotRemarkBadge remarks={lotNote(lots[i], r.color)} label={`Lot ${lots[i] || ""}`} />
                    </td>
                    <td className="mm-iw-c-roll" data-label="Roll">
                      {single ? (
                        <input className="mm-input mm-input-compact" value={r.lines[0].roll} placeholder="Roll"
                          onChange={(e) => setLine(i, 0, { roll: e.target.value })} />
                      ) : (
                        <span className="mm-iw-rolls"
                          title={r.lines.map((l, k) => `${l.roll || `roll ${k + 1}`} — ${Number(l.qty) || 0} × ${Number(l.weight) || 0} kg`).join("\n")}>
                          {rollNos.join(", ") || "—"}
                          <em className="mm-iw-rollcount">×{r.lines.length}</em>
                        </span>
                      )}
                    </td>
                    <td className="mm-iw-c-qty" data-label="Qty | Weight (Kg)">
                      <div className="mm-iw-qtypair">
                        {/* Surplus on this lot, said on the row: a Stock tick lives in the
                            cart and would otherwise be invisible from the grid, while it
                            changes what the weight counts towards. */}
                        {r.lines.some((l) => l.stock && lineFilled(l)) && (
                          <span className="mm-iw-stockdot"
                            title={`${r.lines.filter((l) => l.stock && lineFilled(l)).reduce((n, l) => n + (Number(l.weight) || 0), 0).toFixed(2)} kg on this lot is stock only — against the purchase order, not the customer order`}>
                            STOCK
                          </span>
                        )}
                        {single ? (
                          <>
                            <input className="mm-input mm-input-compact" type="number" value={r.lines[0].qty} placeholder="Qty"
                              onChange={(e) => setLine(i, 0, { qty: e.target.value === "" ? "" : Number(e.target.value) })} />
                            <input className="mm-input mm-input-compact" type="number" value={r.lines[0].weight} placeholder="Weight"
                              onChange={(e) => setLine(i, 0, { weight: e.target.value === "" ? "" : Number(e.target.value) })} />
                          </>
                        ) : (
                          <>
                            <span className="mm-iw-sum" title="Total qty of this lot's rolls">{t.qty.toLocaleString()}</span>
                            <span className="mm-iw-sum" title="Total weight of this lot's rolls">{t.weight.toFixed(2)}</span>
                          </>
                        )}
                        <button type="button" className="mm-iw-cart"
                          title="Rolls under this lot — keep entering roll no, qty and weight"
                          aria-label={`Rolls on row ${i + 1}`} onClick={() => openCart(i)}>
                          <ShoppingCart size={15} />
                        </button>
                      </div>
                    </td>
                    <td className="mm-iw-c-act">
                      <div className="mm-iw-rowacts">
                        <button type="button" className="mm-iw-add" title="Add row" aria-label="Add row" onClick={addRow}>
                          <Plus size={16} />
                        </button>
                        <button type="button" className="mm-icon-btn" title="Remove row" aria-label={`Remove row ${i + 1}`} onClick={() => removeRow(i)}>
                          <X size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Totals + Submit, pinned to the bottom of the grid. */}
        <div className="mm-iw-footer">
          <span className="mm-iw-total">Rolls: <strong>{totals.rolls.toLocaleString()}</strong></span>
          <span className="mm-iw-total">Total Qty: <strong>{totals.qty.toLocaleString()}</strong></span>
          <span className="mm-iw-total">Total Weight: <strong>{totals.weight.toFixed(2)}</strong></span>
          <label className="mm-check" title="Tick if more rolls are still coming on these challans">
            <input type="checkbox" checked={isPartial} onChange={(e) => setIsPartial(e.target.checked)} />
            Partial — more to come
          </label>
          <button type="button" className="mm-btn-primary mm-iw-submit" disabled={busy || !!closedChallan}
            onClick={() => void onSubmit()}>
            {busy ? "Posting…" : "Submit"} <span aria-hidden>→</span>
          </button>
        </div>
      </section>

      {/* Open orders for the fetched challans' coating — the allocation reference. */}
      {orders.length > 0 && (
        <section className="mm-card mm-card-pad">
          <div className="mm-iw-sec-head">
            <h2 className="mm-panel-title">Open orders for this coating</h2>
            <span className="mm-pill mm-pill-muted">{orders.length}</span>
          </div>
          <div className="mm-table-scroll">
            <table className="mm-table mm-table-dense">
              <thead>
                <tr><th>Order</th><th>Party</th><th>Color</th><th>Size</th><th className="mm-num">Req</th></tr>
              </thead>
              <tbody>
                {orders.map((o, i) => (
                  <tr key={`${o.sales_order}-${i}`} className={rows.some((r) => r.customer_order === o.sales_order) ? "mm-ws-row-active" : undefined}>
                    <td className="mm-ow-cell-order">{o.sales_order}</td>
                    <td>{o.party || "—"}</td>
                    <td>{o.color_name || "—"}</td>
                    <td>{o.cut || "—"}</td>
                    <td className="mm-num">{(o.required_weight ?? 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mm-muted" style={{ marginTop: "0.5rem", fontSize: "0.75rem" }}>
            One challan can serve several customers — set the order per line above.
          </p>
        </section>
      )}

      {/* Roll-wise entry for one lot: roll no, qty and weight, as many as arrived. */}
      {cartRow !== null && (
        <div className="mm-modal-scrim" style={{ zIndex: 70 }} onClick={() => setCartRow(null)}>
          <div className="mm-modal mm-sheet mm-sheet-narrow" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Rolls on this lot">
            <div className="mm-modal-head">
              <span className="mm-modal-title">
                Rolls — row {cartRow + 1}
                {lots[cartRow] ? <span className="mm-iw-lot mm-iw-lot-head">{lots[cartRow]}</span> : null}
                <LotRemarkBadge remarks={lotNote(lots[cartRow], rows[cartRow]?.color)} label={`Lot ${lots[cartRow] || ""}`} />
              </span>
              <button className="mm-icon-btn" onClick={() => setCartRow(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="mm-modal-body" ref={cartBody}>
              <p className="mm-muted" style={{ marginTop: 0, fontSize: "0.82rem" }}>
                Roll no, qty and weight — one line per roll. Roll numbers may repeat. They all
                land under this line's single lot, and the line shows their total.
                <br />
                Enter adds the next roll · {rows[cartRow].color || "no colour picked yet"}
                {rows[cartRow].challan_no.trim() ? ` · challan ${rows[cartRow].challan_no.trim()}` : ""}
              </p>

              {/* What each ceiling is still waiting for. The sale and the purchase are two
                  different numbers — 900 sold against 1,200 bought settles the sale early
                  and still leaves material on the road — and Stock is how the rest gets in
                  without being refused as an over-receipt on the order. */}
              {cartBalance?.hasPO && (
                <div className="mm-iw-bal">
                  <span className={cartBalance.order > 0 ? "" : "mm-iw-bal-done"}>
                    Order needs
                    <strong>
                      {cartBalance.order > 0 ? `${cartBalance.order.toLocaleString()} kg` : "nothing — settled"}
                    </strong>
                  </span>
                  <span className={cartBalance.purchase > 0 ? "mm-iw-bal-po" : "mm-iw-bal-done"}>
                    Purchase still due
                    <strong>
                      {cartBalance.purchase > 0 ? `${cartBalance.purchase.toLocaleString()} kg` : "nothing"}
                    </strong>
                  </span>
                  {cartBalance.settled && cartBalance.purchase > 0 && (
                    <span className="mm-iw-bal-note">
                      The sale is covered — tick <strong>Stock</strong> on what is left so it comes
                      into inventory instead of over-receiving the order.
                    </span>
                  )}
                </div>
              )}
              {cartLines.map((l, i) => (
                <div className="mm-iw-cart-line" key={i}>
                  <span className="mm-iw-cart-no">{i + 1}</span>
                  <input className="mm-input" data-cart-roll value={l.roll} placeholder="Roll no"
                    aria-label={`Roll no, line ${i + 1}`}
                    onChange={(e) => setCartLines((p) => p.map((x, j) => (j === i ? { ...x, roll: e.target.value } : x)))} />
                  <input className="mm-input mm-iw-cart-num" type="number" min={0} value={l.qty} placeholder="Qty"
                    aria-label={`Qty, line ${i + 1}`}
                    onChange={(e) => setCartLines((p) => p.map((x, j) => (j === i ? { ...x, qty: e.target.value === "" ? "" : Number(e.target.value) } : x)))} />
                  <input className="mm-input mm-iw-cart-num" type="number" value={l.weight} placeholder="Weight"
                    aria-label={`Weight, line ${i + 1}`}
                    onChange={(e) => setCartLines((p) => p.map((x, j) => (j === i ? { ...x, weight: e.target.value === "" ? "" : Number(e.target.value) } : x)))}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      if (e.metaKey || e.ctrlKey) applyCart();
                      else addCartLine();
                    }} />
                  {/* Ticked, this roll comes into stock and counts against the PURCHASE
                      order — it fulfils nothing on the sales order and is not measured
                      against it. Manual: nothing is pre-ticked, because only the person
                      unloading knows which rolls are the surplus. */}
                  <label className={`mm-iw-cart-stock${l.stock ? " is-on" : ""}`}
                    title="Stock only — into inventory against the purchase order, not against the customer order">
                    <input type="checkbox" checked={!!l.stock}
                      aria-label={`Stock only, line ${i + 1}`}
                      onChange={(e) => setCartLines((p) => p.map((x, j) => (j === i ? { ...x, stock: e.target.checked } : x)))} />
                    Stock
                  </label>
                  {cartLines.length > 1 ? (
                    <button type="button" className="mm-icon-btn" title="Remove roll" aria-label={`Remove roll line ${i + 1}`}
                      onClick={() => setCartLines((p) => p.filter((_, j) => j !== i))}>
                      <X size={14} />
                    </button>
                  ) : (
                    <span className="mm-iw-bulk-spacer" />
                  )}
                </div>
              ))}
              <button type="button" className="mm-iw-add mm-iw-bulk-add" title="Add another roll" aria-label="Add another roll"
                onClick={addCartLine}>
                <Plus size={16} />
              </button>
              <p className="mm-muted" style={{ fontSize: "0.82rem" }}>
                <strong>{cartLines.filter(lineFilled).length}</strong> roll(s) ·
                qty <strong>{cartTotals.qty.toLocaleString()}</strong> ·
                <strong> {cartTotals.weight.toFixed(2)}</strong> kg on this lot
                {cartTotals.stock > 0 && (
                  <>
                    {" — "}
                    <strong>{cartTotals.order.toFixed(2)}</strong> kg to the order ·
                    <strong> {cartTotals.stock.toFixed(2)}</strong> kg stock only
                  </>
                )}
              </p>
              <div className="mm-ow-po-actions">
                <button type="button" className="mm-btn-primary" onClick={applyCart}>Save rolls</button>
                <button type="button" className="mm-btn-secondary" onClick={() => setCartRow(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
