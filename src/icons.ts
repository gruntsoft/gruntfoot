import { visibleWidth } from "@earendil-works/pi-tui";

/**
 * Configurable icon roles for gruntfoot.
 *
 * Every role accepts `auto` (the default emoji), `none` (icon removed), or a
 * custom glyph validated at parse time: trimmed, non-empty, no control
 * characters (C0/C1 — icons are interpolated into a single-line footer, so
 * ANSI escapes or newlines would corrupt rendering), and at most 4 visible
 * columns (protects the one-line footer layout's width math). Junk values are
 * ignored per-role with fallback to the default — never an error at render
 * time.
 *
 * Resolution is a pure layer: `resolveIcons` produces a display string per
 * role with no `auto` left, keeping footer render code dumb. The resolved
 * "no icon" value is `""`, so render code is a simple
 * `icon === "" ? text : \`${icon} ${text}\`` and standalone icon parts are
 * filtered when empty (no double spaces or orphan separators).
 *
 * The width check uses pi-tui's `visibleWidth` — the exact function the
 * footer layout uses — so a glyph accepted here is guaranteed to measure
 * within the cap at render time.
 */

// ---------------------------------------------------------------------------
// Role registry
// ---------------------------------------------------------------------------

export const ICON_ROLES = [
	"model",
	"thinking",
	"context",
	"compact",
	"path",
	"tokens",
	"cache",
	"cost",
	"experimental",
	"branch",
] as const;

export type IconRole = (typeof ICON_ROLES)[number];

export interface IconRoleInfo {
	/** Human-readable label for the picker. */
	label: string;
}

export const ICON_ROLE_INFO: Record<IconRole, IconRoleInfo> = {
	model: { label: "Model segment" },
	thinking: { label: "Thinking segment" },
	context: { label: "Context bucket" },
	compact: { label: "Auto-compact razor" },
	path: { label: "Path (cwd)" },
	tokens: { label: "Token usage" },
	cache: { label: "Cache stats" },
	cost: { label: "Session cost" },
	experimental: { label: "Experimental mode" },
	branch: { label: "Git branch" },
};

/** The default emoji per role (what `auto` resolves to). */
export const DEFAULT_ICONS: Record<IconRole, string> = {
	model: "🤖",
	thinking: "💭",
	context: "🪣",
	compact: "🪒",
	path: "📁",
	tokens: "💬",
	cache: "📦",
	cost: "💸",
	experimental: "🧪",
	branch: "🌿",
};

/**
 * Curated suggestion glyphs per role, shared by the picker's value list and
 * command autocomplete — discovery without a free-form-only UX. Every entry
 * passes `parseIconValue` (kept within the 4-column cap; each is 1–2 columns).
 */
export const ICON_SUGGESTIONS: Record<IconRole, readonly string[]> = {
	model: ["🤖", "⚡", "✦", "❯", "◆"],
	thinking: ["💭", "🧠", "✎", "~", "✦"],
	context: ["🪣", "📊", "◔", "⏳", "▰"],
	compact: ["🪒", "✂", "↻", "⤿", "⟳"],
	path: ["📁", "📂", "🏠", "~", "»"],
	tokens: ["💬", "⇅", "⌁", "✦", "↕"],
	cache: ["📦", "💾", "🗄", "⇄", "⚡"],
	cost: ["💸", "💰", "$", "¤", "¢"],
	experimental: ["🧪", "⚗", "⚠", "✩", "β"],
	branch: ["🌿", "☘", "⑂", "≡", "⎇"],
};

// ---------------------------------------------------------------------------
// Value parsing
// ---------------------------------------------------------------------------

export type ParsedIcon =
	| { kind: "auto" }
	| { kind: "none" }
	| { kind: "custom"; text: string };

/** Maximum visible columns an icon may occupy (parse-time cap). */
export const ICON_MAX_WIDTH = 4;

/** C0 controls (incl. \n, \t, ESC), DEL, and C1 controls — all render-hostile. */
const CONTROL_RE = /[\x00-\x1f\x7f-\x9f]/;

/**
 * Validate an icon value from settings / CLI: `auto`, `none`, or a custom
 * glyph (trimmed, non-empty, no control characters, at most
 * {@link ICON_MAX_WIDTH} visible columns). Returns the parsed value, or
 * undefined for junk.
 */
export function parseIconValue(input: unknown): ParsedIcon | undefined {
	if (typeof input !== "string") return undefined;
	const trimmed = input.trim();
	if (trimmed === "") return undefined;
	if (trimmed === "auto") return { kind: "auto" };
	if (trimmed === "none") return { kind: "none" };
	if (CONTROL_RE.test(trimmed)) return undefined;
	if (visibleWidth(trimmed) > ICON_MAX_WIDTH) return undefined;
	return { kind: "custom", text: trimmed };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Raw icon configuration as read from settings (role → value as written). */
export type IconConfig = Partial<Record<IconRole, unknown>>;

/** Per-role display string: `""` = no icon, otherwise the glyph to render. */
export type ResolvedIcons = Record<IconRole, string>;

/**
 * Resolve every role to its display string: junk/absent/`auto` fall back to
 * the default emoji, `none` resolves to `""` (icon removed), custom glyphs
 * pass through as validated.
 */
export function resolveIcons(config: IconConfig = {}): ResolvedIcons {
	const resolved = {} as ResolvedIcons;
	for (const role of ICON_ROLES) {
		const parsed = parseIconValue(config[role]);
		resolved[role] =
			parsed === undefined || parsed.kind === "auto"
				? DEFAULT_ICONS[role]
				: parsed.kind === "none"
					? ""
					: parsed.text;
	}
	return resolved;
}

/**
 * Picker description for a role's current value: the set glyph, `none`,
 * or the effective default.
 */
export function roleValueDescription(role: IconRole, config: IconConfig): string {
	const parsed = parseIconValue(config[role]);
	if (parsed === undefined || parsed.kind === "auto") return `auto → ${DEFAULT_ICONS[role]}`;
	if (parsed.kind === "none") return "none";
	return parsed.text;
}
