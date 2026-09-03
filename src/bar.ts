/**
 * Context progress bar: 20 cells of ▓ (filled) / ░ (empty) in brackets,
 * exactly 5% per cell. Thresholds: <50% low, 50-<90% medium, >=90% high.
 * Unknown percent (post-compaction) renders an empty bar. The bar returns a
 * semantic level, not a theme color key — the threshold→color mapping lives
 * with the rest of color resolution (footer.ts via src/colors.ts).
 */

export type ContextBarLevel = "low" | "medium" | "high" | null;

export interface ContextBar {
	/** Rendered bar text, e.g. "[▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░]". */
	text: string;
	/** Semantic fill level; null when the percent is unknown. */
	level: ContextBarLevel;
}

export function buildContextBar(percent: number | null, cells = 20): ContextBar {
	if (percent === null) {
		return { text: `[${"░".repeat(cells)}]`, level: null };
	}
	const filled = Math.max(0, Math.min(cells, Math.round(percent / (100 / cells))));
	const level: ContextBarLevel = percent < 50 ? "low" : percent < 90 ? "medium" : "high";
	return { text: `[${"▓".repeat(filled)}${"░".repeat(cells - filled)}]`, level };
}
