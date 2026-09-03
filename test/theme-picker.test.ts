import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { KeybindingsManager as RealKeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { ThemePicker, type ThemePickerDeps, type ThemePickerTarget } from "../src/theme-picker.ts";

function stubTheme(): Theme {
	return {
		fg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		getColorMode: () => "truecolor" as const,
	} as unknown as Theme;
}

function stubTui(): TUI {
	return { requestRender: () => {} } as unknown as TUI;
}

function stubKeybindings(): KeybindingsManager {
	return new RealKeybindingsManager(TUI_KEYBINDINGS) as unknown as KeybindingsManager;
}

function makeDeps(overrides: Partial<ThemePickerDeps> = {}): ThemePickerDeps {
	return {
		listThemes: () => [],
		themeExists: () => false,
		save: () => ({ ok: true }),
		onSaved: () => {},
		onLoaded: () => {},
		notifyError: () => {},
		...overrides,
	};
}

interface PickerHarness {
	picker: ThemePicker;
	saved: Array<[name: string, overwrite: boolean]>;
	loaded: string[];
	errors: string[];
	canceled(): boolean;
	nameInput(): { handleInput(data: string): void; setValue(value: string): void };
}

function makePicker(overrides: { deps?: Partial<ThemePickerDeps>; initial?: ThemePickerTarget } = {}): PickerHarness {
	const saved: Array<[string, boolean]> = [];
	const loaded: string[] = [];
	const errors: string[] = [];
	let canceled = false;
	const picker = new ThemePicker(
		stubTui(),
		stubTheme(),
		stubKeybindings(),
		{
			...makeDeps(overrides.deps),
			save: (name, overwrite) => {
				saved.push([name, overwrite]);
				return overrides.deps?.save?.(name, overwrite) ?? { ok: true };
			},
			onLoaded: (name) => {
				loaded.push(name);
				overrides.deps?.onLoaded?.(name);
			},
			notifyError: (message) => {
				errors.push(message);
				overrides.deps?.notifyError?.(message);
			},
		},
		() => {
			canceled = true;
		},
		overrides.initial,
	);
	return {
		picker,
		saved,
		loaded,
		errors,
		canceled: () => canceled,
		nameInput: () =>
			(picker as unknown as { nameInput: { handleInput(d: string): void; setValue(v: string): void } }).nameInput,
	};
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

test("menu screen lists save and load; esc cancels the picker", () => {
	const { picker, canceled } = makePicker();
	const lines = picker.render(60).join("\n");
	assert.ok(lines.includes("gruntfoot themes"), lines);
	assert.ok(lines.includes("save theme"), lines);
	assert.ok(lines.includes("load theme"), lines);
	picker.handleInput("\x1b");
	assert.equal(canceled(), true);
});

// ---------------------------------------------------------------------------
// Save flow
// ---------------------------------------------------------------------------

test("menu → save: typing a name and submitting saves it normalized", () => {
	const { picker, saved } = makePicker();
	picker.handleInput("\r"); // menu → save name
	assert.ok(picker.render(60).join("\n").includes("Save theme"));
	picker.handleInput("Neon Pi");
	picker.handleInput("\r");
	assert.deepEqual(saved, [["neon-pi", false]]);
	// back on the menu after a successful save
	assert.ok(picker.render(60).join("\n").includes("gruntfoot themes"));
});

test("save name: empty or invalid names error without saving", () => {
	const { picker, saved, errors } = makePicker();
	picker.handleInput("\r"); // menu → save name
	picker.handleInput("\r"); // empty submit
	assert.equal(saved.length, 0);
	assert.deepEqual(errors, ["enter a theme name"]);
	picker.handleInput("!!!");
	picker.handleInput("\r");
	assert.deepEqual(errors, ["enter a theme name", "invalid theme name: !!!"]);
	assert.equal(saved.length, 0);
	// still on the save screen
	assert.ok(picker.render(60).join("\n").includes("Save theme"));
});

test("existing theme: overwrite confirmation — cancel declines with an error, overwrite saves", () => {
	const { picker, saved, errors } = makePicker({ deps: { themeExists: () => true } });
	picker.handleInput("\r"); // menu → save name
	picker.handleInput("neon-pi");
	picker.handleInput("\r"); // exists → confirmation screen
	assert.equal(saved.length, 0);
	assert.ok(picker.render(60).join("\n").includes('Overwrite theme "neon-pi"?'), picker.render(60).join("\n"));
	// Cancel (second entry): decline with an error, back to the name input
	picker.handleInput("\x1b[B");
	picker.handleInput("\r");
	assert.deepEqual(errors, ["theme neon-pi not saved (overwrite declined)"]);
	assert.equal(saved.length, 0);
	assert.ok(picker.render(60).join("\n").includes("Save theme"));
	// submit again (draft restored) → confirmation → Overwrite (first entry)
	picker.handleInput("\r");
	picker.handleInput("\r");
	assert.deepEqual(saved, [["neon-pi", true]]);
});

test("save failure notifies without navigating away", () => {
	const { picker, saved, errors } = makePicker({
		deps: { save: () => ({ ok: false, reason: "write failed" }) },
	});
	picker.handleInput("\r"); // menu → save name
	picker.handleInput("a");
	picker.handleInput("\r");
	assert.equal(saved.length, 1);
	assert.deepEqual(errors, ["could not save theme a (write failed)"]);
	assert.ok(picker.render(60).join("\n").includes("Save theme"));
});

test("save name screen shows the normalization hint", () => {
	const { picker } = makePicker();
	picker.handleInput("\r"); // menu → save name
	const lines = picker.render(120).join("\n");
	assert.ok(lines.includes("Neon Pi → neon-pi"), lines);
});

// ---------------------------------------------------------------------------
// Load flow
// ---------------------------------------------------------------------------

test("menu → load lists themes; enter loads the selected theme", () => {
	const { picker, loaded } = makePicker({ deps: { listThemes: () => ["neon-pi", "nord"] } });
	picker.handleInput("\x1b[B"); // down to load theme
	picker.handleInput("\r");
	const lines = picker.render(60).join("\n");
	assert.ok(lines.includes("Load theme"), lines);
	assert.ok(lines.includes("neon-pi"), lines);
	assert.ok(lines.includes("nord"), lines);
	picker.handleInput("\r"); // load the first theme
	assert.deepEqual(loaded, ["neon-pi"]);
	// back on the menu after a successful load
	assert.ok(picker.render(60).join("\n").includes("gruntfoot themes"));
});

test("load screen: type-to-filter narrows the theme list", () => {
	const { picker } = makePicker({ deps: { listThemes: () => ["neon-pi", "nord"] } });
	picker.handleInput("\x1b[B"); // down to load theme
	picker.handleInput("\r");
	picker.handleInput("n");
	picker.handleInput("o");
	picker.handleInput("r");
	const lines = picker.render(60).join("\n");
	assert.ok(lines.includes("nord"), lines);
	assert.ok(!lines.includes("neon-pi"), lines);
});

test("load screen with no themes shows a hint and still backs out", () => {
	const { picker, loaded, canceled } = makePicker();
	picker.handleInput("\x1b[B"); // down to load theme
	picker.handleInput("\r");
	const lines = picker.render(60).join("\n");
	assert.ok(lines.includes("no themes saved yet"), lines);
	picker.handleInput("\x1b"); // back to the menu
	assert.equal(loaded.length, 0);
	assert.ok(picker.render(60).join("\n").includes("gruntfoot themes"));
	picker.handleInput("\x1b"); // cancel
	assert.equal(canceled(), true);
});

// ---------------------------------------------------------------------------
// Esc levels + initial targets
// ---------------------------------------------------------------------------

test("esc backs out one level from every screen", () => {
	const { picker, canceled } = makePicker({ deps: { themeExists: () => true } });
	// saveName → menu
	picker.handleInput("\r");
	picker.handleInput("\x1b");
	assert.equal(canceled(), false);
	assert.ok(picker.render(60).join("\n").includes("gruntfoot themes"));
	// saveName → confirm → saveName
	picker.handleInput("\r");
	picker.handleInput("a");
	picker.handleInput("\r"); // exists → confirmation screen
	assert.ok(picker.render(60).join("\n").includes('Overwrite theme "a"?'));
	picker.handleInput("\x1b"); // back to the save screen
	assert.ok(picker.render(60).join("\n").includes("Save theme"));
	// saveName → menu
	picker.handleInput("\x1b");
	assert.ok(picker.render(60).join("\n").includes("gruntfoot themes"));
	// load → menu
	picker.handleInput("\x1b[B"); // down to load theme
	picker.handleInput("\r");
	picker.handleInput("\x1b");
	assert.ok(picker.render(60).join("\n").includes("gruntfoot themes"));
	// menu → cancel
	picker.handleInput("\x1b");
	assert.equal(canceled(), true);
});

test("initial targets open the picker on the right screen", () => {
	const { picker } = makePicker({ initial: "save" });
	assert.ok(picker.render(60).join("\n").includes("Save theme"));
	const { picker: picker2 } = makePicker({ initial: "load", deps: { listThemes: () => ["a"] } });
	assert.ok(picker2.render(60).join("\n").includes("Load theme"));
});

test("kitty-protocol escape sequences are recognized", () => {
	const { picker, canceled } = makePicker();
	picker.handleInput("\x1b[27u"); // kitty esc → cancel
	assert.equal(canceled(), true);
});
