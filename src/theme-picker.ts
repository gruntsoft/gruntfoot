import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, SelectItem, SelectListTheme, TUI } from "@earendil-works/pi-tui";
import { Input, SelectList, truncateToWidth } from "@earendil-works/pi-tui";
import type { ThemeLike } from "./colors.ts";
import { normalizeThemeName } from "./themes.ts";

/**
 * Theme picker for `ctx.ui.custom` (tui.md Pattern 1), mirroring ColorPicker's
 * structure: a screen machine — menu (save/load) → save-name input →
 * overwrite confirmation → load list. Esc backs out one level; enter applies.
 *
 * Save: the typed name is validated + normalized (`Neon Pi` → `neon-pi`);
 * when `<name>.json` already exists an Overwrite/Cancel confirmation screen
 * is shown first, and Cancel aborts with an error notification. Load: the
 * saved theme names are listed with type-to-filter; enter replaces the whole
 * colors config (no merging).
 *
 * The picker is built as a thin component over pure pieces; the TUI-only
 * behavior is covered by the README manual checklist.
 */

export interface ThemePickerDeps {
	/** Theme names available to load (defensive: empty on failure). */
	listThemes(): string[];
	/** Whether `<name>.json` already exists (drives the overwrite confirmation). */
	themeExists(name: string): boolean;
	/** Persist the current colors under `name`; `overwrite` bypasses the exists check. */
	save(name: string, overwrite: boolean): { ok: boolean; reason?: string };
	/** Called after a successful save (notify + re-render). */
	onSaved(name: string): void;
	/** Called when the user picks a theme to load (notify + apply + re-render). */
	onLoaded(name: string): void;
	/** Show a transient error notification (invalid name, declined overwrite, …). */
	notifyError(message: string): void;
}

/** Where the picker starts: the menu, or pre-targeted at save/load. */
export type ThemePickerTarget = "menu" | "save" | "load";

type Screen = "menu" | "saveName" | "confirm" | "load";

const MENU_ITEMS: SelectItem[] = [
	{ value: "save", label: "save theme", description: "snapshot the current colors as themes/<name>.json" },
	{ value: "load", label: "load theme", description: "replace all colors with a saved theme" },
];

const CONFIRM_ITEMS: SelectItem[] = [
	{ value: "overwrite", label: "Overwrite", description: "replace the existing theme file" },
	{ value: "cancel", label: "Cancel", description: "keep the existing theme" },
];

export class ThemePicker implements Component {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly keybindings: KeybindingsManager;
	private readonly deps: ThemePickerDeps;
	private readonly onCancel: () => void;

	private screen: Screen = "menu";
	private filter = "";
	/** Normalized name awaiting the overwrite confirmation. */
	private pendingName = "";
	/** Last raw name typed (restored on the save screen after a declined overwrite). */
	private nameDraft = "";

	private menuList: SelectList | undefined;
	private confirmList: SelectList | undefined;
	private loadList: SelectList | undefined;
	private nameInput: Input | undefined;

	constructor(
		tui: TUI,
		theme: Theme,
		keybindings: KeybindingsManager,
		deps: ThemePickerDeps,
		onCancel?: () => void,
		initial: ThemePickerTarget = "menu",
	) {
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
		this.deps = deps;
		this.onCancel = onCancel ?? (() => {});
		if (initial === "save") this.screen = "saveName";
		else if (initial === "load") this.screen = "load";
		this.rebuildForScreen();
	}

	// -----------------------------------------------------------------------
	// Screen transitions
	// -----------------------------------------------------------------------

	private rebuildForScreen(): void {
		switch (this.screen) {
			case "menu":
				this.rebuildMenu();
				break;
			case "saveName":
				this.rebuildSaveName();
				break;
			case "confirm":
				this.rebuildConfirm();
				break;
			case "load":
				this.rebuildLoad();
				break;
		}
	}

	private rebuildMenu(): void {
		const list = new SelectList(MENU_ITEMS, MENU_ITEMS.length, selectListTheme(this.theme));
		list.onSelect = (item) => this.handleMenuSelect(item);
		this.menuList = list;
	}

	private rebuildSaveName(): void {
		const input = new Input();
		if (this.nameDraft !== "") input.setValue(this.nameDraft);
		input.onSubmit = (value) => this.handleNameSubmit(value);
		input.onEscape = () => {
			this.showMenu();
			this.tui.requestRender();
		};
		this.nameInput = input;
	}

	private rebuildConfirm(): void {
		const list = new SelectList(CONFIRM_ITEMS, CONFIRM_ITEMS.length, selectListTheme(this.theme));
		list.onSelect = (item) => this.handleConfirmSelect(item);
		this.confirmList = list;
	}

	private rebuildLoad(): void {
		const names = this.deps.listThemes();
		const items: SelectItem[] = names.map((name) => ({
			value: name,
			label: name,
			description: "replace all colors with this theme",
		}));
		if (items.length === 0) {
			this.loadList = undefined;
		} else {
			const list = new SelectList(items, Math.min(items.length, 10), selectListTheme(this.theme));
			list.onSelect = (item) => this.handleLoadSelect(item);
			this.loadList = list;
		}
	}

	private showMenu(): void {
		this.screen = "menu";
		this.filter = "";
		this.pendingName = "";
		this.confirmList = undefined;
		this.loadList = undefined;
		this.nameInput = undefined;
		this.rebuildMenu();
	}

	private showSaveName(): void {
		this.screen = "saveName";
		this.filter = "";
		this.pendingName = "";
		this.confirmList = undefined;
		this.rebuildSaveName();
	}

	private showConfirm(name: string): void {
		this.screen = "confirm";
		this.pendingName = name;
		this.filter = "";
		this.rebuildConfirm();
	}

	private showLoad(): void {
		this.screen = "load";
		this.filter = "";
		this.nameInput = undefined;
		this.rebuildLoad();
	}

	private handleMenuSelect(item: SelectItem): void {
		if (item.value === "save") {
			this.nameDraft = "";
			this.showSaveName();
		} else {
			this.showLoad();
		}
		this.tui.requestRender();
	}

	private handleNameSubmit(value: string): void {
		const trimmed = value.trim();
		if (trimmed === "") {
			this.deps.notifyError("enter a theme name");
			this.tui.requestRender();
			return;
		}
		const normalized = normalizeThemeName(trimmed);
		if (normalized === "") {
			this.deps.notifyError(`invalid theme name: ${trimmed}`);
			this.tui.requestRender();
			return;
		}
		this.nameDraft = trimmed;
		if (this.deps.themeExists(normalized)) {
			this.showConfirm(normalized);
		} else {
			this.doSave(normalized, false);
		}
		this.tui.requestRender();
	}

	private doSave(name: string, overwrite: boolean): void {
		const { ok, reason } = this.deps.save(name, overwrite);
		if (ok) {
			this.deps.onSaved(name);
			this.showMenu();
		} else {
			this.deps.notifyError(`could not save theme ${name} (${reason})`);
		}
	}

	private handleConfirmSelect(item: SelectItem): void {
		if (item.value === "overwrite") {
			this.doSave(this.pendingName, true);
		} else {
			this.deps.notifyError(`theme ${this.pendingName} not saved (overwrite declined)`);
			this.showSaveName();
		}
		this.tui.requestRender();
	}

	private handleLoadSelect(item: SelectItem): void {
		this.deps.onLoaded(item.value);
		this.showMenu();
		this.tui.requestRender();
	}

	// -----------------------------------------------------------------------
	// Input
	// -----------------------------------------------------------------------

	handleInput(data: string): void {
		if (this.screen === "saveName") {
			this.nameInput?.handleInput(data);
			this.tui.requestRender();
			return;
		}

		const kb = this.keybindings;

		// Esc / ctrl+c: back out one level — confirm → save name, load → menu,
		// menu → cancel the picker. Matched through the keybindings manager
		// because terminals with the Kitty keyboard protocol report Esc as a
		// CSI-u sequence, not raw \x1b.
		if (kb.matches(data, "tui.select.cancel")) {
			if (this.screen === "confirm") {
				this.showSaveName();
			} else if (this.screen === "load") {
				this.showMenu();
			} else {
				this.onCancel();
			}
			this.tui.requestRender();
			return;
		}

		// Backspace: delete the last filter char; with no filter there is
		// nothing to reset on these screens (no-op). Matched through the
		// keybindings manager plus raw DEL/BS as a fallback.
		if (kb.matches(data, "tui.editor.deleteCharBackward") || data === "\x7f" || data === "\b") {
			if (this.filter !== "") {
				this.filter = this.filter.slice(0, -1);
				this.currentList()?.setFilter(this.filter);
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
		switch (this.screen) {
			case "menu":
				return this.menuList;
			case "confirm":
				return this.confirmList;
			case "load":
				return this.loadList;
			default:
				return undefined;
		}
	}

	// -----------------------------------------------------------------------
	// Rendering
	// -----------------------------------------------------------------------

	invalidate(): void {
		this.menuList?.invalidate();
		this.confirmList?.invalidate();
		this.loadList?.invalidate();
		this.nameInput?.invalidate();
	}

	render(width: number): string[] {
		const lines: string[] = [];
		lines.push(this.theme.fg("accent", "─".repeat(Math.max(1, width))));
		lines.push(` ${this.theme.fg("accent", this.theme.bold(this.title()))}`);
		const help = this.helpLine();
		if (help !== undefined) {
			lines.push(` ${this.theme.fg("muted", truncateToWidth(help, Math.max(0, width - 2), ""))}`);
		}
		if (this.screen === "saveName") {
			if (this.nameInput) lines.push(...this.nameInput.render(width));
		} else {
			const list = this.currentList();
			if (list) {
				lines.push(...list.render(width));
			} else if (this.screen === "load") {
				lines.push(` ${this.theme.fg("muted", "no themes saved yet — save one first")}`);
			}
		}
		lines.push(` ${this.theme.fg("dim", this.hints())}`);
		lines.push(this.theme.fg("accent", "─".repeat(Math.max(1, width))));
		return lines;
	}

	private title(): string {
		switch (this.screen) {
			case "menu":
				return "gruntfoot themes";
			case "saveName":
				return "Save theme";
			case "confirm":
				return `Overwrite theme "${this.pendingName}"?`;
			case "load":
				return "Load theme";
		}
	}

	private helpLine(): string | undefined {
		switch (this.screen) {
			case "saveName":
				return "name is normalized: Neon Pi → neon-pi";
			case "load":
				return "replaces all colors — no merging";
			default:
				return undefined;
		}
	}

	private hints(): string {
		switch (this.screen) {
			case "menu":
				return "↑↓ navigate • enter select • esc close";
			case "saveName":
				return "enter save • esc back";
			case "confirm":
				return "↑↓ navigate • enter select • esc back";
			case "load":
				return "↑↓ navigate • enter load • esc back";
		}
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
