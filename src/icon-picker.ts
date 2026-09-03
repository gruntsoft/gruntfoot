import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, SelectItem, SelectListTheme, TUI } from "@earendil-works/pi-tui";
import { Input, SelectList, truncateToWidth } from "@earendil-works/pi-tui";
import {
	ICON_ROLE_INFO,
	ICON_ROLES,
	ICON_SUGGESTIONS,
	parseIconValue,
	resolveIcons,
	roleValueDescription,
	type IconConfig,
	type IconRole,
} from "./icons.ts";
import { renderRoleLabel } from "./picker.ts";

/**
 * Two-step icon picker for `ctx.ui.custom` (tui.md Pattern 1), mirroring
 * ColorPicker's structure: a role list, then a value list for the chosen
 * role. Enter on a value applies + saves and returns to the role list;
 * backspace on the value screen resets the role to `auto`; backspace on the
 * role screen resets the selected role; Esc backs out one level. The
 * `custom…` entry opens a small inline input (pi-tui `Input`) for a
 * free-form glyph, validated with `parseIconValue`.
 *
 * The picker is built as pure-ish pieces (`buildIconRoleItems`,
 * `buildIconValueItems`, the help-line constant) plus a thin component; the
 * TUI-only behavior is covered by the README manual checklist.
 */

/** Accepted-syntax help line, shown muted at the top of the dialog. */
export const ICON_HELP_LINE = "auto, none, or any glyph up to 4 columns wide";

export interface IconPickerDeps {
	/** Current raw icon configuration from state. */
	getIcons(): IconConfig;
	/** Apply + persist + re-render (called after a value or `auto` is chosen). */
	apply(role: IconRole, value: string): void;
	/** Show a transient error notification (invalid custom value). */
	notifyError(message: string): void;
}

/**
 * Sample segment text previewed after each suggestion glyph, so picking an
 * icon shows how the actual footer segment will read.
 */
export const ICON_SAMPLES: Record<IconRole, string> = {
	model: "provider/model",
	thinking: "high",
	context: "42.0%/100k",
	compact: "auto-compact",
	path: "~/proj",
	tokens: "↑1k ↓2k",
	cache: "R5k CH40.0%",
	cost: "$0.0042",
	experimental: "experimental",
	branch: "main",
};

/**
 * Role-list items: the label column reads `field-name [Friendly label]` as
 * pure text, the description column holds the current value (`auto → 🤖`,
 * `none`, or the custom glyph).
 */
export function buildIconRoleItems(config: IconConfig): SelectItem[] {
	return ICON_ROLES.map((role) => ({
		value: role,
		label: `${role} [${ICON_ROLE_INFO[role].label}]`,
		description: roleValueDescription(role, config),
	}));
}

/**
 * Value-list items for one role: `auto` first, then `none`, then each
 * curated suggestion (label = the glyph, description = a sample segment),
 * then the `custom…` entry.
 */
export function buildIconValueItems(role: IconRole, suggestions: readonly string[] = ICON_SUGGESTIONS[role]): SelectItem[] {
	const items: SelectItem[] = [
		{ value: "auto", label: "auto", description: "default emoji" },
		{ value: "none", label: "none", description: "remove the icon" },
		{ value: "custom", label: "custom…" },
	];
	for (const glyph of suggestions) {
		items.push({ value: glyph, label: glyph, description: `${glyph} ${ICON_SAMPLES[role]}` });
	}
	return items;
}

type Screen = "roles" | "values" | "custom";

export class IconPicker implements Component {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly keybindings: KeybindingsManager;
	private readonly deps: IconPickerDeps;
	private readonly onCancel: () => void;

	private screen: Screen = "roles";
	private selectedRole: IconRole = ICON_ROLES[0];
	private rolesList: SelectList | undefined;
	private valuesList: SelectList | undefined;
	private customInput: Input | undefined;
	private filter = "";

	constructor(
		tui: TUI,
		theme: Theme,
		keybindings: KeybindingsManager,
		deps: IconPickerDeps,
		onCancel?: () => void,
		initialRole?: IconRole,
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
		const items = buildIconRoleItems(this.deps.getIcons());
		// Value renders at default fg (identity description) — roles list only;
		// the value screen keeps the muted default.
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
		const items = buildIconValueItems(this.selectedRole);
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

	private showValues(role: IconRole): void {
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
		this.showValues(item.value as IconRole);
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
		if (parseIconValue(trimmed) === undefined) {
			this.deps.notifyError(`invalid icon value: "${trimmed}" — ${ICON_HELP_LINE}`);
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
					this.deps.apply(selected.value as IconRole, "auto");
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
		lines.push(` ${this.theme.fg("muted", truncateToWidth(ICON_HELP_LINE, Math.max(0, width - 2), ""))}`);
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
		const label = ICON_ROLE_INFO[this.selectedRole].label;
		if (this.screen === "roles") return "gruntfoot icons";
		if (this.screen === "values") return `Set icon for ${label}`;
		return `Custom icon for ${label}`;
	}
}

/** SelectList theme built from the callback theme (Pattern 1, jiti-safe). */
function selectListTheme(theme: Theme): SelectListTheme {
	return {
		selectedPrefix: (t: string) => theme.fg("accent", t),
		selectedText: (t: string) => theme.fg("accent", t),
		description: (t: string) => theme.fg("muted", t),
		scrollInfo: (t: string) => theme.fg("muted", t),
		noMatch: (t: string) => theme.fg("warning", t),
	};
}
