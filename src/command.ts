import { COLOR_ROLES, COLOR_ROLE_INFO, THEME_COLOR_TOKENS, parseColorValue, type ColorRole } from "./colors.ts";
import { ICON_ROLES, ICON_ROLE_INFO, ICON_SUGGESTIONS, parseIconValue, type IconRole } from "./icons.ts";
import { fuzzyFilter } from "@earendil-works/pi-tui";
import { createThemeStore, normalizeThemeName } from "./themes.ts";

/**
 * Pure parsing for the `/gruntfoot color`, `/gruntfoot color-reset`,
 * `/gruntfoot icon`, `/gruntfoot icon-reset`, and `/gruntfoot theme`
 * subcommands, unit-testable without pi.
 */

export type ColorCommand =
	| { kind: "picker"; role: ColorRole | undefined }
	| { kind: "set"; role: ColorRole; value: string }
	| { kind: "reset" }
	| { kind: "icon-picker"; role: IconRole | undefined }
	| { kind: "icon-set"; role: IconRole; value: string }
	| { kind: "icon-reset" }
	| { kind: "theme-menu" }
	| { kind: "theme-save"; name: string | undefined }
	| { kind: "theme-load"; name: string | undefined }
	| { kind: "invalid"; reason: string };

const ROLE_SET = new Set<string>(COLOR_ROLES);
const ICON_ROLE_SET = new Set<string>(ICON_ROLES);

/**
 * Parse the subcommand arguments:
 * - `` / `color` → picker (optionally pre-targeted: `color <role>`)
 * - `color <role> <value>` → set (value validated here)
 * - `color-reset` → reset
 * - `` / `icon` → icon picker (optionally pre-targeted: `icon <role>`)
 * - `icon <role> <value>` → set (value validated here; `auto`/`none`/glyph)
 * - `icon-reset` → reset
 * - `theme` → theme submenu picker; `theme save|load` → picker pre-targeted;
 *   `theme save|load <name>` → direct form (name normalized here)
 * - anything else → invalid with a reason
 */
export function parseColorCommand(args: string): ColorCommand {
	const tokens = args.trim().split(/\s+/).filter((token) => token !== "");
	if (tokens.length === 0) return { kind: "picker", role: undefined };
	const [head, ...rest] = tokens;

	if (head === "color-reset") {
		if (rest.length > 0) return { kind: "invalid", reason: `unexpected argument: ${rest[0]}` };
		return { kind: "reset" };
	}

	if (head === "icon-reset") {
		if (rest.length > 0) return { kind: "invalid", reason: `unexpected argument: ${rest[0]}` };
		return { kind: "icon-reset" };
	}

	if (head === "theme") {
		if (rest.length === 0) return { kind: "theme-menu" };
		const sub = rest[0];
		const nameTokens = rest.slice(1);
		if (sub === "save" || sub === "load") {
			if (nameTokens.length === 0) {
				return sub === "save" ? { kind: "theme-save", name: undefined } : { kind: "theme-load", name: undefined };
			}
			if (nameTokens.length > 1) return { kind: "invalid", reason: `unexpected argument: ${nameTokens[1]}` };
			const name = normalizeThemeName(nameTokens[0]);
			if (name === "") return { kind: "invalid", reason: `invalid theme name: ${nameTokens[0]}` };
			return sub === "save" ? { kind: "theme-save", name } : { kind: "theme-load", name };
		}
		return { kind: "invalid", reason: `unknown theme subcommand: ${sub}` };
	}

	if (head === "color") {
		if (rest.length === 0) return { kind: "picker", role: undefined };
		const role = rest[0];
		if (!ROLE_SET.has(role)) return { kind: "invalid", reason: `unknown color role: ${role}` };
		if (rest.length === 1) return { kind: "picker", role: role as ColorRole };
		const value = rest[1];
		if (rest.length > 2) return { kind: "invalid", reason: `unexpected argument: ${rest[2]}` };
		if (parseColorValue(value) === undefined) {
			return { kind: "invalid", reason: `invalid color value: ${value}` };
		}
		return { kind: "set", role: role as ColorRole, value };
	}

	if (head === "icon") {
		if (rest.length === 0) return { kind: "icon-picker", role: undefined };
		const role = rest[0];
		if (!ICON_ROLE_SET.has(role)) return { kind: "invalid", reason: `unknown icon role: ${role}` };
		if (rest.length === 1) return { kind: "icon-picker", role: role as IconRole };
		const value = rest[1];
		if (rest.length > 2) return { kind: "invalid", reason: `unexpected argument: ${rest[2]}` };
		if (parseIconValue(value) === undefined) {
			return { kind: "invalid", reason: `invalid icon value: ${value}` };
		}
		return { kind: "icon-set", role: role as IconRole, value };
	}

	return { kind: "invalid", reason: `unknown subcommand: ${head}` };
}

// ---------------------------------------------------------------------------
// Argument completions (slash-command autocomplete)
// ---------------------------------------------------------------------------

export interface ColorCompletion {
	value: string;
	label: string;
	description?: string;
}

const SUBCOMMAND_COMPLETIONS: ColorCompletion[] = [
	{ value: "color", label: "color", description: "open the picker, or set /gruntfoot color <role> <value>" },
	{ value: "color-reset", label: "color-reset", description: "reset all colors to theme defaults" },
	{ value: "icon", label: "icon", description: "open the picker, or set /gruntfoot icon <role> <glyph>" },
	{ value: "icon-reset", label: "icon-reset", description: "reset all icons to the default emoji" },
	{ value: "theme", label: "theme", description: "save or load a named color theme" },
];

const THEME_SUBCOMMAND_COMPLETIONS: ColorCompletion[] = [
	{ value: "theme save", label: "save", description: "save the current colors as themes/<name>.json" },
	{ value: "theme load", label: "load", description: "replace all colors with a saved theme" },
];

function roleCompletions(): ColorCompletion[] {
	return COLOR_ROLES.map((role) => ({
		value: `color ${role}`,
		label: role,
		description: COLOR_ROLE_INFO[role].label,
	}));
}

function valueCompletions(role: ColorRole): ColorCompletion[] {
	const prefix = `color ${role} `;
	return [
		{ value: `${prefix}auto`, label: "auto", description: "theme default" },
		...THEME_COLOR_TOKENS.map((token) => ({
			value: `${prefix}${token}`,
			label: token,
			description: "theme token",
		})),
	];
}

function iconRoleCompletions(): ColorCompletion[] {
	return ICON_ROLES.map((role) => ({
		value: `icon ${role}`,
		label: role,
		description: ICON_ROLE_INFO[role].label,
	}));
}

function iconValueCompletions(role: IconRole): ColorCompletion[] {
	const prefix = `icon ${role} `;
	return [
		{ value: `${prefix}auto`, label: "auto", description: "default emoji" },
		{ value: `${prefix}none`, label: "none", description: "remove the icon" },
		...ICON_SUGGESTIONS[role].map((glyph) => ({
			value: `${prefix}${glyph}`,
			label: glyph,
			description: "suggested glyph",
		})),
	];
}

function isRole(text: string): text is ColorRole {
	return ROLE_SET.has(text);
}

function isIconRole(text: string): text is IconRole {
	return ICON_ROLE_SET.has(text);
}

/**
 * Argument completions for `/gruntfoot <args>`, shown after the command name:
 * subcommands first, then roles, then values for a chosen role, then the
 * theme submenu (`save`/`load`, and saved theme names for `load`). The
 * autocomplete layer replaces the whole argument text on apply, so every
 * item carries the full argument text ("color separator dim"). Theme-name
 * listing is injectable for tests and defensive (empty on failure).
 */
export function buildColorCompletions(
	argumentText: string,
	listThemeNames: () => string[] = () => createThemeStore().listThemeNames(),
): ColorCompletion[] | null {
	const hasTrailingSpace = argumentText.endsWith(" ");
	const trimmed = argumentText.trim();
	const parts = trimmed === "" ? [] : trimmed.split(/\s+/);
	const head = parts[0] ?? "";

	// First argument: the subcommand (partial names fuzzy-matched).
	if (
		parts.length === 0 ||
		(parts.length === 1 && head !== "color" && head !== "color-reset" && head !== "icon" && head !== "icon-reset" && head !== "theme")
	) {
		const filtered = fuzzyFilter(SUBCOMMAND_COMPLETIONS, head, (item) => item.value);
		return filtered.length > 0 ? filtered : null;
	}

	// The theme submenu: save/load, then theme names for load.
	if (head === "theme") {
		return themeCompletions(parts, hasTrailingSpace, listThemeNames);
	}

	// The icon submenu: roles, then values for a chosen role.
	if (head === "icon") {
		return iconCompletions(parts, hasTrailingSpace);
	}

	// Complete "color-reset" / "icon-reset" take no arguments.
	if (head === "color-reset" || head === "icon-reset") return null;

	// "color" with nothing after it: the role list (empty filter).
	if (parts.length === 1) {
		return roleCompletions();
	}

	// "color <role…>": roles while incomplete, values once a full role is
	// followed by a space.
	if (parts.length === 2) {
		if (isRole(parts[1]) && hasTrailingSpace) {
			return valueCompletions(parts[1]);
		}
		const filtered = fuzzyFilter(roleCompletions(), parts[1], (item) => item.value);
		return filtered.length > 0 ? filtered : null;
	}

	// "color <role> <value…>": value list for the chosen role.
	if (isRole(parts[1])) {
		const valueText = hasTrailingSpace ? "" : parts[2];
		const filtered = fuzzyFilter(valueCompletions(parts[1]), valueText, (item) => item.value);
		return filtered.length > 0 ? filtered : null;
	}
	return null;
}

/** Completions for the `icon` subcommand: roles, then values for a chosen role. */
function iconCompletions(parts: string[], hasTrailingSpace: boolean): ColorCompletion[] | null {
	// "icon" with nothing after it: the role list (empty filter).
	if (parts.length === 1) {
		return iconRoleCompletions();
	}
	// "icon <role…>": roles while incomplete, values once a full role is
	// followed by a space.
	if (parts.length === 2) {
		if (isIconRole(parts[1]) && hasTrailingSpace) {
			return iconValueCompletions(parts[1]);
		}
		const filtered = fuzzyFilter(iconRoleCompletions(), parts[1], (item) => item.value);
		return filtered.length > 0 ? filtered : null;
	}
	// "icon <role> <value…>": value list for the chosen role.
	if (isIconRole(parts[1])) {
		const valueText = hasTrailingSpace ? "" : parts[2];
		const filtered = fuzzyFilter(iconValueCompletions(parts[1]), valueText, (item) => item.value);
		return filtered.length > 0 ? filtered : null;
	}
	return null;
}

/** Completions for `theme <sub> [<name>…]`: save/load, then theme names for load. */
function themeCompletions(
	parts: string[],
	hasTrailingSpace: boolean,
	listThemeNames: () => string[],
): ColorCompletion[] | null {
	const sub = parts[1] ?? "";
	// Partial or missing subcommand: fuzzy-match save/load.
	if (sub !== "save" && sub !== "load") {
		const filtered = fuzzyFilter(THEME_SUBCOMMAND_COMPLETIONS, sub, (item) => item.value);
		return filtered.length > 0 ? filtered : null;
	}
	// Full subcommand with nothing after it ("theme save" / "theme load").
	if (parts.length === 2 && !hasTrailingSpace) {
		const filtered = fuzzyFilter(THEME_SUBCOMMAND_COMPLETIONS, sub, (item) => item.value);
		return filtered.length > 0 ? filtered : null;
	}
	// "theme save <name…>": free-form name, nothing to complete.
	if (sub === "save") return null;
	// "theme load <name…>": complete against the saved theme names.
	const nameText = hasTrailingSpace ? "" : parts[2] ?? "";
	const items: ColorCompletion[] = listThemeNames().map((name) => ({
		value: `theme load ${name}`,
		label: name,
		description: "saved color theme",
	}));
	const filtered = fuzzyFilter(items, nameText, (item) => item.value);
	return filtered.length > 0 ? filtered : null;
}
