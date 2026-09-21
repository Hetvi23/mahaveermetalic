/**
 * Challan print — A4 LANDSCAPE, two copies side by side (Original | Duplicate).
 *
 * Laid out to match the printed challan book the shop already uses: a three-up grid of
 * No / Net.Wt / Bobbins, numbered straight down each column group, a TOTAL row, what
 * comes back, which bobbins went, the numbered terms, and the two signatures.
 *
 * Side by side, not stacked. Stacked, each copy was a half-sheet 148mm tall, so twenty
 * rows got 4mm each and every figure had to be set at 7pt — it printed pale and small.
 * Side by side, each copy is an A5 standing up: the same grid gets 210mm of height, the
 * rows get room, and the type can be set at a size the floor reads from arm's length.
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
  /** Per kg, carried from the sales order line. Zero on an unpriced challan. */
  rate?: number;
  amount?: number;
};

/** `weight` is the weight of ALL `qty` bobbins, not of one. */
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
  /** Whose ORDER this is — only present when it differs from the party the challan is
   *  addressed to, which in practice means a job challan (party = the worker). */
  customer?: string;
  customer_name?: string;
  customer_address?: string;
  customer_mobile?: string;
  remarks?: string;
  total_box?: number;
  total_weight?: number;
  /** Nil on an unpriced challan, which is what hides the value line entirely. */
  total_amount?: number;
  /** 1 when this challan carries a lot the party has never been sent before — the paper
   *  says so at the top left, because the terms below it require lot-to-lot use. */
  new_lot?: number;
  /** Which lots those are. Not printed today; kept so the mark can name them later. */
  new_lots?: string[];
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
/** Rupees, two places — the challan is Indian paper and the rate is a price, not a weight. */
const money = (v: unknown) =>
  `\u20B9${Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** The book writes the whole year — 14-09-2026, not 14-09-26. */
const bookDate = (v?: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(v || "");
};

/** The book's terms, used when MM Settings names none. Both languages, as printed. */
const DEFAULT_TERMS = [
  "NO GUARANTEE in Jari And Colour Change. Use Material Lot To Lot.",
  "Please keep track of the bobbin, if the bobbin goes missing you will have to pay for it.",
  "જરી અને કલર ચેન્જ ની કોઈપણ પ્રકારની ગેરંટી આપવામાં આવતી નથી. માલ લોટ ટુ લોટ વાપરવો.",
  "મહેરબાની કરીને બોબિનનો હિસાબ રાખજો, જો બોબિન ગુમ થશે તો તેના પૈસા ચૂકવવા પડશે.",
];

/** Numbered the way the book numbers them: the English lines 1, 2… and the Gujarati lines
 *  ૧, ૨… each counting on their own, so a term and its translation carry the same number. */
const GU_DIGITS = "૦૧૨૩૪૫૬૭૮૯";
function numberTerms(lines: string[]): string[] {
  let en = 0, gu = 0;
  return lines.map((t) => {
    if (/^\s*[\d\u0AE6-\u0AEF]+[.)]/.test(t)) return t; // already numbered in MM Settings
    if (/[\u0A80-\u0AFF]/.test(t)) {
      gu += 1;
      return `${String(gu).replace(/\d/g, (x) => GU_DIGITS[Number(x)])}. ${t}`;
    }
    en += 1;
    return `${en}. ${t}`;
  });
}

/** Three column groups, numbered straight down each — 1-20, 21-40, 41-60 in the book.
 *  A challan with more boxes than that grows the groups rather than dropping rows. */
const GROUPS = 3;
const BOOK_ROWS = 20;

/** One copy of the challan — rendered twice onto the same sheet. */
function copy(d: ChallanPrintData, label: string): string {
  const items = d.items ?? [];
  const perGroup = Math.max(BOOK_ROWS, Math.ceil(items.length / GROUPS));

  // The item line: the colour, and its cut in brackets, exactly like the book's
  // "LG 104 BSM (SP CUT)". Several colours on one challan are all named.
  const colours = [...new Set(items.map((i) => (i.color_name || "").trim()).filter(Boolean))];
  const cuts = [...new Set(items.map((i) => (i.cut || "").trim()).filter(Boolean))];
  const itemLine = colours.join(", ") + (cuts.length ? ` (${cuts.join(", ")})` : "");

  // BOBBINS REACH THE GRID BY EITHER ROUTE. A production challan carries them per BOX, so
  // each line states its own. A Job Out carries them on the challan's own bobbin table
  // instead — they went with the material, not with any one roll — and those lines had
  // nothing in the column at all. They go on the FIRST line, where the eye lands, so the
  // column and the TOTAL underneath say the same 1,500.
  const perBox = items.reduce((s, i) => s + Number(i.bobbin_pcs || 0), 0);
  const onChallan = (d.bobbins || []).reduce((s, b) => s + Number(b.qty || 0), 0);
  const firstLineBobbins = perBox > 0 ? 0 : onChallan;

  const cell = (n: number) => {
    const it = items[n];
    // A slot past the end of the list prints blank — the grid keeps its shape, the way
    // the pre-printed book does.
    if (!it) return `<td class="n">${n + 1}</td><td class="w"></td><td class="b"></td>`;
    const bob = it.bobbin_pcs ? int(it.bobbin_pcs) : (n === 0 && firstLineBobbins ? int(firstLineBobbins) : "");
    return `<td class="n">${n + 1}</td>
      <td class="w">${num(it.net_weight ?? it.weight)}</td>
      <td class="b">${bob}</td>`;
  };

  let grid = "";
  for (let r = 0; r < perGroup; r++) {
    grid += "<tr>";
    for (let g = 0; g < GROUPS; g++) grid += cell(g * perGroup + r);
    grid += "</tr>";
  }

  const count = items.length;
  const totalNet = items.reduce((s, i) => s + Number(i.net_weight ?? i.weight ?? 0), 0);
  const totalBob = Number(d.total_bobbin || 0) || perBox || onChallan;

  /* Which bobbins went, one line each, the way the book writes it:
       MM 12000 0.059 SMALL : 400
     bobbin, the weight of ONE, its quality, and how many. The grid's Bobbins column counts
     pieces per box and cannot say which bobbin — and the terms make the customer liable
     for a missing one, so the paper names them. Silent when there are none. */
  const bobbinLines = (d.bobbins || [])
    .filter((b) => Number(b.qty || 0) > 0)
    .map((b) => {
      const name = (b.bobbin || "").trim();
      const qty = Number(b.qty || 0);
      const each = qty > 0 && Number(b.weight || 0) > 0 ? num(Number(b.weight) / qty) : "";
      // Bobbin masters are often named with their weight already ("QC635090 BOB 0.059");
      // printing it a second time would read as two different figures.
      const parts = [name, each && !name.includes(each) ? each : "", (b.quality || "").trim()].filter(Boolean);
      return `<div class="bobline">${esc(parts.join(" "))} : <b>${int(qty)}</b></div>`;
    })
    .join("");

  /* Money — ON THE DUPLICATE ONLY, under the terms.
     The Original travels with the goods and is handed over; the Duplicate is the copy the
     shop keeps, and the rate is the shop's business. Printed only when something is
     actually priced: an unpriced delivery challan must not gain a row of zeroes, and job
     challans carry no rate at all. One rate across every priced line is printed as that
     rate; a challan mixing rates just foots, because a single "rate" would be a lie. */
  const priced = (d.items ?? []).filter((it) => Number(it.rate || 0) > 0);
  const rates = [...new Set(priced.map((it) => Number(it.rate || 0)))];
  const amount = Number(d.total_amount || 0);
  const isDuplicate = /duplicate/i.test(label);
  const valueLine = amount > 0 && isDuplicate
    ? `<div class="val">${
        rates.length === 1 ? `Rate: <b>${money(rates[0])}</b> / kg &nbsp;&nbsp; ` : ""
      }Amount: <b>${money(amount)}</b></div>`
    : "";

  const terms = numberTerms((d.challan_terms || "").trim()
    ? (d.challan_terms as string).split(/\r?\n/).map((t) => t.trim()).filter(Boolean)
    : DEFAULT_TERMS);

  // The type names the paper. Types that already say "Challan" must not have another one
  // appended — "Delivery Challan Challan" is what a blind `${type} Challan` printed.
  //
  // Job work prints as ONE book. Job Out and Job In are how the system tells the two
  // directions apart; on paper both are the job challan, and the challan number says which
  // is which. "JOB IN CHALAN" was a screen's word on a document the floor hands over.
  const type = (d.challan_type || "Sales").trim();
  const isJobIn = /^job\s*in$/i.test(type);
  const heading = /^job\s*(in|out)$/i.test(type)
    ? "Job Challan"
    : /challan/i.test(type) ? type : `${type} Chalan`;

  // WHOSE NAME THE PAPER CARRIES. A Job In is the customer's material coming back, so it
  // is named for the customer — the worker it came from is named on the Job Out that sent
  // it, and on a receipt they are only the address it travelled from. Everything else,
  // Job Out included, is addressed to the party it is handed to, with the customer stated
  // underneath where the two differ.
  const nameLine = (isJobIn ? d.customer_name : "") || d.party_name || d.party || "";
  // …and where the customer IS the name above, the row below must not say it twice.
  const showCustomer = !isJobIn && !!d.customer_name;

  return `<section class="copy"><div class="fit">
    <div class="hd">
      <div class="brand">${d.new_lot ? `<span class="newlot">NEW LOT</span>` : ""}MAHAVEER METALIC LLP</div>
      <div class="orig">${esc(label)}</div>
    </div>
    ${d.company_address ? `<div class="addr">${esc(d.company_address).replace(/\n/g, "<br>")}</div>` : ""}
    <div class="bannerwrap"><span class="banner">${esc(heading).toUpperCase()}</span></div>
    <table class="meta">
      <tr>
        <td class="k">Name</td><td class="c">:</td><td class="v"><b>${esc(nameLine)}</b></td>
        <td class="k2">Chalan No</td><td class="c">:</td><td class="v2"><b>${esc(d.challan_no || d.name)}</b></td>
      </tr>
      <tr>
        <td class="k">Item</td><td class="c">:</td><td class="v">${esc(itemLine || "—")}</td>
        <td class="k2">Chalan Date</td><td class="c">:</td><td class="v2">${esc(bookDate(d.transaction_date))}</td>
      </tr>
      ${showCustomer || d.sales_order ? `<tr>
        <td class="k">${showCustomer ? "Customer" : ""}</td><td class="c">${showCustomer ? ":" : ""}</td>
        <td class="v">${showCustomer ? `<b>${esc(d.customer_name)}</b>${
          d.customer_mobile ? ` <span class="sub">${esc(d.customer_mobile)}</span>` : ""
        }` : ""}</td>
        <td class="k2">Order</td><td class="c">:</td><td class="v2">${esc(d.sales_order || "")}</td>
      </tr>` : ""}
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
        <td class="n">${int(count)}</td>
        <td class="w">${num(totalNet)}</td>
        <td class="b">${int(totalBob)}</td>
      </tr></tfoot>
    </table>
    <div class="ret">Return No. of Box: <b>${int(d.return_box)}</b> &nbsp;No. of Bobbin: <b>${int(d.return_bobbin)}</b></div>
    ${bobbinLines}
    <div class="terms">${terms.map((t) => `<div>${esc(t)}</div>`).join("")}</div>
    ${valueLine}
    <div class="sign"><span>Receiver's Sign</span><span>Authorised Signature</span></div>
  </div></section>`;
}

/* Runs inside the print window. Each copy is a fixed half-sheet with its overflow hidden,
   and what goes on it is not fixed — a bobbin list, a customer row, an address, a rate, a
   challan past 60 boxes — so on a heavy one the signature row was simply cut off the
   bottom. A copy that does not fit is scaled down until it does, and widened by the same
   factor first so it still spans the sheet. A copy that fits is left at full size. */
const FIT_SCRIPT = `(function () {
  function fit() {
    var all = Array.prototype.slice.call(document.querySelectorAll(".copy > .fit"));
    if (!all.length) return;
    var copies = all.map(function (el) {
      var box = el.parentElement, cs = getComputedStyle(box);
      return {
        el: el,
        availH: box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
        availW: box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      };
    });
    copies.forEach(function (c) { c.el.style.transform = ""; c.el.style.width = ""; c.el.style.height = "auto"; });
    // ONE factor for both copies, taken from whichever is fuller. They sit side by side on
    // the same sheet, and the Duplicate carries a line the Original does not (the rate) —
    // scaled apart, one copy's type came out visibly smaller than the other's.
    var r = 1;
    copies.forEach(function (c) { r = Math.min(r, c.availH / c.el.getBoundingClientRect().height); });
    if (r >= 1) { copies.forEach(function (c) { c.el.style.height = ""; }); return; }
    // Wider never wraps into MORE lines, so the height at this width fits at r.
    copies.forEach(function (c) { c.el.style.width = c.availW / r + "px"; });
    copies.forEach(function (c) { r = Math.min(r, c.availH / c.el.getBoundingClientRect().height); });
    r = r * 0.998;
    copies.forEach(function (c) {
      c.el.style.width = c.availW / r + "px";
      c.el.style.height = c.availH / r + "px";
      c.el.style.transform = "scale(" + r + ")";
    });
  }
  fit();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  window.addEventListener("beforeprint", fit);
})();`;

/** The whole sheet as a document — separate from the window so it can be rendered and
 *  checked on its own. */
export function challanPrintHtml(d: ChallanPrintData): string {
  return `<!doctype html><html><head><meta charset="utf-8">
  <title>${esc(d.challan_no || d.name)}</title>
  <style>
    @page { size: A4 landscape; margin: 0; }
    * { box-sizing: border-box; }
    /* Backgrounds print. Without this the browser drops them by default, and the black
       banner came out as white text on white paper — a ghost of the challan's own name. */
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    /* Arial first: it is on every shop PC and holds its weight in print. The system UI
       font this used to ask for is drawn hairline-thin at small sizes, which is most of why
       the old sheet read grey. The Gujarati faces are what the terms fall back to. */
    body { margin: 0; display: flex; color: #000;
           font-family: Arial, Helvetica, "Nirmala UI", "Shruti", "Noto Sans Gujarati", "Gujarati Sangam MN", sans-serif; }
    /* Each copy is exactly half the 297mm sheet, standing up — an A5. The window lays it
       out at that size on screen, so the fit below measures what will print. */
    .copy { width: 148.5mm; height: 210mm; padding: 6mm 7mm 5mm; overflow: hidden; flex: none; }
    /* The fold between the two copies, where the book is torn. */
    .copy:first-of-type { border-right: 0.3mm dashed #666; }
    .fit { display: flex; flex-direction: column; height: 100%; transform-origin: 0 0; }

    .hd { display: flex; justify-content: space-between; align-items: flex-start; }
    .brand { font-size: 17pt; font-weight: 900; letter-spacing: 0.4px; white-space: nowrap; }
    /* Inline before the name on purpose: a block here costs the grid a whole row. */
    .newlot { font-size: 10pt; font-weight: 900; letter-spacing: 1px; margin-right: 3mm;
              border: 0.4mm solid #000; padding: 0.3mm 1.5mm; vertical-align: middle; }
    .orig { font-size: 11pt; font-weight: 700; text-transform: uppercase; text-decoration: underline;
            text-underline-offset: 1mm; white-space: nowrap; padding-top: 1mm; }
    .addr { font-size: 9pt; font-weight: 700; line-height: 1.3; text-align: center; margin-top: 1mm; }
    .bannerwrap { text-align: center; margin: 1.8mm 0 2mm; }
    .banner { display: inline-block; padding: 1.2mm 7mm; border-radius: 10mm;
              background: #000; color: #fff; font-size: 11.5pt; font-weight: 700; letter-spacing: 0.6px; }

    table { width: 100%; border-collapse: collapse; }
    .meta { font-size: 10.5pt; margin-bottom: 2mm; }
    .meta td { padding: 0.4mm 0; vertical-align: top; }
    .meta .k { width: 18mm; } .meta .k2 { width: 25mm; padding-left: 3mm; white-space: nowrap; }
    .meta .c { width: 3mm; } .meta .v2 { width: 25mm; }
    .meta .sub { font-size: 9pt; font-weight: 400; }

    /* The grid IS the challan. Plain black rules, no shading — the book's own look, and
       nothing a tired toner cartridge can wash out. */
    .grid { font-size: 10pt; table-layout: fixed; }
    .grid th, .grid td { border: 0.25mm solid #000; padding: 0 1mm; text-align: center;
                         font-variant-numeric: tabular-nums; }
    .grid th { font-size: 9pt; font-weight: 700; height: 6mm; }
    .grid tbody td { height: 5.3mm; }
    .grid .n { width: 7.5%; } .grid .w { width: 14.5%; } .grid .b { width: 11.33%; }
    .grid tfoot td { height: 6mm; font-weight: 700; font-size: 10.5pt; }
    .grid tfoot .tot { text-align: right; padding-right: 3mm; border: 0; }

    .ret { margin-top: 2mm; font-size: 10.5pt; }
    .bobline { margin-top: 0.8mm; font-size: 10.5pt; }
    /* The value sits under the returns line, on its own, so it reads as the total of the
       paper rather than another column of the packing grid. */
    .val { margin-top: 0.8mm; font-size: 10.5pt; text-align: right; }
    .terms { margin-top: 2mm; font-size: 8.5pt; line-height: 1.4; }
    .sign { margin-top: auto; padding-top: 6mm; display: flex; justify-content: space-between;
            font-size: 11pt; font-weight: 700; }
  </style></head><body>
  ${copy(d, "Original")}
  ${copy(d, "Duplicate")}
  <script>${FIT_SCRIPT}</script>
  </body></html>`;
}

export function printChallan(d: ChallanPrintData) {
  const w = window.open("", "_blank", "width=1180,height=860");
  if (!w) {
    window.alert("Allow pop-ups for this site to print the challan.");
    return;
  }
  w.document.write(challanPrintHtml(d));
  w.document.close();
  w.focus();
  // Closes itself once the dialog is done with it, or silent printing leaves an orphan
  // window behind on every challan.
  w.onafterprint = () => w.close();
  // Give the layout a beat to settle before the print dialog opens.
  setTimeout(() => { w.print(); }, 350);
}
