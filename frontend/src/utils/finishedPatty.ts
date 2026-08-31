/**
 * Finished patty, grouped and filtered — the one definition, shared.
 *
 * The Program screen carries a shelf of finished patty, and the Finished Patty page shows
 * the same material in full. "The same filter" is a requirement rather than a coincidence,
 * so the grouping and the search live here and both screens call them: a rule changed in
 * one place cannot leave the two disagreeing about what is on the shelf.
 */

/** The fields of an available-roll row that the shelf actually reads. */
export type PattySource = {
  shade?: string;
  roll_no?: string;
  cut?: string | null;
  batches?: number;
  total_patti?: number;
  lot?: string | null;
  lot_id?: string | null;
  lot_challan?: string | null;
};

/** One tile: a colour IN ONE LOT, and how many of its patti are still free. */
export type PattyTile = {
  key: string;
  colour: string;
  lotId: string;
  lot: string;
  challan: string;
  /** Patti still available to program. */
  count: number;
  /** Patti the lot started with — `count` of `total` are left. */
  total: number;
  lots: string[];
  lotIds: string[];
};

/**
 * Group available patty into tiles, optionally keeping only one cut.
 *
 * SOURCE-WISE: a tile is a colour in one lot, not a colour. Eight patti of TEST SILVER off
 * two lots are two different materials that happen to share a name — merged into one tile
 * the shelf says "8" and nobody can tell which lot a program would draw from, nor read a
 * lot's remark against the right patti.
 */
export function groupPatties(patties: PattySource[], scopeCut?: string | null): PattyTile[] {
  const cut = (scopeCut || "").trim();
  const g: Record<string, PattyTile> = {};
  for (const p of patties) {
    // Scoped to a machine: only patty cut the way that machine runs. A machine with no cut
    // recorded filters nothing — it can take anything.
    if (cut && (p.cut || "").trim() !== cut) continue;
    const colour = p.shade || p.roll_no || "—";
    const lotId = p.lot_id || "";
    const key = `${colour}|${lotId || p.lot || "—"}`;
    const e = (g[key] ||= {
      key, colour, lotId, lot: p.lot || "", challan: p.lot_challan || "",
      count: 0, total: 0, lots: [], lotIds: [],
    });
    if (p.lot && !e.lots.includes(p.lot)) e.lots.push(p.lot);
    if (p.lot_id && !e.lotIds.includes(p.lot_id)) e.lotIds.push(p.lot_id);
    e.count += Number(p.batches || 0);
    e.total += Number(p.total_patti ?? p.batches ?? 0);
  }
  // Colour first, then lot, so the same colour's lots sit side by side.
  return Object.values(g).sort(
    (a, b) => a.colour.localeCompare(b.colour) || a.lotId.localeCompare(b.lotId),
  );
}

/**
 * The shelf's search: colour, lot id or challan.
 *
 * With the shelf split source-wise, "the LT13 patty" is as natural a thing to look for as
 * a colour, and the challan is how the material is asked for at the gate.
 */
export function filterPatties(tiles: PattyTile[], query: string): PattyTile[] {
  const q = (query || "").trim().toLowerCase();
  if (!q) return tiles;
  return tiles.filter((p) =>
    [p.colour, p.lotId, p.challan].some((v) => (v || "").toLowerCase().includes(q)),
  );
}

/** Tooltip for a tile — the same sentence wherever the tile is drawn. */
export function pattyTitle(c: PattyTile): string {
  return (
    `${c.count} of ${c.total} patti still available` +
    (c.lotId ? ` on lot ${c.lotId}` : "") +
    (c.challan ? ` (challan ${c.challan})` : "") +
    " — program this patty"
  );
}
