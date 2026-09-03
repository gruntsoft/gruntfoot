import assert from "node:assert/strict";
import { test } from "node:test";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { computeUsageTotals, createUsageTotals, layoutLine, renderFooter, sanitizeStatusText, type FooterRenderData, type ThemeLike } from "../src/footer.ts";

process.env.HOME = "/home/tester";

const COLOR_CODES: Record<string, string> = {
	accent: "38;5;39",
	muted: "38;5;240",
	success: "38;5;2",
	warning: "38;5;3",
	error: "38;5;1",
	thinkingOff: "38;5;245",
	thinkingMinimal: "38;5;244",
	thinkingLow: "38;5;243",
	thinkingMedium: "38;5;242",
	thinkingHigh: "38;5;220",
	thinkingXhigh: "38;5;214",
	thinkingMax: "38;5;208",
};

/** Wrap text in a real ANSI color sequence (visibleWidth-correct). */
function styled(color: string, text: string): string {
	return `\x1b[${COLOR_CODES[color] ?? "0"}m${text}\x1b[0m`;
}

function stubTheme(): ThemeLike {
	return {
		fg: (color: ThemeColor, text: string) => styled(color, text),
		getColorMode: () => "truecolor" as const,
	};
}

/** Remove ANSI escape sequences for text-level assertions. */
function strip(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function data(overrides: Partial<FooterRenderData> = {}): FooterRenderData {
	return {
		model: undefined,
		thinkingLevel: "off",
		usage: createUsageTotals(),
		context: { percent: 0, window: 100000 },
		autoCompact: false,
		experimental: false,
		subscription: false,
		cwd: "/home/tester/proj",
		branch: null,
		extensionStatuses: new Map(),
		...overrides,
	};
}

const theme = stubTheme();

test("empty session renders a single L1 line, no dangling separators", () => {
	const lines = renderFooter(data(), theme, 100);
	assert.equal(lines.length, 1);
	const text = strip(lines[0]);
	assert.ok(text.includes("🤖 no model"));
	assert.ok(text.includes("🪣"));
	assert.ok(!text.includes("💬"));
	assert.ok(!text.includes(" •  • "));
});

test("L1: model and thinking segments use thinking colors", () => {
	const lines = renderFooter(
		data({ model: { provider: "anthropic", id: "claude", reasoning: true }, thinkingLevel: "high" }),
		theme,
		100,
	);
	const l1 = lines[0];
	assert.ok(l1.includes(styled("thinkingHigh", "🤖 anthropic/claude")), l1);
	assert.ok(l1.includes(styled("thinkingHigh", "💭 high")), l1);
});

test("L1: thinking segment hidden when the model does not support reasoning", () => {
	const lines = renderFooter(data({ model: { provider: "openai", id: "gpt", reasoning: false } }), theme, 100);
	assert.ok(!strip(lines[0]).includes("💭"));
});

test("L1: thinking segment shows off when level is off on a reasoning model", () => {
	const lines = renderFooter(
		data({ model: { provider: "anthropic", id: "claude", reasoning: true }, thinkingLevel: "off" }),
		theme,
		100,
	);
	assert.ok(strip(lines[0]).includes("💭 off"));
});

test("L1: context bar uses threshold colors and percent text", () => {
	const lines = renderFooter(data({ context: { percent: 33.33, window: 100000 } }), theme, 100);
	const l1 = lines[0];
	assert.ok(l1.includes(styled("success", "[▓▓▓▓▓▓▓░░░░░░░░░░░░░]")), l1);
	assert.ok(l1.includes(styled("success", "33.3%/100k")), l1);
});

test("L1: unknown percent renders an empty muted bar with ?%", () => {
	const lines = renderFooter(data({ context: { percent: null, window: 100000 } }), theme, 100);
	const l1 = lines[0];
	assert.ok(l1.includes(styled("muted", "[░░░░░░░░░░░░░░░░░░░░]")), l1);
	assert.ok(strip(l1).includes("?%/100k"));
});

test("L1: unknown window renders ?", () => {
	const lines = renderFooter(data({ context: { percent: 10, window: null } }), theme, 100);
	assert.ok(strip(lines[0]).includes("10.0%/?"));
});

test("L1: razor appears only when auto-compaction is enabled", () => {
	assert.ok(strip(renderFooter(data({ autoCompact: true }), theme, 100)[0]).includes("🪒"));
	assert.ok(!strip(renderFooter(data({ autoCompact: false }), theme, 100)[0]).includes("🪒"));
});

test("L1: right side shows ~-abbreviated cwd", () => {
	const l1 = renderFooter(data({ cwd: "/home/tester/proj" }), theme, 100)[0];
	assert.ok(strip(l1).includes("📁 ~/proj"));
});

test("L2: token group shows ↑ and ↓ and is omitted when empty", () => {
	const usage = createUsageTotals();
	usage.input = 1500;
	usage.output = 900;
	const lines = renderFooter(data({ usage }), theme, 100);
	assert.ok(strip(lines[1]).includes("💬 ↑1.5k ↓900"));
	// only output: no dangling ↑
	const usage2 = createUsageTotals();
	usage2.output = 5;
	const lines2 = renderFooter(data({ usage: usage2 }), theme, 100);
	assert.ok(strip(lines2[1]).includes("💬 ↓5"));
	assert.ok(!strip(lines2[1]).includes("↑"));
});

test("L2: cache group shows R/W/CH and is omitted without cache activity", () => {
	const usage = createUsageTotals();
	usage.cacheRead = 5000;
	usage.cacheWrite = 2000;
	usage.latestCacheHitRate = 40;
	const lines = renderFooter(data({ usage }), theme, 100);
	assert.ok(strip(lines[1]).includes("📦 R5.0k W2.0k CH40.0%"), lines[1]);
	// no cacheRead part when zero
	const usage2 = createUsageTotals();
	usage2.cacheWrite = 100;
	const lines2 = renderFooter(data({ usage: usage2 }), theme, 100);
	assert.ok(strip(lines2[1]).includes("📦 W100"));
	assert.ok(!/R\d/.test(strip(lines2[1])), "no cacheRead part when zero");
	// no cache group at all without activity
	const lines3 = renderFooter(data({ usage: createUsageTotals() }), theme, 100);
	assert.equal(lines3.length, 1);
	assert.ok(!strip(lines3[0]).includes("📦"));
});

test("L2: cost is 4 decimals, omitted when zero; sub wins for subscriptions", () => {
	const usage = createUsageTotals();
	usage.cost = 0.0042;
	const lines = renderFooter(data({ usage }), theme, 100);
	assert.ok(strip(lines[1]).includes("💸 $0.0042"));
	const noCost = renderFooter(data({ usage: createUsageTotals() }), theme, 100);
	assert.equal(noCost.length, 1);
	assert.ok(!strip(noCost[0]).includes("💸"));
	assert.ok(strip(renderFooter(data({ subscription: true, usage: createUsageTotals() }), theme, 100)[1]).includes("💸 sub"));
});

test("L2: experimental beaker appears in warning only when enabled", () => {
	assert.ok(renderFooter(data({ experimental: true }), theme, 100)[1].includes(styled("warning", "🧪")));
	const disabled = renderFooter(data({ experimental: false }), theme, 100);
	assert.equal(disabled.length, 1);
	assert.ok(!strip(disabled[0]).includes("🧪"));
});

test("L2: branch appears on the right only when a git branch exists", () => {
	const l2 = renderFooter(data({ branch: "main", usage: createUsageTotals() }), theme, 100)[1];
	assert.ok(strip(l2).includes("🌿 main"));
	const noBranch = renderFooter(data({ branch: null, usage: createUsageTotals() }), theme, 100);
	assert.equal(noBranch.length, 1);
	assert.ok(!strip(noBranch[0]).includes("🌿"));
});

test("L2: whole line omitted when there is no data at all", () => {
	const lines = renderFooter(data({ usage: createUsageTotals(), branch: null }), theme, 100);
	assert.equal(lines.length, 1);
});

test("L3: extension statuses joined sorted on one line", () => {
	const statuses = new Map([
		["b-ext", "second status"],
		["a-ext", "first status"],
	]);
	const lines = renderFooter(data({ extensionStatuses: statuses }), theme, 100);
	// L2 is omitted (no usage data), so L3 is the second line
	assert.equal(strip(lines[1]), "first status second status");
});

test("L3: status text is sanitized", () => {
	assert.equal(sanitizeStatusText("line1\nline2\ttab"), "line1 line2 tab");
	assert.equal(sanitizeStatusText("  spaced   out  "), "spaced out");
});

test("L3: omitted when no statuses", () => {
	const lines = renderFooter(data({}), theme, 100);
	assert.equal(lines.length, 1);
});

test("layoutLine pads between left and right", () => {
	assert.equal(layoutLine("abc", "xyz", 10), "abc    xyz");
});

test("layoutLine reserves a right margin so text does not hug the edge", () => {
	assert.equal(layoutLine("abc", "xyz", 10, 2, "...", 1), "abc   xyz ");
});

test("layoutLine right margin applies to truncated right text", () => {
	assert.equal(strip(layoutLine("abc", "verylongright", 10, 2, "...", 1)), "abc  v... ");
});

test("layoutLine right margin applies when the left side is truncated", () => {
	assert.equal(strip(layoutLine("verylongleft", "xyz", 10, 2, "...", 1)), "very...   ");
});

test("layoutLine truncates the right side first", () => {
	assert.equal(strip(layoutLine("abc", "verylongright", 10)), "abc  ve...");
});

test("layoutLine truncates the left side when the right side cannot shrink further", () => {
	// right side is truncated to nothing first, then the left side shrinks
	assert.equal(strip(layoutLine("verylongleft", "xyz", 10)), "veryl...  ");
});

test("layoutLine handles a missing right side", () => {
	assert.equal(layoutLine("abc", "", 10), "abc");
	assert.equal(strip(layoutLine("toolongwithoutright", "", 8)), "toolo...");
});

test("layoutLine truncation with styled text keeps a styled ellipsis", () => {
	const result = layoutLine(styled("muted", "verylongleft"), styled("muted", "xyz"), 10, 2, styled("muted", "..."));
	assert.equal(strip(result), "veryl...  ");
	assert.ok(result.includes("\x1b[0m"));
});

test("computeUsageTotals sums assistant, toolResult, and compaction usage", () => {
	const usage = (total: number) => ({ input: 100, output: 50, cacheRead: 10, cacheWrite: 5, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total } });
	const entries = [
		{ type: "message", message: { role: "assistant", usage: usage(0.01) } },
		{ type: "message", message: { role: "toolResult", usage: { input: 20, output: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } },
		{ type: "compaction", usage: { input: 300, output: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
		{ type: "custom", customType: "ignored" },
	];
	const totals = computeUsageTotals(entries);
	assert.deepEqual(totals, {
		input: 420,
		output: 50,
		cacheRead: 10,
		cacheWrite: 5,
		cost: 0.01,
		latestCacheHitRate: (10 / (100 + 10 + 5)) * 100,
	});
});

test("computeUsageTotals cache hit rate comes from the latest assistant message", () => {
	const usage = (cacheRead: number, input: number) => ({ input, output: 0, cacheRead, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
	// latest message has cache reads -> its rate wins (0 when none of its prompt tokens were cached)
	const entries = [
		{ type: "message", message: { role: "assistant", usage: usage(100, 100) } },
		{ type: "message", message: { role: "assistant", usage: usage(0, 50) } },
	];
	const totals = computeUsageTotals(entries);
	assert.equal(totals.latestCacheHitRate, 0);
	// latest message has no prompt tokens at all -> rate unknown
	const entries2 = [
		{ type: "message", message: { role: "assistant", usage: usage(0, 0) } },
	];
	assert.equal(computeUsageTotals(entries2).latestCacheHitRate, undefined);
});

// ---------------------------------------------------------------------------
// Configurable colors
// ---------------------------------------------------------------------------

function stubTheme256(): ThemeLike {
	return {
		fg: (color: ThemeColor, text: string) => styled(color, text),
		getColorMode: () => "256color" as const,
	};
}

test("colors: model/thinking pins override the thinking-level colors", () => {
	const lines = renderFooter(
		data({ model: { provider: "anthropic", id: "claude", reasoning: true }, thinkingLevel: "high" }),
		theme,
		100,
		{ model: "accent", thinking: "#ff0000" },
	);
	const l1 = lines[0];
	assert.ok(l1.includes(styled("accent", "🤖 anthropic/claude")), l1);
	assert.ok(l1.includes("\x1b[38;2;255;0;0m💭 high\x1b[39m"), l1);
});

test("colors: thinking pin applies on non-reasoning models via the model segment", () => {
	const lines = renderFooter(
		data({ model: { provider: "openai", id: "gpt", reasoning: false }, thinkingLevel: "medium" }),
		theme,
		100,
		{ model: "warning" },
	);
	assert.ok(lines[0].includes(styled("warning", "🤖 openai/gpt")), lines[0]);
});

test("colors: auto model/thinking keep the thinking-level logic", () => {
	const lines = renderFooter(
		data({ model: { provider: "anthropic", id: "claude", reasoning: true }, thinkingLevel: "high" }),
		theme,
		100,
		{ model: "auto", thinking: "auto" },
	);
	const l1 = lines[0];
	assert.ok(l1.includes(styled("thinkingHigh", "🤖 anthropic/claude")), l1);
	assert.ok(l1.includes(styled("thinkingHigh", "💭 high")), l1);
});

test("colors: context-low/medium/high map to the bar levels, percent, and /window", () => {
	const low = renderFooter(data({ context: { percent: 33.3, window: 100000 } }), theme, 100, { "context-low": "accent" });
	assert.ok(low[0].includes(styled("accent", "[▓▓▓▓▓▓▓░░░░░░░░░░░░░]")), low[0]);
	assert.ok(low[0].includes(styled("accent", "33.3%/100k")), low[0]);

	const medium = renderFooter(data({ context: { percent: 50, window: 100000 } }), theme, 100, { "context-medium": "dim" });
	assert.ok(medium[0].includes(styled("dim", "50.0%/100k")), medium[0]);

	const high = renderFooter(data({ context: { percent: 95, window: 100000 } }), theme, 100, { "context-high": "error" });
	assert.ok(high[0].includes(styled("error", "[▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░]")), high[0]);
	assert.ok(high[0].includes(styled("error", "95.0%/100k")), high[0]);
});

test("colors: unknown-percent bar and the bucket/razor follow base", () => {
	const unknown = renderFooter(data({ context: { percent: null, window: 100000 }, autoCompact: true }), theme, 100, {
		base: "dim",
	});
	assert.ok(unknown[0].includes(styled("dim", "[░░░░░░░░░░░░░░░░░░░░]")), unknown[0]);
	assert.ok(unknown[0].includes(styled("dim", "🪣")), unknown[0]);
	assert.ok(unknown[0].includes(styled("dim", "🪒")), unknown[0]);
	// ?% keeps the context color of the empty bar (base)
	assert.ok(strip(unknown[0]).includes("?%/100k"));
});

test("colors: path/usage/branch follow base when auto", () => {
	const usage = createUsageTotals();
	usage.input = 100;
	const lines = renderFooter(data({ usage, branch: "main", cwd: "/home/tester/proj" }), theme, 100, { base: "accent" });
	assert.ok(lines[0].includes(styled("accent", "📁 ~/proj")), lines[0]);
	assert.ok(lines[1].includes(styled("accent", "💬 ↑100")), lines[1]);
	assert.ok(lines[1].includes(styled("accent", "🌿 main")), lines[1]);
});

test("colors: path/usage/branch pins override base", () => {
	const usage = createUsageTotals();
	usage.input = 100;
	const lines = renderFooter(
		data({ usage, branch: "main", cwd: "/home/tester/proj" }),
		theme,
		100,
		{ base: "muted", path: "dim", usage: "accent", branch: "warning" },
	);
	assert.ok(lines[0].includes(styled("dim", "📁 ~/proj")), lines[0]);
	assert.ok(lines[1].includes(styled("accent", "💬 ↑100")), lines[1]);
	assert.ok(lines[1].includes(styled("warning", "🌿 main")), lines[1]);
});

test("colors: L1/L2 separators, ellipses, and L3 follow base", () => {
	const statuses = new Map([["a-ext", "first status"]]);
	const lines = renderFooter(data({ extensionStatuses: statuses }), theme, 100, { base: "dim" });
	assert.ok(lines[0].includes(styled("dim", " • ")), lines[0]);
	assert.ok(lines[1].includes(styled("dim", "first status")), lines[1]);
});

test("colors: raw hex emits truecolor ANSI, downconverted on 256-color terminals", () => {
	const lines = renderFooter(data(), theme, 100, { base: "#B9D175" });
	assert.ok(lines[0].includes("\x1b[38;2;185;209;117m"), lines[0]);
	const lines256 = renderFooter(data(), stubTheme256(), 100, { base: "#B9D175" });
	assert.ok(lines256[0].includes("\x1b[38;5;150m"), lines256[0]);
});

test("colors: raw ANSI-256 index emits 38;5 directly", () => {
	const lines = renderFooter(data(), theme, 100, { base: "208" });
	assert.ok(lines[0].includes("\x1b[38;5;208m"), lines[0]);
});

test("colors: junk values fall back to auto per-role", () => {
	const lines = renderFooter(data(), theme, 100, { base: "banana" });
	assert.ok(lines[0].includes(styled("muted", "🪣")), lines[0]);
	// a junk context color does not break rendering of other roles
	const lines2 = renderFooter(data({ context: { percent: 10, window: 100000 } }), theme, 100, { "context-low": "banana" });
	assert.ok(lines2[0].includes(styled("success", "[▓▓░░░░░░░░░░░░░░░░░░]")), lines2[0]);
});

test("colors: experimental beaker stays warning regardless of colors", () => {
	const lines = renderFooter(data({ experimental: true }), theme, 100, { usage: "accent", base: "dim" });
	assert.ok(lines[1].includes(styled("warning", "🧪")), lines[1]);
});

// ---------------------------------------------------------------------------
// Configurable icons
// ---------------------------------------------------------------------------

test("icons: default render is identical with an absent icons config", () => {
	const full = data({
		model: { provider: "anthropic", id: "claude", reasoning: true },
		thinkingLevel: "high",
		autoCompact: true,
		experimental: true,
		subscription: true,
		branch: "main",
		usage: { input: 1500, output: 900, cacheRead: 5000, cacheWrite: 2000, cost: 0.0042, latestCacheHitRate: 40 },
	});
	assert.deepEqual(renderFooter(full, theme, 100), renderFooter(full, theme, 100, {}, {}));
});

test("icons: none on prefixed segments drops the glyph and its trailing space", () => {
	const usage = createUsageTotals();
	usage.input = 1000;
	usage.output = 2000;
	usage.cost = 0.5;
	const lines = renderFooter(
		data({
			model: { provider: "anthropic", id: "claude", reasoning: true },
			thinkingLevel: "high",
			usage,
			branch: "main",
			cwd: "/home/tester/proj",
		}),
		theme,
		100,
		{},
		{ model: "none", thinking: "none", path: "none", tokens: "none", cost: "none", branch: "none" },
	);
	const l1 = strip(lines[0]);
	assert.ok(l1.startsWith("anthropic/claude • high • "), l1); // glyphs gone, single-space joins
	assert.ok(!l1.includes("🤖"), l1);
	assert.ok(!l1.includes("💭"), l1);
	assert.ok(!l1.includes("📁"), l1);
	assert.ok(l1.includes("~/proj"), l1);
	const l2 = strip(lines[1]);
	assert.ok(l2.startsWith("↑1.0k ↓2.0k • $0.5000"), l2); // "💬 ↑1k ↓2k" → "↑1k ↓2k"
	assert.ok(!l2.includes("💬"), l2);
	assert.ok(!l2.includes("💸"), l2);
	assert.ok(!l2.includes("🌿"), l2);
	assert.ok(l2.trimEnd().endsWith("main"), l2); // "🌿 main" → "main" right-aligned
	// no dangling separators where glyphs were dropped
	assert.ok(!l1.includes("•  •"), l1);
	assert.ok(!l2.includes("•  •"), l2);
});

test("icons: none on the standalone context bucket keeps the bar and percent", () => {
	const lines = renderFooter(data({ context: { percent: 33.33, window: 100000 } }), theme, 100, {}, { context: "none" });
	const l1 = strip(lines[0]);
	assert.ok(!l1.includes("🪣"), l1);
	// bar and percent stay one unit, joined with a single space to the model segment
	assert.ok(l1.includes(" • [▓▓▓▓▓▓▓░░░░░░░░░░░░░] 33.3%/100k "), l1);
});

test("icons: none on the compact razor drops it entirely", () => {
	const withRazor = renderFooter(data({ autoCompact: true }), theme, 100, {}, { context: "none", compact: "none" });
	const l1 = strip(withRazor[0]);
	assert.ok(!l1.includes("🪒"), l1);
	// L1 ends at the percent text — no orphan glyph or separator after it
	assert.ok(l1.includes("] 0.0%/100k  "), l1); // only the layout padding follows
});

test("icons: none on experimental drops the warning segment entirely", () => {
	const usage = createUsageTotals();
	usage.input = 100;
	const lines = renderFooter(data({ experimental: true, usage }), theme, 100, {}, { experimental: "none" });
	assert.ok(!strip(lines[1]).includes("🧪"));
	assert.ok(strip(lines[1]).includes("↑100")); // other segments intact
	// experimental alone: L2 disappears entirely instead of rendering a blank line
	const alone = renderFooter(data({ experimental: true }), theme, 100, {}, { experimental: "none" });
	assert.equal(alone.length, 1);
});

test("icons: custom glyphs render in place of the defaults", () => {
	const usage = createUsageTotals();
	usage.input = 100;
	const lines = renderFooter(
		data({
			model: { provider: "anthropic", id: "claude", reasoning: true },
			thinkingLevel: "high",
			usage,
			branch: "main",
			autoCompact: true,
			experimental: true,
		}),
		theme,
		100,
		{},
		{ model: "❯", thinking: "~", context: "◔", compact: "↻", path: "»", tokens: "⇅", cache: "⇄", cost: "¤", experimental: "⚠", branch: "⑂" },
	);
	const l1 = strip(lines[0]);
	assert.ok(l1.includes("❯ anthropic/claude"), l1);
	assert.ok(l1.includes("~ high"), l1);
	assert.ok(l1.includes("◔ ["), l1);
	assert.ok(l1.includes(" 0.0%/100k ↻ "), l1);
	assert.ok(l1.includes("» ~/proj"), l1);
	const l2 = strip(lines[1]);
	assert.ok(l2.includes("⇅ ↑100"), l2);
	assert.ok(l2.includes("⚠"), l2);
	assert.ok(l2.includes("⑂ main"), l2);
});

test("icons: cost none keeps 'sub' text for subscriptions", () => {
	const lines = renderFooter(data({ subscription: true }), theme, 100, {}, { cost: "none" });
	const l2 = strip(lines[1]);
	assert.ok(l2.trim().startsWith("sub"), l2);
	assert.ok(!l2.includes("💸"), l2);
});

test("icons: junk values fall back to the default emoji per-role", () => {
	const lines = renderFooter(data({ branch: "main" }), theme, 100, {}, { model: 42, path: "—————", branch: "\n" });
	const l1 = strip(lines[0]);
	assert.ok(l1.includes("🤖 no model"), l1);
	assert.ok(l1.includes("📁 ~/proj"), l1);
	const l2 = strip(lines[1]);
	assert.ok(l2.includes("🌿 main"), l2); // junk branch value → default glyph
});

test("icons: none respects thinking-level colors on styled segments", () => {
	const lines = renderFooter(
		data({ model: { provider: "anthropic", id: "claude", reasoning: true }, thinkingLevel: "high" }),
		theme,
		100,
		{},
		{ model: "none" },
	);
	assert.ok(lines[0].includes(styled("thinkingHigh", "anthropic/claude")), lines[0]);
});
