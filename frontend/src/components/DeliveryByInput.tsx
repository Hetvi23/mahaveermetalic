import { useId } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

/**
 * Who physically takes the goods out — or brings them back, on a Job In.
 *
 * Free text with a memory, not a master. The answer is a driver, an angadia, or whoever
 * happened to be going that way; a master list would have to be curated by the office and
 * would not be, so the field accepts anything and offers back what has been typed before.
 * That gets the spelling consistent — "Ramesh" stops being three different people — while
 * never standing between the operator and a name nobody has used yet.
 *
 * A native <datalist> on purpose. It is the one autocomplete that behaves on a phone and a
 * tablet without a component keeping a menu open, and the field stays an ordinary text box
 * underneath: typing a name that is not on the list is the normal case here, not an error.
 *
 * INTERNAL. This never reaches the printed challan — it is recorded so the office can ask
 * "who took it" afterwards, not so the customer reads it.
 */
export default function DeliveryByInput({
  value,
  onChange,
  label = "Delivery by",
  placeholder = "Who is taking it",
  compact,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string | null;
  placeholder?: string;
  compact?: boolean;
}) {
  // One list id per instance — two of these on a page would otherwise share a datalist.
  const listId = useId();
  // A single cache key, so the suggestions are fetched once and every screen that asks
  // gets the same list without a request each.
  const { data } = useFrappeGetCall<{ message: string[] }>(
    "mahaveermetalic.mahaveer_metallic.api.challan.delivery_by_options",
    undefined,
    "delivery-by-options",
  );
  const options = data?.message ?? [];

  return (
    <label className="mm-field">
      {label ? <span className="mm-field-label">{label}</span> : null}
      <input
        className={`mm-input${compact ? " mm-input-compact" : ""}`}
        list={listId}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </label>
  );
}
