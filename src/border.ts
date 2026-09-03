import { visibleWidth } from "@earendil-works/pi-tui";

/**
 * Bottom-border builder for the editor separator + session-name chip.
 *
 * Pure layout logic with color functions injected, so it is fully unit
 * testable without a theme or terminal. The chip is right-aligned with a
 * dash flank on its right; the left-aligned arrow block (scroll indicator)
 * is preserved by construction. When the chip would collide with the arrow
 * block (no minimum gap left), null is returned and the caller keeps the
 * original border line — the chip yields, never overwrites the arrows.
 */

export interface BorderStyle {
	/** Colors a run of separator dashes ("─"). */
	dash(text: string): string;
	/** Styles the chip text (e.g. inverted accent). The chip is padded with one space on each side. */
	chip(text: string): string;
}

/** Minimum number of dashes between the arrow block and the chip. */
export const CHIP_MIN_GAP = 2;
/** Dashes after the chip (right flank, keeps the border visually continuous). */
export const CHIP_RIGHT_FLANK = 1;

/**
 * Build the bottom border line.
 *
 * @param width     terminal width in columns
 * @param arrowText left-aligned arrow block (pre-styled, may contain ANSI),
 *                  e.g. "─── ↓ 3 more "; pass null when there is no scroll indicator
 * @param chipText  raw chip label (unstyled); pass null/"" for a plain separator
 * @param style     injected color functions
 * @returns the styled border line, or null when the chip cannot fit
 */
export function buildBottomBorder(
	width: number,
	arrowText: string | null,
	chipText: string | null,
	style: BorderStyle,
): string | null {
	if (width <= 0) return "";
	const arrow = arrowText ?? "";
	const arrowWidth = visibleWidth(arrow);

	if (!chipText || chipText.length === 0) {
		return arrow + style.dash("─".repeat(Math.max(0, width - arrowWidth)));
	}

	const chip = style.chip(` ${chipText} `);
	const chipWidth = visibleWidth(chip);
	const required = arrowWidth + CHIP_MIN_GAP + chipWidth + CHIP_RIGHT_FLANK;
	if (required > width) return null;

	const before = width - arrowWidth - chipWidth - CHIP_RIGHT_FLANK;
	return arrow + style.dash("─".repeat(before)) + chip + style.dash("─".repeat(CHIP_RIGHT_FLANK));
}
