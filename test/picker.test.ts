import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { KeybindingsManager as RealKeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import {
	COLOR_HELP_LINE,
	ColorPicker,
	buildRoleItems,
	buildValueItems,
	renderRoleLabel,
	type ColorPickerDeps,
} from "../src/picker.ts";
import { resolveColors, type ColorConfig, type ColorRole } from "../src/colors.ts";

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

function makeDeps(overrides: Partial<ColorPickerDeps> = {}): ColorPickerDeps {
	return {
		getColors: () => ({}),
		apply: () => {},
		notifyError: () => {},
		...overrides,
	};
}

interface PickerHarness {
	picker: ColorPicker;
	applied: Array<[string, string]>;
	errors: string[];
	canceled(): boolean;
	customInput(): { handleInput(data: string): void; setValue(value: string): void };
}

function makePicker(overrides: { deps?: Partial<ColorPickerDeps>; initialRole?: ColorRole } = {}): PickerHarness {
	const applied: Array<[string, string]> = [];
	const errors: string[] = [];
	let canceled = false;
	const picker = new ColorPicker(
		stubTui(),
		stubTheme(),
		stubKeybindings(),
		{
			...makeDeps(overrides.deps),
			apply: (role, value) => {
				applied.push([role, value]);
				overrides.deps?.apply?.(role, value);
			},
			notifyError: (message) => {
				errors.push(message);
				overrides.deps?.notifyError?.(message);
			},
		},
		() => {
			canceled = true;
		},
		overrides.initialRole,
	);
	return {
		picker,
		applied,
		errors,
		canceled: () => canceled,
		customInput: () => (picker as unknown as { customInput: { handleInput(d: string): void; setValue(v: string): void } }).customInput,
	};
}

// ---------------------------------------------------------------------------
// Pure builders
// ---------------------------------------------------------------------------

test("buildRoleItems lists every role with label and current-value description", () => {
	const config: ColorConfig = { separator: "dim" };
	const items = buildRoleItems(config, resolveColors(config));
	assert.equal(items.length, 11);
	const separator = items.find((item) => item.value === "separator")!;
	assert.equal(separator.label, "separator [Editor separator]");
	assert.equal(separator.description, "dim");
	const base = items.find((item) => item.value === "base")!;
	assert.equal(base.description, "auto → muted");
});

test("buildRoleItems descriptions follow the auto chains", () => {
	const config: ColorConfig = { separator: "#B9D175" };
	const items = buildRoleItems(config, resolveColors(config));
	const chip = items.find((item) => item.value === "chip")!;
	assert.equal(chip.label, "chip [Session-name chip]");
	assert.equal(chip.description, "auto → #b9d175");
});

test("buildRoleItems labels fit the raised 40-column primary column", () => {
	// rebuildRoles raises maxPrimaryColumnWidth to 40 because the widest
	// composed label is 37 columns (+2 gap); fail if a role or label outgrows
	// that. Labels are pure ASCII, so length equals display width.
	for (const item of buildRoleItems({}, resolveColors({}))) {
		assert.ok(item.label.length + 2 <= 40, `label too wide for the column cap: ${item.label}`);
	}
});

test("renderRoleLabel: unselected rows dim only the bracketed suffix", () => {
	const styled = renderRoleLabel("separator [Editor separator]", 40, false, (t) => `<d>${t}</d>`);
	assert.equal(styled, "separator<d> [Editor separator]</d>");
});

test("renderRoleLabel: selected rows return the plain label for full accent coverage", () => {
	const styled = renderRoleLabel("separator [Editor separator]", 40, true, (t) => `<d>${t}</d>`);
	assert.equal(styled, "separator [Editor separator]");
});

test("renderRoleLabel: narrow widths truncate the suffix and keep the field name", () => {
	const styled = renderRoleLabel("separator [Editor separator]", 12, false, (t) => `<d>${t}</d>`);
	assert.ok(styled.startsWith("separator<d>"), `unexpected: ${styled}`);
	assert.ok(!styled.includes("Editor"), `unexpected: ${styled}`);
});

test("renderRoleLabel: plain fallback when there is no bracket or no room for one", () => {
	const style = (t: string) => `<d>${t}</d>`;
	assert.equal(renderRoleLabel("plain", 40, false, style), "plain");
	const clipped = renderRoleLabel("separator [X]", 5, false, style);
	assert.ok(clipped.startsWith("separ"), `unexpected: ${clipped}`);
	assert.ok(!clipped.includes("<d>"), `unexpected: ${clipped}`);
});

test("buildValueItems: auto first, custom… second, then tokens previewed live", () => {
	const items = buildValueItems(stubTheme());
	assert.equal(items.length, 1 + 1 + 47);
	assert.equal(items[0].value, "auto");
	assert.equal(items[1].value, "custom");
	assert.equal(items[1].label, "custom…");
	assert.equal(items.at(-1)?.value, "bashMode");
	// token labels are styled previews but values stay plain for filtering
	const tokenItem = items[2];
	assert.equal(tokenItem.value, "accent");
});

test("COLOR_HELP_LINE documents the accepted syntax", () => {
	assert.ok(COLOR_HELP_LINE.includes("auto"));
	assert.ok(COLOR_HELP_LINE.includes("#RRGGBB"));
	assert.ok(COLOR_HELP_LINE.includes("0–255"));
});

// ---------------------------------------------------------------------------
// Component flow
// ---------------------------------------------------------------------------

test("roles screen: enter selects the first role and shows its values", () => {
	const { picker, applied } = makePicker();
	picker.handleInput("\r"); // separator → values screen
	const lines = picker.render(60).join("\n");
	assert.ok(lines.includes("Set color for Editor separator"), lines);
	assert.equal(applied.length, 0);
});

test("value screen: enter applies the selected value and returns to roles", () => {
	const { picker, applied } = makePicker();
	picker.handleInput("\r"); // separator → values
	picker.handleInput("\r"); // auto → apply
	assert.deepEqual(applied, [["separator", "auto"]]);
	const lines = picker.render(60).join("\n");
	assert.ok(lines.includes("gruntfoot colors"), lines);
});

test("value screen: backspace with no filter resets the role to auto", () => {
	const { picker, applied } = makePicker();
	picker.handleInput("\r"); // separator → values
	picker.handleInput("\x7f"); // backspace → auto
	assert.deepEqual(applied, [["separator", "auto"]]);
});

test("value screen: backspace with an active filter deletes the filter char instead", () => {
	const { picker, applied } = makePicker();
	picker.handleInput("\r"); // separator → values
	picker.handleInput("d"); // type-to-filter
	picker.handleInput("i");
	picker.handleInput("\x7f"); // deletes "i" from the filter
	assert.deepEqual(applied, []);
	picker.handleInput("\x7f"); // deletes "d" from the filter
	assert.deepEqual(applied, []);
	picker.handleInput("\x7f"); // filter empty → auto
	assert.deepEqual(applied, [["separator", "auto"]]);
});

test("filtering narrows the value list to matching tokens", () => {
	const { picker } = makePicker();
	picker.handleInput("\r"); // separator → values
	picker.handleInput("d"); // type-to-filter
	picker.handleInput("i");
	const lines = picker.render(60).join("\n");
	assert.ok(lines.includes("dim"), lines);
	assert.ok(!lines.includes("borderAccent"), lines);
});

test("esc backs out one level: values → roles → cancel", () => {
	const { picker, canceled } = makePicker();
	picker.handleInput("\r"); // separator → values
	picker.handleInput("\x1b"); // back to roles
	assert.equal(canceled(), false);
	assert.ok(picker.render(60).join("\n").includes("gruntfoot colors"));
	picker.handleInput("\x1b"); // cancel
	assert.equal(canceled(), true);
});

test("initial role opens the picker directly on its value screen", () => {
	const { picker } = makePicker({ initialRole: "chip" });
	const lines = picker.render(60).join("\n");
	assert.ok(lines.includes("Set color for Session-name chip"), lines);
});

test("custom… opens the inline input; valid value applies; junk errors without saving", () => {
	const { picker, applied, errors, customInput } = makePicker();
	picker.handleInput("\r"); // separator → values
	// custom… is the second entry: one arrow down lands on it, and the
	// rendered selection confirms it before enter is pressed.
	picker.handleInput("\x1b[B");
	const valueScreen = picker.render(60).join("\n");
	assert.ok(valueScreen.includes("→ custom…"), valueScreen);
	picker.handleInput("\r"); // select custom…
	assert.equal(applied.length, 0);
	// invalid value → error notify, nothing applied
	const input = customInput();
	input.handleInput("#12345");
	input.handleInput("\r");
	assert.equal(applied.length, 0);
	assert.equal(errors.length, 1);
	assert.ok(errors[0].includes("invalid color value"));
	// valid hex applies
	input.setValue("");
	input.handleInput("#B9D175");
	input.handleInput("\r");
	assert.deepEqual(applied, [["separator", "#B9D175"]]);
});

test("custom input: esc returns to the value list without applying", () => {
	const { picker, applied, customInput } = makePicker();
	picker.handleInput("\r"); // separator → values
	picker.handleInput("\x1b[B"); // navigate to custom…
	picker.handleInput("\r"); // open custom input
	const input = customInput();
	input.handleInput("#ff0000");
	input.handleInput("\x1b");
	assert.equal(applied.length, 0);
	assert.ok(picker.render(60).join("\n").includes("Set color for Editor separator"));
});

test("render shows the muted help line on every screen", () => {
	const { picker } = makePicker();
	const rolesLines = picker.render(120).join("\n");
	assert.ok(rolesLines.includes(COLOR_HELP_LINE), rolesLines);
	picker.handleInput("\r"); // values screen
	const valuesLines = picker.render(120).join("\n");
	assert.ok(valuesLines.includes(COLOR_HELP_LINE), valuesLines);
});

test("kitty-protocol escape and backspace sequences are recognized", () => {
	// Terminals with the Kitty keyboard protocol report Esc as CSI-u, not raw \x1b.
	const { picker, applied, canceled, customInput } = makePicker();
	picker.handleInput("\r"); // separator → values
	picker.handleInput("\x1b[27u"); // kitty esc → back to roles
	assert.equal(canceled(), false);
	assert.ok(picker.render(60).join("\n").includes("gruntfoot colors"));
	picker.handleInput("\x1b[27u"); // kitty esc → cancel
	assert.equal(canceled(), true);

	// Backspace via kitty CSI-u resets the role to auto (no filter typed).
	const { picker: picker2, applied: applied2 } = makePicker();
	picker2.handleInput("\r"); // separator → values
	picker2.handleInput("\x1b[127u"); // kitty backspace → auto
	assert.deepEqual(applied2, [["separator", "auto"]]);

	// The custom input screen also handles kitty escape.
	const { picker: picker3, applied: applied3, customInput: customInput3 } = makePicker();
	picker3.handleInput("\r"); // separator → values
	picker3.handleInput("\x1b[B"); // navigate to custom…
	picker3.handleInput("\r"); // open custom input
	customInput3().handleInput("#ff0000");
	customInput3().handleInput("\x1b[27u"); // kitty esc → back to values, nothing applied
	assert.equal(applied3.length, 0);
	assert.ok(picker3.render(60).join("\n").includes("Set color for Editor separator"));
});

test("role screen: backspace resets the selected role to auto", () => {
	const { picker, applied } = makePicker();
	// navigate to the second role (chip) and press backspace
	picker.handleInput("\x1b[B");
	picker.handleInput("\x7f");
	assert.deepEqual(applied, [["chip", "auto"]]);
	// the role list refreshes with the new current value
	const lines = picker.render(120).join("\n");
	assert.ok(lines.includes("Session-name chip"), lines);
});

test("role screen: backspace deletes filter chars first", () => {
	const { picker, applied } = makePicker();
	picker.handleInput("c"); // type-to-filter on the role screen
	picker.handleInput("o");
	picker.handleInput("\x7f"); // deletes "o" from the filter
	assert.deepEqual(applied, []);
	picker.handleInput("\x7f"); // deletes "c" from the filter
	assert.deepEqual(applied, []);
	picker.handleInput("\x7f"); // filter empty → reset the selected role (separator)
	assert.deepEqual(applied, [["separator", "auto"]]);
});

test("esc/backspace work across terminal encodings (legacy, kitty CSI-u, xterm modifyOtherKeys)", () => {
	// Terminals speak three families: legacy bytes (xterm, alacritty, gnome-terminal,
	// konsole, tmux...), kitty CSI-u (kitty/wezterm/ghostty with the protocol active),
	// and xterm modifyOtherKeys. The keybindings manager covers all of them.
	const escEncodings = [
		"\x1b", // legacy ESC byte
		"\x1b[27u", // kitty CSI-u
		"\x1b[27;1u", // kitty CSI-u with modifier
		"\x1b[27;1:1u", // kitty CSI-u with event type (press)
		"\x1b[27;1;27~", // xterm modifyOtherKeys
		"\x03", // legacy ctrl+c
		"\x1b[99;5u", // kitty ctrl+c
	];
	for (const enc of escEncodings) {
		const { picker, canceled } = makePicker();
		picker.handleInput(enc); // roles screen → cancel
		assert.equal(canceled(), true, `esc encoding ${JSON.stringify(enc)} should cancel`);
	}

	const backspaceEncodings = [
		"\x7f", // legacy DEL
		"\x08", // legacy BS
		"\x1b[127u", // kitty CSI-u
		"\x1b[127;1u", // kitty CSI-u with modifier
		"\x1b[127;1:1u", // kitty CSI-u with event type (press)
		"\x1b[27;1;127~", // xterm modifyOtherKeys
	];
	for (const enc of backspaceEncodings) {
		const { picker, applied } = makePicker();
		picker.handleInput("\r"); // separator → values
		picker.handleInput(enc); // → reset to auto
		assert.deepEqual(applied, [["separator", "auto"]], `backspace encoding ${JSON.stringify(enc)} should reset to auto`);
	}
});
