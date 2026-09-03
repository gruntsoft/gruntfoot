import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { EditorComponent, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { KeybindingsManager as RealKeybindingsManager, stripTerminalSequences, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import extensionFactory from "../index.ts";

type Handler = (event: unknown, ctx: unknown) => void | Promise<void>;
type Notification = [message: string, type: "info" | "warning" | "error"];

function stubPi() {
	const handlers = new Map<string, Handler>();
	const commands = new Map<
		string,
		{
			description?: string;
			getArgumentCompletions?: (prefix: string) => { value: string; label?: string; description?: string }[] | null;
			handler: (args: string, ctx: unknown) => Promise<void>;
		}
	>();
	const pi = {
		on: (event: string, handler: Handler) => {
			handlers.set(event, handler);
		},
		registerCommand: (name: string, def: { description?: string; handler: (args: string, ctx: unknown) => Promise<void> }) => {
			commands.set(name, def);
		},
	} as unknown as ExtensionAPI;
	return { pi, handlers, commands };
}

function stubTheme() {
	return {
		fg: (_color: string, text: string) => `\x1b[31m${text}\x1b[0m`,
		inverse: (text: string) => `INV[${text}]`,
		getBashModeBorderColor: () => (str: string) => `BASH[${str}]`,
		getColorMode: () => "truecolor" as const,
	};
}

interface StubUi {
	footer: unknown;
	editorFactory: unknown;
	installedCalls: number;
	clearedCalls: number;
	notifications: Notification[];
	confirmCalls: Array<[title: string, message: string]>;
	confirmResult: boolean;
	customFactory?: (tui: unknown, theme: unknown, keybindings: unknown, done: (result: unknown) => void) => unknown;
	customDone?: (result: unknown) => void;
}

function makeStubUi(): StubUi {
	return {
		footer: undefined,
		editorFactory: undefined,
		installedCalls: 0,
		clearedCalls: 0,
		notifications: [],
		confirmCalls: [],
		confirmResult: true,
	};
}

function makeCtx(projectDir: string, sessionName: string | undefined, ui: StubUi) {
	const footerData = {
		getGitBranch: () => "main",
		getExtensionStatuses: () => new Map(),
		onBranchChange: () => () => {},
	};
	return {
		mode: "tui",
		cwd: projectDir,
		sessionManager: {
			getEntries: () => [],
			getSessionName: () => sessionName,
		},
		model: undefined,
		thinkingLevel: "off",
		getContextUsage: () => undefined,
		modelRegistry: { getProvider: () => undefined, isUsingOAuth: () => false },
		ui: {
			setFooter: (factory: unknown) => {
				ui.footer = factory;
				ui.installedCalls++;
			},
			setEditorComponent: (factory: unknown) => {
				ui.editorFactory = factory;
				ui.clearedCalls++;
			},
			getEditorComponent: () => undefined,
			notify: (message: string, type: "info" | "warning" | "error" = "info") => {
				ui.notifications.push([message, type]);
			},
			confirm: (title: string, message: string) => {
				ui.confirmCalls.push([title, message]);
				return Promise.resolve(ui.confirmResult);
			},
			theme: stubTheme(),
			custom: (factory: (tui: unknown, theme: unknown, keybindings: unknown, done: (result: unknown) => void) => unknown) => {
				ui.customFactory = factory;
				return new Promise((resolve) => {
					ui.customDone = resolve;
				});
			},
		},
		footerData,
	};
}

function sandboxDir(name: string): string {
	const dir = join(tmpdir(), `${name}-${process.pid}`);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	return dir;
}

test("extension is off by default; /gruntfoot wires footer + editor and persists", async () => {
	const { pi, handlers, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-index");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	process.env.PI_EXPERIMENTAL = undefined;
	extensionFactory(pi);

	assert.ok(commands.has("gruntfoot"));
	assert.ok(handlers.has("session_start"));
	assert.ok(handlers.has("session_shutdown"));
	assert.ok(handlers.has("session_info_changed"));

	const ui = makeStubUi();
	const ctx = makeCtx(projectDir, "wiring session", ui);
	const stateFile = join(projectDir, "agent", "gruntfoot", "settings.json");

	// default off: session_start does not install
	handlers.get("session_start")!({ reason: "startup" }, ctx);
	assert.equal(ui.footer, undefined);
	assert.equal(ui.editorFactory, undefined);

	// /gruntfoot enables: installs footer + editor and persists {"enabled": true}
	const command = commands.get("gruntfoot")!;
	await command.handler("", ctx);
	assert.ok(ui.footer !== undefined);
	assert.ok(ui.editorFactory !== undefined);
	assert.deepEqual(JSON.parse(readFileSync(stateFile, "utf8")), { enabled: true });
	assert.deepEqual(ui.notifications.at(-1), ["gruntfoot enabled", "info"]);

	// footer factory renders
	const footerFactory = ui.footer as (
		tui: TUI,
		theme: unknown,
		footerData: unknown,
	) => { render(width: number): string[] };
	const footer = footerFactory({ requestRender: () => {} } as unknown as TUI, stubTheme(), ctx.footerData);
	const lines = footer.render(100);
	assert.ok(lines.length >= 1);
	assert.ok(stripTerminalSequences(lines[0]).includes("🤖 no model"));
	assert.ok(!stripTerminalSequences(lines[0]).includes("🌿"));

	// editor factory produces a GruntfootEditor with a chip
	const editorFactory = ui.editorFactory as (
		tui: TUI,
		theme: EditorTheme,
		keybindings: unknown,
	) => EditorComponent;
	const editor = editorFactory(
		{ terminal: { rows: 30 } } as unknown as TUI,
		{ borderColor: (s: string) => s, selectList: {} } as unknown as EditorTheme,
		{},
	);
	const editorLines = editor.render(60);
	assert.ok(stripTerminalSequences(editorLines[editorLines.length - 1]).includes(" wiring session "));

	// session_info_changed triggers a render request
	let rendered = false;
	const tui = { requestRender: () => (rendered = true) };
	handlers.get("session_info_changed")!(undefined, ctx);
	assert.equal(rendered, false); // no active tui yet (captured via footer factory)
	// capture tui through the footer factory's onTui hook
	const footer2 = footerFactory(tui as unknown as TUI, stubTheme(), ctx.footerData);
	void footer2;
	handlers.get("session_info_changed")!(undefined, ctx);
	assert.equal(rendered, true);

	// session_shutdown restores defaults
	handlers.get("session_shutdown")!({ reason: "quit" }, ctx);
	assert.equal(ui.footer, undefined);
	assert.equal(ui.editorFactory, undefined);

	// /gruntfoot toggles off and persists; a later session_start respects it
	await command.handler("", ctx);
	assert.equal(ui.footer, undefined);
	assert.deepEqual(JSON.parse(readFileSync(stateFile, "utf8")), { enabled: false });
	assert.deepEqual(ui.notifications.at(-1), ["gruntfoot disabled", "info"]);
	handlers.get("session_start")!({ reason: "new" }, ctx);
	assert.equal(ui.footer, undefined); // disabled state is respected
});

test("extension is a silent no-op outside tui mode", () => {
	const { pi, handlers } = stubPi();
	extensionFactory(pi);
	const ui = makeStubUi();
	const ctx = makeCtx("/tmp", undefined, ui);
	ctx.mode = "print";
	handlers.get("session_start")!({ reason: "startup" }, ctx);
	assert.equal(ui.footer, undefined);
	assert.equal(ui.editorFactory, undefined);
});

test("session_start warns when the state file is malformed and leaves it untouched", () => {
	const { pi, handlers } = stubPi();
	const projectDir = sandboxDir("gruntfoot-malformed");
	const stateFile = join(projectDir, "agent", "gruntfoot", "settings.json");
	mkdirSync(dirname(stateFile), { recursive: true });
	writeFileSync(stateFile, "not json");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	process.env.PI_EXPERIMENTAL = undefined;
	extensionFactory(pi);

	const ui = makeStubUi();
	const ctx = makeCtx(projectDir, undefined, ui);

	handlers.get("session_start")!({ reason: "startup" }, ctx);

	// UI stays off; the malformed file is reported and never overwritten
	assert.equal(ui.footer, undefined);
	const warnings = ui.notifications.filter(([, type]) => type === "warning");
	assert.equal(warnings.length, 1);
	assert.ok(warnings[0][0].includes("malformed"));
	assert.equal(readFileSync(stateFile, "utf8"), "not json");
});

// ---------------------------------------------------------------------------
// Color subcommands
// ---------------------------------------------------------------------------

function stubPickerTheme() {
	return {
		fg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		getColorMode: () => "truecolor" as const,
	};
}

test("/gruntfoot color <role> <value> applies, persists, and notifies", async () => {
	const { pi, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-color-set");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	extensionFactory(pi);

	const ui = makeStubUi();
	const ctx = makeCtx(projectDir, undefined, ui);
	const stateFile = join(projectDir, "agent", "gruntfoot", "settings.json");

	// install first so the footer/editor pick up colors
	await commands.get("gruntfoot")!.handler("", ctx);
	await commands.get("gruntfoot")!.handler("color separator dim", ctx);

	assert.deepEqual(JSON.parse(readFileSync(stateFile, "utf8")), { enabled: true, colors: { separator: "dim" } });
	assert.deepEqual(ui.notifications.at(-1), ["gruntfoot: separator set to dim", "info"]);

	// /gruntfoot color model auto stores auto as written
	await commands.get("gruntfoot")!.handler("color model auto", ctx);
	assert.deepEqual(JSON.parse(readFileSync(stateFile, "utf8")), {
		enabled: true,
		colors: { separator: "dim", model: "auto" },
	});
});

test("/gruntfoot color with invalid role or value errors without saving", async () => {
	const { pi, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-color-invalid");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	extensionFactory(pi);

	const ui = makeStubUi();
	const ctx = makeCtx(projectDir, undefined, ui);
	const stateFile = join(projectDir, "agent", "gruntfoot", "settings.json");

	await commands.get("gruntfoot")!.handler("color banana dim", ctx);
	assert.deepEqual(ui.notifications.at(-1), ["gruntfoot: unknown color role: banana", "error"]);

	await commands.get("gruntfoot")!.handler("color separator #12345", ctx);
	assert.deepEqual(ui.notifications.at(-1), ["gruntfoot: invalid color value: #12345", "error"]);

	await commands.get("gruntfoot")!.handler("color separator dim extra", ctx);
	assert.deepEqual(ui.notifications.at(-1), ["gruntfoot: unexpected argument: extra", "error"]);

	assert.equal(existsSync(stateFile), false);
});

test("/gruntfoot color-reset removes only colors from the file and notifies", async () => {
	const { pi, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-color-reset");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	extensionFactory(pi);

	const ui = makeStubUi();
	const ctx = makeCtx(projectDir, undefined, ui);
	const stateFile = join(projectDir, "agent", "gruntfoot", "settings.json");
	mkdirSync(dirname(stateFile), { recursive: true });
	writeFileSync(stateFile, JSON.stringify({ enabled: true, custom: { keep: 1 }, colors: { separator: "dim" } }));

	await commands.get("gruntfoot")!.handler("color-reset", ctx);

	assert.deepEqual(JSON.parse(readFileSync(stateFile, "utf8")), { enabled: true, custom: { keep: 1 } });
	assert.deepEqual(ui.notifications.at(-1), ["gruntfoot: colors reset to theme defaults", "info"]);
});

test("/gruntfoot color <role> <value> works outside tui mode (notify only)", async () => {
	const { pi, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-color-nontui");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	extensionFactory(pi);

	const ui = makeStubUi();
	const ctx = makeCtx(projectDir, undefined, ui);
	ctx.mode = "print";

	await commands.get("gruntfoot")!.handler("color separator dim", ctx);
	const stateFile = join(projectDir, "agent", "gruntfoot", "settings.json");
	assert.deepEqual(JSON.parse(readFileSync(stateFile, "utf8")), { enabled: false, colors: { separator: "dim" } });

	// the picker itself is refused outside tui mode
	await commands.get("gruntfoot")!.handler("color", ctx);
	assert.deepEqual(ui.notifications.at(-1), [
		"gruntfoot: the color picker is only available in TUI mode; use /gruntfoot color <role> <value>",
		"error",
	]);
});

test("/gruntfoot color opens the picker; enter flow applies values and re-renders", async () => {
	const { pi, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-picker");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	extensionFactory(pi);

	const ui = makeStubUi();
	const ctx = makeCtx(projectDir, undefined, ui);
	const stateFile = join(projectDir, "agent", "gruntfoot", "settings.json");

	let renderCount = 0;
	const pickerPromise = commands.get("gruntfoot")!.handler("color", ctx);
	const component = ui.customFactory!(
		{ requestRender: () => renderCount++ },
		stubPickerTheme(),
		new RealKeybindingsManager(TUI_KEYBINDINGS),
		ui.customDone!,
	) as { handleInput(data: string): void; render(width: number): string[] };

	// roles screen → enter picks the first role (separator) → values screen
	component.handleInput("\r");
	// values screen → enter picks the first value (auto)
	component.handleInput("\r");

	// esc on the role list cancels the picker (resolves the custom promise)
	component.handleInput("\x1b");
	await pickerPromise;
	assert.deepEqual(JSON.parse(readFileSync(stateFile, "utf8")), { enabled: false, colors: { separator: "auto" } });
	assert.ok(renderCount > 0);

	// rendering the picker produces the help line
	const lines = component.render(60);
	assert.ok(lines.join("\n").includes("auto, any pi token name"));
});

test("/gruntfoot color <role> opens the picker pre-targeted at that role", async () => {
	const { pi, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-picker-role");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	extensionFactory(pi);

	const ui = makeStubUi();
	const ctx = makeCtx(projectDir, undefined, ui);

	const pickerPromise = commands.get("gruntfoot")!.handler("color chip", ctx);
	const component = ui.customFactory!(
		{ requestRender: () => {} },
		stubPickerTheme(),
		new RealKeybindingsManager(TUI_KEYBINDINGS),
		ui.customDone!,
	) as { handleInput(data: string): void; render(width: number): string[] };

	// pre-targeted: already on the chip value screen; enter applies the first value (auto)
	component.handleInput("\r");
	// esc on the role list cancels the picker (resolves the custom promise)
	component.handleInput("\x1b");
	await pickerPromise;

	const stateFile = join(projectDir, "agent", "gruntfoot", "settings.json");
	assert.deepEqual(JSON.parse(readFileSync(stateFile, "utf8")), { enabled: false, colors: { chip: "auto" } });
});

test("colors flow into the installed footer and editor", async () => {
	const { pi, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-colors-flow");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	extensionFactory(pi);

	const ui = makeStubUi();
	const ctx = makeCtx(projectDir, "flow session", ui);

	await commands.get("gruntfoot")!.handler("", ctx);
	await commands.get("gruntfoot")!.handler("color base #B9D175", ctx);

	// footer renders raw hex for base-colored chrome
	const footerFactory = ui.footer as (tui: TUI, theme: unknown, footerData: unknown) => { render(width: number): string[] };
	const footer = footerFactory({ requestRender: () => {} } as unknown as TUI, stubTheme(), ctx.footerData);
	const lines = footer.render(100);
	assert.ok(stripTerminalSequences(lines[0]).includes("🤖 no model"));
	assert.ok(lines[0].includes("\x1b[38;2;185;209;117m"), lines[0]);

	// editor separator honors the user color (stub theme echoes the token)
	const editorFactory = ui.editorFactory as (
		tui: TUI,
		theme: EditorTheme,
		keybindings: unknown,
	) => EditorComponent;
	const editor = editorFactory(
		{ terminal: { rows: 30 } } as unknown as TUI,
		{ borderColor: (s: string) => s, selectList: {} } as unknown as EditorTheme,
		{},
	);
	await commands.get("gruntfoot")!.handler("color separator dim", ctx);
	const editorLines = editor.render(40);
	const bottom = stripTerminalSequences(editorLines[editorLines.length - 1]);
	// chip rides the separator line; the line stays exactly terminal-width
	assert.ok(bottom.includes(" flow session "), bottom);
	assert.equal(bottom.length, 40);
});

test("/gruntfoot exposes argument completions for the color subcommands", async () => {
	const { pi, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-completions");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	extensionFactory(pi);

	const def = commands.get("gruntfoot")!;
	assert.equal(typeof def.getArgumentCompletions, "function");
	const items = (def.getArgumentCompletions as (prefix: string) => { value: string }[] | null)("");
	assert.deepEqual(items?.map((i) => i.value), ["color", "color-reset", "icon", "icon-reset", "theme"]);
});

test("/gruntfoot icon <role> <glyph> applies, persists alongside colors, and notifies", async () => {
	const { pi, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-icon-set");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	extensionFactory(pi);

	const ui = makeStubUi();
	const ctx = makeCtx(projectDir, undefined, ui);
	const stateFile = join(projectDir, "agent", "gruntfoot", "settings.json");

	await commands.get("gruntfoot")!.handler("", ctx);
	await commands.get("gruntfoot")!.handler("color base dim", ctx);
	await commands.get("gruntfoot")!.handler("icon model ❯", ctx);
	await commands.get("gruntfoot")!.handler("icon branch none", ctx);

	assert.deepEqual(JSON.parse(readFileSync(stateFile, "utf8")), {
		enabled: true,
		colors: { base: "dim" },
		icons: { model: "❯", branch: "none" },
	});
	assert.deepEqual(ui.notifications.at(-1), ["gruntfoot: branch icon set to none", "info"]);

	// icons flow into the installed footer
	const footerFactory = ui.footer as (tui: TUI, theme: unknown, footerData: unknown) => { render(width: number): string[] };
	const footer = footerFactory({ requestRender: () => {} } as unknown as TUI, stubTheme(), ctx.footerData);
	const lines = footer.render(100);
	assert.ok(stripTerminalSequences(lines[0]).includes("❯ no model"), lines[0]);
	assert.ok(!stripTerminalSequences(lines[0]).includes("🤖"), lines[0]);
});

test("/gruntfoot icon with invalid role or value errors without saving", async () => {
	const { pi, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-icon-invalid");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	extensionFactory(pi);

	const ui = makeStubUi();
	const ctx = makeCtx(projectDir, undefined, ui);
	const stateFile = join(projectDir, "agent", "gruntfoot", "settings.json");

	await commands.get("gruntfoot")!.handler("icon banana none", ctx);
	assert.deepEqual(ui.notifications.at(-1), ["gruntfoot: unknown icon role: banana", "error"]);

	await commands.get("gruntfoot")!.handler("icon model —————", ctx);
	assert.deepEqual(ui.notifications.at(-1), ["gruntfoot: invalid icon value: —————", "error"]);

	assert.equal(existsSync(stateFile), false);
});

test("/gruntfoot icon-reset removes only icons from the file and notifies", async () => {
	const { pi, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-icon-reset");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	extensionFactory(pi);

	const ui = makeStubUi();
	const ctx = makeCtx(projectDir, undefined, ui);
	const stateFile = join(projectDir, "agent", "gruntfoot", "settings.json");
	mkdirSync(dirname(stateFile), { recursive: true });
	writeFileSync(
		stateFile,
		JSON.stringify({ enabled: true, custom: { keep: 1 }, colors: { separator: "dim" }, icons: { model: "⚡" } }),
	);

	await commands.get("gruntfoot")!.handler("icon-reset", ctx);

	assert.deepEqual(JSON.parse(readFileSync(stateFile, "utf8")), {
		enabled: true,
		custom: { keep: 1 },
		colors: { separator: "dim" },
	});
	assert.deepEqual(ui.notifications.at(-1), ["gruntfoot: icons reset to defaults", "info"]);
});

test("/gruntfoot icon works outside tui mode; the picker is refused there", async () => {
	const { pi, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-icon-nontui");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	extensionFactory(pi);

	const ui = makeStubUi();
	const ctx = makeCtx(projectDir, undefined, ui);
	ctx.mode = "print";

	await commands.get("gruntfoot")!.handler("icon model ❯", ctx);
	const stateFile = join(projectDir, "agent", "gruntfoot", "settings.json");
	assert.deepEqual(JSON.parse(readFileSync(stateFile, "utf8")), { enabled: false, icons: { model: "❯" } });

	await commands.get("gruntfoot")!.handler("icon", ctx);
	assert.deepEqual(ui.notifications.at(-1), [
		"gruntfoot: the icon picker is only available in TUI mode; use /gruntfoot icon <role> <glyph>",
		"error",
	]);
});

test("/gruntfoot icon opens the picker; enter flow applies a glyph and re-renders", async () => {
	const { pi, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-icon-picker");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	extensionFactory(pi);

	const ui = makeStubUi();
	const ctx = makeCtx(projectDir, undefined, ui);
	const stateFile = join(projectDir, "agent", "gruntfoot", "settings.json");

	let renderCount = 0;
	const pickerPromise = commands.get("gruntfoot")!.handler("icon", ctx);
	const component = ui.customFactory!(
		{ requestRender: () => renderCount++ },
		stubPickerTheme(),
		new RealKeybindingsManager(TUI_KEYBINDINGS),
		ui.customDone!,
	) as { handleInput(data: string): void; render(width: number): string[] };

	// roles screen → enter picks the first role (model) → values screen
	component.handleInput("\r");
	// values screen → enter picks the first value (auto)
	component.handleInput("\r");
	// esc on the role list cancels the picker
	component.handleInput("\x1b");
	await pickerPromise;
	assert.deepEqual(JSON.parse(readFileSync(stateFile, "utf8")), { enabled: false, icons: { model: "auto" } });
	assert.ok(renderCount > 0);

	// rendering the picker produces the icon help line and role descriptions
	const lines = component.render(80).join("\n");
	assert.ok(lines.includes("gruntfoot icons"), lines);
	assert.ok(lines.includes("auto → 🤖"), lines);
});

// ---------------------------------------------------------------------------
// Theme subcommands
// ---------------------------------------------------------------------------

test("/gruntfoot theme save <name> writes the theme file with the current colors", async () => {
	const { pi, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-theme-save");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	extensionFactory(pi);

	const ui = makeStubUi();
	const ctx = makeCtx(projectDir, undefined, ui);

	await commands.get("gruntfoot")!.handler("", ctx);
	await commands.get("gruntfoot")!.handler("color separator dim", ctx);
	await commands.get("gruntfoot")!.handler("theme save Neon-Pi", ctx);

	const themeFile = join(projectDir, "agent", "gruntfoot", "themes", "neon-pi.json");
	assert.deepEqual(JSON.parse(readFileSync(themeFile, "utf8")), { colors: { separator: "dim" }, icons: {} });
	assert.deepEqual(ui.notifications.at(-1), ["gruntfoot: theme neon-pi saved", "info"]);
});

test("/gruntfoot theme save <existing> asks for confirmation; declined writes nothing", async () => {
	const { pi, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-theme-confirm");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	extensionFactory(pi);

	const ui = makeStubUi();
	ui.confirmResult = false;
	const ctx = makeCtx(projectDir, undefined, ui);

	await commands.get("gruntfoot")!.handler("", ctx);
	await commands.get("gruntfoot")!.handler("color separator dim", ctx);
	await commands.get("gruntfoot")!.handler("theme save neon-pi", ctx); // creates the file
	const themeFile = join(projectDir, "agent", "gruntfoot", "themes", "neon-pi.json");
	const before = readFileSync(themeFile, "utf8");

	await commands.get("gruntfoot")!.handler("color base muted", ctx); // change colors
	await commands.get("gruntfoot")!.handler("theme save neon-pi", ctx); // exists → confirm → declined

	assert.equal(ui.confirmCalls.length, 1);
	assert.deepEqual(ui.notifications.at(-1), ["gruntfoot: theme neon-pi not saved (overwrite declined)", "error"]);
	assert.equal(readFileSync(themeFile, "utf8"), before);
});

test("/gruntfoot theme save <existing> with confirmation overwrites the file", async () => {
	const { pi, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-theme-overwrite");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	extensionFactory(pi);

	const ui = makeStubUi();
	ui.confirmResult = true;
	const ctx = makeCtx(projectDir, undefined, ui);

	await commands.get("gruntfoot")!.handler("", ctx);
	await commands.get("gruntfoot")!.handler("color separator dim", ctx);
	await commands.get("gruntfoot")!.handler("theme save neon-pi", ctx); // creates the file

	await commands.get("gruntfoot")!.handler("color base muted", ctx);
	await commands.get("gruntfoot")!.handler("theme save neon-pi", ctx); // exists → confirm → overwrite

	const themeFile = join(projectDir, "agent", "gruntfoot", "themes", "neon-pi.json");
	assert.deepEqual(JSON.parse(readFileSync(themeFile, "utf8")), { colors: { separator: "dim", base: "muted" }, icons: {} });
	assert.equal(ui.confirmCalls.length, 1);
	assert.deepEqual(ui.notifications.at(-1), ["gruntfoot: theme neon-pi saved", "info"]);
});

test("/gruntfoot theme save <existing> outside TUI fails with an error and writes nothing", async () => {
	const { pi, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-theme-nontui-save");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	extensionFactory(pi);

	const ui = makeStubUi();
	ui.confirmResult = false; // no-UI modes: confirm returns false
	const ctx = makeCtx(projectDir, undefined, ui);
	ctx.mode = "print";

	await commands.get("gruntfoot")!.handler("theme save neon-pi", ctx); // doesn't exist → saved directly
	const themeFile = join(projectDir, "agent", "gruntfoot", "themes", "neon-pi.json");
	assert.deepEqual(JSON.parse(readFileSync(themeFile, "utf8")), { colors: {}, icons: {} });
	const before = readFileSync(themeFile, "utf8");

	await commands.get("gruntfoot")!.handler("theme save neon-pi", ctx); // exists → confirm → declined
	assert.equal(ui.confirmCalls.length, 1);
	assert.deepEqual(ui.notifications.at(-1), ["gruntfoot: theme neon-pi not saved (overwrite declined)", "error"]);
	assert.equal(readFileSync(themeFile, "utf8"), before);
});

test("/gruntfoot theme load <name> replaces colors wholesale", async () => {
	const { pi, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-theme-load");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	extensionFactory(pi);

	const ui = makeStubUi();
	const ctx = makeCtx(projectDir, undefined, ui);

	await commands.get("gruntfoot")!.handler("", ctx);
	await commands.get("gruntfoot")!.handler("color separator dim", ctx);

	// write a theme with different colors and icons
	const themeDir = join(projectDir, "agent", "gruntfoot", "themes");
	mkdirSync(themeDir, { recursive: true });
	writeFileSync(
		join(themeDir, "nord.json"),
		JSON.stringify({ colors: { separator: "#5E81AC", base: "muted" }, icons: { model: "❯" } }),
	);

	await commands.get("gruntfoot")!.handler("theme load nord", ctx);

	const stateFile = join(projectDir, "agent", "gruntfoot", "settings.json");
	assert.deepEqual(JSON.parse(readFileSync(stateFile, "utf8")), {
		enabled: true,
		colors: { separator: "#5E81AC", base: "muted" },
		icons: { model: "❯" },
	});
	assert.deepEqual(ui.notifications.at(-1), ["gruntfoot: theme nord loaded", "info"]);
});

test("/gruntfoot theme load <name> works outside TUI mode", async () => {
	const { pi, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-theme-nontui-load");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	extensionFactory(pi);

	const ui = makeStubUi();
	const ctx = makeCtx(projectDir, undefined, ui);
	ctx.mode = "print";

	const themeDir = join(projectDir, "agent", "gruntfoot", "themes");
	mkdirSync(themeDir, { recursive: true });
	writeFileSync(join(themeDir, "nord.json"), JSON.stringify({ colors: { base: "muted" }, icons: {} }));

	await commands.get("gruntfoot")!.handler("theme load nord", ctx);

	const stateFile = join(projectDir, "agent", "gruntfoot", "settings.json");
	// the theme's empty icons map drops the icons key entirely
	assert.deepEqual(JSON.parse(readFileSync(stateFile, "utf8")), { enabled: false, colors: { base: "muted" } });
	assert.deepEqual(ui.notifications.at(-1), ["gruntfoot: theme nord loaded", "info"]);
});

test("/gruntfoot theme load <malformed> errors and leaves colors unchanged", async () => {
	const { pi, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-theme-malformed");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	extensionFactory(pi);

	const ui = makeStubUi();
	const ctx = makeCtx(projectDir, undefined, ui);

	await commands.get("gruntfoot")!.handler("", ctx);
	await commands.get("gruntfoot")!.handler("color separator dim", ctx);

	const themeDir = join(projectDir, "agent", "gruntfoot", "themes");
	mkdirSync(themeDir, { recursive: true });
	writeFileSync(join(themeDir, "bad.json"), "not json");

	await commands.get("gruntfoot")!.handler("theme load bad", ctx);

	assert.deepEqual(ui.notifications.at(-1), ["gruntfoot: malformed theme file: bad.json", "error"]);
	const stateFile = join(projectDir, "agent", "gruntfoot", "settings.json");
	assert.deepEqual(JSON.parse(readFileSync(stateFile, "utf8")), { enabled: true, colors: { separator: "dim" } });
});

test("/gruntfoot theme load <flat legacy file> reports malformed and loads nothing", async () => {
	const { pi, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-theme-legacy");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	extensionFactory(pi);

	const ui = makeStubUi();
	const ctx = makeCtx(projectDir, undefined, ui);

	await commands.get("gruntfoot")!.handler("", ctx);
	await commands.get("gruntfoot")!.handler("color separator dim", ctx);

	const themeDir = join(projectDir, "agent", "gruntfoot", "themes");
	mkdirSync(themeDir, { recursive: true });
	writeFileSync(join(themeDir, "legacy.json"), JSON.stringify({ separator: "#5E81AC" }));

	await commands.get("gruntfoot")!.handler("theme load legacy", ctx);

	assert.deepEqual(ui.notifications.at(-1), ["gruntfoot: malformed theme file: legacy.json", "error"]);
	const stateFile = join(projectDir, "agent", "gruntfoot", "settings.json");
	assert.deepEqual(JSON.parse(readFileSync(stateFile, "utf8")), { enabled: true, colors: { separator: "dim" } });
});

test("/gruntfoot theme load <missing> errors", async () => {
	const { pi, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-theme-missing");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	extensionFactory(pi);

	const ui = makeStubUi();
	const ctx = makeCtx(projectDir, undefined, ui);

	await commands.get("gruntfoot")!.handler("theme load nope", ctx);
	assert.deepEqual(ui.notifications.at(-1), ["gruntfoot: theme not found: nope", "error"]);
});

test("/gruntfoot theme opens the picker; save flow writes the theme", async () => {
	const { pi, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-theme-picker");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	extensionFactory(pi);

	const ui = makeStubUi();
	const ctx = makeCtx(projectDir, undefined, ui);

	await commands.get("gruntfoot")!.handler("", ctx);
	await commands.get("gruntfoot")!.handler("color separator dim", ctx);

	const pickerPromise = commands.get("gruntfoot")!.handler("theme", ctx);
	const component = ui.customFactory!(
		{ requestRender: () => {} },
		stubPickerTheme(),
		new RealKeybindingsManager(TUI_KEYBINDINGS),
		ui.customDone!,
	) as { handleInput(data: string): void; render(width: number): string[] };

	// menu → enter selects "save theme" → save-name input
	component.handleInput("\r");
	// type a name (normalized on submit) and submit
	for (const char of "Neon Pi") component.handleInput(char);
	component.handleInput("\r");
	// esc on the menu closes the picker
	component.handleInput("\x1b");
	await pickerPromise;

	const themeFile = join(projectDir, "agent", "gruntfoot", "themes", "neon-pi.json");
	assert.deepEqual(JSON.parse(readFileSync(themeFile, "utf8")), { colors: { separator: "dim" }, icons: {} });
	assert.deepEqual(ui.notifications.at(-1), ["gruntfoot: theme neon-pi saved", "info"]);
});

test("/gruntfoot theme load opens the picker pre-targeted at the load screen", async () => {
	const { pi, commands } = stubPi();
	const projectDir = sandboxDir("gruntfoot-theme-picker-load");
	process.env.PI_CODING_AGENT_DIR = join(projectDir, "agent");
	extensionFactory(pi);

	const ui = makeStubUi();
	const ctx = makeCtx(projectDir, undefined, ui);

	const themeDir = join(projectDir, "agent", "gruntfoot", "themes");
	mkdirSync(themeDir, { recursive: true });
	writeFileSync(join(themeDir, "nord.json"), JSON.stringify({ colors: { base: "muted" }, icons: {} }));

	const pickerPromise = commands.get("gruntfoot")!.handler("theme load", ctx);
	const component = ui.customFactory!(
		{ requestRender: () => {} },
		stubPickerTheme(),
		new RealKeybindingsManager(TUI_KEYBINDINGS),
		ui.customDone!,
	) as { handleInput(data: string): void; render(width: number): string[] };

	// pre-targeted: already on the load screen; enter loads the first theme
	const lines = component.render(60).join("\n");
	assert.ok(lines.includes("Load theme"), lines);
	component.handleInput("\r");
	component.handleInput("\x1b"); // esc on the menu closes the picker
	await pickerPromise;

	const stateFile = join(projectDir, "agent", "gruntfoot", "settings.json");
	// the theme's empty icons map drops the icons key entirely
	assert.deepEqual(JSON.parse(readFileSync(stateFile, "utf8")), { enabled: false, colors: { base: "muted" } });
	assert.deepEqual(ui.notifications.at(-1), ["gruntfoot: theme nord loaded", "info"]);
});
