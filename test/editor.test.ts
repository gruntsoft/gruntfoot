import assert from "node:assert/strict";
import { test } from "node:test";
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { EditorComponent, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { KeybindingsManager as RealKeybindingsManager, TUI_KEYBINDINGS, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { GruntfootEditor } from "../src/editor.ts";

function stubKeybindings(): KeybindingsManager {
	return new RealKeybindingsManager(TUI_KEYBINDINGS) as unknown as KeybindingsManager;
}

function stubTui(): TUI {
	return { terminal: { rows: 30 } } as unknown as TUI;
}

function stubEditorTheme(): EditorTheme {
	return { borderColor: (str: string) => str, selectList: {} } as unknown as EditorTheme;
}

function stubTheme(): Theme {
	return {
		fg: (_color: string, text: string) => `\x1b[31m${text}\x1b[0m`,
		inverse: (text: string) => `INV[${text}]`,
		getBashModeBorderColor: () => (str: string) => `BASH[${str}]`,
		getColorMode: () => "truecolor",
	} as unknown as Theme;
}

function makeEditor(options: ConstructorParameters<typeof GruntfootEditor>[3] = {}) {
	return new GruntfootEditor(stubTui(), stubEditorTheme(), stubKeybindings(), {
		getTheme: () => stubTheme(),
		...options,
	});
}

test("borderColor getter returns borderAccent by default", () => {
	const editor = makeEditor({
		getTheme: () => ({ fg: (color: string, text: string) => `[${color}]${text}` }) as unknown as Theme,
	});
	assert.equal(editor.borderColor("x"), "[borderAccent]x");
});

test("borderColor getter falls back to bash-mode color when text starts with !", () => {
	const editor = makeEditor();
	editor.setText("!ls -la");
	assert.equal(editor.borderColor("x"), "BASH[x]");
	editor.setText("ls -la");
	assert.equal(editor.borderColor("x"), "\x1b[31mx\x1b[0m");
});
test("borderColor setter swallows reassignments", () => {
	const editor = makeEditor();
	editor.borderColor = () => "OVERWRITTEN";
	assert.equal(editor.borderColor("x"), "\x1b[31mx\x1b[0m");
});

test("render: plain separator without a session name", () => {
	const editor = makeEditor();
	const lines = editor.render(40);
	const bottom = stripTerminalSequences(lines[lines.length - 1]);
	assert.equal(bottom, "─".repeat(40));
});

test("render: chip appears right-aligned on the bottom border", () => {
	const editor = makeEditor({ getSessionName: () => "my session" });
	const lines = editor.render(40);
	const bottom = stripTerminalSequences(lines[lines.length - 1]);
	assert.ok(bottom.includes("INV[ my session ]"), bottom);
	assert.equal(bottom.length, 40);
});

test("render: chip truncates names longer than 64 chars", () => {
	const editor = makeEditor({ getSessionName: () => "a".repeat(70) });
	const bottom = stripTerminalSequences(editor.render(80)[2]);
	assert.ok(bottom.includes("a".repeat(61) + "..."));
});

test("render: chip coexists with the scroll arrow", () => {
	const editor = makeEditor({ getSessionName: () => "my session" });
	editor.setText(Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n"));
	for (let i = 0; i < 12; i++) editor.handleInput("\x1b[A");
	const lines = editor.render(40);
	const bottom = stripTerminalSequences(lines[lines.length - 1]);
	assert.match(bottom, /^─── ↓ \d+ more /);
	assert.ok(bottom.includes(" my session "));
	assert.equal(visibleWidth(bottom), 40);
});

test("render: chip yields when the terminal is too narrow", () => {
	const editor = makeEditor({ getSessionName: () => "a".repeat(64) });
	editor.setText(Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n"));
	for (let i = 0; i < 12; i++) editor.handleInput("\x1b[A");
	const lines = editor.render(20);
	const bottom = stripTerminalSequences(lines[lines.length - 1]);
	assert.match(bottom, /^─── ↓ \d+ more /);
	assert.ok(!bottom.includes("a"), bottom);
});

test("render: chip lands on the border above autocomplete lines", () => {
	const base = {
		getText: () => "",
		setText: () => {},
		render: (width: number) => ["─".repeat(width), "", "─".repeat(width), "autocomplete item", "another item"],
	} as unknown as EditorComponent;
	const editor = makeEditor({ base, getSessionName: () => "my session" });
	const lines = editor.render(40);
	assert.ok(stripTerminalSequences(lines[2]).includes(" my session "));
	assert.equal(stripTerminalSequences(lines[4]), "another item");
});

test("delegation: text and input are forwarded to the base editor", () => {
	const base = {
		text: "base text",
		getText: () => base.text,
		setText: (t: string) => {
			base.text = t;
		},
		handleInput: (data: string) => {
			base.text += data;
		},
		render: (width: number) => ["─".repeat(width), "", "─".repeat(width)],
	};

	const editor = makeEditor({ base: base as unknown as EditorComponent });
	editor.setText("forwarded");
	assert.equal(editor.getText(), "forwarded");
	editor.handleInput("!");
	assert.equal(editor.getText(), "forwarded!");
	assert.equal(base.text, "forwarded!");
});

test("delegation: chip is overlaid on the base editor's bottom border", () => {
	const base = {
		getText: () => "",
		setText: () => {},
		render: (width: number) => ["─".repeat(width), "", "─".repeat(width)],
	} as unknown as EditorComponent;
	const editor = makeEditor({ base, getSessionName: () => "chip on base" });
	const lines = editor.render(40);
	assert.ok(stripTerminalSequences(lines[2]).includes(" chip on base "));
});

test("delegation: app callbacks are mirrored to the base before input", () => {
	const base = {
		getText: () => "",
		setText: () => {},
		handleInput: function (this: { onSubmit?: (text: string) => void }) {
			this.onSubmit?.("submitted");
		},
		render: (width: number) => ["─".repeat(width), "", "─".repeat(width)],
	} as unknown as EditorComponent;
	const editor = makeEditor({ base });
	const submitted: string[] = [];
	editor.onSubmit = (text: string) => {
		submitted.push(text);
	};
	editor.handleInput("enter");
	assert.deepEqual(submitted, ["submitted"]);
});

test("delegation: actionHandlers are mirrored onto the base before input", () => {
	const baseHandlers = new Map<string, () => void>();
	const base = {
		getText: () => "",
		setText: () => {},
		handleInput: () => {},
		actionHandlers: baseHandlers,
		render: (width: number) => ["─".repeat(width), "", "─".repeat(width)],
	} as unknown as EditorComponent;
	const editor = makeEditor({ base });
	editor.actionHandlers.set("app.interrupt", () => {});
	editor.actionHandlers.set("app.exit", () => {});
	editor.handleInput("enter");
	// the app-wired set replaces the base's handlers, keeping the base in sync
	assert.equal(baseHandlers.has("app.interrupt"), true);
	assert.equal(baseHandlers.has("app.exit"), true);
	assert.equal(baseHandlers.size, editor.actionHandlers.size);
});

test("delegation: undefined app callbacks do not clobber base callbacks", () => {
	const baseCalls: string[] = [];
	const base = {
		getText: () => "",
		setText: () => {},
		handleInput: function (this: { onSubmit?: (text: string) => void }) {
			this.onSubmit?.("base");
		},
		onSubmit: (text: string) => {
			baseCalls.push(text);
		},
		render: (width: number) => ["─".repeat(width), "", "─".repeat(width)],
	} as unknown as EditorComponent;
	const editor = makeEditor({ base });
	// editor.onSubmit stays undefined: syncBase must leave the base's own handler intact
	editor.handleInput("enter");
	assert.deepEqual(baseCalls, ["base"]);
});

// ---------------------------------------------------------------------------
// Configurable separator/chip colors
// ---------------------------------------------------------------------------

import type { ResolvedColors } from "../src/colors.ts";

const resolved = (overrides: Partial<ResolvedColors> = {}): ResolvedColors => ({
	separator: { kind: "token", token: "borderAccent" },
	chip: { kind: "token", token: "borderAccent" },
	base: { kind: "token", token: "muted" },
	model: undefined,
	thinking: undefined,
	contextLow: { kind: "token", token: "success" },
	contextMedium: { kind: "token", token: "warning" },
	contextHigh: { kind: "token", token: "error" },
	path: { kind: "token", token: "muted" },
	usage: { kind: "token", token: "muted" },
	branch: { kind: "token", token: "muted" },
	...overrides,
});

test("borderColor honors the resolved separator color", () => {
	const editor = makeEditor({
		getTheme: () => ({ fg: (color: string, text: string) => `[${color}]${text}`, getColorMode: () => "truecolor" }) as unknown as Theme,
		getColors: () => resolved({ separator: { kind: "token", token: "dim" } }),
	});
	assert.equal(editor.borderColor("x"), "[dim]x");
});

test("borderColor emits raw separator colors through the ANSI styler", () => {
	const editor = makeEditor({
		getTheme: () => ({ fg: (_c: string, t: string) => t, getColorMode: () => "truecolor" }) as unknown as Theme,
		getColors: () => resolved({ separator: { kind: "index", index: 208 } }),
	});
	assert.equal(editor.borderColor("x"), "\x1b[38;5;208mx\x1b[39m");
});

test("bash mode keeps precedence over the user separator color", () => {
	const editor = makeEditor({
		getColors: () => resolved({ separator: { kind: "token", token: "dim" } }),
	});
	editor.setText("!ls");
	assert.equal(editor.borderColor("x"), "BASH[x]");
});

test("chip uses the resolved chip color through inverse()", () => {
	const editor = makeEditor({
		getSessionName: () => "my session",
		getTheme: () => ({
			// real ANSI so the editor's border scan (stripTerminalSequences) finds the border
			fg: (color: string, text: string) => `\x1b[38;5;${color === "dim" ? 240 : 39}m${text}\x1b[39m`,
			inverse: (text: string) => `INV[${text}]`,
			getColorMode: () => "truecolor",
		}) as unknown as Theme,
		getColors: () => resolved({ chip: { kind: "token", token: "dim" } }),
	});
	const lines = editor.render(40);
	const bottom = stripTerminalSequences(lines[lines.length - 1]);
	assert.ok(bottom.includes("INV[ my session ]"), bottom);
	// the chip carries the dim token's ANSI, not borderAccent's
	const raw = lines[lines.length - 1];
	assert.ok(raw.includes("\x1b[38;5;240m my session "), raw);
	assert.ok(!raw.includes("\x1b[38;5;39m my session "), raw);
});

test("chip falls back to borderAccent without getColors", () => {
	const editor = makeEditor({ getSessionName: () => "my session" });
	const lines = editor.render(40);
	assert.ok(lines[lines.length - 1].includes("INV[\x1b[31m my session \x1b[0m]"), lines[lines.length - 1]);
});
