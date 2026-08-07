/**
 * Challan print — A4, two copies per sheet (Original / Duplicate).
 *
 * The shop keeps one copy and the other travels with the goods, so a single A4 carries
 * both: each copy occupies half the page (148.5mm) and the sheet prints once. Bobbin
 * detail entered in the production "+ Box" popup rides along on each line, which is what
 * makes this the bobbin's reflection on the challan.
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
  items?: ChallanItem[];
  bobbins?: ChallanBobbin[];
};

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const num = (v: unknown, d = 2) =>
  Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

/** One copy of the challan — rendered twice onto the same sheet. */
function copy(d: ChallanPrintData, label: string): string {
  const items = d.items ?? [];
  const bobbins = (d.bobbins ?? []).filter((b) => b.bobbin);
  // Any line carrying bobbin detail turns the bobbin columns on.
  const showBobbin = items.some((i) => i.bobbin || Number(i.bobbin_pcs || 0) > 0) || bobbins.length > 0;

  const rows = items
    .map(
      (i, n) => `<tr>
      <td class="c">${n + 1}</td>
      <td>${esc(i.color_name || "")}</td>
      <td class="c">${esc(i.cut || "")}</td>
      ${showBobbin ? `<td>${esc(i.bobbin || "")}</td><td class="r">${i.bobbin_pcs ? num(i.bobbin_pcs, 0) : ""}</td>` : ""}
      <td class="r">${num(i.qty_box, 0)}</td>
      <td class="r">${num(i.gross_weight)}</td>
      <td class="r">${num(i.net_weight ?? i.weight)}</td>
    </tr>`,
    )
    .join("");

  const bobbinBlock = bobbins.length
    ? `<table class="bob"><tr><th>Bobbin</th><th class="r">Qty</th><th class="r">Wt</th></tr>${bobbins
        .map((b) => `<tr><td>${esc(b.bobbin)}</td><td class="r">${num(b.qty, 0)}</td><td class="r">${num(b.weight)}</td></tr>`)
        .join("")}</table>`
    : "";

  return `<section class="copy">
    <div class="hd">
      <div class="brand">MAHAVIR METALIC</div>
      <div class="ttl">${esc(d.challan_type || "Sales")} Challan<span class="lbl">${esc(label)}</span></div>
    </div>
    <table class="meta">
      <tr>
        <td class="k">Challan No</td><td class="v"><b>${esc(d.challan_no || d.name)}</b></td>
        <td class="k">Date</td><td class="v">${esc(d.transaction_date || "")}</td>
      </tr>
      <tr>
        <td class="k">Party</td><td class="v"><b>${esc(d.party_name || d.party || "")}</b></td>
        <td class="k">Order</td><td class="v">${esc(d.sales_order || "—")}</td>
      </tr>
      ${
        d.address || d.mobile_no
          ? `<tr><td class="k">Address</td><td class="v" colspan="3">${esc(d.address || "")}${
              d.mobile_no ? ` · ${esc(d.mobile_no)}` : ""
            }</td></tr>`
          : ""
      }
      ${
        d.transport || d.vehicle_no
          ? `<tr><td class="k">Transport</td><td class="v">${esc(d.transport || "")}</td>
             <td class="k">Vehicle</td><td class="v">${esc(d.vehicle_no || "")}</td></tr>`
          : ""
      }
    </table>
    <table class="items">
      <thead><tr>
        <th class="c">#</th><th>Colour</th><th class="c">Cut</th>
        ${showBobbin ? "<th>Bobbin</th><th class='r'>Pcs</th>" : ""}
        <th class="r">Box</th><th class="r">Gross</th><th class="r">Net (Kg)</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="8" class="c">No items</td></tr>`}</tbody>
      <tfoot><tr>
        <td colspan="${showBobbin ? 5 : 3}" class="r"><b>Total</b></td>
        <td class="r"><b>${num(d.total_box, 0)}</b></td>
        <td></td>
        <td class="r"><b>${num(d.total_weight)}</b></td>
      </tr></tfoot>
    </table>
    ${bobbinBlock}
    ${d.remarks ? `<div class="rem">${esc(d.remarks)}</div>` : ""}
    <div class="sign"><span>Receiver's Signature</span><span>For MAHAVIR METALIC</span></div>
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
    .copy { height: 148.5mm; padding: 6mm 8mm; display: flex; flex-direction: column;
            border-bottom: 1px dashed #999; overflow: hidden; }
    .copy:last-child { border-bottom: 0; }
    .hd { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 2px solid #000; padding-bottom: 1.5mm; }
    .brand { font-size: 13pt; font-weight: 800; letter-spacing: 0.5px; }
    .ttl { font-size: 9pt; font-weight: 700; }
    .lbl { font-weight: 400; margin-left: 3mm; padding: 0.4mm 1.6mm; border: 1px solid #000; font-size: 7pt; }
    table { width: 100%; border-collapse: collapse; }
    .meta { margin-top: 2mm; font-size: 8pt; }
    .meta .k { width: 16mm; color: #444; padding: 0.5mm 0; }
    .meta .v { padding: 0.5mm 3mm 0.5mm 0; }
    .items { margin-top: 2mm; font-size: 8pt; }
    .items th, .items td { border: 0.4pt solid #444; padding: 0.9mm 1.4mm; }
    .items th { background: #eee; font-size: 7pt; text-transform: uppercase; }
    .items .r, .bob .r { text-align: right; font-variant-numeric: tabular-nums; }
    .items .c { text-align: center; }
    .bob { margin-top: 1.5mm; font-size: 7.5pt; width: 60mm; }
    .bob th, .bob td { border: 0.4pt solid #444; padding: 0.7mm 1.2mm; }
    .bob th { background: #eee; }
    .rem { margin-top: 1.5mm; font-size: 7.5pt; font-style: italic; }
    .sign { margin-top: auto; display: flex; justify-content: space-between; font-size: 7.5pt; padding-top: 6mm; }
  </style></head><body>
  ${copy(d, "Original")}
  ${copy(d, "Duplicate")}
  </body></html>`);
  w.document.close();
  w.focus();
  // Give the layout a beat to settle before the print dialog opens.
  setTimeout(() => { w.print(); }, 350);
}
