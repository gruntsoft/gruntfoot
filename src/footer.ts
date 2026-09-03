import type { ExtensionContext, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { buildContextBar } from "./bar.ts";
import {
	colorizeText,
	resolveColors,
	type ColorConfig,
	type ResolvedColors,
	type ThemeLike,
} from "./colors.ts";
import { formatCost, formatCwd, formatPercent, formatTokens } from "./format.ts";
import { resolveIcons, type IconConfig, type ResolvedIcons } from "./icons.ts";
import { isAutoCompactEnabled, isExperimentalMode, isSubscriptionProvider } from "./probes.ts";
import { thinkingColorKey, type ThinkingLevelName } from "./thinking.ts";

export type { ThemeLike } from "./colors.ts";

// ---------------------------------------------------------------------------
// Pure footer view logic (unit-testable without a terminal or pi instance).
// ---------------------------------------------------------------------------

/** Usage totals over all session entries (assistant + toolResult + compaction/branch_summary). */
export interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	/** Cache hit rate of the latest assistant message, or undefined. */
	latestCacheHitRate: number | undefined;
}

/** Structural session-entry shape (the real SessionEntry union matches). */
export interface EntryLike {
	type: string;
	message?: { role?: string; usage?: UsageLike };
	usage?: UsageLike;
}

export interface UsageLike {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

export function createUsageTotals(): UsageTotals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, latestCacheHitRate: undefined };
}

function addUsage(totals: UsageTotals, usage: UsageLike): void {
	totals.input += usage.input;
	totals.output += usage.output;
	totals.cacheRead += usage.cacheRead;
	totals.cacheWrite += usage.cacheWrite;
	totals.cost += usage.cost.total;
}

/**
 * Compute cumulative usage from all session entries, mirroring pi's own
 * footer: assistant message usage, toolResult usage, and compaction /
 * branch_summary usage. The cache hit rate is taken from the latest
 * assistant message.
 */
export function computeUsageTotals(entries: readonly EntryLike[]): UsageTotals {
	const totals = createUsageTotals();
	for (const entry of entries) {
		if (entry.type === "message" && entry.message?.role === "assistant" && entry.message.usage) {
			addUsage(totals, entry.message.usage);
			const promptTokens = entry.message.usage.input + entry.message.usage.cacheRead + entry.message.usage.cacheWrite;
			totals.latestCacheHitRate =
				promptTokens > 0 ? (entry.message.usage.cacheRead / promptTokens) * 100 : undefined;
		} else if (entry.type === "message" && entry.message?.role === "toolResult" && entry.message.usage) {
			addUsage(totals, entry.message.usage);
		} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
			addUsage(totals, entry.usage);
		}
	}
	return totals;
}

/** Everything the footer needs to render, decoupled from pi contexts. */
export interface FooterRenderData {
	model: { provider: string; id: string; reasoning?: boolean } | undefined;
	thinkingLevel: ThinkingLevelName;
	usage: UsageTotals;
	/** Context usage; percent null when unknown (e.g. right after compaction). */
	context: { percent: number | null; window: number | null } | undefined;
	autoCompact: boolean;
	experimental: boolean;
	subscription: boolean;
	cwd: string;
	branch: string | null;
	extensionStatuses: ReadonlyMap<string, string>;
}

/** Sanitize an extension status text for single-line display. */
export function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/**
 * Lay out a left + right pair on one line: right side is truncated first,
 * then the left side, keeping at least `minGap` spaces between them.
 * `ellipsis` may be styled (e.g. theme.fg("muted", "...")) so truncated
 * content keeps its color — pi's own footer does the same. `rightMargin`
 * reserves trailing columns after the right-aligned text so it does not
 * hug the screen edge.
 */
export function layoutLine(
	left: string,
	right: string,
	width: number,
	minGap = 2,
	ellipsis = "...",
	rightMargin = 0,
): string {
	if (width <= 0) return "";
	const usable = width - rightMargin;
	if (right === "") {
		return visibleWidth(left) <= usable ? left : truncateToWidth(left, usable, ellipsis);
	}
	const rightMax = Math.max(0, usable - minGap - visibleWidth(left));
	const rightText = visibleWidth(right) <= rightMax ? right : truncateToWidth(right, rightMax, ellipsis);
	let pad = usable - visibleWidth(left) - visibleWidth(rightText);
	if (pad >= minGap) {
		return left + " ".repeat(pad) + rightText + " ".repeat(rightMargin);
	}
	const leftMax = Math.max(0, usable - minGap - visibleWidth(rightText));
	const leftText = truncateToWidth(left, leftMax, ellipsis);
	pad = Math.max(0, usable - visibleWidth(leftText) - visibleWidth(rightText));
	return leftText + " ".repeat(pad) + rightText + " ".repeat(rightMargin);
}

/** Color used for a context bar level (the empty bar falls back to base). */
function contextColorFor(level: "low" | "medium" | "high" | null, resolved: ResolvedColors) {
	switch (level) {
		case "low":
			return resolved.contextLow;
		case "medium":
			return resolved.contextMedium;
		case "high":
			return resolved.contextHigh;
		case null:
			return resolved.base;
	}
}

/** Prefix a segment with its icon; `""` (none) drops glyph and trailing space. */
function withIcon(icon: string, text: string): string {
	return icon === "" ? text : `${icon} ${text}`;
}

function buildModelSegment(data: FooterRenderData, theme: ThemeLike, resolved: ResolvedColors, icons: ResolvedIcons): string {
	const modelName = data.model ? `${data.model.provider}/${data.model.id}` : "no model";
	const pinned = resolved.model;
	if (pinned) return colorizeText(theme, pinned, withIcon(icons.model, modelName));
	return theme.fg(thinkingColorKey(data.thinkingLevel), withIcon(icons.model, modelName));
}

function buildThinkingSegment(
	data: FooterRenderData,
	theme: ThemeLike,
	resolved: ResolvedColors,
	icons: ResolvedIcons,
): string | null {
	if (!data.model?.reasoning) return null;
	const pinned = resolved.thinking;
	if (pinned) return colorizeText(theme, pinned, withIcon(icons.thinking, data.thinkingLevel));
	return theme.fg(thinkingColorKey(data.thinkingLevel), withIcon(icons.thinking, data.thinkingLevel));
}

function buildContextSegment(data: FooterRenderData, theme: ThemeLike, resolved: ResolvedColors, icons: ResolvedIcons): string {
	const percent = data.context?.percent ?? null;
	const bar = buildContextBar(percent);
	const windowText = data.context?.window != null ? formatTokens(data.context.window) : "?";
	const percentText = percent === null ? "?%" : `${formatPercent(percent)}%`;
	const contextColor = contextColorFor(bar.level, resolved);
	const parts = [];
	if (icons.context !== "") {
		parts.push(colorizeText(theme, resolved.base, icons.context));
	}
	parts.push(
		colorizeText(theme, contextColor, bar.text),
		// percent and /window are one unit: "33.3%/100k", in the context color
		colorizeText(theme, contextColor, `${percentText}/${windowText}`),
	);
	if (data.autoCompact && icons.compact !== "") {
		parts.push(colorizeText(theme, resolved.base, icons.compact));
	}
	return parts.join(" ");
}

/** Trailing columns reserved after right-aligned footer sections (path, branch). */
const FOOTER_RIGHT_MARGIN = 1;

function buildL1(data: FooterRenderData, theme: ThemeLike, width: number, resolved: ResolvedColors, icons: ResolvedIcons): string {
	const segments = [
		buildModelSegment(data, theme, resolved, icons),
		buildThinkingSegment(data, theme, resolved, icons),
		buildContextSegment(data, theme, resolved, icons),
	].filter((s): s is string => s !== null);
	const left = segments.join(colorizeText(theme, resolved.base, " • "));
	const right = colorizeText(theme, resolved.path, withIcon(icons.path, formatCwd(data.cwd)));
	return layoutLine(left, right, width, 2, colorizeText(theme, resolved.base, "..."), FOOTER_RIGHT_MARGIN);
}

function buildL2(data: FooterRenderData, theme: ThemeLike, width: number, resolved: ResolvedColors, icons: ResolvedIcons): string {
	const segments: { text: string; style: "usage" | "warning" }[] = [];
	const usage = data.usage;

	const tokenParts: string[] = [];
	if (usage.input > 0) tokenParts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output > 0) tokenParts.push(`↓${formatTokens(usage.output)}`);
	if (tokenParts.length > 0) segments.push({ text: withIcon(icons.tokens, tokenParts.join(" ")), style: "usage" });

	const cacheParts: string[] = [];
	if (usage.cacheRead > 0) cacheParts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite > 0) cacheParts.push(`W${formatTokens(usage.cacheWrite)}`);
	if ((usage.cacheRead > 0 || usage.cacheWrite > 0) && usage.latestCacheHitRate !== undefined) {
		cacheParts.push(`CH${usage.latestCacheHitRate.toFixed(1)}%`);
	}
	if (cacheParts.length > 0) segments.push({ text: withIcon(icons.cache, cacheParts.join(" ")), style: "usage" });

	if (data.subscription) {
		segments.push({ text: withIcon(icons.cost, "sub"), style: "usage" });
	} else if (usage.cost > 0) {
		segments.push({ text: withIcon(icons.cost, formatCost(usage.cost)), style: "usage" });
	}

	// Standalone icon: no glyph means the whole segment is dropped.
	if (data.experimental && icons.experimental !== "") {
		segments.push({ text: icons.experimental, style: "warning" });
	}

	const left = segments
		.map((segment) =>
			segment.style === "usage" ? colorizeText(theme, resolved.usage, segment.text) : theme.fg("warning", segment.text),
		)
		.join(colorizeText(theme, resolved.base, " • "));
	const right = data.branch ? colorizeText(theme, resolved.branch, withIcon(icons.branch, data.branch)) : "";
	if (left === "" && right === "") return "";
	return layoutLine(left, right, width, 2, colorizeText(theme, resolved.base, "..."), FOOTER_RIGHT_MARGIN);
}

function buildL3(data: FooterRenderData, theme: ThemeLike, width: number, resolved: ResolvedColors): string | null {
	if (data.extensionStatuses.size === 0) return null;
	const texts = Array.from(data.extensionStatuses.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, text]) => sanitizeStatusText(text));
	const line = texts.join(" ");
	return truncateToWidth(colorizeText(theme, resolved.base, line), width, colorizeText(theme, resolved.base, "..."));
}

/**
 * Render the full footer (L1 stats, L2 usage, L3 extension statuses).
 * `colors` and `icons` are the raw configurations (as stored in settings);
 * junk entries fall back to their auto defaults per-role.
 */
export function renderFooter(
	data: FooterRenderData,
	theme: ThemeLike,
	width: number,
	colors: ColorConfig = {},
	icons: IconConfig = {},
): string[] {
	if (width <= 0) return [];
	const resolved = resolveColors(colors);
	const resolvedIcons = resolveIcons(icons);
	const lines = [buildL1(data, theme, width, resolved, resolvedIcons)];
	const l2 = buildL2(data, theme, width, resolved, resolvedIcons);
	if (l2 !== "") lines.push(l2);
	const l3 = buildL3(data, theme, width, resolved);
	if (l3 !== null) lines.push(l3);
	return lines;
}

// ---------------------------------------------------------------------------
// Footer factory wired to pi's ctx.ui.setFooter().
// ---------------------------------------------------------------------------

/**
 * Create the setFooter factory. Captures the extension context; re-renders
 * are triggered by the caller (index.ts) via the TUI instance reported
 * through `onTui`. Renders defensively — probes never throw during render.
 */
export function createGruntfootFooter(
	ctx: ExtensionContext,
	getColors: () => ColorConfig,
	getIcons: () => IconConfig,
	onTui?: (tui: TUI) => void,
): (tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) => Component & { dispose(): void } {
	return (tui, theme, footerData) => {
		onTui?.(tui);
		const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
		return {
			dispose() {
				unsubscribe();
			},
			invalidate() {},
			render(width: number): string[] {
				try {
					return renderFooter(collectFooterData(ctx, footerData), theme, width, getColors(), getIcons());
				} catch {
					return [];
				}
			},
		};
	};
}

function collectFooterData(ctx: ExtensionContext, footerData: ReadonlyFooterDataProvider): FooterRenderData {
	const model = ctx.model;
	const contextUsage = ctx.getContextUsage();
	return {
		model: model ? { provider: model.provider, id: model.id, reasoning: model.reasoning } : undefined,
		thinkingLevel: ctx.thinkingLevel ?? "off",
		usage: computeUsageTotals(ctx.sessionManager.getEntries()),
		context: {
			percent: contextUsage?.percent ?? null,
			window: contextUsage?.contextWindow ?? model?.contextWindow ?? null,
		},
		autoCompact: isAutoCompactEnabled(ctx.cwd),
		experimental: isExperimentalMode(),
		subscription: isSubscriptionProvider(model?.provider, ctx),
		cwd: ctx.cwd,
		branch: footerData.getGitBranch(),
		extensionStatuses: footerData.getExtensionStatuses(),
	};
}
