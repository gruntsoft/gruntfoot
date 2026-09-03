import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider, EditorComponent, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { buildBottomBorder, type BorderStyle } from "./border.ts";
import { colorizeText, type ResolvedColor, type ResolvedColors } from "./colors.ts";
import { truncateName } from "./format.ts";

/** Bottom border line shape: either a plain dash run or a scroll indicator. */
const SCROLL_ARROW_RE = /^─── ↓ \d+ more /;

/**
 * Callbacks the app wires onto the active editor (interactive-mode.js) that
 * syncBase mirrors onto a delegated base editor. Derived from CustomEditor's
 * own fields via Pick so a pi rename of any of them becomes a compile error.
 */
type AppWiredCallbacks = Pick<
	CustomEditor,
	"onSubmit" | "onChange" | "onEscape" | "onCtrlD" | "onPasteImage" | "onExtensionShortcut" | "actionHandlers"
>;

/** Copy one app-wired callback from source to target when set. */
function copyCallbackIfSet<K extends keyof AppWiredCallbacks>(
	source: AppWiredCallbacks,
	target: AppWiredCallbacks,
	key: K,
): void {
	const value = source[key];
	if (value !== undefined) target[key] = value;
}

export interface GruntfootEditorOptions {
	/** Previous editor component to delegate to (composition with other extensions). */
	base?: EditorComponent;
	/** Current session name, or undefined for a plain separator. */
	getSessionName?: () => string | undefined;
	/** Live app theme (ctx.ui.theme) for separators and the chip. */
	getTheme?: () => Theme | undefined;
	/** Resolved color values for the separator and chip (from resolveColors). */
	getColors?: () => ResolvedColors;
}

/**
 * Custom editor with static accent separators and a session-name chip on the
 * bottom border.
 *
 * pi reassigns `editor.borderColor` on every thinking-level change and on
 * bash-mode entry (interactive-mode.js). The setter below swallows those
 * assignments — separators stay accent — while pi's internal border rendering
 * (scroll arrows included, which go through `this.borderColor(...)`) keeps
 * working. Bash mode is detected from the editor text (`!` prefix) and falls
 * back to the theme's bash-mode border color.
 *
 * When another extension replaced the editor first, its factory output is
 * captured as `base` and all editor behavior is delegated to it; only the
 * bottom-border chip is overlaid. App-wired callbacks (onSubmit, onChange,
 * escape/exit handlers, action handlers) are mirrored onto the base editor
 * before input is forwarded.
 */
export class GruntfootEditor extends CustomEditor {
	private readonly options: GruntfootEditorOptions;
	/** Recorded border color assignments from pi (swallowed, not used for rendering). */
	private storedBorderColor: ((str: string) => string) | undefined;
	/**
	 * Runtime accessor installed per instance in the constructor (see below).
	 * pi's borderColor assignments are swallowed; rendering uses getBorderColor().
	 */
	declare borderColor: (str: string) => string;

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, options: GruntfootEditorOptions = {}) {
		super(tui, theme, keybindings);
		this.options = options;
		// pi-tui's Editor declares `borderColor` as a real class field, which
		// shadows any prototype accessor at construction time. Install an own
		// accessor instead (field-defined properties are configurable, so this
		// replaces the base data property). All later pi assignments — thinking
		// level changes, bash-mode entry, editor install — hit the setter below
		// and are swallowed, while render-time reads go through the getter
		// (borderAccent separators, bash-mode passthrough).
		Object.defineProperty(this, "borderColor", {
			configurable: true,
			get: () => this.getBorderColor(),
			set: (value: (str: string) => string) => {
				this.setBorderColor(value);
			},
		});
	}

	/** Border color used for rendering: bash-mode color when the text starts with `!`,
	 * else the user's separator color (resolved), else borderAccent. Bash mode keeps
	 * precedence over user colors. */
	getBorderColor(): (str: string) => string {
		const theme = this.options.getTheme?.();
		if (theme && this.getText().startsWith("!")) {
			return theme.getBashModeBorderColor();
		}
		const colors = this.options.getColors?.();
		if (theme && colors) {
			return (str: string) => colorizeText(theme, colors.separator, str);
		}
		return (str: string) => (theme ? theme.fg("borderAccent", str) : str);
	}

	/** Record pi's border color assignment without letting it affect rendering. */
	setBorderColor(value: (str: string) => string): void {
		this.storedBorderColor = value;
	}

	private get base(): EditorComponent | undefined {
		return this.options.base;
	}

	/**
	 * Mirror app-wired callbacks onto the delegated base editor. The base is
	 * duck-typed (any EditorComponent), so the CustomEditor-specific fields are
	 * accessed through AppWiredCallbacks — renaming any of them in pi now fails
	 * the build instead of silently breaking input handling.
	 */
	private syncBase(): void {
		const base = this.base;
		if (!base) return;
		const source = this as unknown as AppWiredCallbacks;
		const target = base as unknown as AppWiredCallbacks;
		copyCallbackIfSet(source, target, "onSubmit");
		copyCallbackIfSet(source, target, "onChange");
		copyCallbackIfSet(source, target, "onEscape");
		copyCallbackIfSet(source, target, "onCtrlD");
		copyCallbackIfSet(source, target, "onPasteImage");
		copyCallbackIfSet(source, target, "onExtensionShortcut");
		if (source.actionHandlers instanceof Map && target.actionHandlers instanceof Map) {
			target.actionHandlers.clear();
			for (const [action, handler] of source.actionHandlers) {
				target.actionHandlers.set(action, handler);
			}
		}
	}

	override getText(): string {
		return this.base ? this.base.getText() : super.getText();
	}

	override setText(text: string): void {
		if (this.base) {
			this.base.setText(text);
		} else {
			super.setText(text);
		}
	}

	override handleInput(data: string): void {
		if (this.base) {
			this.syncBase();
			this.base.handleInput(data);
			return;
		}
		super.handleInput(data);
	}

	override insertTextAtCursor(text: string): void {
		if (this.base) {
			this.base.insertTextAtCursor?.(text);
			return;
		}
		super.insertTextAtCursor(text);
	}

	override getExpandedText(): string {
		return this.base?.getExpandedText ? this.base.getExpandedText() : super.getExpandedText();
	}

	override addToHistory(text: string): void {
		if (this.base) {
			this.base.addToHistory?.(text);
			return;
		}
		super.addToHistory(text);
	}

	override setAutocompleteProvider(provider: AutocompleteProvider): void {
		super.setAutocompleteProvider(provider);
		this.base?.setAutocompleteProvider?.(provider);
	}

	override setPaddingX(padding: number): void {
		super.setPaddingX(padding);
		this.base?.setPaddingX?.(padding);
	}

	override render(width: number): string[] {
		const lines = this.base ? this.base.render(width) : super.render(width);
		if (lines.length < 2) return lines;

		// The bottom border is the last line that starts with the dash run;
		// autocomplete lines render below it, so scan from the end.
		let borderIndex = -1;
		for (let i = lines.length - 1; i >= 0; i--) {
			if (stripTerminalSequences(lines[i]).startsWith("───")) {
				borderIndex = i;
				break;
			}
		}
		if (borderIndex < 0) return lines;

		const sessionName = this.options.getSessionName?.();
		if (!sessionName) return lines;
		const chipName = truncateName(sessionName);
		if (!chipName) return lines;

		const bottom = lines[borderIndex];
		const match = SCROLL_ARROW_RE.exec(stripTerminalSequences(bottom));
		const arrowText = match ? this.borderColor(match[0]) : null;
		const style: BorderStyle = {
			dash: (text) => this.borderColor(text),
			chip: (text) => this.chipStyle(text),
		};
		const rebuilt = buildBottomBorder(width, arrowText, chipName, style);
		if (rebuilt !== null) lines[borderIndex] = rebuilt;
		return lines;
	}

	private chipStyle(text: string): string {
		const theme = this.options.getTheme?.();
		if (!theme) return text;
		const colors = this.options.getColors?.();
		const color: ResolvedColor = colors ? colors.chip : { kind: "token", token: "borderAccent" };
		return theme.inverse(colorizeText(theme, color, text));
	}
}
