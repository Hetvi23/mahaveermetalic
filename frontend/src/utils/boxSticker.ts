import { code128Svg } from "./barcode";

export type StickerBox = {
  barcode?: string | null;
  item?: string | null;
  size?: string | null;
  gross?: number;
  boxWeight?: number;
  bobbinWeight?: number;
  net?: number;
  no?: number | string | null;
  batch?: string | null;
  operator?: string | null;
  date?: string | null;
};

const kg = (n?: number) => (Number(n) || 0).toFixed(3);

/** One sticker's HTML — mirrors the printed label: header, size, item, weights, barcode. */
function stickerHtml(b: StickerBox): string {
  const bars = b.barcode ? code128Svg(b.barcode, { height: 44, module: 1.6, quiet: 6 }) : "";
  return `
  <div class="sticker">
    <table class="hdr"><tr>
      <td class="brand">MAHAVIR METALIC</td>
      <td class="size">Size: ${b.size ?? ""}</td>
    </tr></table>
    <div class="item">${b.item ?? ""}</div>
    <table class="wt">
      <tr><td class="k">Grs Wt.</td><td class="c">:</td><td class="v">${kg(b.gross)}</td><td class="x"></td></tr>
      <tr><td class="k">Box Wt.</td><td class="c">:</td><td class="v">${kg(b.boxWeight)}</td><td class="x">No : ${b.no ?? ""}</td></tr>
      <tr><td class="k">Bobbin Wt.</td><td class="c">:</td><td class="v">${kg(b.bobbinWeight)}</td><td class="x"></td></tr>
      <tr><td class="k">Net Wt.</td><td class="c">:</td><td class="v">${kg(b.net)}</td><td class="x"></td></tr>
      <tr><td class="k">Batch / MTR</td><td class="c">:</td><td class="v">${b.batch ?? ""}</td><td class="x"></td></tr>
      <tr><td class="k">Operator</td><td class="c">:</td><td class="v">${b.operator ?? ""}</td><td class="x"></td></tr>
    </table>
    <div class="bars">${bars}</div>
    <table class="foot"><tr><td>${b.barcode ?? ""}</td><td class="rt">${b.date ?? ""}</td></tr></table>
  </div>`;
}

/** The whole label document — one source, so the printed sticker and the downloaded
 *  one can never drift apart. The barcode is inline SVG and the CSS is embedded, so the
 *  saved file opens and prints correctly on a machine that has never seen this app. */
function stickerDocument(boxes: StickerBox[]): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Box stickers</title><style>
    @page { size: 100mm 75mm; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
    .sticker { width: 100mm; height: 75mm; padding: 4mm 5mm; page-break-after: always; display: flex; flex-direction: column; }
    .hdr { width: 100%; border-collapse: collapse; }
    .hdr td { vertical-align: baseline; }
    .brand { font-weight: 700; font-size: 13pt; text-decoration: underline; white-space: nowrap; }
    .size { font-size: 10pt; font-weight: 600; text-align: right; white-space: nowrap; }
    .item { font-size: 10pt; font-weight: 600; margin-top: 1mm; }
    table.wt { width: 100%; margin-top: 1mm; font-size: 10pt; border-collapse: collapse; }
    table.wt td { padding: 0.4mm 0; vertical-align: top; }
    td.k { width: 26mm; } td.c { width: 3mm; } td.v { width: 22mm; font-variant-numeric: tabular-nums; }
    td.x { font-size: 10pt; }
    .bars { margin-top: auto; text-align: center; }
    .bars svg { max-width: 100%; height: 12mm; }
    .foot { width: 100%; border-collapse: collapse; font-size: 8pt; margin-top: 0.5mm; }
    .foot .rt { text-align: right; white-space: nowrap; }
    @media print { .sticker:last-child { page-break-after: auto; } }
  </style></head><body>${boxes.map(stickerHtml).join("")}</body></html>`;
}

/**
 * Open the print dialog with one label per box, sized 100×75mm (the label stock).
 * Browser print keeps this dependency-free — pick the TSC printer in the dialog.
 */
export function printBoxStickers(boxes: StickerBox[]): boolean {
  if (!boxes.length) return false;
  const w = window.open("", "_blank", "width=760,height=620");
  // Returns false rather than alert()ing: a popup is blocked when this is called without
  // a click behind it (from a timer, or after an await that has spent the click's user
  // activation), and the caller is the only one that knows what to offer instead. An
  // alert box in the middle of a submit tells the operator nothing they can act on.
  if (!w) return false;
  w.document.write(stickerDocument(boxes));
  w.document.close();
  w.focus();
  // Closes itself once the dialog is done with it. Without this, silent printing (Chrome
  // --kiosk-printing) leaves an orphan window behind on every single print.
  w.onafterprint = () => w.close();
  // Give the SVG a tick to lay out before the dialog opens.
  setTimeout(() => { w.print(); }, 250);
  return true;
}

/**
 * Save the stickers as a file instead of printing them.
 *
 * Printing needs the label printer attached to the machine the operator happens to be
 * sitting at. A file does not: it can be sent to whoever has the printer, kept with the
 * despatch paperwork, or re-printed tomorrow without re-opening the voucher. Same
 * document either way, page-sized to the 100×75mm stock, so opening it and pressing
 * print gives exactly what the Print button would have.
 */
export function downloadBoxStickers(boxes: StickerBox[], filename?: string) {
  if (!boxes.length) return;
  const name = (filename || `stickers-${boxes[0]?.barcode || "box"}`).replace(/[^\w.-]+/g, "-");
  const blob = new Blob([stickerDocument(boxes)], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick: revoking synchronously can beat the download starting.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The stickers for a challan, with the REAL barcodes on them.
 *
 * The voucher's own sticker preview cannot carry a barcode: the code is minted when the
 * production is submitted, so before that the labels read PREVIEW-1, PREVIEW-2 … and a
 * label printed from there is worthless on a box. The challan is the first thing that
 * knows the real codes, and it carries every weight the label needs alongside them — so
 * the sticker for a box is read off the challan line, not rebuilt from the form.
 */
export function stickersFromChallan(d: {
  transaction_date?: string;
  items?: {
    barcode?: string;
    color_name?: string;
    cut?: string;
    gross_weight?: number;
    box_weight?: number;
    total_bobbin_weight?: number;
    net_weight?: number;
    weight?: number;
    bobbin_pcs?: number;
  }[];
}, extra?: { batch?: string | null; operator?: string | null }): StickerBox[] {
  return (d.items ?? [])
    // A line with no barcode is not a box — job challans and hand-built lines have none,
    // and a label with no code is a sticker nobody can scan.
    .filter((it) => (it.barcode || "").trim())
    .map((it) => ({
      barcode: it.barcode,
      item: it.color_name,
      size: it.cut,
      gross: it.gross_weight,
      boxWeight: it.box_weight,
      bobbinWeight: it.total_bobbin_weight,
      net: it.net_weight ?? it.weight,
      no: it.bobbin_pcs,
      batch: extra?.batch ?? null,
      operator: extra?.operator ?? null,
      date: d.transaction_date ?? null,
    }));
}
