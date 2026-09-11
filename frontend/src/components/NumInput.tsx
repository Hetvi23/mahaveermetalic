import { useState, type InputHTMLAttributes } from "react";

/**
 * A number box you can actually type a decimal into.
 *
 * Two separate traps, both of which this app has fallen into more than once:
 *
 *  1. HOLDING THE PARSED VALUE. "90." is a real state on the way to "90.5", and
 *     Number("90.") is 90 — so a field whose state is the parsed number re-renders
 *     without the dot, the next keystroke lands on "90", and 90.5 is recorded as 905.
 *     It never refuses anything; it silently returns a number ten or a hundred times too
 *     big. The keystrokes are held here as TEXT and only parsed on the way out.
 *
 *  2. type="number". The browser empties the field whenever its contents are not a valid
 *     floating-point number, and "0." is not one — so the dot of "0.5" could clear the
 *     box under the operator's fingers. This is a text input with inputMode="decimal",
 *     which still raises the numeric keypad on the floor's tablets.
 *
 * `onChange` receives a number, or "" when the box is empty — the same shape the call
 * sites already used, so they read as they did before.
 *
 * For COUNTS — batches, patty, page size — use a plain integer input instead. A count has
 * no decimal to protect and its own rounding rules, and pretending otherwise is how a
 * half-batch gets keyed.
 */
export default function NumInput({
  value,
  onChange,
  allowNegative,
  ...rest
}: {
  /** Accepts a string too: plenty of call sites already stringify their state. */
  value: number | string | null | undefined;
  onChange: (v: number | "") => void;
  /** Off by default: weights and rates are never negative in this app. */
  allowNegative?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  // What the operator is part-way through typing. Dropped on blur, so the box then shows
  // the canonical number ("0.50" settles to 0.5) rather than the keystrokes.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value == null || value === "" ? "" : String(value));
  const ok = allowNegative ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/;

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={shown}
      onBlur={(e) => {
        setDraft(null);
        rest.onBlur?.(e);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        // Anything that is not on the way to a number is simply not typed — the one job
        // type="number" was doing for us.
        if (raw !== "" && !ok.test(raw)) return;
        setDraft(raw);
        const n = parseFloat(raw);
        onChange(raw === "" || Number.isNaN(n) ? "" : n);
      }}
    />
  );
}
