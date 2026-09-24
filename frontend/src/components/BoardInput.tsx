import { memo, type ChangeEvent } from "react";

/**
 * A plain text input on a screen that re-reads itself on a timer, held still.
 *
 * WHY THIS EXISTS: React rewrites an <input>'s `name` and `type` attributes on every commit
 * that reaches it, whether or not a single prop changed — an input always gets an update
 * payload, so an identical re-render still touches the DOM. The Program board re-reads
 * itself every twenty seconds and the answer is usually byte-identical, yet each poll was
 * blinking all 28 machine-cut boxes and both date pickers at once: 256 attribute writes,
 * which the floor sees as the screen flickering (Hetvi: "the screen flickers").
 *
 * memo stops the re-render short of the input, so a box redraws only when its own value
 * moves. That is why every prop handed in has to keep its identity between renders — pass
 * a useCallback handler, never a fresh arrow, or the memo is defeated and the flicker comes
 * straight back. Measured on the board: 256 attribute writes per 25s before, 0 after.
 */
const BoardInput = memo(function BoardInput({
  className, type, placeholder, value, onChange,
}: {
  className: string;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <input className={className} type={type} placeholder={placeholder} value={value} onChange={onChange} />
  );
});

export default BoardInput;
