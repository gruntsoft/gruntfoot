import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, SelectItem, SelectListTheme, TUI } from "@earendil-works/pi-tui";
import { Input, SelectList, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	COLOR_ROLES,
	COLOR_ROLE_INFO,
	THEME_COLOR_TOKENS,
	colorizeText,
	parseColorValue,
	resolveColors,
	roleValueDescription,
	type ColorConfig,
	type ColorRole,
	type ResolvedColors,
	type ThemeLike,
} from "./colors.ts";

/**
 * Two-step color picker for `ctx.ui.custom` (tui.md Pattern 1): a role list,
 * then a value list for the chosen role with live color previews. Enter on a
 * value applies + saves and returns to the role list; backspace on the value
 * screen resets the role to `auto`; Esc backs out one level. The `custom…`
 * entry opens a small inline input (pi-tui `Input`) for a hex/index value.
 *
 * The picker is built as pure-ish pieces (`buildRoleItems`, `buildValueItems`,
 * the help-line constant) plus a thin component; the TUI-only behavior is
 * covered by the README manual checklist.
 */

/** Accepted-syntax help line, shown muted at the top of the dialog. */
export const COLOR_HELP_LINE =
	"auto, any pi token name, #RRGGBB / #RGB hex, or a plain number 0–255 (ANSI-256 index)";

export interface ColorPickerDeps {
	/** Current raw color configuration from state. */
	getColors(): ColorConfig;
	/** Apply + persist + re-render (called after a value or `auto` is chosen). */
	apply(role: ColorRole, value: string): void;
	/** Show a transient error notification (invalid custom value). */
	notifyError(message: string): void;
}

/**
 * Role-list items: the label column reads `field-name [Friendly label]` as
 * pure text (no embedded styling — that happens per-row in `renderRoleLabel`),
 * the description column holds the current value. Value styling comes from
 * the roles-list SelectList theme (identity description → default fg); the
 * value screen keeps its own muted callback.
 */
export function buildRoleItems(config: ColorConfig, resolved: ResolvedColors): SelectItem[] {
	return COLOR_ROLES.map((role) => ({
		value: role,
		label: `${role} [${COLOR_ROLE_INFO[role].label}]`,
		description: roleValueDescription(role, config, resolved),
	}));
}

/**
 * `truncatePrimary` hook for the roles list, giving per-row control that
 * embedded codes can't: unselected rows keep the field name at default fg and
 * dim the ` [Friendly label]` suffix; selected rows return the label plain so
 * `selectedText`'s accent override covers the entire line (any embedded reset
 * — even one added by truncation — would cut the accent short mid-row).
 */
export function renderRoleLabel(
	text: string,
	maxWidth: number,
	isSelected: boolean,
	styleSuffix: (text: string) => string,
): string {
	if (isSelected) {
		// Slice instead of truncateToWidth: the latter appends \x1b[0m when it
		// clips, which would end the accent early. Slicing by code units is safe
		// here because visibleWidth was already checked above and role labels are
		// ASCII constants (pinned by the fit test), so width equals length —
		// multi-byte labels would need a grapheme-aware cut instead.
		return visibleWidth(text) <= maxWidth ? text : text.slice(0, maxWidth);
	}
	const at = text.indexOf(" [");
	if (at < 0 || maxWidth <= at) return truncateToWidth(text, maxWidth, "");
	return text.slice(0, at) + truncateToWidth(styleSuffix(text.slice(at)), maxWidth - at, "");
}

/**
 * Value-list items for one role: `auto` first, then every pi token previewed
 * in its own live color (labels carry ANSI; SelectList filters on `value`, so
 * type-to-filter still matches token names), then the `custom…` entry.
 */
export function buildValueItems(theme: ThemeLike, tokens: readonly ThemeColor[] = THEME_COLOR_TOKENS): SelectItem[] {
	const items: SelectItem[] = [
		{ value: "auto", label: "auto", description: "theme default" },
		{ value: "custom", label: "custom…" },
	];
	for (const token of tokens) {
		items.push({ value: token, label: colorizeText(theme, { kind: "token", token }, token) });
	}
	return items;
}

type Screen = "roles" | "values" | "custom";

export class ColorPicker implements Component {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly keybindings: KeybindingsManager;
	private readonly deps: ColorPickerDeps;
	private readonly onCancel: () => void;

	private screen: Screen = "roles";
	private selectedRole: ColorRole = COLOR_ROLES[0];
	private rolesList: SelectList | undefined;
	private valuesList: SelectList | undefined;
	private customInput: Input | undefined;
	private filter = "";

	constructor(
		tui: TUI,
		theme: Theme,
		keybindings: KeybindingsManager,
		deps: ColorPickerDeps,
		onCancel?: () => void,
		initialRole?: ColorRole,
	) {
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
		this.deps = deps;
		this.onCancel = onCancel ?? (() => {});
		if (initialRole !== undefined) {
			this.selectedRole = initialRole;
			this.screen = "values";
		}
		this.rebuildForScreen();
	}

	// -----------------------------------------------------------------------
	// Screen transitions
	// -----------------------------------------------------------------------

	private rebuildForScreen(): void {
		if (this.screen === "custom") {
			this.rebuildCustom();
		} else if (this.screen === "values") {
			this.rebuildValues();
		} else {
			this.rebuildRoles();
		}
	}

	private rebuildRoles(): void {
		const config = this.deps.getColors();
		const items = buildRoleItems(config, resolveColors(config));
		// Widest composed label ("context-medium [Context bar (medium)]") is 37
		// columns; raise the fixed primary column above the 32 default so no
		// label truncates. Value renders at default fg (identity description) —
		// roles list only; the value screen keeps the muted default.
		const listTheme: SelectListTheme = { ...selectListTheme(this.theme), description: (text) => text };
		const list = new SelectList(items, Math.min(items.length, 10), listTheme, {
			maxPrimaryColumnWidth: 40,
			truncatePrimary: ({ text, maxWidth, isSelected }) =>
				renderRoleLabel(text, maxWidth, isSelected, (suffix) => this.theme.fg("dim", suffix)),
		});
		list.onSelect = (item) => this.handleRoleSelect(item);
		this.rolesList = list;
	}

	private rebuildValues(): void {
		const items = buildValueItems(this.theme);
		const list = new SelectList(items, Math.min(items.length, 10), selectListTheme(this.theme));
		list.onSelect = (item) => this.handleValueSelect(item);
		this.valuesList = list;
	}

	private rebuildCustom(): void {
		const input = new Input();
		input.onSubmit = (value) => this.handleCustomSubmit(value);
		input.onEscape = () => {
			this.showValues(this.selectedRole);
			this.tui.requestRender();
		};
		this.customInput = input;
	}

	private showRoles(): void {
		this.screen = "roles";
		this.filter = "";
		this.customInput = undefined;
		this.rebuildRoles();
	}

	private showValues(role: ColorRole): void {
		this.screen = "values";
		this.selectedRole = role;
		this.filter = "";
		this.customInput = undefined;
		this.rebuildValues();
	}

	private showCustom(): void {
		this.screen = "custom";
		this.rebuildCustom();
	}

	private handleRoleSelect(item: SelectItem): void {
		this.showValues(item.value as ColorRole);
		this.tui.requestRender();
	}

	private handleValueSelect(item: SelectItem): void {
		if (item.value === "custom") {
			this.showCustom();
		} else {
			this.applyValue(item.value);
		}
		this.tui.requestRender();
	}

	/** Apply + save, then return to the role list. */
	private applyValue(value: string): void {
		this.deps.apply(this.selectedRole, value);
		this.showRoles();
	}

	private handleCustomSubmit(value: string): void {
		const trimmed = value.trim();
		if (trimmed === "") {
			// Empty input: treat as cancel back to the value list.
			this.showValues(this.selectedRole);
			this.tui.requestRender();
			return;
		}
		if (parseColorValue(trimmed) === undefined) {
			this.deps.notifyError(`invalid color value: "${trimmed}" — ${COLOR_HELP_LINE}`);
			this.tui.requestRender();
			return;
		}
		this.applyValue(trimmed);
		this.tui.requestRender();
	}

	// -----------------------------------------------------------------------
	// Input
	// -----------------------------------------------------------------------

	handleInput(data: string): void {
		if (this.screen === "custom") {
			this.customInput?.handleInput(data);
			this.tui.requestRender();
			return;
		}

		const kb = this.keybindings;

		// Esc / ctrl+c: value screen → role list; role list → cancel the picker.
		// Matched through the keybindings manager because terminals with the
		// Kitty keyboard protocol report Esc as a CSI-u sequence, not raw \x1b.
		if (kb.matches(data, "tui.select.cancel")) {
			if (this.screen === "values") {
				this.showRoles();
			} else {
				this.onCancel();
			}
			this.tui.requestRender();
			return;
		}

		// Backspace: delete the last filter char, or (no filter) reset to auto —
		// on the value screen the current role, on the role screen the selected
		// role. Matched through the keybindings manager (kitty reports Esc and
		// Backspace as CSI-u / legacy bytes), plus raw DEL/BS as a fallback.
		if (kb.matches(data, "tui.editor.deleteCharBackward") || data === "\x7f" || data === "\b") {
			if (this.filter !== "") {
				this.filter = this.filter.slice(0, -1);
				this.currentList()?.setFilter(this.filter);
			} else if (this.screen === "values") {
				this.applyValue("auto");
			} else {
				const selected = this.rolesList?.getSelectedItem();
				if (selected) {
					this.deps.apply(selected.value as ColorRole, "auto");
					this.showRoles(); // refresh the current-value descriptions
				}
			}
			this.tui.requestRender();
			return;
		}

		// Printable characters drive SelectList type-to-filter; everything
		// else (arrows, enter) is forwarded.
		const list = this.currentList();
		if (list) {
			if (data.length === 1 && data.charCodeAt(0) >= 32) {
				this.filter += data;
				list.setFilter(this.filter);
			} else {
				list.handleInput(data);
			}
		}
		this.tui.requestRender();
	}

	private currentList(): SelectList | undefined {
		return this.screen === "values" ? this.valuesList : this.rolesList;
	}

	// -----------------------------------------------------------------------
	// Rendering
	// -----------------------------------------------------------------------

	invalidate(): void {
		this.rolesList?.invalidate();
		this.valuesList?.invalidate();
		this.customInput?.invalidate();
	}

	render(width: number): string[] {
		const lines: string[] = [];
		lines.push(this.theme.fg("accent", "─".repeat(Math.max(1, width))));
		lines.push(` ${this.theme.fg("accent", this.theme.bold(this.title()))}`);
		lines.push(` ${this.theme.fg("muted", truncateToWidth(COLOR_HELP_LINE, Math.max(0, width - 2), ""))}`);
		if (this.screen === "custom") {
			if (this.customInput) lines.push(...this.customInput.render(width));
		} else {
			const list = this.currentList();
			if (list) lines.push(...list.render(width));
		}
		const hints =
			this.screen === "custom"
				? "enter apply • esc back"
				: "↑↓ navigate • enter select • backspace reset to auto • esc back";
		lines.push(` ${this.theme.fg("dim", hints)}`);
		lines.push(this.theme.fg("accent", "─".repeat(Math.max(1, width))));
		return lines;
	}

	private title(): string {
		const label = COLOR_ROLE_INFO[this.selectedRole].label;
		if (this.screen === "roles") return "gruntfoot colors";
		if (this.screen === "values") return `Set color for ${label}`;
		return `Custom color for ${label}`;
	}
}

/** SelectList theme built from the callback theme (Pattern 1, jiti-safe). */
function selectListTheme(theme: ThemeLike): SelectListTheme {
	return {
		selectedPrefix: (t: string) => theme.fg("accent", t),
		selectedText: (t: string) => theme.fg("accent", t),
		description: (t: string) => theme.fg("muted", t),
		scrollInfo: (t: string) => theme.fg("muted", t),
		noMatch: (t: string) => theme.fg("warning", t),
	};
}
