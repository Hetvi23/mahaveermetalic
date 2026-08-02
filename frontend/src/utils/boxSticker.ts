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
    <div class="hdr">
      <div class="brand">MAHAVIR METALIC</div>
      <div class="size">Size: ${b.size ?? ""}</div>
    </div>
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
    <div class="foot"><span>${b.barcode ?? ""}</span><span>${b.date ?? ""}</span></div>
  </div>`;
}

/**
 * Open the print dialog with one label per box, sized 100×75mm (the label stock).
 * Browser print keeps this dependency-free — pick the TSC printer in the dialog.
 */
export function printBoxStickers(boxes: StickerBox[]) {
  if (!boxes.length) return;
  const w = window.open("", "_blank", "width=760,height=620");
  if (!w) {
    alert("Allow pop-ups for this site to print stickers.");
    return;
  }
  w.document.write(`<!doctype html><html><head><title>Box stickers</title><style>
    @page { size: 100mm 75mm; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
    .sticker { width: 100mm; height: 75mm; padding: 4mm 5mm; page-break-after: always; display: flex; flex-direction: column; }
    .hdr { display: flex; align-items: baseline; justify-content: space-between; }
    .brand { font-weight: 700; font-size: 13pt; text-decoration: underline; }
    .size { font-size: 10pt; font-weight: 600; }
    .item { font-size: 10pt; font-weight: 600; margin-top: 1mm; }
    table.wt { width: 100%; margin-top: 1mm; font-size: 10pt; border-collapse: collapse; }
    table.wt td { padding: 0.4mm 0; vertical-align: top; }
    td.k { width: 26mm; } td.c { width: 3mm; } td.v { width: 22mm; font-variant-numeric: tabular-nums; }
    td.x { font-size: 10pt; }
    .bars { margin-top: auto; text-align: center; }
    .bars svg { max-width: 100%; height: 12mm; }
    .foot { display: flex; justify-content: space-between; font-size: 8pt; margin-top: 0.5mm; }
    @media print { .sticker:last-child { page-break-after: auto; } }
  </style></head><body>${boxes.map(stickerHtml).join("")}</body></html>`);
  w.document.close();
  w.focus();
  // Give the SVG a tick to lay out before the dialog opens.
  setTimeout(() => { w.print(); }, 250);
}
