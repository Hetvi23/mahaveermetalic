/**
 * Challan print — A4, two copies per sheet (Original / Duplicate).
 *
 * Laid out to match the printed challan book the shop already uses: a three-up grid of
 * No / Net.Wt / Bobbins, numbered straight down each column group, a TOTAL row, what
 * comes back, the terms, and the two signatures. Nothing else.
 *
 * The colour and cut are stated ONCE, on the Item line — a challan is one item packed
 * into many boxes, so repeating them on every row spent the width the weights need.
 */

export type ChallanItem = {
  idx?: number;
  color_name?: string;
  cut?: string;
  barcode?: string;
  qty_box?: number;
  gross_weight?: number;
  bobbin?: string;
  bobbin_pcs?: number;
  total_bobbin_weight?: number;
  box_weight?: number;
  net_weight?: number;
  weight?: number;
  r_box?: number;
  r_bobbin?: number;
};

export type ChallanBobbin = { bobbin?: string; qty?: number; quality?: string; weight?: number };

export type ChallanPrintData = {
  name: string;
  challan_type?: string;
  challan_no?: string;
  transaction_date?: string;
  party?: string;
  party_name?: string;
  address?: string;
  mobile_no?: string;
  sales_order?: string;
  transport?: string;
  vehicle_no?: string;
  remarks?: string;
  total_box?: number;
  total_weight?: number;
  /** Configured in MM Settings — omitted entirely when not set. */
  company_address?: string | null;
  challan_terms?: string | null;
  return_box?: number;
  return_bobbin?: number;
  total_bobbin?: number;
  items?: ChallanItem[];
  bobbins?: ChallanBobbin[];
};

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const num = (v: unknown, d = 3) =>
  Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const int = (v: unknown) => String(Math.round(Number(v || 0)));

/** The book's terms, used when MM Settings names none. Both languages, as printed. */
const DEFAULT_TERMS = [
  "NO GUARANTEE in Jari and Colour Change. Use Material Lot To Lot.",
  "Please keep track of the bobbin — if a bobbin goes missing you will have to pay for it.",
  "જરી અને કલર ચેન્જ ની કોઈપણ પ્રકારની ગેરંટી આપવામાં આવતી નથી. માલ લોટ ટુ લોટ વાપરવો.",
  "મહેરબાની કરીને બોબિનનો હિસાબ રાખજો, જો બોબિન ગુમ થશે તો તેના પૈસા ચૂકવવા પડશે.",
];

/** Three column groups, numbered straight down each — 1-20, 21-40, 41-60 in the book.
 *  A challan with more boxes than that grows the groups rather than dropping rows. */
const GROUPS = 3;
const BOOK_ROWS = 20;

/** One copy of the challan — rendered twice onto the same sheet. */
function copy(d: ChallanPrintData, label: string): string {
  const items = d.items ?? [];
  const perGroup = Math.max(BOOK_ROWS, Math.ceil(items.length / GROUPS));

  // The item line: the colour, and its cut in brackets, exactly like the book's
  // "A COPPER SS (50/303)". Several colours on one challan are all named.
  const colours = [...new Set(items.map((i) => (i.color_name || "").trim()).filter(Boolean))];
  const cuts = [...new Set(items.map((i) => (i.cut || "").trim()).filter(Boolean))];
  const itemLine = colours.join(", ") + (cuts.length ? ` (${cuts.join(", ")})` : "");

  const cell = (n: number) => {
    const it = items[n];
    // A slot past the end of the list prints blank — the grid keeps its shape, the way
    // the pre-printed book does.
    if (!it) return `<td class="n">${n + 1}</td><td class="w"></td><td class="b"></td>`;
    return `<td class="n">${n + 1}</td>
      <td class="w">${num(it.net_weight ?? it.weight)}</td>
      <td class="b">${it.bobbin_pcs ? int(it.bobbin_pcs) : ""}</td>`;
  };

  let grid = "";
  for (let r = 0; r < perGroup; r++) {
    grid += "<tr>";
    for (let g = 0; g < GROUPS; g++) grid += cell(g * perGroup + r);
    grid += "</tr>";
  }

  const count = items.length;
  const totalNet = items.reduce((s, i) => s + Number(i.net_weight ?? i.weight ?? 0), 0);
  const totalBob = d.total_bobbin ?? items.reduce((s, i) => s + Number(i.bobbin_pcs || 0), 0);

  /* Which bobbins went, and how many of each.
     The grid's Bobbins column counts pieces per BOX — it cannot say WHICH bobbin, and the
     terms below make the customer liable for a missing one. Naming them is the whole point
     of that liability, so the challan lists them when there are any and stays silent when
     there are none rather than printing an empty heading. */
  const bobbinRows = (d.bobbins || []).filter((b) => b.bobbin && Number(b.qty || 0) > 0);
  const bobbinBlock = bobbinRows.length
    ? `<table class="bob">
        <thead><tr><th>Bobbin</th><th>Quality</th><th class="rt">Qty</th><th class="rt">Weight</th></tr></thead>
        <tbody>${bobbinRows
          .map((b) => `<tr><td>${esc(b.bobbin || "")}</td><td>${esc(b.quality || "")}</td>` +
                      `<td class="rt">${int(b.qty)}</td>` +
                      `<td class="rt">${Number(b.weight || 0) ? num(b.weight) : ""}</td></tr>`)
          .join("")}</tbody>
      </table>`
    : "";

  const terms = (d.challan_terms || "").trim()
    ? (d.challan_terms as string).split(/\r?\n/).map((t) => t.trim()).filter(Boolean)
    : DEFAULT_TERMS;

  // The type names the paper. Types that already say "Challan" must not have another one
  // appended — "Delivery Challan Challan" is what a blind `${type} Challan` printed.
  const type = (d.challan_type || "Sales").trim();
  const heading = /challan/i.test(type) ? type : `${type} Chalan`;

  return `<section class="copy">
    <table class="hd"><tr>
      <td class="brand">MAHAVIR METALIC</td>
      <td class="addr">${d.company_address ? esc(d.company_address).replace(/\n/g, "<br>") : ""}</td>
      <td class="orig">${esc(label)}</td>
    </tr></table>
    <div class="bannerwrap"><span class="banner">${esc(heading).toUpperCase()}</span></div>
    <table class="meta">
      <tr>
        <td class="k">Name</td><td class="c">:</td><td class="v"><b>${esc(d.party_name || d.party || "")}</b></td>
        <td class="k2">Chalan No</td><td class="c">:</td><td class="v2"><b>${esc(d.challan_no || d.name)}</b></td>
      </tr>
      <tr>
        <td class="k">Item</td><td class="c">:</td><td class="v">${esc(itemLine || "—")}</td>
        <td class="k2">Chalan Date</td><td class="c">:</td><td class="v2">${esc(d.transaction_date || "")}</td>
      </tr>
    </table>
    <table class="grid">
      <thead><tr>
        ${Array.from({ length: GROUPS })
          .map(() => `<th class="n">No</th><th class="w">Net.Wt</th><th class="b">Bobbins</th>`)
          .join("")}
      </tr></thead>
      <tbody>${grid}</tbody>
      <tfoot><tr>
        <td class="tot" colspan="${GROUPS * 3 - 3}">TOTAL</td>
        <td class="n"><b>${int(count)}</b></td>
        <td class="w"><b>${num(totalNet)}</b></td>
        <td class="b"><b>${int(totalBob)}</b></td>
      </tr></tfoot>
    </table>
    ${bobbinBlock}
    <div class="ret">Return No. of Box: <b>${int(d.return_box)}</b> &nbsp; No. of Bobbin: <b>${int(d.return_bobbin)}</b></div>
    <ul class="terms">${terms.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
    <table class="sign"><tr><td>Receiver's Sign</td><td class="rt">Authorised Signature</td></tr></table>
  </section>`;
}

export function printChallan(d: ChallanPrintData) {
  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) {
    window.alert("Allow pop-ups for this site to print the challan.");
    return;
  }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8">
  <title>${esc(d.challan_no || d.name)}</title>
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #000; }
    /* Two copies on one A4: each gets exactly half the 297mm sheet. */
    .copy { height: 148.5mm; padding: 5mm 7mm; display: flex; flex-direction: column;
            border-bottom: 1px dashed #999; overflow: hidden; }
    .copy:last-child { border-bottom: 0; }
    .hd td { vertical-align: top; }
    .brand { font-size: 13pt; font-weight: 800; letter-spacing: 0.5px; white-space: nowrap; }
    .addr { font-size: 6.5pt; line-height: 1.25; text-align: center; }
    .orig { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; text-align: right; white-space: nowrap; }
    .bannerwrap { text-align: center; margin: 1mm 0 1.5mm; }
    .banner { display: inline-block; padding: 0.6mm 5mm; border-radius: 8mm;
              background: #333; color: #fff; font-size: 8pt; font-weight: 700; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; }
    .meta { font-size: 8pt; margin-bottom: 1.5mm; }
    .meta td { padding: 0.4mm 0; vertical-align: top; }
    .meta .k { width: 13mm; } .meta .k2 { width: 24mm; padding-left: 4mm; white-space: nowrap; }
    .meta .c { width: 3mm; } .meta .v2 { width: 30mm; }
    /* The grid IS the challan — it takes whatever height is left on the half-sheet. */
    .grid { font-size: 7.5pt; table-layout: fixed; }
    .grid th, .grid td { border: 0.4pt solid #000; padding: 0.5mm 1.2mm; }
    .grid th { background: #eee; font-size: 6.5pt; font-weight: 700; }
    .grid .n { width: 6.5%; text-align: center; }
    .grid .w, .grid .b { text-align: right; font-variant-numeric: tabular-nums; }
    .grid .w { width: 15%; } .grid .b { width: 11.8%; }
    .grid tfoot .tot { text-align: right; font-weight: 700; border: 0; }
    /* Bobbins, when the challan carries any. Sized to the terms beneath it rather than
       the weight grid above — it is a short reference list, not a second table of record,
       and two copies still have to fit one A4 sheet. */
    .bob { width: 100%; border-collapse: collapse; margin-top: 1.2mm; font-size: 7pt; }
    .bob th, .bob td { border: 0.2mm solid #000; padding: 0.5mm 1mm; }
    .bob th { background: #eee; font-weight: 700; text-align: left; }
    .bob .rt { text-align: right; }
    .ret { margin-top: 1.2mm; font-size: 7.5pt; }
    .terms { margin: 1mm 0 0; padding-left: 4mm; font-size: 6.5pt; line-height: 1.35; }
    .sign { margin-top: auto; font-size: 7.5pt; padding-top: 4mm; }
    .sign .rt { text-align: right; }
  </style></head><body>
  ${copy(d, "Original")}
  ${copy(d, "Duplicate")}
  </body></html>`);
  w.document.close();
  w.focus();
  // Give the layout a beat to settle before the print dialog opens.
  setTimeout(() => { w.print(); }, 350);
}
