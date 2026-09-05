import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/** Breathing room between the field and its menu. */
const GAP = 4;
/** Room a menu wants before it will settle for a squeezed list. */
const WANT = 240;
/** Never render a list shorter than this — a 40px stub is worse than a short scroller. */
const MIN = 132;

type Box = { left: number; width: number; space: number; top?: number; bottom?: number };

/**
 * A dropdown panel rendered in a portal on <body>, pinned to its anchor's box.
 *
 * Dropdowns used to be absolutely positioned inside their own field. Any scrolling
 * ancestor then clipped them — a `.mm-table-scroll` row, a drawer — and the list simply
 * never appeared (note that `overflow-x: auto` makes the browser clip vertically too, so
 * a horizontally-scrolling table hides a downward menu). Portalling to <body> with fixed
 * positioning escapes every ancestor's overflow, so this can't regress per-container.
 *
 * Three rules keep the list reachable wherever the field happens to sit:
 *
 *  - It opens upward when there is more room above. (This used to render an INVISIBLE
 *    menu: only `bottom` was set inline, so `.mm-suggest`'s `top: 100%` survived and,
 *    against the viewport, over-constrained the box to zero height. That is the "click
 *    the supplier and nothing opens, scroll a bit and it works" bug — scrolling moved
 *    the field up until there was room below and the flip stopped happening.)
 *  - It publishes the room it actually has as `--mm-menu-space`, so the CSS caps the
 *    list at what fits on screen instead of overflowing off the bottom.
 *  - When NEITHER side can show a usable list, the field is scrolled into view on open,
 *    so the operator never has to scroll and click again.
 *
 * The direction is decided once per opening and then held, so scrolling with the menu
 * open slides it along instead of making it jump from below the field to above it.
 * Marked `data-mm-menu` so click-outside handlers can tell "inside the menu" from
 * "outside the field".
 */
export default function AnchoredMenu({
	anchor,
	open,
	className,
	minWidth,
	children,
}: {
	anchor: RefObject<HTMLElement | null>;
	open: boolean;
	className?: string;
	/** Floor for the menu's width, when the field is narrower than its list needs. */
	minWidth?: number;
	children: ReactNode;
}) {
	const [box, setBox] = useState<Box | null>(null);
	const up = useRef(false);

	useLayoutEffect(() => {
		if (!open) {
			setBox(null);
			return;
		}
		const roomBelow = (r: DOMRect) => window.innerHeight - r.bottom - GAP - 8;
		const roomAbove = (r: DOMRect) => r.top - GAP - 8;

		// Decide the direction once, on opening — and when the field is boxed in on both
		// sides (a short window, a field low in a scrolling panel), bring it into view
		// first. Centring it always frees room below, so the menu opens downward after.
		const first = anchor.current;
		if (first) {
			const r = first.getBoundingClientRect();
			const below = roomBelow(r);
			const above = roomAbove(r);
			if (below < WANT && above < WANT) {
				up.current = false;
				const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
				first.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
			} else {
				up.current = below < WANT && above > below;
			}
		}

		function place() {
			const el = anchor.current;
			if (!el) return;
			const r = el.getBoundingClientRect();
			const below = roomBelow(r);
			const above = roomAbove(r);
			// Hold the opening direction unless that side has since collapsed (the user
			// scrolled the field to the very edge with the list still open).
			let flip = up.current;
			if (flip ? above < MIN && below > above : below < MIN && above > below) flip = !flip;
			setBox({
				left: r.left,
				width: r.width,
				space: Math.max(MIN, flip ? above : below),
				...(flip ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }),
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
	// A menu is normally exactly as wide as the field it belongs to, which is right until
	// the field sits in a narrow table column and the list is full of order numbers with
	// a party and colour under each. `minWidth` lets such a list open wider than its
	// trigger; it is then pulled back on screen, because a wide menu on a right-hand
	// column would otherwise open past the edge of the window.
	const width = Math.max(box.width, minWidth ?? 0);
	const left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8));
	return createPortal(
		<ul
			data-mm-menu=""
			className={`mm-suggest mm-suggest-fixed${className ? ` ${className}` : ""}`}
			style={
				{
					left,
					width,
					// Both ends are always written: leaving one to the stylesheet is what
					// collapsed a flipped menu to nothing.
					top: box.top ?? "auto",
					bottom: box.bottom ?? "auto",
					"--mm-menu-space": `${Math.round(box.space)}px`,
				} as CSSProperties
			}
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
