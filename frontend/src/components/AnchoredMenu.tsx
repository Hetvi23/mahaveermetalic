import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * A dropdown panel rendered in a portal on <body>, pinned to its anchor's box.
 *
 * Dropdowns used to be absolutely positioned inside their own field. Any scrolling
 * ancestor then clipped them — a `.mm-table-scroll` row, a drawer — and the list simply
 * never appeared (note that `overflow-x: auto` makes the browser clip vertically too, so
 * a horizontally-scrolling table hides a downward menu). Portalling to <body> with fixed
 * positioning escapes every ancestor's overflow, so this can't regress per-container.
 *
 * Flips above the field when there isn't room below. Marked `data-mm-menu` so
 * click-outside handlers can tell "inside the menu" from "outside the field".
 */
export default function AnchoredMenu({
	anchor,
	open,
	className,
	children,
}: {
	anchor: RefObject<HTMLElement | null>;
	open: boolean;
	className?: string;
	children: ReactNode;
}) {
	const [box, setBox] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);

	useLayoutEffect(() => {
		if (!open) {
			setBox(null);
			return;
		}
		function place() {
			const el = anchor.current;
			if (!el) return;
			const r = el.getBoundingClientRect();
			const below = window.innerHeight - r.bottom;
			// Flip up only when below is genuinely cramped and above has more room.
			const flip = below < 220 && r.top > below;
			setBox({
				left: r.left,
				width: r.width,
				...(flip ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
			});
		}
		place();
		// Capture phase so scrolling *any* ancestor keeps the menu glued to the field.
		window.addEventListener("scroll", place, true);
		window.addEventListener("resize", place);
		return () => {
			window.removeEventListener("scroll", place, true);
			window.removeEventListener("resize", place);
		};
	}, [open, anchor]);

	if (!open || !box) return null;
	return createPortal(
		<ul
			data-mm-menu=""
			className={`mm-suggest mm-suggest-fixed${className ? ` ${className}` : ""}`}
			style={{ left: box.left, width: box.width, top: box.top, bottom: box.bottom }}
		>
			{children}
		</ul>,
		document.body,
	);
}

/** True when a click landed inside any portalled menu (so it must not close the field). */
export function isInsideMenu(target: EventTarget | null): boolean {
	const el = target as Element | null;
	return !!el?.closest?.("[data-mm-menu]");
}
