import type { ThemeColor } from "@earendil-works/pi-coding-agent";

/**
 * Configurable color roles for gruntfoot.
 *
 * Every role accepts `auto` (theme-derived default), any pi fg theme token
 * name, a `#RRGGBB` / `#RGB` hex value, or a plain 0–255 ANSI-256 index.
 * Raw colors are emitted by our own ANSI styler (hex downconverted to the
 * nearest xterm-256 index on 256-color terminals) so they deliberately bypass
 * pi theme limits; `/gruntfoot color-reset` is the sanctioned way back.
 *
 * Resolution is a pure layer: `resolveColors` produces a resolved value per
 * role with no `auto` left, keeping footer/editor render code dumb. The
 * model/thinking roles resolve to `undefined` for `auto` — their fallback is
 * the per-frame thinking-level logic in footer.ts, which needs
 * `data.thinkingLevel`.
 */

// ---------------------------------------------------------------------------
// Role registry
// ---------------------------------------------------------------------------

export const COLOR_ROLES = [
	"separator",
	"chip",
	"base",
	"model",
	"thinking",
	"context-low",
	"context-medium",
	"context-high",
	"path",
	"usage",
	"branch",
] as const;

export type ColorRole = (typeof COLOR_ROLES)[number];

export interface ColorRoleInfo {
	/** Human-readable label for the picker. */
	label: string;
	/** Picker description when the role resolves to its default. */
	autoDescription: string;
}

export const COLOR_ROLE_INFO: Record<ColorRole, ColorRoleInfo> = {
	separator: { label: "Editor separator", autoDescription: "auto → borderAccent" },
	chip: { label: "Session-name chip", autoDescription: "auto → separator" },
	base: { label: "Footer base text", autoDescription: "auto → muted" },
	model: { label: "Model segment", autoDescription: "auto → thinking-level color" },
	thinking: { label: "Thinking segment", autoDescription: "auto → thinking-level color" },
	"context-low": { label: "Context bar (low)", autoDescription: "auto → success" },
	"context-medium": { label: "Context bar (medium)", autoDescription: "auto → warning" },
	"context-high": { label: "Context bar (high)", autoDescription: "auto → error" },
	path: { label: "Path (cwd)", autoDescription: "auto → base" },
	usage: { label: "Usage stats", autoDescription: "auto → base" },
	branch: { label: "Git branch", autoDescription: "auto → base" },
};

/** All pi fg theme token names offered by the picker (mirrors the ThemeColor union). */
export const THEME_COLOR_TOKENS = [
	"accent",
	"border",
	"borderAccent",
	"borderMuted",
	"success",
	"error",
	"warning",
	"muted",
	"dim",
	"text",
	"thinkingText",
	"searchMatchText",
	"userMessageText",
	"customMessageText",
	"customMessageLabel",
	"toolTitle",
	"toolOutput",
	"mdHeading",
	"mdLink",
	"mdLinkUrl",
	"mdCode",
	"mdCodeBlock",
	"mdCodeBlockBorder",
	"mdQuote",
	"mdQuoteBorder",
	"mdHr",
	"mdListBullet",
	"toolDiffAdded",
	"toolDiffRemoved",
	"toolDiffContext",
	"syntaxComment",
	"syntaxKeyword",
	"syntaxFunction",
	"syntaxVariable",
	"syntaxString",
	"syntaxNumber",
	"syntaxType",
	"syntaxOperator",
	"syntaxPunctuation",
	"thinkingOff",
	"thinkingMinimal",
	"thinkingLow",
	"thinkingMedium",
	"thinkingHigh",
	"thinkingXhigh",
	"thinkingMax",
	"bashMode",
] as const satisfies readonly ThemeColor[];

const THEME_COLOR_TOKEN_SET = new Set<string>(THEME_COLOR_TOKENS);

// ---------------------------------------------------------------------------
// Value parsing
// ---------------------------------------------------------------------------

export type ParsedColor =
	| { kind: "auto" }
	| { kind: "token"; token: ThemeColor }
	| { kind: "hex"; hex: string; r: number; g: number; b: number }
	| { kind: "index"; index: number };

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const INTEGER_RE = /^\d+$/;

/**
 * Validate a color value from settings / CLI: `auto`, a pi fg token name,
 * `#RRGGBB` / `#RGB` hex, or an integer 0–255 (ANSI-256 index, as string or
 * number). Returns the parsed value, or undefined for junk.
 */
export function parseColorValue(input: unknown): ParsedColor | undefined {
	if (typeof input === "string") {
		const trimmed = input.trim();
		if (trimmed === "") return undefined;
		if (trimmed === "auto") return { kind: "auto" };
		const hexMatch = HEX_RE.exec(trimmed);
		if (hexMatch) {
			let hex = hexMatch[1];
			if (hex.length === 3) {
				hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
			}
			const r = parseInt(hex.slice(0, 2), 16);
			const g = parseInt(hex.slice(2, 4), 16);
			const b = parseInt(hex.slice(4, 6), 16);
			return { kind: "hex", hex: `#${hex.toLowerCase()}`, r, g, b };
		}
		if (INTEGER_RE.test(trimmed)) {
			const index = Number(trimmed);
			if (index <= 255) return { kind: "index", index };
		}
		if (THEME_COLOR_TOKEN_SET.has(trimmed)) {
			return { kind: "token", token: trimmed as ThemeColor };
		}
		return undefined;
	}
	if (typeof input === "number") {
		if (Number.isInteger(input) && input >= 0 && input <= 255) {
			return { kind: "index", index: input };
		}
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Resolution (auto chains)
// ---------------------------------------------------------------------------

/** A fully resolved color: either a theme token or a raw hex/index value. */
export type ResolvedColor =
	| { kind: "token"; token: ThemeColor }
	| { kind: "hex"; hex: string; r: number; g: number; b: number }
	| { kind: "index"; index: number };

export interface ResolvedColors {
	separator: ResolvedColor;
	chip: ResolvedColor;
	base: ResolvedColor;
	/** undefined = the thinking-level color logic applies (footer.ts). */
	model: ResolvedColor | undefined;
	thinking: ResolvedColor | undefined;
	contextLow: ResolvedColor;
	contextMedium: ResolvedColor;
	contextHigh: ResolvedColor;
	path: ResolvedColor;
	usage: ResolvedColor;
	branch: ResolvedColor;
}

/** Raw color configuration as read from settings (role → value as written). */
export type ColorConfig = Partial<Record<ColorRole, unknown>>;

const token = (name: ThemeColor): ResolvedColor => ({ kind: "token", token: name });

/** Parse one role's config entry; junk and `auto` both mean "use the default". */
function resolveRole(config: ColorConfig, role: ColorRole): ResolvedColor | undefined {
	const parsed = parseColorValue(config[role]);
	return parsed === undefined || parsed.kind === "auto" ? undefined : parsed;
}

/**
 * Resolve every role against the auto chains:
 * separator → borderAccent; chip → separator; base → muted; model/thinking →
 * thinking-level logic (undefined); context-low/medium/high → success/warning/
 * error; path/usage/branch → base.
 */
export function resolveColors(config: ColorConfig = {}): ResolvedColors {
	const separator = resolveRole(config, "separator") ?? token("borderAccent");
	const base = resolveRole(config, "base") ?? token("muted");
	return {
		separator,
		chip: resolveRole(config, "chip") ?? separator,
		base,
		model: resolveRole(config, "model"),
		thinking: resolveRole(config, "thinking"),
		contextLow: resolveRole(config, "context-low") ?? token("success"),
		contextMedium: resolveRole(config, "context-medium") ?? token("warning"),
		contextHigh: resolveRole(config, "context-high") ?? token("error"),
		path: resolveRole(config, "path") ?? base,
		usage: resolveRole(config, "usage") ?? base,
		branch: resolveRole(config, "branch") ?? base,
	};
}

/** Map a role id to its resolved value (for descriptions). */
export function resolvedForRole(resolved: ResolvedColors, role: ColorRole): ResolvedColor | undefined {
	switch (role) {
		case "separator":
			return resolved.separator;
		case "chip":
			return resolved.chip;
		case "base":
			return resolved.base;
		case "model":
			return resolved.model;
		case "thinking":
			return resolved.thinking;
		case "context-low":
			return resolved.contextLow;
		case "context-medium":
			return resolved.contextMedium;
		case "context-high":
			return resolved.contextHigh;
		case "path":
			return resolved.path;
		case "usage":
			return resolved.usage;
		case "branch":
			return resolved.branch;
	}
}

/** Human-readable form of a resolved color (token name, hex, or index). */
export function describeResolvedColor(color: ResolvedColor): string {
	switch (color.kind) {
		case "token":
			return color.token;
		case "hex":
			return color.hex;
		case "index":
			return String(color.index);
	}
}

/**
 * Picker description for a role's current value: the set value when there is
 * one, otherwise the effective default through the auto chain.
 */
export function roleValueDescription(role: ColorRole, config: ColorConfig, resolved: ResolvedColors): string {
	const parsed = parseColorValue(config[role]);
	if (parsed !== undefined && parsed.kind !== "auto") return String(config[role]);
	const effective = resolvedForRole(resolved, role);
	return effective ? `auto → ${describeResolvedColor(effective)}` : COLOR_ROLE_INFO[role].autoDescription;
}

// ---------------------------------------------------------------------------
// ANSI styling
// ---------------------------------------------------------------------------

/** Minimal theme surface needed for colorizing (the real pi Theme matches). */
export interface ThemeLike {
	fg(color: ThemeColor, text: string): string;
	getColorMode(): "truecolor" | "256color";
}

/** xterm-256 cube values (indices 16–231). */
const XTERM_CUBE_VALUES = [0, 95, 135, 175, 215, 255];

/** Perceptual-ish weighted distance (green dominates, like pi's own theme code). */
function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
	const dr = r1 - r2;
	const dg = g1 - g2;
	const db = b1 - b2;
	return dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
}

/**
 * Nearest xterm-256 index for an RGB color: closest of the 6×6×6 color cube
 * (indices 16–231) and the 24-step grayscale ramp (indices 232–255).
 * Results are memoized per RGB triple (the picker previews and footer
 * re-render frequently; the set of distinct colors is tiny).
 */
const ansi256Cache = new Map<number, number>();

export function rgbToAnsi256(r: number, g: number, b: number): number {
	// Perfect 24-bit packing: r/g/b are 0–255, so no key collisions.
	const key = (r << 16) | (g << 8) | b;
	const cached = ansi256Cache.get(key);
	if (cached !== undefined) return cached;
	let best = 0;
	let bestDistance = Infinity;
	for (let ri = 0; ri < 6; ri++) {
		for (let gi = 0; gi < 6; gi++) {
			for (let bi = 0; bi < 6; bi++) {
				const index = 16 + 36 * ri + 6 * gi + bi;
				const d = colorDistance(r, g, b, XTERM_CUBE_VALUES[ri], XTERM_CUBE_VALUES[gi], XTERM_CUBE_VALUES[bi]);
				if (d < bestDistance) {
					bestDistance = d;
					best = index;
				}
			}
		}
	}
	const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
	const grayIndex = Math.max(0, Math.min(23, Math.round((gray - 8) / 10)));
	const grayValue = 8 + grayIndex * 10;
	const grayDistance = colorDistance(r, g, b, grayValue, grayValue, grayValue);
	if (grayDistance < bestDistance) {
		best = 232 + grayIndex;
	}
	ansi256Cache.set(key, best);
	return best;
}

/**
 * Style text with a resolved color: theme tokens go through `theme.fg`; raw
 * hex/index values go through our own ANSI styler, with hex downconverted to
 * the nearest xterm-256 index when the terminal does not support truecolor.
 * Resets only the foreground (matching pi's Theme.fg), so nested styling
 * (e.g. the inverted chip) keeps working.
 */
export function colorizeText(theme: ThemeLike, color: ResolvedColor, text: string): string {
	switch (color.kind) {
		case "token":
			return theme.fg(color.token, text);
		case "hex":
			if (theme.getColorMode() === "256color") {
				return `\x1b[38;5;${rgbToAnsi256(color.r, color.g, color.b)}m${text}\x1b[39m`;
			}
			return `\x1b[38;2;${color.r};${color.g};${color.b}m${text}\x1b[39m`;
		case "index":
			return `\x1b[38;5;${color.index}m${text}\x1b[39m`;
	}
}
